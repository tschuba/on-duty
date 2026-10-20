import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and } from "drizzle-orm";
import { appSettings } from "./schema/index.js";
import { LOCAL_ADMIN_ACCOUNT_ID, LOCAL_ADMIN_EMAIL } from "../lib/constants.js";
import {
  users,
  accounts,
  memberRoles,
  memberRoleTypes,
  anniversaryYears,
  appRoles,
  appRolePermissions,
  userAppRoles,
} from "./schema/index.js";
import { ROLE_SEED, ROLE_TYPES } from "./role-seed-data.js";
import type { Permission } from "../lib/roles.js";

const APP_ROLES: { id: string; name: string; description: string; isProtected: boolean; permissions: Permission[] }[] = [
  {
    id: "9b1f6c2a-4b3a-4b3a-8b3a-1a2b3c4d5e6f",
    name: "Administrator",
    description: "Benutzerverwaltung, Systemkonfiguration und Antragsformulare",
    isProtected: true,
    permissions: ["system:admin", "applications:manage-forms", "import:run"],
  },
  {
    id: "2f8e1d4c-6a7b-4c8d-9e0f-1a2b3c4d5e6f",
    name: "Bearbeiter",
    description: "Kann Mitglieder, Spenden und Anträge bearbeiten sowie Stammdaten pflegen",
    isProtected: true,
    permissions: ["members:read", "members:write", "donations:read", "donations:record", "applications:read", "applications:record", "applications:manage-forms", "org:write"],
  },
  {
    id: "7c3d5e6f-8a9b-4c1d-8e2f-3a4b5c6d7e8f",
    name: "Leser",
    description: "Kann Mitglieder einsehen",
    isProtected: true,
    permissions: ["members:read", "inventory:read", "lending:read", "org:read"],
  },
  {
    id: "4a2b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d",
    name: "Vorstand",
    description: "Kann Spenden erfassen, Zuwendungsbestätigungen ausstellen und Anträge prüfen",
    isProtected: true,
    permissions: ["members:read", "members:write", "members:delete", "donations:read", "donations:record", "donations:delete", "donations:issue-receipts", "applications:read", "applications:record", "applications:review", "applications:manage-forms", "inventory:read", "inventory:manage", "lending:read", "lending:manage", "org:read", "org:write", "org:tax-data:read"],
  },
  {
    id: "5d3e7f90-1b2c-4d5e-8f60-7a8b9c0d1e2f",
    name: "Finanzen",
    description: "Kann Bankdaten von Mitgliedern und Steuerdaten des Vereins pflegen",
    isProtected: true,
    permissions: ["members:read", "members:bank-data:read", "members:bank-data:write", "org:read", "org:tax-data:read", "org:tax-data:write"],
  },
  {
    id: "c1d2e3f4-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    name: "Führung",
    description: "Kann das Inventar vollständig verwalten",
    isProtected: true,
    permissions: ["members:read", "members:write", "members:delete", "inventory:read", "inventory:manage", "lending:read", "org:read", "org:write"],
  },
];

export async function runSeed() {
  if (!process.env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is not set");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const client = postgres(process.env.DATABASE_URL);
  const db = drizzle(client);

  try {
    await db.insert(memberRoleTypes).values(ROLE_TYPES.map(({ key: _key, ...t }) => t)).onConflictDoNothing();
    const typeId = Object.fromEntries(ROLE_TYPES.map((t) => [t.key, t.id]));
    await db.insert(memberRoles).values(
      ROLE_SEED.map(({ type, ...r }) => ({ ...r, typeId: typeId[type], isProtected: false })),
    ).onConflictDoNothing();

    const defaultYears = [25, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100];
    await db.insert(anniversaryYears).values(
      (["service", "membership"] as const).flatMap((kind) => defaultYears.map((year) => ({ kind, year }))),
    ).onConflictDoNothing();

    await db.insert(appRoles).values(
      APP_ROLES.map(({ id, name, description, isProtected }) => ({ id, name, description, isProtected })),
    ).onConflictDoNothing();

    await db.insert(appRolePermissions).values(
      APP_ROLES.flatMap((r) => r.permissions.map((permission) => ({ roleId: r.id, permission }))),
    ).onConflictDoNothing();

    // One-time presets from env: only inserted while the key is absent, so later changes in /admin/config stick.
    const presets = {
      registrationEnabled: process.env.REGISTRATION_ENABLED,
      registrationAutoApprove: process.env.REGISTRATION_AUTO_APPROVE,
      registrationDefaultRoleId: process.env.REGISTRATION_DEFAULT_ROLE_ID,
    };
    for (const [key, value] of Object.entries(presets)) {
      if (value) await db.insert(appSettings).values({ key, value }).onConflictDoNothing();
    }

    const now = new Date();
    const hash = await hashPassword(process.env.ADMIN_PASSWORD);

    await db
      .insert(users)
      .values({
        id: LOCAL_ADMIN_ACCOUNT_ID,
        name: "Administrator",
        email: LOCAL_ADMIN_EMAIL,
        emailVerified: true,
        disabled: false,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    // ponytail: only re-links the seeded local admin account to its role — any other
    // pre-existing user's old appRole is not backfilled (dev/seed-only data, no migration needed)
    await db
      .insert(userAppRoles)
      .values({ userId: LOCAL_ADMIN_ACCOUNT_ID, roleId: APP_ROLES[0].id })
      .onConflictDoNothing();

    const existing = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.accountId, LOCAL_ADMIN_ACCOUNT_ID), eq(accounts.providerId, "credential")));

    if (existing.length === 0) {
      await db.insert(accounts).values({
        id: "admin-credential",
        accountId: LOCAL_ADMIN_ACCOUNT_ID,
        providerId: "credential",
        userId: LOCAL_ADMIN_ACCOUNT_ID,
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
