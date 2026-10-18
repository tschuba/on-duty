-- Everyone who could review applications could already view and edit them; keep that.
INSERT INTO "app_role_permissions" ("role_id", "permission")
SELECT "role_id", p."permission"::"permission"
FROM "app_role_permissions"
CROSS JOIN (VALUES ('applications:read'), ('applications:record')) AS p("permission")
WHERE "app_role_permissions"."permission" = 'applications:review'
ON CONFLICT DO NOTHING;
