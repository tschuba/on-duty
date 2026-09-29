import { boolean, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { persons } from "./persons";
import { users } from "./auth";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const applicationTypeEnum = pgEnum("application_type", ["membership", "youth"]);
export const applicationStatusEnum = pgEnum("application_status", ["open", "approved", "rejected"]);

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id")
    .notNull()
    .references(() => persons.id, { onDelete: "restrict" }),
  type: applicationTypeEnum("type").notNull(),
  status: applicationStatusEnum("status").notNull().default("open"),
  message: text("message"),
  // Internal only — never sent to the applicant, see reject route.
  rejectedReason: text("rejected_reason"),
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by").references(() => users.id, { onDelete: "set null" }),
});

// Only populated for type=youth. Each guardian is its own persons row (so they can
// later become a member/donor themselves) linked here per application.
export const applicationGuardians = pgTable("application_guardians", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  personId: uuid("person_id")
    .notNull()
    .references(() => persons.id, { onDelete: "restrict" }),
  consentGiven: boolean("consent_given").notNull(),
});
/* v8 ignore stop */
