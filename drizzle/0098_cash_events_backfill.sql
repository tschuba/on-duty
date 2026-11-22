INSERT INTO "cash_events" ("event_id") SELECT DISTINCT "event_id" FROM "cash_entries" WHERE "event_id" IS NOT NULL;--> statement-breakpoint
UPDATE "cash_entries" SET "cash_event_id" = ce."id" FROM "cash_events" ce WHERE ce."event_id" = "cash_entries"."event_id";
