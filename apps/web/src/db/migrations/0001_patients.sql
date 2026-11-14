-- Tickets become patients. Every rename keeps its rows, so a database with waiting tickets
-- carries on with the same numbers. drizzle-kit wrote the snapshot beside this file; the SQL
-- was corrected by hand, because drizzle-kit cannot tell these renames from drop-and-create.
ALTER TYPE "public"."ticket_status" RENAME TO "patient_status";--> statement-breakpoint
CREATE TYPE "public"."patient_sex" AS ENUM('female', 'male', 'other');--> statement-breakpoint
ALTER TABLE "tickets" RENAME TO "patients";--> statement-breakpoint
ALTER SEQUENCE "tickets_number_seq" RENAME TO "patients_number_seq";--> statement-breakpoint
ALTER TABLE "patients" RENAME CONSTRAINT "tickets_pkey" TO "patients_pkey";--> statement-breakpoint
ALTER TABLE "patients" RENAME CONSTRAINT "tickets_number_unique" TO "patients_number_unique";--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "sex" "patient_sex";--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "reason_for_visit" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "pain_score" smallint;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "allergies" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "intake_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "photo_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE "patient_photos" (
	"patient_id" uuid PRIMARY KEY NOT NULL,
	"jpeg" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "face_embeddings" RENAME COLUMN "ticket_id" TO "patient_id";--> statement-breakpoint
ALTER TABLE "flags" RENAME COLUMN "ticket_id" TO "patient_id";--> statement-breakpoint
ALTER TABLE "readings" RENAME COLUMN "ticket_id" TO "patient_id";--> statement-breakpoint
ALTER TABLE "sittings" RENAME COLUMN "ticket_id" TO "patient_id";--> statement-breakpoint
ALTER TABLE "face_embeddings" RENAME CONSTRAINT "face_embeddings_ticket_id_tickets_id_fk" TO "face_embeddings_patient_id_patients_id_fk";--> statement-breakpoint
ALTER TABLE "flags" RENAME CONSTRAINT "flags_ticket_id_tickets_id_fk" TO "flags_patient_id_patients_id_fk";--> statement-breakpoint
ALTER TABLE "readings" RENAME CONSTRAINT "readings_ticket_id_tickets_id_fk" TO "readings_patient_id_patients_id_fk";--> statement-breakpoint
ALTER TABLE "sittings" RENAME CONSTRAINT "sittings_ticket_id_tickets_id_fk" TO "sittings_patient_id_patients_id_fk";--> statement-breakpoint
ALTER TABLE "patient_photos" ADD CONSTRAINT "patient_photos_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER INDEX "face_embeddings_ticket_idx" RENAME TO "face_embeddings_patient_idx";--> statement-breakpoint
ALTER INDEX "flags_ticket_idx" RENAME TO "flags_patient_idx";--> statement-breakpoint
ALTER INDEX "readings_ticket_t_idx" RENAME TO "readings_patient_t_idx";--> statement-breakpoint
ALTER INDEX "sittings_ticket_idx" RENAME TO "sittings_patient_idx";
