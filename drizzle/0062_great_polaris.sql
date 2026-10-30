CREATE TABLE "inventory_template_field_defs" (
	"template_id" uuid NOT NULL,
	"field_def_id" uuid NOT NULL,
	CONSTRAINT "inventory_template_field_defs_template_id_field_def_id_pk" PRIMARY KEY("template_id","field_def_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_template_inspections" (
	"template_id" uuid NOT NULL,
	"inspection_template_id" uuid NOT NULL,
	CONSTRAINT "inventory_template_inspections_template_id_inspection_template_id_pk" PRIMARY KEY("template_id","inspection_template_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"enabled_fields" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_template_field_defs" ADD CONSTRAINT "inventory_template_field_defs_template_id_inventory_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inventory_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_template_field_defs" ADD CONSTRAINT "inventory_template_field_defs_field_def_id_inventory_field_defs_id_fk" FOREIGN KEY ("field_def_id") REFERENCES "public"."inventory_field_defs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_template_inspections" ADD CONSTRAINT "inventory_template_inspections_template_id_inventory_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."inventory_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_template_inspections" ADD CONSTRAINT "inventory_template_inspections_inspection_template_id_inventory_inspection_templates_id_fk" FOREIGN KEY ("inspection_template_id") REFERENCES "public"."inventory_inspection_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_templates_name_idx" ON "inventory_templates" USING btree (lower("name"));