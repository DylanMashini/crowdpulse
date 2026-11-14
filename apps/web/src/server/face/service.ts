import type { EnrolFaceResponse, MatchFaceResponse } from "@triagecam/contracts";
import { and, eq } from "drizzle-orm";

import { db, schema } from "../../db/client.ts";
import { ticketChanged } from "../events.ts";
import { ApiError } from "../http.ts";
import { getSettings } from "../settings.ts";
import { deleteFaceEmbeddings, findTicket, findWaitingTicket } from "../tickets.ts";
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

/** Stores the embedding for an opted-in ticket, replacing an earlier one. */
export async function enrolFace(ticketNumber: number, jpegBase64: string): Promise<EnrolFaceResponse> {
  const ticket = await findWaitingTicket(ticketNumber);
  if (!ticket.faceOptIn) {
    throw new ApiError("face_not_opted_in", `Ticket ${ticketNumber} has not opted in to face match`);
  }
  const vector = await embeddingOf(jpegBase64);
  await db.transaction(async (tx) => {
    await tx.delete(schema.faceEmbeddings).where(eq(schema.faceEmbeddings.ticketId, ticket.id));
    await tx.insert(schema.faceEmbeddings).values({ ticketId: ticket.id, vector, model: FACE_MODEL });
  });
  ticketChanged(ticketNumber);
  return { ticketNumber, model: FACE_MODEL };
}

/** Compares the crop with waiting, opted-in tickets enrolled with the same model. */
export async function matchFace(jpegBase64: string): Promise<MatchFaceResponse> {
  const probe = await embeddingOf(jpegBase64);
  const [enrolled, settings] = await Promise.all([
    db
      .select({ ticketNumber: schema.tickets.number, vector: schema.faceEmbeddings.vector })
      .from(schema.faceEmbeddings)
      .innerJoin(schema.tickets, eq(schema.tickets.id, schema.faceEmbeddings.ticketId))
      .where(
        and(
          eq(schema.tickets.status, "waiting"),
          eq(schema.tickets.faceOptIn, true),
          eq(schema.faceEmbeddings.model, FACE_MODEL),
        ),
      ),
    getSettings(),
  ]);
  const candidates = enrolled.map(({ ticketNumber, vector }) => ({
    ticketNumber,
    // Both vectors are L2-normalised, so the dot product is the cosine similarity.
    cosine: vector.reduce((sum, value, index) => sum + value * (probe[index] ?? 0), 0),
  }));
  return decideMatch(candidates, settings.faceMatchMinConfidence);
}

export async function deleteFace(ticketNumber: number): Promise<void> {
  const ticket = await findTicket(ticketNumber);
  await deleteFaceEmbeddings(ticket.id);
  ticketChanged(ticketNumber);
}
