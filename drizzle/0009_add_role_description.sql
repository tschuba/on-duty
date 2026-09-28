ALTER TABLE "app_roles" ADD COLUMN "description" text;
UPDATE "app_roles" SET "description" = 'Kann Mitglieder einsehen' WHERE id = '7c3d5e6f-8a9b-4c1d-8e2f-3a4b5c6d7e8f';
UPDATE "app_roles" SET "description" = 'Kann Mitglieder anlegen und bearbeiten' WHERE id = '2f8e1d4c-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
UPDATE "app_roles" SET "description" = 'Vollzugriff inkl. Benutzerverwaltung und Systemkonfiguration' WHERE id = '9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f';