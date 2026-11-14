import Link from 'next/link';
import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

import { Icon, type IconName } from './Icon';

export interface SideNavItem {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  /** A plain number after the label. */
  count?: number;
  /** What the count counts, for screen readers. */
  countLabel?: string;
}

export interface SideNavProps {
  items: SideNavItem[];
  active?: string;
  title?: string;
  footer?: ReactNode;
}

/**
 * The dashboard's navigation: a rail at nav-width on a desktop window, and a bar across the top
 * with the destinations in one scrolling row when the window is narrow.
 */
export function SideNav({ items, active, title = 'Triage Cam', footer }: SideNavProps) {
  return (
    <nav
      aria-label="Dashboard"
      className="flex flex-none flex-col gap-3 border-line bg-surface-raised px-3 py-3 max-md:border-b md:sticky md:top-0 md:h-screen md:w-nav md:gap-4 md:overflow-y-auto md:border-r md:py-4"
    >
      <div className="px-2 text-[16px] leading-[22px] font-semibold">{title}</div>
      <ul className="flex gap-[2px] max-md:overflow-x-auto max-md:p-[4px] md:flex-col">
        {items.map((item) => {
          const on = item.id === active;
          return (
            <li key={item.id} className="flex-none">
              <Link
                href={item.href}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'flex h-control-md w-full items-center gap-3 rounded-md px-2 whitespace-nowrap transition-colors duration-[120ms] ease-out',
                  on ? 'bg-signal-soft font-semibold text-ink' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
                )}
              >
                <Icon name={item.icon} size={18} className={on ? 'text-signal' : undefined} />
                <span className="flex-1">{item.label}</span>
                {item.count != null ? (
                  <span className="text-[13px] font-medium text-ink tabular-nums">
                    {item.count}
                    {item.countLabel ? <span className="sr-only"> {item.countLabel}</span> : null}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {footer ? <div className="px-2 md:mt-auto">{footer}</div> : null}
    </nav>
  );
}
