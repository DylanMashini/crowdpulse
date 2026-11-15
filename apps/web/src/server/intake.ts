import { and, desc, eq, isNull } from "drizzle-orm";

import { db, schema } from "../db/client.ts";
import { ApiError } from "./http.ts";
import { pickPortrait } from "./face/pick.ts";
import { GOOD_ENOUGH } from "./face/quality.ts";
import { portraitCandidates, storePhoto } from "./photos.ts";
import type { PatientRow, SittingRow } from "./serialize.ts";

// The profile photo takes itself: while a sitting runs for a patient who has no photo yet,
// the frames the phone is already sending to the live view are looked at, a couple per
// second. The first one with a face is cropped and stored, so a photo appears early; after
// that each frame is scored (face/quality.ts) and one that is clearly better, and of the same
// person (face/pick.ts), replaces it, so the photo ends up being of the patient sitting still
// and facing the camera. Only the photo taken here is ever replaced here: one staff took or
// removed is theirs.

type Running = {
  sittingId: string;
  patient: PatientRow;
  startedAt: number;
  /** Still looking for a photo, or for a better one than `best`. */
  looking: boolean;
  /**
   * The photo taken here that is stored now: its score, its `photoUpdatedAt`, which names it,
   * and the embedding of the face in it, which says whose it is. The embedding lives here, in
   * memory, for the length of the sitting and is never stored. The phone's crop has none.
   */
  best: { score: number; storedAt: Date; embedding: number[] | null } | null;
  lastAttemptAt: number;
  busy: boolean;
};

/** The first second of a sitting is the patient still settling into the chair. */
const SETTLE_MS = 1000;
const ATTEMPT_EVERY_MS = 600;
/** By now the patient has sat down and been still for a while: the photo kept is the photo. */
const IMPROVE_FOR_MS = 30_000;
/** The phone's own crop is a tight face box: any portrait cut here is better. */
const PHONE_CROP_SCORE = 0;
/** After a restart nothing is remembered: ask the database, but not on every frame. */
const LOOKUP_EVERY_MS = 2000;

type IntakeState = {
  running: Map<string, Running>;
  lookedUpAt: Map<string, number>;
  detectorMissing: boolean;
};
const globalForIntake = globalThis as typeof globalThis & { triagecamIntake?: IntakeState };
const state = (globalForIntake.triagecamIntake ??= {
  running: new Map(),
  lookedUpAt: new Map(),
  detectorMissing: false,
});

// What is here is only a cache of which sittings are running. Whether a patient's photo was
// removed by staff is on the patient row (photo_removed_at), so it survives a restart.

export function noteSittingStarted(sitting: SittingRow, patient: PatientRow): void {
  state.running.set(sitting.deviceId, {
    sittingId: sitting.id,
    patient,
    startedAt: sitting.startedAt.getTime(),
    looking: patient.photoUpdatedAt === null && patient.photoRemovedAt === null,
    best: null,
    lastAttemptAt: 0,
    busy: false,
  });
}

export function noteSittingEnded(deviceId: string, sittingId: string): void {
  if (state.running.get(deviceId)?.sittingId === sittingId) state.running.delete(deviceId);
}

function stopLooking(patientId: string): void {
  for (const running of state.running.values()) {
    if (running.patient.id === patientId) running.looking = false;
  }
}

/** Staff stored a photo: stop looking for one, and leave theirs alone. */
export function notePhotoStored(patientId: string): void {
  stopLooking(patientId);
}

/**
 * The phone's own crop filled the gap before a frame from the live view did. It stands in
 * until the live view gives a portrait, which is wider and better framed.
 */
export function notePhoneCropStored(patientId: string, storedAt: Date): void {
  for (const running of state.running.values()) {
    if (running.patient.id === patientId && running.looking && running.best === null) {
      running.best = { score: PHONE_CROP_SCORE, storedAt, embedding: null };
    }
  }
}

/**
 * Staff removed the photo, because it was wrong or the patient does not want one. It stays
 * removed: neither the live view nor the phone's own crop puts one back by itself.
 */
export function notePhotoRemoved(patientId: string): void {
  stopLooking(patientId);
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
  if (!running.looking || running.busy) return;
  if (running.best && now - running.startedAt > IMPROVE_FOR_MS) {
    running.looking = false;
    return;
  }
  if (now - running.startedAt < SETTLE_MS || now - running.lastAttemptAt < ATTEMPT_EVERY_MS) return;

  running.busy = true;
  running.lastAttemptAt = now;
  void (async () => {
    try {
      const candidates = await portraitCandidates(jpeg);
      const best = running.best;
      // The first photo is of the face the camera is pointed at; a later one has to be
      // clearly better and of the same person.
      const picked = await pickPortrait(candidates, best);
      // Staff may have removed the photo, or taken one, while the detector ran.
      if (!picked || !running.looking) return;
      const { candidate, embedding } = picked;
      const { score } = candidate;
      // The database decides, in one statement: a first photo is stored only if there is
      // none and staff did not remove it, a better one only over the photo taken here.
      const stored = await storePhoto(
        running.patient,
        await candidate.encode(),
        best ? { onlyIfStillAt: best.storedAt } : { onlyIfMissing: true },
      );
      if (stored === running.patient || !stored.photoUpdatedAt) {
        // The phone's own crop landed while this frame was being looked at: the next frame
        // replaces it.
        if (running.best !== best) return;
        // Someone else's photo, or a removal, got there first.
        running.looking = false;
        return;
      }
      running.patient = stored;
      running.best = { score, storedAt: stored.photoUpdatedAt, embedding };
      if (score >= GOOD_ENOUGH) running.looking = false;
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
