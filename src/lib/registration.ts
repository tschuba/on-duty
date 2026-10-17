import { eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, userAppRoles, appRolePermissions } from "../db/schema/index.js";
import { env } from "../env.js";
import { getSettings } from "./settings.js";
import { sendMail } from "./mail.js";
import { LOCAL_ADMIN_EMAIL } from "./constants.js";

export type RegistrationRejection = "registration_disabled" | "email_unverified";

// Decides whether OIDC may create a new on-duty user. Admin-created users never reach this (they already exist).
export function registrationRejection(
  s: { registrationEnabled: string },
  emailVerified: boolean,
): RegistrationRejection | null {
  if (s.registrationEnabled !== "true") return "registration_disabled";
  if (!emailVerified) return "email_unverified";
  return null;
}

export async function checkRegistration(emailVerified: boolean): Promise<RegistrationRejection | null> {
  return registrationRejection(await getSettings(), emailVerified);
}

// After a self-registered user exists: grant the default role (auto-approve) or ask the admins to review.
export async function onUserRegistered(user: { id: string; name: string; email: string }): Promise<void> {
  const s = await getSettings();
  if (s.registrationAutoApprove === "true" && s.registrationDefaultRoleId) {
    await db.insert(userAppRoles).values({ userId: user.id, roleId: s.registrationDefaultRoleId }).onConflictDoNothing();
    return;
  }
  const admins = await db
    .selectDistinct({ email: users.email })
    .from(userAppRoles)
    .innerJoin(appRolePermissions, eq(appRolePermissions.roleId, userAppRoles.roleId))
    .innerJoin(users, eq(users.id, userAppRoles.userId))
    .where(eq(appRolePermissions.permission, "system:admin"));
  const recipients = admins.map((a) => a.email).filter((e) => !e.endsWith(".invalid"));
  await Promise.all(
    recipients.map((to) =>
      sendMail(
        to,
        "on-duty: neue Registrierung wartet auf Freigabe",
        `${user.name} (${user.email}) hat sich registriert und wartet auf Freigabe.\n\n${env.OIDC_APP_URL}/admin/users`,
      ),
    ),
  );
}

// A user is "pending" when an admin still has to act: no app role yet, and either the user has logged in
// (login path) or the email is still unverified (webhook path: created at registration, before any login).
// Admin-created users that never logged in stay "unconfirmed", not pending.
export function isPendingUser(
  u: { email: string; disabled: boolean; emailVerified: boolean; lastLoginAt: Date | null },
  hasRole: boolean,
): boolean {
  return !u.disabled && u.email !== LOCAL_ADMIN_EMAIL && !hasRole && (u.lastLoginAt !== null || !u.emailVerified);
}

export async function countPendingUsers(): Promise<number> {
  const rows = await db
    .select({ email: users.email, disabled: users.disabled, emailVerified: users.emailVerified, lastLoginAt: users.lastLoginAt })
    .from(users)
    .leftJoin(userAppRoles, eq(userAppRoles.userId, users.id))
    .where(isNull(userAppRoles.userId));
  return rows.filter((u) => isPendingUser(u, false)).length;
}
