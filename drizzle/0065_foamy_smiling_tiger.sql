ALTER TABLE "inventory_templates" ADD COLUMN "description" text;--> statement-breakpoint
-- Beschreibungen der mitgelieferten Vorlagen (0063), nur wo noch keine eingetragen ist.
UPDATE "inventory_templates" t SET "description" = v.description
FROM (VALUES
  ('Fahrzeug', 'Einsatz- und Mannschaftsfahrzeuge mit Kennzeichen, Baujahr und HU.'),
  ('Atemschutz', 'Atemschutzgeräte und Zubehör, einzeln nummeriert und mit Seriennummer, mit Prüfung.'),
  ('Gerät', 'Geräte und Ausrüstung, nach Menge oder einzeln erfasst, mit Prüfung.'),
  ('PSA', 'Persönliche Schutzausrüstung, einer Person zugeordnet, mit Prüfung.'),
  ('Sonstiges', 'Alles übrige Material, nach Menge oder einzeln erfasst.'),
  ('Hydrant', 'Hydranten mit Standort, Typ und Nennweite, mit Jahresprüfung.')
) AS v(name, description)
WHERE lower(t."name") = lower(v.name) AND t."description" IS NULL;
