import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { mailTemplates, users } from "../db/schema/index.js";

const LOCALE = "de"; // Mehrsprachigkeit: Backlog 83

export interface TemplateView {
  key: string; category: string; audience: string; prefix: string; editPermissions: string[];
  system: { subject: string; body: string };
  override: { subject: string; body: string; updatedAt: Date; updatedBy: string | null } | null;
}

export async function listTemplates(): Promise<TemplateView[]> {
  const rows = await db.select({ t: mailTemplates, by: users.name }).from(mailTemplates)
    .leftJoin(users, eq(users.id, mailTemplates.updatedBy))
    .where(and(eq(mailTemplates.locale, LOCALE), inArray(mailTemplates.variant, ["system", "override"])));
  return rows.filter((r) => r.t.variant === "system").map(({ t: s }) => {
    const ov = rows.find((r) => r.t.key === s.key && r.t.variant === "override");
    return {
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
