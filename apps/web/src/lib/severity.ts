import type { FlagRule, Score, TileState } from '@triagecam/contracts';

import type { Severity } from '@/components/ds/types';

/**
 * Which severity colour a patient is drawn in. A presentation layer over what the server sends
 * (design-system/README.md, Severity); the flag rules themselves are not touched.
 *
 * Urgent: an open score_rise flag, or a partial score of 3. Watch: any other trend flag, which
 * is an open baseline_shift flag. Everything else carries no severity colour: observed is the
 * stable grey, and overdue and no-reading have forms of their own.
 */
export function severityOf(state: TileState | null | undefined, score: Score | null | undefined, rules: readonly FlagRule[] = []): Severity | null {
  if (score === 3 || rules.includes('score_rise')) return 'urgent';
  if (state === 'flag' || rules.includes('baseline_shift')) return 'watch';
  return null;
}
