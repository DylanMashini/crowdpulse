import {
  EXPOSURE_STUCK,
  EXPOSURE_STUCK_AFTER_SECONDS,
  HELD_READING_FOR_MS,
  heldReadingAge,
  isLowConfidence,
  LOWER_CONFIDENCE,
  LOWER_CONFIDENCE_DETAIL,
  type CaptureSource,
  type Estimate,
  type EstimateReason,
} from '@triagecam/contracts';
import type { CaptureSittingSummary, VariabilityReason, ViewfinderState } from 'triage-capture';

import { wholeNumber } from '../format.ts';

export type Vital = 'heartRate' | 'breathingRate';

const REASONS: Record<EstimateReason, string> = {
  warming_up: 'Collecting the first seconds of signal',
  awaiting_agreement: 'Waiting for three windows to agree',
  no_face: 'Face not in view',
  face_changed: 'A different face came into view, starting again',
  exposure_adjusting: 'Exposure is still adjusting',
  low_quality: 'Signal too weak. Keep still, more light',
  motion: 'Too much movement. Keep still',
  gaps: 'Too many frames were dropped',
  band_edge: 'At the edge of the range the camera can measure',
  no_chest: 'Chest not in view',
  no_frames: 'The camera stopped sending frames',
};

export function reasonText(reason: EstimateReason | null): string {
  return reason ? REASONS[reason] : REASONS.low_quality;
}

/**
 * What the viewfinder says in place of its usual sentence, when something else is called for.
 * The camera locks its exposure on a face within a second or two. When it has been trying for
 * `EXPOSURE_STUCK_AFTER_SECONDS` the face is too bright, too dark, or its red channel clips,
 * and it will go on trying until the light changes: the operator is told to change it.
 */
export function viewfinderHint(state: ViewfinderState, secondsInState: number): string | undefined {
  return state === 'locking' && secondsInState >= EXPOSURE_STUCK_AFTER_SECONDS ? `${EXPOSURE_STUCK}.` : undefined;
}

/** Where a live number comes from, for the line under it. */
export function liveSourceText(source: CaptureSource): string {
  switch (source) {
    case 'camera':
      return 'Camera, measured this second';
    case 'simulated':
      return 'Simulated signal, this second';
    case 'recording':
      return 'Recording, this second';
    case 'stub':
      return 'Stub script, not a measurement';
  }
}

/** The newest value a vital has had in this sitting, and the wall clock when it arrived. */
export type LastValid = { value: number; atMs: number };

export type ReadoutModel =
  | { state: 'valid'; value: string; foot: string }
  | { state: 'settling'; foot: string }
  | { state: 'none'; foot: string }
  /** The latest value of the sitting, kept in its box. `age` once it is no longer fresh: "8 s ago". */
  | { state: 'held'; value: string; age: string | null; foot: string };

/**
 * What a live Readout shows for one estimate. Once a vital has had a value in this sitting its
 * box holds the latest one for the rest of the run, with its age once it is no longer fresh and
 * the reason there is no fresh one underneath. The engine never repeats an old value, so the
 * held number comes from `lastValid`, which the screen keeps for each vital on its own and
 * empties when a sitting starts.
 */
export function readoutFor(
  estimate: Estimate | null,
  source: CaptureSource,
  lastValid: LastValid | null,
  nowMs: number,
): ReadoutModel {
  if (!estimate) return { state: 'settling', foot: 'Starts with the sitting' };
  if (estimate.state === 'valid' && estimate.value != null) {
    return { state: 'valid', value: wholeNumber(estimate.value), foot: liveSourceText(source) };
  }
  const settling = estimate.state === 'settling';
  const foot = settling
    ? reasonText(estimate.reason ?? 'awaiting_agreement')
    : reasonText(estimate.state === 'stale' ? 'no_frames' : estimate.reason);
  if (lastValid && nowMs - lastValid.atMs <= HELD_READING_FOR_MS) {
    return { state: 'held', value: wholeNumber(lastValid.value), age: heldReadingAge(nowMs - lastValid.atMs), foot };
  }
  return { state: settling ? 'settling' : 'none', foot };
}

/** Counts why readings were declined during a sitting, so the summary can name the main reason. */
export class ReasonTally {
  private readonly counts: Record<Vital, Map<EstimateReason, number>> = {
    heartRate: new Map(),
    breathingRate: new Map(),
  };

  add(vital: Vital, estimate: Estimate): void {
    if (estimate.state === 'valid' || !estimate.reason) return;
    const counts = this.counts[vital];
    counts.set(estimate.reason, (counts.get(estimate.reason) ?? 0) + 1);
  }

  /** The most frequent reason, or null when every reading was valid or none arrived. */
  main(vital: Vital): EstimateReason | null {
    let best: EstimateReason | null = null;
    let bestCount = 0;
    for (const [reason, count] of this.counts[vital]) {
      if (count > bestCount) {
        best = reason;
        bestCount = count;
      }
    }
    return best;
  }
}

export type SummaryItem = {
  key: 'heartRate' | 'breathingRate' | 'rmssd' | 'sdnn';
  label: string;
  icon: 'pulse' | 'breath';
  /** Null prints "No reading" with `reason`. */
  value: string | null;
  unit: string;
  reason: string | null;
  /** Says what kind of value this is when it is not the median of the sitting's readings. */
  note?: string;
  coverage: number;
  experimental: boolean;
};

const SUMMARY_REASONS: Partial<Record<EstimateReason, string>> = {
  warming_up: 'The sitting ended before a first reading',
  awaiting_agreement: 'Readings did not agree for long enough',
  no_face: 'Face not in view for most of the sitting',
  no_chest: 'Chest not in view for most of the sitting',
  motion: 'Too much movement during the sitting',
  no_frames: 'The camera stopped sending frames',
};

function summaryReason(reason: EstimateReason | null): string {
  if (!reason) return 'No reading passed the quality threshold';
  return SUMMARY_REASONS[reason] ?? reasonText(reason);
}

const VARIABILITY_REASONS: Record<VariabilityReason, string> = {
  no_heart_rate: 'Needs a pulse reading first',
  low_quality: 'Single beats could not be timed precisely enough',
  too_few_beats: 'Too few clean beats in this sitting to report',
  low_beat_coverage: 'Clean beats covered too little of the sitting',
};

/** The engine's reason in words. A build of the capture module from before it sent one gets the general line. */
function variabilityReason(reason: VariabilityReason | null | undefined): string {
  return (reason && VARIABILITY_REASONS[reason]) ?? 'The engine did not report beat-to-beat values';
}

/** The sitting gave a heart rate, and it is one the station will not use as a baseline or for a flag. */
export function hasLowConfidencePulse(summary: Pick<CaptureSittingSummary, 'heartRate' | 'heartRateConfidence'>): boolean {
  return summary.heartRate.value != null && isLowConfidence(summary.heartRateConfidence);
}

/** The four measurements of a finished sitting, in the order SittingSummary shows them. */
export function summaryItems(
  summary: CaptureSittingSummary,
  mainReasons: Record<Vital, EstimateReason | null>,
): SummaryItem[] {
  const value = (v: number | null) => (v == null ? null : wholeNumber(v));
  return [
    {
      key: 'heartRate',
      label: 'Heart rate',
      icon: 'pulse',
      value: value(summary.heartRate.value),
      unit: 'bpm',
      reason: summary.heartRate.value == null ? summaryReason(mainReasons.heartRate) : null,
      note: hasLowConfidencePulse(summary) ? `${LOWER_CONFIDENCE}. ${LOWER_CONFIDENCE_DETAIL}` : undefined,
      coverage: summary.heartRate.coverage,
      experimental: false,
    },
    {
      key: 'breathingRate',
      label: 'Breathing',
      icon: 'breath',
      value: value(summary.breathingRate.value),
      unit: 'per min',
      reason: summary.breathingRate.value == null ? summaryReason(mainReasons.breathingRate) : null,
      coverage: summary.breathingRate.coverage,
      experimental: false,
    },
    {
      key: 'rmssd',
      label: 'Variability, RMSSD',
      icon: 'pulse',
      value: value(summary.rmssd.value),
      unit: 'ms',
      reason: summary.rmssd.value == null ? variabilityReason(summary.rmssd.reason) : null,
      coverage: summary.rmssd.coverage,
      experimental: true,
    },
    {
      key: 'sdnn',
      label: 'Variability, SDNN',
      icon: 'pulse',
      value: value(summary.sdnn.value),
      unit: 'ms',
      reason: summary.sdnn.value == null ? variabilityReason(summary.sdnn.reason) : null,
      coverage: summary.sdnn.coverage,
      experimental: true,
    },
  ];
}
