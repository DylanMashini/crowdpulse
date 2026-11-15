import * as z from 'zod';

import { Id, Timestamp } from './common.ts';
import { LIVE_FRAME_HEADERS, LiveRegions } from './live.ts';
import { SittingSummary } from './signal.ts';
import { Reading } from './sittings.ts';

// The check-in page's own webcam standing in for a camera phone. The browser takes the phone's
// place on every existing route (devices, live state and commands, sittings, readings, finish);
// what it cannot do is run the capture module, so these routes do that part on the server:
// frames go up, and the outlines, the engine's readings and the summary come back.

/** Browser-side limits for webcam capture. */
export const WEBCAM = {
  /** Frames per second asked of the camera, and the engine's nominal rate for a webcam sitting. */
  fps: 30,
  maxLongSidePx: 640,
  /** High, because the pulse is measured on these frames; the live view's own frames are 0.5. */
  jpegQuality: 0.92,
  /** A frame body is at most this many bytes. */
  maxFrameBytes: 600_000,
  /** Frames on their way to the server at once. A frame taken while this many are is dropped and counted. */
  maxInFlight: 3,
  /** With no frame for this long the server closes the webcam's engine; a running sitting is not saved by it. */
  timeoutMs: 15_000,
  /** The camera has stopped when it delivers no frame for this long. */
  lostAfterMs: 3000,
} as const;

/** Headers of POST /api/webcam/:deviceId/frame, whose body is the JPEG itself (Content-Type image/jpeg). */
export const WEBCAM_FRAME_HEADERS = {
  /** When the frame was captured: the browser's clock, ms since the epoch, fractions allowed. Required. */
  capturedAt: LIVE_FRAME_HEADERS.capturedAt,
  /** Frames the browser has dropped since the camera opened. Cumulative. */
  dropped: 'x-frames-dropped',
  /** How many readings of the running sitting the browser already holds: the answer carries the ones after. */
  readingsAfter: 'x-readings-after',
} as const;

/**
 * What the server made of the frames so far. It describes the newest frame it has looked at,
 * which is a few frames behind the one this answers.
 */
export const PostWebcamFrameResponse = z.object({
  /** Dashboards reading this device's live stream. */
  viewers: z.int().nonnegative(),
  /** The outlines being measured on, as a phone reports them. Null until the first frame has been looked at. */
  outlines: LiveRegions.nullable(),
  facePresent: z.boolean(),
  /** False for the first second after the camera opens, while it finds its exposure. */
  exposureLocked: z.boolean(),
  /** The sitting the engine is running, once its first frame has been taken. */
  sittingId: Id.nullable(),
  /** That sitting's readings after the `x-readings-after` of the request, oldest first, ready to post. */
  readings: z.array(Reading).max(120),
});
export type PostWebcamFrameResponse = z.infer<typeof PostWebcamFrameResponse>;

/** `start` after POST /api/sittings, `finish` at 60 seconds or when staff end it, `abandon` to give it up. */
export const WebcamSittingRequest = z.object({
  action: z.enum(['start', 'finish', 'abandon']),
  sittingId: Id,
});
export type WebcamSittingRequest = z.infer<typeof WebcamSittingRequest>;

export const WebcamSittingResponse = z.object({
  /** For `finish`: the engine's summary, the body of the finish request. Null otherwise. */
  summary: SittingSummary.nullable(),
  /** For `finish`: the browser's clock at the last frame. */
  endedAt: Timestamp.nullable(),
});
export type WebcamSittingResponse = z.infer<typeof WebcamSittingResponse>;
