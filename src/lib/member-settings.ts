import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { mailLog, members, persons } from "../db/schema/index.js";
import { linkUrl, SETTINGS_LINK_MINUTES } from "./links.js";
import { sendMail } from "./mail.js";
import { buildVars, resolveTemplate } from "./mail-templates.js";
import { logger } from "./logger.js";
import { isOptedOut, setEventMailsEnabled } from "./event-mail.js";

export interface SettingsPerson { memberId: string; personId: string; firstName: string; lastName: string }

// Aktive Personen mit derselben Adresse wie das Mitglied `memberId`, serverseitig aufgelöst (Adresse steht nie im Token).
export async function personsAtAddress(email: string): Promise<SettingsPerson[]> {
  const e = email.trim().toLowerCase();
  if (!e) return [];
  const rows = await db.select({ memberId: members.id, personId: persons.id, firstName: persons.firstName, lastName: persons.lastName })
    .from(members).innerJoin(persons, eq(persons.id, members.personId))
    .where(and(sql`lower(trim(${persons.email})) = ${e}`, isNull(members.exitDate), isNull(members.deathDate)));
  return [...new Map(rows.map((r) => [r.personId, r])).values()];
}

export async function personsForMember(memberId: string): Promise<SettingsPerson[]> {
  const [me] = await db.select({ email: persons.email }).from(members).innerJoin(persons, eq(persons.id, members.personId)).where(eq(members.id, memberId));
  return personsAtAddress(me?.email ?? "");
}

// Unbekannte Adresse: kein Versand, kein Fehler. Der Aufrufer ruft das nach der Antwort auf (Antwortzeit verrät nichts).
export async function sendSettingsLink(email: string): Promise<void> {
  const people = await personsAtAddress(email);
  if (!people.length) return;
  const tpl = await resolveTemplate("member-settings-link");
  if (!tpl) return;
  const settingsUrl = linkUrl({ p: "member.settings", m: people[0].memberId, exp: Date.now() + SETTINGS_LINK_MINUTES * 60_000 });
  let sent = false;
  try {
    ({ sent } = await sendMail({ key: "member-settings-link", to: email.trim(), vars: buildVars("member-settings-link", { settingsUrl, validMinutes: SETTINGS_LINK_MINUTES }, []), template: tpl }));
  } catch (err) {
    logger.error({ err }, "[member-settings] send failed");
  }
  try {
    await db.insert(mailLog).values(people.map((p) => ({ personId: p.personId, template: "member-settings-link", status: sent ? "sent" as const : "failed" as const })));
  } catch (err) {
    logger.error({ err }, "[member-settings] mail_log insert failed");
  }
}

export async function loadSettings(memberId: string): Promise<(SettingsPerson & { events: boolean })[]> {
  const people = await personsForMember(memberId);
  return Promise.all(people.map(async (p) => ({ ...p, events: !(await isOptedOut(p.personId)) })));
}

// Nur Personen dieser Adresse sind änderbar; fehlende Checkbox = ausgeschaltet.
export async function saveSettings(memberId: string, enabledPersonIds: string[]): Promise<void> {
  for (const p of await personsForMember(memberId)) await setEventMailsEnabled(p.personId, enabledPersonIds.includes(p.personId), "settings");
}
