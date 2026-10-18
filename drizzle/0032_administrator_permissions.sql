-- Administrator (default role) keeps only system:admin and applications:manage-forms.
DELETE FROM "app_role_permissions"
WHERE "role_id" = '9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f'
  AND "permission" NOT IN ('system:admin', 'applications:manage-forms');
--> statement-breakpoint
INSERT INTO "app_role_permissions" ("role_id", "permission")
SELECT "id", 'applications:manage-forms'::"permission" FROM "app_roles" WHERE "id" = '9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "app_roles" SET "description" = 'Benutzerverwaltung, Systemkonfiguration und Antragsformulare'
WHERE "id" = '9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f';
