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
  // 1 = Einzelstück (default), >1 = Batch — app-validated per category, see
  // BATCH_CAPABLE_CATEGORIES in routes/inventory.tsx.
  quantity: integer("quantity").notNull().default(1),
  // Teilmengen-Ausmusterung bei Batches; retiredAt wird gesetzt sobald
  // retiredQuantity == quantity (siehe routes/inventory.tsx retire-Handler).
  retiredQuantity: integer("retired_quantity").notNull().default(0),
  // Fahrzeuge
  licensePlate: text("license_plate"),
  yearOfManufacture: integer("year_of_manufacture"),
  vehicleInspectionDue: date("vehicle_inspection_due"),
  // SCBA / Gerät / PSA
  serialNumber: text("serial_number"),
  nextInspectionDue: date("next_inspection_due"),
  lastInspectionDate: date("last_inspection_date"),
});

// Replaces the old single assignedMemberId FK — a batch item can be split across
// several members, each holding `quantity` of the total. Single-item PPE just
// ends up with at most one row here (quantity 1 of a quantity-1 item).
export const inventoryItemAssignments = pgTable("inventory_item_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  inventoryItemId: uuid("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
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
