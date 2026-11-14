import { and, desc, eq, isNull } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { ApiError } from "./http.ts";
import { portraitFromFrame, storePhoto } from "./photos.ts";
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

type IntakeState = { running: Map<string, Running>; lookedUpAt: Map<string, number>; detectorMissing: boolean };
const globalForIntake = globalThis as typeof globalThis & { triagecamIntake?: IntakeState };
const state = (globalForIntake.triagecamIntake ??= {
  running: new Map(),
  lookedUpAt: new Map(),
  detectorMissing: false,
});

export function noteSittingStarted(sitting: SittingRow, patient: PatientRow): void {
  state.running.set(sitting.deviceId, {
    sittingId: sitting.id,
    patient,
    startedAt: sitting.startedAt.getTime(),
    needsPhoto: patient.photoUpdatedAt === null,
    lastAttemptAt: 0,
    busy: false,
  });
}

export function noteSittingEnded(deviceId: string, sittingId: string): void {
  if (state.running.get(deviceId)?.sittingId === sittingId) state.running.delete(deviceId);
}

/** The photo was stored or removed by hand: stop, or start, looking for one. */
export function notePhotoChanged(patientId: string, hasPhoto: boolean): void {
  for (const running of state.running.values()) {
    if (running.patient.id === patientId) running.needsPhoto = !hasPhoto;
  }
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
      if (!portrait) return;
      // The phone may have sent its own crop in the meantime; that one wins.
      await storePhoto(running.patient, portrait, { onlyIfMissing: true });
      running.needsPhoto = false;
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
