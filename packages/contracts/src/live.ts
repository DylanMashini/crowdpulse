import * as z from 'zod';

import { Id, PatientNumber, PatientRef, Timestamp } from './common.ts';
import { Sitting, StoredReading } from './sittings.ts';
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
} as const;

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
]);
export type StreamEvent = z.infer<typeof StreamEvent>;
export type StreamEventType = StreamEvent['type'];
