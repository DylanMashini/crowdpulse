import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agreement, median, pairReadings } from "./agreement.ts";

describe("pairReadings", () => {
  it("pairs each estimate with the nearest reference sample within 1.5 s", () => {
    const pairs = pairReadings(
      [
        { t: 1000, heartRate: 72 },
        { t: 2000, heartRate: 74 },
        { t: 9000, heartRate: 80 },
      ],
      [
        { t: 900, heartRate: 70 },
        { t: 2400, heartRate: 75 },
        { t: 6000, heartRate: 77 },
      ],
    );
    assert.deepEqual(pairs, [
      { estimate: 72, reference: 70 },
      { estimate: 74, reference: 75 },
    ]);
  });

  it("pairs nothing without reference samples", () => {
    assert.deepEqual(pairReadings([{ t: 0, heartRate: 70 }], []), []);
  });
});

describe("agreement", () => {
  it("reports mean absolute error, bias as estimate minus reference, and the share within 5 bpm", () => {
    const result = agreement([
      { estimate: 72, reference: 70 },
      { estimate: 68, reference: 70 },
      { estimate: 80, reference: 70 },
      { estimate: 75, reference: 70 },
    ]);
    assert.equal(result.pairedReadings, 4);
    assert.equal(result.meanAbsoluteErrorBpm, 4.75);
    assert.equal(result.biasBpm, 3.75);
    assert.equal(result.within5BpmShare, 0.75);
  });

  it("is null, never 0, with nothing under it", () => {
    assert.deepEqual(agreement([]), {
      pairedReadings: 0,
      meanAbsoluteErrorBpm: null,
      biasBpm: null,
      within5BpmShare: null,
    });
  });
});

describe("median", () => {
  it("takes the middle value, or the mean of the middle two", () => {
    assert.equal(median([9, 1, 5]), 5);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), null);
  });
});
