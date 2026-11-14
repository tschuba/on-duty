import Mustache from "mustache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { mailTemplates } from "../db/schema/index.js";
import { env } from "../env.js";
import { t } from "../i18n/index.js";
import { formatDateTime, formatDay, formatTime, resolveLocale, resolveTimezone, toLocalDate } from "./datetime.js";
import { logger } from "./logger.js";
import { mailLabel } from "./mail-label.js";

// Katalog = einzige Quelle für Variablen, Pflichtplatzhalter und Beispielwerte der Systemvorlagen.
// Neues Systemtemplate / neue Variable: hier pflegen, Migration schreiben, `pnpm mail:docs` ausführen.
export type VarSource = "data" | "person" | "link";
export interface VarSpec { type: "text" | "boolean" | "list"; desc: string; example: string; source: VarSource; optional?: boolean }
export type MailVars = Record<string, unknown>;

export interface EventMailRecord {
  event: { id: string; title: string; startsAt: Date; endsAt: Date; allDay: boolean; location?: string | null; rsvpEnabled: boolean; rsvpDeadline?: Date | null; maxParticipants?: number | null; cancelledAt?: Date | null };
  changes?: string; // nur event-updated, alt → neu
  optOutAllUrl?: string; // nur bei mehreren Mitgliedern
  orgContactEmail?: string;
}
export interface MailRecipient { firstName: string; lastName: string; email: string; optOutUrl?: string; rsvpYesUrl?: string; rsvpNoUrl?: string }

export interface InfoMailRecord { optOutAllUrl?: string; orgContactEmail?: string }
export interface SimpleMailRecord { applicantName?: string; rejoin?: boolean; itemName?: string; requestUrl?: string; statusUrl?: string; userName?: string; userEmail?: string; orgContactEmail?: string }
export interface SettingsMailRecord { settingsUrl: string; validMinutes: number; orgContactEmail?: string }

interface CatalogEntry {
  name: string; description: string; // Klartext für die Oberfläche
  category: "event" | "member" | "membership" | "lend" | "registration";
  audience: "member" | "staff" | "applicant";
  vars: Record<string, VarSpec>;
  required: { name: string; list?: string; label: string }[]; // label: Klartextname für Fehlermeldungen/Checkliste
  // ohne list: Variable auf oberster Ebene
  build: (record: any, recipients: MailRecipient[]) => MailVars;
  previewCases: PreviewCase[]; // Fälle der Editor-Vorschau; Fall 1 = Standard
}
// Fall = Override auf die Beispieldaten; garantiert seine Bedingung (auch den Terminzustand).
export interface PreviewCase { id: string; label: string; people?: number; patch?: (e: EventMailRecord["event"]) => Partial<EventMailRecord["event"]> }

const GLOBAL_VARS: Record<string, VarSpec> = {
  "org.name": { type: "text", desc: "Name der Organisation", example: "Feuerwehr Musterstadt", source: "data" },
  "org.url": { type: "text", desc: "Basis-URL des Portals", example: "https://portal.example.org", source: "data" },
  "org.contactEmail": { type: "text", desc: "Kontaktadresse der Organisation", example: "info@example.org", source: "data", optional: true },
  type: { type: "text", desc: "Typ-Label der Mail", example: "Termin", source: "data" },
  "recipient.name": { type: "text", desc: "Voller Name des Empfängers", example: "Anna Beispiel", source: "person" },
  "recipient.firstName": { type: "text", desc: "Vorname des Empfängers", example: "Anna", source: "person" },
  "recipient.lastName": { type: "text", desc: "Nachname des Empfängers", example: "Beispiel", source: "person" },
  "recipient.email": { type: "text", desc: "Adresse des Empfängers", example: "anna@example.org", source: "person" },
};

const EVENT_VARS: Record<string, VarSpec> = {
  addressee: { type: "text", desc: "Anrede-Namen, kommagetrennt", example: "Anna, Ben", source: "person" },
  multiple: { type: "boolean", desc: "Mehr als ein Mitglied an der Adresse", example: "ja", source: "data" },
  you: { type: "text", desc: "„dich“ / „euch“", example: "dich", source: "data" },
  "event.title": { type: "text", desc: "Titel des Termins", example: "Übung Atemschutz", source: "data" },
  "event.date": { type: "text", desc: "Kurzes Datum, für den Betreff", example: "Sa., 12.04.2026", source: "data" },
  "event.when": { type: "text", desc: "Zeitangabe (ganztägig/mehrtägig berücksichtigt)", example: "Sa., 12.04.2026, 18:00 bis 20:00 Uhr", source: "data" },
  "event.location": { type: "text", desc: "Ort; leer: Sektion entfällt", example: "Gerätehaus", source: "data", optional: true },
  "event.rsvpEnabled": { type: "boolean", desc: "Anmeldung aktiv und Termin nicht abgesagt", example: "ja", source: "data" },
  "event.rsvpDeadline": { type: "text", desc: "Anmeldeschluss", example: "10.04.2026, 18:00", source: "data", optional: true },
  "event.maxParticipants": { type: "text", desc: "Maximale Teilnehmerzahl", example: "20", source: "data", optional: true },
  "event.changes": { type: "text", desc: "Änderungen, alt → neu (nur event-updated)", example: "Ort: Halle → Gerätehaus", source: "data", optional: true },
  "event.url": { type: "text", desc: "Detailseite im Portal", example: "https://portal.example.org/events/1", source: "link" },
  recipients: { type: "list", desc: "Ein Eintrag je Mitglied der Adresse", example: "", source: "data" },
  "recipients[].name": { type: "text", desc: "Name des Mitglieds", example: "Anna Beispiel", source: "person" },
  "recipients[].rsvpYesUrl": { type: "text", desc: "Zusage-Link (nur bei Anmeldung)", example: "https://portal.example.org/r/yes", source: "link", optional: true },
  "recipients[].rsvpNoUrl": { type: "text", desc: "Absage-Link (nur bei Anmeldung)", example: "https://portal.example.org/r/no", source: "link", optional: true },
  "recipients[].optOutUrl": { type: "text", desc: "Abmelde-Link für Termin-Mails (Pflicht)", example: "https://portal.example.org/o/1", source: "link" },
  optOutAllUrl: { type: "text", desc: "Abmelde-Link für alle Mitglieder der Adresse (nur bei mehreren)", example: "https://portal.example.org/o/all", source: "link", optional: true },
};

const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

export function whenText(e: Pick<EventMailRecord["event"], "startsAt" | "endsAt" | "allDay">, tz: string, locale: string): string {
  const sameDay = toLocalDate(e.startsAt, tz) === toLocalDate(e.endsAt, tz);
  const until = t("mail.event.until");
  if (e.allDay) {
    return sameDay
      ? `${formatDay(e.startsAt, tz, locale)}, ${t("mail.event.allDay")}`
      : `${formatDay(e.startsAt, tz, locale)} ${until} ${formatDay(e.endsAt, tz, locale)} (${t("mail.event.allDay")})`;
  }
  return sameDay
    ? `${formatDay(e.startsAt, tz, locale)}, ${formatTime(e.startsAt, tz, locale)} ${until} ${formatTime(e.endsAt, tz, locale)} ${t("mail.event.clock")}`
    : `${formatDateTime(e.startsAt, tz, locale)} ${until} ${formatDateTime(e.endsAt, tz, locale)}`;
}

function buildEventVars(r: EventMailRecord, recipients: MailRecipient[]): MailVars {
  const tz = resolveTimezone(), locale = resolveLocale(recipients[0]);
  const e = r.event, multiple = recipients.length > 1, rsvp = e.rsvpEnabled && !e.cancelledAt;
  return {
    addressee: recipients.map((p) => p.firstName).join(", "),
    multiple,
    you: t(multiple ? "mail.event.you.many" : "mail.event.you.one"),
    event: {
      title: e.title,
      date: formatDay(e.startsAt, tz, locale),
      when: whenText(e, tz, locale),
      location: e.location ?? "",
      rsvpEnabled: rsvp,
      rsvpDeadline: e.rsvpDeadline ? formatDateTime(e.rsvpDeadline, tz, locale) : "",
      maxParticipants: e.maxParticipants != null ? String(e.maxParticipants) : "",
      changes: r.changes ?? "",
      url: `${env.OIDC_APP_URL}/events/${e.id}`,
    },
    recipients: recipients.map((p) => ({
      name: fullName(p),
      ...(rsvp ? { rsvpYesUrl: p.rsvpYesUrl ?? "", rsvpNoUrl: p.rsvpNoUrl ?? "" } : {}),
      optOutUrl: p.optOutUrl,
    })),
    optOutAllUrl: multiple ? (r.optOutAllUrl ?? "") : "",
  };
}

const eventEntry: CatalogEntry = {
  name: "", description: "",
  category: "event",
  audience: "member",
  vars: { ...GLOBAL_VARS, ...EVENT_VARS }, previewCases: [],
  required: [{ name: "optOutUrl", list: "recipients", label: t("mailTemplates.required.optOutUrl") }],
  build: buildEventVars,
};

const settingsEntry: CatalogEntry = {
  name: "", description: "",
  category: "member",
  audience: "member", previewCases: [],
  vars: {
    ...GLOBAL_VARS,
    settingsUrl: { type: "text", desc: "Link zur Einstellungsseite (zeitlich begrenzt)", example: "https://portal.example.org/link/abc", source: "link" },
    validMinutes: { type: "text", desc: "Gültigkeit des Links in Minuten", example: "30", source: "data" },
  },
  required: [{ name: "settingsUrl", label: t("mailTemplates.required.settingsUrl") }],
  build: (r: SettingsMailRecord) => ({ settingsUrl: r.settingsUrl, validMinutes: String(r.validMinutes) }),
};

// Info-Mail zu Termin-Mails: nur Anrede, Mitgliederblöcke und Opt-Out-Links, kein Termin.
const INFO_KEYS = ["addressee", "you", "multiple", "recipients", "recipients[].name", "recipients[].optOutUrl", "optOutAllUrl"];
const infoEntry: CatalogEntry = {
  ...eventEntry,
  vars: { ...GLOBAL_VARS, ...Object.fromEntries(INFO_KEYS.map((k) => [k, EVENT_VARS[k]])) },
  build: (r: InfoMailRecord, recipients: MailRecipient[]) => ({
    addressee: recipients.map((p) => p.firstName).join(", "),
    multiple: recipients.length > 1,
    you: t(recipients.length > 1 ? "mail.event.you.many" : "mail.event.you.one"),
    recipients: recipients.map((p) => ({ name: fullName(p), optOutUrl: p.optOutUrl })),
    optOutAllUrl: recipients.length > 1 ? (r.optOutAllUrl ?? "") : "",
  }),
};

// Mails an bestehende Abläufe (Antrag, Verleih, Registrierung): ein Empfänger, Verwalter-Mails ohne Personenvariablen.
const STAFF_GLOBAL = Object.fromEntries(Object.entries(GLOBAL_VARS).filter(([k]) => !k.startsWith("recipient.")));
const V = (desc: string, example: string, source: VarSource): VarSpec => ({ type: "text", desc, example, source });
const simple = (category: CatalogEntry["category"], audience: CatalogEntry["audience"], vars: Record<string, VarSpec>, build: (r: SimpleMailRecord) => MailVars): CatalogEntry =>
  ({ name: "", description: "", previewCases: [], category, audience, vars: { ...(audience === "staff" ? STAFF_GLOBAL : GLOBAL_VARS), ...vars }, required: [], build });
const lendApplicant = simple("lend", "applicant", {
  "item.name": V("Name des Gegenstands", "Zelt", "data"),
  "request.statusUrl": V("Statusseite der Anfrage", "https://portal.example.org/lend/status/abc", "link"),
}, (r) => ({ item: { name: r.itemName }, request: { statusUrl: r.statusUrl } }));

const C = (id: string, label: string, o: Partial<PreviewCase> = {}): PreviewCase => ({ id, label: t(`mailTemplates.case.${label}` as never), ...o });
const eventCases = (state: Partial<EventMailRecord["event"]>): PreviewCase[] => [
  C("default", "default", { patch: () => ({ ...state, location: "Gerätehaus", rsvpEnabled: true }) }),
  C("noLocation", "noLocation", { patch: () => ({ ...state, location: "", rsvpEnabled: true }) }),
  C("noRsvp", "noRsvp", { patch: () => ({ ...state, location: "Gerätehaus", rsvpEnabled: false }) }),
  C("multiple", "multiple", { people: 2, patch: () => ({ ...state, location: "Gerätehaus", rsvpEnabled: true }) }),
];
const CASES: Record<string, PreviewCase[]> = {
  "event-created": eventCases({ cancelledAt: null }),
  "event-updated": eventCases({ cancelledAt: null }),
  "event-cancelled": eventCases({ cancelledAt: new Date("2026-04-01T08:00:00Z") }).filter((c) => c.id !== "noRsvp"),
  "event-uncancelled": eventCases({ cancelledAt: null }),
  "event-mail-info": [C("default", "default"), C("multiple", "multiple", { people: 2 })],
};
const named = (key: string, e: CatalogEntry): CatalogEntry => ({
  ...e, name: t(`mailTemplates.name.${key}` as never), description: t(`mailTemplates.desc.${key}` as never),
  previewCases: CASES[key] ?? [{ id: "default", label: t("mailTemplates.preview") }],
});
export const CATALOG: Record<string, CatalogEntry> = Object.fromEntries(Object.entries({
  "event-created": eventEntry,
  "event-updated": eventEntry,
  "event-cancelled": eventEntry,
  "event-uncancelled": eventEntry,
  "event-mail-info": infoEntry,
  "member-settings-link": settingsEntry,
  "application-submitted": simple("membership", "staff", { "applicant.name": V("Name des Antragstellers", "Anna Beispiel", "person") }, (r) => ({ applicant: { name: r.applicantName } })),
  "application-approved": simple("membership", "applicant", { rejoin: { type: "boolean", desc: "Wieder Mitglied nach Austritt", example: "ja", source: "data" } }, (r) => ({ rejoin: !!r.rejoin })),
  "application-rejected": simple("membership", "applicant", {}, () => ({})),
  "lend-notify": simple("lend", "staff", {
    "item.name": V("Name des Gegenstands", "Zelt", "data"),
    "request.url": V("Anfrage in der Verwaltung", "https://portal.example.org/inventory/requests/1", "link"),
  }, (r) => ({ item: { name: r.itemName }, request: { url: r.requestUrl } })),
  "lend-submitted": lendApplicant,
  "lend-approved": lendApplicant,
  "lend-rejected": lendApplicant,
  "registration-pending": simple("registration", "staff", {
    "user.name": V("Name des Benutzers", "Anna Beispiel", "person"),
    "user.email": V("Adresse des Benutzers", "anna@example.org", "person"),
    "admin.url": V("Benutzerverwaltung", "https://portal.example.org/admin/users", "link"),
  }, (r) => ({ user: { name: r.userName, email: r.userEmail }, admin: { url: `${env.OIDC_APP_URL}/admin/users` } })),
}).map(([k, e]) => [k, named(k, e)]));

// Einziger Einstieg für Versand und Editor-Vorschau: ergänzt die globalen Variablen.
export function buildVars(key: string, record: EventMailRecord | SettingsMailRecord | InfoMailRecord | SimpleMailRecord, recipients: MailRecipient[]): MailVars {
  const entry = CATALOG[key];
  if (!entry) throw new Error(`unknown mail template key: ${key}`);
  const first = recipients[0];
  return {
    ...entry.build(record, recipients),
    org: { name: env.ORG_NAME, url: env.OIDC_APP_URL, contactEmail: (record as SimpleMailRecord).orgContactEmail ?? "" },
    type: t(`mail.type.${entry.category}`),
    recipient: first ? { name: fullName(first), firstName: first.firstName, lastName: first.lastName, email: first.email } : {},
  };
}

// ---- Beispieldaten für die Vorschau (nie Echtdaten) ------------------------

const PH = (p: string) => `https://portal.example.org/${p}/VORSCHAU`; // erkennbarer Platzhalter-Link
const SAMPLE_PEOPLE: MailRecipient[] = [
  { firstName: "Anna", lastName: "Beispiel", email: "anna@example.org", optOutUrl: PH("optout"), rsvpYesUrl: PH("rsvp-ja"), rsvpNoUrl: PH("rsvp-nein") },
  { firstName: "Ben", lastName: "Beispiel", email: "ben@example.org", optOutUrl: PH("optout"), rsvpYesUrl: PH("rsvp-ja"), rsvpNoUrl: PH("rsvp-nein") },
];
const SAMPLE_RECORD = {
  event: { id: "VORSCHAU", title: "Übung Atemschutz", startsAt: new Date("2026-04-12T16:00:00Z"), endsAt: new Date("2026-04-12T18:00:00Z"), allDay: false, location: "Gerätehaus", rsvpEnabled: true, rsvpDeadline: null, maxParticipants: 20, cancelledAt: null },
  changes: "Ort: Halle → Gerätehaus", optOutAllUrl: PH("optout-alle"), orgContactEmail: "info@example.org",
  settingsUrl: PH("link"), validMinutes: 30,
  applicantName: "Anna Beispiel", rejoin: false, itemName: "Zelt", requestUrl: PH("anfrage"),
  statusUrl: PH("status"), userName: "Anna Beispiel", userEmail: "anna@example.org",
};

// Einziger Einstieg der Vorschau: Beispieldaten des Falls (unbekannte Fall-ID = Standard), keine Fachdaten.
export function previewVars(key: string, caseId?: string): MailVars {
  const cases = CATALOG[key].previewCases;
  const c = cases.find((x) => x.id === caseId) ?? cases[0];
  const record = { ...SAMPLE_RECORD, event: { ...SAMPLE_RECORD.event, ...c.patch?.(SAMPLE_RECORD.event) } };
  return buildVars(key, record, SAMPLE_PEOPLE.slice(0, c.people ?? 1));
}

// ---- Validierung ----------------------------------------------------------

type Token = [string, string, number, number, Token[]?];
export interface TemplateInput { prefix?: string | null; subject: string; body: string }

const lineOf = (text: string, idx: number) => text.slice(0, idx).split("\n").length;
const distance = (a: string, b: string) => {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
};
// Tippfehler-Vorschlag: nächster Katalogname bis Abstand 3.
function suggest(entry: CatalogEntry, name: string): string | undefined {
  const best = Object.keys(entry.vars).filter((k) => !k.includes("[]")).map((k) => [k, distance(k, name)] as const).sort((a, b) => a[1] - b[1])[0];
  return best && best[1] <= 3 ? best[0] : undefined;
}

export function validateTemplate(key: string, input: TemplateInput): string[] {
  const entry = CATALOG[key]; // kein Eintrag = freie Vorlage: unbekannte Variablen erlaubt (werden Felder)
  const errors: string[] = [];
  const seen = new Set<string>();
  const isRoot = (n: string) => !!entry?.vars[n] && !n.includes("[]");
  const walk = (tokens: Token[], list: string | null, field: string, text: string) => {
    for (const tok of tokens) {
      const [type, name] = tok;
      if (type === ">") { errors.push(`${field}: Partials sind nicht erlaubt`); continue; }
      if (!["name", "&", "#", "^"].includes(type)) continue;
      const inList = list && entry?.vars[`${list}[].${name}`];
      if (inList) seen.add(`${list}[].${name}`);
      else if (entry && name !== "." && !isRoot(name)) {
        const hint = suggest(entry, name);
        errors.push(`${field}: Zeile ${lineOf(text, tok[2])}: unbekannte Variable „${name}“${hint ? `. Meintest du „${hint}“?` : ""}`);
      }
      else seen.add(name);
      if (type === "#" || type === "^") walk(tok[4] ?? [], entry?.vars[name]?.type === "list" ? name : list, field, text);
    }
  };
  for (const [field, text] of [["prefix", input.prefix ?? ""], ["subject", input.subject], ["body", input.body]] as const) {
    try { walk(Mustache.parse(text) as Token[], null, field, text); } catch (err) {
      const m = /^(.*) at (\d+)$/.exec((err as Error).message);
      const unclosed = m && /^Unclosed section "(.*)"$/.exec(m[1]);
      errors.push(`${field}: ${m ? `Zeile ${lineOf(text, Number(m[2]))}: ${unclosed ? `Block „${unclosed[1]}“ ist nicht geschlossen` : m[1]}` : (err as Error).message}`);
    }
  }
  for (const r of entry?.required ?? []) {
    if (!seen.has(r.list ? `${r.list}[].${r.name}` : r.name)) errors.push(`Pflichtplatzhalter „${r.label}“ fehlt${r.list ? ` (innerhalb von „${r.list}“)` : ""}`);
  }
  return errors;
}

// ---- Auflösen und Rendern -------------------------------------------------

export interface ResolvedTemplate {
  key: string; locale: string; category: string; audience: string; topic: string | null;
  prefix: string; subject: string; body: string; headersMode: "fixed" | "extendable"; extraHeaders: string | null;
}

// override vor system; ungültige override-Zeile → system + Log; ungültige system-Zeile → null (kein Versand).
// Pro Versand einmal aufrufen und das Ergebnis für alle Empfänger verwenden.
export async function resolveTemplate(key: string, locale = resolveLocale()): Promise<ResolvedTemplate | null> {
  const locales = [...new Set([locale, "de"])];
  const rows = await db.select().from(mailTemplates).where(and(eq(mailTemplates.key, key), inArray(mailTemplates.locale, locales)));
  for (const loc of locales) {
    const sys = rows.find((r) => r.locale === loc && r.variant !== "override");
    if (!sys) continue;
    const base = { key, locale: loc, category: sys.category!, audience: sys.audience!, topic: sys.topic, prefix: sys.prefix ?? "", headersMode: sys.headersMode!, extraHeaders: sys.extraHeaders };
    const ov = rows.find((r) => r.locale === loc && r.variant === "override");
    if (ov) {
      const errors = validateTemplate(key, { prefix: base.prefix, subject: ov.subject, body: ov.body });
      if (!errors.length) return { ...base, subject: ov.subject, body: ov.body };
      logger.warn({ key, locale: loc, errors }, "[mail] invalid override template, falling back to system row");
    }
    const errors = validateTemplate(key, { prefix: base.prefix, subject: sys.subject, body: sys.body });
    if (errors.length) {
      logger.error({ key, locale: loc, errors }, "[mail] invalid system template, mail not sent");
      return null;
    }
    return { ...base, subject: sys.subject, body: sys.body };
  }
  logger.error({ key }, "[mail] no template row found, mail not sent");
  return null;
}

const plain = { escape: (v: unknown) => String(v) }; // Reintext: kein HTML-Escaping
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim(); // Header-Injection

export function renderMail(row: Pick<ResolvedTemplate, "prefix" | "subject" | "body">, vars: MailVars): { subject: string; text: string } {
  const org = { ...((vars.org as object) ?? {}), name: mailLabel(env.ORG_NAME) }; // Präfix wie bisher bereinigt
  const prefix = oneLine(Mustache.render(row.prefix, { ...vars, org }, {}, plain));
  const subject = oneLine(Mustache.render(row.subject, vars, {}, plain));
  return { subject: prefix ? `${prefix} ${subject}` : subject, text: Mustache.render(row.body, vars, {}, plain) };
}

// Recht je Vorlage: system:admin immer, sonst eines aus editPermissions der system-Zeile.
export const mayEdit = (user: { permissions: Set<string> }, editPermissions: string[] | null | undefined) =>
  user.permissions.has("system:admin") || !!editPermissions?.some((p) => user.permissions.has(p));

export async function canEdit(user: { permissions: Set<string> }, key: string): Promise<boolean> {
  const [row] = await db.select({ p: mailTemplates.editPermissions }).from(mailTemplates)
    .where(and(eq(mailTemplates.key, key), eq(mailTemplates.locale, "de"), eq(mailTemplates.variant, "system")));
  return mayEdit(user, row?.p);
}

// ---- Doku-Generat (pnpm mail:docs) ----------------------------------------

export function catalogDocs(): string {
  const cell = (s: string) => s.replace(/[\\|]/g, "\\$&");
  const table = (vars: Record<string, VarSpec>) =>
    ["| Variable | Typ | Quelle | Beschreibung | Beispiel |", "|---|---|---|---|---|",
      ...Object.entries(vars).map(([k, v]) => `| \`${k}\` | ${v.type}${v.optional ? ", optional" : ""} | ${v.source} | ${cell(v.desc)} | ${cell(v.example)} |`)].join("\n");
  const out = ["<!-- Generiert mit `pnpm mail:docs` aus src/lib/mail-templates.ts – nicht von Hand ändern. -->", "", "# Mail-Variablen", ""];
  for (const [key, e] of Object.entries(CATALOG)) {
    out.push(`## \`${key}\``, "", `Kategorie \`${e.category}\`, Audience \`${e.audience}\`. Pflichtplatzhalter: ${e.required.map((r) => `\`${r.name}\`${r.list ? ` in \`${r.list}\`` : ""}`).join(", ") || "keine"}.`, "", table(e.vars), "");
  }
  return out.join("\n");
}

export const exampleVars = (key: string) => {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(CATALOG[key].vars)) flat[k] = v.example;
  return flat;
};
