CREATE TYPE "public"."application_status" AS ENUM('open', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."application_type" AS ENUM('membership', 'youth');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'applications:review';--> statement-breakpoint
CREATE TABLE "application_guardians" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"consent_given" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"type" "application_type" NOT NULL,
	"status" "application_status" DEFAULT 'open' NOT NULL,
	"message" text,
	"rejected_reason" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by" text
);
--> statement-breakpoint
ALTER TABLE "application_guardians" ADD CONSTRAINT "application_guardians_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_guardians" ADD CONSTRAINT "application_guardians_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;