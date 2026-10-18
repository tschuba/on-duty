-- Brings the protected default roles in line with APP_ROLES in src/db/seed.ts.
-- Joins on app_roles so a fresh DB (roles not seeded yet) is a no-op; the seed inserts them later.
INSERT INTO "app_role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"::"permission"
FROM "app_roles" r
JOIN (VALUES
  ('9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f', 'donations:delete'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'donations:delete'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'members:read'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'members:write'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'members:delete'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'applications:manage-forms'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'inventory:manage'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'lending:manage'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'org:read'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'org:write'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'org:tax-data:read'),
  ('4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d', 'org:tax-data:write'),
  ('7c3d5e6f-8a9b-4c1d-8e2f-3a4b5c6d7e8f', 'lending:read'),
  ('7c3d5e6f-8a9b-4c1d-8e2f-3a4b5c6d7e8f', 'org:read'),
  ('c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f', 'members:read'),
  ('c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f', 'members:write'),
  ('c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f', 'members:delete'),
  ('c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f', 'org:read'),
  ('c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f', 'org:write')
) AS p("role_id", "permission") ON r."id" = p."role_id"::uuid
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM "app_role_permissions"
WHERE "role_id" = 'c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f' AND "permission" = 'lending:manage';
