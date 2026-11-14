import type { FlagRule, Score, TileState } from '@triagecam/contracts';

import type { Severity } from '@/components/ds/types';

/**
 * Which severity colour a patient is drawn in. A presentation layer over what the server sends
 * (design-system/README.md, Severity); the flag rules themselves are not touched.
 *
 * Colour follows the flag rules: only a patient with an open trend flag carries one. Urgent: a
 * trend flag whose rules include score_rise, or whose patient scores 3. Watch: any other trend
 * flag, which is an open baseline_shift flag. Everything else carries no severity colour, a score
 * of 3 without a flag included: observed is the stable grey, overdue and no-reading have forms of
 * their own, and the score chip already prints the 3.
 */
export function severityOf(state: TileState | null | undefined, score: Score | null | undefined, rules: readonly FlagRule[] = []): Severity | null {
  const rising = rules.includes('score_rise');
  if (state !== 'flag' && !rising && !rules.includes('baseline_shift')) return null;
  return rising || score === 3 ? 'urgent' : 'watch';
}
