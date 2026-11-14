'use client';

import { PROTOTYPE_NOTICE } from '@triagecam/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { Button, SideNav, type SideNavItem } from '@/components/ds';
import { StateMessage } from '@/components/ui/StateMessage';
import { api, errorMessage } from '@/lib/api';
import { useResource } from '@/lib/use-resource';

import { LiveProvider, useLive } from './live';

const DESTINATIONS: SideNavItem[] = [
  { id: 'check-in', label: 'Check-in', icon: 'camera', href: '/check-in' },
  { id: 'waiting-room', label: 'Waiting room', icon: 'list', href: '/waiting-room' },
  { id: 'patients', label: 'Patients', icon: 'user', href: '/patients' },
  { id: 'flag-settings', label: 'Flag settings', icon: 'sliders', href: '/flag-settings' },
  { id: 'statistics', label: 'Statistics', icon: 'chart', href: '/statistics' },
];

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
        <div className="min-h-screen md:flex">
          <Navigation pathname={pathname} email={session.data.user.email} />
          <main className="min-w-0 flex-1 p-4 md:p-6">
            <div className="mx-auto max-w-[1400px]">{children}</div>
          </main>
        </div>
      </LiveProvider>
    );
  }

  return (
    <main className="p-4 md:p-6">
      <p className="mb-5 text-[16px] leading-[22px] font-semibold">Triage Cam</p>
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

function Navigation({ pathname, email }: { pathname: string; email: string }) {
  const router = useRouter();
  const { worklist } = useLive();
  const [signOut, setSignOut] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const needAttention = worklist.data?.worklist.items.filter((item) => item.state === 'flag' || item.state === 'overdue').length;
  const items = DESTINATIONS.map((item) =>
    item.id === 'waiting-room' ? { ...item, count: needAttention, countLabel: 'flagged or overdue' } : item,
  );
  const active = DESTINATIONS.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))?.id;

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
      items={items}
      active={active}
      footer={
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 md:flex-col md:items-start md:gap-2">
          <p className="type-caption text-ink-muted">{PROTOTYPE_NOTICE}</p>
          <div className="flex min-w-0 items-center gap-2 md:w-full md:flex-col md:items-start md:gap-1 md:border-t md:border-line md:pt-3">
            <p className="max-w-full truncate type-caption text-ink-muted" title={email}>
              {email}
            </p>
            <Button variant="quiet" onClick={onSignOut} disabled={signOut.busy} className="-ml-2 px-2">
              {signOut.busy ? 'Signing out' : 'Sign out'}
            </Button>
          </div>
          {signOut.error ? (
            <p role="alert" className="type-caption font-medium text-critical">
              {signOut.error}
            </p>
          ) : null}
        </div>
      }
    />
  );
}
