-- ponytail: this migration only exists to backfill drizzle-kit's snapshot chain
-- (drizzle/meta/0003-0006_snapshot.json were never generated — 0003/0004/0005/0007_unprotect
-- were hand-written SQL). Every statement below was already applied by those hand-written
-- migrations in any real environment; guards make this a safe no-op there, and a real
-- migration on a hypothetical fresh DB that skipped those hand-written files.
CREATE TABLE IF NOT EXISTS "backup_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"status" text NOT NULL,
	"targets" text DEFAULT '[]' NOT NULL,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "member_role_assignments" ALTER COLUMN "member_role_id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "member_roles" ALTER COLUMN "id" SET DATA TYPE uuid;--> statement-breakpoint
ALTER TABLE "member_roles" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "member_roles" ADD COLUMN IF NOT EXISTS "is_protected" boolean DEFAULT false NOT NULL;