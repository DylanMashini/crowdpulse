import { PATIENT_PHOTO_SIZE } from "@triagecam/contracts";
import { eq } from "drizzle-orm";
import sharp, { type Sharp } from "sharp";

import { db, schema } from "../db/client.ts";
import { patientChanged } from "./events.ts";
import { detectFace } from "./face/detect.ts";
import { decodeJpegBytes } from "./face/image.ts";
import { faceModels } from "./face/models.ts";
import { portraitSquare } from "./face/portrait.ts";
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

/**
 * Finds the face in a whole camera frame and cuts the portrait out of it. Null when no face
 * is found or it is too small. Throws face_unavailable when the detector is not installed.
 */
export async function portraitFromFrame(jpeg: Buffer): Promise<Buffer | null> {
  const models = await faceModels();
  const image = await decodeJpegBytes(jpeg);
  const landmarks = await detectFace(image, models);
  if (!landmarks) return null;
  const square = portraitSquare(landmarks, image.width, image.height);
  if (!square) return null;
  return encode(
    sharp(image.data, { raw: { width: image.width, height: image.height, channels: 3 } }).extract({
      left: square.left,
      top: square.top,
      width: square.size,
      height: square.size,
    }),
  );
}

/**
 * Stores the portrait and tells every open dashboard. With `onlyIfMissing` an existing photo
 * is left alone (the automatic capture must not overwrite one that staff or the phone chose).
 */
export async function storePhoto(
  patient: PatientRow,
  portrait: Buffer,
  options: { onlyIfMissing?: boolean } = {},
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
    if (options.onlyIfMissing) {
      const inserted = await tx
        .insert(schema.patientPhotos)
        .values(values)
        .onConflictDoNothing()
        .returning({ patientId: schema.patientPhotos.patientId });
      if (inserted.length === 0) return null;
    } else {
      await tx
        .insert(schema.patientPhotos)
        .values(values)
        .onConflictDoUpdate({ target: schema.patientPhotos.patientId, set: { jpeg: portrait, createdAt: now } });
    }
    const [row] = await tx
      .update(schema.patients)
      .set({ photoUpdatedAt: now })
      .where(eq(schema.patients.id, patient.id))
      .returning();
    return row ?? null;
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

export async function deletePhoto(patient: PatientRow): Promise<void> {
  const row = await db.transaction(async (tx) => {
    await tx.delete(schema.patientPhotos).where(eq(schema.patientPhotos.patientId, patient.id));
    const [updated] = await tx
      .update(schema.patients)
      .set({ photoUpdatedAt: null })
      .where(eq(schema.patients.id, patient.id))
      .returning();
    return updated;
  });
  if (row) patientChanged(toPatientRef(row));
}
