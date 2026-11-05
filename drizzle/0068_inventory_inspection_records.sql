-- Recreate statt ADD VALUE: drizzle migriert in einer Transaktion, die neuen Werte müssen in 0069 schon nutzbar sein (siehe 0058).
ALTER TABLE "public"."app_role_permissions" ALTER COLUMN "permission" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."permission";--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('members:read', 'members:write', 'members:delete', 'members:bank-data:read', 'members:bank-data:write', 'system:admin', 'donations:read', 'donations:record', 'donations:delete', 'donations:issue-receipts', 'applications:read', 'applications:record', 'applications:review', 'applications:manage-forms', 'inventory:read', 'inventory:manage', 'inventory:configure', 'inventory:inspect', 'inventory:inspection:delete', 'lending:read', 'lending:manage', 'org:read', 'org:write', 'org:tax-data:read', 'org:tax-data:write', 'import:run', 'member-roles:read', 'member-roles:write', 'member-roles:delete', 'member-role-types:read', 'member-role-types:write', 'member-role-types:delete', 'anniversary-years:read', 'anniversary-years:write', 'anniversary-years:delete', 'events:manage');--> statement-breakpoint--> statement-breakpoint
ALTER TABLE "public"."app_role_permissions" ALTER COLUMN "permission" SET DATA TYPE "public"."permission" USING "permission"::"public"."permission";--> statement-breakpoint
CREATE TABLE "inventory_inspection_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"inspected_at" date NOT NULL,
	"result" text,
	"inspector_person_id" uuid,
	"note" text,
	"recorded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_inspection_records" ADD CONSTRAINT "inventory_inspection_records_inspection_id_inventory_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inventory_inspections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_inspection_records" ADD CONSTRAINT "inventory_inspection_records_inspector_person_id_persons_id_fk" FOREIGN KEY ("inspector_person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_inspection_records" ADD CONSTRAINT "inventory_inspection_records_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;