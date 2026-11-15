import * as z from 'zod';

import { Id, Timestamp } from './common.ts';
import { LiveRegions } from './live.ts';
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
  /** One frame is at most this many bytes. */
  maxFrameBytes: 600_000,
  /**
   * Frames waiting to go up. One request is in flight at a time and carries every frame taken
   * since the last, in order, so a slow link thickens the requests instead of reordering frames.
   * A frame taken while this many wait is dropped and counted.
   */
  maxQueuedFrames: 8,
  /** With no frame for this long the server closes the webcam's engine; a running sitting is not saved by it. */
  timeoutMs: 15_000,
  /** The camera has stopped when it delivers no frame for this long. */
  lostAfterMs: 3000,
} as const;

/** Bytes before each JPEG in the body of the frames route: Float64 capture time, Uint32 length, both little-endian. */
export const WEBCAM_FRAME_PREFIX_BYTES = 12;

/**
 * Headers of POST /api/webcam/:deviceId/frames. The body (Content-Type application/octet-stream)
 * is one or more frames in capture order, each a 12-byte prefix and then the JPEG: the capture
 * time as a little-endian Float64 (the browser's clock, ms since the epoch, fractions kept) and
 * the JPEG's byte length as a little-endian Uint32.
 */
export const WEBCAM_FRAME_HEADERS = {
  /** Frames the browser has dropped since the camera opened. Cumulative. */
  dropped: 'x-frames-dropped',
  /** How many readings of the running sitting the browser already holds: the answer carries the ones after. */
  readingsAfter: 'x-readings-after',
} as const;

/**
 * What the server made of the frames so far. It describes the newest frame it has looked at,
 * which is a few frames behind the ones this answers.
 */
export const PostWebcamFramesResponse = z.object({
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
export type PostWebcamFramesResponse = z.infer<typeof PostWebcamFramesResponse>;

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
  /**
   * For `finish`: every reading of the sitting, oldest first, so the last ones, made after the
   * final frames request was answered, are not lost. Post the ones not yet posted before finishing.
   */
  readings: z.array(Reading).max(600).default([]),
});
export type WebcamSittingResponse = z.infer<typeof WebcamSittingResponse>;
