CREATE TYPE "public"."mail_headers_mode" AS ENUM('fixed', 'extendable');--> statement-breakpoint
CREATE TYPE "public"."mail_template_variant" AS ENUM('system', 'override', 'custom');--> statement-breakpoint
CREATE TABLE "mail_templates" (
	"key" text NOT NULL,
	"locale" text NOT NULL,
	"variant" "mail_template_variant" NOT NULL,
	"category" text,
	"audience" text,
	"edit_permissions" "permission"[],
	"topic" text,
	"prefix" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"headers_mode" "mail_headers_mode",
	"extra_headers" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "mail_templates_key_locale_variant_pk" PRIMARY KEY("key","locale","variant"),
	CONSTRAINT "mail_templates_override_shape_check" CHECK (("mail_templates"."variant" = 'override' AND "mail_templates"."category" IS NULL AND "mail_templates"."audience" IS NULL AND "mail_templates"."edit_permissions" IS NULL AND "mail_templates"."topic" IS NULL AND "mail_templates"."prefix" IS NULL AND "mail_templates"."headers_mode" IS NULL AND "mail_templates"."extra_headers" IS NULL)
        OR ("mail_templates"."variant" <> 'override' AND "mail_templates"."category" IS NOT NULL AND "mail_templates"."audience" IS NOT NULL AND "mail_templates"."headers_mode" IS NOT NULL AND cardinality("mail_templates"."edit_permissions") >= 1)),
	CONSTRAINT "mail_templates_custom_topic_check" CHECK ("mail_templates"."variant" <> 'custom' OR "mail_templates"."topic" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;