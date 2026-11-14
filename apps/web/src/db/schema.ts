import type { FlagDetail } from "@triagecam/contracts";
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Numbers only. No table stores video, images or names; patients exist only as ticket numbers.

const id = () => uuid().primaryKey().defaultRandom();
const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => instant("created_at").notNull().defaultNow();

export const sessionKind = pgEnum("session_kind", ["web", "mobile"]);
export const deviceRole = pgEnum("device_role", ["camera", "nurse"]);
export const ticketStatus = pgEnum("ticket_status", ["waiting", "discharged"]);
export const sittingKind = pgEnum("sitting_kind", ["check_in", "recheck"]);
export const captureSource = pgEnum("capture_source", ["camera", "simulated", "stub", "recording"]);
export const estimateState = pgEnum("estimate_state", ["settling", "valid", "none", "stale"]);
export const referenceSource = pgEnum("reference_source", ["chest_strap", "oximeter", "manual"]);
export const flagRule = pgEnum("flag_rule", ["score_rise", "baseline_shift", "overdue"]);

/** Staff accounts: operators and nurses. */
export const users = pgTable("users", {
  id: id(),
  /** Lower-cased before it is stored. */
  email: text().notNull().unique(),
  /** bcrypt hash. */
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: instant("email_verified_at"),
  createdAt: createdAt(),
});

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the token, hex. The token itself is only ever in the email. */
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("email_verification_tokens_user_idx").on(table.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    /** SHA-256 of the session token, hex. */
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: sessionKind().notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const devices = pgTable(
  "devices",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: deviceRole().notNull(),
    label: text().notNull(),
    expoPushToken: text("expo_push_token"),
    lastSeenAt: instant("last_seen_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [index("devices_user_idx").on(table.userId), index("devices_role_idx").on(table.role)],
);

export const tickets = pgTable("tickets", {
  id: id(),
  /** The public ticket number: sequential, the only identifier shown anywhere. */
  number: integer().notNull().unique().generatedAlwaysAsIdentity(),
  status: ticketStatus().notNull().default("waiting"),
  createdAt: createdAt(),
  dischargedAt: instant("discharged_at"),
  faceOptIn: boolean("face_opt_in").notNull().default(false),
});

export const sittings = pgTable(
  "sittings",
  {
    id: id(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id),
    kind: sittingKind().notNull(),
    source: captureSource().notNull(),
    /** Server clock. */
    startedAt: instant("started_at").notNull().defaultNow(),
    /** Server clock. Null while the sitting runs. */
    endedAt: instant("ended_at"),
    /** Server clock minus phone clock at the start, in ms. */
    clockOffsetMs: integer("clock_offset_ms").notNull().default(0),

    // Summary, written when the sitting is finished. A null value is "No reading".
    durationSeconds: real("duration_seconds"),
    /** bpm. */
    heartRate: real("heart_rate"),
    heartRateCoverage: real("heart_rate_coverage"),
    /** Breaths per minute. */
    breathingRate: real("breathing_rate"),
    breathingRateCoverage: real("breathing_rate_coverage"),
    /** ms. */
    rmssd: real(),
    rmssdCoverage: real("rmssd_coverage"),
    /** ms. */
    sdnn: real(),
    sdnnCoverage: real("sdnn_coverage"),
    timeToFirstReadingSeconds: real("time_to_first_reading_seconds"),
    longestDropoutSeconds: real("longest_dropout_seconds"),
    frameCount: integer("frame_count"),
    droppedFrames: integer("dropped_frames"),
  },
  (table) => [index("sittings_ticket_idx").on(table.ticketId, table.startedAt)],
);

/** One row per second of a sitting. Columns without a prefix describe the heart-rate estimate. */
export const readings = pgTable(
  "readings",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    sittingId: uuid("sitting_id")
      .notNull()
      .references(() => sittings.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    /** Server clock: the phone's timestamp plus the sitting's clock offset. */
    t: instant("t").notNull(),
    /** bpm. Set only when state is valid. */
    heartRate: real("heart_rate"),
    state: estimateState().notNull(),
    reason: text(),
    quality: real().notNull(),
    coverage: real().notNull(),
    ageMs: integer("age_ms"),
    /** Breaths per minute. Set only when breathing_state is valid. */
    breathingRate: real("breathing_rate"),
    breathingState: estimateState("breathing_state").notNull(),
    breathingReason: text("breathing_reason"),
    breathingQuality: real("breathing_quality").notNull(),
    breathingCoverage: real("breathing_coverage").notNull(),
    breathingAgeMs: integer("breathing_age_ms"),
  },
  (table) => [
    uniqueIndex("readings_sitting_t_idx").on(table.sittingId, table.t),
    index("readings_ticket_t_idx").on(table.ticketId, table.t),
  ],
);

/** Accepted beat-to-beat intervals of one sitting, as two parallel arrays. */
export const beatIntervals = pgTable("beat_intervals", {
  sittingId: uuid("sitting_id")
    .primaryKey()
    .references(() => sittings.id, { onDelete: "cascade" }),
  /** Interval lengths in ms. */
  intervalsMs: real("intervals_ms").array().notNull(),
  /** For each interval, ms from the first frame of the sitting to the beat that ends it. */
  beatTimesMs: real("beat_times_ms").array().notNull(),
});

export const referenceReadings = pgTable(
  "reference_readings",
  {
    id: bigserial({ mode: "number" }).primaryKey(),
    sittingId: uuid("sitting_id")
      .notNull()
      .references(() => sittings.id, { onDelete: "cascade" }),
    /** Server clock. */
    t: instant("t").notNull(),
    /** bpm. */
    heartRate: real("heart_rate"),
    /** Beat intervals in ms reported with this sample. */
    rrIntervalsMs: real("rr_intervals_ms").array().notNull().default(sql`'{}'::real[]`),
    /** Breaths per minute from a manual count. */
    breathingRate: real("breathing_rate"),
    source: referenceSource().notNull(),
  },
  (table) => [index("reference_readings_sitting_t_idx").on(table.sittingId, table.t)],
);

/** One row per flag episode. Open while closed_at is null. */
export const flags = pgTable(
  "flags",
  {
    id: id(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    rule: flagRule().notNull(),
    openedAt: instant("opened_at").notNull().defaultNow(),
    closedAt: instant("closed_at"),
    /** The FlagDetail numbers plus the handoff sentence, both frozen when the flag opened. */
    detail: jsonb().$type<FlagDetail & { handoff: string }>().notNull(),
    /** When the push for this episode was last sent; drives the cool-down. */
    lastNotifiedAt: instant("last_notified_at"),
  },
  (table) => [
    index("flags_ticket_idx").on(table.ticketId, table.openedAt),
    uniqueIndex("flags_one_open_per_rule_idx").on(table.ticketId, table.rule).where(sql`${table.closedAt} is null`),
  ],
);

export const acknowledgements = pgTable(
  "acknowledgements",
  {
    id: id(),
    flagId: uuid("flag_id")
      .notNull()
      .references(() => flags.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    at: instant("at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("acknowledgements_flag_user_idx").on(table.flagId, table.userId)],
);

/** Face embeddings for opted-in tickets. Deleted at discharge and when the opt-in is withdrawn. */
export const faceEmbeddings = pgTable(
  "face_embeddings",
  {
    id: id(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    /** L2-normalised embedding. */
    vector: real().array().notNull(),
    /** Name of the model that produced the vector; vectors from different models never compare. */
    model: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("face_embeddings_ticket_idx").on(table.ticketId)],
);

/** A single row (id 1) of flag thresholds and the re-check interval. Defaults match defaultSettings in @triagecam/contracts. */
export const settings = pgTable(
  "settings",
  {
    id: integer().primaryKey().default(1),
    recheckIntervalMin: real("recheck_interval_min").notNull().default(30),
    pulseDeltaBpm: real("pulse_delta_bpm").notNull().default(20),
    breathingDeltaPerMin: real("breathing_delta_per_min").notNull().default(6),
    scoreRiseEnabled: boolean("score_rise_enabled").notNull().default(true),
    baselineShiftEnabled: boolean("baseline_shift_enabled").notNull().default(true),
    overdueEnabled: boolean("overdue_enabled").notNull().default(true),
    notifyCooldownMin: real("notify_cooldown_min").notNull().default(10),
    faceMatchMinConfidence: real("face_match_min_confidence").notNull().default(0.8),
    updatedAt: instant("updated_at").notNull().defaultNow(),
  },
  (table) => [check("settings_single_row", sql`${table.id} = 1`)],
);
