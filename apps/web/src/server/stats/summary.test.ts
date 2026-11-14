import assert from "node:assert/strict";
import { test } from "node:test";

import type { Flag, FlagRule } from "@triagecam/contracts";

import { BREATHING_RATE_BINS, HEART_RATE_BINS, distribution, flagStatistics, mean, median, minutesBetweenObservations } from "./summary.ts";

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

test("breathing bins follow the score bands: threes, with 21 to 24 as one bin", () => {
  const result = distribution([16, 24, 24.6, 30], BREATHING_RATE_BINS);
  assert.deepEqual(
    result.bins.map((bin) => [bin.from, bin.to, bin.sittings]),
    [
      [12, 14, 0],
      [15, 17, 1],
      [18, 20, 0],
      [21, 24, 1],
      [25, 27, 1],
      [28, 30, 1],
    ],
  );
  // Below the usual range the bins are still threes from 9.
  assert.deepEqual(
    distribution([7, 10], BREATHING_RATE_BINS).bins.slice(0, 3).map((bin) => [bin.from, bin.to, bin.sittings]),
    [
      [6, 8, 1],
      [9, 11, 1],
      [12, 14, 0],
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

const flagAt = (minute: number) => `2026-11-14T10:${String(minute).padStart(2, "0")}:00.000Z`;
let flagCount = 0;
const flag = (rule: FlagRule, alertId: string, openedMinute: number, over: Partial<Flag> = {}): Flag => ({
  id: `00000000-0000-4000-8000-${String((flagCount += 1)).padStart(12, "0")}`,
  patientNumber: 14,
  patient: { number: 14, name: "Maya Chen", photoUpdatedAt: null },
  rule,
  openedAt: flagAt(openedMinute),
  closedAt: null,
  detail: { pulse: { base: 82, now: 108 }, breathing: { base: 16, now: 24 }, scoreAtCheckIn: 0, scoreNow: 2, minutesSinceCheckIn: 26, minutesSinceObserved: null },
  acknowledgedAt: null,
  acknowledgedBy: null,
  handoff: "Maya Chen: pulse 82 bpm at check-in, 108 bpm now.",
  alertId,
  ...over,
});
const acknowledged = (minute: number) => ({ acknowledgedAt: flagAt(minute), acknowledgedBy: "nurse@ward.test" });

test("one deterioration acknowledged once is one flag raised and one acknowledged (BUG-9)", () => {
  // Both trend rules tripped on one sitting; the nurse's one acknowledgement covered both flags.
  const both = [flag("score_rise", "trend-14-1", 0, acknowledged(6)), flag("baseline_shift", "trend-14-1", 0, acknowledged(6))];
  assert.deepEqual(flagStatistics(both, both), {
    raised: 1,
    byRule: { score_rise: 1, baseline_shift: 1, overdue: 0 },
    acknowledged: 1,
    medianMinutesToAcknowledge: 6,
    openNow: 1,
    unacknowledgedNow: 0,
  });
});

test("flag statistics count alerts; only the by-rule numbers count single flags", () => {
  const trend = [flag("score_rise", "trend-14-1", 0), flag("baseline_shift", "trend-14-1", 0)];
  const later = flag("score_rise", "trend-15-2", 10, acknowledged(14));
  const overdue = flag("overdue", "overdue-1", 20, { closedAt: flagAt(30) });
  const result = flagStatistics([...trend, later, overdue], [...trend, later]);
  assert.equal(result.raised, 3);
  assert.deepEqual(result.byRule, { score_rise: 2, baseline_shift: 1, overdue: 1 });
  assert.equal(result.acknowledged, 1);
  assert.equal(result.medianMinutesToAcknowledge, 4);
  assert.equal(result.openNow, 2);
  assert.equal(result.unacknowledgedNow, 1);

  // An alert one of whose flags closed before anyone looked still counts as acknowledged once
  // the open one is, from when it opened to that first acknowledgement.
  const half = [flag("score_rise", "trend-14-3", 0, { closedAt: flagAt(2) }), flag("baseline_shift", "trend-14-3", 0, acknowledged(8))];
  const halfResult = flagStatistics(half, [half[1] as Flag]);
  assert.equal(halfResult.acknowledged, 1);
  assert.equal(halfResult.medianMinutesToAcknowledge, 8);
  assert.equal(halfResult.unacknowledgedNow, 0);

  assert.deepEqual(flagStatistics([], []), {
    raised: 0,
    byRule: { score_rise: 0, baseline_shift: 0, overdue: 0 },
    acknowledged: 0,
    medianMinutesToAcknowledge: null,
    openNow: 0,
    unacknowledgedNow: 0,
  });
});
