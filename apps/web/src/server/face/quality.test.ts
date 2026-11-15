import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Landmarks } from "./detect.ts";
import {
  CLEARLY_BETTER,
  exposureScore,
  framingScore,
  laplacianVariance,
  portraitQuality,
  poseScore,
  shouldKeep,
} from "./quality.ts";

/** A level, frontal face: eyes `eyeDistance` apart around (x, y), mouth the same distance below. */
const face = (x: number, y: number, eyeDistance: number): Landmarks => [
  { x: x - eyeDistance / 2, y },
  { x: x + eyeDistance / 2, y },
  { x, y: y + eyeDistance * 0.6 },
  { x: x - eyeDistance * 0.4, y: y + eyeDistance },
  { x: x + eyeDistance * 0.4, y: y + eyeDistance },
];

/** The same face turned to one side: the eyes close up and the nose and mouth slide across. */
const turned = (x: number, y: number, eyeDistance: number): Landmarks => [
  { x: x - eyeDistance * 0.3, y },
  { x: x + eyeDistance * 0.3, y },
  { x: x + eyeDistance * 0.25, y: y + eyeDistance * 0.6 },
  { x: x - eyeDistance * 0.1, y: y + eyeDistance },
  { x: x + eyeDistance * 0.35, y: y + eyeDistance },
];

const rotated = (landmarks: Landmarks, degrees: number): Landmarks => {
  const [origin] = landmarks;
  const angle = (degrees * Math.PI) / 180;
  return landmarks.map(({ x, y }) => ({
    x: origin.x + (x - origin.x) * Math.cos(angle) - (y - origin.y) * Math.sin(angle),
    y: origin.y + (x - origin.x) * Math.sin(angle) + (y - origin.y) * Math.cos(angle),
  })) as Landmarks;
};

const SIZE = 96;
/** A picture with crisp detail: a checkerboard of `cell` pixel squares around mid grey. */
const checkerboard = (cell: number, low = 90, high = 170) =>
  Uint8Array.from({ length: SIZE * SIZE }, (_, index) =>
    (Math.floor((index % SIZE) / cell) + Math.floor(index / SIZE / cell)) % 2 === 0 ? low : high,
  );
const flat = (value: number) => new Uint8Array(SIZE * SIZE).fill(value);
/** A box blur, `radius` pixels each way: what motion or a missed focus does to detail. */
const blurred = (grey: Uint8Array, radius: number) =>
  Uint8Array.from(grey, (_, index) => {
    const x = index % SIZE;
    const y = Math.floor(index / SIZE);
    let sum = 0;
    let count = 0;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const px = x + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
        sum += grey[py * SIZE + px] as number;
        count += 1;
      }
    }
    return Math.round(sum / count);
  });

const quality = (landmarks: Landmarks, grey = checkerboard(4), confidence = 0.95) =>
  portraitQuality({ landmarks, confidence, width: 640, height: 480, grey, greyWidth: SIZE, greyHeight: SIZE });

describe("poseScore", () => {
  it("is full for a level face looking at the camera", () => {
    assert.equal(poseScore(face(320, 200, 60)), 1);
  });

  it("drops for a head turned to the side", () => {
    assert.ok(poseScore(turned(320, 200, 60)) < 0.4);
  });

  it("drops as the head tilts, and does not care which way", () => {
    const level = poseScore(face(320, 200, 60));
    const tilted = poseScore(rotated(face(320, 200, 60), 15));
    assert.ok(tilted < level);
    assert.ok(Math.abs(tilted - poseScore(rotated(face(320, 200, 60), -15))) < 1e-9);
    assert.ok(poseScore(rotated(face(320, 200, 60), 30)) < tilted);
  });

  it("drops for a bowed head, where the mouth is close under the eyes", () => {
    const bowed = face(320, 200, 60).map((point, index) =>
      index < 2 ? point : { x: point.x, y: 200 + (point.y - 200) * 0.5 },
    ) as Landmarks;
    assert.ok(poseScore(bowed) < poseScore(face(320, 200, 60)));
  });

  it("does not depend on how large the face is", () => {
    assert.equal(poseScore(face(320, 200, 30)), poseScore(face(320, 200, 90)));
  });
});

describe("framingScore", () => {
  it("is full when the head and shoulders are inside the picture", () => {
    assert.equal(framingScore(face(320, 200, 60), 640, 480), 1);
  });

  it("drops when the face is at the edge and the portrait would be cut off", () => {
    assert.ok(framingScore(face(60, 200, 60), 640, 480) < 0.7);
    assert.equal(framingScore(face(10, 10, 60), 640, 480), 0);
  });
});

describe("laplacianVariance", () => {
  it("is zero for a flat picture and high for crisp detail", () => {
    assert.equal(laplacianVariance(flat(128), SIZE, SIZE), 0);
    assert.ok(laplacianVariance(checkerboard(4), SIZE, SIZE) > 1000);
  });

  it("falls when the same picture is blurred", () => {
    const sharp = laplacianVariance(checkerboard(8), SIZE, SIZE);
    const soft = laplacianVariance(blurred(checkerboard(8), 2), SIZE, SIZE);
    assert.ok(soft < sharp / 4, `${soft} against ${sharp}`);
  });

  it("is zero for a picture too small to have an inside", () => {
    assert.equal(laplacianVariance(new Uint8Array(4), 2, 2), 0);
  });
});

describe("exposureScore", () => {
  it("is full for mid tones", () => {
    assert.equal(exposureScore(flat(130)), 1);
  });

  it("drops for a dark picture and for a washed-out one", () => {
    assert.equal(exposureScore(flat(30)), 0);
    assert.equal(exposureScore(flat(250)), 0);
    assert.ok(exposureScore(flat(65)) < 1 && exposureScore(flat(65)) > 0);
  });

  it("drops when much of the picture is clipped, even if the average is fine", () => {
    assert.ok(exposureScore(checkerboard(4, 0, 255)) === 0);
  });
});

describe("portraitQuality", () => {
  it("scores a sharp, large, level face in the middle near the top", () => {
    const { score, parts } = quality(face(320, 200, 80));
    assert.ok(score > 0.9, String(score));
    assert.deepEqual(
      Object.values(parts).map((part) => part >= 0 && part <= 1),
      [true, true, true, true, true, true],
    );
  });

  it("puts the patient facing the camera clearly above the same patient turned away", () => {
    const facing = quality(face(320, 200, 60)).score;
    assert.ok(facing >= quality(turned(320, 200, 60)).score * CLEARLY_BETTER);
  });

  it("puts a still frame clearly above a blurred one", () => {
    const still = quality(face(320, 200, 60), checkerboard(8)).score;
    const moving = quality(face(320, 200, 60), blurred(checkerboard(8), 3)).score;
    assert.ok(still >= moving * CLEARLY_BETTER, `${still} against ${moving}`);
  });

  it("puts a face near the camera above one far away", () => {
    assert.ok(quality(face(320, 200, 70)).score > quality(face(320, 200, 26)).score * CLEARLY_BETTER);
  });

  it("prefers a face the detector is sure of", () => {
    assert.ok(quality(face(320, 200, 60), checkerboard(4), 0.95).score > quality(face(320, 200, 60), checkerboard(4), 0.72).score);
  });

  it("stays between 0 and 1", () => {
    for (const landmarks of [face(320, 200, 80), turned(5, 5, 23), rotated(face(600, 440, 40), 80)]) {
      for (const grey of [flat(0), flat(255), checkerboard(1, 0, 255)]) {
        const { score } = quality(landmarks, grey, 0.7);
        assert.ok(score >= 0 && score <= 1, String(score));
      }
    }
  });
});

describe("shouldKeep", () => {
  it("keeps the first frame with a face, however poor, so a photo appears early", () => {
    assert.equal(shouldKeep(null, 0.05), true);
  });

  it("replaces the photo only for a clearly better frame", () => {
    assert.equal(shouldKeep(0.5, 0.5 * (1 + (CLEARLY_BETTER - 1) / 2)), false);
    assert.equal(shouldKeep(0.5, 0.5), false);
    assert.equal(shouldKeep(0.5, 0.3), false);
    assert.equal(shouldKeep(0.5, 0.5 * CLEARLY_BETTER + 1e-9), true);
  });

  it("asks for the same improvement in a dim room as in a bright one", () => {
    // What the old fixed margin of 0.08 got wrong: 0.30 to 0.36 is a fifth better and was refused.
    assert.equal(shouldKeep(0.3, 0.36), true);
    assert.equal(shouldKeep(0.8, 0.86), false);
    // The same two frames with the light halved: every score falls by one factor, the answer stays.
    const dimmer = 0.4;
    for (const [kept, next] of [[0.5, 0.6], [0.5, 0.55], [0.7, 0.9]] as const) {
      assert.equal(shouldKeep(kept * dimmer, next * dimmer), shouldKeep(kept, next));
    }
  });

  it("replaces the phone's own crop, which scores nothing, with any portrait", () => {
    assert.equal(shouldKeep(0, 0.05), true);
  });

  it("ends on the best frame of a sitting: sitting down, turned, then still and facing", () => {
    const sitting = [
      quality(turned(120, 150, 30), blurred(checkerboard(8), 3)).score,
      quality(turned(300, 200, 55), blurred(checkerboard(8), 2)).score,
      quality(face(320, 200, 62), checkerboard(8)).score,
      quality(face(322, 201, 62), checkerboard(8)).score,
      quality(turned(320, 200, 60), checkerboard(8)).score,
    ];
    let best: number | null = null;
    const kept: number[] = [];
    sitting.forEach((score, index) => {
      if (!shouldKeep(best, score)) return;
      best = score;
      kept.push(index);
    });
    // The first frame gives a photo at once; the still, frontal one replaces it; the
    // near-identical frame after it does not swap the photo again.
    assert.equal(kept[0], 0);
    assert.equal(kept.at(-1), 2);
  });
});
