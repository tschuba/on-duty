DROP TABLE "event_visible_roles" CASCADE;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "visibility" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "visibility" SET DEFAULT 'loggedIn'::text;--> statement-breakpoint
DROP TYPE "public"."event_visibility";--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('public', 'loggedIn', 'members');--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "visibility" SET DEFAULT 'loggedIn'::"public"."event_visibility";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "visibility" SET DATA TYPE "public"."event_visibility" USING "visibility"::"public"."event_visibility";