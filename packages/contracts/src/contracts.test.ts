import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CameraState,
  CreatePatientRequest,
  Device,
  LiveRegions,
  PostLiveStateRequest,
  SendCameraCommandRequest,
  routes,
  ErrorCode,
  Estimate,
  FLAG_RULE_ORDER,
  type Flag,
  FlagRule,
  FrameRecord,
  Reading,
  Settings,
  SittingSummary,
  StreamEvent,
  UpdatePatientRequest,
  patientLabel,
  defaultSettings,
  byFlagRule,
  isLowConfidence,
  summaryHeartRateConfidence,
  Trend,
  errorStatus,
  flagAlerts,
  timelineByAlert,
  type TimelineEntry,
} from './index.ts';

test('a frame record line written by SignalEngine parses', () => {
  const line =
    '{"chestMotion":-0.001,"droppedFrames":2,"exposure":"locked","facePresent":true,"faceTrackId":7,' +
    '"forehead":{"b":3,"g":2,"r":1},"leftCheek":{"b":6,"g":5,"r":4},"rightCheek":{"b":9,"g":8,"r":7},"t":12.5}';
  assert.equal(FrameRecord.parse(JSON.parse(line)).faceTrackId, 7);
  assert.ok(FrameRecord.safeParse({ t: 1, facePresent: false, exposure: 'adjusting', droppedFrames: 0 }).success);
});

test('a frame record with the face box and the camera settings parses, and they are optional', () => {
  const line =
    '{"droppedFrames":0,"exposure":"locked","exposureMs":8.3,"face":{"height":0.41,"width":0.28,"x":0.31,"y":0.22},' +
    '"facePresent":true,"faceTrackId":3,"iso":320,"t":12.5}';
  const frame = FrameRecord.parse(JSON.parse(line));
  assert.equal(frame.iso, 320);
  assert.equal(frame.face?.width, 0.28);
  assert.equal(FrameRecord.parse({ t: 1, facePresent: false, exposure: 'adjusting', droppedFrames: 0 }).face, undefined);
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
  // The confidence is additive: absent (older phone builds), null (no heart rate), or one of two values.
  const summary = {
    durationSeconds: 59.98,
    frameCount: 3600,
    droppedFrames: 0,
    heartRate: { value: 101.5, coverage: 0.05 },
    breathingRate: empty,
    rmssd: empty,
    sdnn: empty,
    beatIntervals: [],
    timeToFirstReadingSeconds: 9,
    longestDropoutSeconds: 49,
  };
  for (const heartRateConfidence of ['normal', 'low', null]) {
    const parsed = SittingSummary.safeParse({ ...summary, heartRateConfidence });
    assert.ok(parsed.success);
    assert.equal(parsed.data.heartRateConfidence, heartRateConfidence);
  }
  assert.equal(SittingSummary.parse(summary).heartRateConfidence, undefined);
  assert.equal(SittingSummary.safeParse({ ...summary, heartRateConfidence: 'high' }).success, false);
  assert.equal(isLowConfidence('low'), true);
  for (const other of ['normal', null, undefined] as const) assert.equal(isLowConfidence(other), false);
});

test('a summary without a confidence gets the engine\'s rule: fewer than ten valid seconds is low', () => {
  const empty = { value: null, coverage: 0 };
  const summary = (heartRate: { value: number | null; coverage: number }, durationSeconds = 60, heartRateConfidence?: 'normal' | 'low' | null) =>
    SittingSummary.parse({
      durationSeconds,
      frameCount: 1800,
      droppedFrames: 0,
      heartRate,
      breathingRate: empty,
      rmssd: empty,
      sdnn: empty,
      beatIntervals: [],
      timeToFirstReadingSeconds: null,
      longestDropoutSeconds: 0,
      ...(heartRateConfidence === undefined ? {} : { heartRateConfidence }),
    });

  // A phone build from before the field: a rate with no live readings behind it (QA round 2, B1).
  assert.equal(summaryHeartRateConfidence(summary({ value: 61.5, coverage: 0 })), 'low');
  // The owner's sitting: 3 valid seconds of 59.
  assert.equal(summaryHeartRateConfidence(summary({ value: 101.5, coverage: 3 / 59 }, 59.98)), 'low');
  // Nine is low and ten is normal, on the engine's count of one reading per whole second.
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 9 / 59 }, 59.98)), 'low');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 10 / 59 }, 59.98)), 'normal');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 9 / 60 }, 60)), 'low');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 10 / 60 }, 60)), 'normal');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 0.87 })), 'normal');
  // A sitting stopped early cannot reach ten readings.
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 1 }, 8.4)), 'low');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 1 }, 10)), 'normal');

  // A stated confidence is believed only as far as the sitting's own numbers bear it out: the
  // lower of what the phone says and what the rule makes of the summary (QA round 3, N2).
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 0 }, 60, 'normal')), 'low');
  assert.equal(summaryHeartRateConfidence(summary({ value: 102, coverage: 3 / 60 }, 60, 'normal')), 'low');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 9 / 59 }, 59.98, 'normal')), 'low');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 1 }, 8.4, 'normal')), 'low');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 10 / 59 }, 59.98, 'normal')), 'normal');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 0.87 }, 60, 'normal')), 'normal');
  // The phone may always say less than the numbers would: the engine knows why.
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 0.9 }, 60, 'low')), 'low');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 0 }, 60, 'low')), 'low');
  // A null beside a heart rate says nothing, so the rule applies.
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 0 }, 60, null)), 'low');
  assert.equal(summaryHeartRateConfidence(summary({ value: 72, coverage: 0.9 }, 60, null)), 'normal');
  // No heart rate, no confidence, whatever was sent.
  assert.equal(summaryHeartRateConfidence(summary(empty)), null);
  assert.equal(summaryHeartRateConfidence(summary(empty, 60, 'low')), null);
});

test('a trend may say where its baseline came from and carry a lower-confidence pulse', () => {
  assert.deepEqual(Trend.parse({ base: 82, now: 108 }), { base: 82, now: 108 });
  const later = { base: 55, now: 86, baseAt: '2026-11-14T15:42:00.000Z' };
  assert.deepEqual(Trend.parse(later), later);
  const weak = { base: null, now: null, lowConfidence: 101.5 };
  assert.deepEqual(Trend.parse(weak), weak);
  assert.ok(Trend.safeParse({ base: null, now: null, baseAt: null, lowConfidence: null }).success);
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

test('an alert names its rules in one order, whatever order the server listed its flags in', () => {
  const rise = flag('a', 'score_rise', 'trend-14-1');
  const shift = flag('b', 'baseline_shift', 'trend-14-1');
  for (const given of [[rise, shift], [shift, rise]]) {
    const [alert] = flagAlerts(given);
    assert.deepEqual(alert?.flags.map((each) => each.rule), ['score_rise', 'baseline_shift']);
    assert.equal(alert?.lead, rise);
    assert.deepEqual(alert?.waiting.map((each) => each.rule), ['score_rise', 'baseline_shift']);
  }
  assert.deepEqual([...FlagRule.options].reverse().sort(byFlagRule), FLAG_RULE_ORDER);
  // Every rule has a place in the order.
  assert.deepEqual([...FLAG_RULE_ORDER].sort(), [...FlagRule.options].sort());
});

test('the timeline tells an alert opening or closing once, however many rules it tripped', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const opened = (rule: Flag['rule'], alertId: string, at: string): TimelineEntry => ({ type: 'flag_opened', at, flagId: id, rule, handoff: 'h', alertId });
  const closed = (rule: Flag['rule'], alertId: string, at: string): TimelineEntry => ({ type: 'flag_closed', at, flagId: id, rule, alertId });
  const t = (minute: number) => `2026-11-14T14:${String(minute).padStart(2, '0')}:00.000Z`;
  const timeline: TimelineEntry[] = [
    closed('baseline_shift', 'trend-1', t(40)),
    closed('score_rise', 'trend-1', t(30)),
    opened('overdue', 'o', t(20)),
    { type: 'flag_acknowledged', at: t(12), flagId: id, by: 'nurse@ward.test' },
    opened('baseline_shift', 'trend-1', t(10)),
    opened('score_rise', 'trend-1', t(10)),
    opened('baseline_shift', 'trend-0', t(5)),
    closed('score_rise', 'trend-x', t(4)),
    closed('baseline_shift', 'trend-x', t(4)),
    { type: 'created', at: t(0) },
  ];
  const told = timelineByAlert(timeline);
  assert.deepEqual(
    told.map((entry) => `${entry.type} ${entry.at.slice(14, 16)}${'rule' in entry ? ` ${entry.rule}` : ''}`),
    [
      'flag_closed 40 baseline_shift',
      'flag_closed 30 score_rise',
      'flag_opened 20 overdue',
      'flag_acknowledged 12',
      'flag_opened 10 baseline_shift',
      'flag_opened 05 baseline_shift',
      'flag_closed 04 score_rise',
      'created 00',
    ],
  );
});

test('a camera phone reports its state and outlines, and a command names what it needs', () => {
  const idle = { phase: 'idle', patientNumber: null, kind: null, sittingId: null, viewfinder: null, facePresent: false, exposureLocked: false, error: null };
  assert.equal(PostLiveStateRequest.parse({ state: idle, regions: null }).state.phase, 'idle');

  const square = [{ x: 0.4, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.6, y: 0.3 }, { x: 0.4, y: 0.3 }];
  const regions = {
    aspectRatio: 4 / 3,
    face: { x: 0.35, y: 0.15, width: 0.3, height: 0.5 },
    forehead: square,
    leftCheek: square,
    rightCheek: square,
    chest: null,
  };
  const framing = { ...idle, phase: 'framing', patientNumber: 14, kind: 'check_in', viewfinder: 'locking', facePresent: true };
  assert.equal(PostLiveStateRequest.parse({ state: framing, regions }).regions?.forehead?.length, 4);
  // A polygon is a closed shape: two points are not one.
  assert.equal(LiveRegions.safeParse({ ...regions, forehead: square.slice(0, 2) }).success, false);
  assert.equal(CameraState.safeParse({ ...idle, phase: 'dancing' }).success, false);

  assert.equal(SendCameraCommandRequest.safeParse({ type: 'open' }).success, false);
  assert.equal(SendCameraCommandRequest.safeParse({ type: 'open', patientNumber: 14, kind: 'check_in' }).success, true);
  assert.equal(SendCameraCommandRequest.safeParse({ type: 'start' }).success, true);
  assert.equal(SendCameraCommandRequest.safeParse({ type: 'reboot' }).success, false);

  // A device from a server that predates the field has no camera state.
  const device = { id: '6f1d1c6e-3c0a-4f5e-9a51-0d6a3b1f2c11', role: 'camera', label: 'Front desk phone', hasPushToken: false, lastSeenAt: '2026-11-14T03:21:07.512Z', liveAt: null };
  assert.equal(Device.parse(device).camera, null);
  assert.equal(Device.parse({ ...device, camera: framing }).camera?.phase, 'framing');
  assert.equal(StreamEvent.parse({ type: 'camera_state', deviceId: device.id, state: null }).type, 'camera_state');
  assert.equal(routes.liveState(device.id), `/api/live/${device.id}/state`);
});

test('a held reading carries its age only once it is no longer fresh', async () => {
  const { HELD_READING_LABEL_AFTER_MS, heldReadingAge } = await import('./copy.ts');
  assert.equal(heldReadingAge(0), null);
  assert.equal(heldReadingAge(HELD_READING_LABEL_AFTER_MS - 1), null);
  assert.equal(heldReadingAge(HELD_READING_LABEL_AFTER_MS), '3 s ago');
  assert.equal(heldReadingAge(8_400), '8 s ago');
  assert.equal(heldReadingAge(52_000), '52 s ago');
  assert.equal(heldReadingAge(Number.NaN), null);
});

test('only "no face" and "no chest" say that nobody is in the picture', async () => {
  const { EstimateReason } = await import('./signal.ts');
  const { isAbsentReason, HELD_READING_CLEARS_AFTER_ABSENT_MS, HELD_READING_LABEL_AFTER_MS, SHOWN_NOT_RECORDED } = await import('./copy.ts');
  assert.deepEqual(EstimateReason.options.filter(isAbsentReason), ['no_face', 'no_chest']);
  assert.equal(isAbsentReason(null), false);
  // A brief dropout gets its age label before the box would ever be emptied.
  assert.ok(HELD_READING_CLEARS_AFTER_ABSENT_MS > HELD_READING_LABEL_AFTER_MS);
  assert.match(SHOWN_NOT_RECORDED, /^Shown live, .*Repeat the sitting$/);
});


test('a check-in falls back to the median of the readings shown live, and never to a made-up number', async () => {
  const { liveReadingFallback, Sitting } = await import('./sittings.ts');
  const { FROM_LIVE_READINGS, FROM_LIVE_READINGS_DETAIL } = await import('./copy.ts');
  assert.equal(liveReadingFallback([]), null);
  assert.equal(liveReadingFallback([null, undefined, Number.NaN]), null);
  assert.equal(liveReadingFallback([null, 71.5, null]), 71.5);
  assert.equal(liveReadingFallback([80, null, 70, 74]), 74);
  assert.equal(liveReadingFallback([80, 70, 74, 76]), 75);
  assert.doesNotMatch(`${FROM_LIVE_READINGS} ${FROM_LIVE_READINGS_DETAIL}`, /repeat/i);
  // Additive: a summary without the two fields still parses, and so does one with them.
  const summary = Sitting.shape.summary.unwrap();
  const base = {
    durationSeconds: 60,
    heartRate: { value: 72, coverage: 0 },
    breathingRate: { value: null, coverage: 0 },
    rmssd: { value: null, coverage: 0 },
    sdnn: { value: null, coverage: 0 },
    timeToFirstReadingSeconds: null,
    longestDropoutSeconds: 60,
    frameCount: 3600,
    droppedFrames: 0,
  };
  assert.ok(summary.safeParse(base).success);
  assert.ok(summary.safeParse({ ...base, heartRateFromLive: true, breathingRateFromLive: false }).success);
});
