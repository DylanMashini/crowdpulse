import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HELD_READING_FOR_MS, SHOWN_NOT_RECORDED, type Estimate, type StoredReading } from '@triagecam/contracts';

import { coverageIsShown, liveReadout, noSummaryReason } from './live-readout.ts';

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

test('a value is let go once nobody has been in the picture for five seconds, and stays gone', () => {
  const run: Array<[Estimate, Estimate]> = [[valid(72), none()]];
  // Seconds 1 to 5 of an empty chair span four seconds: still held, with its age.
  for (let second = 1; second <= 5; second++) run.push([none('no_face'), none()]);
  let readings = sitting(run);
  assert.equal(liveReadout(readings, heart, justAfter(readings)).state, 'held');
  assert.equal(liveReadout(readings, heart, justAfter(readings)).heldAge, '5 s ago');

  run.push([none('no_face'), none()]);
  readings = sitting(run);
  const gone = liveReadout(readings, heart, justAfter(readings));
  assert.equal(gone.state, 'none');
  assert.equal(gone.value, undefined);
  assert.equal(gone.reason, 'No face in view');

  // Somebody sits down again: the old value does not come back, the next one takes the box.
  run.push([none('low_quality'), none()]);
  readings = sitting(run);
  assert.equal(liveReadout(readings, heart, justAfter(readings)).state, 'none');
  run.push([valid(80), none()]);
  readings = sitting(run);
  assert.equal(liveReadout(readings, heart, justAfter(readings)).value, '80');
});

test('dropouts with the person still in view keep the value, however long and however often the face is lost briefly', () => {
  const run: Array<[Estimate, Estimate]> = [[valid(72), valid(15)]];
  for (let round = 0; round < 6; round++) {
    // Four seconds looking away, then movement: never five seconds of absence in a row.
    for (let second = 0; second < 4; second++) run.push([none('no_face'), none('no_chest')]);
    run.push([none('motion'), none('motion')]);
  }
  const readings = sitting(run);
  const now = justAfter(readings);
  assert.deepEqual([liveReadout(readings, heart, now).state, liveReadout(readings, heart, now).value], ['held', '72']);
  assert.deepEqual([liveReadout(readings, breathing, now).state, liveReadout(readings, breathing, now).value], ['held', '15']);
});

test('each vital is let go on its own reason: a chest out of view does not empty the heart rate', () => {
  const run: Array<[Estimate, Estimate]> = [[valid(72), valid(15)]];
  for (let second = 0; second < 8; second++) run.push([none('low_quality'), none('no_chest')]);
  const readings = sitting(run);
  const now = justAfter(readings);
  assert.equal(liveReadout(readings, heart, now).state, 'held');
  assert.equal(liveReadout(readings, breathing, now).state, 'none');
});

test('a finished sitting with nothing recorded says so when a value was on screen while it ran', () => {
  const shown = sitting([[none('warming_up', 'settling'), valid(16)], [none(), none()], [none(), none()]]);
  assert.equal(noSummaryReason(shown, breathing), SHOWN_NOT_RECORDED);
  assert.equal(noSummaryReason(shown, breathing), 'Shown live, not steady long enough to record. Repeat the sitting');
  // The other vital of the same sitting never showed one.
  assert.equal(noSummaryReason(shown, heart), 'No reading was accepted in this sitting');
  assert.equal(noSummaryReason([], heart), 'No reading was accepted in this sitting');
});

test('the coverage meter is not drawn at 0% while a sitting runs', () => {
  assert.equal(coverageIsShown(true, 0), false);
  assert.equal(coverageIsShown(true, 0.02), true);
  // A finished sitting with nothing recorded shows its 0%: that is the result.
  assert.equal(coverageIsShown(false, 0), true);
});
