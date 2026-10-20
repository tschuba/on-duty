-- Additional standard positions, sorted between the commanders and the youth roles. Idempotent.
UPDATE member_roles m SET sort_order = v.so
FROM (VALUES
  ('bda48bcc-d4f3-464f-9067-732d3f35675c'::uuid, 9),
  ('b2b821ce-30aa-4b14-a6aa-c63d09daf37c'::uuid, 10),
  ('6976ff4a-7141-4ac4-962b-9b2540b13096'::uuid, 11),
  ('3750d6fd-00a8-4423-bbc3-b1c8e7e5abcc'::uuid, 12)
) AS v(id, so)
WHERE m.id = v.id AND m.type_id = '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5' AND m.sort_order < v.so;--> statement-breakpoint
INSERT INTO member_roles (id, title, grants_active_status, is_protected, type_id, sort_order)
SELECT v.id, v.title, false, false, '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'::uuid, v.so FROM (VALUES
  ('fa924ea5-597a-479b-be5e-19fae309a0ad'::uuid, 'Gerätewart', 6),
  ('aa7c8c81-344e-456b-872f-d2205afe3026'::uuid, 'Schriftführer (Feuerwehr)', 7),
  ('a01ba0da-a36d-47ff-9a39-036696cce73d'::uuid, 'Ausbilder', 8)
) AS v(id, title, so)
WHERE NOT EXISTS (SELECT 1 FROM member_roles e WHERE e.id = v.id OR (e.type_id = '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5' AND e.title = v.title));
