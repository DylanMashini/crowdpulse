import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultSettings, type Settings } from "@triagecam/contracts";

import {
  baselineShift,
  breathingBand,
  overdue,
  partialScore,
  pulseBand,
  scoreRise,
  type SittingFacts,
  snapshotPatient,
} from "./rules.ts";

const START = Date.parse("2026-11-14T15:00:00.000Z");
const at = (minutes: number) => new Date(START + minutes * 60_000);

let nextId = 0;
/** A finished sitting that ended `minutes` after the patient was created. */
function sitting(minutes: number, heartRate: number | null, breathingRate: number | null): SittingFacts {
  nextId += 1;
  return {
    id: `sitting-${nextId}`,
    source: "camera",
    startedAt: at(minutes - 1),
    endedAt: at(minutes),
    finished: true,
    heartRate,
    breathingRate,
  };
}

const snapshot = (sittings: SittingFacts[], nowMinutes: number, settings: Settings = defaultSettings) =>
  snapshotPatient(sittings, at(0), settings, at(nowMinutes));

describe("partial NEWS2 bands", () => {
  it("bands pulse as in the plan's table", () => {
    const cases: [number, number][] = [
      [40, 3], [41, 1], [50, 1], [51, 0], [90, 0], [91, 1], [110, 1], [111, 2], [130, 2], [131, 3], [180, 3],
    ];
    for (const [bpm, band] of cases) assert.equal(pulseBand(bpm), band, `pulse ${bpm}`);
  });

  it("bands breathing as in the plan's table", () => {
    const cases: [number, number][] = [
      [8, 3], [9, 1], [11, 1], [12, 0], [20, 0], [21, 2], [24, 2], [25, 3], [40, 3],
    ];
    for (const [rate, band] of cases) assert.equal(breathingBand(rate), band, `breathing ${rate}`);
  });

  it("bands a fractional rate as the whole number a chart would show", () => {
    assert.equal(pulseBand(90.4), 0);
    assert.equal(pulseBand(90.6), 1);
    assert.equal(breathingBand(20.5), 2);
  });

  it("scores a patient as the higher band, never the sum", () => {
    assert.equal(partialScore(95, 22), 2);
    assert.equal(partialScore(135, 22), 3);
    assert.equal(partialScore(72, 16), 0);
  });

  it("scores from one parameter when only one was measured, and null from none", () => {
    assert.equal(partialScore(null, 22), 2);
    assert.equal(partialScore(95, null), 1);
    assert.equal(partialScore(null, null), null);
  });
});

describe("score_rise", () => {
  it("does not open on a single raised observation", () => {
    assert.deepEqual(scoreRise([sitting(1, 72, 16), sitting(20, 112, 16)]), { met: false, cleared: false });
  });

  it("opens when the rise persists across two consecutive observations", () => {
    const status = scoreRise([sitting(1, 72, 16), sitting(20, 112, 16), sitting(30, 115, 16)]);
    assert.deepEqual(status, { met: true, cleared: false });
  });

  it("does not open when the two raised observations are not consecutive", () => {
    const status = scoreRise([sitting(1, 72, 16), sitting(20, 112, 16), sitting(30, 80, 16), sitting(40, 112, 16)]);
    assert.deepEqual(status, { met: false, cleared: false });
  });

  it("clears when an observation does not score higher than check-in", () => {
    const status = scoreRise([sitting(1, 72, 16), sitting(20, 112, 16), sitting(30, 115, 16), sitting(40, 84, 16)]);
    assert.deepEqual(status, { met: false, cleared: true });
  });

  it("measures the rise against check-in, so a high but steady score is not a rise", () => {
    const status = scoreRise([sitting(1, 115, 16), sitting(20, 118, 16), sitting(30, 120, 16)]);
    assert.deepEqual(status, { met: false, cleared: true });
  });

  it("never counts the check-in observation itself", () => {
    assert.deepEqual(scoreRise([sitting(1, 135, 26)]), { met: false, cleared: true });
    assert.deepEqual(scoreRise([]), { met: false, cleared: true });
  });
});

describe("baseline_shift", () => {
  const thresholds = { pulseDeltaBpm: 20, breathingDeltaPerMin: 6 };

  it("opens when pulse has moved more than the threshold on two consecutive observations", () => {
    const status = baselineShift([sitting(1, 82, 16), sitting(20, 104, 16), sitting(27, 108, 17)], thresholds);
    assert.deepEqual(status, { met: true, cleared: false });
  });

  it("opens on a fall as well as a rise", () => {
    const status = baselineShift([sitting(1, 95, 16), sitting(20, 70, 16), sitting(27, 68, 16)], thresholds);
    assert.equal(status.met, true);
  });

  it("opens on breathing alone", () => {
    const status = baselineShift([sitting(1, 82, 16), sitting(20, 84, 23), sitting(27, 85, 24)], thresholds);
    assert.equal(status.met, true);
  });

  it("needs more than the threshold, not exactly the threshold", () => {
    const status = baselineShift([sitting(1, 80, 16), sitting(20, 100, 22), sitting(27, 100, 22)], thresholds);
    assert.deepEqual(status, { met: false, cleared: true });
  });

  it("does not open on one moved observation, and clears when the latest is back within both thresholds", () => {
    assert.deepEqual(baselineShift([sitting(1, 82, 16), sitting(20, 108, 16)], thresholds), {
      met: false,
      cleared: false,
    });
    const back = baselineShift(
      [sitting(1, 82, 16), sitting(20, 108, 16), sitting(27, 110, 16), sitting(35, 88, 17)],
      thresholds,
    );
    assert.deepEqual(back, { met: false, cleared: true });
  });

  it("ignores a parameter that was not measured at check-in or now", () => {
    const status = baselineShift([sitting(1, null, 16), sitting(20, 140, 16), sitting(27, 140, null)], thresholds);
    assert.deepEqual(status, { met: false, cleared: true });
  });

  it("uses the thresholds it is given", () => {
    const observations = [sitting(1, 82, 16), sitting(20, 94, 16), sitting(27, 95, 16)];
    assert.equal(baselineShift(observations, { pulseDeltaBpm: 10, breathingDeltaPerMin: 6 }).met, true);
    assert.equal(baselineShift(observations, thresholds).met, false);
  });
});

describe("overdue", () => {
  it("is met only after the re-check interval has passed", () => {
    assert.deepEqual(overdue(at(0), at(30), 30), { met: false, cleared: true });
    assert.deepEqual(overdue(at(0), at(31), 30), { met: true, cleared: false });
  });
});

describe("snapshotPatient", () => {
  it("counts overdue from patient creation when there has been no observation", () => {
    assert.equal(snapshot([], 29).rules.overdue.met, false);
    const late = snapshot([], 31);
    assert.equal(late.rules.overdue.met, true);
    assert.equal(late.minutesSinceObserved, null);
    assert.equal(late.flagDetail.minutesSinceCheckIn, 31);
  });

  it("counts overdue from the last valid observation", () => {
    const sittings = [sitting(2, 72, 16), sitting(25, 74, 16)];
    assert.equal(snapshot(sittings, 54).rules.overdue.met, false);
    assert.equal(snapshot(sittings, 56).rules.overdue.met, true);
    assert.equal(snapshot(sittings, 56).minutesSinceObserved, 31);
  });

  it("does not let a no-reading sitting count as an observation", () => {
    const result = snapshot([sitting(2, 72, 16), sitting(40, null, null)], 41);
    assert.equal(result.latestGaveNoReading, true);
    assert.equal(result.minutesSinceObserved, 39);
    assert.equal(result.rules.overdue.met, true);
    assert.deepEqual(result.pulse, { base: 72, now: null });
    assert.equal(result.score, null);
    assert.equal(result.parametersMeasured, 0);
    assert.deepEqual(result.flagDetail.pulse, { base: 72, now: 72 });
  });

  it("takes the first observation as the baseline, skipping a failed check-in", () => {
    const result = snapshot([sitting(2, null, null), sitting(5, 80, 15), sitting(20, 84, 16)], 21);
    assert.equal(result.baseline?.heartRate, 80);
    assert.equal(result.scoreAtCheckIn, 0);
    assert.equal(result.minutesToLatestObservation, 15);
  });

  it("does not take a lower-confidence heart rate for the baseline, a score or a flag", () => {
    // What the server makes of a sitting whose rate rests on the whole-sitting estimate:
    // the trusted heart rate is null and the rate itself travels beside it.
    const weak = (minutes: number, bpm: number): SittingFacts => ({ ...sitting(minutes, null, null), lowConfidenceHeartRate: bpm });

    const checkIn = snapshot([weak(2, 62)], 3);
    assert.equal(checkIn.baseline, null);
    assert.equal(checkIn.minutesSinceObserved, null);
    assert.equal(checkIn.latestGaveNoReading, true);
    assert.equal(checkIn.latestLowConfidencePulse, 62);
    // The rate travels with the trend so every screen can show it, tagged; it is neither value of the trend.
    assert.deepEqual(checkIn.pulse, { base: null, now: null, lowConfidence: 62 });
    assert.equal(checkIn.score, null);

    // The next sitting with a rate that stands is the baseline, and the weak one is not compared with it.
    const later = snapshot([weak(2, 62), sitting(6, 84, 16), sitting(20, 86, 16)], 21);
    assert.equal(later.baseline?.heartRate, 84);
    assert.equal(later.latestLowConfidencePulse, null);
    assert.equal(later.rules.baseline_shift.met, false);

    // A weak rate 40 bpm above the baseline, twice, raises nothing; the patient becomes overdue instead.
    const noFlag = snapshot([sitting(2, 72, null), weak(20, 112), weak(34, 114)], 35);
    assert.equal(noFlag.rules.baseline_shift.met, false);
    assert.equal(noFlag.rules.score_rise.met, false);
    assert.equal(noFlag.rules.overdue.met, true);
    assert.equal(noFlag.latestLowConfidencePulse, 114);
    assert.deepEqual(noFlag.pulse, { base: 72, now: null, lowConfidence: 114 });
    assert.deepEqual(noFlag.flagDetail.pulse, { base: 72, now: 72 });
  });

  it("takes the pulse baseline from the first heart rate that counts, apart from breathing (QA round 2, W1)", () => {
    const weak = (minutes: number, bpm: number, breathing: number | null): SittingFacts => ({
      ...sitting(minutes, null, breathing),
      kind: "check_in",
      lowConfidenceHeartRate: bpm,
    });
    const recheck = (minutes: number, bpm: number | null, breathing: number | null): SittingFacts => ({ ...sitting(minutes, bpm, breathing), kind: "recheck" });
    const visit = [weak(2, 101.5, 16), recheck(10, 55, 16), recheck(20, 85, 16), recheck(30, 86, 16)];

    // The check-in is an observation (breathing), and its pulse is shown tagged and is no baseline.
    const first = snapshot(visit.slice(0, 1), 3);
    assert.equal(first.baseline?.id, visit[0]?.id);
    assert.deepEqual(first.pulse, { base: null, now: null, lowConfidence: 101.5 });
    assert.deepEqual(first.breathing, { base: 16, now: 16 });
    assert.equal(first.pulseFrom, undefined);

    // The first re-check with a rate that counts is the pulse baseline, and says it is a re-check's.
    const second = snapshot(visit.slice(0, 2), 11);
    assert.equal(second.baseline?.id, visit[0]?.id);
    assert.equal(second.pulseBaseline?.id, visit[1]?.id);
    assert.equal(second.breathingBaseline?.id, visit[0]?.id);
    assert.deepEqual(second.pulse, { base: 55, now: 55, baseAt: at(10).toISOString() });
    assert.deepEqual(second.breathing, { base: 16, now: 16 });
    assert.deepEqual(second.pulseFrom, { minutesLater: null, checkIn: "lower_confidence" });
    assert.equal(second.breathingFrom, undefined);
    assert.equal(second.rules.baseline_shift.met, false);

    // One raised observation is not yet a flag; two are.
    const third = snapshot(visit.slice(0, 3), 21);
    assert.deepEqual(third.pulse, { base: 55, now: 85, baseAt: at(10).toISOString() });
    assert.deepEqual(third.rules.baseline_shift, { met: false, cleared: false });
    const fourth = snapshot(visit, 31);
    assert.deepEqual(fourth.rules.baseline_shift, { met: true, cleared: false });
    assert.deepEqual(fourth.flagDetail.pulse, { base: 55, now: 86, baseAt: at(10).toISOString() });
    assert.deepEqual(fourth.pulseFrom, { minutesLater: 20, checkIn: "lower_confidence" });
    assert.equal(baselineShift(visit, defaultSettings).met, true);
    // The score was never raised by any of it: 55, 85 and 86 bpm all band 0.
    assert.equal(fourth.rules.score_rise.met, false);

    // Back within the threshold of the re-check's 55: the flag clears.
    const settled = snapshot([...visit, recheck(40, 60, 16)], 41);
    assert.deepEqual(settled.rules.baseline_shift, { met: false, cleared: true });

    // A lower-confidence re-check in between is no baseline either, and leaves the baseline where it was.
    const interrupted = snapshot(
      [weak(2, 101.5, 16), { ...weak(8, 99, 16), kind: "recheck" }, recheck(10, 55, 16), recheck(20, 85, 16), recheck(30, 86, 16)],
      31,
    );
    assert.equal(interrupted.pulse.base, 55);
    assert.equal(interrupted.rules.baseline_shift.met, true);
  });

  it("gives breathing its own baseline too, and labels a check-in baseline as nothing but the check-in", () => {
    const recheck = (minutes: number, bpm: number | null, breathing: number | null): SittingFacts => ({ ...sitting(minutes, bpm, breathing), kind: "recheck" });
    const checkIn: SittingFacts = { ...sitting(2, 72, null), kind: "check_in" };
    const result = snapshot([checkIn, recheck(10, 74, 14), recheck(20, 73, 22), recheck(30, 72, 23)], 31);
    assert.deepEqual(result.pulse, { base: 72, now: 72 });
    assert.deepEqual(result.breathing, { base: 14, now: 23, baseAt: at(10).toISOString() });
    assert.deepEqual(result.breathingFrom, { minutesLater: 20, checkIn: "not_measured" });
    assert.equal(result.rules.baseline_shift.met, true);

    // A check-in with no reading at all, then a re-check: the baseline is the re-check's and says so.
    const repeated = snapshot([{ ...sitting(2, null, null), kind: "check_in" }, recheck(6, 74, null)], 7);
    assert.deepEqual(repeated.pulse, { base: 74, now: 74, baseAt: at(6).toISOString() });
    assert.deepEqual(repeated.pulseFrom, { minutesLater: null, checkIn: "not_measured" });
  });

  it("ignores a sitting that was abandoned without a summary", () => {
    const abandoned: SittingFacts = { ...sitting(10, null, null), finished: false };
    const result = snapshot([sitting(2, 72, 16), abandoned], 12);
    assert.equal(result.latestGaveNoReading, false);
    assert.equal(result.latest?.heartRate, 72);
  });

  it("reports the values, score and elapsed time the flag is raised on", () => {
    const result = snapshot([sitting(2, 82, 16), sitting(21, 104, 22), sitting(28, 108, 24)], 31);
    assert.equal(result.rules.score_rise.met, true);
    assert.equal(result.rules.baseline_shift.met, true);
    assert.deepEqual(result.flagDetail, {
      pulse: { base: 82, now: 108 },
      breathing: { base: 16, now: 24 },
      scoreAtCheckIn: 0,
      scoreNow: 2,
      minutesSinceCheckIn: 26,
      minutesSinceObserved: 3,
    });
    assert.equal(result.parametersMeasured, 2);
  });

  it("opens nothing and clears everything for a rule that is switched off", () => {
    const settings = { ...defaultSettings, scoreRiseEnabled: false, baselineShiftEnabled: false, overdueEnabled: false };
    const result = snapshot([sitting(2, 82, 16), sitting(21, 120, 26), sitting(28, 125, 26)], 90, settings);
    for (const rule of ["score_rise", "baseline_shift", "overdue"] as const) {
      assert.deepEqual(result.rules[rule], { met: false, cleared: true });
    }
  });

  it("reads thresholds and the re-check interval from settings", () => {
    const settings = { ...defaultSettings, recheckIntervalMin: 10, pulseDeltaBpm: 5 };
    const result = snapshot([sitting(2, 72, 16), sitting(8, 79, 16), sitting(12, 80, 16)], 23, settings);
    assert.equal(result.rules.baseline_shift.met, true);
    assert.equal(result.rules.overdue.met, true);
  });

  it("reports a running sitting as in progress, but not one the phone abandoned long ago", () => {
    const running: SittingFacts = { ...sitting(0, null, null), startedAt: at(20), endedAt: null, finished: false };
    assert.equal(snapshot([running], 21).sittingInProgress, true);
    assert.equal(snapshot([running], 45).sittingInProgress, false);
  });
});
