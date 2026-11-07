-- Role events become "selected members": invitees are members whose login holds one of the former roles.
-- Orphaned role events end up with an empty list (visible to events:manage only).
INSERT INTO "event_invitees" ("event_id", "member_id")
SELECT DISTINCT evr."event_id", m."id"
FROM "event_visible_roles" evr
JOIN "events" e ON e."id" = evr."event_id" AND e."visibility" = 'roles'
JOIN "user_app_roles" uar ON uar."role_id" = evr."role_id"
JOIN "persons" p ON p."user_id" = uar."user_id"
JOIN "members" m ON m."person_id" = p."id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "events" SET "visibility" = 'members' WHERE "visibility" = 'roles';
