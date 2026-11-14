/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Estimate } from '@triagecam/contracts';
import type { CaptureSittingSummary, VariabilityReason } from 'triage-capture';

import { ReasonTally, STALE_BLANK_AFTER_MS, readoutFor, summaryItems } from './readingFormat.ts';

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

test('no reading carries the reason and never a value', () => {
  const model = readoutFor(estimate({ reason: 'no_face' }), 'camera', { value: 80, atMs: 0 }, 1000);
  assert.deepEqual(model, { state: 'none', foot: 'Face not in view' });
});

test('settling says what it is waiting for', () => {
  assert.equal(readoutFor(estimate({ state: 'settling', reason: 'warming_up' }), 'camera', null, 0).foot, 'Collecting the first seconds of signal');
  assert.equal(readoutFor(null, 'camera', null, 0).state, 'settling');
});

test('stale strikes the last accepted value with its age, then blanks it', () => {
  const stale = estimate({ state: 'stale', reason: 'no_frames' });
  const last = { value: 76.2, atMs: 10_000 };
  assert.deepEqual(readoutFor(stale, 'camera', last, 14_000), {
    state: 'stale',
    value: '76',
    foot: 'Stale, last reading 4 s ago',
  });
  assert.deepEqual(readoutFor(stale, 'camera', last, 10_000 + STALE_BLANK_AFTER_MS), {
    state: 'none',
    foot: 'The camera stopped sending frames',
  });
  assert.equal(readoutFor(stale, 'camera', null, 14_000).state, 'none');
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
