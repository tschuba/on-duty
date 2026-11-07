-- Recreate the enum instead of ADD VALUE: the migrator runs all pending files in one transaction,
-- where a freshly added enum value must not be used (the backfill in 0077 does).
ALTER TABLE "events" ALTER COLUMN "visibility" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "visibility" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."event_visibility";--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('public', 'loggedIn', 'roles', 'members');--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "visibility" SET DATA TYPE "public"."event_visibility" USING "visibility"::"public"."event_visibility";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "visibility" SET DEFAULT 'loggedIn';
