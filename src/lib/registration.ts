import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, userAppRoles, appRolePermissions } from "../db/schema/index.js";
import { env } from "../env.js";
import { getSettings } from "./settings.js";
import { sendMail } from "./mail.js";

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
