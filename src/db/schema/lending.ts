import { date, integer, pgTable, text, uuid, boolean } from "drizzle-orm/pg-core";
import { inventoryItems } from "./inventory";
import { members } from "./members";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
// Verleihfähigkeit einer bestehenden inventory_items-Zeile — siehe
// docs Backlog 18_Verleihfunktion.md. Kein eigenes Bestandsfeld: die verleihbare
// Menge kommt aus inventory_items.quantity/retiredQuantity (Batch-Tracking aus
// dem Inventar-Modul), damit es keine zweite Wahrheit für denselben Bestand gibt.
export const lendingItems = pgTable("lending_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  inventoryItemId: uuid("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id, { onDelete: "cascade" }),
  // Nach Anlage nicht mehr änderbar (würde bestehende Vorgänge inkonsistent
  // machen) — app-seitig durchgesetzt, keine Bearbeiten-Route für lending_items.
  individualTracking: boolean("individual_tracking").notNull(),
});

export const lendingLoans = pgTable("lending_loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  lendingItemId: uuid("lending_item_id")
    .notNull()
    .references(() => lendingItems.id, { onDelete: "cascade" }),
  // Nur > 1 relevant bei !individualTracking (Stückzahl-Objekte); Server erzwingt
  // 1 bei Einzel-Tracking.
  quantity: integer("quantity").notNull().default(1),
  borrowerMemberId: uuid("borrower_member_id").references(() => members.id),
  borrowerName: text("borrower_name"),
  borrowerContact: text("borrower_contact"),
  plannedFrom: date("planned_from"),
  plannedTo: date("planned_to"),
  pickedUpAt: date("picked_up_at"),
  returnedAt: date("returned_at"),
});
/* v8 ignore stop */
