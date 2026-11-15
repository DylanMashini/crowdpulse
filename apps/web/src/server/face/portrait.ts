import type { Landmarks } from "./detect.ts";

/** A face narrower than this between the eyes, in frame pixels, makes too soft a portrait. */
const MIN_EYE_DISTANCE_PX = 22;
/** The portrait is this many eye-distances wide: the head, some hair and a little shoulder. */
export const PORTRAIT_SPAN = 3.8;

type Point = { x: number; y: number };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The square around a detected face, kept inside the picture. Null when the face is too small. */
export function portraitSquare(
  landmarks: Landmarks,
  width: number,
  height: number,
): { left: number; top: number; size: number } | null {
  const [rightEye, leftEye, , rightMouth, leftMouth] = landmarks;
  const eyes = midpoint(rightEye, leftEye);
  const mouth = midpoint(rightMouth, leftMouth);
  const eyeDistance = distance(rightEye, leftEye);
  if (eyeDistance < MIN_EYE_DISTANCE_PX) return null;
  // A turned head shortens the eye distance, so the eye-to-mouth distance sets a floor.
  const unit = Math.max(eyeDistance, distance(eyes, mouth));
  const size = Math.round(Math.min(unit * PORTRAIT_SPAN, width, height));
  const centre = { x: eyes.x + (mouth.x - eyes.x) * 0.3, y: eyes.y + (mouth.y - eyes.y) * 0.3 };
  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), max));
  return { left: clamp(centre.x - size / 2, width - size), top: clamp(centre.y - size / 2, height - size), size };
}
