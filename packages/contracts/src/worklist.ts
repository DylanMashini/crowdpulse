import * as z from 'zod';

import { PatientNumber, PatientRef, Timestamp } from './common.ts';
import { CaptureSource } from './signal.ts';

/** Every waiting patient is in exactly one of these. There is no normal state. */
export const TileState = z.enum(['observed', 'flag', 'overdue', 'no-reading']);
export type TileState = z.infer<typeof TileState>;

/** Partial NEWS2 band of one parameter, or the higher of the two measured parameters. */
export const Score = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type Score = z.infer<typeof Score>;

/** A value against the patient's own check-in baseline. `now: null` means no reading. */
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
  patientNumber: PatientNumber,
  /** Who the flag is about, as they are now (not frozen with the flag). */
  patient: PatientRef,
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
  /**
   * Which alert the flag belongs to. Flags with the same `alertId` are one alert: the trend
   * flags that one sitting raised together for one patient. An overdue flag is always an alert
   * on its own. Opaque: compare it for equality and nothing else. Group with `flagAlerts`.
   */
  alertId: z.string().min(1),
});
export type Flag = z.infer<typeof Flag>;

/**
 * What a nurse is told about and acknowledges: one or more flags that share an `alertId`.
 * Every screen counts, lists, announces and acknowledges alerts, never single flags.
 */
export type FlagAlert = {
  /** The `alertId` its flags share. */
  id: string;
  /** In the order they were given. Never empty. */
  flags: Flag[];
  /** The first flag. An alert's flags share their patient, opening time, numbers and sentence. */
  lead: Flag;
  /** The open flags nobody has acknowledged. Acknowledging any one of them covers the rest. */
  waiting: Flag[];
  /** When the last of its flags was acknowledged. Null while any flag has not been. */
  acknowledgedAt: string | null;
  /** Who made that acknowledgement. */
  acknowledgedBy: string | null;
  /** When the last of its flags closed. Null while any flag is open. */
  closedAt: string | null;
};

/** The latest of the times, or null when any of them is missing. */
function latest(times: (string | null)[]): string | null {
  let last: string | null = null;
  for (const time of times) {
    if (time === null) return null;
    if (last === null || time > last) last = time;
  }
  return last;
}

/**
 * Flags gathered into alerts, in the order each alert first appears. Pass the flags of one
 * list (the open ones, or the closed ones): an alert is built only from the flags given.
 */
export function flagAlerts(flags: Flag[]): FlagAlert[] {
  const groups = new Map<string, Flag[]>();
  for (const flag of flags) {
    const group = groups.get(flag.alertId);
    if (group) group.push(flag);
    else groups.set(flag.alertId, [flag]);
  }
  return [...groups].map(([id, members]) => {
    const acknowledgedAt = latest(members.map((flag) => flag.acknowledgedAt));
    return {
      id,
      flags: members,
      lead: members[0] as Flag,
      waiting: members.filter((flag) => flag.acknowledgedAt === null && flag.closedAt === null),
      acknowledgedAt,
      acknowledgedBy: members.find((flag) => flag.acknowledgedAt === acknowledgedAt)?.acknowledgedBy ?? null,
      closedAt: latest(members.map((flag) => flag.closedAt)),
    };
  });
}

export const FlagListQuery = z.object({
  status: z.enum(['open', 'closed', 'all']).default('open'),
  patient: z.coerce.number().int().positive().optional(),
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
  patientNumber: PatientNumber,
  patient: PatientRef,
  /** The chief complaint from intake, if it has been entered. */
  reasonForVisit: z.string().nullable(),
  /** Whole years, from the date of birth; null when it is not known. */
  ageYears: z.int().nonnegative().nullable(),
  state: TileState,
  /** When the patient was created. */
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
  /** The templated handoff sentence for the patient as it stands. */
  handoff: z.string(),
  /** A sitting is running for this patient now. */
  sittingInProgress: z.boolean(),
});
export type WorklistItem = z.infer<typeof WorklistItem>;

export const WorklistResponse = z.object({
  generatedAt: Timestamp,
  recheckIntervalMin: z.number().positive(),
  items: z.array(WorklistItem),
});
export type WorklistResponse = z.infer<typeof WorklistResponse>;
