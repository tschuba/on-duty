import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { accounts, users } from "../db/schema/index.js";
import { getSettings } from "./settings.js";
import { onUserRegistered } from "./registration.js";

// Optional Zitadel Actions v2 webhook (docs/standalone-deployment.md). Creates the on-duty user at registration
// time (emailVerified=false) and flips it to true on the verification event. The login path keeps working without it.
// Signature: header "ZITADEL-Signature: t=<unix>,v1=<hex>", HMAC-SHA256(key, `${t}.${rawBody}`), 300s tolerance.
const TOLERANCE_S = 300;

export function verifySignature(rawBody: string, header: string | undefined, key: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowS - t) > TOLERANCE_S || !parts.v1) return false;
  const expected = createHmac("sha256", key).update(`${t}.${rawBody}`).digest();
  const got = Buffer.from(parts.v1, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export type ZitadelEvent = {
  event_type?: string;
  aggregateType?: string;
  aggregateID?: string;
  userID?: string;
  event_payload?: { email?: string; displayName?: string; userName?: string; firstName?: string; lastName?: string };
};

const PROVIDER_ID = "oidc";

// The Zitadel user id is the OIDC `sub`, which better-auth stores as account.accountId. Binding it here means the first
// login finds this user by identity instead of by email — an unverified address can't be used to take the account over.
export async function handleZitadelEvent(ev: ZitadelEvent): Promise<"created" | "verified" | "ignored"> {
  // aggregateID is the affected user. `userID` is the actor who triggered the event (e.g. the login client or an
  // org admin) — using it would bind every registered user to the same identity.
  const zitadelId = ev.aggregateType === "user" ? ev.aggregateID : undefined;
  if (!zitadelId) return "ignored";

  // Login UI v2 emits "added" for self-registration; the legacy UI emits "selfregistered". "added" also fires for
  // users an org admin creates in Zitadel — those are treated like registrations (same registrationEnabled gate).
  if (ev.event_type === "user.human.added" || ev.event_type === "user.human.selfregistered") {
    const email = ev.event_payload?.email?.trim().toLowerCase();
    if (!email) return "ignored";
    if ((await getSettings()).registrationEnabled !== "true") return "ignored";
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing) return "ignored"; // admin-created user: linked at first login with a verified email, as before
    const name = ev.event_payload?.displayName || [ev.event_payload?.firstName, ev.event_payload?.lastName].filter(Boolean).join(" ") || email;
    const now = new Date();
    const id = crypto.randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id, name, email, emailVerified: false, disabled: false, createdAt: now, updatedAt: now });
      await tx.insert(accounts).values({ id: crypto.randomUUID(), accountId: zitadelId, providerId: PROVIDER_ID, userId: id, createdAt: now, updatedAt: now });
    });
    await onUserRegistered({ id, name, email });
    return "created";
  }

  if (ev.event_type === "user.human.email.verified") {
    const [acc] = await db.select({ userId: accounts.userId }).from(accounts)
      .where(and(eq(accounts.providerId, PROVIDER_ID), eq(accounts.accountId, zitadelId)));
    if (!acc) return "ignored";
    await db.update(users).set({ emailVerified: true, updatedAt: new Date() }).where(eq(users.id, acc.userId));
    return "verified";
  }
  return "ignored";
}
