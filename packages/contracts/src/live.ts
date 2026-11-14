import * as z from 'zod';

import { Id, PatientNumber, PatientRef, Timestamp } from './common.ts';
import { Sitting, SittingKind, StoredReading } from './sittings.ts';
import { Flag } from './worklist.ts';

/** One live-view frame from a camera-role phone. Relayed in memory, never stored. */
export const LiveFrame = z.object({
  /** JPEG, base64 without a data: prefix. At most 640 px on the long side. */
  jpegBase64: z.string().min(1).max(400_000),
  width: z.int().positive(),
  height: z.int().positive(),
  /** Phone wall clock. */
  t: Timestamp,
});
export type LiveFrame = z.infer<typeof LiveFrame>;

export const PostLiveFrameResponse = z.object({
  /** Dashboards reading this device's stream right now. The phone may slow to 1 fps at 0. */
  viewers: z.int().nonnegative(),
});
export type PostLiveFrameResponse = z.infer<typeof PostLiveFrameResponse>;

/** Phone-side limits for the live view. */
export const LIVE_VIEW = {
  /** Frames per second the phone sends while someone is watching or an intake sitting runs. */
  fps: 15,
  /** The server refuses frames arriving faster than this. */
  maxFps: 30,
  /** With nobody watching, the phone drops to this rate. */
  idleFps: 2,
  maxLongSidePx: 640,
  jpegQuality: 0.5,
  /** A binary frame body is at most this many bytes. */
  maxFrameBytes: 300_000,
  /** A device with no frame for this long is no longer live. */
  timeoutMs: 5000,
  /** The phone reports its state at least this often while the camera role is open. */
  stateIntervalMs: 1000,
  /** A phone with no state report for this long is no longer connected. */
  stateTimeoutMs: 4000,
  /** Outlines older than this are not drawn: the face they belong to has moved on. */
  regionsMaxAgeMs: 1000,
  /** A command the phone has not collected after this long is dropped. */
  commandTimeoutMs: 5000,
} as const;

/**
 * Headers of the binary form of POST /api/live/:deviceId/frame (body: the JPEG itself,
 * Content-Type image/jpeg), and of each part of the multipart stream the dashboard reads.
 */
export const LIVE_FRAME_HEADERS = {
  /** Phone wall clock when the frame was captured, ms since the epoch. */
  capturedAt: 'x-frame-captured-at',
  /** Server clock when the frame arrived, ms since the epoch. Stream parts only. */
  receivedAt: 'x-frame-received-at',
  /** Counts up by one per frame the server relayed for the device. Stream parts only. */
  sequence: 'x-frame-sequence',
  /** The outlines that belong on this frame, as `LiveRegions` JSON. Stream parts only; absent when there are none. */
  regions: 'x-frame-regions',
} as const;

/** A point of the camera frame as captured and shown upright: x right, y down, both 0 to 1, origin top-left. */
export const LivePoint = z.object({ x: z.number(), y: z.number() });
export type LivePoint = z.infer<typeof LivePoint>;
export const LiveRect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
export type LiveRect = z.infer<typeof LiveRect>;
const LivePolygon = z.array(LivePoint).min(3).max(16);

/**
 * What the phone is measuring on, as it computes it: the capture module's `onFaceRegions`
 * payload. The dashboard draws these over the live picture and never detects anything itself.
 * Coordinates are never mirrored. Everything but `aspectRatio` is null when no face is tracked.
 */
export const LiveRegions = z.object({
  /** Width divided by height of the upright frame the coordinates refer to. */
  aspectRatio: z.number().positive(),
  face: LiveRect.nullable(),
  forehead: LivePolygon.nullable(),
  /** The cheek on the left of the image. */
  leftCheek: LivePolygon.nullable(),
  rightCheek: LivePolygon.nullable(),
  /** The upper-chest region breathing is measured on. */
  chest: LiveRect.nullable(),
});
export type LiveRegions = z.infer<typeof LiveRegions>;

/**
 * Where the camera phone is in a check-in. `idle` is the camera role with no sitting screen
 * open; the rest are the sitting screen's own phases.
 */
export const CameraPhase = z.enum(['idle', 'preparing', 'permission_denied', 'unavailable', 'framing', 'starting', 'running', 'stopping']);
export type CameraPhase = z.infer<typeof CameraPhase>;

/** The capture module's viewfinder states. */
export const CameraViewfinder = z.enum(['searching', 'locking', 'measuring', 'lost']);
export type CameraViewfinder = z.infer<typeof CameraViewfinder>;

/** What a camera phone says about itself, so the check-in page can stand in for its screen. */
export const CameraState = z.object({
  phase: CameraPhase,
  /** The patient the sitting screen is open for. Null when idle. */
  patientNumber: PatientNumber.nullable(),
  kind: SittingKind.nullable(),
  /** The running sitting. */
  sittingId: Id.nullable(),
  /** Null until capture reports, and when idle. */
  viewfinder: CameraViewfinder.nullable(),
  facePresent: z.boolean(),
  exposureLocked: z.boolean(),
  /** What the phone's screen says went wrong, in one sentence. */
  error: z.string().max(300).nullable(),
});
export type CameraState = z.infer<typeof CameraState>;

export const CameraCommandType = z.enum([
  /** Open the sitting screen for a patient: the camera starts and framing begins. */
  'open',
  /** Start the 60-second sitting. Only while framing. */
  'start',
  /** End the running sitting now and save it. */
  'stop',
  /** Leave the sitting screen. A running sitting is abandoned and nothing is saved. */
  'cancel',
]);
export type CameraCommandType = z.infer<typeof CameraCommandType>;

/** What the dashboard asks a camera phone to do. The phone's own controls do the same things. */
export const SendCameraCommandRequest = z
  .object({
    type: CameraCommandType,
    /** For `open`. */
    patientNumber: PatientNumber.optional(),
    /** For `open`. */
    kind: SittingKind.optional(),
    /** For `start`: the patient opted in to face match and has no face stored yet. */
    enrolFace: z.boolean().optional(),
  })
  .refine((command) => command.type !== 'open' || (command.patientNumber !== undefined && command.kind !== undefined), {
    message: 'open needs patientNumber and kind',
  });
export type SendCameraCommandRequest = z.infer<typeof SendCameraCommandRequest>;

/** A command on its way to the phone. Handed over once, in the answer to a state report. */
export const CameraCommand = z.object({
  id: Id,
  type: CameraCommandType,
  patientNumber: PatientNumber.nullable(),
  kind: SittingKind.nullable(),
  enrolFace: z.boolean(),
});
export type CameraCommand = z.infer<typeof CameraCommand>;
export const SendCameraCommandResponse = z.object({ command: CameraCommand });
export type SendCameraCommandResponse = z.infer<typeof SendCameraCommandResponse>;

/** The phone's report on the live-view channel: its state, and the outlines when the camera is on. */
export const PostLiveStateRequest = z.object({
  state: CameraState,
  regions: LiveRegions.nullable(),
});
export type PostLiveStateRequest = z.infer<typeof PostLiveStateRequest>;

export const PostLiveStateResponse = z.object({
  viewers: z.int().nonnegative(),
  /** The dashboard's command for this phone, if one is waiting. Carry it out once. */
  command: CameraCommand.nullable(),
});
export type PostLiveStateResponse = z.infer<typeof PostLiveStateResponse>;

/**
 * Events on GET /api/stream (server-sent events). The SSE `event:` field is `type`; `data:`
 * is the whole object as JSON.
 */
export const StreamEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reading'),
    sittingId: Id,
    patientNumber: PatientNumber,
    reading: StoredReading,
  }),
  z.object({ type: z.literal('sitting_started'), sitting: Sitting, patient: PatientRef }),
  z.object({ type: z.literal('sitting_finished'), sitting: Sitting }),
  z.object({ type: z.literal('flag_opened'), flag: Flag }),
  z.object({ type: z.literal('flag_acknowledged'), flag: Flag }),
  z.object({ type: z.literal('flag_closed'), flag: Flag }),
  /** Ranks or states may have changed: refetch GET /api/worklist. */
  z.object({ type: z.literal('worklist_changed'), at: Timestamp }),
  /** A patient was created, renamed, photographed, updated or discharged. Carries the new name and photo. */
  z.object({ type: z.literal('patient_changed'), patientNumber: PatientNumber, patient: PatientRef, at: Timestamp }),
  z.object({ type: z.literal('live_changed'), deviceId: Id, live: z.boolean() }),
  /** A camera phone's state changed, or (null) it stopped reporting. */
  z.object({ type: z.literal('camera_state'), deviceId: Id, state: CameraState.nullable() }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;
export type StreamEventType = StreamEvent['type'];
