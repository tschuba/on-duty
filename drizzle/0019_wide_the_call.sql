CREATE TYPE "public"."inventory_category" AS ENUM('vehicle', 'scba', 'equipment', 'ppe', 'other');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'inventory:read';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'inventory:manage';--> statement-breakpoint
CREATE TABLE "inventory_item_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"tag" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" "inventory_category" NOT NULL,
	"purchase_date" date,
	"purchase_price" numeric(10, 2),
	"notes" text,
	"retired_at" date,
	"retired_reason" text,
	"assigned_member_id" uuid,
	"license_plate" text,
	"year_of_manufacture" integer,
	"vehicle_inspection_due" date,
	"serial_number" text,
	"next_inspection_due" date,
	"last_inspection_date" date
);
--> statement-breakpoint
ALTER TABLE "inventory_item_tags" ADD CONSTRAINT "inventory_item_tags_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_assigned_member_id_members_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_item_tags_item_tag_idx" ON "inventory_item_tags" USING btree ("inventory_item_id","tag");