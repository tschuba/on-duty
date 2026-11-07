import { boolean, check, index, integer, numeric, primaryKey, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appRoles } from "./permissions";
import { members } from "./members";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const eventVisibilityEnum = pgEnum("event_visibility", ["public", "loggedIn", "roles", "members"]);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    allDay: boolean("all_day").notNull().default(false),
    location: text("location"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    description: text("description"),
    visibility: eventVisibilityEnum("visibility").notNull().default("loggedIn"),
    rsvpEnabled: boolean("rsvp_enabled").notNull().default(false),
    maxParticipants: integer("max_participants"),
    rsvpDeadline: timestamp("rsvp_deadline", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    check("events_ends_at_check", sql`${t.endsAt} >= ${t.startsAt}`),
    check("events_max_participants_check", sql`${t.maxParticipants} > 0`),
    check("events_rsvp_deadline_check", sql`${t.rsvpDeadline} <= ${t.startsAt}`),
  ],
);

export const eventRsvpStatusEnum = pgEnum("event_rsvp_status", ["yes", "no"]);

export const eventRsvps = pgTable(
  "event_rsvps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    status: eventRsvpStatusEnum("status").notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("event_rsvps_event_member_idx").on(t.eventId, t.memberId), index("event_rsvps_member_idx").on(t.memberId)],
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

export const eventInvitees = pgTable(
  "event_invitees",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.memberId] }), index("event_invitees_member_idx").on(t.memberId)],
);
