INSERT INTO "app_role_permissions" ("role_id", "permission")
SELECT "role_id", ('training:' || split_part("permission"::text, ':', 2))::"permission" FROM "app_role_permissions"
WHERE "permission" IN ('members:read', 'members:write', 'members:delete') AND "role_id" <> '9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f'
ON CONFLICT DO NOTHING;
