import { sql } from "drizzle-orm";
import { boolean, date, index, integer, numeric, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { members } from "./members";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  commissionedAt: date("commissioned_at"),
  purchasePrice: numeric("purchase_price", { precision: 10, scale: 2 }),
  notes: text("notes"),
  retiredAt: date("retired_at"),
  retiredReason: text("retired_reason"),
  // 1 = Einzelstück (default), >1 = Batch — nur mit dem Feld "quantity" (enabledFields).
  quantity: integer("quantity").notNull().default(1),
  // Teilmengen-Ausmusterung bei Batches; retiredAt wird gesetzt sobald
  // retiredQuantity == quantity (siehe routes/inventory.tsx retire-Handler).
  retiredQuantity: integer("retired_quantity").notNull().default(0),
  // Feste Felder, die dieser Posten hat (Schlüssel siehe INVENTORY_FIELDS in lib/inventory.ts).
  enabledFields: text("enabled_fields").array().notNull().default([]),
  // Feld "location": Standort-Text + optionale Koordinaten (nur zusammen).
  locationText: text("location_text"),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
});

// Replaces the old single assignedMemberId FK — a batch item can be split across
// several members, each holding `quantity` of the total. Single-item PPE just
// ends up with at most one row here (quantity 1 of a quantity-1 item).
export const inventoryItemAssignments = pgTable("inventory_item_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  inventoryItemId: uuid("inventory_item_id")
    .notNull()
    .references(() => inventoryItems.id, { onDelete: "cascade" }),
  memberId: uuid("member_id")
    .notNull()
    .references(() => members.id, { onDelete: "cascade" }),
  quantity: integer("quantity").notNull().default(1),
});

// Join table, not text[] — no Postgres-array precedent in this schema, every other
// multi-value relation (member_role_assignments, app_role_permissions) is a join table.
export const inventoryItemTags = pgTable(
  "inventory_item_tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
  },
  (t) => [uniqueIndex("inventory_item_tags_item_tag_idx").on(t.inventoryItemId, t.tag)],
);

// Inventarnummern: beliebiger Text, global eindeutig und schreibungsabhängig.
export const inventoryItemNumbers = pgTable(
  "inventory_item_numbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
  },
  (t) => [uniqueIndex("inventory_item_numbers_number_idx").on(t.number), index("inventory_item_numbers_item_idx").on(t.inventoryItemId)],
);

// Seriennummern (Hersteller): pro Stück eine, bewusst nicht eindeutig — verschiedene
// Hersteller können dieselbe Nummer vergeben.
export const inventoryItemSerials = pgTable(
  "inventory_item_serials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    serial: text("serial").notNull(),
  },
  (t) => [uniqueIndex("inventory_item_serials_item_serial_idx").on(t.inventoryItemId, t.serial)],
);

export const inventoryFieldTypeEnum = pgEnum("inventory_field_type", ["text", "number", "date", "boolean", "select"]);

// Freie Felder: zentral definiert, Werte pro Posten. Typ ist nach dem Anlegen fix.
export const inventoryFieldDefs = pgTable("inventory_field_defs", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  type: inventoryFieldTypeEnum("type").notNull(),
  options: text("options").array(),
  archived: boolean("archived").notNull().default(false),
});

// Eine Zeile = Feld ist am Posten aktiv; value darf leer sein. Als Text gespeichert, Typ steckt in der Definition.
export const inventoryFieldValues = pgTable(
  "inventory_field_values",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    fieldDefId: uuid("field_def_id")
      .notNull()
      .references(() => inventoryFieldDefs.id, { onDelete: "restrict" }),
    value: text("value"),
  },
  (t) => [uniqueIndex("inventory_field_values_item_field_idx").on(t.inventoryItemId, t.fieldDefId)],
);

// Prüfarten pro Posten (Feld "inspection"). Ohne dueDate erledigt, ohne Intervall Einmalfrist.
export const inventoryInspections = pgTable(
  "inventory_inspections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    intervalMonths: integer("interval_months"),
    inspectedAt: date("inspected_at"),
    dueDate: date("due_date"),
  },
  (t) => [uniqueIndex("inventory_inspections_item_name_idx").on(t.inventoryItemId, sql`lower(${t.name})`)],
);

// Zentrale Vorlagen: Name und Intervall werden beim Anlegen einer Prüfart kopiert, nicht verknüpft.
export const inventoryInspectionTemplates = pgTable(
  "inventory_inspection_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    defaultIntervalMonths: integer("default_interval_months"),
  },
  (t) => [uniqueIndex("inventory_inspection_templates_name_idx").on(sql`lower(${t.name})`)],
);

// Posten-Vorlagen (Backlog 118): beim Anlegen kopiert, am Posten steht keine Vorlagen-ID. Löschen ist hart.
export const inventoryTemplates = pgTable(
  "inventory_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Feste Felder, Schlüssel wie inventory_items.enabled_fields.
    enabledFields: text("enabled_fields").array().notNull().default([]),
  },
  (t) => [uniqueIndex("inventory_templates_name_idx").on(sql`lower(${t.name})`)],
);

export const inventoryTemplateFieldDefs = pgTable(
  "inventory_template_field_defs",
  {
    templateId: uuid("template_id").notNull().references(() => inventoryTemplates.id, { onDelete: "cascade" }),
    fieldDefId: uuid("field_def_id").notNull().references(() => inventoryFieldDefs.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.fieldDefId] })],
);

export const inventoryTemplateInspections = pgTable(
  "inventory_template_inspections",
  {
    templateId: uuid("template_id").notNull().references(() => inventoryTemplates.id, { onDelete: "cascade" }),
    inspectionTemplateId: uuid("inspection_template_id").notNull().references(() => inventoryInspectionTemplates.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.inspectionTemplateId] })],
);
/* v8 ignore stop */
