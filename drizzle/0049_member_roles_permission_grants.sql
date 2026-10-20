-- Grants the member-roles permissions to the protected default roles (matches APP_ROLES in src/db/seed.ts).
-- Joins on app_roles so a fresh DB (roles not seeded yet) is a no-op; the seed inserts them later.
-- Separate from 0048: a new enum value cannot be used in the transaction that adds it.
INSERT INTO "app_role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"::"permission"
FROM "app_roles" r
JOIN (VALUES
  ('9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f', 'member-roles:read'),
  ('9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f', 'member-roles:write'),
  ('9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f', 'member-roles:delete'),
  ('2f8e1d4c-6a7b-4c8d-9e0f-1a2b3c4d5e6f', 'member-roles:read'),
  ('2f8e1d4c-6a7b-4c8d-9e0f-1a2b3c4d5e6f', 'member-roles:write')
) AS p("role_id", "permission") ON r."id" = p."role_id"::uuid
ON CONFLICT DO NOTHING;
