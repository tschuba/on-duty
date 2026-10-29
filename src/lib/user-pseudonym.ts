import { createHmac } from "node:crypto";

// Stable 16-hex pseudonym of a user id; key = BETTER_AUTH_SECRET (rotating it changes all pseudonyms).
export function userPseudonym(userId: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(userId).digest("hex").slice(0, 16);
}
