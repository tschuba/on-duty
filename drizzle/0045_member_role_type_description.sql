ALTER TABLE "member_role_types" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
-- Descriptions of the standard types (only where none was entered yet).
UPDATE member_role_types SET description = 'Dienstgrade der Feuerwehr, aufsteigend vom Anwärter bis zum Hauptbrandmeister.' WHERE id = '5f75964a-8f5e-4d0f-8a6b-0255e823119f' AND description IS NULL;--> statement-breakpoint
UPDATE member_role_types SET description = 'Gewählte oder übertragene Aufgaben im Dienst, z. B. Kommandant, Gruppenführer oder Jugendwart.' WHERE id = '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5' AND description IS NULL;--> statement-breakpoint
UPDATE member_role_types SET description = 'Ämter und Ehrungen im Verein, z. B. Vorstand, Kassier oder Ehrenmitglied.' WHERE id = '91321c9b-5872-4ca6-a0fa-55010d95bc48' AND description IS NULL;--> statement-breakpoint
UPDATE member_role_types SET description = 'Alle übrigen Funktionen, die zu keinem anderen Typ passen.' WHERE id = 'e4333d64-2527-4f99-b5cc-547422f87d12' AND description IS NULL;
