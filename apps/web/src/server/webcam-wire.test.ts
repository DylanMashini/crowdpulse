import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PostReadingsRequest, WEBCAM_FRAME_PREFIX_BYTES } from "@triagecam/contracts";

import { ApiError } from "./http.ts";
import { parseFrames, wireReading, wireSummary } from "./webcam-wire.ts";

const JPEG = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);

function frame(capturedAtMs: number, jpeg: Buffer = JPEG): Buffer {
  const prefix = Buffer.alloc(WEBCAM_FRAME_PREFIX_BYTES);
  prefix.writeDoubleLE(capturedAtMs, 0);
  prefix.writeUInt32LE(jpeg.byteLength, 8);
  return Buffer.concat([prefix, jpeg]);
}

const refused = (body: Buffer, code: string) =>
  assert.throws(
    () => parseFrames(body),
    (error) => error instanceof ApiError && error.code === code,
  );

describe("the body of the webcam frames route", () => {
  it("is cut into its frames in order, with each capture time", () => {
    const frames = parseFrames(Buffer.concat([frame(1_794_728_373_720.5), frame(1_794_728_373_754.25)]));
    assert.deepEqual(frames.map((one) => one.capturedAtMs), [1_794_728_373_720.5, 1_794_728_373_754.25]);
    assert.ok(frames.every((one) => one.jpeg.equals(JPEG)));
  });

  it("is refused when empty, cut short, without a time, or not a JPEG", () => {
    refused(Buffer.alloc(0), "invalid_request");
    refused(frame(1000).subarray(0, 14), "invalid_request");
    refused(frame(1000).subarray(0, 5), "invalid_request");
    refused(frame(0), "invalid_request");
    refused(frame(Number.NaN), "invalid_request");
    refused(frame(1000, Buffer.from("not a picture")), "invalid_request");
  });
});

describe("what the engine says, as the wire carries it", () => {
  // The engine leaves a nil out of its JSON; the wire writes null.
  const settling = { state: "settling", reason: "warming_up", quality: 0, coverage: 0 };
  const valid = { value: 86.4, state: "valid", quality: 0.71, coverage: 0.5, ageMs: 0, provisional: true };

  it("a reading is one the readings route takes, timed on the browser's clock", () => {
    const reading = wireReading({ t: 1_794_728_373.7207, elapsed: 12.004, heartRate: valid, breathingRate: settling });
    assert.equal(reading.t, "2026-11-15T07:39:33.721Z");
    assert.equal(reading.elapsedMs, 12004);
    assert.deepEqual(reading.heartRate, { value: 86.4, state: "valid", reason: null, quality: 0.71, coverage: 0.5, ageMs: 0 });
    assert.deepEqual(reading.breathingRate, { value: null, state: "settling", reason: "warming_up", quality: 0, coverage: 0, ageMs: null });
    assert.equal(PostReadingsRequest.safeParse({ readings: [reading] }).success, true);
  });

  it("a reading the engine could not have made is refused, not passed on", () => {
    assert.throws(() => wireReading({ t: 1, elapsed: 1, heartRate: { ...valid, value: undefined }, breathingRate: settling }));
  });

  it("a summary keeps its numbers and writes what is missing as null", () => {
    const summary = wireSummary({
      durationSeconds: 60.09,
      frameCount: 1804,
      droppedFrames: 0,
      heartRate: { value: 86.77, coverage: 0.88 },
      breathingRate: { coverage: 0, reason: "no_chest" },
      rmssd: { coverage: 0 },
      sdnn: { coverage: 0 },
      beatIntervals: [{ tMs: 900, ms: 690 }],
      longestDropoutSeconds: 2,
      heartRateSource: "readings",
      heartRateConfidence: "normal",
    });
    assert.deepEqual(summary.heartRate, { value: 86.77, coverage: 0.88 });
    assert.deepEqual(summary.breathingRate, { value: null, coverage: 0 });
    assert.equal(summary.timeToFirstReadingSeconds, null);
    assert.equal(summary.heartRateConfidence, "normal");
    assert.equal("heartRateSource" in summary, false);
  });
});
