CREATE TYPE "public"."inventory_field_type" AS ENUM('text', 'number', 'date', 'boolean', 'select');--> statement-breakpoint
-- Recreate statt ADD VALUE: drizzle migriert in einer Transaktion, ein per ADD VALUE ergänzter Wert
-- wäre vor dem Commit dieser Transaktion nicht nutzbar (siehe drizzle/0025 für das gleiche Problem).
ALTER TABLE "public"."app_role_permissions" ALTER COLUMN "permission" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."permission";--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('members:read', 'members:write', 'members:delete', 'members:bank-data:read', 'members:bank-data:write', 'system:admin', 'donations:read', 'donations:record', 'donations:delete', 'donations:issue-receipts', 'applications:read', 'applications:record', 'applications:review', 'applications:manage-forms', 'inventory:read', 'inventory:manage', 'inventory:configure', 'lending:read', 'lending:manage', 'org:read', 'org:write', 'org:tax-data:read', 'org:tax-data:write', 'import:run', 'member-roles:read', 'member-roles:write', 'member-roles:delete', 'member-role-types:read', 'member-role-types:write', 'member-role-types:delete', 'anniversary-years:read', 'anniversary-years:write', 'anniversary-years:delete', 'events:manage');--> statement-breakpoint
ALTER TABLE "public"."app_role_permissions" ALTER COLUMN "permission" SET DATA TYPE "public"."permission" USING "permission"::"public"."permission";--> statement-breakpoint
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