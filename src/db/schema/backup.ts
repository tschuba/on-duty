import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const backupHistory = pgTable("backup_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at").notNull(),
  finishedAt: timestamp("finished_at"),
  status: text("status").notNull(), // "success" | "failed"
  targets: text("targets").notNull().default("[]"), // JSON: TargetResult[]
  errorMessage: text("error_message"),
});
