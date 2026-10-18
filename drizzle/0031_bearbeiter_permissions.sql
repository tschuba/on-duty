-- Bearbeiter (default role): no longer reviews applications, may write org master data.
DELETE FROM "app_role_permissions"
WHERE "role_id" = '2f8e1d4c-6a7b-4c8d-9e0f-1a2b3c4d5e6f' AND "permission" = 'applications:review';
--> statement-breakpoint
INSERT INTO "app_role_permissions" ("role_id", "permission")
SELECT "id", 'org:write'::"permission" FROM "app_roles" WHERE "id" = '2f8e1d4c-6a7b-4c8d-9e0f-1a2b3c4d5e6f'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "app_roles" SET "description" = 'Kann Mitglieder, Spenden und Anträge bearbeiten sowie Stammdaten pflegen'
WHERE "id" = '2f8e1d4c-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
