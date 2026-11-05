ALTER TYPE "public"."permission" ADD VALUE 'inventory:inspect' BEFORE 'lending:read';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'inventory:inspection:delete' BEFORE 'lending:read';--> statement-breakpoint
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