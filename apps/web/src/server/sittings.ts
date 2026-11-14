import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type FinishSittingRequest,
  type Reading,
  type ReferenceReading,
  type Sitting,
  type SittingDetailResponse,
  SittingFileHeader,
  type StartSittingRequest,
} from "@triagecam/contracts";
import { and, asc, eq, isNull } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { findDevice } from "./devices.ts";
import { env, isProduction } from "./env.ts";
import { publish, worklistChanged } from "./events.ts";
import { ApiError } from "./http.ts";
import type { SittingRow } from "./serialize.ts";
import { iso, toSitting, toStoredReading } from "./serialize.ts";
import { agreement, pairReadings } from "./stats/agreement.ts";
import { findWaitingTicket } from "./tickets.ts";
import { syncTickets } from "./trend/engine.ts";

export const SITTING_FILE_MAX_BYTES = 5 * 1024 * 1024;

type SittingWithTicket = { sitting: SittingRow; ticket: typeof schema.tickets.$inferSelect };

async function findSitting(id: string): Promise<SittingWithTicket> {
  const [row] = await db
    .select({ sitting: schema.sittings, ticket: schema.tickets })
    .from(schema.sittings)
    .innerJoin(schema.tickets, eq(schema.tickets.id, schema.sittings.ticketId))
    .where(eq(schema.sittings.id, id))
    .limit(1);
  if (!row) throw new ApiError("not_found", "There is no sitting with that id");
  return row;
}

/** Starts a sitting. An unfinished sitting of the same ticket is ended without a summary first. */
export async function startSitting(request: StartSittingRequest): Promise<{ sitting: Sitting; serverTime: string }> {
  const ticket = await findWaitingTicket(request.ticketNumber);
  await findDevice(request.deviceId);
  const now = new Date();
  await db
    .update(schema.sittings)
    .set({ endedAt: now })
    .where(and(eq(schema.sittings.ticketId, ticket.id), isNull(schema.sittings.endedAt)));
  const [row] = await db
    .insert(schema.sittings)
    .values({
      ticketId: ticket.id,
      deviceId: request.deviceId,
      kind: request.kind,
      source: request.source,
      startedAt: now,
      clockOffsetMs: now.getTime() - Date.parse(request.clientTime),
    })
    .returning();
  if (!row) throw new Error("The sitting was not created");
  const sitting = toSitting(row, ticket.number);
  publish({ type: "sitting_started", sitting });
  worklistChanged();
  return { sitting, serverTime: iso(now) };
}

/** Stores readings on the server clock. A reading whose time is already stored is skipped, so a retry is safe. */
export async function postReadings(sittingId: string, readings: Reading[]): Promise<number> {
  const { sitting, ticket } = await findSitting(sittingId);
  if (sitting.endedAt) throw new ApiError("sitting_finished", "This sitting has already finished");
  const stored = await db
    .insert(schema.readings)
    .values(
      readings.map((reading) => ({
        sittingId,
        ticketId: ticket.id,
        t: new Date(Date.parse(reading.t) + sitting.clockOffsetMs),
        heartRate: reading.heartRate.value,
        state: reading.heartRate.state,
        reason: reading.heartRate.reason,
        quality: reading.heartRate.quality,
        coverage: reading.heartRate.coverage,
        ageMs: reading.heartRate.ageMs,
        breathingRate: reading.breathingRate.value,
        breathingState: reading.breathingRate.state,
        breathingReason: reading.breathingRate.reason,
        breathingQuality: reading.breathingRate.quality,
        breathingCoverage: reading.breathingRate.coverage,
        breathingAgeMs: reading.breathingRate.ageMs,
      })),
    )
    .onConflictDoNothing()
    .returning();
  for (const row of stored) {
    publish({ type: "reading", sittingId, ticketNumber: ticket.number, reading: toStoredReading(row) });
  }
  return stored.length;
}

/** Stores the summary and beat intervals, then runs the trend rules. Calling it again returns the stored sitting. */
export async function finishSitting(sittingId: string, request: FinishSittingRequest): Promise<Sitting> {
  const { sitting, ticket } = await findSitting(sittingId);
  if (sitting.endedAt) return toSitting(sitting, ticket.number);

  const { summary } = request;
  // On the server clock, and never before the start or in the future whatever the phone's clock says.
  const reported = Date.parse(request.endedAt) + sitting.clockOffsetMs;
  const endedAt = new Date(Math.min(Math.max(reported, sitting.startedAt.getTime()), Date.now()));
  const finished = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.sittings)
      .set({
        endedAt,
        durationSeconds: summary.durationSeconds,
        heartRate: summary.heartRate.value,
        heartRateCoverage: summary.heartRate.coverage,
        breathingRate: summary.breathingRate.value,
        breathingRateCoverage: summary.breathingRate.coverage,
        rmssd: summary.rmssd.value,
        rmssdCoverage: summary.rmssd.coverage,
        sdnn: summary.sdnn.value,
        sdnnCoverage: summary.sdnn.coverage,
        timeToFirstReadingSeconds: summary.timeToFirstReadingSeconds,
        longestDropoutSeconds: summary.longestDropoutSeconds,
        frameCount: summary.frameCount,
        droppedFrames: summary.droppedFrames,
      })
      .where(and(eq(schema.sittings.id, sittingId), isNull(schema.sittings.endedAt)))
      .returning();
    if (row && summary.beatIntervals.length > 0) {
      await tx
        .insert(schema.beatIntervals)
        .values({
          sittingId,
          intervalsMs: summary.beatIntervals.map((interval) => interval.ms),
          beatTimesMs: summary.beatIntervals.map((interval) => interval.tMs),
        })
        .onConflictDoNothing();
    }
    return row;
  });
  // Another request finished it between the read and the update: answer with what is stored.
  if (!finished) return toSitting((await findSitting(sittingId)).sitting, ticket.number);

  const wire = toSitting(finished, ticket.number);
  publish({ type: "sitting_finished", sitting: wire });
  if (ticket.status === "waiting") await syncTickets([ticket]);
  worklistChanged();
  return wire;
}

/** Reference samples arrive on the laptop's clock, which is the server clock. Allowed after the sitting has finished. */
export async function postReference(sittingId: string, readings: ReferenceReading[]): Promise<number> {
  await findSitting(sittingId);
  const stored = await db
    .insert(schema.referenceReadings)
    .values(
      readings.map((reading) => ({
        sittingId,
        t: new Date(reading.t),
        heartRate: reading.heartRate,
        rrIntervalsMs: reading.rrIntervalsMs,
        breathingRate: reading.breathingRate ?? null,
        source: reading.source,
      })),
    )
    .returning({ id: schema.referenceReadings.id });
  return stored.length;
}

export async function sittingDetail(sittingId: string): Promise<SittingDetailResponse> {
  const { sitting, ticket } = await findSitting(sittingId);
  const [readings, references, [beats]] = await Promise.all([
    db.select().from(schema.readings).where(eq(schema.readings.sittingId, sittingId)).orderBy(asc(schema.readings.t)),
    db
      .select()
      .from(schema.referenceReadings)
      .where(eq(schema.referenceReadings.sittingId, sittingId))
      .orderBy(asc(schema.referenceReadings.t)),
    db.select().from(schema.beatIntervals).where(eq(schema.beatIntervals.sittingId, sittingId)),
  ]);

  const pairs = pairReadings(
    readings.flatMap((row) => (row.heartRate === null ? [] : [{ t: row.t.getTime(), heartRate: row.heartRate }])),
    references.flatMap((row) => (row.heartRate === null ? [] : [{ t: row.t.getTime(), heartRate: row.heartRate }])),
  );
  const { pairedReadings, meanAbsoluteErrorBpm, within5BpmShare } = agreement(pairs);

  return {
    sitting: toSitting(sitting, ticket.number),
    readings: readings.map(toStoredReading),
    referenceReadings: references.map((row) => ({
      t: iso(row.t),
      heartRate: row.heartRate,
      rrIntervalsMs: row.rrIntervalsMs,
      breathingRate: row.breathingRate,
      source: row.source,
    })),
    beatIntervals: (beats?.intervalsMs ?? []).map((ms, index) => ({ tMs: beats?.beatTimesMs[index] ?? 0, ms })),
    meanAbsoluteErrorBpm,
    pairedReadings,
    within5BpmShare,
  };
}

/**
 * Saves an uploaded sitting file as <SITTING_FILES_DIR>/<id>.jsonl. Development and pilot
 * only: the files hold per-frame numbers from consenting people and are for tuning.
 */
export async function saveSittingFile(sittingId: string, body: Buffer): Promise<void> {
  if (isProduction()) throw new ApiError("forbidden", "Sitting files are not accepted in production");
  await findSitting(sittingId);
  if (body.byteLength > SITTING_FILE_MAX_BYTES) throw new ApiError("payload_too_large", "A sitting file is at most 5 MB");

  const newline = body.indexOf(0x0a);
  const firstLine = body.subarray(0, newline === -1 ? body.byteLength : newline).toString("utf8");
  let header: unknown;
  try {
    header = JSON.parse(firstLine);
  } catch {
    header = null;
  }
  if (!SittingFileHeader.safeParse(header).success) {
    throw new ApiError("invalid_request", "The body is not a sitting file: line 1 must be its header");
  }

  // sittingId is a validated UUID, so the path cannot leave the directory.
  const directory = resolve(/*turbopackIgnore: true*/ process.cwd(), env().SITTING_FILES_DIR);
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${sittingId}.jsonl`);
  await writeFile(`${path}.part`, body);
  await rename(`${path}.part`, path);
}

