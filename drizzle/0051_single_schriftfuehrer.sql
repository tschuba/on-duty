-- Schriftführer exists only as club function: move assignments, drop the position, rename. Idempotent.
UPDATE member_role_assignments SET member_role_id = 'b76895ab-577d-4fcf-a567-300fa1bfba91'
WHERE member_role_id = 'aa7c8c81-344e-456b-872f-d2205afe3026'
  AND EXISTS (SELECT 1 FROM member_roles WHERE id = 'b76895ab-577d-4fcf-a567-300fa1bfba91');--> statement-breakpoint
DELETE FROM member_roles WHERE id = 'aa7c8c81-344e-456b-872f-d2205afe3026'
  AND NOT EXISTS (SELECT 1 FROM member_role_assignments WHERE member_role_id = 'aa7c8c81-344e-456b-872f-d2205afe3026');--> statement-breakpoint
UPDATE member_roles SET title = 'Schriftführer/-in' WHERE id = 'b76895ab-577d-4fcf-a567-300fa1bfba91' AND title = 'Schriftführer';
--> statement-breakpoint
UPDATE member_roles m SET sort_order = r.n FROM (
  SELECT id, row_number() OVER (ORDER BY sort_order, title) AS n FROM member_roles WHERE type_id = '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'
) r WHERE m.id = r.id AND m.sort_order <> r.n;
