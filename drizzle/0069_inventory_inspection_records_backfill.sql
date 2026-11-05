-- Bisheriger Stand (inspected_at) wird je Prüfart zur ersten Verlaufszeile, Ergebnis unbekannt.
INSERT INTO "inventory_inspection_records" ("inspection_id", "inspected_at")
SELECT "id", "inspected_at" FROM "inventory_inspections" WHERE "inspected_at" IS NOT NULL;
--> statement-breakpoint
-- Rollen mit inventory:manage behalten alles, was sie konnten; Administrator bewusst nicht (wie 0060).
INSERT INTO "app_role_permissions" ("role_id", "permission")
SELECT "role_id", p::"permission" FROM "app_role_permissions", unnest(ARRAY['inventory:inspect','inventory:inspection:delete']) AS p
WHERE "permission" = 'inventory:manage' AND "role_id" <> '9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f'
ON CONFLICT DO NOTHING;
