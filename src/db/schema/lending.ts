import { date, integer, pgEnum, pgTable, text, time, timestamp, uuid, boolean } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { inventoryItems } from "./inventory";
import { persons } from "./persons";

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
  // Öffentliches Anfrageformular /lend/:id (Opt-in).
  publicRequestable: boolean("public_requestable").notNull().default(false),
  maxRequestQuantity: integer("max_request_quantity").notNull().default(1),
  timesRequired: boolean("times_required").notNull().default(false),
});

export const lendingLoans = pgTable("lending_loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  lendingItemId: uuid("lending_item_id")
    .notNull()
    .references(() => lendingItems.id, { onDelete: "cascade" }),
  // Nur > 1 relevant bei !individualTracking (Stückzahl-Objekte); Server erzwingt
  // 1 bei Einzel-Tracking.
  quantity: integer("quantity").notNull().default(1),
  // Mitglieder und Externe sind gleichermaßen Personen; Mitgliedschaft ergibt sich
  // aus persons -> members. Kontakt steht in persons.phone/email.
  borrowerPersonId: uuid("borrower_person_id").notNull().references(() => persons.id),
  plannedFrom: date("planned_from"),
  plannedTo: date("planned_to"),
  plannedFromTime: time("planned_from_time"),
  plannedToTime: time("planned_to_time"),
  pickedUpAt: date("picked_up_at"),
  returnedAt: date("returned_at"),
});

export const loanRequestStatusEnum = pgEnum("loan_request_status", ["open", "approved", "rejected"]);

// Öffentliche Anfrage; reserviert nichts — erst die Genehmigung erzeugt einen lending_loans-Eintrag.
export const loanRequests = pgTable("loan_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  lendingItemId: uuid("lending_item_id").notNull().references(() => lendingItems.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => persons.id, { onDelete: "restrict" }),
  quantity: integer("quantity").notNull().default(1),
  plannedFrom: date("planned_from").notNull(),
  plannedTo: date("planned_to").notNull(),
  plannedFromTime: time("planned_from_time"),
  plannedToTime: time("planned_to_time"),
  message: text("message").notNull(),
  status: loanRequestStatusEnum("status").notNull().default("open"),
  statusToken: text("status_token").notNull().unique(),
  loanId: uuid("loan_id").references(() => lendingLoans.id, { onDelete: "set null" }),
  // null = Antragsteller (noch) nicht per Mail benachrichtigt.
  notifiedAt: timestamp("notified_at"),
  // Intern — nie an den Antragsteller.
  rejectedReason: text("rejected_reason"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
});
/* v8 ignore stop */
