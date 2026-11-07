import { env } from "../env.js";
import { logger } from "./logger.js";

export type CapResult = "ok" | "invalid" | "unavailable";

export const capEnabled = () => Boolean(env.CAP_API_ENDPOINT && env.CAP_SECRET);

// Ohne Konfiguration ist der Schutz aus (Dev, Tests). Sonst fail closed: fehlendes Token → invalid, Cap-Server weg → unavailable.
export async function verifyCap(token: unknown): Promise<CapResult> {
  if (!capEnabled()) return "ok";
  if (typeof token !== "string" || !token) return "invalid";
  try {
    const res = await fetch(`${env.CAP_API_ENDPOINT!.replace(/\/?$/, "/")}siteverify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.CAP_SECRET, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      // 4xx = Token abgelehnt; 5xx = Server-Problem
      if (res.status >= 500) throw new Error(`siteverify HTTP ${res.status}`);
      return "invalid";
    }
    return (await res.json() as { success?: boolean }).success ? "ok" : "invalid";
  } catch (err) {
    logger.error({ err }, "Cap siteverify failed");
    return "unavailable";
  }
}
