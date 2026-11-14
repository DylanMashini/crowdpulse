'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { cx } from '@/lib/cx';

import { BrandLockup, BrandMark } from './BrandMark';
import { Icon, type IconName } from './Icon';

export interface SideNavItem {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  /** How many things here wait for the nurse. A plain number, shown only above zero. */
  alert?: number;
  /** What the alert counts, for the tooltip and screen readers: "with an unacknowledged flag". */
  alertLabel?: string;
  /** One short word shown after the number, so it is not read as a total: "new". */
  alertWord?: string;
  /** The colour of the count: red when one of the patients counted is urgent, amber for a trend flag. */
  alertTone?: 'urgent' | 'watch';
  /** Set while something is running at the destination, as the words for it: "Sitting in progress". */
  live?: string;
}

export interface SideNavGroup {
  id: string;
  /** Left out for a group that needs no name. */
  label?: string;
  items: SideNavItem[];
}

export type SideNavStream = 'live' | 'connecting' | 'reconnecting';

export interface SideNavStat {
  id: string;
  label: string;
  value: number;
  /** Colours the number while it is above zero. */
  tone?: 'urgent' | 'watch';
}

export interface SideNavStation {
  /** State of the live connection every number on the dashboard arrives through. */
  stream: SideNavStream;
  /** Heading over the numbers. */
  title: string;
  /** Up to three numbers. Left out until they are known. */
  stats?: SideNavStat[];
  statsHref: string;
  device: {
    label: string;
    /** "Live view on", "Online", "Offline, last seen 12 min ago". */
    detail: string;
    connected: boolean;
    /** The camera is sending its picture now: the dot glows. */
    live?: boolean;
  };
  deviceHref: string;
}

export interface SideNavAccount {
  /** The signed-in person, as the product knows them. */
  name: string;
  /** A second line under the name: the clinic, the role or the session. */
  note?: string;
  onSignOut: () => void;
  busy?: boolean;
  error?: string | null;
}

export interface SideNavProps {
  groups: SideNavGroup[];
  active?: string;
  /** Where the brand lockup leads. */
  homeHref?: string;
  station?: SideNavStation;
  account?: SideNavAccount;
  /** Icons only. Applies to the rail; the narrow-window bar has one form. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const STREAM_WORD: Record<SideNavStream, string> = {
  live: 'Live',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
};

const TONE = { urgent: 'text-urgent', watch: 'text-watch' } as const;
const hover = 'transition-colors hover:bg-surface-2 hover:text-ink';

/**
 * The dashboard's navigation. On a desktop window it is a rail on the darkest surface: brand,
 * grouped destinations, the station's state and the account. It collapses to icons, and on a
 * narrow window it becomes a bar across the top with the destinations in one scrolling row.
 */
export function SideNav({ groups, active, homeHref = '/', station, account, collapsed = false, onToggleCollapsed }: SideNavProps) {
  // The bar's row scrolls sideways: keep the current destination in view.
  const row = useRef<HTMLUListElement>(null);
  // Which rows carry a count: a count arriving changes the row's width, so centre again.
  const badges = groups
    .flatMap((group) => group.items)
    .map((item) => `${item.alert || ''}:${item.live ? 1 : ''}`)
    .join();
  useEffect(() => {
    const centre = () => {
      const list = row.current;
      const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
      if (list && current) list.scrollLeft = current.offsetLeft - (list.clientWidth - current.offsetWidth) / 2;
    };
    centre();
    // Labels widen when the webfont arrives, which moves the end of the row.
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) centre();
    });
    return () => {
      cancelled = true;
    };
  }, [active, badges]);

  return (
    <>
      <header className="border-b border-line bg-surface-0 text-ink md:hidden">
        <div className="flex h-[48px] items-center justify-between gap-3 px-4">
          <Link href={homeHref} className="rounded-md">
            <BrandLockup />
          </Link>
          <div className="flex items-center gap-3">
            {station ? <StreamState stream={station.stream} /> : null}
            {account ? <AccountMenu account={account} compact placement="below" /> : null}
          </div>
        </div>
        <nav aria-label="Dashboard">
          <ul ref={row} className="relative flex gap-[2px] overflow-x-auto px-3 pb-2">
            {groups.flatMap((group) =>
              group.items.map((item) => (
                <li key={item.id} className="flex-none">
                  <NavLink item={item} on={item.id === active} collapsed={false} />
                </li>
              )),
            )}
          </ul>
        </nav>
      </header>

      <nav
        aria-label="Dashboard"
        className={cx('sticky top-0 z-30 flex h-screen flex-none flex-col border-r border-line bg-surface-0 text-ink max-md:hidden', collapsed ? 'w-[56px]' : 'w-nav')}
      >
        <div className={cx('flex flex-none items-center p-3', collapsed ? 'flex-col gap-2' : 'justify-between gap-2')}>
          <Link
            href={homeHref}
            className={cx('flex h-control-md min-w-0 items-center rounded-md', collapsed ? 'w-control-md justify-center' : 'px-2')}
            aria-label={collapsed ? 'Triage Cam' : undefined}
          >
            {collapsed ? <BrandMark /> : <BrandLockup />}
          </Link>
          {onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              className={cx('flex flex-none cursor-pointer items-center justify-center rounded-md text-ink-faint', collapsed ? 'size-control-md' : 'size-[28px]', hover)}
            >
              <Icon name="panel" />
            </button>
          ) : null}
        </div>

        <div className={cx('flex min-h-0 flex-1 flex-col px-3 pb-3', collapsed ? 'gap-3' : 'gap-4 overflow-y-auto pt-1')}>
          {groups.map((group, index) => (
            <div key={group.id} className={cx(collapsed && index > 0 && 'border-t border-line pt-3')}>
              {group.label ? <p className={cx('px-2 pb-[6px] type-caption text-ink-faint', collapsed && 'sr-only')}>{group.label}</p> : null}
              <ul className="flex flex-col gap-[2px]">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <NavLink item={item} on={item.id === active} collapsed={collapsed} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {station ? collapsed ? <StationButton station={station} /> : <StationCard station={station} /> : null}

        {account ? (
          <div className="flex-none border-t border-line p-2">
            <AccountMenu account={account} compact={collapsed} placement="above" />
          </div>
        ) : null}
      </nav>
    </>
  );
}

function NavLink({ item, on, collapsed }: { item: SideNavItem; on: boolean; collapsed: boolean }) {
  const alert = item.alert != null && item.alert > 0 ? item.alert : null;
  const tone = item.alertTone ? TONE[item.alertTone] : 'text-ink-faint';
  return (
    <Link
      href={item.href}
      aria-current={on ? 'page' : undefined}
      className={cx(
        'group relative flex h-nav-row items-center gap-[10px] rounded-md type-dense whitespace-nowrap',
        collapsed ? 'w-control-md justify-center' : 'px-2',
        // The current item is a surface step with a hairline along its top edge, and its icon in the accent.
        on ? 'bg-surface-3 text-ink shadow-[inset_0_1px_0_var(--line)]' : cx('text-ink-muted', hover),
      )}
    >
      <Icon name={item.icon} className={on ? 'text-signal' : undefined} />
      <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{item.label}</span>

      {item.live ? (
        <span className={cx('flex items-center', collapsed && alert === null && 'absolute top-1 right-1', collapsed && alert !== null && 'sr-only')}>
          <span className="block size-[6px] rounded-pill bg-signal glow-live" />
          <span className="sr-only">{item.live}</span>
        </span>
      ) : null}

      {alert !== null ? (
        collapsed ? (
          <span className={cx('absolute top-1 right-1 block size-[6px] rounded-pill bg-current', item.alertTone ? TONE[item.alertTone] : 'text-ink')}>
            <span className="sr-only">
              {alert} {item.alertLabel}
            </span>
          </span>
        ) : (
          <span className={cx('type-caption tabular-nums', tone)}>
            {alert}
            {item.alertWord ? ` ${item.alertWord}` : ''}
            {item.alertLabel ? <span className="sr-only"> {item.alertLabel}</span> : null}
          </span>
        )
      ) : null}

      {collapsed ? (
        <Tip>
          {item.label}
          {alert !== null ? `, ${alert} ${item.alertLabel ?? ''}`.trimEnd() : ''}
          {item.live ? `, ${item.live.toLowerCase()}` : ''}
        </Tip>
      ) : null}
    </Link>
  );
}

/** The name of an icon-only control, shown beside it on hover and on keyboard focus. */
function Tip({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-full z-40 ml-3 -translate-y-1/2 rounded-md border border-line-strong bg-surface-3 px-2 py-1 type-caption font-medium whitespace-nowrap text-ink opacity-0 shadow-overlay transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}

function StreamState({ stream }: { stream: SideNavStream }) {
  return (
    <span role="status" className={cx('flex items-center gap-[6px] type-caption', stream === 'reconnecting' ? 'text-watch' : 'text-ink-faint')}>
      <span
        className={cx(
          'block size-[6px] rounded-pill',
          stream === 'live' && 'bg-signal',
          stream === 'reconnecting' && 'bg-watch',
          stream === 'connecting' && 'bg-surface-4',
        )}
      />
      {STREAM_WORD[stream]}
    </span>
  );
}

function DeviceDot({ device, className }: { device: SideNavStation['device']; className?: string }) {
  return (
    <span
      className={cx(
        'block size-[6px] flex-none rounded-pill',
        device.connected ? 'bg-signal' : 'shadow-[inset_0_0_0_1.5px_var(--ink-faint)]',
        device.live && 'glow-live',
        className,
      )}
    />
  );
}

function StationCard({ station }: { station: SideNavStation }) {
  const { device } = station;
  return (
    <div className="mx-3 mb-3 flex-none rounded-md border border-line bg-surface-1">
      <Link href={station.statsHref} className="block rounded-t-md px-[10px] py-2 transition-colors hover:bg-surface-2">
        <span className="flex items-center justify-between gap-2">
          <span className="type-caption text-ink-muted">{station.title}</span>
          <StreamState stream={station.stream} />
        </span>
        {station.stats ? (
          <span className="mt-2 grid grid-cols-3 gap-2">
            {station.stats.map((stat) => (
              <span key={stat.id} className="flex min-w-0 flex-col">
                <span className={cx('font-mono text-[15px] leading-[20px] tabular-nums', stat.tone && stat.value > 0 ? TONE[stat.tone] : 'text-ink')}>{stat.value}</span>
                <span className="truncate type-caption text-ink-faint">{stat.label}</span>
              </span>
            ))}
          </span>
        ) : null}
      </Link>
      <Link href={station.deviceHref} className="flex items-start gap-2 rounded-b-md border-t border-line px-[10px] py-2 transition-colors hover:bg-surface-2">
        <DeviceDot device={device} className="mt-[7px]" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 type-label break-words text-ink" title={device.label}>
            {device.label}
          </span>
          <span className="type-caption text-ink-faint">{device.detail}</span>
        </span>
      </Link>
    </div>
  );
}

/** The station card reduced to one control for the collapsed rail. */
function StationButton({ station }: { station: SideNavStation }) {
  const { device } = station;
  const dropped = station.stream === 'reconnecting';
  return (
    <div className="flex flex-none justify-center pb-3">
      <Link href={station.deviceHref} className={cx('group relative flex size-control-md items-center justify-center rounded-md text-ink-muted', hover)}>
        <Icon name="phone" />
        {dropped ? <span className="absolute top-1 right-1 block size-[6px] rounded-pill bg-watch" /> : <DeviceDot device={device} className="absolute top-1 right-1" />}
        <span className="sr-only">
          {STREAM_WORD[station.stream]}. {device.label}: {device.detail}
        </span>
        <Tip>
          {dropped ? 'Reconnecting. ' : ''}
          {device.label}: {device.detail}
        </Tip>
      </Link>
    </div>
  );
}

function initials(name: string): string {
  const [first = '', second = ''] = (name.split('@')[0] ?? '').split(/[\s._-]+/).filter(Boolean);
  return ((first[0] ?? '?') + (second[0] ?? '')).toUpperCase();
}

function AccountMenu({ account, compact, placement }: { account: SideNavAccount; compact: boolean; placement: 'above' | 'below' }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // The menu stays up while sign-out runs, so its answer has somewhere to appear if it fails.
  const busy = account.busy === true;

  useEffect(() => {
    if (open) firstItem.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || busy) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, busy]);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        if (!busy && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={compact ? `Account, ${account.name}` : undefined}
        onClick={() => {
          if (!busy) setOpen((value) => !value);
        }}
        className={cx(
          'flex cursor-pointer items-center rounded-md text-left transition-colors',
          compact ? 'size-[40px] justify-center' : 'h-[40px] w-full gap-[10px] px-2',
          open ? 'bg-surface-3' : 'hover:bg-surface-2',
        )}
      >
        <span className="flex size-[24px] flex-none items-center justify-center rounded-pill border border-line-strong bg-surface-4 text-[10px] leading-[16px] font-medium text-ink-muted">
          {initials(account.name)}
        </span>
        {compact ? null : (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate type-caption font-medium text-ink">{account.name}</span>
              {account.note ? <span className="truncate type-caption text-ink-faint">{account.note}</span> : null}
            </span>
            <Icon name="selector" size={14} className="text-ink-faint" />
          </>
        )}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className={cx(
            'absolute z-40 rounded-lg border border-line-strong bg-surface-3 p-1 shadow-overlay',
            placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2',
            placement === 'below' ? 'right-0 w-[240px]' : compact ? 'left-0 w-[240px]' : 'right-0 left-0 min-w-[200px]',
          )}
        >
          <div className="px-2 pt-2 pb-3">
            <p className="type-caption text-ink-muted">Signed in as</p>
            <p className="type-label break-all text-ink">{account.name}</p>
            {account.note ? <p className="mt-1 type-caption text-ink-muted">{account.note}</p> : null}
          </div>
          <div className="border-t border-line pt-1">
            <button
              ref={firstItem}
              type="button"
              role="menuitem"
              // Not `disabled`: a disabled button drops focus to the page, which would close the menu.
              aria-disabled={busy || undefined}
              onClick={() => {
                if (!busy) account.onSignOut();
              }}
              className={cx(
                'flex h-control-md w-full items-center gap-[10px] rounded-md px-2 type-dense text-ink transition-colors',
                busy ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-surface-4',
              )}
            >
              <Icon name="sign-out" className="text-ink-muted" />
              {busy ? 'Signing out' : 'Sign out'}
            </button>
          </div>
          {account.error ? (
            <p role="alert" className="px-2 pt-1 pb-2 type-caption text-urgent">
              {account.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
