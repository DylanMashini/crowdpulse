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
  /** How many things here wait for the nurse. Drawn as a flag chip, and only above zero. */
  alert?: number;
  /** What the alert counts, for the tooltip and screen readers: "with an unacknowledged flag". */
  alertLabel?: string;
  /** One short word shown after the number, so it is not read as a total: "new". */
  alertWord?: string;
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
  /** `flag` colours the number while it is above zero. */
  tone?: 'flag';
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
    /** "Live view on", "Online", "Offline, seen 12 min ago". */
    detail: string;
    connected: boolean;
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
  /** One or two words under the product name. */
  descriptor?: string;
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

const hoverSurface = 'hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]';
const colours = 'transition-colors duration-[120ms] ease-out';

/**
 * The dashboard's navigation. On a desktop window it is a rail on the dark theme: brand, grouped
 * destinations, the station's state and the account. It collapses to icons, and on a narrow
 * window it becomes a bar across the top with the destinations in one scrolling row.
 */
export function SideNav({
  groups,
  active,
  homeHref = '/',
  descriptor,
  station,
  account,
  collapsed = false,
  onToggleCollapsed,
}: SideNavProps) {
  // The bar's row scrolls sideways: keep the current destination in view.
  const row = useRef<HTMLUListElement>(null);
  // Which rows carry a badge: a badge arriving changes the row's width, so centre again.
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
      <header data-theme="dark" className="border-b border-line bg-surface text-ink md:hidden">
        <div className="flex h-[56px] items-center justify-between gap-3 px-4">
          <Link href={homeHref} className="rounded-md">
            <BrandLockup descriptor={descriptor} />
          </Link>
          <div className="flex items-center gap-3">
            {station ? <StreamState stream={station.stream} /> : null}
            {account ? <AccountMenu account={account} compact placement="below" /> : null}
          </div>
        </div>
        <nav aria-label="Dashboard">
          <ul ref={row} className="relative flex gap-1 overflow-x-auto px-3 pt-[2px] pb-3">
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
        data-theme="dark"
        className={cx(
          'sticky top-0 z-30 flex h-screen flex-none flex-col border-r border-line bg-surface text-ink max-md:hidden',
          collapsed ? 'w-[60px]' : 'w-nav',
        )}
      >
        <div className={cx('flex flex-none items-center', collapsed ? 'flex-col gap-2 px-3 pt-3' : 'h-[60px] justify-between gap-2 pr-2 pl-4')}>
          <Link href={homeHref} className="min-w-0 rounded-md" aria-label={collapsed ? 'Triage Cam' : undefined}>
            {collapsed ? <BrandMark /> : <BrandLockup descriptor={descriptor} />}
          </Link>
          {onToggleCollapsed ? (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
              className={cx(
                'flex flex-none cursor-pointer items-center justify-center rounded-md text-ink-muted hover:text-ink',
                collapsed ? 'size-control-md' : 'size-[28px]',
                hoverSurface,
                colours,
              )}
            >
              <Icon name="panel" size={18} />
            </button>
          ) : null}
        </div>

        <div className={cx('flex min-h-0 flex-1 flex-col px-3 pb-3', collapsed ? 'gap-3 pt-3' : 'gap-5 overflow-y-auto pt-2')}>
          {groups.map((group, index) => (
            <div key={group.id} className={cx(collapsed && index > 0 && 'border-t border-line pt-3')}>
              {group.label ? (
                <p className={cx('px-2 pb-2 type-label text-ink-muted', collapsed && 'sr-only')}>{group.label}</p>
              ) : null}
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
  return (
    <Link
      href={item.href}
      aria-current={on ? 'page' : undefined}
      className={cx(
        'group relative flex h-control-md items-center gap-[10px] rounded-md text-[15px] leading-[22px] font-medium whitespace-nowrap',
        collapsed ? 'w-control-md justify-center' : 'px-2',
        on ? 'bg-surface-raised text-ink shadow-[inset_0_0_0_1px_var(--line)]' : cx('text-ink-muted hover:text-ink', hoverSurface),
        colours,
      )}
    >
      <Icon name={item.icon} size={18} className={on ? 'text-signal' : undefined} />
      <span className={collapsed ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{item.label}</span>

      {item.live ? (
        <span className={cx('flex items-center', collapsed && alert === null && 'absolute top-[5px] right-[5px]', collapsed && alert !== null && 'sr-only')}>
          <span className="block size-[6px] rounded-pill bg-signal" />
          <span className="sr-only">{item.live}</span>
        </span>
      ) : null}

      {alert !== null ? (
        collapsed ? (
          <span className="absolute top-[4px] right-[4px] block size-[8px] rounded-pill bg-flag shadow-[0_0_0_2px_var(--surface)]">
            <span className="sr-only">
              {alert} {item.alertLabel}
            </span>
          </span>
        ) : (
          <span className="flex h-[20px] min-w-[20px] items-center justify-center rounded-sm bg-flag-soft px-[6px] font-mono text-[12px] leading-[16px] font-semibold text-flag tabular-nums">
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
      className="pointer-events-none absolute top-1/2 left-full z-40 ml-3 -translate-y-1/2 rounded-md border border-line bg-surface-raised px-2 py-1 text-[13px] leading-[18px] font-medium whitespace-nowrap text-ink opacity-0 shadow-overlay transition-opacity duration-[120ms] ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
    >
      {children}
    </span>
  );
}

function StreamState({ stream }: { stream: SideNavStream }) {
  return (
    <span role="status" className={cx('flex items-center gap-[6px] type-label', stream === 'reconnecting' ? 'text-flag' : 'text-ink-muted')}>
      <span
        className={cx(
          'block size-[6px] rounded-pill',
          stream === 'live' && 'bg-signal',
          stream === 'reconnecting' && 'bg-flag',
          stream === 'connecting' && 'bg-line-strong',
        )}
      />
      {STREAM_WORD[stream]}
    </span>
  );
}

function DeviceDot({ connected, className }: { connected: boolean; className?: string }) {
  return (
    <span
      className={cx(
        'block size-[8px] flex-none rounded-pill',
        connected ? 'bg-signal' : 'shadow-[inset_0_0_0_1.5px_var(--line-strong)]',
        className,
      )}
    />
  );
}

function StationCard({ station }: { station: SideNavStation }) {
  const { device } = station;
  return (
    <div className="mx-3 mb-3 flex-none rounded-lg border border-line bg-surface-raised">
      <Link href={station.statsHref} className={cx('block rounded-t-lg p-3', hoverSurface, colours)}>
        <span className="flex items-center justify-between gap-2">
          <span className="type-label text-ink-muted">{station.title}</span>
          <StreamState stream={station.stream} />
        </span>
        {station.stats ? (
          <span className="mt-3 grid grid-cols-3 gap-2">
            {station.stats.map((stat) => (
              <span key={stat.id} className="flex min-w-0 flex-col">
                <span
                  className={cx(
                    'font-mono text-[20px] leading-[24px] font-semibold tabular-nums',
                    stat.tone === 'flag' && stat.value > 0 ? 'text-flag' : 'text-ink',
                  )}
                >
                  {stat.value}
                </span>
                <span className="truncate text-[12px] leading-[16px] text-ink-muted">{stat.label}</span>
              </span>
            ))}
          </span>
        ) : null}
      </Link>
      <Link href={station.deviceHref} className={cx('flex items-center gap-[10px] rounded-b-lg border-t border-line p-3', hoverSurface, colours)}>
        <Icon name="phone" size={18} className="text-ink-muted" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[16px] font-medium text-ink" title={device.label}>
            {device.label}
          </span>
          <span className="text-[12px] leading-[16px] text-ink-muted">{device.detail}</span>
        </span>
        <DeviceDot connected={device.connected} />
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
      <Link
        href={station.deviceHref}
        className={cx('group relative flex size-control-md items-center justify-center rounded-md text-ink-muted hover:text-ink', hoverSurface, colours)}
      >
        <Icon name="phone" size={18} />
        {dropped ? (
          <span className="absolute top-[4px] right-[4px] block size-[8px] rounded-pill bg-flag shadow-[0_0_0_2px_var(--surface)]" />
        ) : (
          <DeviceDot connected={device.connected} className="absolute top-[4px] right-[4px]" />
        )}
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
          'flex cursor-pointer items-center rounded-md text-left',
          compact ? 'size-[44px] justify-center' : 'h-[44px] w-full gap-[10px] px-2',
          open ? 'bg-[color-mix(in_srgb,var(--ink)_7%,transparent)]' : hoverSurface,
          colours,
        )}
      >
        <span className="flex size-[28px] flex-none items-center justify-center rounded-pill border border-line-strong text-[12px] leading-[16px] font-semibold text-ink">
          {initials(account.name)}
        </span>
        {compact ? null : (
          <>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] leading-[16px] font-medium text-ink">{account.name}</span>
              {account.note ? <span className="truncate text-[12px] leading-[16px] text-ink-muted">{account.note}</span> : null}
            </span>
            <Icon name="selector" size={16} className="text-ink-muted" />
          </>
        )}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className={cx(
            'absolute z-40 rounded-lg border border-line bg-surface-raised p-1 shadow-overlay',
            placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2',
            placement === 'below' ? 'right-0 w-[240px]' : compact ? 'left-0 w-[240px]' : 'right-0 left-0 min-w-[200px]',
          )}
        >
          <div className="px-2 pt-2 pb-3">
            <p className="text-[12px] leading-[16px] text-ink-muted">Signed in as</p>
            <p className="text-[13px] leading-[18px] font-medium break-all text-ink">{account.name}</p>
            {account.note ? <p className="mt-1 text-[12px] leading-[16px] text-ink-muted">{account.note}</p> : null}
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
                'flex h-control-md w-full items-center gap-[10px] rounded-md px-2 text-[14px] leading-[20px] font-medium text-ink',
                busy ? 'cursor-not-allowed opacity-45' : cx('cursor-pointer', hoverSurface),
                colours,
              )}
            >
              <Icon name="sign-out" size={18} className="text-ink-muted" />
              {busy ? 'Signing out' : 'Sign out'}
            </button>
          </div>
          {account.error ? (
            <p role="alert" className="px-2 pt-1 pb-2 text-[12px] leading-[16px] font-medium text-critical">
              {account.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
