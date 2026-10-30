ALTER TABLE "inventory_items" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "license_plate";--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "year_of_manufacture";--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "vehicle_inspection_due";--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "next_inspection_due";--> statement-breakpoint
ALTER TABLE "inventory_items" DROP COLUMN "last_inspection_date";--> statement-breakpoint
DROP TYPE "public"."inventory_category";