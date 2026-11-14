ALTER TYPE "public"."permission" ADD VALUE 'mail:templates' BEFORE 'training:read';--> statement-breakpoint
ALTER TABLE "mail_templates" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "mail_templates" ADD CONSTRAINT "mail_templates_meta_check" CHECK (("mail_templates"."variant" = 'custom') = ("mail_templates"."meta" IS NOT NULL));