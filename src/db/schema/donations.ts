import { sql } from "drizzle-orm";
import { check, integer, pgEnum, pgTable, numeric, date, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { persons } from "./persons";
import { users } from "./auth";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const donationTypeEnum = pgEnum("donation_type", ["cash", "transfer"]);
export const receiptStatusEnum = pgEnum("receipt_status", ["open", "issued", "not_required"]);

// One donor per person: personId is UNIQUE so donor selection can be get-or-create,
// keeping every donation for a person under a single donors row.
export const donors = pgTable("donors", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id")
    .notNull()
    .unique()
    .references(() => persons.id, { onDelete: "restrict" }),
});

export const donations = pgTable("donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  donorId: uuid("donor_id")
    .notNull()
    .references(() => donors.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  date: date("date").notNull(),
  type: donationTypeEnum("type"),
  purpose: text("purpose"),
  receiptStatus: receiptStatusEnum("receipt_status").notNull().default("open"),
  receiptIssuedAt: timestamp("receipt_issued_at"),
  issuedBy: text("issued_by").references(() => users.id, { onDelete: "set null" }),
});

// One optional receipt file per donation; bytes live on disk (UPLOAD_PATH/donations/<id>), only metadata here.
export const donationReceiptFiles = pgTable("donation_receipt_files", {
  donationId: uuid("donation_id").primaryKey().references(() => donations.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [check("donation_receipt_files_content_type_check", sql`${t.contentType} IN ('application/pdf','image/jpeg','image/png')`)]);
/* v8 ignore stop */
