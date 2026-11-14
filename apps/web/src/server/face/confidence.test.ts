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
  it("names the ticket when the best candidate is confident and clearly ahead", () => {
    const result = decideMatch(
      [
        { ticketNumber: 3, cosine: 0.1 },
        { ticketNumber: 7, cosine: 0.71 },
      ],
      0.8,
    );
    assert.equal(result.outcome, "matched");
    assert.equal(result.ticketNumber, 7);
    assert.ok(result.confidence !== null && result.confidence >= 0.8);
  });

  it("refuses below the threshold without naming the guess", () => {
    const result = decideMatch([{ ticketNumber: 7, cosine: 0.3 }], 0.8);
    assert.equal(result.outcome, "low_confidence");
    assert.equal(result.ticketNumber, null);
    assert.ok(result.confidence !== null && result.confidence < 0.8);
  });

  it("refuses when two tickets are nearly as likely", () => {
    const result = decideMatch(
      [
        { ticketNumber: 7, cosine: 0.62 },
        { ticketNumber: 9, cosine: 0.6 },
      ],
      0.8,
    );
    assert.equal(result.outcome, "low_confidence");
    assert.equal(result.ticketNumber, null);
  });

  it("is no_match when nobody resembles the crop or nobody is enrolled", () => {
    const none = { outcome: "no_match", ticketNumber: null, confidence: null };
    assert.deepEqual(decideMatch([{ ticketNumber: 7, cosine: 0.05 }], 0.8), none);
    assert.deepEqual(decideMatch([], 0.8), none);
  });

  it("follows the configured threshold", () => {
    assert.equal(decideMatch([{ ticketNumber: 7, cosine: 0.6 }], 0.95).outcome, "low_confidence");
    assert.equal(decideMatch([{ ticketNumber: 7, cosine: 0.6 }], 0.8).outcome, "matched");
    assert.equal(decideMatch([{ ticketNumber: 7, cosine: 0.4 }], 0.8).outcome, "low_confidence");
  });
});
