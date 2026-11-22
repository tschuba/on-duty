CREATE TABLE "cash_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid,
	"name" text,
	"from_date" date,
	"to_date" date,
	CONSTRAINT "cash_events_name_check" CHECK ("cash_events"."event_id" IS NOT NULL OR "cash_events"."name" IS NOT NULL),
	CONSTRAINT "cash_events_range_check" CHECK ("cash_events"."from_date" <= "cash_events"."to_date")
);
--> statement-breakpoint
ALTER TABLE "cash_entries" ADD COLUMN "cash_event_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_events" ADD CONSTRAINT "cash_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_events_event_idx" ON "cash_events" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_cash_event_id_cash_events_id_fk" FOREIGN KEY ("cash_event_id") REFERENCES "public"."cash_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_entries_cash_event_idx" ON "cash_entries" USING btree ("cash_event_id");