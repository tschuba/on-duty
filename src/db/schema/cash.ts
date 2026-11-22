import { boolean, check, date, index, integer, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { events } from "./events";
import { donations } from "./donations";
import { lendingLoans } from "./lending";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const cashBasisEnum = pgEnum("cash_basis", ["paid", "booked"]);
export const cashDirectionEnum = pgEnum("cash_direction", ["income", "expense"]);
export const cashTagDirectionEnum = pgEnum("cash_tag_direction", ["income", "expense", "both"]);
export const cashTagMeaningEnum = pgEnum("cash_tag_meaning", ["opening", "deposit", "donation", "lending"]);
export const cashEntryStatusEnum = pgEnum("cash_entry_status", ["open", "booked", "reversed", "cancelled"]);
export const cashSourceRoleEnum = pgEnum("cash_source_role", ["receivable", "refund", "retention"]);
export const cashYearActionEnum = pgEnum("cash_year_action", ["close", "reopen"]);

// Gaplessness and non-overlap are enforced in src/lib/cash.ts, not in the DB.
export const cashFiscalYears = pgTable("cash_fiscal_years", {
  id: uuid("id").primaryKey().defaultRandom(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  label: text("label").notNull(),
  basis: cashBasisEnum("basis").notNull().default("paid"),
  // Set on close, NULL again on reopen (the log keeps the values).
  endBalance: numeric("end_balance", { precision: 12, scale: 2 }),
  openCount: integer("open_count"),
  openTotal: numeric("open_total", { precision: 12, scale: 2 }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [check("cash_fiscal_years_range_check", sql`${t.endDate} >= ${t.startDate}`)]);

export const cashYearLog = pgTable("cash_year_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  yearId: uuid("year_id").notNull().references(() => cashFiscalYears.id, { onDelete: "restrict" }),
  action: cashYearActionEnum("action").notNull(),
  by: text("by").references(() => users.id, { onDelete: "set null" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  reason: text("reason"),
  carriedCount: integer("carried_count"),
  endBalance: numeric("end_balance", { precision: 12, scale: 2 }),
  openCount: integer("open_count"),
  openTotal: numeric("open_total", { precision: 12, scale: 2 }),
});

// Veranstaltung der Kasse. Mit Termin (event_id) kommen Name und Zeitraum live vom Termin, sonst stehen sie hier.
export const cashEvents = pgTable(
  "cash_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    name: text("name"),
    fromDate: date("from_date"),
    toDate: date("to_date"),
  },
  (t) => [
    uniqueIndex("cash_events_event_idx").on(t.eventId),
    check("cash_events_name_check", sql`${t.eventId} IS NOT NULL OR ${t.name} IS NOT NULL`),
    check("cash_events_range_check", sql`${t.fromDate} <= ${t.toDate}`),
  ],
);

export const cashEntries = pgTable(
  "cash_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    direction: cashDirectionEnum("direction").notNull(),
    bookingDate: date("booking_date").notNull(),
    paidDate: date("paid_date"),
    status: cashEntryStatusEnum("status").notNull(),
    reversesEntryId: uuid("reverses_entry_id").references((): any => cashEntries.id, { onDelete: "restrict" }),
    originalBookingDate: date("original_booking_date"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    description: text("description"),
    receiptRef: text("receipt_ref"),
    cashEventId: uuid("cash_event_id").references(() => cashEvents.id, { onDelete: "restrict" }),
    // Redundant cache of Σ items, set in the same transaction as the items.
    total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
    donationId: uuid("donation_id").references(() => donations.id, { onDelete: "set null" }),
    lendingLoanId: uuid("lending_loan_id").references(() => lendingLoans.id, { onDelete: "set null" }),
    sourceRole: cashSourceRoleEnum("source_role"),
  },
  (t) => [
    check("cash_entries_paid_date_check", sql`${t.status} NOT IN ('booked','reversed') OR ${t.paidDate} IS NOT NULL`),
    check("cash_entries_one_source_check", sql`NOT (${t.donationId} IS NOT NULL AND ${t.lendingLoanId} IS NOT NULL)`),
    check("cash_entries_source_role_check", sql`(${t.sourceRole} IS NOT NULL) = (${t.lendingLoanId} IS NOT NULL)`),
    check("cash_entries_reverses_booked_check", sql`${t.reversesEntryId} IS NULL OR ${t.status} = 'booked'`),
    uniqueIndex("cash_entries_reverses_idx").on(t.reversesEntryId),
    uniqueIndex("cash_entries_donation_idx").on(t.donationId).where(sql`${t.status} NOT IN ('cancelled','reversed')`),
    uniqueIndex("cash_entries_receivable_idx")
      .on(t.lendingLoanId)
      .where(sql`${t.status} NOT IN ('cancelled','reversed') AND ${t.sourceRole} = 'receivable'`),
    index("cash_entries_booking_date_idx").on(t.bookingDate),
    index("cash_entries_paid_date_idx").on(t.paidDate),
    index("cash_entries_cash_event_idx").on(t.cashEventId),
  ],
);

export const cashEntryItems = pgTable(
  "cash_entry_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id").notNull().references(() => cashEntries.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
    description: text("description"),
  },
  (t) => [check("cash_entry_items_amount_check", sql`${t.amount} > 0`), index("cash_entry_items_entry_idx").on(t.entryId)],
);

export const cashTags = pgTable(
  "cash_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    direction: cashTagDirectionEnum("direction").notNull(),
    meaning: cashTagMeaningEnum("meaning"),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("cash_tags_name_idx").on(sql`lower(${t.name})`), uniqueIndex("cash_tags_meaning_idx").on(t.meaning)],
);

export const cashItemTags = pgTable(
  "cash_item_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => cashEntryItems.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => cashTags.id, { onDelete: "restrict" }),
  },
  (t) => [uniqueIndex("cash_item_tags_item_tag_idx").on(t.itemId, t.tagId)],
);
/* v8 ignore stop */
