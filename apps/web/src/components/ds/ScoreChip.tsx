import { cx } from '@/lib/cx';

import type { ScoreValue } from './types';

// Only 3 is a solid fill.
const FILLS: Record<ScoreValue, string> = {
  0: 'bg-score-0 text-on-score-0',
  1: 'bg-score-1 text-on-score-1',
  2: 'bg-score-2 text-on-score-2',
  3: 'bg-score-3 text-on-score-3',
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
      <span aria-label={`Partial score ${score}`} className={cx('inline-grid size-[22px] place-items-center rounded-sm type-caption font-medium tabular-nums', FILLS[score])}>
        {score}
      </span>
      {caption ? <span className="type-caption text-ink-faint">{measured} of 7 parameters</span> : null}
    </span>
  );
}
