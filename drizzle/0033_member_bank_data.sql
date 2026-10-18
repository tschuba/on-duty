-- Rebuild the enum instead of ALTER TYPE ... ADD VALUE: drizzle runs all pending migrations in one
-- transaction, and Postgres refuses to use a freshly added enum value (migration 0034) before commit.
-- A type created inside the transaction can be used right away.
ALTER TYPE "public"."permission" RENAME TO "permission_old";--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('members:read', 'members:write', 'members:delete', 'members:bank-data:read', 'members:bank-data:write', 'system:admin', 'donations:read', 'donations:record', 'donations:delete', 'donations:issue-receipts', 'applications:read', 'applications:record', 'applications:review', 'applications:manage-forms', 'inventory:read', 'inventory:manage', 'lending:read', 'lending:manage', 'org:read', 'org:write', 'org:tax-data:read', 'org:tax-data:write');--> statement-breakpoint
ALTER TABLE "app_role_permissions" ALTER COLUMN "permission" SET DATA TYPE "public"."permission" USING "permission"::text::"public"."permission";--> statement-breakpoint
DROP TYPE "public"."permission_old";--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "bic" text;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "account_holder" text;
