-- enabled_fields aus der bisherigen Kategorie ableiten (BATCH_CAPABLE/SERIAL_CATEGORIES, Prüf-Spalten je Kategorie),
-- plus alles, wofür tatsächlich Daten existieren — nichts darf unsichtbar werden. "location" ist neu, nie vorbelegt.
UPDATE "inventory_items" i SET "enabled_fields" = ARRAY(
  SELECT f FROM unnest(ARRAY['quantity','numbers','serials','assignments','inspection']) AS f
  WHERE CASE f
    WHEN 'quantity' THEN i."category" IN ('equipment','ppe','other') OR i."quantity" > 1 OR i."retired_quantity" > 0
    WHEN 'numbers' THEN true -- jede Kategorie hatte Inventarnummern
    WHEN 'serials' THEN i."category" IN ('scba','equipment','ppe') OR EXISTS (SELECT 1 FROM "inventory_item_serials" s WHERE s."inventory_item_id" = i."id")
    WHEN 'assignments' THEN i."category" = 'ppe' OR EXISTS (SELECT 1 FROM "inventory_item_assignments" a WHERE a."inventory_item_id" = i."id")
    WHEN 'inspection' THEN i."category" IN ('vehicle','scba','equipment','ppe')
      OR i."vehicle_inspection_due" IS NOT NULL OR i."next_inspection_due" IS NOT NULL OR i."last_inspection_date" IS NOT NULL
  END
);
