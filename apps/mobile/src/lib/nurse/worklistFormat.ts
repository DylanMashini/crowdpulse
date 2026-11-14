import { isLowConfidence, LOWER_CONFIDENCE, LOWER_CONFIDENCE_REPEAT, patientLabel, timelineByAlert } from '@triagecam/contracts';
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

/**
 * The words inside a StatusBadge. `lowConfidence`: the latest sitting gave a pulse with lower
 * confidence, so a "no reading" state says that instead, as the dashboard does.
 */
export function statusText(state: TileState, minutes: number | null, lowConfidence = false): string {
  switch (state) {
    case 'flag':
      return 'Trend flag';
    case 'no-reading':
      return lowConfidence ? LOWER_CONFIDENCE_REPEAT : 'No reading';
    case 'overdue':
      return minutes != null ? `Overdue, last seen ${ageText(minutes)}` : 'Overdue';
    case 'observed':
      return minutes != null ? `Observed ${ageText(minutes)}` : 'Not yet observed';
  }
}

export type TrendText =
  /** The latest sitting gave no reading for this parameter. */
  | { kind: 'none' }
  /** The latest sitting gave this pulse with lower confidence. It is tagged and compared with nothing. */
  | { kind: 'lowConfidence'; now: string; tag: string }
  /**
   * `base` is "from 82 (+26)", "from 82" when unchanged, or null when there is no baseline.
   * `baseFrom` is set when the baseline is not the check-in's: "10:42 re-check".
   */
  | { kind: 'value'; now: string; base: string | null; baseFrom?: string };

/** A value against the patient's own baseline: the check-in's unless the trend says otherwise. */
export function trendText(trend: Trend): TrendText {
  if (trend.now == null) {
    return trend.lowConfidence != null
      ? { kind: 'lowConfidence', now: String(Math.round(trend.lowConfidence)), tag: LOWER_CONFIDENCE }
      : { kind: 'none' };
  }
  const now = Math.round(trend.now);
  if (trend.base == null) return { kind: 'value', now: String(now), base: null };
  const base = Math.round(trend.base);
  const delta = now - base;
  const change = delta === 0 ? '' : ` (${delta > 0 ? '+' : '−'}${Math.abs(delta)})`;
  const text = `from ${base}${change}`;
  return trend.baseAt
    ? { kind: 'value', now: String(now), base: text, baseFrom: `${clockTime(trend.baseAt)} re-check` }
    : { kind: 'value', now: String(now), base: text };
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
  /**
   * Set for sittings: null inside means "No reading" for that parameter. `pulseNote` qualifies
   * the pulse: "Lower confidence" for one that is in no score and no trend.
   */
  vitals: { pulse: string | null; pulseNote?: string; breathing: string | null; score: Score | null } | null;
  sourceLabel: string | null;
  note: string | null;
};

function timelineRow(entry: TimelineEntry, index: number): TimelineRow {
  const base = {
    key: `${entry.type}-${entry.at}-${index}`,
    time: clockTime(entry.at),
    state: 'observed' as TileState,
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
        vitals: measured
          ? {
              pulse: entry.heartRate != null ? wholeNumber(entry.heartRate) : null,
              ...(entry.heartRate != null && isLowConfidence(entry.heartRateConfidence) ? { pulseNote: LOWER_CONFIDENCE } : {}),
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
        ? { ...base, title: 'Re-check overdue', state: 'overdue', note: entry.handoff }
        : { ...base, title: 'Flag opened', state: 'flag', note: entry.handoff };
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
  return timelineByAlert(timeline).reverse().map(timelineRow);
}
