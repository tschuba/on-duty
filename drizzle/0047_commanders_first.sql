-- Commander roles first within the position type (positions 1..5 are exactly these roles).
UPDATE member_roles m SET sort_order = v.so
FROM (VALUES
  ('9540a309-6b49-48f8-b39b-2349018a6119'::uuid, 1),
  ('f65456f1-377a-4c16-a3d4-a27e18c2ac66'::uuid, 2),
  ('0ada20bb-74ed-4ded-a3da-ee1e17a26d11'::uuid, 3),
  ('bc7a50c6-a0c9-4d1a-a212-6d39ba833fed'::uuid, 4),
  ('77700bd9-6c64-43d6-af49-02d3c8e7d665'::uuid, 5)
) AS v(id, so)
WHERE m.id = v.id AND m.type_id = '48f95a02-4ad7-434b-bcc9-9da9cfa8b6b5';
