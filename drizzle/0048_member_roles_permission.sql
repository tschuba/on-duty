ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'member-roles:read';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'member-roles:write';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'member-roles:delete';
