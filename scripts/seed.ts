import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { users, accounts } from "../src/db/schema/index.js";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!DATABASE_URL) { console.error("DATABASE_URL fehlt"); process.exit(1); }
if (!ADMIN_PASSWORD) { console.error("ADMIN_PASSWORD fehlt"); process.exit(1); }

const client = postgres(DATABASE_URL);
const db = drizzle(client);

const now = new Date();
const hash = await hashPassword(ADMIN_PASSWORD);

// Upsert admin user — preserve existing data, only set fields on first insert
await db
  .insert(users)
  .values({
    id: "admin",
    name: "Administrator",
    email: "admin@localhost.invalid",
    emailVerified: true,
    appRole: "admin",
    disabled: false,
    createdAt: now,
    updatedAt: now,
  })
  .onConflictDoNothing();

// Upsert credential account — onConflictDoNothing preserves a changed password
const existing = await db
  .select({ id: accounts.id })
  .from(accounts)
  .where(and(eq(accounts.accountId, "admin"), eq(accounts.providerId, "credential")));

if (existing.length === 0) {
  await db.insert(accounts).values({
    id: "admin-credential",
    accountId: "admin",
    providerId: "credential",
    userId: "admin",
    password: hash,
    createdAt: now,
    updatedAt: now,
  });
  console.log("Admin-Account angelegt.");
} else {
  console.log("Admin-Account bereits vorhanden — Passwort unverändert.");
}

await client.end();
