ALTER TABLE "cash_entries" DROP CONSTRAINT "cash_entries_event_id_events_id_fk";
--> statement-breakpoint
DROP INDEX "cash_entries_event_idx";--> statement-breakpoint
ALTER TABLE "cash_entries" DROP COLUMN "event_id";