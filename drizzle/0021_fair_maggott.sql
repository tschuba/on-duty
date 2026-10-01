ALTER TYPE "public"."permission" ADD VALUE 'lending:read';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'lending:manage';--> statement-breakpoint
CREATE TABLE "lending_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"individual_tracking" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lending_loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lending_item_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"borrower_member_id" uuid,
	"borrower_name" text,
	"borrower_contact" text,
	"planned_from" date,
	"planned_to" date,
	"picked_up_at" date,
	"returned_at" date
);
--> statement-breakpoint
ALTER TABLE "lending_items" ADD CONSTRAINT "lending_items_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lending_loans" ADD CONSTRAINT "lending_loans_lending_item_id_lending_items_id_fk" FOREIGN KEY ("lending_item_id") REFERENCES "public"."lending_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lending_loans" ADD CONSTRAINT "lending_loans_borrower_member_id_members_id_fk" FOREIGN KEY ("borrower_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;