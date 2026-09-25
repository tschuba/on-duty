import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { users, accounts } from "./schema/index.js";

export async function runSeed() {
  if (!process.env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is not set");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const client = postgres(process.env.DATABASE_URL);
  const db = drizzle(client);

  try {
    const now = new Date();
    const hash = await hashPassword(process.env.ADMIN_PASSWORD);

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
  } finally {
    await client.end();
  }
}
