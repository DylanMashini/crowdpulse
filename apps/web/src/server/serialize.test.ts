import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { heartRateConfidence, storedVitals, trustedHeartRate } from "./serialize.ts";

describe("a sitting's heart rate and its confidence", () => {
  it("is normal unless the phone said low, including for sittings stored before the column existed", () => {
    assert.equal(heartRateConfidence({ heartRate: 72, heartRateConfidence: "normal" }), "normal");
    assert.equal(heartRateConfidence({ heartRate: 72, heartRateConfidence: null }), "normal");
    assert.equal(heartRateConfidence({ heartRate: 101.5, heartRateConfidence: "low" }), "low");
  });

  it("has no confidence without a heart rate", () => {
    assert.equal(heartRateConfidence({ heartRate: null, heartRateConfidence: null }), null);
    assert.equal(heartRateConfidence({ heartRate: null, heartRateConfidence: "low" }), null);
  });

  it("keeps a lower-confidence rate out of what trends and statistics use", () => {
    assert.equal(trustedHeartRate({ heartRate: 72, heartRateConfidence: "normal" }), 72);
    assert.equal(trustedHeartRate({ heartRate: 72, heartRateConfidence: null }), 72);
    assert.equal(trustedHeartRate({ heartRate: 101.5, heartRateConfidence: "low" }), null);
    assert.equal(trustedHeartRate({ heartRate: null, heartRateConfidence: null }), null);
  });
});

describe("what a finished sitting stores for its two vitals", () => {
  const none = { value: null, coverage: 0 };
  const summary = (heartRate: number | null, breathingRate: number | null, coverage = 0.8, confidence?: "normal" | "low") => ({
    durationSeconds: 60,
    heartRate: { value: heartRate, coverage: heartRate === null ? 0 : coverage },
    breathingRate: breathingRate === null ? none : { value: breathingRate, coverage: 0.4 },
    ...(confidence ? { heartRateConfidence: confidence } : {}),
  });
  const shownHeart = [null, null, 70, 74, 80, null];
  const shownBreath = [null, 15, 17, null];
  const nothing = [null, null, null];

  it("stores a recorded summary as it came, for either kind", () => {
    for (const kind of ["check_in", "recheck"] as const) {
      assert.deepEqual(storedVitals(kind, summary(72, 16), { heartRate: shownHeart, breathingRate: shownBreath }), {
        heartRate: 72,
        heartRateConfidence: "normal",
        heartRateFromLive: false,
        breathingRate: 16,
        breathingRateFromLive: false,
      });
    }
  });

  it("gives a check-in the median of the readings shown live when nothing was recorded", () => {
    assert.deepEqual(storedVitals("check_in", summary(null, null), { heartRate: shownHeart, breathingRate: shownBreath }), {
      heartRate: 74,
      heartRateConfidence: "normal",
      heartRateFromLive: true,
      breathingRate: 16,
      breathingRateFromLive: true,
    });
  });

  it("handles each vital on its own: one with nothing shown does not block the other", () => {
    const heartOnly = storedVitals("check_in", summary(null, null), { heartRate: [71], breathingRate: nothing });
    assert.deepEqual([heartOnly.heartRate, heartOnly.heartRateFromLive, heartOnly.breathingRate, heartOnly.breathingRateFromLive], [71, true, null, false]);
    const breathOnly = storedVitals("check_in", summary(null, null), { heartRate: nothing, breathingRate: [18] });
    assert.deepEqual([breathOnly.heartRate, breathOnly.heartRateConfidence, breathOnly.breathingRate, breathOnly.breathingRateFromLive], [null, null, 18, true]);
    const recordedBreath = storedVitals("check_in", summary(null, 14), { heartRate: [71, 73], breathingRate: [20] });
    assert.deepEqual([recordedBreath.heartRate, recordedBreath.breathingRate, recordedBreath.breathingRateFromLive], [72, 14, false]);
  });

  it("replaces a lower-confidence check-in pulse with the live median only when something was shown", () => {
    const replaced = storedVitals("check_in", summary(101.5, null, 0.05, "low"), { heartRate: shownHeart, breathingRate: nothing });
    assert.deepEqual([replaced.heartRate, replaced.heartRateConfidence, replaced.heartRateFromLive], [74, "normal", true]);
    const kept = storedVitals("check_in", summary(101.5, null, 0.05, "low"), { heartRate: nothing, breathingRate: nothing });
    assert.deepEqual([kept.heartRate, kept.heartRateConfidence, kept.heartRateFromLive], [101.5, "low", false]);
  });

  it("never makes up a value, and leaves a re-check alone", () => {
    const empty = storedVitals("check_in", summary(null, null), { heartRate: nothing, breathingRate: [] });
    assert.deepEqual([empty.heartRate, empty.breathingRate, empty.heartRateFromLive, empty.breathingRateFromLive], [null, null, false, false]);
    const recheck = storedVitals("recheck", summary(null, null), { heartRate: shownHeart, breathingRate: shownBreath });
    assert.deepEqual([recheck.heartRate, recheck.breathingRate, recheck.heartRateFromLive, recheck.breathingRateFromLive], [null, null, false, false]);
    const weak = storedVitals("recheck", summary(70, null, 9 / 60), { heartRate: shownHeart, breathingRate: nothing });
    assert.deepEqual([weak.heartRate, weak.heartRateConfidence, weak.heartRateFromLive], [70, "low", false]);
  });
});
