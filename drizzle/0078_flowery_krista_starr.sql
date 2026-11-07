CREATE TYPE "public"."event_rsvp_status" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "event_rsvp_status" NOT NULL,
	"responded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "rsvp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "max_participants" integer;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "rsvp_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_rsvps_event_member_idx" ON "event_rsvps" USING btree ("event_id","member_id");--> statement-breakpoint
CREATE INDEX "event_rsvps_member_idx" ON "event_rsvps" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_max_participants_check" CHECK ("events"."max_participants" > 0);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_rsvp_deadline_check" CHECK ("events"."rsvp_deadline" <= "events"."starts_at");