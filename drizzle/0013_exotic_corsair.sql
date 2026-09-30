ALTER TABLE "public"."app_role_permissions" ALTER COLUMN "permission" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."permission";--> statement-breakpoint
CREATE TYPE "public"."permission" AS ENUM('members:read', 'members:write', 'system:admin', 'donations:record', 'donations:issue-receipts');--> statement-breakpoint
ALTER TABLE "public"."app_role_permissions" ALTER COLUMN "permission" SET DATA TYPE "public"."permission" USING "permission"::"public"."permission";