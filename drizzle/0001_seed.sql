INSERT INTO member_roles (id, title, grants_active_status) VALUES
  ('8bf6c0be-faa1-4149-b116-ef6bebf7cece', '1. Vorstand',                 false),
  ('9f1dc72b-bce2-4602-b4f0-fe30369f93d4', '2. Vorstand',                 false),
  ('b76895ab-577d-4fcf-a567-300fa1bfba91', 'Schriftführer',               false),
  ('5054f7c6-61fa-4692-93a6-2256f16de546', 'Kassier',                     false),
  ('e10a3bb7-ed77-46a9-a7fe-f1d1f8326ed3', 'Beisitzer',                   false),
  ('9540a309-6b49-48f8-b39b-2349018a6119', '1. Kommandant',               true),
  ('cd40f0d0-9f83-4667-bad2-1c163f3378ad', '2. Kommandant',               true),
  ('77700bd9-6c64-43d6-af49-02d3c8e7d665', 'Gruppenführer',               true),
  ('bc7a50c6-a0c9-4d1a-a212-6d39ba833fed', 'Maschinist',                  true),
  ('bda48bcc-d4f3-464f-9067-732d3f35675c', 'Jugendfeuerwehrwart',         false),
  ('b2b821ce-30aa-4b14-a6aa-c63d09daf37c', 'Stellv. Jugendfeuerwehrwart', false),
  ('f2dd276b-027b-4b82-8313-918bc4f9d5c5', 'Feuerwehr-Anwärter',          true),
  ('8a6372ef-4561-4f0d-aa2e-3ed80ac2b003', 'Ehrenkommandant',             false),
  ('4005b6b5-bbf3-4d52-98c1-3893bf7db574', 'Ehrenvorstand',               false),
  ('d4bda8ff-6d64-404e-a6c2-d7b500abb6a2', 'Ehrenmitglied',               false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO anniversary_years (year) VALUES
  (25), (40), (50), (60), (65), (70), (75), (80), (85), (90), (95), (100)
ON CONFLICT (year) DO NOTHING;
