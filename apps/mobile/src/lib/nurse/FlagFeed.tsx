import type { Flag } from '@triagecam/contracts';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PushBanner } from '@/components/PushBanner';
import { useScopedTheme } from '@/components/ThemeScope';
import { usePolling } from '@/hooks/usePolling';
import { api, errorMessage } from '@/lib/api';
import { clockTime } from '@/lib/format';
import { useSession } from '@/lib/session/SessionProvider';

import { type PushRegistration, registerForPush, showFlagsInApp, ticketOfNotification } from './push';
import { flagTitle } from './worklistFormat';

/** With push working the poll is only a safety net; without it the poll is how flags arrive. */
const POLL_WITH_PUSH_MS = 30_000;
const POLL_WITHOUT_PUSH_MS = 5000;

type FlagFeed = {
  /** Null until registration has been tried. */
  push: PushRegistration | null;
  /** Goes up whenever a flag arrives or is acknowledged, so lists know to refetch. */
  revision: number;
  /** Lets the banner follow an acknowledgement made on the ticket screen. */
  markAcknowledged: (flag: Flag) => void;
};

const FlagFeedContext = createContext<FlagFeed | null>(null);

export function useFlagFeed(): FlagFeed {
  const feed = useContext(FlagFeedContext);
  if (!feed) throw new Error('useFlagFeed needs a FlagFeedProvider above it');
  return feed;
}

/**
 * Brings flags to the nurse phone three ways: a push received in the foreground, a tapped
 * notification, and a poll of the open flags that works when push does not. Each flag episode
 * is announced once, in a PushBanner over whatever nurse screen is showing.
 */
export function FlagFeedProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const theme = useScopedTheme();
  const insets = useSafeAreaInsets();
  const { setPushToken } = useSession();

  const [push, setPush] = useState<PushRegistration | null>(null);
  const [banners, setBanners] = useState<Flag[]>([]);
  const [revision, setRevision] = useState(0);
  const [acknowledging, setAcknowledging] = useState(false);
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null);
  const seen = useRef(new Set<string>());
  const seeded = useRef(false);

  const announce = useCallback((flags: Flag[]) => {
    const fresh = flags.filter((flag) => !seen.current.has(flag.id));
    if (fresh.length === 0) return;
    for (const flag of fresh) seen.current.add(flag.id);
    const unacknowledged = fresh.filter((flag) => !flag.acknowledgedAt);
    if (unacknowledged.length > 0) setBanners((current) => [...current, ...unacknowledged]);
    setRevision((value) => value + 1);
  }, []);

  const poll = useCallback(async () => {
    let flags: Flag[];
    try {
      flags = (await api.openFlags()).items;
    } catch (error) {
      // The worklist screen reports an unreachable server; the feed just tries again.
      console.warn('Flag poll failed', error);
      return;
    }
    if (!seeded.current) {
      // Flags that were already open when the app started are on the worklist, not announced.
      seeded.current = true;
      for (const flag of flags) seen.current.add(flag.id);
      return;
    }
    announce(flags);
  }, [announce]);

  usePolling(poll, push?.available ? POLL_WITH_PUSH_MS : POLL_WITHOUT_PUSH_MS, push !== null);

  // Registration is tried once per mount; setPushToken changes identity when the session does.
  const setPushTokenRef = useRef(setPushToken);
  useEffect(() => {
    setPushTokenRef.current = setPushToken;
  }, [setPushToken]);

  useEffect(() => {
    let active = true;
    showFlagsInApp();
    void registerForPush().then(async (registration) => {
      if (!active) return;
      setPush(registration);
      try {
        await setPushTokenRef.current(registration.available ? registration.token : null);
      } catch (error) {
        console.warn('The push token did not reach the server', error);
        if (active && registration.available) {
          setPush({ available: false, reason: 'The server did not accept this phone for push notifications' });
        }
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // A push that arrives while the app is open: show the same flag in the app.
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const target = ticketOfNotification(notification);
      if (!target) return;
      void api
        .openFlags()
        .then(({ items }) => {
          seeded.current = true;
          announce(items.filter((flag) => flag.id === target.flagId || flag.ticketNumber === target.ticketNumber));
        })
        .catch((error: unknown) => console.warn('Could not load the flag for a notification', error));
    });
    return () => subscription.remove();
  }, [announce]);

  // A tapped notification opens its ticket, also when the tap is what started the app.
  const openedResponse = useRef<string | null>(null);
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse): string | null => {
      const id = response.notification.request.identifier;
      if (openedResponse.current === id) return null;
      openedResponse.current = id;
      Notifications.clearLastNotificationResponse();
      const target = ticketOfNotification(response.notification);
      if (!target) return null;
      if (target.flagId) seen.current.add(target.flagId);
      router.push({ pathname: '/nurse/ticket/[number]', params: { number: String(target.ticketNumber) } });
      return target.flagId;
    };
    const launch = Notifications.getLastNotificationResponse();
    if (launch) open(launch);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const flagId = open(response);
      if (flagId) setBanners((current) => current.filter((flag) => flag.id !== flagId));
    });
    return () => subscription.remove();
  }, [router]);

  const markAcknowledged = useCallback((flag: Flag) => {
    setBanners((current) => current.map((item) => (item.id === flag.id ? flag : item)));
    setRevision((value) => value + 1);
  }, []);

  const banner = banners[0] ?? null;
  const dismiss = useCallback(() => {
    setAcknowledgeError(null);
    setBanners((current) => current.slice(1));
  }, []);

  const acknowledge = async (flag: Flag) => {
    setAcknowledging(true);
    setAcknowledgeError(null);
    try {
      markAcknowledged((await api.acknowledgeFlag(flag.id)).flag);
    } catch (error) {
      setAcknowledgeError(errorMessage(error));
    } finally {
      setAcknowledging(false);
    }
  };

  const feed = useMemo(() => ({ push, revision, markAcknowledged }), [push, revision, markAcknowledged]);

  return (
    <FlagFeedContext.Provider value={feed}>
      {children}
      {banner ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            top: insets.top + theme.space.space2,
            left: theme.space.space4,
            right: theme.space.space4,
            alignItems: 'center',
          }}
        >
          <View style={{ width: '100%', maxWidth: 528 }}>
            <PushBanner
              title={flagTitle(banner.rule, banner.ticketNumber)}
              time={clockTime(banner.openedAt)}
              body={banner.handoff}
              acknowledged={banner.acknowledgedAt != null}
              acknowledging={acknowledging}
              error={acknowledgeError}
              onAcknowledge={() => void acknowledge(banner)}
              onOpen={() => {
                dismiss();
                router.push({ pathname: '/nurse/ticket/[number]', params: { number: String(banner.ticketNumber) } });
              }}
              onDismiss={dismiss}
            />
          </View>
        </View>
      ) : null}
    </FlagFeedContext.Provider>
  );
}
