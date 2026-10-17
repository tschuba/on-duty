import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import * as schema from "./db/schema/index.js";
import { env } from "./env.js";
import { checkRegistration, onUserRegistered } from "./lib/registration.js";
import { parseSessionLifetime } from "./lib/session-lifetime.js";

// Marks the owning user as having completed at least one successful login.
// Fires on every new session, covering both the OIDC and credential paths.
export async function recordSuccessfulLogin(userId: string) {
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, userId));
}

/* v8 ignore start -- better-auth wiring/config, no branching logic to unit-test */
export const auth = betterAuth({
  baseURL: env.OIDC_APP_URL,
  basePath: "/auth",
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  session: {
    expiresIn: parseSessionLifetime(env.SESSION_LIFETIME),
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  // No trustedProviders: linking an OIDC login to an existing user requires email_verified=true from the
  // provider, otherwise an unverified address at a self-registration provider could take over an account.
  account: {
    skipStateCookieCheck: true,
  },
  user: {
    additionalFields: {
      disabled: { type: "boolean", defaultValue: false, input: false },
      lastLoginAt: { type: "date", required: false, input: false },
    },
  },
  databaseHooks: {
    // Only better-auth-created users reach these hooks (OIDC sign-up); admin-created users are inserted directly.
    user: {
      create: {
        before: async (user) => {
          const rejection = await checkRegistration(Boolean(user.emailVerified));
          if (rejection) throw new APIError("FORBIDDEN", { code: rejection, message: rejection });
        },
        after: async (user) => {
          await onUserRegistered(user);
        },
      },
    },
    session: {
      create: {
        after: async (session) => {
          await recordSuccessfulLogin(session.userId);
        },
      },
    },
  },
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: "oidc",
          clientId: env.OIDC_CLIENT_ID,
          clientSecret: env.OIDC_CLIENT_SECRET,
          discoveryUrl: `${env.OIDC_PROVIDER}/.well-known/openid-configuration`,
          scopes: ["openid", "email", "profile"],
          pkce: true,
          // sign-up is gated at runtime by the user.create.before hook (registrationEnabled)
        },
      ],
    }),
  ],
  trustedOrigins: [env.OIDC_APP_URL],
});
/* v8 ignore stop */

export type AppUser = typeof auth.$Infer.Session.user;
