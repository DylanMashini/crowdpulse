import { Reading, SittingSummary, WEBCAM, WEBCAM_FRAME_PREFIX_BYTES } from "@triagecam/contracts";

import { ApiError } from "./http.ts";

// The two translations the webcam routes make, kept apart from the process that sits between
// them (webcam.ts): the request body into frames, and the engine's JSON into wire payloads.

export type WebcamFrame = { jpeg: Buffer; capturedAtMs: number };

const isJpeg = (bytes: Buffer) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;

/** Cuts the body of the frames route into its frames: a 12-byte prefix (capture time, length) before each JPEG. */
export function parseFrames(body: Buffer): WebcamFrame[] {
  const frames: WebcamFrame[] = [];
  let offset = 0;
  while (offset < body.byteLength) {
    if (offset + WEBCAM_FRAME_PREFIX_BYTES > body.byteLength) throw new ApiError("invalid_request", "The body ends inside a frame");
    const capturedAtMs = body.readDoubleLE(offset);
    const length = body.readUInt32LE(offset + 8);
    offset += WEBCAM_FRAME_PREFIX_BYTES;
    if (length > WEBCAM.maxFrameBytes) throw new ApiError("payload_too_large", "A webcam frame is at most 600 kB");
    if (offset + length > body.byteLength) throw new ApiError("invalid_request", "The body ends inside a frame");
    const jpeg = body.subarray(offset, offset + length);
    offset += length;
    if (!Number.isFinite(capturedAtMs) || capturedAtMs <= 0) throw new ApiError("invalid_request", "A frame has no capture time");
    if (!isJpeg(jpeg)) throw new ApiError("invalid_request", "A frame is not a JPEG image");
    frames.push({ jpeg, capturedAtMs });
  }
  if (frames.length === 0) throw new ApiError("invalid_request", "The body holds no frame");
  return frames;
}

export type EngineEstimate = { value?: number; state: string; reason?: string; quality: number; coverage: number; ageMs?: number };
export type EngineReading = { t: number; elapsed: number; heartRate: EngineEstimate; breathingRate: EngineEstimate };

// The engine leaves a nil out; the wire writes it as null. Capture-clock seconds are the
// browser's wall clock, so a frame time is a date.
const estimate = (from: EngineEstimate) => ({
  value: from.value ?? null,
  state: from.state,
  reason: from.reason ?? null,
  quality: from.quality,
  coverage: from.coverage,
  ageMs: from.ageMs ?? null,
});
export const wireReading = (from: EngineReading): Reading =>
  Reading.parse({
    t: new Date(Math.round(from.t * 1000)).toISOString(),
    elapsedMs: Math.max(0, Math.round(from.elapsed * 1000)),
    heartRate: estimate(from.heartRate),
    breathingRate: estimate(from.breathingRate),
  });

type EngineSummaryValue = { value?: number; coverage: number };
const summaryValue = (from: EngineSummaryValue) => ({ value: from.value ?? null, coverage: from.coverage });
export function wireSummary(from: Record<string, unknown>): SittingSummary {
  return SittingSummary.parse({
    ...from,
    heartRate: summaryValue(from.heartRate as EngineSummaryValue),
    breathingRate: summaryValue(from.breathingRate as EngineSummaryValue),
    rmssd: summaryValue(from.rmssd as EngineSummaryValue),
    sdnn: summaryValue(from.sdnn as EngineSummaryValue),
    timeToFirstReadingSeconds: from.timeToFirstReadingSeconds ?? null,
    heartRateConfidence: from.heartRateConfidence ?? null,
  });
}
