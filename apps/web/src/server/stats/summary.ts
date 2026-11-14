import type { RateDistribution } from "@triagecam/contracts";

export const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export const highest = (values: number[]): number | null => (values.length === 0 ? null : Math.max(...values));
export const lowest = (values: number[]): number | null => (values.length === 0 ? null : Math.min(...values));

export type Binning = {
  /** The first whole number of some bin. Every bin starts a whole number of widths from it. */
  origin: number;
  /** Whole numbers per bin. */
  width: number;
  /** Whole numbers the bins always reach, so the usual range is on the chart even when no sitting fell in it. */
  cover: [number, number];
  /**
   * One bin that is not `width` wide, so the bins can follow score bands that are not all the
   * same size. It must start a whole number of widths from `origin`; bins above it count from
   * the number after it.
   */
  band?: { from: number; to: number };
};

/**
 * Pulse bins of ten that line up with the partial NEWS2 bands (51 to 90 scores 0, 91 to 110
 * scores 1, and so on).
 */
export const HEART_RATE_BINS: Binning = { origin: 41, width: 10, cover: [51, 90] };
/**
 * Breathing bins that never straddle a partial NEWS2 band: threes from 9 (9 to 11 scores 1; 12
 * to 20, three bins, scores 0), then 21 to 24 as one bin of four (scores 2), then threes again
 * from 25 (scores 3).
 */
export const BREATHING_RATE_BINS: Binning = { origin: 9, width: 3, cover: [12, 20], band: { from: 21, to: 24 } };

/**
 * Counts rates into whole-number bins. A rate is rounded first, as it is on every screen, so
 * 90.4 falls in "81 to 90" and 90.6 in "91 to 100".
 */
export function distribution(values: number[], binning: Binning): RateDistribution {
  if (values.length === 0) return { sittings: 0, median: null, lowest: null, highest: null, bins: [] };
  const { origin, width, cover, band } = binning;
  const start = (value: number) => {
    const whole = Math.round(value);
    if (band && whole >= band.from && whole <= band.to) return band.from;
    const base = band && whole > band.to ? band.to + 1 : origin;
    return base + Math.floor((whole - base) / width) * width;
  };
  const end = (from: number) => (band && from === band.from ? band.to : from + width - 1);
  const rounded = values.map((value) => Math.round(value));
  const first = Math.min(start(cover[0]), ...rounded.map(start));
  const last = Math.max(start(cover[1]), ...rounded.map(start));

  const bins: RateDistribution["bins"] = [];
  for (let from = first; from <= last; from = end(from) + 1) {
    bins.push({ from, to: end(from), sittings: rounded.filter((value) => start(value) === from).length });
  }
  return { sittings: values.length, median: median(values), lowest: lowest(values), highest: highest(values), bins };
}

/**
 * Minutes from the end of one observation to the end of the next, for one patient's
 * observations in time order. Only gaps whose later sitting passes `counts` are returned.
 */
export function minutesBetweenObservations(
  observations: { startedAt: Date; endedAt: Date }[],
  counts: (later: { startedAt: Date; endedAt: Date }) => boolean = () => true,
): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < observations.length; index++) {
    const later = observations[index] as { startedAt: Date; endedAt: Date };
    const earlier = observations[index - 1] as { startedAt: Date; endedAt: Date };
    if (counts(later)) gaps.push((later.endedAt.getTime() - earlier.endedAt.getTime()) / 60_000);
  }
  return gaps;
}
