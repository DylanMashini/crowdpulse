import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type FinishSittingRequest,
  type Reading,
  type Sitting,
  type SittingDetailResponse,
  SittingFileHeader,
  type StartSittingRequest,
} from "@triagecam/contracts";
import { and, asc, eq, isNull, max } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { findDevice } from "./devices.ts";
import { env, isProduction } from "./env.ts";
import { publish, worklistChanged } from "./events.ts";
import { ApiError } from "./http.ts";
import { noteSittingEnded, noteSittingStarted } from "./intake.ts";
import { cameraState } from "./live.ts";
import type { SittingRow } from "./serialize.ts";
import { hasSummary, iso, storedVitals, toPatientRef, toSitting, toStoredReading } from "./serialize.ts";
import { findWaitingPatient } from "./patients.ts";
import { type Elsewhere, sittingIsStray } from "./stray.ts";
import { syncPatients } from "./trend/engine.ts";

export const SITTING_FILE_MAX_BYTES = 5 * 1024 * 1024;

type SittingWithPatient = { sitting: SittingRow; patient: typeof schema.patients.$inferSelect };

async function findSitting(id: string): Promise<SittingWithPatient> {
  const [row] = await db
    .select({ sitting: schema.sittings, patient: schema.patients })
    .from(schema.sittings)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.sittings.patientId))
    .where(eq(schema.sittings.id, id))
    .limit(1);
  if (!row) throw new ApiError("not_found", "There is no sitting with that id");
  return row;
}

/** Starts a sitting. An unfinished sitting of the same patient is ended without a summary first. */
export async function startSitting(request: StartSittingRequest): Promise<{ sitting: Sitting; serverTime: string }> {
  const patient = await findWaitingPatient(request.patientNumber);
  await findDevice(request.deviceId);
  const now = new Date();
  await db
    .update(schema.sittings)
    .set({ endedAt: now })
    .where(and(eq(schema.sittings.patientId, patient.id), isNull(schema.sittings.endedAt)));
  const [row] = await db
    .insert(schema.sittings)
    .values({
      patientId: patient.id,
      deviceId: request.deviceId,
      kind: request.kind,
      source: request.source,
      startedAt: now,
      clockOffsetMs: now.getTime() - Date.parse(request.clientTime),
    })
    .returning();
  if (!row) throw new Error("The sitting was not created");
  const sitting = toSitting(row, patient.number);
  publish({ type: "sitting_started", sitting, patient: toPatientRef(patient) });
  noteSittingStarted(row, patient);
  worklistChanged();
  return { sitting, serverTime: iso(now) };
}

/** Stores readings on the server clock. A reading whose time is already stored is skipped, so a retry is safe. */
export async function postReadings(sittingId: string, readings: Reading[]): Promise<number> {
  const { sitting, patient } = await findSitting(sittingId);
  if (sitting.endedAt) throw new ApiError("sitting_finished", "This sitting has already finished");
  const stored = await db
    .insert(schema.readings)
    .values(
      readings.map((reading) => ({
        sittingId,
        patientId: patient.id,
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
    publish({ type: "reading", sittingId, patientNumber: patient.number, reading: toStoredReading(row) });
  }
  return stored.length;
}

/**
 * Stores the summary and beat intervals, then runs the trend rules. Calling it again returns
 * the stored sitting. A sitting that was ended without a summary (its phone went quiet and the
 * server closed it, or the patient's next sitting started) still takes the summary when the
 * phone gets through with it: a measurement that was made is not thrown away.
 */
export async function finishSitting(sittingId: string, request: FinishSittingRequest): Promise<Sitting> {
  const { sitting, patient } = await findSitting(sittingId);
  if (sitting.endedAt && hasSummary(sitting)) return toSitting(sitting, patient.number);

  const { summary } = request;
  // On the server clock, and never before the start or in the future whatever the phone's clock says.
  const reported = Date.parse(request.endedAt) + sitting.clockOffsetMs;
  const endedAt = new Date(Math.min(Math.max(reported, sitting.startedAt.getTime()), Date.now()));
  // A check-in takes a vital the engine did not record from the readings that were shown live
  // (storedVitals). The phone sends every reading before the summary, so they are all here.
  const shown =
    sitting.kind === "check_in"
      ? await db
          .select({ heartRate: schema.readings.heartRate, breathingRate: schema.readings.breathingRate })
          .from(schema.readings)
          .where(eq(schema.readings.sittingId, sittingId))
      : [];
  const vitals = storedVitals(sitting.kind, summary, {
    heartRate: shown.map((reading) => reading.heartRate),
    breathingRate: shown.map((reading) => reading.breathingRate),
  });
  const finished = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.sittings)
      .set({
        endedAt,
        durationSeconds: summary.durationSeconds,
        heartRate: vitals.heartRate,
        // Coverage stays what the engine recorded, so a value taken from live readings shows it.
        heartRateCoverage: summary.heartRate.coverage,
        heartRateConfidence: vitals.heartRateConfidence,
        heartRateFromLive: vitals.heartRateFromLive,
        breathingRate: vitals.breathingRate,
        breathingRateCoverage: summary.breathingRate.coverage,
        breathingRateFromLive: vitals.breathingRateFromLive,
        rmssd: summary.rmssd.value,
        rmssdCoverage: summary.rmssd.coverage,
        sdnn: summary.sdnn.value,
        sdnnCoverage: summary.sdnn.coverage,
        timeToFirstReadingSeconds: summary.timeToFirstReadingSeconds,
        longestDropoutSeconds: summary.longestDropoutSeconds,
        frameCount: summary.frameCount,
        droppedFrames: summary.droppedFrames,
      })
      .where(and(eq(schema.sittings.id, sittingId), isNull(schema.sittings.durationSeconds)))
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
  if (!finished) return toSitting((await findSitting(sittingId)).sitting, patient.number);

  noteSittingEnded(finished.deviceId, finished.id);
  const wire = toSitting(finished, patient.number);
  publish({ type: "sitting_finished", sitting: wire });
  if (patient.status === "waiting") await syncPatients([patient]);
  worklistChanged();
  return wire;
}

/**
 * Ends a sitting the phone gave up on (the operator left the screen, or called it off from the
 * check-in page) without a summary, so nothing follows it as if it were still running. A
 * sitting that has already ended is returned as it is.
 */
export async function abandonSitting(sittingId: string): Promise<Sitting> {
  const { sitting, patient } = await findSitting(sittingId);
  if (sitting.endedAt) return toSitting(sitting, patient.number);
  const [ended] = await db
    .update(schema.sittings)
    .set({ endedAt: new Date() })
    .where(and(eq(schema.sittings.id, sittingId), isNull(schema.sittings.endedAt)))
    .returning();
  // Finished by another request between the read and the update: answer with what is stored.
  if (!ended) return toSitting((await findSitting(sittingId)).sitting, patient.number);
  noteSittingEnded(ended.deviceId, ended.id);
  const wire = toSitting(ended, patient.number);
  publish({ type: "sitting_finished", sitting: wire });
  worklistChanged();
  return wire;
}

const globalForStray = globalThis as typeof globalThis & { triagecamElsewhere?: Elsewhere };
const elsewhere = (globalForStray.triagecamElsewhere ??= new Map());

/**
 * Ends every open sitting whose phone has gone (stray.ts says when that is). Run every few
 * seconds: it is what takes a patient out of "sitting in progress" when the app was closed or
 * the phone died mid-sitting, and what lets the check-in page move on without a reload.
 */
export async function closeStraySittings(now = Date.now()): Promise<void> {
  const open = await db
    .select({ id: schema.sittings.id, deviceId: schema.sittings.deviceId, startedAt: schema.sittings.startedAt, lastReadingAt: max(schema.readings.t) })
    .from(schema.sittings)
    .leftJoin(schema.readings, eq(schema.readings.sittingId, schema.sittings.id))
    .where(isNull(schema.sittings.endedAt))
    .groupBy(schema.sittings.id);
  const ids = new Set(open.map((sitting) => sitting.id));
  for (const id of elsewhere.keys()) if (!ids.has(id)) elsewhere.delete(id);
  for (const sitting of open) {
    const candidate = { id: sitting.id, startedAt: sitting.startedAt.getTime(), lastReadingAt: sitting.lastReadingAt?.getTime() ?? null };
    if (!sittingIsStray(candidate, cameraState(sitting.deviceId), elsewhere, now)) continue;
    elsewhere.delete(sitting.id);
    await abandonSitting(sitting.id);
  }
}

export async function sittingDetail(sittingId: string): Promise<SittingDetailResponse> {
  const { sitting, patient } = await findSitting(sittingId);
  const [readings, [beats]] = await Promise.all([
    db.select().from(schema.readings).where(eq(schema.readings.sittingId, sittingId)).orderBy(asc(schema.readings.t)),
    db.select().from(schema.beatIntervals).where(eq(schema.beatIntervals.sittingId, sittingId)),
  ]);

  return {
    sitting: toSitting(sitting, patient.number),
    readings: readings.map(toStoredReading),
    beatIntervals: (beats?.intervalsMs ?? []).map((ms, index) => ({ tMs: beats?.beatTimesMs[index] ?? 0, ms })),
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

