import { PATIENT_PHOTO_SIZE } from "@triagecam/contracts";
import { and, eq, isNull } from "drizzle-orm";
import sharp, { type Sharp } from "sharp";

import { db, schema } from "../db/client.ts";
import { patientChanged } from "./events.ts";
import { detectFaceScored } from "./face/detect.ts";
import { decodeJpegBytes } from "./face/image.ts";
import { faceModels } from "./face/models.ts";
import { portraitSquare } from "./face/portrait.ts";
import { faceBox, portraitQuality, type Quality } from "./face/quality.ts";
import { ApiError } from "./http.ts";
import type { PatientRow } from "./serialize.ts";
import { toPatientRef } from "./serialize.ts";

// The profile photo is the one picture the system keeps: a small square JPEG per patient,
// taken during the intake sitting. Everything else the camera sees is relayed and dropped.

const isJpeg = (bytes: Buffer) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;

const encode = (image: Sharp) =>
  image.resize(PATIENT_PHOTO_SIZE, PATIENT_PHOTO_SIZE, { fit: "cover" }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();

/** The phone's own face crop, made square. Refused unless it is a readable JPEG. */
export async function portraitFromCrop(jpeg: Buffer): Promise<Buffer> {
  if (!isJpeg(jpeg)) throw new ApiError("invalid_request", "The photo is not a JPEG image");
  try {
    return await encode(sharp(jpeg, { limitInputPixels: 4096 * 4096 }).rotate());
  } catch {
    throw new ApiError("invalid_request", "The photo could not be read as a JPEG image");
  }
}

/** The side of the small greyscale copy of the face that sharpness and exposure are measured on. */
const SCORED_SIZE = 96;

/** A portrait that could be cut from a frame: how good it would be, and the cut itself on request. */
export type PortraitCandidate = { quality: Quality; encode: () => Promise<Buffer> };

/**
 * Finds the face in a whole camera frame and scores the portrait it would make. Null when no
 * face is found or it is too small. Throws face_unavailable when the detector is not installed.
 */
export async function portraitCandidate(jpeg: Buffer): Promise<PortraitCandidate | null> {
  const models = await faceModels();
  const image = await decodeJpegBytes(jpeg);
  const face = await detectFaceScored(image, models);
  if (!face) return null;
  const square = portraitSquare(face.landmarks, image.width, image.height);
  const box = faceBox(face.landmarks, image.width, image.height);
  if (!square || !box) return null;
  const whole = () => sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } });
  const cut = () => whole().extract({ left: square.left, top: square.top, width: square.size, height: square.size });
  // Scored on the face alone: a crisp edge elsewhere in the portrait says nothing about the face.
  const grey = await whole().extract(box).resize(SCORED_SIZE, SCORED_SIZE, { fit: "fill" }).greyscale().raw().toBuffer();
  const quality = portraitQuality({
    landmarks: face.landmarks,
    confidence: face.confidence,
    width: image.width,
    height: image.height,
    grey,
    greyWidth: SCORED_SIZE,
    greyHeight: SCORED_SIZE,
  });
  return { quality, encode: () => encode(cut()) };
}

/** The portrait from a whole camera frame, whatever its quality: the frame staff chose. */
export async function portraitFromFrame(jpeg: Buffer): Promise<Buffer | null> {
  return (await (await portraitCandidate(jpeg))?.encode()) ?? null;
}

/**
 * Stores the portrait and tells every open dashboard.
 *
 * With `onlyIfMissing` the photo is one nobody asked for (the automatic capture, or the phone's
 * own crop): it only fills a gap. An existing photo is left alone, and so is a patient whose
 * photo staff removed. That is decided by the row in the database, in the same transaction, so
 * it holds across a server restart and against a removal that lands while a frame is being
 * looked at. With `onlyIfStillAt` it is a better frame for a photo that was taken
 * automatically at that time: it replaces that photo and no other, so one staff took or
 * removed in between is left alone. With neither, the photo is one staff asked for: it
 * replaces whatever is there and ends a removal.
 *
 * Returns the patient it was given, the same object, when nothing was stored.
 */
export async function storePhoto(
  patient: PatientRow,
  portrait: Buffer,
  options: { onlyIfMissing?: boolean; onlyIfStillAt?: Date } = {},
): Promise<PatientRow> {
  const now = new Date();
  const values = {
    patientId: patient.id,
    jpeg: portrait,
    width: PATIENT_PHOTO_SIZE,
    height: PATIENT_PHOTO_SIZE,
    createdAt: now,
  };
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.patients)
      .set({ photoUpdatedAt: now, photoRemovedAt: null })
      .where(
        options.onlyIfStillAt
          ? and(
              eq(schema.patients.id, patient.id),
              eq(schema.patients.photoUpdatedAt, options.onlyIfStillAt),
              isNull(schema.patients.photoRemovedAt),
            )
          : options.onlyIfMissing
            ? and(eq(schema.patients.id, patient.id), isNull(schema.patients.photoUpdatedAt), isNull(schema.patients.photoRemovedAt))
            : eq(schema.patients.id, patient.id),
      )
      .returning();
    if (!row) return null;
    await tx
      .insert(schema.patientPhotos)
      .values(values)
      .onConflictDoUpdate({ target: schema.patientPhotos.patientId, set: { jpeg: portrait, createdAt: now } });
    return row;
  });
  if (!updated) return patient;
  patientChanged(toPatientRef(updated));
  return updated;
}

export async function readPhoto(patientId: string): Promise<Buffer | null> {
  const [row] = await db
    .select({ jpeg: schema.patientPhotos.jpeg })
    .from(schema.patientPhotos)
    .where(eq(schema.patientPhotos.patientId, patientId))
    .limit(1);
  return row?.jpeg ?? null;
}

/**
 * Removes the photo and records that staff removed it, so nothing takes a new one by itself
 * (see storePhoto). The mark is on the patient row: a server restart does not forget it.
 */
export async function deletePhoto(patient: PatientRow): Promise<void> {
  const row = await db.transaction(async (tx) => {
    await tx.delete(schema.patientPhotos).where(eq(schema.patientPhotos.patientId, patient.id));
    const [updated] = await tx
      .update(schema.patients)
      .set({ photoUpdatedAt: null, photoRemovedAt: new Date() })
      .where(eq(schema.patients.id, patient.id))
      .returning();
    return updated;
  });
  if (row) patientChanged(toPatientRef(row));
}
