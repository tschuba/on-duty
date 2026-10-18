-- Everyone who may record donations could already see them; keep that.
INSERT INTO "app_role_permissions" ("role_id", "permission")
SELECT "role_id", 'donations:read'::"permission" FROM "app_role_permissions" WHERE "permission" = 'donations:record'
ON CONFLICT DO NOTHING;

--> statement-breakpoint
-- Bearbeiter (default role): donations + form management. Joined on app_roles so a fresh DB is a no-op.
INSERT INTO "app_role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"::"permission"
FROM "app_roles" r
JOIN (VALUES
  ('2f8e1d4c-6a7b-4c8d-9e0f-1a2b3c4d5e6f', 'donations:read'),
  ('2f8e1d4c-6a7b-4c8d-9e0f-1a2b3c4d5e6f', 'donations:record'),
  ('2f8e1d4c-6a7b-4c8d-9e0f-1a2b3c4d5e6f', 'applications:manage-forms')
) AS p("role_id", "permission") ON r."id" = p."role_id"::uuid
ON CONFLICT DO NOTHING;
