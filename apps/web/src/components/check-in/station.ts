import type { CameraCommandType, CameraState, Patient, Sitting } from '@triagecam/contracts';

// What the check-in page shows and offers at each point of a check-in. Kept apart from the
// components so the rules can be read, and tested, in one place.

/** Where the check-in in front of one camera phone has got to. */
export type Stage =
  /** The phone is not reporting and its camera is off. */
  | 'offline'
  /** The phone sends its picture but takes no commands: an app from before remote control. */
  | 'manual'
  /** Connected, nothing open: ready for the next patient. */
  | 'ready'
  /** The sitting screen is opening and the camera is starting. */
  | 'opening'
  /** The phone's camera cannot be used: permission refused, or it did not start. */
  | 'blocked'
  /** The camera is on and nobody has pressed Start. */
  | 'framing'
  | 'starting'
  | 'running'
  /** The 60 seconds are over and the phone is saving the sitting. */
  | 'saving'
  /** A sitting was running and the phone went quiet. */
  | 'lost'
  /** The sitting finished and its summary is here. */
  | 'done'
  /** The sitting ended without a summary: called off here, or left on the phone. */
  | 'called_off';

export interface StageInput {
  /** What the phone last reported. Null when it is not reporting. */
  camera: CameraState | null;
  /** The phone is posting live-view frames. */
  cameraLive: boolean;
  /** The sitting this page is showing for the phone: running, or the last one that ended. */
  sitting: Sitting | null;
  /** The phone reported its state earlier in this visit to the page, so it is not an older app. */
  reportedBefore?: boolean;
  /** The phone has been back at idle for a while and the sitting's summary still has not arrived. */
  summaryOverdue?: boolean;
}

/** How long the summary may take to arrive after the phone has left the sitting. */
export const SUMMARY_OVERDUE_MS = 10_000;

export function stageOf({ camera, cameraLive, sitting, reportedBefore = false, summaryOverdue = false }: StageInput): Stage {
  const running = sitting !== null && sitting.endedAt === null;
  const ended = sitting !== null && sitting.endedAt !== null;
  if (!camera) {
    // Frames with no state reports are an older app, unless this phone was reporting a moment
    // ago: then it has gone quiet, and its last frames are still on their way out.
    const manual = cameraLive && !reportedBefore;
    if (running) return manual ? 'manual' : 'lost';
    if (ended) return sitting.summary ? 'done' : 'called_off';
    return manual ? 'manual' : 'offline';
  }
  switch (camera.phase) {
    case 'idle':
      // The phone is done with the sitting and its summary is on the way. If it never comes,
      // the phone walked away from it (the app was closed mid-sitting).
      if (running) return summaryOverdue ? 'called_off' : 'saving';
      if (ended) return sitting.summary ? 'done' : 'called_off';
      return 'ready';
    case 'preparing':
      return 'opening';
    case 'permission_denied':
    case 'unavailable':
      return 'blocked';
    case 'framing':
      return 'framing';
    case 'starting':
      return 'starting';
    case 'running':
      return 'running';
    case 'stopping':
      return 'saving';
  }
}

const BEFORE_SITTING: ReadonlySet<CameraState['phase']> = new Set(['preparing', 'permission_denied', 'unavailable', 'framing', 'starting']);

/**
 * Which sitting belongs on screen. The last finished one stays until staff move on from it
 * (`dismissedId`), or until the phone opens a check-in of its own: then the page is about the
 * patient in front of the camera, not the one before.
 */
export function sittingToShow(followed: Sitting | null, camera: CameraState | null, dismissedId: string | null): Sitting | null {
  if (!followed || followed.id === dismissedId) return null;
  if (followed.endedAt === null) return followed;
  if (camera && BEFORE_SITTING.has(camera.phase)) return null;
  if (camera && (camera.phase === 'running' || camera.phase === 'stopping') && camera.sittingId !== null && camera.sittingId !== followed.id) return null;
  return followed;
}

export interface PendingCommand {
  type: CameraCommandType;
  /** For `open`. */
  patientNumber: number | null;
}

/** True once the phone's own report shows the command was carried out, or refused there. */
export function commandSettled(pending: PendingCommand, camera: CameraState): boolean {
  switch (pending.type) {
    case 'open':
      return camera.phase !== 'idle' && camera.patientNumber === pending.patientNumber;
    case 'start':
      return camera.phase !== 'framing' || camera.error !== null;
    case 'stop':
      return camera.phase !== 'running' || camera.error !== null;
    case 'cancel':
      return camera.phase === 'idle';
  }
}

/** Start is offered once there is a face to measure. The phone's own button has no such rule. */
export function readyToStart(camera: CameraState | null): boolean {
  return camera !== null && camera.phase === 'framing' && camera.facePresent;
}

export interface StageCopy {
  title: string;
  detail: string | null;
  /** The detail is something to act on, not a description. */
  attention?: boolean;
}

/** The two lines under the picture: what is happening, and what to do about it. */
export function stageCopy(
  stage: Stage,
  camera: CameraState | null,
  phone: string,
  patient: string | null,
  kind: Sitting['kind'] | null,
  lowConfidence: boolean,
  /** The sitting finished with no heart rate at all. */
  noReading = false,
): StageCopy {
  const who = patient ?? 'this patient';
  switch (stage) {
    case 'offline':
      return { title: `${phone} is not connected`, detail: 'Open Crowdpulse on the phone and choose the camera role. Everything else happens here.' };
    case 'manual':
      return { title: `Start on ${phone}`, detail: 'This phone runs an older app that takes no commands from the dashboard. Its picture and readings still show here.' };
    case 'ready':
      return { title: 'Ready for the next patient', detail: `Seat the patient in front of ${phone}, then start here. Nobody needs to touch the phone.` };
    case 'opening':
      return { title: `Starting the camera on ${phone}`, detail: null };
    case 'blocked':
      return camera?.phase === 'permission_denied'
        ? { title: `${phone} cannot use its camera`, detail: 'Allow camera access for Crowdpulse in the Settings app on the phone, then check in again.', attention: true }
        : { title: `The camera on ${phone} did not start`, detail: camera?.error ?? 'Close this check-in and try again.', attention: true };
    case 'framing':
      if (!camera?.facePresent) return { title: 'Looking for a face', detail: 'Seat the patient 0.6 to 0.9 m from the phone, facing it.' };
      return camera.exposureLocked
        ? { title: 'Ready to start', detail: 'Face in view and exposure locked.' }
        : { title: 'Face found', detail: 'Exposure is settling. You can start now.' };
    case 'starting':
      return { title: 'Starting the sitting', detail: null };
    case 'running':
      return camera?.viewfinder === 'lost' || camera?.viewfinder === 'searching'
        ? { title: 'Measuring', detail: 'Face not in view. Ask the patient to face the phone and keep still.', attention: true }
        : { title: 'Measuring', detail: 'Keep still and breathe normally. Fill in the form while it runs.' };
    case 'saving':
      return { title: 'Saving the sitting', detail: null };
    case 'lost':
      return { title: `${phone} stopped responding`, detail: 'The sitting may still be running on the phone. Check that the app is open and the phone is on the network.', attention: true };
    case 'done':
      // Finished is not the same as measured: with nothing to show for it, say so and what to do.
      if (noReading) return { title: 'Sitting complete, no reading', detail: `No heart rate was accepted for ${who}. Repeat the sitting.`, attention: true };
      if (lowConfidence) return { title: 'Sitting complete', detail: `Saved with lower confidence for ${who}. Repeat the sitting.`, attention: true };
      return { title: 'Sitting complete', detail: kind === 'recheck' ? `Re-check saved for ${who}.` : `Baseline saved for ${who}.` };
    case 'called_off':
      // The readings are gone; the patient is not. A new check-in made the record before the camera started.
      return { title: 'Sitting called off', detail: `No readings were saved. ${patient ?? 'The patient'} is still in the waiting room.` };
  }
}

/**
 * True when nothing at all has been entered for a patient: no intake field, no photo, no face
 * match, no sitting. Such a record was made by pressing "Check in a new patient" and stands for
 * nobody, so cancelling the check-in may take it out of the waiting room again. Anything staff
 * entered, on any screen, makes it a patient who stays.
 */
export function isBlankRecord(patient: Patient, sittings: number): boolean {
  const entered = [patient.name, patient.reasonForVisit, patient.dateOfBirth, patient.sex, patient.allergies, patient.notes];
  return (
    sittings === 0 &&
    entered.every((value) => value === null || value.trim() === '') &&
    patient.painScore === null &&
    patient.photoUpdatedAt === null &&
    patient.intakeCompletedAt === null &&
    !patient.faceOptIn &&
    !patient.faceEnrolled
  );
}
