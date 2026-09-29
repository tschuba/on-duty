import { pgEnum, pgTable, text, date, uuid } from "drizzle-orm/pg-core";

/* v8 ignore start -- table schema declarations, no branching logic to unit-test */
export const genderEnum = pgEnum("gender", ["male", "female"]);

export const persons = pgTable("persons", {
  id: uuid("id").primaryKey().defaultRandom(),
  lastName: text("last_name").notNull(),
  firstName: text("first_name").notNull(),
  street: text("street"),
  houseNumber: text("house_number"),
  zip: text("zip"),
  city: text("city"),
  gender: genderEnum("gender"),
  // Nullable: a donor-only person has no reason to supply one. Members still
  // require it, enforced app-side in members.tsx (not here).
  birthDate: date("birth_date"),
  phone: text("phone"),
  email: text("email"),
});
/* v8 ignore stop */
