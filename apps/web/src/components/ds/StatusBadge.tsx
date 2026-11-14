import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';
import { minutesAgo } from '@/lib/format';

import { Icon } from './Icon';
import type { Severity, TileState } from './types';

type Look = 'stable' | 'watch' | 'urgent' | 'overdue' | 'none';

// Each look differs in form as well as colour: a soft chip, a solid chip, an inverse chip, a dashed outline.
const LOOKS: Record<Look, string> = {
  stable: 'bg-stable-soft text-stable',
  watch: 'bg-watch-soft text-watch',
  urgent: 'bg-urgent text-on-urgent',
  overdue: 'bg-overdue text-on-overdue',
  none: 'border border-dashed border-line-strong text-ink-muted',
};

const TEXT: Record<TileState, (minutes?: number | null) => string> = {
  observed: (minutes) => (minutes == null ? 'Not yet observed' : `Observed ${minutesAgo(minutes)}`),
  flag: () => 'Trend flag',
  overdue: (minutes) => (minutes == null ? 'Overdue' : `Overdue, last seen ${minutesAgo(minutes)}`),
  'no-reading': () => 'No reading',
};

/** The state in a word or two. */
const BRIEF: Record<TileState, (minutes?: number | null) => string> = {
  observed: (minutes) => (minutes == null ? 'Not yet observed' : 'Observed'),
  flag: () => 'Trend flag',
  overdue: () => 'Overdue',
  'no-reading': () => 'No reading',
};

export interface StatusBadgeProps {
  state: TileState;
  /** For a trend flag: amber for watch, the solid red chip for urgent. Watch when left out. */
  severity?: Severity | null;
  /** Whole minutes since the last observation. */
  minutes?: number | null;
  /** Leaves out how long ago, for a table row that has its own column for it. */
  brief?: boolean;
  children?: ReactNode;
  className?: string;
}

/** The state of a waiting patient: a 22px chip with a dot and the words, in the severity colours. */
export function StatusBadge({ state, severity, minutes, brief, children, className }: StatusBadgeProps) {
  const look: Look = state === 'flag' ? (severity ?? 'watch') : state === 'observed' ? 'stable' : state === 'overdue' ? 'overdue' : 'none';
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-[6px] rounded-sm pr-2 pl-[7px] type-caption font-medium whitespace-nowrap', LOOKS[look], className)}>
      {look === 'overdue' ? <Icon name="clock" size={12} /> : look === 'none' ? null : <span aria-hidden className="size-[6px] flex-none rounded-pill bg-current" />}
      <span>{children ?? (brief ? BRIEF[state](minutes) : TEXT[state](minutes))}</span>
    </span>
  );
}
