import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ageInYears,
  breathingRate,
  breathsPerMin,
  decimal,
  exposureIsStuck,
  heartRate,
  milliseconds,
  minutes,
  minutesAgo,
  percent,
  rate,
  rateChange,
  ruleText,
  rulesText,
  seconds,
  secondsAgo,
  timeOrDayTime,
  waitingCounts,
  years,
} from './format.ts';

test('a rate is a whole number with its unit', () => {
  assert.equal(rate(71.763824), '72');
  assert.equal(heartRate(71.763824), '72 bpm');
  assert.equal(heartRate(71.4), '71 bpm');
  assert.equal(breathingRate(15.5), '16 /min');
  assert.equal(breathsPerMin(15.5), '16 breaths per min');
  assert.equal(rate(108), '108');
});

test('a change is the difference of the two numbers on screen', () => {
  assert.equal(rateChange(60.4, 71.763824), '+12');
  assert.equal(rateChange(82, 78.2), '−4');
  // 71.6 and 72.4 both show as 72, so there is no change to print.
  assert.equal(rateChange(71.6, 72.4), null);
  assert.equal(rateChange(80, 80), null);
});

test('minutes become hours past the hour', () => {
  assert.equal(minutes(0), '0 min');
  assert.equal(minutes(0.4), 'under 1 min');
  assert.equal(minutes(4.2), '4 min');
  assert.equal(minutes(59.6), '1 h');
  assert.equal(minutes(72), '1 h 12 min');
  assert.equal(minutes(180), '3 h');
});

test('ages of events', () => {
  assert.equal(minutesAgo(0), 'just now');
  assert.equal(minutesAgo(3), '3 min ago');
  assert.equal(minutesAgo(3.9), '3 min ago');
  assert.equal(minutesAgo(72), '1 h 12 min ago');
  assert.equal(minutesAgo(120), '2 h ago');
  assert.equal(secondsAgo(0, 900), 'just now');
  assert.equal(secondsAgo(0, 4_400), '4 s ago');
  assert.equal(secondsAgo(0, 125_000), '2 min ago');
});

test('seconds, milliseconds, shares and means', () => {
  assert.equal(seconds(11.5), '12 s');
  assert.equal(milliseconds(41.7), '42 ms');
  assert.equal(percent(0.826), '83%');
  assert.equal(percent(1.2), '100%');
  assert.equal(decimal(2.25), '2.3');
  assert.equal(decimal(2), '2.0');
});

test('ages in whole years', () => {
  assert.equal(years(34), '34 y');
  assert.equal(ageInYears('1991-04-18', new Date(2026, 10, 14)), 35);
  assert.equal(ageInYears('1991-12-01', new Date(2026, 10, 14)), 34);
  assert.equal(ageInYears(null), null);
});

test('a time on another day carries its date', () => {
  const now = new Date(2026, 10, 14, 20, 0);
  assert.equal(timeOrDayTime(new Date(2026, 10, 14, 14, 32).toISOString(), now), '14:32');
  assert.equal(timeOrDayTime(new Date(2026, 10, 13, 4, 0).toISOString(), now), '13 Nov, 04:00');
  assert.equal(timeOrDayTime(new Date(2025, 10, 14, 14, 32).toISOString(), now), '14 Nov, 14:32');
});

test('a flag names the check-in only when its baseline is the check-in\'s (QA round 3, N4)', () => {
  assert.equal(ruleText('score_rise'), 'Partial score rose from check-in');
  assert.equal(ruleText('baseline_shift'), 'Moved from the check-in baseline');
  assert.equal(ruleText('score_rise', true), 'Partial score rose from baseline');
  assert.equal(ruleText('baseline_shift', true), 'Moved from baseline');
  assert.equal(ruleText('overdue', true), 'Overdue for a re-check');
});

test('the waiting room counts a lower-confidence patient as that, not as without a reading (QA round 3, N6)', () => {
  const item = (state: 'observed' | 'flag' | 'overdue' | 'no-reading', lowConfidence?: number) => ({
    state,
    pulse: lowConfidence === undefined ? {} : { lowConfidence },
  });
  const room = [item('observed'), item('no-reading'), item('no-reading', 102), item('no-reading', 61.5), item('flag'), item('overdue')];
  assert.deepEqual(waitingCounts(room), { flags: 1, overdue: 1, noReading: 1, lowConfidence: 2 });
  assert.deepEqual(waitingCounts([item('observed')]), { flags: 0, overdue: 0, noReading: 0, lowConfidence: 0 });
  assert.deepEqual(waitingCounts([item('no-reading', 99), item('flag'), item('flag')]), { flags: 2, overdue: 0, noReading: 0, lowConfidence: 1 });
  assert.deepEqual(waitingCounts([item('no-reading'), item('no-reading')]), { flags: 0, overdue: 0, noReading: 2, lowConfidence: 0 });
});

test('the rules of one alert are one phrase, and name the check-in only when the baseline is its own', () => {
  assert.equal(rulesText(['score_rise', 'baseline_shift']), 'Score rose and vitals moved from check-in');
  assert.equal(rulesText(['score_rise', 'baseline_shift'], true), 'Score rose and vitals moved from baseline');
  assert.equal(rulesText(['baseline_shift']), 'Moved from the check-in baseline');
  assert.equal(rulesText(['baseline_shift'], true), 'Moved from baseline');
  assert.equal(rulesText(['overdue'], true), 'Overdue for a re-check');
});

test('exposure that has not settled for eight readings in a row is stuck (QA round 3, R5)', () => {
  const adjusting = Array.from({ length: 8 }, () => 'exposure_adjusting' as const);
  assert.equal(exposureIsStuck(adjusting), true);
  assert.equal(exposureIsStuck([null, 'warming_up', ...adjusting]), true);
  // Seven is still the camera settling, and anything else in between starts the count again.
  assert.equal(exposureIsStuck(adjusting.slice(1)), false);
  assert.equal(exposureIsStuck([...adjusting.slice(0, 4), 'no_face', ...adjusting.slice(0, 7)]), false);
  assert.equal(exposureIsStuck([...adjusting, 'warming_up']), false);
  assert.equal(exposureIsStuck([]), false);
});
