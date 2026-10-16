ALTER TABLE "lending_loans" ADD COLUMN "borrower_person_id" uuid;--> statement-breakpoint
-- Mitglieder: Person ist bereits vorhanden.
UPDATE "lending_loans" l SET "borrower_person_id" = m."person_id" FROM "members" m WHERE l."borrower_member_id" = m."id";--> statement-breakpoint
-- Externe: je Vorgang eine neue Person. Name am letzten Leerzeichen getrennt,
-- ein Einzelwort (auch Verein/Firma) wird zum Nachnamen. Kontakt nur bei E-Mail/Telefon.
CREATE TEMP TABLE "_ext_borrowers" AS
SELECT l."id" AS loan_id, gen_random_uuid() AS person_id,
  trim(coalesce(l."borrower_name", '')) AS full_name,
  trim(coalesce(l."borrower_contact", '')) AS contact
FROM "lending_loans" l WHERE l."borrower_person_id" IS NULL;--> statement-breakpoint
INSERT INTO "persons" ("id", "first_name", "last_name", "email", "phone")
SELECT person_id,
  CASE WHEN position(' ' in full_name) > 0 THEN regexp_replace(full_name, '\s+\S+$', '') ELSE '' END,
  CASE WHEN position(' ' in full_name) > 0 THEN substring(full_name from '\S+$') ELSE nullif(full_name, '') END,
  CASE WHEN contact ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN contact END,
  CASE WHEN contact ~ '^\+?[0-9\s/()-]{5,}$' THEN contact END
FROM "_ext_borrowers";--> statement-breakpoint
UPDATE "lending_loans" l SET "borrower_person_id" = e.person_id FROM "_ext_borrowers" e WHERE l."id" = e.loan_id;--> statement-breakpoint
ALTER TABLE "lending_loans" ALTER COLUMN "borrower_person_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lending_loans" ADD CONSTRAINT "lending_loans_borrower_person_id_persons_id_fk" FOREIGN KEY ("borrower_person_id") REFERENCES "public"."persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lending_loans" DROP CONSTRAINT "lending_loans_borrower_member_id_members_id_fk";--> statement-breakpoint
ALTER TABLE "lending_loans" DROP COLUMN "borrower_member_id";--> statement-breakpoint
ALTER TABLE "lending_loans" DROP COLUMN "borrower_name";--> statement-breakpoint
ALTER TABLE "lending_loans" DROP COLUMN "borrower_contact";
