ALTER TYPE "public"."permission" ADD VALUE 'training:read';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'training:write';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'training:delete';--> statement-breakpoint
CREATE TABLE "training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"title" text NOT NULL,
	"completed_at" date,
	"expires_at" date,
	"organizer" text,
	"notes" text,
	CONSTRAINT "training_records_dates_present" CHECK ("training_records"."completed_at" IS NOT NULL OR "training_records"."expires_at" IS NOT NULL),
	CONSTRAINT "training_records_dates_order" CHECK ("training_records"."expires_at" IS NULL OR "training_records"."completed_at" IS NULL OR "training_records"."expires_at" >= "training_records"."completed_at")
);
--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_records_member_id_idx" ON "training_records" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "training_records_expires_at_idx" ON "training_records" USING btree ("expires_at");