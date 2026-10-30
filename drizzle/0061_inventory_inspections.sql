CREATE TABLE "inventory_inspection_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"default_interval_months" integer
);
--> statement-breakpoint
CREATE TABLE "inventory_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"interval_months" integer,
	"inspected_at" date,
	"due_date" date
);
--> statement-breakpoint
ALTER TABLE "inventory_inspections" ADD CONSTRAINT "inventory_inspections_inventory_item_id_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_inspection_templates_name_idx" ON "inventory_inspection_templates" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_inspections_item_name_idx" ON "inventory_inspections" USING btree ("inventory_item_id",lower("name"));--> statement-breakpoint
INSERT INTO "inventory_inspection_templates" ("name") VALUES ('HU'), ('UVV-Prüfung'), ('Druckprüfung'), ('Prüfung');
--> statement-breakpoint
-- Einmaliges Kopieren der alten Spalten (118 löscht sie); nur bei mindestens einem Datum, ohne Intervall.
INSERT INTO "inventory_inspections" ("inventory_item_id", "name", "due_date")
SELECT "id", 'HU', "vehicle_inspection_due" FROM "inventory_items" WHERE "vehicle_inspection_due" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "inventory_inspections" ("inventory_item_id", "name", "inspected_at", "due_date")
SELECT "id", CASE WHEN "category" = 'scba' THEN 'Druckprüfung' ELSE 'Prüfung' END, "last_inspection_date", "next_inspection_due"
FROM "inventory_items"
WHERE "category" <> 'vehicle' AND ("next_inspection_due" IS NOT NULL OR "last_inspection_date" IS NOT NULL);
--> statement-breakpoint
UPDATE "inventory_items" SET "enabled_fields" = array_append("enabled_fields", 'inspection')
WHERE NOT 'inspection' = ANY("enabled_fields") AND "id" IN (SELECT "inventory_item_id" FROM "inventory_inspections");
