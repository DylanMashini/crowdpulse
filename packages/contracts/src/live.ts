import * as z from 'zod';

import { Id, TicketNumber, Timestamp } from './common.ts';
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
  maxFps: 5,
  maxLongSidePx: 640,
  jpegQuality: 0.5,
  /** A device with no frame for this long is no longer live. */
  timeoutMs: 5000,
} as const;

/**
 * Events on GET /api/stream (server-sent events). The SSE `event:` field is `type`; `data:`
 * is the whole object as JSON.
 */
export const StreamEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('reading'),
    sittingId: Id,
    ticketNumber: TicketNumber,
    reading: StoredReading,
  }),
  z.object({ type: z.literal('sitting_started'), sitting: Sitting }),
  z.object({ type: z.literal('sitting_finished'), sitting: Sitting }),
  z.object({ type: z.literal('flag_opened'), flag: Flag }),
  z.object({ type: z.literal('flag_acknowledged'), flag: Flag }),
  z.object({ type: z.literal('flag_closed'), flag: Flag }),
  /** Ranks or states may have changed: refetch GET /api/worklist. */
  z.object({ type: z.literal('worklist_changed'), at: Timestamp }),
  z.object({ type: z.literal('ticket_changed'), ticketNumber: TicketNumber, at: Timestamp }),
  z.object({ type: z.literal('live_changed'), deviceId: Id, live: z.boolean() }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;
export type StreamEventType = StreamEvent['type'];
