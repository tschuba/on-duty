import { pgEnum, pgTable, numeric, date, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { persons } from "./persons";
import { users } from "./auth";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const donationTypeEnum = pgEnum("donation_type", ["cash", "transfer"]);

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
  type: donationTypeEnum("type").notNull(),
  purpose: text("purpose"),
  receiptIssuedAt: timestamp("receipt_issued_at"),
  issuedBy: text("issued_by").references(() => users.id, { onDelete: "set null" }),
});
/* v8 ignore stop */
