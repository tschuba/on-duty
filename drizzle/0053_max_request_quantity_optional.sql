ALTER TABLE "lending_items" ALTER COLUMN "max_request_quantity" SET DEFAULT 0;--> statement-breakpoint
UPDATE "lending_items" SET "max_request_quantity" = 0 WHERE "max_request_quantity" = 1;
