/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EXPOSURE_STUCK, EXPOSURE_STUCK_AFTER_SECONDS, HELD_READING_FOR_MS, type Estimate } from '@triagecam/contracts';
import type { CaptureSittingSummary, VariabilityReason } from 'triage-capture';

import { ReasonTally, hasLowConfidencePulse, nextLastValid, readoutFor, summaryItems, viewfinderHint, type LastValid } from './readingFormat.ts';

const estimate = (patch: Partial<Estimate>): Estimate => ({
  value: null,
  state: 'none',
  reason: 'low_quality',
  quality: 0.2,
  coverage: 0.4,
  ageMs: null,
  ...patch,
});

test('a valid estimate shows its rounded value and where it came from', () => {
  const model = readoutFor(estimate({ value: 71.6, state: 'valid', reason: null }), 'camera', null, 0);
  assert.deepEqual(model, { state: 'valid', value: '72', foot: 'Camera, measured this second' });
  const stub = readoutFor(estimate({ value: 72, state: 'valid', reason: null }), 'stub', null, 0);
  assert.equal(stub.foot, 'Stub script, not a measurement');
});

test('no reading carries the reason and no value when the sitting has had none', () => {
  const model = readoutFor(estimate({ reason: 'no_face' }), 'camera', null, 1000);
  assert.deepEqual(model, { state: 'none', foot: 'Face not in view' });
});

test('a reading that is lost stays in its box, and says how old it is after a few seconds', () => {
  const last = { value: 79.6, atMs: 10_000 };
  assert.deepEqual(readoutFor(estimate({ reason: 'no_face' }), 'camera', last, 11_000), {
    state: 'held',
    value: '80',
    age: null,
    foot: 'Face not in view',
  });
  assert.deepEqual(readoutFor(estimate({ reason: 'motion' }), 'camera', last, 18_200), {
    state: 'held',
    value: '80',
    age: '8 s ago',
    foot: 'Too much movement. Keep still',
  });
  // Waiting for windows to agree again is no reason to empty the box either.
  const settling = readoutFor(estimate({ state: 'settling', reason: 'awaiting_agreement' }), 'camera', last, 14_000);
  assert.deepEqual([settling.state, 'age' in settling ? settling.age : null], ['held', '4 s ago']);
});

test('a fresh reading clears the age label', () => {
  const model = readoutFor(estimate({ value: 82, state: 'valid', reason: null }), 'camera', { value: 79.6, atMs: 10_000 }, 30_000);
  assert.deepEqual(model, { state: 'valid', value: '82', foot: 'Camera, measured this second' });
});

test('a value is held for the rest of a sitting and no longer', () => {
  const last = { value: 72, atMs: 5_000 };
  const lost = estimate({ reason: 'low_quality' });
  assert.equal(readoutFor(lost, 'camera', last, 5_000 + 55_000).state, 'held');
  assert.equal(readoutFor(lost, 'camera', last, 5_000 + HELD_READING_FOR_MS + 1).state, 'none');
});

test('settling says what it is waiting for', () => {
  assert.equal(readoutFor(estimate({ state: 'settling', reason: 'warming_up' }), 'camera', null, 0).foot, 'Collecting the first seconds of signal');
  assert.equal(readoutFor(null, 'camera', null, 0).state, 'settling');
});

test('a camera that stops sending frames keeps the last value, with its age and the reason', () => {
  const stale = estimate({ state: 'stale', reason: 'no_frames' });
  const last = { value: 76.2, atMs: 10_000 };
  assert.deepEqual(readoutFor(stale, 'camera', last, 14_000), {
    state: 'held',
    value: '76',
    age: '4 s ago',
    foot: 'The camera stopped sending frames',
  });
  assert.deepEqual(readoutFor(stale, 'camera', null, 14_000), { state: 'none', foot: 'The camera stopped sending frames' });
});

test('the summary names the main reason a measurement failed and tags variability experimental', () => {
  const tally = new ReasonTally();
  tally.add('breathingRate', estimate({ reason: 'no_chest' }));
  tally.add('breathingRate', estimate({ reason: 'no_chest' }));
  tally.add('breathingRate', estimate({ reason: 'motion' }));
  tally.add('heartRate', estimate({ value: 72, state: 'valid', reason: null }));
  assert.equal(tally.main('breathingRate'), 'no_chest');
  assert.equal(tally.main('heartRate'), null);

  const summary: CaptureSittingSummary = {
    durationSeconds: 60,
    frameCount: 3600,
    droppedFrames: 2,
    heartRate: { value: 72.4, coverage: 0.81, reason: null },
    breathingRate: { value: null, coverage: 0.1, reason: 'no_chest' },
    rmssd: { value: 41.7, coverage: 0.7, reason: null },
    sdnn: { value: null, coverage: 0.2, reason: 'low_beat_coverage' },
    beatIntervals: [],
    timeToFirstReadingSeconds: 11,
    longestDropoutSeconds: 3,
  };
  const items = summaryItems(summary, { heartRate: tally.main('heartRate'), breathingRate: tally.main('breathingRate') });
  assert.deepEqual(
    items.map((item) => [item.key, item.value, item.unit, item.experimental]),
    [
      ['heartRate', '72', 'bpm', false],
      ['breathingRate', null, 'per min', false],
      ['rmssd', '42', 'ms', true],
      ['sdnn', null, 'ms', true],
    ],
  );
  assert.equal(items[0]!.reason, null);
  assert.equal(items[1]!.reason, 'Chest not in view for most of the sitting');
  assert.equal(items[3]!.reason, 'Clean beats covered too little of the sitting');
  assert.equal(items[1]!.coverage, 0.1);
});

test('a lower-confidence heart rate says so in place of "Median of this sitting"', () => {
  const none = { value: null, coverage: 0, reason: 'no_heart_rate' } as const;
  const summary = (heartRateConfidence: 'normal' | 'low' | null | undefined, value: number | null = 101.5): CaptureSittingSummary => ({
    durationSeconds: 60,
    frameCount: 3600,
    droppedFrames: 0,
    heartRate: { value, coverage: 0.05, reason: value === null ? 'too_few_readings' : null },
    breathingRate: { value: null, coverage: 0, reason: 'no_chest' },
    rmssd: none,
    sdnn: none,
    beatIntervals: [],
    timeToFirstReadingSeconds: 9,
    longestDropoutSeconds: 49,
    heartRateConfidence,
  });
  const note = (s: CaptureSittingSummary) => summaryItems(s, { heartRate: null, breathingRate: null })[0]!.note;
  assert.equal(note(summary('low')), 'Lower confidence. Too little of the sitting gave a clear pulse. Not used for trends or flags. Repeat the sitting.');
  assert.equal(hasLowConfidencePulse(summary('low')), true);
  // Normal, null and a capture module from before the field existed all read as an ordinary rate.
  for (const confidence of ['normal', null, undefined] as const) {
    assert.equal(note(summary(confidence)), undefined);
    assert.equal(hasLowConfidencePulse(summary(confidence)), false);
  }
  // No heart rate: nothing to qualify.
  assert.equal(hasLowConfidencePulse(summary('low', null)), false);
  assert.equal(note(summary('low', null)), undefined);
});

test('a withheld RMSSD or SDNN gives the reason the engine gave', () => {
  const value = (reason: VariabilityReason) => ({ value: null, coverage: 0.94, reason });
  const reasonFor = (reason: VariabilityReason, heartRate: number | null) =>
    summaryItems(
      {
        durationSeconds: 60,
        frameCount: 3600,
        droppedFrames: 0,
        heartRate: { value: heartRate, coverage: 0.88, reason: heartRate === null ? 'no_face' : null },
        breathingRate: { value: 16, coverage: 0.5, reason: null },
        rmssd: value(reason),
        sdnn: value(reason),
        beatIntervals: [],
        timeToFirstReadingSeconds: 7,
        longestDropoutSeconds: 0,
      },
      { heartRate: null, breathingRate: null },
    )
      .filter((item) => item.experimental)
      .map((item) => item.reason);

  // 68 accepted intervals at 94% coverage, withheld for timing noise: not "too few beats".
  assert.deepEqual(reasonFor('low_quality', 72), Array(2).fill('Single beats could not be timed precisely enough'));
  assert.deepEqual(reasonFor('too_few_beats', 72), Array(2).fill('Too few clean beats in this sitting to report'));
  assert.deepEqual(reasonFor('low_beat_coverage', 72), Array(2).fill('Clean beats covered too little of the sitting'));
  assert.deepEqual(reasonFor('no_heart_rate', null), Array(2).fill('Needs a pulse reading first'));
});

test('exposure that will not settle says what to do about it (QA round 3, R5)', () => {
  assert.equal(viewfinderHint('locking', 0), undefined);
  assert.equal(viewfinderHint('locking', EXPOSURE_STUCK_AFTER_SECONDS - 1), undefined);
  assert.equal(viewfinderHint('locking', EXPOSURE_STUCK_AFTER_SECONDS), `${EXPOSURE_STUCK}.`);
  assert.match(viewfinderHint('locking', 60) ?? '', /move the light\.$/);
  // Only while the camera is trying to lock on a face.
  for (const state of ['searching', 'measuring', 'lost'] as const) assert.equal(viewfinderHint(state, 60), undefined);
});

test('a held value is let go after five seconds with nobody in the picture, and stays gone', () => {
  let held: LastValid | null = nextLastValid(null, estimate({ value: 72, state: 'valid', reason: null }), 10_000);
  assert.deepEqual(held, { value: 72, atMs: 10_000 });
  for (let second = 1; second <= 5; second++) {
    held = nextLastValid(held, estimate({ reason: 'no_face' }), 10_000 + second * 1000);
    assert.equal(held?.value, 72, `second ${second}`);
    assert.equal(held?.atMs, 10_000);
  }
  held = nextLastValid(held, estimate({ reason: 'no_face' }), 16_000);
  assert.equal(held, null);
  // Someone sits down again: nothing to hold until the next value.
  held = nextLastValid(held, estimate({ reason: 'low_quality' }), 17_000);
  assert.equal(held, null);
  assert.equal(readoutFor(estimate({ reason: 'low_quality' }), 'camera', held, 17_000).state, 'none');
  held = nextLastValid(held, estimate({ value: 80, state: 'valid', reason: null }), 18_000);
  assert.deepEqual(held, { value: 80, atMs: 18_000 });
});

test('dropouts with the person in view keep the held value, and a short look away starts the count again', () => {
  let held: LastValid | null = { value: 72, atMs: 0 };
  let t = 0;
  for (let round = 0; round < 6; round++) {
    for (let second = 0; second < 4; second++) held = nextLastValid(held, estimate({ reason: 'no_face' }), (t += 1000));
    held = nextLastValid(held, estimate({ reason: 'motion' }), (t += 1000));
    assert.deepEqual(held, { value: 72, atMs: 0 });
  }
  for (let second = 0; second < 20; second++) held = nextLastValid(held, estimate({ state: 'settling', reason: 'awaiting_agreement' }), (t += 1000));
  assert.deepEqual(held, { value: 72, atMs: 0 });
  // Breathing is let go by a chest out of view in the same way.
  let breath: LastValid | null = { value: 15, atMs: 0 };
  for (let second = 0; second <= 5; second++) breath = nextLastValid(breath, estimate({ reason: 'no_chest' }), 1000 + second * 1000);
  assert.equal(breath, null);
});

test('a vital shown live and not recorded says so in the summary, and gets no value', () => {
  const tally = new ReasonTally();
  tally.add('breathingRate', estimate({ state: 'settling', reason: 'warming_up' }));
  tally.add('breathingRate', estimate({ value: 16, state: 'valid', reason: null }));
  tally.add('breathingRate', estimate({ reason: 'low_quality' }));
  tally.add('breathingRate', estimate({ reason: 'low_quality' }));
  tally.add('heartRate', estimate({ reason: 'no_face' }));
  assert.equal(tally.wasShown('breathingRate'), true);
  assert.equal(tally.wasShown('heartRate'), false);

  const none = { value: null, coverage: 0, reason: 'no_heart_rate' } as const;
  const summary: CaptureSittingSummary = {
    durationSeconds: 60,
    frameCount: 3600,
    droppedFrames: 0,
    heartRate: { value: null, coverage: 0, reason: 'no_face' },
    breathingRate: { value: null, coverage: 0, reason: 'too_few_readings' },
    rmssd: none,
    sdnn: none,
    beatIntervals: [],
    timeToFirstReadingSeconds: null,
    longestDropoutSeconds: 60,
  };
  const reasons = { heartRate: tally.main('heartRate'), breathingRate: tally.main('breathingRate') };
  const items = summaryItems(summary, reasons, { heartRate: tally.wasShown('heartRate'), breathingRate: tally.wasShown('breathingRate') });
  assert.equal(items[1]!.value, null);
  assert.equal(items[1]!.reason, 'Shown live, not steady long enough to record. Repeat the sitting');
  assert.equal(items[0]!.reason, 'Face not in view for most of the sitting');
  // Without the flag (a sitting finished by an older build of the screen) the reason is the usual one.
  assert.equal(summaryItems(summary, reasons)[1]!.reason, 'Signal too weak. Keep still, more light');
});
