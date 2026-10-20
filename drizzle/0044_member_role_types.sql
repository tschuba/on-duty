-- Role types (Spec 47). Roles are addressed by fixed ID because titles are editable. Idempotent.
CREATE TABLE IF NOT EXISTS "member_role_types" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "allows_active_status" boolean DEFAULT false NOT NULL,
  "sort_order" integer NOT NULL,
  "is_protected" boolean DEFAULT false NOT NULL
);--> statement-breakpoint
INSERT INTO member_role_types (id, name, allows_active_status, sort_order, is_protected) VALUES
  ('5f75964a-8f5e-4d0f-8a6b-0255e823119f', 'Dienstgrad', true, 1, false),
  ('48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5', 'Dienststellung', true, 2, false),
  ('91321c9b-5872-4ca6-a0fa-55010d95bc48', 'Verein', false, 3, false),
  ('e4333d64-2527-4f99-b5cc-547422f87d12', 'Sonstige', false, 4, true)
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
ALTER TABLE "member_roles" ADD COLUMN IF NOT EXISTS "type_id" uuid;--> statement-breakpoint
ALTER TABLE "member_roles" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Rename (by ID) and assign known roles
UPDATE member_roles SET title = 'Jugendwart' WHERE id = 'bda48bcc-d4f3-464f-9067-732d3f35675c' AND title = 'Jugendfeuerwehrwart';--> statement-breakpoint
UPDATE member_roles SET title = 'Stellv. Jugendwart' WHERE id = 'b2b821ce-30aa-4b14-a6aa-c63d09daf37c' AND title = 'Stellv. Jugendfeuerwehrwart';--> statement-breakpoint
UPDATE member_roles m SET type_id = v.type_id, sort_order = v.sort_order
FROM (VALUES
  ('f2dd276b-027b-4b82-8313-918bc4f9d5c5'::uuid, '5f75964a-8f5e-4d0f-8a6b-0255e823119f'::uuid, 1),
  ('bc7a50c6-a0c9-4d1a-a212-6d39ba833fed'::uuid, '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'::uuid, 1),
  ('77700bd9-6c64-43d6-af49-02d3c8e7d665'::uuid, '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'::uuid, 2),
  ('9540a309-6b49-48f8-b39b-2349018a6119'::uuid, '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'::uuid, 3),
  ('bda48bcc-d4f3-464f-9067-732d3f35675c'::uuid, '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'::uuid, 6),
  ('b2b821ce-30aa-4b14-a6aa-c63d09daf37c'::uuid, '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'::uuid, 7),
  ('8bf6c0be-faa1-4149-b116-ef6bebf7cece'::uuid, '91321c9b-5872-4ca6-a0fa-55010d95bc48'::uuid, 3),
  ('b76895ab-577d-4fcf-a567-300fa1bfba91'::uuid, '91321c9b-5872-4ca6-a0fa-55010d95bc48'::uuid, 4),
  ('5054f7c6-61fa-4692-93a6-2256f16de546'::uuid, '91321c9b-5872-4ca6-a0fa-55010d95bc48'::uuid, 5),
  ('e10a3bb7-ed77-46a9-a7fe-f1d1f8326ed3'::uuid, '91321c9b-5872-4ca6-a0fa-55010d95bc48'::uuid, 6),
  ('8a6372ef-4561-4f0d-aa2e-3ed80ac2b003'::uuid, '91321c9b-5872-4ca6-a0fa-55010d95bc48'::uuid, 7),
  ('4005b6b5-bbf3-4d52-98c1-3893bf7db574'::uuid, '91321c9b-5872-4ca6-a0fa-55010d95bc48'::uuid, 8),
  ('d4bda8ff-6d64-404e-a6c2-d7b500abb6a2'::uuid, '91321c9b-5872-4ca6-a0fa-55010d95bc48'::uuid, 9)
) AS v(id, type_id, sort_order)
WHERE m.id = v.id AND m.type_id IS NULL;--> statement-breakpoint
-- Remaining (self-created) roles: flagged -> position (status stays unchanged), otherwise other. Sorted by title.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT title FROM member_roles WHERE type_id IS NULL AND grants_active_status LOOP
    RAISE NOTICE 'Role "%" has the active-status flag and is moved to type position', r.title;
  END LOOP;
END $$;--> statement-breakpoint
UPDATE member_roles SET type_id = '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5' WHERE type_id IS NULL AND grants_active_status;--> statement-breakpoint
UPDATE member_roles m SET type_id = 'e4333d64-2527-4f99-b5cc-547422f87d12', sort_order = s.rn
FROM (SELECT id, row_number() OVER (ORDER BY title, id) AS rn FROM member_roles WHERE type_id IS NULL) s
WHERE m.id = s.id;--> statement-breakpoint
-- Flagged self-created roles went to position: append after the known ones, by title.
UPDATE member_roles m SET sort_order = 1000 + s.rn
FROM (SELECT id, row_number() OVER (ORDER BY title, id) AS rn FROM member_roles WHERE type_id = '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5' AND sort_order = 0) s
WHERE m.id = s.id;--> statement-breakpoint
INSERT INTO member_roles (id, title, grants_active_status, is_protected, type_id, sort_order)
SELECT v.id, v.title, v.grants, false, v.type_id, v.sort_order FROM (VALUES
  ('e9db3bda-6f1e-4d88-be87-d98f316a0a9d'::uuid, 'Feuerwehrmann/-frau', true, '5f75964a-8f5e-4d0f-8a6b-0255e823119f'::uuid, 2),
  ('ec85fe13-8708-4884-866b-67f55969b088'::uuid, 'Oberfeuerwehrmann/-frau', true, '5f75964a-8f5e-4d0f-8a6b-0255e823119f'::uuid, 3),
  ('623b6a0d-6595-4ad6-b291-e451d8cfbdde'::uuid, 'Hauptfeuerwehrmann/-frau', true, '5f75964a-8f5e-4d0f-8a6b-0255e823119f'::uuid, 4),
  ('b21f4245-a9b9-4f32-bf18-8e08d7602ed3'::uuid, 'Löschmeister', true, '5f75964a-8f5e-4d0f-8a6b-0255e823119f'::uuid, 5),
  ('65726a2d-6368-4292-ad3c-287f37248211'::uuid, 'Oberlöschmeister', true, '5f75964a-8f5e-4d0f-8a6b-0255e823119f'::uuid, 6),
  ('9dc9d004-e9d8-4531-a5cd-9d242d6512df'::uuid, 'Hauptlöschmeister', true, '5f75964a-8f5e-4d0f-8a6b-0255e823119f'::uuid, 7),
  ('ac25ef28-6ad9-471c-bd36-3693f62b540c'::uuid, 'Brandmeister', true, '5f75964a-8f5e-4d0f-8a6b-0255e823119f'::uuid, 8),
  ('32f519b4-ac39-4717-89e7-2b4b93a857f9'::uuid, 'Oberbrandmeister', true, '5f75964a-8f5e-4d0f-8a6b-0255e823119f'::uuid, 9),
  ('4cb50b84-a9e8-435a-8d3e-d7e7c40203c4'::uuid, 'Hauptbrandmeister', true, '5f75964a-8f5e-4d0f-8a6b-0255e823119f'::uuid, 10),
  ('f65456f1-377a-4c16-a3d4-a27e18c2ac66'::uuid, '1. Kommandant', true, '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'::uuid, 4),
  ('0ada20bb-74ed-4ded-a3da-ee1e17a26d11'::uuid, '2. Kommandant', true, '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'::uuid, 5),
  ('6976ff4a-7141-4ac4-962b-9b2540b13096'::uuid, 'Kinderfeuerwehr-Betreuer', false, '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'::uuid, 8),
  ('3750d6fd-00a8-4423-bbc3-b1c8e7e5abcc'::uuid, 'Stellv. Kinderfeuerwehr-Betreuer', false, '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5'::uuid, 9),
  ('0e9fadad-c158-4590-adc7-633d180ddb17'::uuid, '1. Vorstand', false, '91321c9b-5872-4ca6-a0fa-55010d95bc48'::uuid, 1),
  ('3060799d-5e93-4812-9426-b37baab73f58'::uuid, '2. Vorstand', false, '91321c9b-5872-4ca6-a0fa-55010d95bc48'::uuid, 2)
) AS v(id, title, grants, type_id, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM member_roles e WHERE e.id = v.id OR (e.type_id = v.type_id AND e.title = v.title));--> statement-breakpoint
ALTER TABLE "member_roles" ALTER COLUMN "sort_order" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "member_roles" ALTER COLUMN "type_id" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "member_roles" ADD CONSTRAINT "member_roles_type_id_member_role_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."member_role_types"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
