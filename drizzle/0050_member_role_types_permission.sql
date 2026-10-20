ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'member-role-types:read';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'member-role-types:write';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'member-role-types:delete';
