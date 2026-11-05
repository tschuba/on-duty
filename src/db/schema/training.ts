import { check, date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { members } from "./members";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const trainingRecords = pgTable("training_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  completedAt: date("completed_at"),
  expiresAt: date("expires_at"),
  organizer: text("organizer"),
  notes: text("notes"),
}, (t) => [
  index("training_records_member_id_idx").on(t.memberId),
  index("training_records_expires_at_idx").on(t.expiresAt),
  check("training_records_dates_present", sql`${t.completedAt} IS NOT NULL OR ${t.expiresAt} IS NOT NULL`),
  check("training_records_dates_order", sql`${t.expiresAt} IS NULL OR ${t.completedAt} IS NULL OR ${t.expiresAt} >= ${t.completedAt}`),
]);
/* v8 ignore stop */
