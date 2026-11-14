import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { mailTemplates, users } from "../db/schema/index.js";
import type { CustomMeta } from "../db/schema/mail.js";
import { CATALOG } from "./mail-templates.js";

const LOCALE = "de"; // Mehrsprachigkeit: Backlog 83

export interface TemplateView {
  key: string; category: string; audience: string; prefix: string; editPermissions: string[];
  system: { subject: string; body: string };
  override: { subject: string; body: string; updatedAt: Date; updatedBy: string | null } | null;
  // nur freie Vorlagen (variant = custom): `system` trägt dann deren Betreff/Text
  custom?: { meta: CustomMeta; topic: string; extraHeaders: string; updatedAt: Date; updatedBy: string | null };
}

export async function listTemplates(): Promise<TemplateView[]> {
  const rows = await db.select({ t: mailTemplates, by: users.name }).from(mailTemplates)
    .leftJoin(users, eq(users.id, mailTemplates.updatedBy))
    .where(and(eq(mailTemplates.locale, LOCALE), inArray(mailTemplates.variant, ["system", "override", "custom"])));
  return rows.filter((r) => r.t.variant !== "override").map(({ t: s, by }) => {
    const ov = rows.find((r) => r.t.key === s.key && r.t.variant === "override");
    const custom = s.variant === "custom" ? { meta: s.meta!, topic: s.topic!, extraHeaders: s.extraHeaders ?? "", updatedAt: s.updatedAt, updatedBy: by } : undefined;
    return {
      custom,
      key: s.key, category: s.category!, audience: s.audience!, prefix: s.prefix ?? "", editPermissions: s.editPermissions ?? [],
      system: { subject: s.subject, body: s.body },
      override: ov ? { subject: ov.t.subject, body: ov.t.body, updatedAt: ov.t.updatedAt, updatedBy: ov.by } : null,
    };
  });
}

const isoOrEmpty = (d?: Date) => d?.toISOString() ?? "";

// `expected` = updatedAt der override-Zeile beim Öffnen des Formulars ("" = keine). Abweichung = Parallelbearbeitung.
export async function saveOverride(tpl: TemplateView, input: { subject: string; body: string }, userId: string, expected: string): Promise<"ok" | "conflict"> {
  const where = and(eq(mailTemplates.key, tpl.key), eq(mailTemplates.locale, LOCALE), eq(mailTemplates.variant, "override"));
  const [current] = await db.select({ at: mailTemplates.updatedAt }).from(mailTemplates).where(where);
  if (isoOrEmpty(current?.at) !== expected) return "conflict";
  if (input.subject === tpl.system.subject && input.body === tpl.system.body) { // identisch: Auslieferungszustand, keine Zeile
    if (current) await db.delete(mailTemplates).where(and(where, eq(mailTemplates.updatedAt, current.at)));
    return "ok";
  }
  const values = { ...input, updatedAt: new Date(), updatedBy: userId };
  if (!current) {
    const ins = await db.insert(mailTemplates).values({ key: tpl.key, locale: LOCALE, variant: "override", ...values }).onConflictDoNothing().returning({ k: mailTemplates.key });
    return ins.length ? "ok" : "conflict";
  }
  const upd = await db.update(mailTemplates).set(values).where(and(where, eq(mailTemplates.updatedAt, current.at))).returning({ k: mailTemplates.key });
  return upd.length ? "ok" : "conflict";
}

export async function resetOverride(key: string): Promise<void> {
  await db.delete(mailTemplates).where(and(eq(mailTemplates.key, key), eq(mailTemplates.locale, LOCALE), eq(mailTemplates.variant, "override")));
}

// ---- Freie Vorlagen (variant = custom) --------------------------------------

export interface CustomInput {
  meta: CustomMeta; topic: string; audience: string; editPermissions: string[]; prefix: string; subject: string; body: string; extraHeaders: Record<string, string>;
}
const customWhere = (key: string) => and(eq(mailTemplates.key, key), eq(mailTemplates.locale, LOCALE), eq(mailTemplates.variant, "custom"));
const customValues = (i: CustomInput, userId: string) => ({
  meta: i.meta, topic: i.topic, audience: i.audience, editPermissions: i.editPermissions as never, prefix: i.prefix, subject: i.subject, body: i.body,
  extraHeaders: Object.keys(i.extraHeaders).length ? JSON.stringify(i.extraHeaders) : null, updatedAt: new Date(), updatedBy: userId,
});

// Eindeutigkeit über alle Varianten prüft der Code (Primärschlüssel enthält die Variante). Sperre: Katalog-key, "new".
export async function keyTaken(key: string): Promise<boolean> {
  if (key === "new" || CATALOG[key]) return true;
  const rows = await db.select({ k: mailTemplates.key }).from(mailTemplates).where(eq(mailTemplates.key, key)).limit(1);
  return rows.length > 0;
}

export async function listTopics(): Promise<string[]> {
  const rows = await db.selectDistinct({ t: mailTemplates.topic }).from(mailTemplates);
  return rows.map((r) => r.t).filter((x): x is string => !!x).sort();
}

export async function createCustom(key: string, input: CustomInput, userId: string): Promise<"ok" | "conflict"> {
  if (await keyTaken(key)) return "conflict";
  const ins = await db.insert(mailTemplates).values({ key, locale: LOCALE, variant: "custom", category: "custom", headersMode: "extendable", ...customValues(input, userId) })
    .onConflictDoNothing().returning({ k: mailTemplates.key });
  return ins.length ? "ok" : "conflict";
}

// `expected` = updatedAt beim Öffnen; Abweichung = Parallelbearbeitung.
export async function saveCustom(key: string, input: CustomInput, userId: string, expected: string): Promise<"ok" | "conflict"> {
  const [current] = await db.select({ at: mailTemplates.updatedAt }).from(mailTemplates).where(customWhere(key));
  if (!current || isoOrEmpty(current.at) !== expected) return "conflict";
  const upd = await db.update(mailTemplates).set(customValues(input, userId)).where(and(customWhere(key), eq(mailTemplates.updatedAt, current.at))).returning({ k: mailTemplates.key });
  return upd.length ? "ok" : "conflict";
}

export async function deleteCustom(key: string): Promise<void> {
  await db.delete(mailTemplates).where(customWhere(key)); // mail_log trägt nur den key und bleibt
}
