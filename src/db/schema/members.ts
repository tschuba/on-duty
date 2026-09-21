import { pgEnum, pgTable, text, date, uuid } from "drizzle-orm/pg-core";

export const genderEnum = pgEnum("gender", ["male", "female"]);

export const members = pgTable("members", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  lastName: text("last_name").notNull(),
  firstName: text("first_name").notNull(),
  street: text("street"),
  houseNumber: text("house_number"),
  zip: text("zip"),
  city: text("city"),
  gender: genderEnum("gender"),
  birthDate: date("birth_date").notNull(),
  entryDate: date("entry_date").notNull(),
  exitDate: date("exit_date"),
  deathDate: date("death_date"),
  phone: text("phone"),
  email: text("email"),
});
