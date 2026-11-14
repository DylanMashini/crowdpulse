import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { confidenceFromCosine, decideMatch, MATCH_COSINE } from "./confidence.ts";

describe("confidenceFromCosine", () => {
  it("maps the match threshold to 0.8 and stays within 0 to 1", () => {
    assert.equal(confidenceFromCosine(-0.4), 0);
    assert.equal(confidenceFromCosine(MATCH_COSINE), 0.8);
    assert.equal(confidenceFromCosine(1), 1);
    assert.equal(confidenceFromCosine(1.0001), 1);
  });

  it("rises with similarity", () => {
    const values = [0, 0.1, 0.3, 0.5, 0.65, 0.8, 1].map(confidenceFromCosine);
    assert.deepEqual(values, [...values].sort((a, b) => a - b));
  });
});

describe("decideMatch", () => {
  it("names the patient when the best candidate is confident and clearly ahead", () => {
    const result = decideMatch(
      [
        { patientNumber: 3, cosine: 0.1 },
        { patientNumber: 7, cosine: 0.71 },
      ],
      0.8,
    );
    assert.equal(result.outcome, "matched");
    assert.equal(result.patientNumber, 7);
    assert.ok(result.confidence !== null && result.confidence >= 0.8);
  });

  it("refuses below the threshold without naming the guess", () => {
    const result = decideMatch([{ patientNumber: 7, cosine: 0.3 }], 0.8);
    assert.equal(result.outcome, "low_confidence");
    assert.equal(result.patientNumber, null);
    assert.ok(result.confidence !== null && result.confidence < 0.8);
  });

  it("refuses when two patients are nearly as likely", () => {
    const result = decideMatch(
      [
        { patientNumber: 7, cosine: 0.62 },
        { patientNumber: 9, cosine: 0.6 },
      ],
      0.8,
    );
    assert.equal(result.outcome, "low_confidence");
    assert.equal(result.patientNumber, null);
  });

  it("is no_match when nobody resembles the crop or nobody is enrolled", () => {
    const none = { outcome: "no_match", patientNumber: null, confidence: null };
    assert.deepEqual(decideMatch([{ patientNumber: 7, cosine: 0.05 }], 0.8), none);
    assert.deepEqual(decideMatch([], 0.8), none);
  });

  it("follows the configured threshold", () => {
    assert.equal(decideMatch([{ patientNumber: 7, cosine: 0.6 }], 0.95).outcome, "low_confidence");
    assert.equal(decideMatch([{ patientNumber: 7, cosine: 0.6 }], 0.8).outcome, "matched");
    assert.equal(decideMatch([{ patientNumber: 7, cosine: 0.4 }], 0.8).outcome, "low_confidence");
  });
});
