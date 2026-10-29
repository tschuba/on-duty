CREATE TYPE "public"."inventory_field_type" AS ENUM('text', 'number', 'date', 'boolean', 'select');--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'inventory:configure' BEFORE 'lending:read';--> statement-breakpoint
CREATE TABLE "inventory_field_defs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "inventory_field_type" NOT NULL,
	"options" text[],
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"field_def_id" uuid NOT NULL,
	"value" text
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "enabled_fields" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "location_text" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "latitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "longitude" numeric(9, 6);--> statement-breakpoint
ALTER TABLE "inventory_field_values" ADD CONSTRAINT "inventory_field_values_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_field_values" ADD CONSTRAINT "inventory_field_values_field_def_id_inventory_field_defs_id_fk" FOREIGN KEY ("field_def_id") REFERENCES "public"."inventory_field_defs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_field_values_item_field_idx" ON "inventory_field_values" USING btree ("inventory_item_id","field_def_id");