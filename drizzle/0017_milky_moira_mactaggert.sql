ALTER TYPE "public"."permission" ADD VALUE 'applications:manage-forms';--> statement-breakpoint
CREATE TABLE "application_forms" (
	"type" "application_type" PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"start_date" date,
	"end_date" date
);
--> statement-breakpoint
INSERT INTO "application_forms" ("type", "is_active") VALUES ('membership', false), ('youth', false);
