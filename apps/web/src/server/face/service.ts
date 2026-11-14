import type { EnrolFaceResponse, MatchFaceResponse } from "@triagecam/contracts";
import { and, eq } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";
import { patientChanged } from "../events.ts";
import { ApiError } from "../http.ts";
import { toPatientRef } from "../serialize.ts";
import { getSettings } from "../settings.ts";
import { deleteFaceEmbeddings, findPatient, findWaitingPatient } from "../patients.ts";
import { decideMatch } from "./confidence.ts";
import { detectFace } from "./detect.ts";
import { embedFace } from "./embed.ts";
import { decodeJpeg } from "./image.ts";
import { FACE_MODEL, faceModels } from "./models.ts";

/** Crop in, embedding out. The picture is decoded in memory and dropped when this returns. */
async function embeddingOf(jpegBase64: string): Promise<number[]> {
  const models = await faceModels();
  const image = await decodeJpeg(jpegBase64);
  const landmarks = await detectFace(image, models);
  if (!landmarks) throw new ApiError("no_face_detected", "No face was found in the picture. Try again facing the camera.");
  return embedFace(image, landmarks, models);
}

/** Stores the embedding for an opted-in patient, replacing an earlier one. */
export async function enrolFace(patientNumber: number, jpegBase64: string): Promise<EnrolFaceResponse> {
  const patient = await findWaitingPatient(patientNumber);
  if (!patient.faceOptIn) {
    throw new ApiError("face_not_opted_in", `Patient ${patientNumber} has not opted in to face match`);
  }
  const vector = await embeddingOf(jpegBase64);
  await db.transaction(async (tx) => {
    await tx.delete(schema.faceEmbeddings).where(eq(schema.faceEmbeddings.patientId, patient.id));
    await tx.insert(schema.faceEmbeddings).values({ patientId: patient.id, vector, model: FACE_MODEL });
  });
  patientChanged(toPatientRef(patient));
  return { patientNumber, model: FACE_MODEL };
}

/** Compares the crop with waiting, opted-in patients enrolled with the same model. */
export async function matchFace(jpegBase64: string): Promise<MatchFaceResponse> {
  const probe = await embeddingOf(jpegBase64);
  const [enrolled, settings] = await Promise.all([
    db
      .select({ patient: schema.patients, vector: schema.faceEmbeddings.vector })
      .from(schema.faceEmbeddings)
      .innerJoin(schema.patients, eq(schema.patients.id, schema.faceEmbeddings.patientId))
      .where(
        and(
          eq(schema.patients.status, "waiting"),
          eq(schema.patients.faceOptIn, true),
          eq(schema.faceEmbeddings.model, FACE_MODEL),
        ),
      ),
    getSettings(),
  ]);
  const candidates = enrolled.map(({ patient, vector }) => ({
    patientNumber: patient.number,
    // Both vectors are L2-normalised, so the dot product is the cosine similarity.
    cosine: vector.reduce((sum, value, index) => sum + value * (probe[index] ?? 0), 0),
  }));
  const decision = decideMatch(candidates, settings.faceMatchMinConfidence);
  const matched = enrolled.find(({ patient }) => patient.number === decision.patientNumber);
  return { ...decision, patient: matched ? toPatientRef(matched.patient) : null };
}

export async function deleteFace(patientNumber: number): Promise<void> {
  const patient = await findPatient(patientNumber);
  await deleteFaceEmbeddings(patient.id);
  patientChanged(toPatientRef(patient));
}
