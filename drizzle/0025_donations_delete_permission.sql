-- Recreate instead of ADD VALUE: drizzle migrates in one transaction, and a value added to an
-- existing enum cannot be used (by the backfill migrations below) before that transaction commits.
ALTER TABLE "public"."app_role_permissions" ALTER COLUMN "permission" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."permission";--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('members:read', 'members:write', 'members:delete', 'system:admin', 'donations:read', 'donations:record', 'donations:delete', 'donations:issue-receipts', 'applications:read', 'applications:record', 'applications:review', 'applications:manage-forms', 'inventory:read', 'inventory:manage', 'lending:read', 'lending:manage', 'org:read', 'org:write', 'org:tax-data:read', 'org:tax-data:write');--> statement-breakpoint
ALTER TABLE "public"."app_role_permissions" ALTER COLUMN "permission" SET DATA TYPE "public"."permission" USING "permission"::"public"."permission";
