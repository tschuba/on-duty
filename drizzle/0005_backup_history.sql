CREATE TABLE IF NOT EXISTS "backup_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"status" text NOT NULL,
	"targets" text DEFAULT '[]' NOT NULL,
	"error_message" text
);
