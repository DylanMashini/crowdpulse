import { and, desc, eq, isNull } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { ApiError } from "./http.ts";
import { deletePhoto, portraitFromFrame, storePhoto } from "./photos.ts";
import type { PatientRow, SittingRow } from "./serialize.ts";

// The profile photo takes itself: while a sitting runs for a patient who has no photo yet,
// the frames the phone is already sending to the live view are looked at, a couple per
// second, until one shows a face clearly enough to keep. That one frame is cropped and
// stored; the rest are dropped as always.

type Running = {
  sittingId: string;
  patient: PatientRow;
  startedAt: number;
  needsPhoto: boolean;
  lastAttemptAt: number;
  busy: boolean;
};

/** The first second of a sitting is the patient still settling into the chair. */
const SETTLE_MS = 1000;
const ATTEMPT_EVERY_MS = 600;
/** After a restart nothing is remembered: ask the database, but not on every frame. */
const LOOKUP_EVERY_MS = 2000;

type IntakeState = {
  running: Map<string, Running>;
  lookedUpAt: Map<string, number>;
  /**
   * Patients whose photo staff removed. Nothing takes a new one by itself, in this sitting or
   * a later one, until staff ask for it. Held in memory like the rest: a server restart
   * forgets it.
   */
  removed: Set<string>;
  detectorMissing: boolean;
};
const globalForIntake = globalThis as typeof globalThis & { triagecamIntake?: IntakeState };
const state = (globalForIntake.triagecamIntake ??= {
  running: new Map(),
  lookedUpAt: new Map(),
  removed: new Set(),
  detectorMissing: false,
});
// A dev server that hot-reloads this module keeps the state it made before `removed` existed.
state.removed ??= new Set();

export function noteSittingStarted(sitting: SittingRow, patient: PatientRow): void {
  state.running.set(sitting.deviceId, {
    sittingId: sitting.id,
    patient,
    startedAt: sitting.startedAt.getTime(),
    needsPhoto: patient.photoUpdatedAt === null && !state.removed.has(patient.id),
    lastAttemptAt: 0,
    busy: false,
  });
}

export function noteSittingEnded(deviceId: string, sittingId: string): void {
  if (state.running.get(deviceId)?.sittingId === sittingId) state.running.delete(deviceId);
}

function stopLooking(patientId: string): void {
  for (const running of state.running.values()) {
    if (running.patient.id === patientId) running.needsPhoto = false;
  }
}

/** Staff or the phone stored a photo: stop looking for one. */
export function notePhotoStored(patientId: string): void {
  state.removed.delete(patientId);
  stopLooking(patientId);
}

/**
 * Staff removed the photo, because it was wrong or the patient does not want one. It stays
 * removed: neither the live view nor the phone's own crop puts one back by itself.
 */
export function notePhotoRemoved(patientId: string): void {
  state.removed.add(patientId);
  stopLooking(patientId);
}

/** Whether a photo may be stored without staff asking for it. */
export function mayTakePhotoUnasked(patientId: string): boolean {
  return !state.removed.has(patientId);
}

async function lookUp(deviceId: string, now: number): Promise<void> {
  if (now - (state.lookedUpAt.get(deviceId) ?? 0) < LOOKUP_EVERY_MS) return;
  state.lookedUpAt.set(deviceId, now);
  const [row] = await db
    .select({ sitting: schema.sittings, patient: schema.patients })
    .from(schema.sittings)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.sittings.patientId))
    .where(and(eq(schema.sittings.deviceId, deviceId), isNull(schema.sittings.endedAt)))
    .orderBy(desc(schema.sittings.startedAt))
    .limit(1);
  if (row && !state.running.has(deviceId)) noteSittingStarted(row.sitting, row.patient);
}

/**
 * Called with every live frame. Returns at once: the look for a face happens off to the side
 * and never slows the relay.
 */
export function considerFrameForPhoto(deviceId: string, jpeg: Buffer, now = Date.now()): void {
  if (state.detectorMissing) return;
  const running = state.running.get(deviceId);
  if (!running) {
    lookUp(deviceId, now).catch((error) => console.error("[intake] Could not look for a running sitting:", error));
    return;
  }
  if (!running.needsPhoto || running.busy) return;
  if (now - running.startedAt < SETTLE_MS || now - running.lastAttemptAt < ATTEMPT_EVERY_MS) return;

  running.busy = true;
  running.lastAttemptAt = now;
  void (async () => {
    try {
      const portrait = await portraitFromFrame(jpeg);
      // Staff may have removed the photo, or taken one, while the detector ran.
      if (!portrait || !running.needsPhoto) return;
      await storePhoto(running.patient, portrait, { onlyIfMissing: true });
      running.needsPhoto = false;
      // Removed in the instant the photo was being written: the removal stands.
      if (state.removed.has(running.patient.id)) await deletePhoto(running.patient);
    } catch (error) {
      if (error instanceof ApiError && error.code === "face_unavailable") {
        // No detector on this server. The phone's own crop and the retake button still work.
        state.detectorMissing = true;
      } else if (!(error instanceof ApiError)) {
        console.error("[intake] The profile photo could not be taken from the live view:", error);
      }
    } finally {
      running.busy = false;
    }
  })();
}
