import { MATCH_COSINE } from "./confidence.ts";
import type { Landmarks } from "./detect.ts";
import { shouldKeep } from "./quality.ts";

// Whose face the profile photo is of. The first photo of a sitting is of the person the
// camera is pointed at; a later, better frame replaces it only when it shows that same
// person, so a nurse or a relative leaning into the picture never becomes the patient's photo.

/**
 * SFace cosine similarity from which a frame's face is the person in the photo already kept:
 * the same bar a re-check has to clear (confidence.ts). On live-view frames of four synthetic
 * faces, in focus, blurred and dim, the same face stayed at 0.71 or above and two different
 * faces at 0.37 or below. A miss only means the photo is not improved.
 */
export const SAME_PERSON_COSINE = MATCH_COSINE;
/** With a crowd in the picture, only this many of the best frames' faces are compared. */
const MAX_COMPARED = 3;

/** Both vectors are L2-normalised (embed.ts), so the dot product is the cosine similarity. */
export function cosine(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
}

/**
 * How much a face is the subject of the picture: its size, marked down the further it sits
 * from the middle. The patient is in the chair the camera points at; someone passing behind
 * is smaller, and someone leaning in is at the edge.
 */
export function prominence(landmarks: Landmarks, width: number, height: number): number {
  const [rightEye, leftEye, nose] = landmarks;
  const eyeDistance = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
  const offCentre = Math.hypot((nose.x - width / 2) / (width / 2), (nose.y - height / 2) / (height / 2)) / Math.SQRT2;
  return eyeDistance * (1 - 0.5 * Math.min(1, offCentre));
}

/** The face the camera is pointed at, of several. Undefined for none. */
export function mostProminent<T extends { prominence: number }>(candidates: T[]): T | undefined {
  return candidates.reduce<T | undefined>((most, next) => (most && most.prominence >= next.prominence ? most : next), undefined);
}

export type Pickable = { score: number; prominence: number; embed: () => Promise<number[]> };
/** The photo taken automatically that is stored now. No embedding: it is the phone's own crop. */
export type Kept = { score: number; embedding: number[] | null };

/**
 * Which face of a frame, if any, should become the photo, and its embedding to remember.
 *
 * With no photo from the live view yet, it is the most prominent face. After that it is the
 * best-scoring face that is clearly better than the photo kept (quality.ts) and is the same
 * person. A face is embedded only once it has passed the score test, so a frame that would
 * not replace the photo anyway costs nothing more.
 */
export async function pickPortrait<T extends Pickable>(
  candidates: T[],
  kept: Kept | null,
): Promise<{ candidate: T; embedding: number[] } | null> {
  if (!kept || !kept.embedding) {
    const candidate = mostProminent(candidates);
    if (!candidate || (kept && !shouldKeep(kept.score, candidate.score))) return null;
    return { candidate, embedding: await candidate.embed() };
  }
  const better = candidates
    .filter((candidate) => shouldKeep(kept.score, candidate.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_COMPARED);
  for (const candidate of better) {
    const embedding = await candidate.embed();
    if (cosine(embedding, kept.embedding) >= SAME_PERSON_COSINE) return { candidate, embedding };
  }
  return null;
}
