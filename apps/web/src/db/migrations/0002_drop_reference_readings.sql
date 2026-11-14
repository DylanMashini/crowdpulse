-- The chest strap is gone from the product: nothing writes or reads reference readings any
-- more. Any rows left from development are dropped with the table.
DROP TABLE "reference_readings" CASCADE;--> statement-breakpoint
DROP TYPE "public"."reference_source";