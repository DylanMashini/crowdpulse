import type { Agreement } from "@triagecam/contracts";

/** A reference sample pairs with a reading taken within this long of it. */
export const PAIRING_WINDOW_MS = 1500;
/** An estimate within this many bpm of the reference counts as agreeing. */
export const AGREEMENT_BPM = 5;

export type Sample = { t: number; heartRate: number };
export type Pair = { estimate: number; reference: number };

/** Pairs each estimate with the nearest reference sample inside the pairing window. Both on the server clock, in ms. */
export function pairReadings(estimates: Sample[], references: Sample[]): Pair[] {
  const sorted = [...references].sort((a, b) => a.t - b.t);
  const pairs: Pair[] = [];
  let index = 0;
  for (const estimate of [...estimates].sort((a, b) => a.t - b.t)) {
    while (index + 1 < sorted.length && Math.abs((sorted[index + 1] as Sample).t - estimate.t) <= Math.abs((sorted[index] as Sample).t - estimate.t)) {
      index += 1;
    }
    const nearest = sorted[index];
    if (nearest && Math.abs(nearest.t - estimate.t) <= PAIRING_WINDOW_MS) {
      pairs.push({ estimate: estimate.heartRate, reference: nearest.heartRate });
    }
  }
  return pairs;
}

export const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Mean absolute error, bias (estimate minus reference) and the share within 5 bpm. Null when nothing paired. */
export function agreement(pairs: Pair[]): Agreement {
  const errors = pairs.map((pair) => pair.estimate - pair.reference);
  return {
    pairedReadings: pairs.length,
    meanAbsoluteErrorBpm: mean(errors.map(Math.abs)),
    biasBpm: mean(errors),
    within5BpmShare: mean(errors.map((error) => (Math.abs(error) <= AGREEMENT_BPM ? 1 : 0))),
  };
}
