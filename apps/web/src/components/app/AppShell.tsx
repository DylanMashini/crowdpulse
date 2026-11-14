'use client';

import type { Device } from '@triagecam/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';

import { BrandLockup, SideNav, type SideNavGroup, type SideNavStation } from '@/components/ds';
import { StateMessage } from '@/components/ui/StateMessage';
import { api, errorMessage } from '@/lib/api';
import { useNow } from '@/lib/clock';
import { clockTime, dayTime } from '@/lib/format';
import { useResource } from '@/lib/use-resource';

import { LiveProvider, useLive, useLiveEvents, type LiveEvent } from './live';

/**
 * The rail's destinations, in the order a shift uses them. Labels, icons and paths live here and
 * nowhere else: relabel a destination by editing its row.
 */
const DESTINATIONS: SideNavGroup[] = [
  {
    id: 'triage',
    label: 'Triage',
    items: [
      { id: 'check-in', label: 'Check-in', icon: 'camera', href: '/check-in' },
      { id: 'waiting-room', label: 'Waiting room', icon: 'list', href: '/waiting-room' },
      { id: 'tickets', label: 'Tickets', icon: 'ticket', href: '/tickets' },
    ],
  },
  {
    id: 'station',
    label: 'Station',
    items: [
      { id: 'flag-settings', label: 'Flag settings', icon: 'sliders', href: '/flag-settings' },
      { id: 'statistics', label: 'Statistics', icon: 'chart', href: '/statistics' },
    ],
  },
];

/** Where the brand lockup leads. */
const HOME = '/waiting-room';

/** A camera phone that has not been heard from for this long is shown as offline. */
const ONLINE_WITHIN_MS = 2 * 60_000;
const DEVICES_REFRESH_MS = 30_000;
const DEVICE_EVENTS: ReadonlySet<LiveEvent['type']> = new Set(['live_changed', 'sitting_started', 'sitting_finished', 'reconnected']);

/** Below this width the rail starts as icons, so the worklist keeps its columns. */
const WIDE_QUERY = '(min-width: 1120px)';
const RAIL_KEY = 'triagecam.rail';

/** Everything behind sign-in: checks the session, then draws the navigation around the page. */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useResource('session', api.me);
  const signedOut = session.error?.code === 'unauthenticated';

  useEffect(() => {
    if (signedOut) router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [signedOut, router, pathname]);

  if (session.data) {
    return (
      <LiveProvider>
        <a
          href="#main"
          className="sr-only rounded-md bg-surface-raised px-3 py-2 font-medium text-ink shadow-overlay focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
        >
          Skip to content
        </a>
        <div className="min-h-screen md:flex">
          <Navigation pathname={pathname} email={session.data.user.email} />
          <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 outline-none md:p-6">
            <div className="mx-auto max-w-[1400px]">{children}</div>
          </main>
        </div>
      </LiveProvider>
    );
  }

  return (
    <main className="p-4 md:p-6">
      <BrandLockup className="mb-5" />
      {session.error && !signedOut ? (
        <StateMessage kind="error" title="The session could not be checked" onRetry={session.reload}>
          {session.error.message}
        </StateMessage>
      ) : (
        <StateMessage kind="loading" title={signedOut ? 'Going to sign in' : 'Checking the session'} />
      )}
    </main>
  );
}

function subscribeToWidth(notify: () => void): () => void {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

function readStoredRail(): 'collapsed' | 'expanded' | null {
  try {
    const stored = window.localStorage.getItem(RAIL_KEY);
    return stored === 'collapsed' || stored === 'expanded' ? stored : null;
  } catch {
    return null;
  }
}

/** The rail is collapsed when the nurse chose so, and by default on a window too narrow for both. */
function useRail(): { collapsed: boolean; toggle: () => void } {
  const wide = useSyncExternalStore(
    subscribeToWidth,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
  const [choice, setChoice] = useState(readStoredRail);
  const collapsed = choice ? choice === 'collapsed' : !wide;
  const toggle = useCallback(() => {
    const next = collapsed ? 'expanded' : 'collapsed';
    setChoice(next);
    try {
      window.localStorage.setItem(RAIL_KEY, next);
    } catch {
      // A private window can refuse storage. The choice then lasts for this page only.
    }
  }, [collapsed]);
  return { collapsed, toggle };
}

/** The camera phone the rail reports on: one showing live view, else the last one heard from. */
function stationDevice(devices: Device[] | undefined, serverNow: number): SideNavStation['device'] {
  if (!devices) return { label: 'Camera phone', detail: 'Checking', connected: false };
  const camera = devices
    .filter((device) => device.role === 'camera')
    .sort((a, b) => Number(b.liveAt !== null) - Number(a.liveAt !== null) || b.lastSeenAt.localeCompare(a.lastSeenAt))[0];
  if (!camera) return { label: 'No camera phone', detail: 'Sign in on a phone to add one', connected: false };
  if (camera.liveAt !== null) return { label: camera.label, detail: 'Live view on', connected: true };
  const silentMs = Math.max(0, serverNow - new Date(camera.lastSeenAt).getTime());
  if (silentMs < ONLINE_WITHIN_MS) return { label: camera.label, detail: 'Online', connected: true };
  // Within a day the clock time is the useful fact; after that only the date is.
  const since = silentMs < 24 * 60 * 60_000 ? clockTime(camera.lastSeenAt) : dayTime(camera.lastSeenAt).split(',')[0];
  return { label: camera.label, detail: `Offline since ${since}`, connected: false };
}

function Navigation({ pathname, email }: { pathname: string; email: string }) {
  const router = useRouter();
  const { status, worklist } = useLive();
  const rail = useRail();
  const now = useNow();
  const [signOut, setSignOut] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const devices = useResource('rail-devices', api.devices);
  const reloadDevices = devices.reload;
  useLiveEvents((event) => {
    if (DEVICE_EVENTS.has(event.type)) reloadDevices();
  });
  useEffect(() => {
    const refresh = setInterval(reloadDevices, DEVICES_REFRESH_MS);
    return () => clearInterval(refresh);
  }, [reloadDevices]);

  const items = worklist.data?.worklist.items;
  const groups = useMemo(() => {
    // What still waits for a nurse: trend and overdue flags nobody has acknowledged. The station
    // card gives the totals, so the chip says "new" to keep the two numbers apart.
    const unacknowledged = items?.filter((item) => item.flags.some((flag) => flag.acknowledgedAt === null)).length;
    const sitting = items?.some((item) => item.sittingInProgress);
    return DESTINATIONS.map((group) => ({
      ...group,
      items: group.items.map((item) => {
        if (item.id === 'waiting-room') return { ...item, alert: unacknowledged, alertWord: 'new', alertLabel: 'with an unacknowledged flag' };
        if (item.id === 'check-in' && sitting) return { ...item, live: 'Sitting in progress' };
        return item;
      }),
    }));
  }, [items]);
  const active = DESTINATIONS.flatMap((group) => group.items).find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  )?.id;

  const serverNow = (now || devices.updatedAt || 0) + (worklist.data?.serverOffsetMs ?? 0);
  const station: SideNavStation = {
    stream: status === 'open' ? 'live' : status,
    title: 'Waiting room',
    stats: items && [
      { id: 'waiting', label: 'waiting', value: items.length },
      { id: 'flagged', label: 'flagged', value: items.filter((item) => item.state === 'flag').length, tone: 'flag' },
      { id: 'overdue', label: 'overdue', value: items.filter((item) => item.state === 'overdue').length },
    ],
    statsHref: '/waiting-room',
    device: stationDevice(devices.data?.devices, serverNow),
    deviceHref: '/check-in',
  };

  const onSignOut = async () => {
    setSignOut({ busy: true, error: null });
    try {
      await api.signOut();
      router.replace('/sign-in');
    } catch (error) {
      setSignOut({ busy: false, error: errorMessage(error) });
    }
  };

  return (
    <SideNav
      groups={groups}
      active={active}
      homeHref={HOME}
      descriptor="Vitals station"
      station={station}
      account={{ name: email, note: 'Staff account', onSignOut, busy: signOut.busy, error: signOut.error }}
      collapsed={rail.collapsed}
      onToggleCollapsed={rail.toggle}
    />
  );
}
