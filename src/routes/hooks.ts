import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { env } from "../env.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { handleZitadelEvent, verifySignature, type ZitadelEvent } from "../lib/zitadel-webhook.js";

export const hookRoutes = new Hono();

// Read per request: the signing key is created after the app has started (see zitadel-init-hooks), so it can't be an env var.
function webhookKey(): string | undefined {
  const file = env.ZITADEL_WEBHOOK_SECRET_FILE;
  if (!file) return undefined;
  try {
    return readFileSync(file, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

// Inactive (404) unless a signing key file is configured and present — other providers / existing installs are unaffected.
hookRoutes.post("/zitadel", async (c) => {
  const key = webhookKey();
  if (!key) return c.notFound();
  const raw = await c.req.text();
  if (!verifySignature(raw, c.req.header("zitadel-signature"), key)) return c.json({ error: "invalid signature" }, HTTP_STATUS.UNAUTHORIZED);
  try {
    return c.json({ result: await handleZitadelEvent(JSON.parse(raw) as ZitadelEvent) });
  } catch (err) {
    console.error("[hooks/zitadel] failed:", err);
    return c.json({ error: "failed" }, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});
