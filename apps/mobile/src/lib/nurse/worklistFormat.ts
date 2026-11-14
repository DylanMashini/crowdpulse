import { patientLabel, timelineByAlert } from '@triagecam/contracts';
import type {
  CaptureSource,
  FlagRule,
  Score,
  PatientDetailResponse,
  TileState,
  TimelineEntry,
  Trend,
  WorklistItem,
} from '@triagecam/contracts';

import { ageText, clockTime, wholeNumber } from '../format.ts';
import { type Severity, ruleSeverity } from './severity.ts';

/** The words inside a StatusBadge. */
export function statusText(state: TileState, minutes: number | null): string {
  switch (state) {
    case 'flag':
      return 'Trend flag';
    case 'no-reading':
      return 'No reading';
    case 'overdue':
      return minutes != null ? `Overdue, last seen ${ageText(minutes)}` : 'Overdue';
    case 'observed':
      return minutes != null ? `Observed ${ageText(minutes)}` : 'Not yet observed';
  }
}

export type TrendText =
  /** The latest sitting gave no reading for this parameter. */
  | { kind: 'none' }
  /** `base` is "from 82 (+26)", "from 82" when unchanged, or null when there is no baseline. */
  | { kind: 'value'; now: string; base: string | null };

/** A value against the patient's own check-in baseline. */
export function trendText(trend: Trend): TrendText {
  if (trend.now == null) return { kind: 'none' };
  const now = Math.round(trend.now);
  if (trend.base == null) return { kind: 'value', now: String(now), base: null };
  const base = Math.round(trend.base);
  const delta = now - base;
  const change = delta === 0 ? '' : ` (${delta > 0 ? '+' : '−'}${Math.abs(delta)})`;
  return { kind: 'value', now: String(now), base: `from ${base}${change}` };
}

/** The line under a card's badge: when the patient was last observed, in words. */
export function lastObservedText(item: Pick<WorklistItem, 'minutesSinceObserved' | 'sittingInProgress'>): string {
  const observed =
    item.minutesSinceObserved == null ? 'Not yet observed' : `Last observed ${ageText(item.minutesSinceObserved)}`;
  return item.sittingInProgress ? `${observed}, sitting in progress` : observed;
}

/** The caption beside a score chip. Never a full NEWS2 score. */
export function scoreCaption(parametersMeasured: number): string {
  return `${parametersMeasured} of 7 parameters`;
}

/** What to print in a tag for a sitting that did not come from the camera. Null for the camera. */
export function sourceLabel(source: CaptureSource | null): string | null {
  switch (source) {
    case 'simulated':
      return 'Simulated';
    case 'stub':
      return 'Stub, not measured';
    case 'recording':
      return 'Recording';
    default:
      return null;
  }
}

export function flagTitle(rule: FlagRule, patient: { number: number; name: string | null }): string {
  return `${rule === 'overdue' ? 'Overdue' : 'Trend flag'}: ${patientLabel(patient)}`;
}

/** "12 waiting, 2 flagged" for the worklist header. */
export function worklistSummary(items: Pick<WorklistItem, 'state'>[]): string {
  const flagged = items.filter((item) => item.state === 'flag').length;
  const waiting = `${items.length} waiting`;
  return flagged > 0 ? `${waiting}, ${flagged} flagged` : waiting;
}

export type TimelineRow = {
  key: string;
  /** Clock time, 24-hour. */
  time: string;
  title: string;
  state: TileState;
  /** How the row's mark and chip are drawn. A flag row takes it from every rule its alert tripped. */
  severity: Severity;
  /** Set for sittings: null inside means "No reading" for that parameter. */
  vitals: { pulse: string | null; breathing: string | null; score: Score | null } | null;
  sourceLabel: string | null;
  note: string | null;
};

function timelineRow(entry: TimelineEntry, index: number, alertRules: ReadonlyMap<string, FlagRule[]>): TimelineRow {
  const base = {
    key: `${entry.type}-${entry.at}-${index}`,
    time: clockTime(entry.at),
    state: 'observed' as TileState,
    severity: 'stable' as Severity,
    vitals: null,
    sourceLabel: null,
    note: null,
  };
  switch (entry.type) {
    case 'created':
      return { ...base, title: 'Patient created' };
    case 'sitting': {
      const measured = entry.heartRate != null || entry.breathingRate != null;
      return {
        ...base,
        title: entry.kind === 'check_in' ? 'Check-in sitting' : 'Re-check',
        state: measured ? 'observed' : 'no-reading',
        severity: measured ? 'stable' : 'none',
        vitals: measured
          ? {
              pulse: entry.heartRate != null ? wholeNumber(entry.heartRate) : null,
              breathing: entry.breathingRate != null ? wholeNumber(entry.breathingRate) : null,
              score: entry.score,
            }
          : null,
        sourceLabel: sourceLabel(entry.source),
        note: measured ? null : 'The sitting ended without a pulse or a breathing rate',
      };
    }
    case 'flag_opened':
      return entry.rule === 'overdue'
        ? { ...base, title: 'Re-check overdue', state: 'overdue', severity: 'overdue', note: entry.handoff }
        : {
            ...base,
            title: 'Flag opened',
            state: 'flag',
            severity: ruleSeverity(alertRules.get(entry.alertId) ?? [entry.rule]),
            note: entry.handoff,
          };
    case 'flag_acknowledged':
      return { ...base, title: 'Flag acknowledged' };
    case 'flag_closed':
      return { ...base, title: entry.rule === 'overdue' ? 'Overdue cleared' : 'Trend flag closed' };
    case 'discharged':
      return { ...base, title: 'Discharged' };
  }
}

/**
 * The patient's history for PatientTimeline: oldest first, with failed sittings kept. An alert
 * that tripped both trend rules opened once, so it is one "Flag opened" row, not two alike.
 */
export function timelineRows(timeline: PatientDetailResponse['timeline']): TimelineRow[] {
  // The rules of an alert are read before its entries are merged into one row.
  const alertRules = new Map<string, FlagRule[]>();
  for (const entry of timeline) {
    if (entry.type === 'flag_opened') alertRules.set(entry.alertId, [...(alertRules.get(entry.alertId) ?? []), entry.rule]);
  }
  return timelineByAlert(timeline)
    .reverse()
    .map((entry, index) => timelineRow(entry, index, alertRules));
}
