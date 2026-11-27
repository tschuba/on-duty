CREATE TABLE "donation_receipt_files" (
	"donation_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by" text,
	CONSTRAINT "donation_receipt_files_content_type_check" CHECK ("donation_receipt_files"."content_type" IN ('application/pdf','image/jpeg','image/png'))
);
--> statement-breakpoint
ALTER TABLE "donation_receipt_files" ADD CONSTRAINT "donation_receipt_files_donation_id_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."donations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_receipt_files" ADD CONSTRAINT "donation_receipt_files_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;