import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Landmarks } from "./detect.ts";
import { distinctFaces } from "./detect.ts";

const face = (x: number, y: number, eyeDistance: number): Landmarks => [
  { x: x - eyeDistance / 2, y },
  { x: x + eyeDistance / 2, y },
  { x, y: y + eyeDistance * 0.6 },
  { x: x - eyeDistance * 0.4, y: y + eyeDistance },
  { x: x + eyeDistance * 0.4, y: y + eyeDistance },
];

describe("distinctFaces", () => {
  it("keeps one answer for a face the detector reports from several cells, the most confident", () => {
    const faces = distinctFaces([
      { landmarks: face(322, 203, 58), confidence: 0.81 },
      { landmarks: face(320, 200, 60), confidence: 0.93 },
      { landmarks: face(317, 198, 62), confidence: 0.77 },
    ]);
    assert.equal(faces.length, 1);
    assert.equal(faces[0]?.confidence, 0.93);
  });

  it("keeps two people side by side, the most confident first", () => {
    const faces = distinctFaces([
      { landmarks: face(150, 200, 40), confidence: 0.8 },
      { landmarks: face(152, 201, 40), confidence: 0.75 },
      { landmarks: face(400, 220, 70), confidence: 0.95 },
    ]);
    assert.deepEqual(faces.map((found) => found.confidence), [0.95, 0.8]);
  });

  it("is empty for no faces", () => {
    assert.deepEqual(distinctFaces([]), []);
  });
});
