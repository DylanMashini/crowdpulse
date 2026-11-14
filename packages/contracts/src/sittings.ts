import * as z from 'zod';

import { Id, PatientNumber, Timestamp } from './common.ts';
import { BeatInterval, CaptureSource, Estimate, SittingSummary, SummaryValue } from './signal.ts';

export const SittingKind = z.enum(['check_in', 'recheck']);
export type SittingKind = z.infer<typeof SittingKind>;

/** One reading as the phone sends it, once per second while a sitting runs. */
export const Reading = z.object({
  /** Phone wall-clock time of the reading. The server adds the sitting's clockOffsetMs. */
  t: Timestamp,
  /** Milliseconds since the first frame of the sitting. */
  elapsedMs: z.int().nonnegative(),
  heartRate: Estimate,
  breathingRate: Estimate,
});
export type Reading = z.infer<typeof Reading>;

export const StartSittingRequest = z.object({
  patientNumber: PatientNumber,
  deviceId: Id,
  kind: SittingKind,
  source: CaptureSource,
  /** The phone's wall clock when the request is sent. The server stores serverNow - clientTime. */
  clientTime: Timestamp,
});
export type StartSittingRequest = z.infer<typeof StartSittingRequest>;

export const Sitting = z.object({
  id: Id,
  patientNumber: PatientNumber,
  deviceId: Id,
  kind: SittingKind,
  source: CaptureSource,
  /** Server clock. */
  startedAt: Timestamp,
  /** Null while the sitting runs. */
  endedAt: Timestamp.nullable(),
  /** Server clock minus phone clock at the start, in ms. Add it to a phone timestamp. */
  clockOffsetMs: z.int(),
  /** Null until the sitting is finished. */
  summary: z
    .object({
      durationSeconds: z.number().nonnegative(),
      heartRate: SummaryValue,
      breathingRate: SummaryValue,
      rmssd: SummaryValue,
      sdnn: SummaryValue,
      timeToFirstReadingSeconds: z.number().nonnegative().nullable(),
      longestDropoutSeconds: z.number().nonnegative(),
      frameCount: z.int().nonnegative(),
      droppedFrames: z.int().nonnegative(),
    })
    .nullable(),
});
export type Sitting = z.infer<typeof Sitting>;

export const StartSittingResponse = z.object({ sitting: Sitting, serverTime: Timestamp });
export type StartSittingResponse = z.infer<typeof StartSittingResponse>;

/** Normally one reading; up to 30 so the phone can catch up after a network gap. */
export const PostReadingsRequest = z.object({ readings: z.array(Reading).min(1).max(30) });
export type PostReadingsRequest = z.infer<typeof PostReadingsRequest>;
export const PostReadingsResponse = z.object({ accepted: z.int().nonnegative() });
export type PostReadingsResponse = z.infer<typeof PostReadingsResponse>;

export const FinishSittingRequest = z.object({
  /** Phone wall clock at the last frame. */
  endedAt: Timestamp,
  summary: SittingSummary,
});
export type FinishSittingRequest = z.infer<typeof FinishSittingRequest>;

/** A reading as stored: times are on the server clock. */
export const StoredReading = z.object({
  t: Timestamp,
  heartRate: Estimate,
  breathingRate: Estimate,
});
export type StoredReading = z.infer<typeof StoredReading>;

export const SittingResponse = z.object({ sitting: Sitting });
export type SittingResponse = z.infer<typeof SittingResponse>;

export const SittingDetailResponse = z.object({
  sitting: Sitting,
  readings: z.array(StoredReading),
  beatIntervals: z.array(BeatInterval),
});
export type SittingDetailResponse = z.infer<typeof SittingDetailResponse>;
