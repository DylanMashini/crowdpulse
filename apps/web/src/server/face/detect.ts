import { Tensor } from "onnxruntime-node";

import type { RgbImage } from "./image.ts";
import { letterbox } from "./image.ts";
import type { FaceModels } from "./models.ts";

export type Point = { x: number; y: number };
/** Right eye, left eye, nose tip, right and left mouth corner, in pixels of the decoded image. */
export type Landmarks = [Point, Point, Point, Point, Point];

const INPUT_SIZE = 640;
const STRIDES = [8, 16, 32] as const;
const MIN_SCORE = 0.7;
/**
 * The phone sends a crop that the face nearly fills, which is larger than YuNet's anchors
 * cover at full size. The first pass shrinks the crop to half the canvas; the second pass
 * uses the whole canvas for a picture in which the face is small.
 */
const LONG_SIDES = [INPUT_SIZE / 2, INPUT_SIZE] as const;

export type DetectedFace = { landmarks: Landmarks; confidence: number };

/** The landmarks of the most confident face, or null when YuNet finds none. */
export async function detectFace(image: RgbImage, models: FaceModels): Promise<Landmarks | null> {
  return (await detectFaceScored(image, models))?.landmarks ?? null;
}

/** The most confident face and how confident YuNet is of it (0.7 to 1), or null when it finds none. */
export async function detectFaceScored(image: RgbImage, models: FaceModels): Promise<DetectedFace | null> {
  return (await detectFaces(image, models))[0] ?? null;
}

/** Every face YuNet finds, each once, the most confident first. Empty when it finds none. */
export async function detectFaces(image: RgbImage, models: FaceModels): Promise<DetectedFace[]> {
  for (const longSide of LONG_SIDES) {
    const { canvas, scale, offsetX, offsetY } = await letterbox(image, INPUT_SIZE, longSide);
    const outputs = await models.detector.run({ input: bgrPlanes(canvas, INPUT_SIZE) });
    const faces = distinctFaces(candidates(outputs));
    if (faces.length > 0) {
      return faces.map(({ landmarks, confidence }) => ({
        landmarks: landmarks.map(({ x, y }) => ({ x: (x - offsetX) / scale, y: (y - offsetY) / scale })) as Landmarks,
        confidence,
      }));
    }
  }
  return [];
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (points: Point[]): Point => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

/**
 * YuNet answers for one face from several neighbouring cells. This keeps the most confident
 * answer for each face: a candidate whose landmarks sit on top of a more confident one's is
 * the same face again. Two heads cannot be closer than about two eye distances.
 */
export function distinctFaces(found: DetectedFace[]): DetectedFace[] {
  const kept: (DetectedFace & { centre: Point; span: number })[] = [];
  for (const face of [...found].sort((a, b) => b.confidence - a.confidence)) {
    const [rightEye, leftEye, , rightMouth, leftMouth] = face.landmarks;
    const centre = middle(face.landmarks);
    const span = Math.max(distance(rightEye, leftEye), distance(middle([rightEye, leftEye]), middle([rightMouth, leftMouth])));
    if (kept.some((other) => distance(other.centre, centre) < Math.max(other.span, span))) continue;
    kept.push({ ...face, centre, span });
  }
  return kept.map(({ landmarks, confidence }) => ({ landmarks, confidence }));
}

/** YuNet takes BGR planes of raw 0 to 255 values. */
function bgrPlanes(rgb: Uint8Array, size: number): Tensor {
  const area = size * size;
  const planes = new Float32Array(3 * area);
  for (let pixel = 0; pixel < area; pixel += 1) {
    planes[pixel] = rgb[pixel * 3 + 2] as number;
    planes[area + pixel] = rgb[pixel * 3 + 1] as number;
    planes[2 * area + pixel] = rgb[pixel * 3] as number;
  }
  return new Tensor("float32", planes, [1, 3, size, size]);
}

type Outputs = Awaited<ReturnType<FaceModels["detector"]["run"]>>;

/** Decodes YuNet's per-stride grids: every cell that is sure enough of a face, in canvas pixels. */
function candidates(outputs: Outputs): DetectedFace[] {
  const found: DetectedFace[] = [];
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  for (const stride of STRIDES) {
    const columns = INPUT_SIZE / stride;
    const classes = outputs[`cls_${stride}`]?.data as Float32Array;
    const objectness = outputs[`obj_${stride}`]?.data as Float32Array;
    const keypoints = outputs[`kps_${stride}`]?.data as Float32Array;
    for (let cell = 0; cell < classes.length; cell += 1) {
      const confidence = Math.sqrt(clamp(classes[cell] as number) * clamp(objectness[cell] as number));
      if (confidence <= MIN_SCORE) continue;
      const column = cell % columns;
      const row = Math.floor(cell / columns);
      const landmarks = Array.from({ length: 5 }, (_, point) => ({
        x: ((keypoints[cell * 10 + point * 2] as number) + column) * stride,
        y: ((keypoints[cell * 10 + point * 2 + 1] as number) + row) * stride,
      })) as Landmarks;
      found.push({ landmarks, confidence });
    }
  }
  return found;
}
