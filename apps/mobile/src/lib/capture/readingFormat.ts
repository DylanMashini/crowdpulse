import {
  isLowConfidence,
  LOWER_CONFIDENCE,
  LOWER_CONFIDENCE_DETAIL,
  type CaptureSource,
  type Estimate,
  type EstimateReason,
} from '@triagecam/contracts';
import type { CaptureSittingSummary, VariabilityReason } from 'triage-capture';

import { wholeNumber } from '../format.ts';

export type Vital = 'heartRate' | 'breathingRate';

const REASONS: Record<EstimateReason, string> = {
  warming_up: 'Collecting the first seconds of signal',
  awaiting_agreement: 'Waiting for three windows to agree',
  no_face: 'Face not in view',
  face_changed: 'A different face came into view, starting again',
  exposure_adjusting: 'Exposure is still adjusting',
  low_quality: 'Signal quality too low',
  motion: 'Too much movement',
  gaps: 'Too many frames were dropped',
  band_edge: 'At the edge of the range the camera can measure',
  no_chest: 'Chest not in view',
  no_frames: 'The camera stopped sending frames',
};

export function reasonText(reason: EstimateReason | null): string {
  return reason ? REASONS[reason] : REASONS.low_quality;
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

/** How long a struck-through value may stay on screen once frames stop. */
export const STALE_BLANK_AFTER_MS = 10_000;

export type LastValid = { value: number; atMs: number };

export type ReadoutModel =
  | { state: 'valid'; value: string; foot: string }
  | { state: 'settling'; foot: string }
  | { state: 'none'; foot: string }
  /** The last accepted value, struck through, with its age. */
  | { state: 'stale'; value: string; foot: string };

/**
 * What a live Readout shows for one estimate. The engine never repeats an old value, so the
 * struck-through number in the stale state comes from `lastValid`, which the screen keeps, and
 * it is blanked after STALE_BLANK_AFTER_MS.
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
  if (estimate.state === 'settling') return { state: 'settling', foot: reasonText(estimate.reason ?? 'awaiting_agreement') };
  if (estimate.state === 'stale') {
    const age = lastValid ? nowMs - lastValid.atMs : null;
    if (lastValid && age !== null && age < STALE_BLANK_AFTER_MS) {
      const seconds = Math.max(1, Math.round(age / 1000));
      return { state: 'stale', value: wholeNumber(lastValid.value), foot: `Stale, last reading ${seconds} s ago` };
    }
    return { state: 'none', foot: reasonText('no_frames') };
  }
  return { state: 'none', foot: reasonText(estimate.reason) };
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
      unit: 'breaths per min',
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
