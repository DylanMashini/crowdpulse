import assert from 'node:assert/strict';
import { test } from 'node:test';

import { coverFrame, placePoint, placeRect } from './viewfinderGeometry.ts';

test('a frame wider than its box keeps the height and crops the sides equally', () => {
  const frame = coverFrame({ width: 400, height: 360 }, 16 / 9);
  assert.equal(frame.height, 360);
  assert.equal(frame.width, 640);
  assert.equal(frame.x, -120);
  assert.equal(frame.y, 0);
});

test('a frame taller than its box keeps the width and crops top and bottom equally', () => {
  const frame = coverFrame({ width: 360, height: 320 }, 9 / 16);
  assert.equal(frame.width, 360);
  assert.equal(frame.height, 640);
  assert.equal(frame.x, 0);
  assert.equal(frame.y, -160);
});

test('a box of the same shape is covered exactly', () => {
  assert.deepEqual(coverFrame({ width: 320, height: 180 }, 16 / 9), { x: 0, y: 0, width: 320, height: 180 });
});

test('nothing is placed before the box has a size', () => {
  const empty = { x: 0, y: 0, width: 0, height: 0 };
  assert.deepEqual(coverFrame(null, 16 / 9), empty);
  assert.deepEqual(coverFrame({ width: 0, height: 100 }, 16 / 9), empty);
  assert.deepEqual(coverFrame({ width: 100, height: 100 }, 0), empty);
});

test('the centre of the frame is the centre of the box, mirrored or not', () => {
  const frame = coverFrame({ width: 400, height: 360 }, 16 / 9);
  assert.deepEqual(placePoint({ x: 0.5, y: 0.5 }, frame, false), { x: 200, y: 180 });
  assert.deepEqual(placePoint({ x: 0.5, y: 0.5 }, frame, true), { x: 200, y: 180 });
});

test('mirroring moves a point to the other side and leaves its height alone', () => {
  const frame = { x: 0, y: 0, width: 200, height: 100 };
  assert.deepEqual(placePoint({ x: 0.25, y: 0.4 }, frame, false), { x: 50, y: 40 });
  assert.deepEqual(placePoint({ x: 0.25, y: 0.4 }, frame, true), { x: 150, y: 40 });
});

test('a mirrored rectangle keeps its size and swaps sides', () => {
  const frame = { x: -20, y: 10, width: 200, height: 100 };
  const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  assert.deepEqual(placeRect(rect, frame, false), { x: 0, y: 30, width: 60, height: 40 });
  const mirrored = placeRect(rect, frame, true);
  assert.ok(Math.abs(mirrored.x - 100) < 1e-9);
  assert.equal(mirrored.y, 30);
  assert.equal(mirrored.width, 60);
  assert.equal(mirrored.height, 40);
});
