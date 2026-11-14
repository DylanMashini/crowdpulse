import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Landmarks } from "./detect.ts";
import { portraitSquare } from "./portrait.ts";

/** A level, frontal face: eyes `eyeDistance` apart around (x, y), mouth the same distance below. */
const face = (x: number, y: number, eyeDistance: number): Landmarks => [
  { x: x - eyeDistance / 2, y },
  { x: x + eyeDistance / 2, y },
  { x, y: y + eyeDistance * 0.6 },
  { x: x - eyeDistance * 0.4, y: y + eyeDistance },
  { x: x + eyeDistance * 0.4, y: y + eyeDistance },
];

describe("portraitSquare", () => {
  it("frames the head with room around it, centred a little below the eyes", () => {
    const square = portraitSquare(face(320, 200, 60), 640, 480);
    assert.deepEqual(square, { left: 206, top: 104, size: 228 });
  });

  it("stays inside the picture when the face is near an edge", () => {
    const square = portraitSquare(face(40, 30, 60), 640, 480);
    assert.ok(square);
    assert.equal(square.left, 0);
    assert.equal(square.top, 0);
    assert.ok(square.left + square.size <= 640 && square.top + square.size <= 480);
  });

  it("is never larger than the picture", () => {
    const square = portraitSquare(face(320, 200, 200), 640, 480);
    assert.deepEqual(square, { left: 80, top: 0, size: 480 });
  });

  it("uses the eye-to-mouth distance when the head is turned and the eyes look close together", () => {
    const turned: Landmarks = [
      { x: 300, y: 200 },
      { x: 330, y: 200 },
      { x: 318, y: 236 },
      { x: 304, y: 260 },
      { x: 326, y: 260 },
    ];
    assert.equal(portraitSquare(turned, 640, 480)?.size, 228);
  });

  it("refuses a face too small to make a portrait from", () => {
    assert.equal(portraitSquare(face(320, 200, 18), 640, 480), null);
  });
});
