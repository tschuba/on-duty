CREATE TYPE "public"."mail_log_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE "mail_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"template" text NOT NULL,
	"event_id" uuid,
	"status" "mail_log_status" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_preferences" (
	"person_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"opted_out" boolean NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "mail_preferences_person_id_topic_pk" PRIMARY KEY("person_id","topic")
);
--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_preferences" ADD CONSTRAINT "mail_preferences_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_log_template_person_idx" ON "mail_log" USING btree ("template","person_id");--> statement-breakpoint
CREATE INDEX "mail_log_event_idx" ON "mail_log" USING btree ("event_id");