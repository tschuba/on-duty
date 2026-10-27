ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'events:manage';--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('public', 'loggedIn', 'roles');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"location" text,
	"description" text,
	"visibility" "event_visibility" DEFAULT 'loggedIn' NOT NULL,
	CONSTRAINT "events_ends_at_check" CHECK ("events"."ends_at" >= "events"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "event_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"tag" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_visible_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"role_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_tags" ADD CONSTRAINT "event_tags_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_visible_roles" ADD CONSTRAINT "event_visible_roles_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_visible_roles" ADD CONSTRAINT "event_visible_roles_role_id_app_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."app_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_tags_event_tag_idx" ON "event_tags" USING btree ("event_id","tag");--> statement-breakpoint
CREATE UNIQUE INDEX "event_visible_roles_event_role_idx" ON "event_visible_roles" USING btree ("event_id","role_id");
