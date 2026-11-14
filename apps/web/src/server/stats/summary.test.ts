import assert from "node:assert/strict";
import { test } from "node:test";

import { BREATHING_RATE_BINS, HEART_RATE_BINS, distribution, mean, median, minutesBetweenObservations } from "./summary.ts";

test("mean and median of nothing are null, never 0", () => {
  assert.equal(mean([]), null);
  assert.equal(median([]), null);
  assert.equal(mean([2, 4]), 3);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("a distribution with no sittings has no bins", () => {
  assert.deepEqual(distribution([], HEART_RATE_BINS), { sittings: 0, median: null, lowest: null, highest: null, bins: [] });
});

test("heart rates are binned in tens that line up with the score bands", () => {
  const result = distribution([71.763824, 76, 104, 108], HEART_RATE_BINS);
  assert.equal(result.sittings, 4);
  assert.equal(result.median, 90);
  assert.equal(result.lowest, 71.763824);
  assert.equal(result.highest, 108);
  // 51 to 90 is always on the chart; the data reaches up to 101 to 110.
  assert.deepEqual(
    result.bins.map((bin) => [bin.from, bin.to, bin.sittings]),
    [
      [51, 60, 0],
      [61, 70, 0],
      [71, 80, 2],
      [81, 90, 0],
      [91, 100, 0],
      [101, 110, 2],
    ],
  );
});

test("a rate is rounded before it is binned, as the screens show it", () => {
  const bins = distribution([90.4, 90.6], HEART_RATE_BINS).bins;
  assert.equal(bins.find((bin) => bin.from === 81)?.sittings, 1);
  assert.equal(bins.find((bin) => bin.from === 91)?.sittings, 1);
});

test("bins reach below the usual range when a rate is there", () => {
  const result = distribution([44], HEART_RATE_BINS);
  assert.equal(result.bins[0]?.from, 41);
  assert.equal(result.bins.at(-1)?.to, 90);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.sittings, 0), 1);
});

test("breathing bins of three cover 12 to 20 exactly", () => {
  const result = distribution([16, 24], BREATHING_RATE_BINS);
  assert.deepEqual(
    result.bins.map((bin) => [bin.from, bin.to, bin.sittings]),
    [
      [12, 14, 0],
      [15, 17, 1],
      [18, 20, 0],
      [21, 23, 0],
      [24, 26, 1],
    ],
  );
});

test("gaps between consecutive observations, in minutes", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 14, 10, minute));
  const sitting = (endMinute: number) => ({ startedAt: at(endMinute - 1), endedAt: at(endMinute) });
  const observations = [sitting(1), sitting(21), sitting(51)];
  assert.deepEqual(minutesBetweenObservations(observations), [20, 30]);
  assert.deepEqual(minutesBetweenObservations([sitting(1)]), []);
  // Only a gap whose later sitting started inside the range counts.
  assert.deepEqual(
    minutesBetweenObservations(observations, (later) => later.startedAt >= at(30)),
    [30],
  );
});
