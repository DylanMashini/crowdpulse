import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CreatePatientRequest,
  ErrorCode,
  Estimate,
  type Flag,
  FrameRecord,
  Reading,
  Settings,
  SittingSummary,
  StreamEvent,
  UpdatePatientRequest,
  patientLabel,
  defaultSettings,
  errorStatus,
  flagAlerts,
} from './index.ts';

test('a frame record line written by SignalEngine parses', () => {
  const line =
    '{"chestMotion":-0.001,"droppedFrames":2,"exposure":"locked","facePresent":true,"faceTrackId":7,' +
    '"forehead":{"b":3,"g":2,"r":1},"leftCheek":{"b":6,"g":5,"r":4},"rightCheek":{"b":9,"g":8,"r":7},"t":12.5}';
  assert.equal(FrameRecord.parse(JSON.parse(line)).faceTrackId, 7);
  assert.ok(FrameRecord.safeParse({ t: 1, facePresent: false, exposure: 'adjusting', droppedFrames: 0 }).success);
});

test('an estimate carries a value only when valid', () => {
  const base = { quality: 0.8, coverage: 0.5, ageMs: 0 };
  assert.ok(Estimate.safeParse({ ...base, value: 72, state: 'valid', reason: null }).success);
  assert.ok(!Estimate.safeParse({ ...base, value: 72, state: 'stale', reason: 'no_frames' }).success);
  assert.ok(!Estimate.safeParse({ ...base, value: null, state: 'valid', reason: null }).success);
  assert.ok(Estimate.safeParse({ ...base, value: null, state: 'none', reason: 'low_quality', ageMs: null }).success);
});

test('a reading and a summary as the engine encodes them parse', () => {
  const none = { value: null, state: 'settling', reason: 'warming_up', quality: 0, coverage: 0, ageMs: null };
  assert.ok(
    Reading.safeParse({ t: '2026-11-14T03:21:07.512Z', elapsedMs: 1000, heartRate: none, breathingRate: none }).success,
  );
  const empty = { value: null, coverage: 0 };
  assert.ok(
    SittingSummary.safeParse({
      durationSeconds: 59.98,
      frameCount: 3600,
      droppedFrames: 0,
      heartRate: { value: 72.4, coverage: 0.86 },
      breathingRate: empty,
      rmssd: empty,
      sdnn: empty,
      beatIntervals: [{ tMs: 5830, ms: 832.5 }],
      timeToFirstReadingSeconds: 11,
      longestDropoutSeconds: 3,
    }).success,
  );
});

test('timestamps must be UTC', () => {
  const event = { type: 'worklist_changed', at: '2026-11-14T03:21:07+01:00' };
  assert.ok(!StreamEvent.safeParse(event).success);
  assert.ok(StreamEvent.safeParse({ ...event, at: '2026-11-14T02:21:07Z' }).success);
});

test('every error code has a status and the default settings are valid', () => {
  for (const code of ErrorCode.options) assert.ok(errorStatus[code] >= 400);
  assert.deepEqual(Settings.parse(defaultSettings), defaultSettings);
});

test('intake text is trimmed, an empty box clears the field, and a left-out field is left alone', () => {
  assert.deepEqual(CreatePatientRequest.parse({}), { faceOptIn: false });
  const update = UpdatePatientRequest.parse({ name: '  Maya Chen ', reasonForVisit: '   ', painScore: 4 });
  assert.deepEqual(update, { name: 'Maya Chen', reasonForVisit: null, painScore: 4 });
  assert.ok(!('notes' in update));
  assert.ok(!UpdatePatientRequest.safeParse({ painScore: 11 }).success);
  assert.ok(!UpdatePatientRequest.safeParse({ dateOfBirth: '14/11/1990' }).success);
  assert.ok(UpdatePatientRequest.safeParse({ dateOfBirth: '1990-11-14', sex: 'female' }).success);
  // A date of birth is in the past, and not before 1900.
  assert.ok(!UpdatePatientRequest.safeParse({ dateOfBirth: '2099-01-01' }).success);
  assert.ok(!UpdatePatientRequest.safeParse({ dateOfBirth: '1800-01-01' }).success);
  assert.ok(UpdatePatientRequest.safeParse({ dateOfBirth: new Date().toISOString().slice(0, 10) }).success);
  assert.ok(UpdatePatientRequest.safeParse({ dateOfBirth: null }).success);
});

test('a patient without a name is called by their number', () => {
  assert.equal(patientLabel({ number: 14, name: null }), 'Patient 14');
  assert.equal(patientLabel({ number: 14, name: '  ' }), 'Patient 14');
  assert.equal(patientLabel({ number: 14, name: 'Maya Chen' }), 'Maya Chen');
});

const flag = (id: string, rule: Flag['rule'], alertId: string, over: Partial<Flag> = {}): Flag => ({
  id,
  patientNumber: 14,
  patient: { number: 14, name: 'Maya Chen', photoUpdatedAt: null },
  rule,
  openedAt: '2026-11-14T14:02:00.000Z',
  closedAt: null,
  detail: {
    pulse: { base: 82, now: 108 },
    breathing: { base: 16, now: 24 },
    scoreAtCheckIn: 0,
    scoreNow: 2,
    minutesSinceCheckIn: 26,
    minutesSinceObserved: null,
  },
  acknowledgedAt: null,
  acknowledgedBy: null,
  handoff: 'Maya Chen: pulse 82 bpm at check-in, 108 bpm now.',
  alertId,
  ...over,
});

test('flags that share an alert id are one alert, and an alert waits until all of them are acknowledged', () => {
  const rise = flag('a', 'score_rise', 'trend-14-1');
  const shift = flag('b', 'baseline_shift', 'trend-14-1');
  const overdue = flag('c', 'overdue', 'c');
  const later = flag('d', 'score_rise', 'trend-14-2', { openedAt: '2026-11-14T14:30:00.000Z' });

  const alerts = flagAlerts([rise, shift, overdue, later]);
  assert.deepEqual(alerts.map((alert) => alert.flags.map((each) => each.id)), [['a', 'b'], ['c'], ['d']]);
  assert.equal(alerts[0]?.lead, rise);
  assert.deepEqual(alerts[0]?.waiting, [rise, shift]);
  assert.equal(alerts[0]?.acknowledgedAt, null);
  assert.equal(alerts[0]?.closedAt, null);

  // Half acknowledged is still waiting; the acknowledgement that completes it is the alert's.
  const first = { acknowledgedAt: '2026-11-14T14:05:00.000Z', acknowledgedBy: 'one@ward.test' };
  const second = { acknowledgedAt: '2026-11-14T14:06:00.000Z', acknowledgedBy: 'two@ward.test' };
  const [half] = flagAlerts([flag('a', 'score_rise', 'x', first), flag('b', 'baseline_shift', 'x')]);
  assert.equal(half?.acknowledgedAt, null);
  assert.deepEqual(half?.waiting.map((each) => each.id), ['b']);
  const [whole] = flagAlerts([flag('a', 'score_rise', 'x', first), flag('b', 'baseline_shift', 'x', second)]);
  assert.equal(whole?.acknowledgedAt, second.acknowledgedAt);
  assert.equal(whole?.acknowledgedBy, 'two@ward.test');
  assert.deepEqual(whole?.waiting, []);

  // A closed flag is not waiting, and an alert is closed only when all of its flags are.
  const closedAt = '2026-11-14T15:00:00.000Z';
  const [partly] = flagAlerts([flag('a', 'score_rise', 'x', { closedAt }), flag('b', 'baseline_shift', 'x')]);
  assert.equal(partly?.closedAt, null);
  assert.deepEqual(partly?.waiting.map((each) => each.id), ['b']);
  assert.equal(flagAlerts([flag('a', 'score_rise', 'x', { closedAt })])[0]?.closedAt, closedAt);
  assert.deepEqual(flagAlerts([]), []);
});
