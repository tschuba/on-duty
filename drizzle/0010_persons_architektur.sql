CREATE TABLE "persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"last_name" text NOT NULL,
	"first_name" text NOT NULL,
	"street" text,
	"house_number" text,
	"zip" text,
	"city" text,
	"gender" "gender",
	"birth_date" date NOT NULL,
	"phone" text,
	"email" text
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "person_id" uuid;
--> statement-breakpoint
ALTER TABLE "persons" ADD COLUMN "_migration_member_id" uuid;
--> statement-breakpoint
INSERT INTO "persons" ("last_name", "first_name", "street", "house_number", "zip", "city", "gender", "birth_date", "phone", "email", "_migration_member_id")
SELECT "last_name", "first_name", "street", "house_number", "zip", "city", "gender", "birth_date", "phone", "email", "id"
FROM "members";
--> statement-breakpoint
UPDATE "members" SET "person_id" = "persons"."id"
FROM "persons"
WHERE "persons"."_migration_member_id" = "members"."id";
--> statement-breakpoint
ALTER TABLE "persons" DROP COLUMN "_migration_member_id";
--> statement-breakpoint
ALTER TABLE "members" ALTER COLUMN "person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_person_id_persons_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."persons"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "last_name";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "first_name";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "street";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "house_number";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "zip";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "city";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "gender";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "birth_date";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "phone";--> statement-breakpoint
ALTER TABLE "members" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_person_id_unique" UNIQUE("person_id");
