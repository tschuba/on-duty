import { check, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { permissionEnum } from "./permissions";
import { users } from "./auth";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const mailTemplateVariantEnum = pgEnum("mail_template_variant", ["system", "override", "custom"]);
export const mailHeadersModeEnum = pgEnum("mail_headers_mode", ["fixed", "extendable"]);

// Mailvorlagen (docs: Backlog 148). `system` = Standardtext (nur per Migration änderbar), `override` = vom Admin
// geänderte Fassung (nur subject/body, Rest kommt aus der system-Zeile), `custom` = freie Vorlage (später).
export const mailTemplates = pgTable(
  "mail_templates",
  {
    key: text("key").notNull(),
    locale: text("locale").notNull(),
    variant: mailTemplateVariantEnum("variant").notNull(),
    category: text("category"),
    audience: text("audience"),
    editPermissions: permissionEnum("edit_permissions").array(),
    topic: text("topic"),
    prefix: text("prefix"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    headersMode: mailHeadersModeEnum("headers_mode"),
    extraHeaders: text("extra_headers"), // JSON, nur bei headersMode = extendable
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.locale, t.variant] }),
    check(
      "mail_templates_override_shape_check",
      sql`(${t.variant} = 'override' AND ${t.category} IS NULL AND ${t.audience} IS NULL AND ${t.editPermissions} IS NULL AND ${t.topic} IS NULL AND ${t.prefix} IS NULL AND ${t.headersMode} IS NULL AND ${t.extraHeaders} IS NULL)
        OR (${t.variant} <> 'override' AND ${t.category} IS NOT NULL AND ${t.audience} IS NOT NULL AND ${t.headersMode} IS NOT NULL AND cardinality(${t.editPermissions}) >= 1)`,
    ),
    check("mail_templates_custom_topic_check", sql`${t.variant} <> 'custom' OR ${t.topic} IS NOT NULL`),
  ],
);
