import { pgTable, text } from "drizzle-orm/pg-core";

export const orgConfig = pgTable("org_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
