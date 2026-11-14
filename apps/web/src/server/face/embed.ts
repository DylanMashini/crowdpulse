import { Tensor } from "onnxruntime-node";

import type { Landmarks, Point } from "./detect.ts";
import type { RgbImage } from "./image.ts";
import type { FaceModels } from "./models.ts";

const SIZE = 112;
/** Where the five landmarks sit in the 112 by 112 crop SFace was trained on. */
const TEMPLATE: Landmarks = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
];

type Similarity = { a: number; b: number; tx: number; ty: number };

const centroid = (points: Point[]): Point => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
});

/** Least-squares rotation, uniform scale and shift taking `from` onto `to`: x' = a x - b y + tx, y' = b x + a y + ty. */
export function similarity(from: Point[], to: Point[]): Similarity {
  const fromCentre = centroid(from);
  const toCentre = centroid(to);
  let dot = 0;
  let cross = 0;
  let spread = 0;
  from.forEach((point, index) => {
    const fx = point.x - fromCentre.x;
    const fy = point.y - fromCentre.y;
    const tx = (to[index] as Point).x - toCentre.x;
    const ty = (to[index] as Point).y - toCentre.y;
    dot += fx * tx + fy * ty;
    cross += fx * ty - fy * tx;
    spread += fx * fx + fy * fy;
  });
  const a = dot / spread;
  const b = cross / spread;
  return { a, b, tx: toCentre.x - (a * fromCentre.x - b * fromCentre.y), ty: toCentre.y - (b * fromCentre.x + a * fromCentre.y) };
}

/** The aligned face as RGB planes of raw 0 to 255 values, sampled bilinearly from the image. */
function alignedPlanes(image: RgbImage, landmarks: Landmarks): Float32Array {
  // Mapping crop to image directly avoids inverting the image-to-crop transform.
  const { a, b, tx, ty } = similarity(TEMPLATE, landmarks);
  const area = SIZE * SIZE;
  const planes = new Float32Array(3 * area);
  const at = (x: number, y: number, channel: number) => {
    const column = Math.min(image.width - 1, Math.max(0, x));
    const row = Math.min(image.height - 1, Math.max(0, y));
    return image.data[(row * image.width + column) * 3 + channel] as number;
  };
  for (let v = 0; v < SIZE; v += 1) {
    for (let u = 0; u < SIZE; u += 1) {
      const x = a * u - b * v + tx;
      const y = b * u + a * v + ty;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const wx = x - x0;
      const wy = y - y0;
      for (let channel = 0; channel < 3; channel += 1) {
        const top = at(x0, y0, channel) * (1 - wx) + at(x0 + 1, y0, channel) * wx;
        const bottom = at(x0, y0 + 1, channel) * (1 - wx) + at(x0 + 1, y0 + 1, channel) * wx;
        planes[channel * area + v * SIZE + u] = top * (1 - wy) + bottom * wy;
      }
    }
  }
  return planes;
}

/** The SFace embedding of the face at `landmarks`, L2-normalised so a dot product is the cosine similarity. */
export async function embedFace(image: RgbImage, landmarks: Landmarks, models: FaceModels): Promise<number[]> {
  const input = new Tensor("float32", alignedPlanes(image, landmarks), [1, 3, SIZE, SIZE]);
  const { fc1 } = await models.embedder.run({ data: input });
  const raw = Array.from(fc1?.data as Float32Array);
  const norm = Math.hypot(...raw) || 1;
  return raw.map((value) => value / norm);
}
