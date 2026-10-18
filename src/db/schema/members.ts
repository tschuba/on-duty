import { pgTable, date, text, uuid } from "drizzle-orm/pg-core";
import { persons } from "./persons";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id")
    .notNull()
    .unique()
    .references(() => persons.id, { onDelete: "restrict" }),
  entryDate: date("entry_date").notNull(),
  exitDate: date("exit_date"),
  deathDate: date("death_date"),
  iban: text("iban"),
  bic: text("bic"),
  accountHolder: text("account_holder"),
});
/* v8 ignore stop */
