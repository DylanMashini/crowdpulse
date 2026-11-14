import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ageInYears,
  breathingRate,
  breathsPerMin,
  decimal,
  heartRate,
  milliseconds,
  minutes,
  minutesAgo,
  percent,
  rate,
  rateChange,
  seconds,
  secondsAgo,
  timeOrDayTime,
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
