import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { heartRateConfidence, trustedHeartRate } from "./serialize.ts";

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
