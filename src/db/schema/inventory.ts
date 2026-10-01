import { date, integer, numeric, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { members } from "./members";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const inventoryCategoryEnum = pgEnum("inventory_category", ["vehicle", "scba", "equipment", "ppe", "other"]);

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: inventoryCategoryEnum("category").notNull(),
  purchaseDate: date("purchase_date"),
  purchasePrice: numeric("purchase_price", { precision: 10, scale: 2 }),
  notes: text("notes"),
  retiredAt: date("retired_at"),
  retiredReason: text("retired_reason"),
  // nullable, app-validated to category=ppe only (see routes/inventory.tsx) — no
  // DB check-constraint for this, the schema has none of that kind so far.
  assignedMemberId: uuid("assigned_member_id").references(() => members.id, { onDelete: "set null" }),
  // Fahrzeuge
  licensePlate: text("license_plate"),
  yearOfManufacture: integer("year_of_manufacture"),
  vehicleInspectionDue: date("vehicle_inspection_due"),
  // SCBA / Gerät / PSA
  serialNumber: text("serial_number"),
  nextInspectionDue: date("next_inspection_due"),
  lastInspectionDate: date("last_inspection_date"),
});

// Join table, not text[] — no Postgres-array precedent in this schema, every other
// multi-value relation (member_role_assignments, app_role_permissions) is a join table.
export const inventoryItemTags = pgTable(
  "inventory_item_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [uniqueIndex("inventory_item_tags_item_tag_idx").on(t.inventoryItemId, t.tag)],
);
/* v8 ignore stop */
