ALTER TYPE "public"."permission" ADD VALUE 'org:read';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'org:write';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'org:tax-data:read';--> statement-breakpoint
ALTER TYPE "public"."permission" ADD VALUE 'org:tax-data:write';
--> statement-breakpoint
DELETE FROM "org_config" WHERE "key" IN ('iban', 'bic');
