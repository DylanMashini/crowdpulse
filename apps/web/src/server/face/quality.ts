import type { Landmarks, Point } from "./detect.ts";
import { PORTRAIT_SPAN } from "./portrait.ts";

// How good a profile photo one camera frame would make. The sitting's frames are scored as
// they arrive and the best one so far is kept (see intake.ts), so the photo is of a patient
// who has sat down and is facing the camera, not of whoever was first in view.

/** What each part of the score measures, each from 0 (useless) to 1 (as good as it gets). */
export type QualityParts = {
  /** Facing the camera: head not turned, tilted, or bowed. */
  pose: number;
  /** In focus and still. */
  sharpness: number;
  /** Enough pixels across the face to fill the portrait. */
  size: number;
  /** The whole head and shoulders are inside the picture. */
  framing: number;
  /** Neither dark nor washed out. */
  exposure: number;
  /** How sure the detector is that this is a face. */
  confidence: number;
};
export type Quality = { score: number; parts: QualityParts };

const WEIGHTS: QualityParts = { pose: 0.3, sharpness: 0.25, size: 0.15, framing: 0.1, exposure: 0.1, confidence: 0.1 };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** 0 at `from`, 1 at `to`, straight between. `from` may be the larger, for "smaller is better". */
const ramp = (value: number, from: number, to: number) => clamp01((value - from) / (to - from));
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** The detector's own floor is 0.7 (detect.ts); a face it is sure of scores 0.95 and up. */
const CONFIDENCE_RANGE = [0.7, 0.95] as const;
/** Eye distance in frame pixels: below 22 no portrait is cut at all (portrait.ts). */
const EYE_DISTANCE_RANGE = [22, 80] as const;
/** The nose this far off the middle of the eyes, in eye distances, is a head turned well away. */
const YAW_LIMIT = 0.3;
const ROLL_LIMIT_DEGREES = 25;
/** The face itself, in eye distances: this far outside the eyes and mouth each way, brows to lower lip. */
const FACE_MARGIN = 0.35;
/**
 * Variance of the Laplacian, on the 96 px copy of the face and at the reference brightness,
 * at which sharpness scores one half. Set from 640 px live-view frames of four synthetic
 * faces: about 120 to 310 in focus, 50 to 130 slightly soft, 15 to 60 badly blurred.
 */
const SHARPNESS_HALF = 300;
/**
 * Edges in a dim picture are fainter by how dim it is, in focus or not. The variance is
 * brought to what it would be at this mean brightness, so a dim room does not read as a
 * blurred face. Below the floor the picture is mostly noise and is not brightened further.
 */
const REFERENCE_BRIGHTNESS = 110;
const BRIGHTNESS_FLOOR = 40;
/** Mean brightness of the face, 0 to 255: full marks from 70, none below 25. Dark skin in fair light reads 45 to 80. */
const DARK_RANGE = [25, 70] as const;
/** No part counts as less than this, so one hopeless part lowers the score a lot but not to nothing. */
const PART_FLOOR = 0.02;

/**
 * Facing the camera, from the five landmarks alone. A turned head moves the nose off the
 * line between the eyes and brings the eyes together; a tilted head slopes the eye line; a
 * bowed or raised head changes how far the mouth sits below the eyes.
 */
export function poseScore(landmarks: Landmarks): number {
  const [rightEye, leftEye, nose, rightMouth, leftMouth] = landmarks;
  const eyeDistance = distance(rightEye, leftEye);
  if (eyeDistance === 0) return 0;
  const eyes = midpoint(rightEye, leftEye);
  const mouth = midpoint(rightMouth, leftMouth);
  const along = { x: (leftEye.x - rightEye.x) / eyeDistance, y: (leftEye.y - rightEye.y) / eyeDistance };
  const offAxis = (point: Point) => Math.abs((point.x - eyes.x) * along.x + (point.y - eyes.y) * along.y) / eyeDistance;

  const yaw = ramp(Math.max(offAxis(nose), offAxis(mouth)), YAW_LIMIT, 0);
  // The detector's "right eye" is the one on the left of the picture, so a level face has
  // its eye line running left to right.
  const rollDegrees = Math.abs((Math.atan2(along.y, along.x) * 180) / Math.PI);
  const roll = ramp(rollDegrees, ROLL_LIMIT_DEGREES, 0);
  // Facing the camera, the mouth is about one eye distance below the eyes.
  const proportion = eyeDistance / Math.max(distance(eyes, mouth), 1e-6);
  const level = Math.min(ramp(proportion, 0.5, 0.8), ramp(proportion, 1.6, 1.2));
  return 0.5 * yaw + 0.25 * roll + 0.25 * level;
}

/** How much of the head-and-shoulders square around the face is inside the picture. */
export function framingScore(landmarks: Landmarks, width: number, height: number): number {
  const [rightEye, leftEye, , rightMouth, leftMouth] = landmarks;
  const eyes = midpoint(rightEye, leftEye);
  const mouth = midpoint(rightMouth, leftMouth);
  // The square portrait.ts would like to cut, before it is made to fit the picture.
  const size = Math.max(distance(rightEye, leftEye), distance(eyes, mouth)) * PORTRAIT_SPAN;
  if (size === 0) return 0;
  const centre = { x: eyes.x + (mouth.x - eyes.x) * 0.3, y: eyes.y + (mouth.y - eyes.y) * 0.3 };
  const inside = (middle: number, limit: number) =>
    Math.max(0, Math.min(middle + size / 2, limit) - Math.max(middle - size / 2, 0)) / size;
  // A square with a quarter of it outside the picture is already a poor portrait.
  return ramp(inside(centre.x, width) * inside(centre.y, height), 0.75, 1);
}

/**
 * The part of the picture that is the face and nothing else, brows to lower lip: no hair line,
 * collar or background. Sharpness and exposure are measured here, so a crisp edge behind a
 * blurred face, or a bright wall behind a dark one, does not count for the face. Where the
 * face runs out of the picture the box is cut off, not moved. Null when too little is left.
 */
export function faceBox(
  landmarks: Landmarks,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } | null {
  const [rightEye, leftEye, , rightMouth, leftMouth] = landmarks;
  const eyes = midpoint(rightEye, leftEye);
  const mouth = midpoint(rightMouth, leftMouth);
  const unit = Math.max(distance(rightEye, leftEye), distance(eyes, mouth));
  const centre = midpoint(eyes, mouth);
  const half = unit * (0.5 + FACE_MARGIN);
  const left = Math.max(0, Math.round(centre.x - half));
  const top = Math.max(0, Math.round(centre.y - half));
  const right = Math.min(width, Math.round(centre.x + half));
  const bottom = Math.min(height, Math.round(centre.y + half));
  if (right - left < 8 || bottom - top < 8) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/** Variance of the Laplacian of a greyscale picture: high when edges are crisp, low when blurred. */
export function laplacianVariance(grey: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumOfSquares = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const value =
        (grey[at - 1] as number) +
        (grey[at + 1] as number) +
        (grey[at - width] as number) +
        (grey[at + width] as number) -
        4 * (grey[at] as number);
      sum += value;
      sumOfSquares += value * value;
    }
  }
  const count = (width - 2) * (height - 2);
  const mean = sum / count;
  return sumOfSquares / count - mean * mean;
}

/** In focus and still, from 0 to 1. `grey` is the face (see faceBox), 0 to 255. */
export function sharpnessScore(grey: Uint8Array, width: number, height: number): number {
  if (grey.length === 0) return 0;
  let sum = 0;
  for (const value of grey) sum += value;
  const gain = REFERENCE_BRIGHTNESS / Math.max(sum / grey.length, BRIGHTNESS_FLOOR);
  const variance = laplacianVariance(grey, width, height) * gain * gain;
  return variance / (variance + SHARPNESS_HALF);
}

/** Mid-toned and not clipped. `grey` is the face (see faceBox), 0 to 255. */
export function exposureScore(grey: Uint8Array): number {
  if (grey.length === 0) return 0;
  let sum = 0;
  let clipped = 0;
  for (const value of grey) {
    sum += value;
    if (value < 10 || value > 245) clipped += 1;
  }
  const mean = sum / grey.length;
  const brightness = Math.min(ramp(mean, ...DARK_RANGE), ramp(mean, 225, 180));
  return brightness * ramp(clipped / grey.length, 0.3, 0.05);
}

/**
 * One number from 0 to 1 for a frame, from the face found in it and a small greyscale copy of
 * that face (faceBox). The copy is always the same size, so a face near the camera and one
 * further away are compared like for like.
 */
export function portraitQuality(input: {
  landmarks: Landmarks;
  confidence: number;
  width: number;
  height: number;
  grey: Uint8Array;
  greyWidth: number;
  greyHeight: number;
}): Quality {
  const [rightEye, leftEye] = input.landmarks;
  const parts: QualityParts = {
    pose: poseScore(input.landmarks),
    sharpness: sharpnessScore(input.grey, input.greyWidth, input.greyHeight),
    size: ramp(distance(rightEye, leftEye), ...EYE_DISTANCE_RANGE),
    framing: framingScore(input.landmarks, input.width, input.height),
    exposure: exposureScore(input.grey),
    confidence: ramp(input.confidence, ...CONFIDENCE_RANGE),
  };
  // A weighted geometric mean: the parts multiply, so a frame that is good on average but
  // useless in one way (turned away, blurred, half out of the picture) still scores low.
  const score = Math.exp(
    (Object.keys(WEIGHTS) as (keyof QualityParts)[]).reduce(
      (total, part) => total + WEIGHTS[part] * Math.log(Math.max(parts[part], PART_FLOOR)),
      0,
    ),
  );
  return { score, parts };
}

/**
 * A new frame has to score this many times the photo already kept, so the photo does not
 * flicker. It is a ratio, not a difference: the parts multiply, so a dim room or a small face
 * lowers every frame of a sitting by the same factor, and a sharper or better-posed frame
 * still stands out by the same ratio as it would in good light.
 */
export const CLEARLY_BETTER = 1.15;
/** At this score nothing later is likely to be clearly better: stop looking. */
export const GOOD_ENOUGH = 0.9;

/**
 * Whether a frame should become the photo. The first frame with a face always does, so a
 * photo appears early; after that only a clearly better one replaces it.
 */
export function shouldKeep(bestScore: number | null, score: number): boolean {
  return bestScore === null || (score > 0 && score >= bestScore * CLEARLY_BETTER);
}
