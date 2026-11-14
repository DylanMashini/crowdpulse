import * as z from 'zod';

import { Id, TicketNumber, Timestamp } from './common.ts';
import { CaptureSource } from './signal.ts';
import { Sitting, SittingKind } from './sittings.ts';
import { Flag, FlagRule, Score, TileState } from './worklist.ts';

export const TicketStatus = z.enum(['waiting', 'discharged']);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const Ticket = z.object({
  number: TicketNumber,
  status: TicketStatus,
  createdAt: Timestamp,
  dischargedAt: Timestamp.nullable(),
  /** The patient agreed to face match at check-in. */
  faceOptIn: z.boolean(),
  /** A face embedding is stored for this ticket. */
  faceEnrolled: z.boolean(),
});
export type Ticket = z.infer<typeof Ticket>;

export const CreateTicketRequest = z.object({ faceOptIn: z.boolean().default(false) });
export type CreateTicketRequest = z.infer<typeof CreateTicketRequest>;

/** Setting faceOptIn to false deletes the stored embedding. */
export const UpdateTicketRequest = z.object({ faceOptIn: z.boolean() });
export type UpdateTicketRequest = z.infer<typeof UpdateTicketRequest>;

export const TicketResponse = z.object({ ticket: Ticket });
export type TicketResponse = z.infer<typeof TicketResponse>;

export const TicketListQuery = z.object({
  status: z.enum(['waiting', 'discharged', 'all']).default('waiting'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type TicketListQuery = z.infer<typeof TicketListQuery>;
export const TicketListResponse = z.object({ items: z.array(Ticket), nextCursor: z.string().nullable() });
export type TicketListResponse = z.infer<typeof TicketListResponse>;

/** One row of the ticket timeline, newest first. */
export const TimelineEntry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('created'), at: Timestamp }),
  z.object({
    type: z.literal('sitting'),
    /** When the sitting ended. */
    at: Timestamp,
    sittingId: Id,
    kind: SittingKind,
    source: CaptureSource,
    /** bpm; null is "No reading". */
    heartRate: z.number().nullable(),
    /** Breaths per minute; null is "No reading". */
    breathingRate: z.number().nullable(),
    score: Score.nullable(),
  }),
  z.object({ type: z.literal('flag_opened'), at: Timestamp, flagId: Id, rule: FlagRule, handoff: z.string() }),
  z.object({ type: z.literal('flag_acknowledged'), at: Timestamp, flagId: Id, by: z.string() }),
  z.object({ type: z.literal('flag_closed'), at: Timestamp, flagId: Id, rule: FlagRule }),
  z.object({ type: z.literal('discharged'), at: Timestamp }),
]);
export type TimelineEntry = z.infer<typeof TimelineEntry>;

export const TicketDetailResponse = z.object({
  ticket: Ticket,
  /** Null once discharged. */
  state: TileState.nullable(),
  /** The check-in sitting, if it has finished. Trends are measured against it. */
  baseline: Sitting.nullable(),
  /** Every sitting, oldest first. */
  sittings: z.array(Sitting),
  /** Open and closed flags, newest first. */
  flags: z.array(Flag),
  timeline: z.array(TimelineEntry),
  /** The templated handoff sentence for the ticket as it stands. */
  handoff: z.string(),
});
export type TicketDetailResponse = z.infer<typeof TicketDetailResponse>;
