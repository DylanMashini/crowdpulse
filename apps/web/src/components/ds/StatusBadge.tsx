import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import { minutesAgo } from '@/lib/format';

import { Icon, type IconName } from './Icon';
import type { TileState } from './types';

const STATES: Record<TileState, { icon: IconName; className: string; text: (minutes?: number | null) => string }> = {
  observed: {
    icon: 'clock',
    className: 'pl-0 font-normal text-ink-muted',
    text: (minutes) => (minutes == null ? 'Not yet observed' : `Observed ${minutesAgo(minutes)}`),
  },
  flag: { icon: 'flag', className: 'border-flag bg-flag-soft text-flag', text: () => 'Trend flag' },
  overdue: {
    icon: 'clock',
    className: 'bg-overdue text-on-overdue',
    text: (minutes) => (minutes == null ? 'Overdue' : `Overdue, last seen ${minutesAgo(minutes)}`),
  },
  'no-reading': { icon: 'no-reading', className: 'border-dashed border-line-strong text-ink', text: () => 'No reading' },
};

export interface StatusBadgeProps {
  state: TileState;
  /** Whole minutes since the last observation. */
  minutes?: number | null;
  children?: ReactNode;
  className?: string;
}

/** The state of a waiting ticket: an icon, the words, and a form that differs for each state. */
export function StatusBadge({ state, minutes, children, className }: StatusBadgeProps) {
  const spec = STATES[state];
  return (
    <span
      className={cx(
        'inline-flex h-[26px] items-center gap-1 rounded-pill border border-transparent pr-[10px] pl-2 type-label whitespace-nowrap',
        spec.className,
        className,
      )}
    >
      <Icon name={spec.icon} size={16} />
      <span>{children ?? spec.text(minutes)}</span>
    </span>
  );
}
