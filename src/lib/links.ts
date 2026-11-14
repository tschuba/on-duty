import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

// Signierte Links ohne Login (Backlog 149). Token = base64url(JSON-Payload) "." base64url(HMAC-SHA256). Keine DB, die Adresse steht nie im Token.
// Payload { v: 1, p: <Zweck>, m: memberId, … }; Zusatzfelder legt allein der Zweck fest (LINK_PURPOSES).
export interface LinkPayload { v: 1; p: string; m: string; e?: string; t?: string; exp?: number }

// Pflichtfelder je Zweck; unbekannter Zweck → Verifikation schlägt fehl (Fehlerseite).
export const LINK_PURPOSES = {
  "event.rsvp-yes": ["e"],
  "event.rsvp-no": ["e"],
  "mail.optout": ["t"],
  "mail.optout-address": ["t"],
  "member.settings": [],
} as const satisfies Record<string, readonly (keyof LinkPayload)[]>;
export type LinkPurpose = keyof typeof LINK_PURPOSES;

const mac = (data: string) => createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(data).digest();

export function signLinkToken(payload: Omit<LinkPayload, "v">): string {
  const body = Buffer.from(JSON.stringify({ v: 1, ...payload })).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

// Kurzlebiger Einstellungslink (Backlog 151); Ablauf prüft die Route, damit sie eine eigene Seite zeigen kann.
export const SETTINGS_LINK_MINUTES = 30;
export const isExpired = (p: LinkPayload) => p.exp !== undefined && p.exp < Date.now();

export function linkUrl(payload: Omit<LinkPayload, "v">): string {
  return `${env.OIDC_APP_URL}/link/${signLinkToken(payload)}`;
}

export function verifyLinkToken(token: string): LinkPayload | null {
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length) return null;
  const expected = mac(body), given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as LinkPayload;
    const required = (LINK_PURPOSES as Record<string, readonly string[]>)[p.p];
    if (p.v !== 1 || !required || typeof p.m !== "string" || required.some((f) => typeof (p as any)[f] !== "string")) return null;
    if (p.p === "member.settings" && typeof p.exp !== "number") return null;
    return p;
  } catch {
    return null;
  }
}
