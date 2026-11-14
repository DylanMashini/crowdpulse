CREATE TYPE "public"."capture_source" AS ENUM('camera', 'simulated', 'stub', 'recording');--> statement-breakpoint
CREATE TYPE "public"."device_role" AS ENUM('camera', 'nurse');--> statement-breakpoint
CREATE TYPE "public"."estimate_state" AS ENUM('settling', 'valid', 'none', 'stale');--> statement-breakpoint
CREATE TYPE "public"."flag_rule" AS ENUM('score_rise', 'baseline_shift', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."reference_source" AS ENUM('chest_strap', 'oximeter', 'manual');--> statement-breakpoint
CREATE TYPE "public"."session_kind" AS ENUM('web', 'mobile');--> statement-breakpoint
CREATE TYPE "public"."sitting_kind" AS ENUM('check_in', 'recheck');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('waiting', 'discharged');--> statement-breakpoint
CREATE TABLE "acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flag_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beat_intervals" (
	"sitting_id" uuid PRIMARY KEY NOT NULL,
	"intervals_ms" real[] NOT NULL,
	"beat_times_ms" real[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "device_role" NOT NULL,
	"label" text NOT NULL,
	"expo_push_token" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "face_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"vector" real[] NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"rule" "flag_rule" NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"detail" jsonb NOT NULL,
	"last_notified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sitting_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"t" timestamp with time zone NOT NULL,
	"heart_rate" real,
	"state" "estimate_state" NOT NULL,
	"reason" text,
	"quality" real NOT NULL,
	"coverage" real NOT NULL,
	"age_ms" integer,
	"breathing_rate" real,
	"breathing_state" "estimate_state" NOT NULL,
	"breathing_reason" text,
	"breathing_quality" real NOT NULL,
	"breathing_coverage" real NOT NULL,
	"breathing_age_ms" integer
);
--> statement-breakpoint
CREATE TABLE "reference_readings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sitting_id" uuid NOT NULL,
	"t" timestamp with time zone NOT NULL,
	"heart_rate" real,
	"rr_intervals_ms" real[] DEFAULT '{}'::real[] NOT NULL,
	"breathing_rate" real,
	"source" "reference_source" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "session_kind" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"recheck_interval_min" real DEFAULT 30 NOT NULL,
	"pulse_delta_bpm" real DEFAULT 20 NOT NULL,
	"breathing_delta_per_min" real DEFAULT 6 NOT NULL,
	"score_rise_enabled" boolean DEFAULT true NOT NULL,
	"baseline_shift_enabled" boolean DEFAULT true NOT NULL,
	"overdue_enabled" boolean DEFAULT true NOT NULL,
	"notify_cooldown_min" real DEFAULT 10 NOT NULL,
	"face_match_min_confidence" real DEFAULT 0.8 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "sittings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"kind" "sitting_kind" NOT NULL,
	"source" "capture_source" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"clock_offset_ms" integer DEFAULT 0 NOT NULL,
	"duration_seconds" real,
	"heart_rate" real,
	"heart_rate_coverage" real,
	"breathing_rate" real,
	"breathing_rate_coverage" real,
	"rmssd" real,
	"rmssd_coverage" real,
	"sdnn" real,
	"sdnn_coverage" real,
	"time_to_first_reading_seconds" real,
	"longest_dropout_seconds" real,
	"frame_count" integer,
	"dropped_frames" integer
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "tickets_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"status" "ticket_status" DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"discharged_at" timestamp with time zone,
	"face_opt_in" boolean DEFAULT false NOT NULL,
	CONSTRAINT "tickets_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_flag_id_flags_id_fk" FOREIGN KEY ("flag_id") REFERENCES "public"."flags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acknowledgements" ADD CONSTRAINT "acknowledgements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beat_intervals" ADD CONSTRAINT "beat_intervals_sitting_id_sittings_id_fk" FOREIGN KEY ("sitting_id") REFERENCES "public"."sittings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "face_embeddings" ADD CONSTRAINT "face_embeddings_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flags" ADD CONSTRAINT "flags_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_sitting_id_sittings_id_fk" FOREIGN KEY ("sitting_id") REFERENCES "public"."sittings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_readings" ADD CONSTRAINT "reference_readings_sitting_id_sittings_id_fk" FOREIGN KEY ("sitting_id") REFERENCES "public"."sittings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sittings" ADD CONSTRAINT "sittings_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sittings" ADD CONSTRAINT "sittings_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "acknowledgements_flag_user_idx" ON "acknowledgements" USING btree ("flag_id","user_id");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "devices_role_idx" ON "devices" USING btree ("role");--> statement-breakpoint
CREATE INDEX "email_verification_tokens_user_idx" ON "email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "face_embeddings_ticket_idx" ON "face_embeddings" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "flags_ticket_idx" ON "flags" USING btree ("ticket_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "flags_one_open_per_rule_idx" ON "flags" USING btree ("ticket_id","rule") WHERE "flags"."closed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "readings_sitting_t_idx" ON "readings" USING btree ("sitting_id","t");--> statement-breakpoint
CREATE INDEX "readings_ticket_t_idx" ON "readings" USING btree ("ticket_id","t");--> statement-breakpoint
CREATE INDEX "reference_readings_sitting_t_idx" ON "reference_readings" USING btree ("sitting_id","t");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sittings_ticket_idx" ON "sittings" USING btree ("ticket_id","started_at");