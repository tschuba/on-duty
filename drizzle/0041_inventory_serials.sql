CREATE TABLE "inventory_item_serials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"serial" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_item_serials" ADD CONSTRAINT "inventory_item_serials_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_item_serials_item_serial_idx" ON "inventory_item_serials" USING btree ("inventory_item_id","serial");--> statement-breakpoint
INSERT INTO "inventory_item_serials" ("inventory_item_id", "serial")
SELECT "id", btrim("serial_number") FROM "inventory_items" WHERE btrim(coalesce("serial_number", '')) <> '';--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "serial_number";