ALTER TABLE "lending_items" ADD COLUMN "public_requestable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lending_items" ADD COLUMN "max_request_quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lending_items" ADD COLUMN "times_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lending_loans" ADD COLUMN "planned_from_time" time;--> statement-breakpoint
ALTER TABLE "lending_loans" ADD COLUMN "planned_to_time" time;--> statement-breakpoint
CREATE TYPE "public"."loan_request_status" AS ENUM('open', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "loan_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lending_item_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"planned_from" date NOT NULL,
	"planned_to" date NOT NULL,
	"planned_from_time" time,
	"planned_to_time" time,
	"message" text NOT NULL,
	"status" "loan_request_status" DEFAULT 'open' NOT NULL,
	"status_token" text NOT NULL,
	"loan_id" uuid,
	"notified_at" timestamp,
	"rejected_reason" text,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by" text,
	CONSTRAINT "loan_requests_status_token_unique" UNIQUE("status_token")
);--> statement-breakpoint
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_lending_item_id_lending_items_id_fk" FOREIGN KEY ("lending_item_id") REFERENCES "public"."lending_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_loan_id_lending_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."lending_loans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_requests" ADD CONSTRAINT "loan_requests_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "org_config" SET "key" = 'notificationEmail' WHERE "key" = 'applicationNotifyEmail';
