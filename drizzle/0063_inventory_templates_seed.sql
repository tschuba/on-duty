-- Backlog 118, Migration A: mitgelieferte Posten-Vorlagen, Kategorie als Tag, Fahrzeug-Spalten als freie Felder.
-- Nicht hier: enabled_fields (0059) und die Prüfarten HU/Prüfung (0061) sind aus den alten Spalten schon kopiert.
-- Idempotent: Felder und Prüfart-Vorlagen gleichen Namens (ohne Groß-/Kleinschreibung) werden wiederverwendet, nie überschrieben.

INSERT INTO "inventory_inspection_templates" ("name", "default_interval_months")
SELECT v.name, v.months FROM (VALUES ('HU', NULL::integer), ('Prüfung', NULL::integer), ('Jahresprüfung', 12)) AS v(name, months)
WHERE NOT EXISTS (SELECT 1 FROM "inventory_inspection_templates" t WHERE lower(t."name") = lower(v.name));
--> statement-breakpoint
INSERT INTO "inventory_field_defs" ("name", "type", "options")
SELECT v.name, v.type::"inventory_field_type", v.options FROM (VALUES
  ('Kennzeichen', 'text', NULL::text[]),
  ('Baujahr', 'number', NULL::text[]),
  ('Hydrantentyp', 'select', ARRAY['Unterflurhydrant', 'Überflurhydrant', 'Wandhydrant']),
  ('Nennweite', 'select', ARRAY['DN 80', 'DN 100', 'DN 150'])
) AS v(name, type, options)
WHERE NOT EXISTS (SELECT 1 FROM "inventory_field_defs" d WHERE lower(d."name") = lower(v.name));
--> statement-breakpoint
INSERT INTO "inventory_templates" ("name", "enabled_fields") VALUES
  ('Fahrzeug', ARRAY['numbers', 'inspection']),
  ('Atemschutz', ARRAY['numbers', 'serials', 'inspection']),
  ('Gerät', ARRAY['quantity', 'numbers', 'serials', 'inspection']),
  ('PSA', ARRAY['quantity', 'numbers', 'serials', 'assignments', 'inspection']),
  ('Sonstiges', ARRAY['quantity', 'numbers']),
  ('Hydrant', ARRAY['location', 'inspection'])
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "inventory_template_field_defs" ("template_id", "field_def_id")
SELECT t."id", (SELECT d."id" FROM "inventory_field_defs" d WHERE lower(d."name") = lower(v.field) ORDER BY d."id" LIMIT 1)
FROM (VALUES ('Fahrzeug', 'Kennzeichen'), ('Fahrzeug', 'Baujahr'), ('Hydrant', 'Hydrantentyp'), ('Hydrant', 'Nennweite')) AS v(tpl, field)
JOIN "inventory_templates" t ON lower(t."name") = lower(v.tpl)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "inventory_template_inspections" ("template_id", "inspection_template_id")
SELECT t."id", (SELECT i."id" FROM "inventory_inspection_templates" i WHERE lower(i."name") = lower(v.insp))
FROM (VALUES ('Fahrzeug', 'HU'), ('Atemschutz', 'Prüfung'), ('Gerät', 'Prüfung'), ('PSA', 'Prüfung'), ('Hydrant', 'Jahresprüfung')) AS v(tpl, insp)
JOIN "inventory_templates" t ON lower(t."name") = lower(v.tpl)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Alte Kategorie als Tag (Name der gleichnamigen Vorlage); ein schon vorhandener Tag gleichen Namens genügt.
INSERT INTO "inventory_item_tags" ("inventory_item_id", "tag")
SELECT i."id", m.tag FROM "inventory_items" i
JOIN (VALUES ('vehicle', 'Fahrzeug'), ('scba', 'Atemschutz'), ('equipment', 'Gerät'), ('ppe', 'PSA'), ('other', 'Sonstiges')) AS m(category, tag) ON m.category = i."category"::text
WHERE NOT EXISTS (SELECT 1 FROM "inventory_item_tags" g WHERE g."inventory_item_id" = i."id" AND lower(g."tag") = lower(m.tag));
--> statement-breakpoint
-- Kennzeichen/Baujahr (118 löscht die Spalten) als freie Felder, nur bei vorhandenem Wert.
INSERT INTO "inventory_field_values" ("inventory_item_id", "field_def_id", "value")
SELECT i."id", (SELECT d."id" FROM "inventory_field_defs" d WHERE lower(d."name") = 'kennzeichen' ORDER BY d."id" LIMIT 1), i."license_plate"
FROM "inventory_items" i WHERE i."license_plate" IS NOT NULL AND i."license_plate" <> ''
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "inventory_field_values" ("inventory_item_id", "field_def_id", "value")
SELECT i."id", (SELECT d."id" FROM "inventory_field_defs" d WHERE lower(d."name") = 'baujahr' ORDER BY d."id" LIMIT 1), i."year_of_manufacture"::text
FROM "inventory_items" i WHERE i."year_of_manufacture" IS NOT NULL
ON CONFLICT DO NOTHING;
