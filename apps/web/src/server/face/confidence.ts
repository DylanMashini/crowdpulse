/**
 * How SFace cosine similarity maps onto the 0 to 1 confidence of the face-match contract.
 *
 * A cosine similarity of 0.5 is mapped to 0.8, the default faceMatchMinConfidence, and the
 * map is linear on each side: 0 or less is 0, 0.5 is 0.8, 1 is 1. OpenCV publishes 0.363 as
 * the point at which SFace calls two faces the same person, but on small, compressed face
 * crops two different people reached 0.38 here while the same person stayed above 0.68, so
 * the default sits at the stricter 0.5. Raising the setting is stricter still.
 */
export const MATCH_COSINE = 0.5;
const CONFIDENCE_AT_MATCH = 0.8;

/** Below this cosine similarity nobody enrolled resembles the crop at all. */
export const RESEMBLANCE_COSINE = 0.2;
/** A best match this close to the runner-up, in cosine similarity, could be either person. */
export const AMBIGUITY_MARGIN = 0.05;

export function confidenceFromCosine(cosine: number): number {
  if (cosine <= 0) return 0;
  if (cosine <= MATCH_COSINE) return (cosine / MATCH_COSINE) * CONFIDENCE_AT_MATCH;
  const above = (Math.min(cosine, 1) - MATCH_COSINE) / (1 - MATCH_COSINE);
  return CONFIDENCE_AT_MATCH + above * (1 - CONFIDENCE_AT_MATCH);
}

export type Candidate = { ticketNumber: number; cosine: number };
export type MatchOutcome = {
  outcome: "matched" | "low_confidence" | "no_match";
  ticketNumber: number | null;
  confidence: number | null;
};

/**
 * Decides what a match discloses. A wrong-patient trend is worse than no trend, so a ticket
 * number is returned only when the best candidate meets the configured confidence and is
 * clearly ahead of the next one. A low-confidence guess is never named.
 */
export function decideMatch(candidates: Candidate[], minConfidence: number): MatchOutcome {
  const [best, runnerUp] = [...candidates].sort((a, b) => b.cosine - a.cosine);
  if (!best || best.cosine < RESEMBLANCE_COSINE) return { outcome: "no_match", ticketNumber: null, confidence: null };
  const confidence = confidenceFromCosine(best.cosine);
  const ambiguous = runnerUp !== undefined && best.cosine - runnerUp.cosine < AMBIGUITY_MARGIN;
  if (confidence >= minConfidence && !ambiguous) {
    return { outcome: "matched", ticketNumber: best.ticketNumber, confidence };
  }
  return { outcome: "low_confidence", ticketNumber: null, confidence };
}
