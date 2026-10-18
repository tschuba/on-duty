-- Finanzen: standalone role for the treasurer (Kassier). Vorstand loses org:tax-data:write.
INSERT INTO "app_roles" ("id", "name", "description", "is_protected")
VALUES ('5d3e7f90-1b2c-4d5e-8f60-7a8b9c0d1e2f', 'Finanzen', 'Kann Bankdaten von Mitgliedern und Steuerdaten des Vereins pflegen', true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "app_role_permissions" ("role_id", "permission")
SELECT '5d3e7f90-1b2c-4d5e-8f60-7a8b9c0d1e2f', p."permission"::"permission"
FROM (VALUES ('members:read'), ('members:bank-data:read'), ('members:bank-data:write'), ('org:read'), ('org:tax-data:read'), ('org:tax-data:write')) AS p("permission")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM "app_role_permissions"
WHERE "role_id" = '4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d' AND "permission" = 'org:tax-data:write';
