import { boolean, date, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { members } from "./members";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const memberRoles = pgTable("member_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  grantsActiveStatus: boolean("grants_active_status").notNull().default(false),
  isProtected: boolean("is_protected").notNull().default(false),
});

export const memberRoleAssignments = pgTable("member_role_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  memberRoleId: uuid("member_role_id")
    .notNull()
    .references(() => memberRoles.id),
  from: date("from").notNull(),
  to: date("to"),
  autoClosed: boolean("auto_closed").notNull().default(false),
  note: text("note"),
});

export const anniversaryYears = pgTable("anniversary_years", {
  kind: text("kind", { enum: ["service", "membership"] }).notNull(),
  year: integer("year").notNull(),
  title: text("title"),
}, (t) => [primaryKey({ columns: [t.kind, t.year] })]);
/* v8 ignore stop */
