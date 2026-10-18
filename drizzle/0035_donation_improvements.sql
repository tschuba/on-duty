CREATE TYPE "public"."receipt_status" AS ENUM('open', 'issued', 'not_required');--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "receipt_status" "receipt_status" DEFAULT 'open' NOT NULL;
--> statement-breakpoint
UPDATE "donations" SET "receipt_status" = 'issued' WHERE "receipt_issued_at" IS NOT NULL;
