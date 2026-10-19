CREATE TABLE "inventory_item_numbers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"number" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" RENAME COLUMN "purchase_date" TO "commissioned_at";--> statement-breakpoint
ALTER TABLE "member_role_assignments" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "inventory_item_numbers" ADD CONSTRAINT "inventory_item_numbers_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_item_numbers_number_idx" ON "inventory_item_numbers" USING btree ("number");--> statement-breakpoint
CREATE INDEX "inventory_item_numbers_item_idx" ON "inventory_item_numbers" USING btree ("inventory_item_id");