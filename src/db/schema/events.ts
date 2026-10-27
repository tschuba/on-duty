import { boolean, check, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appRoles } from "./permissions";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const eventVisibilityEnum = pgEnum("event_visibility", ["public", "loggedIn", "roles"]);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    location: text("location"),
    description: text("description"),
    visibility: eventVisibilityEnum("visibility").notNull().default("loggedIn"),
  },
  (t) => [check("events_ends_at_check", sql`${t.endsAt} >= ${t.startsAt}`)],
);

export const eventTags = pgTable(
  "event_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [uniqueIndex("event_tags_event_tag_idx").on(t.eventId, t.tag)],
);

export const eventVisibleRoles = pgTable(
  "event_visible_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => appRoles.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("event_visible_roles_event_role_idx").on(t.eventId, t.roleId)],
);
