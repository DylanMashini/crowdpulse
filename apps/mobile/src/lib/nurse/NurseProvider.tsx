import { type Flag, type FlagAlert, type WorklistResponse, flagAlerts } from '@triagecam/contracts';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PushBanner } from '@/components/PushBanner';
import { useScopedTheme } from '@/components/ThemeScope';
import { api, errorMessage } from '@/lib/api';
import { clockTime } from '@/lib/format';
import { useSession } from '@/lib/session/SessionProvider';

import { openEventStream } from './eventStream';
import { type Connection, announcements, followAlerts, withAcknowledgement } from './nurseFormat';
import { type PushRegistration, patientOfNotification, registerForPush, showFlagsInApp } from './push';
import { flagTitle } from './worklistFormat';

/** With the stream open the poll is a safety net and keeps "3 min ago" moving. */
const POLL_LIVE_MS = 20_000;
/** Without it the poll is how changes arrive: the contract's refresh rate for the nurse role. */
const POLL_MS = 5000;
const RECONNECT_MS = [1000, 2000, 5000, 10_000];
/** Several events arrive together when a sitting ends; one refetch answers them all. */
const EVENT_SETTLE_MS = 200;

type NurseData = {
  /** Null until the first answer. Kept as it was when a later request fails. */
  worklist: WorklistResponse | null;
  /** Every open flag, newest first. Null until the first answer. */
  flags: Flag[] | null;
  /** Why the last refresh failed, or null when it succeeded. */
  failure: string | null;
  connection: Connection;
  /** Goes up whenever the server reports a change, so screens with their own data refetch. */
  revision: number;
  /**
   * The phone's clock at the last refresh, in ms. Screens count "12 min ago" from it, so
   * every age on screen moves together and rendering stays a pure function of state.
   */
  now: number;
  /** Null until registration has been tried. */
  push: PushRegistration | null;
  refresh: () => Promise<void>;
  /**
   * Acknowledges a flag, and with it the rest of its alert, and updates every list at once.
   * Rejects with the reason when it fails.
   */
  acknowledge: (flagId: string) => Promise<void>;
};

const NurseContext = createContext<NurseData | null>(null);

export function useNurse(): NurseData {
  const data = useContext(NurseContext);
  if (!data) throw new Error('useNurse needs a NurseProvider above it');
  return data;
}

/**
 * Everything the nurse tabs share: the worklist and the open flags, kept current by the
 * server's event stream with a poll underneath it, push registration, and the banner that
 * announces a new alert over whichever screen is showing. One deterioration is one alert and
 * one banner, however many rules it tripped (`Flag.alertId`).
 */
export function NurseProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const theme = useScopedTheme();
  const insets = useSafeAreaInsets();
  const { setPushToken } = useSession();

  const [worklist, setWorklist] = useState<WorklistResponse | null>(null);
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [push, setPush] = useState<PushRegistration | null>(null);
  const [banners, setBanners] = useState<FlagAlert[]>([]);
  const [acknowledging, setAcknowledging] = useState(false);
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null);
  const [active, setActive] = useState(AppState.currentState === 'active');

  /** Ids of the flags and alerts this phone has already shown or been opened on. */
  const seen = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const loading = useRef<Promise<void> | null>(null);

  /** Announces alerts this phone has not shown yet. The ones open at launch are not news. */
  const announce = useCallback((open: Flag[]) => {
    const news = announcements(open, seen.current);
    seen.current = news.seen;
    if (!seeded.current) {
      seeded.current = true;
      return;
    }
    if (news.alerts.length > 0) setBanners((current) => [...current, ...news.alerts]);
  }, []);

  const refresh = useCallback((): Promise<void> => {
    // One request at a time: a refresh asked for while one is in the air shares its answer.
    loading.current ??= (async () => {
      try {
        const [nextWorklist, nextFlags] = await Promise.all([api.worklist(), api.openFlags()]);
        setWorklist(nextWorklist);
        setFlags(nextFlags.items);
        setFailure(null);
        announce(nextFlags.items);
        // A banner follows its alert: acknowledged elsewhere it says so, closed it goes away.
        setBanners((current) => followAlerts(current, nextFlags.items));
      } catch (error) {
        setFailure(errorMessage(error));
      } finally {
        loading.current = null;
        setNow(Date.now());
      }
    })();
    return loading.current;
  }, [announce]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => subscription.remove();
  }, []);

  // The poll. It runs whether or not the stream is open, only slower when it is.
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = setInterval(() => void refresh(), streaming ? POLL_LIVE_MS : POLL_MS);
    return () => clearInterval(timer);
  }, [active, streaming, refresh]);

  // The event stream, reopened with a growing pause for as long as the app is in front.
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let close: (() => void) | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const connect = () => {
      close = openEventStream({
        onOpen: () => {
          attempt = 0;
          setStreaming(true);
          // Events are not replayed: whatever happened while the stream was down is fetched.
          void refresh();
          setRevision((value) => value + 1);
        },
        onEvent: (event) => {
          // Once-a-second readings of a running sitting change nothing these screens show.
          if (event.type === 'reading' || event.type === 'live_changed') return;
          if (settle) return;
          settle = setTimeout(() => {
            settle = null;
            void refresh();
            setRevision((value) => value + 1);
          }, EVENT_SETTLE_MS);
        },
        onClose: () => {
          setStreaming(false);
          if (stopped) return;
          retry = setTimeout(connect, RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)]);
          attempt += 1;
        },
      });
    };
    connect();

    return () => {
      stopped = true;
      close?.();
      if (retry) clearTimeout(retry);
      if (settle) clearTimeout(settle);
      setStreaming(false);
    };
  }, [active, refresh]);

  // Registration is tried once per mount; setPushToken changes identity when the session does.
  const setPushTokenRef = useRef(setPushToken);
  useEffect(() => {
    setPushTokenRef.current = setPushToken;
  }, [setPushToken]);

  useEffect(() => {
    let mounted = true;
    showFlagsInApp();
    void registerForPush().then(async (registration) => {
      if (!mounted) return;
      setPush(registration);
      try {
        await setPushTokenRef.current(registration.available ? registration.token : null);
      } catch (error) {
        console.warn('The push token did not reach the server', error);
        if (mounted && registration.available) {
          setPush({ available: false, reason: 'The server did not accept this phone for push notifications' });
        }
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // A push that arrives while the app is open: the refresh finds the flag and announces it.
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      if (patientOfNotification(notification)) void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  // A tapped notification opens its patient, also when the tap is what started the app.
  const openedResponse = useRef<string | null>(null);
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse): string | null => {
      const id = response.notification.request.identifier;
      if (openedResponse.current === id) return null;
      openedResponse.current = id;
      Notifications.clearLastNotificationResponse();
      const target = patientOfNotification(response.notification);
      if (!target) return null;
      if (target.flagId) seen.current.add(target.flagId);
      router.push({ pathname: '/nurse/patient/[number]', params: { number: String(target.patientNumber) } });
      return target.flagId;
    };
    const launch = Notifications.getLastNotificationResponse();
    if (launch) open(launch);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const flagId = open(response);
      if (flagId) setBanners((current) => current.filter((alert) => !alert.flags.some((flag) => flag.id === flagId)));
    });
    return () => subscription.remove();
  }, [router]);

  const acknowledge = useCallback(
    async (flagId: string) => {
      const { flag } = await api.acknowledgeFlag(flagId);
      // The server acknowledged the whole alert; every list shows that before the refresh lands.
      setFlags((current) => (current ? withAcknowledgement(current, flag) : current));
      setBanners((current) => current.flatMap((alert) => flagAlerts(withAcknowledgement(alert.flags, flag))));
      setWorklist((current) =>
        current
          ? { ...current, items: current.items.map((item) => ({ ...item, flags: withAcknowledgement(item.flags, flag) })) }
          : current,
      );
      setRevision((value) => value + 1);
      void refresh();
    },
    [refresh],
  );

  const banner = banners[0] ?? null;
  const dismiss = useCallback(() => {
    setAcknowledgeError(null);
    setBanners((current) => current.slice(1));
  }, []);

  const acknowledgeBanner = async (alert: FlagAlert) => {
    const next = alert.waiting[0];
    if (!next) return;
    setAcknowledging(true);
    setAcknowledgeError(null);
    try {
      await acknowledge(next.id);
    } catch (error) {
      setAcknowledgeError(errorMessage(error));
    } finally {
      setAcknowledging(false);
    }
  };

  const connection: Connection = failure ? 'offline' : streaming ? 'live' : 'polling';
  const data = useMemo<NurseData>(
    () => ({ worklist, flags, failure, connection, revision, now, push, refresh, acknowledge }),
    [worklist, flags, failure, connection, revision, now, push, refresh, acknowledge],
  );

  return (
    <NurseContext.Provider value={data}>
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
              patient={banner.lead.patient}
              title={flagTitle(banner.lead.rule, banner.lead.patient)}
              time={clockTime(banner.lead.openedAt)}
              body={banner.lead.handoff}
              acknowledged={banner.acknowledgedAt != null}
              acknowledging={acknowledging}
              error={acknowledgeError}
              onAcknowledge={() => void acknowledgeBanner(banner)}
              onOpen={() => {
                dismiss();
                router.push({ pathname: '/nurse/patient/[number]', params: { number: String(banner.lead.patientNumber) } });
              }}
              onDismiss={dismiss}
            />
          </View>
        </View>
      ) : null}
    </NurseContext.Provider>
  );
}
