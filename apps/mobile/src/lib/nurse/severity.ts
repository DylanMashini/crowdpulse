import type { FlagRule, Score, TileState } from '@triagecam/contracts';

/**
 * How a patient or a flag is drawn. It is presentation over what the server already sends
 * (`TileState`, the open flags' rules and the partial score) and decides nothing: the flag rules
 * and the ranking stay on the server.
 */
export type Severity = 'stable' | 'watch' | 'urgent' | 'overdue' | 'none';

/** A flag by the rules it tripped: a rising score is urgent, a change from check-in is watch. */
export function ruleSeverity(rules: readonly FlagRule[]): 'watch' | 'urgent' | 'overdue' {
  if (rules.includes('score_rise')) return 'urgent';
  if (rules.includes('baseline_shift')) return 'watch';
  return 'overdue';
}

/** One alert, from the rules of its flags. */
export function alertSeverity(alert: { flags: readonly { rule: FlagRule }[] }): 'watch' | 'urgent' | 'overdue' {
  return ruleSeverity(alert.flags.map((flag) => flag.rule));
}

/**
 * One waiting patient. The state comes first, so a patient the server has not flagged is never
 * drawn as flagged. Inside `flag`, an open score rise or a score of 3 is urgent and anything
 * else is watch.
 */
export function patientSeverity(patient: {
  state: TileState;
  score?: Score | null;
  flags?: readonly { rule: FlagRule; closedAt: string | null }[];
}): Severity {
  switch (patient.state) {
    case 'observed':
      return 'stable';
    case 'no-reading':
      return 'none';
    case 'overdue':
      return 'overdue';
    case 'flag': {
      const open = (patient.flags ?? []).filter((flag) => flag.closedAt == null).map((flag) => flag.rule);
      return open.includes('score_rise') || patient.score === 3 ? 'urgent' : 'watch';
    }
  }
}
