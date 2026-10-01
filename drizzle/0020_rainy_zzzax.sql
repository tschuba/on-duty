CREATE TABLE "inventory_item_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_assigned_member_id_members_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "retired_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_item_assignments" ADD CONSTRAINT "inventory_item_assignments_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_assignments" ADD CONSTRAINT "inventory_item_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Carry over existing single-member assignments (PSA) into the new table before
-- the column disappears; quantity 1, matching a quantity-1 inventory item.
INSERT INTO "inventory_item_assignments" ("inventory_item_id", "member_id", "quantity")
SELECT "id", "assigned_member_id", 1 FROM "inventory_items" WHERE "assigned_member_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "assigned_member_id";