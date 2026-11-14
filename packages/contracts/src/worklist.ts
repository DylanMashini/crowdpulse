import * as z from 'zod';

import { TicketNumber, Timestamp } from './common.ts';
import { CaptureSource } from './signal.ts';

/** Every waiting ticket is in exactly one of these. There is no normal state. */
export const TileState = z.enum(['observed', 'flag', 'overdue', 'no-reading']);
export type TileState = z.infer<typeof TileState>;

/** Partial NEWS2 band of one parameter, or the higher of the two measured parameters. */
export const Score = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type Score = z.infer<typeof Score>;

/** A value against the ticket's own check-in baseline. `now: null` means no reading. */
export const Trend = z.object({
  base: z.number().nullable(),
  now: z.number().nullable(),
});
export type Trend = z.infer<typeof Trend>;

export const FlagRule = z.enum(['score_rise', 'baseline_shift', 'overdue']);
export type FlagRule = z.infer<typeof FlagRule>;

/** The numbers a flag was raised on, frozen when it opened. */
export const FlagDetail = z.object({
  pulse: Trend,
  breathing: Trend,
  scoreAtCheckIn: Score.nullable(),
  scoreNow: Score.nullable(),
  /** Minutes from check-in to the observation that opened the flag. */
  minutesSinceCheckIn: z.number().nonnegative(),
  /** For overdue: minutes since the last valid observation when the flag opened. */
  minutesSinceObserved: z.number().nonnegative().nullable(),
});
export type FlagDetail = z.infer<typeof FlagDetail>;

export const Flag = z.object({
  id: z.uuid(),
  ticketNumber: TicketNumber,
  rule: FlagRule,
  openedAt: Timestamp,
  /** Null while the episode is open. */
  closedAt: Timestamp.nullable(),
  detail: FlagDetail,
  acknowledgedAt: Timestamp.nullable(),
  /** Email of the staff member who acknowledged. */
  acknowledgedBy: z.string().nullable(),
  /** The templated handoff sentence for this flag. */
  handoff: z.string(),
});
export type Flag = z.infer<typeof Flag>;

export const FlagListQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).default('open'),
  ticket: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
export type FlagListQuery = z.infer<typeof FlagListQuery>;
export const FlagListResponse = z.object({ items: z.array(Flag), nextCursor: z.string().nullable() });
export type FlagListResponse = z.infer<typeof FlagListResponse>;
export const FlagResponse = z.object({ flag: Flag });
export type FlagResponse = z.infer<typeof FlagResponse>;

export const WorklistItem = z.object({
  /** 1 is who to walk to first. Items arrive in rank order. */
  rank: z.int().positive(),
  ticketNumber: TicketNumber,
  state: TileState,
  /** When the ticket was created. */
  waitingSince: Timestamp,
  /** End of the last sitting that gave a valid heart or breathing rate. */
  lastObservedAt: Timestamp.nullable(),
  /** Whole minutes since lastObservedAt, at generatedAt. */
  minutesSinceObserved: z.int().nonnegative().nullable(),
  pulse: Trend,
  breathing: Trend,
  /** Null when the latest sitting gave no reading. */
  score: Score.nullable(),
  scoreAtCheckIn: Score.nullable(),
  /** How many of the two parameters the score is based on. */
  parametersMeasured: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  /** Source of the latest sitting. Anything but camera is labelled on screen. */
  source: CaptureSource.nullable(),
  /** Open flags, trend rules first. Empty unless state is flag or overdue. */
  flags: z.array(Flag),
  /** The templated handoff sentence for the ticket as it stands. */
  handoff: z.string(),
  /** A sitting is running for this ticket now. */
  sittingInProgress: z.boolean(),
});
export type WorklistItem = z.infer<typeof WorklistItem>;

export const WorklistResponse = z.object({
  generatedAt: Timestamp,
  recheckIntervalMin: z.number().positive(),
  items: z.array(WorklistItem),
});
export type WorklistResponse = z.infer<typeof WorklistResponse>;
