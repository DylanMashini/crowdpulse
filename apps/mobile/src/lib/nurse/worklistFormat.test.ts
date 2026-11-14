/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TimelineEntry } from '@triagecam/contracts';

import { ageText, clockTime, percent, sentences, tidy } from '../format.ts';
import {
  flagTitle,
  lastObservedText,
  scoreCaption,
  sourceLabel,
  statusText,
  timelineRows,
  trendText,
  worklistSummary,
} from './worklistFormat.ts';

test('ages are whole minutes, then hours and minutes', () => {
  assert.equal(ageText(null), '');
  assert.equal(ageText(0), 'just now');
  assert.equal(ageText(3), '3 min ago');
  assert.equal(ageText(59), '59 min ago');
  assert.equal(ageText(60), '1 h ago');
  assert.equal(ageText(65), '1 h 5 min ago');
});

test('each state has its own words, and none of them is "normal"', () => {
  assert.equal(statusText('observed', 3), 'Observed 3 min ago');
  assert.equal(statusText('observed', null), 'Not yet observed');
  assert.equal(statusText('flag', 12), 'Trend flag');
  assert.equal(statusText('overdue', 42), 'Overdue, last seen 42 min ago');
  assert.equal(statusText('overdue', null), 'Overdue');
  assert.equal(statusText('no-reading', 5), 'No reading');
  // The latest sitting gave a lower-confidence pulse: it did read something, and the words say so.
  assert.equal(statusText('no-reading', null, true), 'Lower confidence, repeat');
  assert.equal(statusText('observed', 3, true), 'Observed 3 min ago');
  assert.equal(statusText('flag', 12, true), 'Trend flag');
});

test('a trend prints the value against the check-in baseline with a signed change', () => {
  assert.deepEqual(trendText({ base: 82, now: 108 }), { kind: 'value', now: '108', base: 'from 82 (+26)' });
  assert.deepEqual(trendText({ base: 24, now: 16 }), { kind: 'value', now: '16', base: 'from 24 (−8)' });
  assert.deepEqual(trendText({ base: 72, now: 72.4 }), { kind: 'value', now: '72', base: 'from 72' });
  assert.deepEqual(trendText({ base: null, now: 90 }), { kind: 'value', now: '90', base: null });
});

test('a missing value is "none", never the baseline or a zero', () => {
  assert.deepEqual(trendText({ base: 82, now: null }), { kind: 'none' });
  assert.deepEqual(trendText({ base: null, now: null }), { kind: 'none' });
});

test('a lower-confidence pulse is tagged and compared with nothing; a re-check baseline says it is one', () => {
  assert.deepEqual(trendText({ base: null, now: null, lowConfidence: 101.5 }), { kind: 'lowConfidence', now: '102', tag: 'Lower confidence' });
  // Never "+40 from 72": the baseline is left out altogether.
  assert.deepEqual(trendText({ base: 72, now: null, lowConfidence: 112 }), { kind: 'lowConfidence', now: '112', tag: 'Lower confidence' });
  assert.deepEqual(trendText({ base: 72, now: null, lowConfidence: null }), { kind: 'none' });
  const baseAt = new Date(2026, 10, 14, 10, 42).toISOString();
  assert.deepEqual(trendText({ base: 55, now: 86, baseAt }), { kind: 'value', now: '86', base: 'from 55 (+31)', baseFrom: '10:42 re-check' });
  assert.deepEqual(trendText({ base: 55, now: 86, baseAt: null }), { kind: 'value', now: '86', base: 'from 55 (+31)' });
});

test('the last-observed line covers never observed and a running sitting', () => {
  assert.equal(lastObservedText({ minutesSinceObserved: 3, sittingInProgress: false }), 'Last observed 3 min ago');
  assert.equal(lastObservedText({ minutesSinceObserved: null, sittingInProgress: false }), 'Not yet observed');
  assert.equal(
    lastObservedText({ minutesSinceObserved: 31, sittingInProgress: true }),
    'Last observed 31 min ago, sitting in progress',
  );
});

test('the score caption counts measured parameters out of seven', () => {
  assert.equal(scoreCaption(2), '2 of 7 parameters');
  assert.equal(scoreCaption(1), '1 of 7 parameters');
});

test('only sittings that did not come from the camera get a source label', () => {
  assert.equal(sourceLabel('camera'), null);
  assert.equal(sourceLabel(null), null);
  assert.equal(sourceLabel('simulated'), 'Simulated');
  assert.equal(sourceLabel('recording'), 'Recording');
  assert.equal(sourceLabel('stub'), 'Stub, not measured');
});

test('flag titles match the system push', () => {
  assert.equal(flagTitle('score_rise', { number: 14, name: 'Maya Chen' }), 'Trend flag: Maya Chen');
  assert.equal(flagTitle('baseline_shift', { number: 14, name: null }), 'Trend flag: Patient 14');
  assert.equal(flagTitle('overdue', { number: 9, name: 'Robert Okafor' }), 'Overdue: Robert Okafor');
});

test('the header counts waiting and flagged patients', () => {
  assert.equal(worklistSummary([]), '0 waiting');
  assert.equal(worklistSummary([{ state: 'observed' }, { state: 'overdue' }]), '2 waiting');
  assert.equal(worklistSummary([{ state: 'flag' }, { state: 'flag' }, { state: 'observed' }]), '3 waiting, 2 flagged');
});

test('clock times are 24-hour in the device zone, and shares are whole percentages', () => {
  const local = new Date(2026, 10, 14, 9, 5, 0);
  assert.equal(clockTime(local.toISOString()), '09:05');
  assert.equal(clockTime(new Date(2026, 10, 14, 21, 40).toISOString()), '21:40');
  assert.equal(clockTime('not a date'), '');
  assert.equal(percent(0.826), '83%');
  assert.equal(percent(1.4), '100%');
});

test('one sentence has no full stop, two or more keep them', () => {
  assert.equal(tidy('Patient 14 has been discharged.'), 'Patient 14 has been discharged');
  assert.equal(tidy('Sit 0.6 to 0.9 m from the phone'), 'Sit 0.6 to 0.9 m from the phone');
  assert.equal(tidy('Cannot reach the server. Check the tunnel'), 'Cannot reach the server. Check the tunnel.');
  assert.equal(sentences('Patient 14 has been discharged', null, ''), 'Patient 14 has been discharged');
  assert.equal(
    sentences('Patient 14 has been discharged', 'The list below may be out of date'),
    'Patient 14 has been discharged. The list below may be out of date.',
  );
  assert.equal(sentences('Cannot reach the server at https://x.', 'Keep the app open'), 'Cannot reach the server at https://x. Keep the app open.');
});

test('the timeline is oldest first and keeps the sitting that failed', () => {
  const at = (minute: number) => new Date(2026, 10, 14, 14, minute).toISOString();
  const id = '0b0e4a53-3c1b-4b7e-9d0a-0d3f6f2a1c11';
  const other = '0b0e4a53-3c1b-4b7e-9d0a-0d3f6f2a1c12';
  // The re-check at 14:29 tripped both trend rules: two flags, one alert.
  const newestFirst: TimelineEntry[] = [
    { type: 'flag_acknowledged', at: at(31), flagId: id, by: 'nurse@clinic.org' },
    { type: 'flag_opened', at: at(30), flagId: id, rule: 'baseline_shift', handoff: 'Patient 14: pulse 82 at check-in, 108 now.', alertId: 'trend-14-1' },
    { type: 'flag_opened', at: at(30), flagId: other, rule: 'score_rise', handoff: 'Patient 14: pulse 82 at check-in, 108 now.', alertId: 'trend-14-1' },
    { type: 'sitting', at: at(29), sittingId: id, kind: 'recheck', source: 'simulated', heartRate: 108.4, breathingRate: null, score: 1 },
    { type: 'sitting', at: at(15), sittingId: id, kind: 'recheck', source: 'camera', heartRate: null, breathingRate: null, score: null },
    { type: 'sitting', at: at(2), sittingId: id, kind: 'check_in', source: 'camera', heartRate: 82, breathingRate: 16, score: 0 },
    { type: 'created', at: at(0) },
  ];
  const rows = timelineRows(newestFirst);

  assert.deepEqual(
    rows.map((row) => `${row.time} ${row.title}`),
    ['14:00 Patient created', '14:02 Check-in sitting', '14:15 Re-check', '14:29 Re-check', '14:30 Flag opened', '14:31 Flag acknowledged'],
  );
  assert.deepEqual(rows[1]!.vitals, { pulse: '82', breathing: '16', score: 0 });

  // The failed sitting stays in the record, as "No reading".
  assert.equal(rows[2]!.state, 'no-reading');
  assert.equal(rows[2]!.vitals, null);
  assert.ok(rows[2]!.note);

  // One parameter measured: the other is null, which the timeline prints as "No reading".
  assert.deepEqual(rows[3]!.vitals, { pulse: '108', breathing: null, score: 1 });
  assert.equal(rows[3]!.sourceLabel, 'Simulated');

  // A lower-confidence pulse keeps its number and carries the tag; without the field there is none.
  const weak = timelineRows([
    { type: 'sitting', at: at(40), sittingId: id, kind: 'recheck', source: 'camera', heartRate: 101.5, heartRateConfidence: 'low', breathingRate: null, score: null },
    { type: 'sitting', at: at(35), sittingId: id, kind: 'recheck', source: 'camera', heartRate: 84, heartRateConfidence: 'normal', breathingRate: null, score: 0 },
  ]);
  assert.deepEqual(weak[1]!.vitals, { pulse: '102', pulseNote: 'Lower confidence', breathing: null, score: null });
  assert.deepEqual(weak[0]!.vitals, { pulse: '84', breathing: null, score: 0 });

  assert.equal(rows[4]!.state, 'flag');
  assert.equal(rows[4]!.note, 'Patient 14: pulse 82 at check-in, 108 now.');
  // One deterioration is told once, not as two identical rows.
  assert.equal(rows.filter((row) => row.title === 'Flag opened').length, 1);
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  // Who acknowledged is never printed by name.
  assert.equal(JSON.stringify(rows[5]).includes('nurse@clinic.org'), false);
});

test('overdue and discharge events have their own rows', () => {
  const id = '0b0e4a53-3c1b-4b7e-9d0a-0d3f6f2a1c11';
  const at = new Date(2026, 10, 14, 16, 0).toISOString();
  const rows = timelineRows([
    { type: 'discharged', at },
    { type: 'flag_closed', at, flagId: id, rule: 'overdue', alertId: id },
    { type: 'flag_opened', at, flagId: id, rule: 'overdue', handoff: 'Patient 9: last observed 31 min ago.', alertId: id },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.title, row.state]),
    [
      ['Re-check overdue', 'overdue'],
      ['Overdue cleared', 'observed'],
      ['Discharged', 'observed'],
    ],
  );
});
