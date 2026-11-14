import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pushTrace, traceRuns } from './trace.ts';

const box = { width: 120, height: 40, pad: 4 };

test('the trace keeps the newest seconds', () => {
  assert.deepEqual(pushTrace([70, 71], 72, 3), [70, 71, 72]);
  assert.deepEqual(pushTrace([70, 71, 72], null, 3), [71, 72, null]);
});

test('a second without a reading breaks the line', () => {
  const runs = traceRuns([70, 72, null, 74], box, 60, 12);
  assert.equal(runs.length, 2);
  assert.equal(runs[0]!.length, 2);
  assert.equal(runs[1]!.length, 1);
});

test('a steady reading is a level line in the middle of the box', () => {
  const runs = traceRuns([72, 72, 72], box, 60, 12);
  assert.deepEqual(runs[0]!.map((point) => point.y), [20, 20, 20]);
  // Seconds run left to right from the padding.
  assert.equal(runs[0]![0]!.x, 4);
});

test('the values stay inside the box and a higher value is drawn higher', () => {
  const [run] = traceRuns([60, 120], box, 2, 12);
  assert.deepEqual(run, [{ x: 4, y: 36 }, { x: 116, y: 4 }]);
});

test('nothing is drawn before the first reading or before the box is measured', () => {
  assert.deepEqual(traceRuns([null, null], box, 60, 12), []);
  assert.deepEqual(traceRuns([72], { ...box, width: 0 }, 60, 12), []);
});
