ALTER TYPE "public"."permission" ADD VALUE 'members:bank-data:read' BEFORE 'system:admin';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'members:bank-data:write' BEFORE 'system:admin';--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "bic" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "account_holder" text;