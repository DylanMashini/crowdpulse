import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HELD_READING_FOR_MS, type Estimate, type StoredReading } from '@triagecam/contracts';

import { liveReadout } from './live-readout.ts';

const START = Date.parse('2026-11-14T03:21:00.000Z');

const valid = (value: number): Estimate => ({ value, state: 'valid', reason: null, quality: 0.8, coverage: 0.5, ageMs: 0 });
const none = (reason: Estimate['reason'] = 'low_quality', state: Estimate['state'] = 'none'): Estimate => ({
  value: null,
  state,
  reason,
  quality: 0.2,
  coverage: 0.5,
  ageMs: null,
});

/** One reading a second from the start of the sitting. */
function sitting(estimates: Array<[Estimate, Estimate]>): StoredReading[] {
  return estimates.map(([heartRate, breathingRate], second) => ({
    t: new Date(START + (second + 1) * 1000).toISOString(),
    heartRate,
    breathingRate,
  }));
}

const heart = (reading: StoredReading) => reading.heartRate;
const breathing = (reading: StoredReading) => reading.breathingRate;
/** The server clock a moment after the newest reading. */
const justAfter = (readings: StoredReading[]) => new Date(readings.at(-1)!.t).getTime() + 200;

test('a new sitting starts empty', () => {
  assert.equal(liveReadout([], heart, START).state, 'settling');
  const settling = sitting([[none('warming_up', 'settling'), none('warming_up', 'settling')]]);
  const box = liveReadout(settling, heart, justAfter(settling));
  assert.equal(box.state, 'settling');
  assert.equal(box.value, undefined);
});

test('a fresh reading shows with no age label', () => {
  const readings = sitting([[valid(71.6), none('warming_up', 'settling')]]);
  const box = liveReadout(readings, heart, justAfter(readings));
  assert.equal(box.state, 'valid');
  assert.equal(box.value, '72');
  assert.equal(box.heldAge, undefined);
});

test('a reading that is lost stays in its box, and says how old it is after a few seconds', () => {
  const lost: Array<[Estimate, Estimate]> = [[valid(72), none()]];
  for (let second = 1; second <= 8; second++) {
    lost.push([none('motion'), none()]);
    const readings = sitting(lost);
    const box = liveReadout(readings, heart, justAfter(readings));
    assert.equal(box.state, 'held');
    assert.equal(box.value, '72');
    assert.equal(box.reason, 'Too much movement. Keep still');
    assert.equal(box.heldAge, second < 3 ? undefined : `${second} s ago`);
  }
});

test('a fresh reading clears the age label and takes the place of the held value', () => {
  const readings = sitting([[valid(72), none()], [none(), none()], [none(), none()], [none(), none()], [none(), none()], [valid(75), none()]]);
  const box = liveReadout(readings, heart, justAfter(readings));
  assert.equal(box.state, 'valid');
  assert.equal(box.value, '75');
  assert.equal(box.heldAge, undefined);
});

test('heart rate and breathing rate hold independently', () => {
  const readings = sitting([
    [valid(72), none('warming_up', 'settling')],
    [none(), none('warming_up', 'settling')],
    [none(), none('warming_up', 'settling')],
    [none(), none('warming_up', 'settling')],
    [none(), valid(15.2)],
    [valid(74), none('no_chest')],
  ]);
  const now = justAfter(readings);
  assert.deepEqual(
    [liveReadout(readings, heart, now).state, liveReadout(readings, heart, now).value],
    ['valid', '74'],
  );
  const breath = liveReadout(readings, breathing, now);
  assert.equal(breath.state, 'held');
  assert.equal(breath.value, '15');
  assert.equal(breath.heldAge, undefined);
  // Before breathing had a value, a held heart rate did not put one in the breathing box.
  const earlier = readings.slice(0, 4);
  assert.equal(liveReadout(earlier, breathing, justAfter(earlier)).state, 'settling');
  assert.equal(liveReadout(earlier, heart, justAfter(earlier)).heldAge, '3 s ago');
});

test('a phone that goes quiet keeps the value, aged by the server clock', () => {
  const readings = sitting([[valid(72), none()], [valid(73), none()]]);
  const at = new Date(readings.at(-1)!.t).getTime();
  const box = liveReadout(readings, heart, at + 9_000);
  assert.equal(box.state, 'held');
  assert.equal(box.value, '73');
  assert.equal(box.heldAge, '9 s ago');
  assert.equal(box.reason, 'No readings from the phone since 9 s ago');
});

test('a phone whose clock is off does not age a fresh value', () => {
  const readings = sitting([[valid(72), none()], [none(), none()]]);
  // The phone's clock runs 20 s behind the server's: the reading is still one second old.
  const box = liveReadout(readings, heart, justAfter(readings) - 20_000);
  assert.equal(box.state, 'held');
  assert.equal(box.heldAge, undefined);
});

test('a value is not held for longer than a sitting lasts', () => {
  const readings = sitting([[valid(72), none()]]);
  const at = new Date(readings.at(-1)!.t).getTime();
  assert.equal(liveReadout(readings, heart, at + HELD_READING_FOR_MS - 1000).state, 'held');
  const gone = liveReadout(readings, heart, at + HELD_READING_FOR_MS + 1000);
  assert.equal(gone.state, 'none');
  assert.equal(gone.value, undefined);
});

test('reloading the page during a sitting shows the same box: it is built from the readings alone', () => {
  const readings = sitting([[valid(72), none()], [none(), none()], [none(), none()], [none(), none()], [none(), none()]]);
  const now = justAfter(readings);
  // What the server hands a page that loads now is the same list the stream built up.
  const reloaded = JSON.parse(JSON.stringify(readings)) as StoredReading[];
  assert.deepEqual(liveReadout(reloaded, heart, now), liveReadout(readings, heart, now));
  assert.equal(liveReadout(reloaded, heart, now).heldAge, '4 s ago');
});
