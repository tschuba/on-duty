ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'anniversary-years:read';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'anniversary-years:write';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE IF NOT EXISTS 'anniversary-years:delete';
