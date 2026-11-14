import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CreatePatientRequest,
  ErrorCode,
  Estimate,
  FrameRecord,
  Reading,
  Settings,
  SittingSummary,
  StreamEvent,
  UpdatePatientRequest,
  patientLabel,
  defaultSettings,
  errorStatus,
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
