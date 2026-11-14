import { cx } from '@/lib/cx';

import type { ScoreValue } from './types';

const FILLS: Record<ScoreValue, string> = {
  0: 'bg-score-0 text-ink shadow-[inset_0_0_0_1px_var(--line-strong)]',
  1: 'bg-score-1 text-ink',
  2: 'bg-score-2 text-on-score-2',
  3: 'bg-score-3 text-on-critical',
};

export interface ScoreChipProps {
  score: ScoreValue;
  /** How many of the seven NEWS2 parameters the score rests on. */
  measured?: number;
  caption?: boolean;
}

/** The partial score. It always prints the digit, and by default how little it is based on. */
export function ScoreChip({ score, measured = 2, caption = true }: ScoreChipProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-label={`Partial score ${score}`}
        className={cx('inline-grid size-[28px] place-items-center rounded-sm font-mono text-[15px] font-semibold', FILLS[score])}
      >
        {score}
      </span>
      {caption ? <span className="text-[13px] text-ink-muted">{measured} of 7 parameters</span> : null}
    </span>
  );
}
