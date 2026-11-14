import * as z from 'zod';

import { Unit } from './common.ts';

// Mirrors packages/signal-engine/Sources/SignalEngine. Field names and enum strings are the
// same on both sides; change them together.

export const RegionColor = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
});
export type RegionColor = z.infer<typeof RegionColor>;

export const ExposureState = z.enum(['adjusting', 'locked']);
export type ExposureState = z.infer<typeof ExposureState>;

/** One line of a sitting file after the header. A missing key and null mean the same. */
export const FrameRecord = z.object({
  t: z.number(),
  facePresent: z.boolean(),
  forehead: RegionColor.nullish(),
  leftCheek: RegionColor.nullish(),
  rightCheek: RegionColor.nullish(),
  chestMotion: z.number().nullish(),
  exposure: ExposureState,
  droppedFrames: z.int().nonnegative(),
  faceTrackId: z.int().nullish(),
});
export type FrameRecord = z.infer<typeof FrameRecord>;

/** Where a sitting's frames came from. `stub` is the JavaScript stand-in for the native module. */
export const CaptureSource = z.enum(['camera', 'simulated', 'stub', 'recording']);
export type CaptureSource = z.infer<typeof CaptureSource>;

/** Line 1 of a sitting file. */
export const SittingFileHeader = z.object({
  format: z.literal('triagecam.sitting'),
  version: z.literal(1),
  sittingId: z.string().nullish(),
  source: z.enum(['camera', 'simulated']),
  nominalFrameRate: z.number().positive(),
  startedAt: z.string(),
  captureStart: z.number(),
  note: z.string().nullish(),
});
export type SittingFileHeader = z.infer<typeof SittingFileHeader>;

export const EstimateState = z.enum(['settling', 'valid', 'none', 'stale']);
export type EstimateState = z.infer<typeof EstimateState>;

export const EstimateReason = z.enum([
  'warming_up',
  'awaiting_agreement',
  'no_face',
  'face_changed',
  'exposure_adjusting',
  'low_quality',
  'motion',
  'gaps',
  'band_edge',
  'no_chest',
  'no_frames',
]);
export type EstimateReason = z.infer<typeof EstimateReason>;

/** One vital sign at one moment. `value` is set if and only if `state` is valid. */
export const Estimate = z
  .object({
    /** bpm for heart rate, breaths per minute for breathing rate. */
    value: z.number().positive().nullable(),
    state: EstimateState,
    reason: EstimateReason.nullable(),
    quality: Unit,
    coverage: Unit,
    /** Milliseconds since this estimate was last valid; 0 while valid; null if never valid. */
    ageMs: z.int().nonnegative().nullable(),
  })
  .refine((e) => (e.state === 'valid') === (e.value !== null), {
    message: 'value is set if and only if state is valid',
  });
export type Estimate = z.infer<typeof Estimate>;

export const SummaryValue = z.object({
  value: z.number().positive().nullable(),
  coverage: Unit,
});
export type SummaryValue = z.infer<typeof SummaryValue>;

export const BeatInterval = z.object({
  /** Milliseconds from the first frame of the sitting to the beat that ends the interval. */
  tMs: z.number().nonnegative(),
  /** Interval length in milliseconds. */
  ms: z.number().positive(),
});
export type BeatInterval = z.infer<typeof BeatInterval>;

/** What SignalEngine.finish() returns, unchanged. */
export const SittingSummary = z.object({
  durationSeconds: z.number().nonnegative(),
  frameCount: z.int().nonnegative(),
  droppedFrames: z.int().nonnegative(),
  heartRate: SummaryValue,
  breathingRate: SummaryValue,
  rmssd: SummaryValue,
  sdnn: SummaryValue,
  beatIntervals: z.array(BeatInterval).max(600),
  timeToFirstReadingSeconds: z.number().nonnegative().nullable(),
  longestDropoutSeconds: z.number().nonnegative(),
});
export type SittingSummary = z.infer<typeof SittingSummary>;
