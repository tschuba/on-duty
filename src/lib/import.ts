import * as XLSX from "xlsx";
import { env } from "../env.js";
import { t } from "../i18n/index.js";
import { ageInYears } from "./status.js";
import { isValidIban, normalizeIban } from "./iban.js";
import type { InventoryCategory } from "./inventory.js";
import { parseTags } from "./forms.js";

// Reine Import-Logik für fwportal-xlsx-Exporte (Mitglieder- und Inventarliste). Kein DB-Zugriff.

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ACTIVE_ROLE_ID = "f2dd276b-027b-4b82-8313-918bc4f9d5c5";
export const ASSUMED_NOTE = "Beginn angenommen (Import)";

export class ImportError extends Error {}

type Raw = Record<string, unknown>;
export type ImportKind = "members" | "inventory";

const MEMBER_COLUMNS = [
  "mID", "Name", "Vorname", "Status", "Geschlecht", "Geburtstag", "Eintritt", "Eintritt (erste FW)", "Verstorben am",
  "Strasse", "Nr.", "PLZ", "Ort", "Dienstgrad", "Datum Beförderung", "Funktionen", "Telefon", "Mobil", "e-Mail",
  "Kontonummer / IBAN", "BLZ / BIC",
];
const INVENTORY_COLUMNS = [
  "InventarID", "Inventartyp (Voll)", "Bezeichnung", "Inventarnr.", "Seriennr.", "Indienststellung", "Kaufpreis",
  "Ausgemustert am", "Standort (komplett)",
];
// Spalten, die bewusst nie gemeldet werden (konstant / ohne Aussage).
const MEMBER_IGNORED = new Set(["Gemeinde", "Dienststelle", "Alter", "Latitude (Mitglied)", "Longitude (Mitglied)", "Arbeitgeber: Latitude", "Arbeitgeber: Longitude"]);
const INVENTORY_IGNORED = new Set(["Dienststelle (Inventar)", "Dienststelle (Standort)", "Datentyp", "Status"]);
const NO_VALUE = new Set(["", "0", "nein", "keine Angabe", "nicht gepflegt", "Standard"]);

/** Prüft Größe und ZIP-Header (xlsx = ZIP), nicht nur die Endung. */
export function checkUpload(name: string, buf: Buffer): void {
  if (!/\.xlsx$/i.test(name)) throw new ImportError(t("import.error.notXlsx"));
  if (buf.length > MAX_UPLOAD_BYTES) throw new ImportError(t("import.error.tooLarge"));
  if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new ImportError(t("import.error.notZip"));
}

/** Liest das erste Blatt; Kopfzeile = erste Zeile mit `mID` bzw. `InventarID`. */
export function readWorkbook(buf: Buffer): { kind: ImportKind; headers: string[]; rows: Raw[] } {
  let aoa: unknown[][];
  try {
    const wb = XLSX.read(buf, { type: "buffer" });
    aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  } catch {
    throw new ImportError(t("import.error.unreadable"));
  }
  const headIdx = aoa.findIndex((r) => r.includes("mID") || r.includes("InventarID"));
  if (headIdx < 0) throw new ImportError(t("import.error.noHeader"));
  const headers = aoa[headIdx].map((h) => (h == null ? "" : String(h).trim()));
  const kind: ImportKind = headers.includes("mID") ? "members" : "inventory";
  const missing = (kind === "members" ? MEMBER_COLUMNS : INVENTORY_COLUMNS).filter((c) => !headers.includes(c));
  if (missing.length) throw new ImportError(t("import.error.missingColumns", { columns: missing.join(", ") }));
  const idCol = kind === "members" ? "mID" : "InventarID";
  const rows = aoa
    .slice(headIdx + 1)
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? null])) as Raw)
    // Summenzeilen („Anzahl:“, „Durchschnittsalter:“) haben keine numerische ID.
    .filter((r) => typeof r[idCol] === "number");
  return { kind, headers, rows };
}

// ── Normalisierung ──────────────────────────────────────────────────────────

export function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").trim();
  return s || null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Excel-Seriennummer, ISO- oder dd.mm.yyyy-String → YYYY-MM-DD. */
export function toIsoDate(v: unknown): string | null {
  if (typeof v === "number") {
    // Excel-Epoche 1899-12-30 (korrekt für Seriennummern ab 61, also alle realen Datumswerte).
    if (!(v >= 61)) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = clean(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : null;
}

/** Komma-getrennte Nummern: Steuerzeichen raus, Duplikate raus, mit „, “ verbinden. */
export function cleanPhones(v: unknown): string | null {
  const parts = String(v ?? "").split(",").map((s) => clean(s)).filter((s): s is string => !!s);
  return parts.length ? [...new Set(parts)].join(", ") : null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
// Geschlechtsneutral vergleichen: "Feuerwehrfrau" und "Feuerwehrmann/-frau" → "feuerwehrmann".
const normRole = (s: string) => norm(s).replace(/\/-(frau|in)$/, "").replace(/frau/g, "mann");

// ── Mitglieder ──────────────────────────────────────────────────────────────

export type ParsedMember = {
  mid: number;
  lastName: string | null;
  firstName: string | null;
  street: string | null;
  houseNumber: string | null;
  zip: string | null;
  city: string | null;
  gender: "male" | "female" | null;
  birthDate: string | null;
  entryDate: string | null;
  firstEntryDate: string | null;
  deathDate: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  active: boolean;
  functions: string[];
  rank: string | null;
  rankDate: string | null;
  iban: string | null;
  bic: string | null;
};

export function parseMembers(rows: Raw[]): ParsedMember[] {
  return rows.map((r) => {
    const entryDate = toIsoDate(r["Eintritt"]);
    const first = toIsoDate(r["Eintritt (erste FW)"]);
    const g = clean(r["Geschlecht"]);
    const rank = clean(r["Dienstgrad"]);
    return {
      mid: r["mID"] as number,
      lastName: clean(r["Name"]),
      firstName: clean(r["Vorname"]),
      street: clean(r["Strasse"]),
      houseNumber: clean(r["Nr."]),
      zip: clean(r["PLZ"]),
      city: clean(r["Ort"]),
      gender: g === "männlich" ? "male" : g === "weiblich" ? "female" : null,
      birthDate: toIsoDate(r["Geburtstag"]),
      entryDate,
      firstEntryDate: first && first !== entryDate ? first : null,
      deathDate: toIsoDate(r["Verstorben am"]),
      phone: cleanPhones(r["Telefon"]),
      mobile: cleanPhones(r["Mobil"]),
      email: clean(r["e-Mail"])?.toLowerCase() ?? null,
      active: clean(r["Status"]) === "Aktiv",
      functions: [...new Set(String(r["Funktionen"] ?? "").split(/[,;]/).map((s) => clean(s)).filter((s): s is string => !!s))],
      rank: rank && rank !== "nicht gepflegt" ? rank : null,
      rankDate: toIsoDate(r["Datum Beförderung"]),
      iban: clean(r["Kontonummer / IBAN"]),
      bic: clean(r["BLZ / BIC"]),
    };
  });
}

/** Gefüllte Spalten ohne Zielfeld → für den Ergebnisbericht. */
export function unmappedColumns(kind: ImportKind, headers: string[], rows: Raw[]): { column: string; count: number }[] {
  const mapped = new Set(kind === "members" ? MEMBER_COLUMNS : INVENTORY_COLUMNS);
  const ignored = kind === "members" ? MEMBER_IGNORED : INVENTORY_IGNORED;
  return headers
    .filter((h) => h && !mapped.has(h) && !ignored.has(h))
    .map((column) => ({ column, count: rows.filter((r) => !NO_VALUE.has(clean(r[column]) ?? "")).length }))
    .filter((c) => c.count > 0);
}

// Synonyme fwportal-Titel → on-duty-Rollentitel (+ Freitext an der Zuweisung).
type Synonym = { role: string; note: string | null; fallback?: { role: string; note: string | null } };
export const ROLE_SYNONYMS: Record<string, Synonym> = {
  "1. kommandant": { role: "1. Kommandant", note: null, fallback: { role: "Kommandant", note: "1." } },
  "stellvertretender kommandant": { role: "2. Kommandant", note: null, fallback: { role: "Kommandant", note: "2. (Stellvertreter)" } },
  "1. vorsitzender": { role: "1. Vorstand", note: null, fallback: { role: "Vorstand", note: "1. Vorsitzender" } },
  "stellvertretende vorsitzende": { role: "2. Vorstand", note: null, fallback: { role: "Vorstand", note: "2. Vorsitzende" } },
  "schriftführerin": { role: "Schriftführer/-in", note: null },
};

export type RoleOption = { id: string; title: string; grantsActiveStatus: boolean };
export type RoleChoice = { kind: "role"; roleId: string } | { kind: "new" };

export function suggestRole(title: string, roles: RoleOption[]): { choice: RoleChoice; note: string | null } {
  const syn = ROLE_SYNONYMS[title.toLowerCase().trim()];
  const find = (name: string) => roles.find((r) => normRole(r.title) === normRole(name));
  const bySyn = syn && find(syn.role);
  if (bySyn) return { choice: { kind: "role", roleId: bySyn.id }, note: syn.note };
  const byFallback = syn?.fallback && find(syn.fallback.role);
  if (byFallback) return { choice: { kind: "role", roleId: byFallback.id }, note: syn.fallback!.note };
  const same = roles.find((r) => normRole(r.title) === normRole(title));
  return { choice: same ? { kind: "role", roleId: same.id } : { kind: "new" }, note: null };
}

export type TitleDecision = { title: string; kind: "function" | "rank"; count: number; choice: RoleChoice; ignored: boolean; grants: boolean };
const sameChoice = (a: RoleChoice, b: RoleChoice) => a.kind === b.kind && (a.kind !== "role" || a.roleId === (b as { roleId: string }).roleId);
export type PlannedAssignment = {
  key: string; title: string; kind: "function" | "rank"; roleChoice: RoleChoice; grants: boolean;
  from: string; note: string | null; assumed: boolean; skipped: boolean; suggested: boolean;
};
export type MemberRowPlan = {
  m: ParsedMember; included: boolean; duplicate: boolean; errors: string[]; warnings: string[];
  assignments: PlannedAssignment[];
};
export type MemberPlan = { rows: MemberRowPlan[]; titles: TitleDecision[]; blockers: number; assumedCount: number };

type Body = Record<string, string | string[] | File | undefined>;
const str = (b: Body, k: string): string | undefined => {
  const v = b[k];
  return typeof v === "string" ? v : undefined;
};

export const memberKey = (m: Pick<ParsedMember, "lastName" | "firstName" | "birthDate">) =>
  `${norm(m.lastName ?? "")}|${norm(m.firstName ?? "")}|${m.birthDate ?? ""}`;

/** Baut aus Rohdaten + Admin-Eingaben (Formular) den Importplan. `body` leer = Erstvorschau. */
export function planMembers(
  parsed: ParsedMember[], roles: RoleOption[], existingKeys: Set<string>, body: Body, today: string,
): MemberPlan {
  const posted = str(body, "_seen") === "1";
  const includedSet = new Set([body.inc].flat().filter((x): x is string => typeof x === "string"));

  // Distinkte fwportal-Titel (Funktion/Dienstgrad) → eine Entscheidung pro Titel.
  const seen = new Map<string, { kind: "function" | "rank"; count: number }>();
  for (const m of parsed) {
    for (const f of m.functions) seen.set(f, { kind: "function", count: (seen.get(f)?.count ?? 0) + 1 });
    if (m.rank) seen.set(m.rank, { kind: seen.get(m.rank)?.kind ?? "rank", count: (seen.get(m.rank)?.count ?? 0) + 1 });
  }
  const titles: TitleDecision[] = [...seen.entries()]
    .sort((a, b) => a[1].kind.localeCompare(b[1].kind) || a[0].localeCompare(b[0]))
    .map(([title, { kind, count }], i) => {
      const sel = str(body, `map_${i}`);
      const suggestion = suggestRole(title, roles).choice;
      const choice: RoleChoice = !sel ? suggestion : sel === "new" ? { kind: "new" } : { kind: "role", roleId: sel };
      const grants = posted ? str(body, `grants_${i}`) === "1" : kind === "rank";
      return { title, kind, count, choice, ignored: str(body, `ign_${i}`) === "1", grants };
    });
  const decision = new Map(titles.map((d) => [d.title, d]));

  const rows: MemberRowPlan[] = parsed.map((orig) => {
    const m = { ...orig };
    m.birthDate = m.birthDate ?? toIsoDate(str(body, `birth_${m.mid}`));
    m.entryDate = m.entryDate ?? toIsoDate(str(body, `entry_${m.mid}`));
    const duplicate = existingKeys.has(memberKey(m));
    const included = !duplicate && (posted ? includedSet.has(String(m.mid)) : true);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!m.lastName || !m.firstName) errors.push(t("import.row.nameMissing"));
    if (!m.birthDate) errors.push(t("import.row.birthMissing"));
    if (!m.entryDate) errors.push(t("import.row.entryMissing"));
    if (m.iban && !isValidIban(m.iban)) errors.push(t("import.row.ibanInvalid"));

    const assignments: PlannedAssignment[] = [];
    if (!m.deathDate && m.entryDate) {
      const wanted = [...m.functions.map((title) => ({ title, kind: "function" as const })), ...(m.rank ? [{ title: m.rank, kind: "rank" as const }] : [])];
      wanted.forEach(({ title, kind }, k) => {
        const d = decision.get(title)!;
        if (d.ignored) return;
        const rankDate = kind === "rank" ? m.rankDate : null;
        const defaultFrom = kind === "function" ? today : (rankDate ?? m.entryDate!);
        const from = toIsoDate(str(body, `from_${m.mid}_${k}`)) ?? defaultFrom;
        const noteIn = str(body, `note_${m.mid}_${k}`);
        const note = noteIn !== undefined ? clean(noteIn)?.slice(0, 200) ?? null : suggestRole(title, roles).note;
        // Pro Zuweisung überschreibbar: andere Rolle (oder „neu“) bzw. diese Zuweisung auslassen.
        const rolePick = str(body, `arole_${m.mid}_${k}`);
        const roleChoice: RoleChoice = !rolePick ? d.choice : rolePick === "new" ? { kind: "new" } : { kind: "role", roleId: rolePick };
        const skipped = str(body, `askip_${m.mid}_${k}`) === "1";
        const grants = roleChoice.kind === "role" ? !!roles.find((r) => r.id === roleChoice.roleId)?.grantsActiveStatus : d.grants;
        if (!skipped && !m.active && grants && !(m.birthDate && ageInYears(m.birthDate) >= env.ACTIVE_AGE_LIMIT)) warnings.push(t("import.row.activeWarning", { title: title }));
        // Angenommen: Funktionsbeginn (fwportal liefert keins), fehlendes Beförderungsdatum.
        assignments.push({ key: String(k), title, kind, roleChoice, grants, from, note, assumed: !skipped && (kind === "function" || !rankDate), skipped, suggested: sameChoice(roleChoice, d.choice) });
      });
      // Basisrolle nur als Fallback, wenn keine (nicht ausgelassene) Zuweisung den aktiven Status vergibt. Wie jede andere Zuweisung pro Mitglied überschreibbar.
      if (m.active && !assignments.some((x) => !x.skipped && x.grants)) {
        const rolePick = str(body, `arole_${m.mid}_a`);
        const roleChoice: RoleChoice = !rolePick ? { kind: "role", roleId: ACTIVE_ROLE_ID } : rolePick === "new" ? { kind: "new" } : { kind: "role", roleId: rolePick };
        const skipped = str(body, `askip_${m.mid}_a`) === "1";
        const from = toIsoDate(str(body, `from_${m.mid}_a`)) ?? m.entryDate!;
        const noteIn = str(body, `note_${m.mid}_a`);
        const note = noteIn !== undefined ? clean(noteIn)?.slice(0, 200) ?? null : null;
        const grants = roleChoice.kind === "role" ? !!roles.find((r) => r.id === roleChoice.roleId)?.grantsActiveStatus : true;
        assignments.unshift({ key: "a", title: "Feuerwehr-Anwärter", kind: "function", roleChoice, grants, from, note, assumed: false, skipped, suggested: sameChoice(roleChoice, { kind: "role", roleId: ACTIVE_ROLE_ID }) });
      }
    }
    return { m, included, duplicate, errors, warnings, assignments };
  });

  return {
    rows, titles,
    blockers: rows.filter((r) => r.included && r.errors.length).length,
    assumedCount: rows.filter((r) => r.included).reduce((n, r) => n + r.assignments.filter((a) => a.assumed).length, 0),
  };
}

// ── Inventar ────────────────────────────────────────────────────────────────

export type ParsedItem = {
  id: number; levels: string[]; name: string; number: string | null; serial: string | null;
  commissionedAt: string | null; price: string | null; retiredAt: string | null; location: string | null;
};

export const BATCH_CAPABLE: ReadonlySet<InventoryCategory> = new Set(["equipment", "ppe", "other"]);
export const CATEGORY_OPTIONS: InventoryCategory[] = ["vehicle", "scba", "equipment", "ppe", "other"];
// Erste Stufe des Inventartyps → Kategorie; unbekannt → other.
const CATEGORY_BY_LEVEL: Record<string, InventoryCategory> = {
  Kleidung: "ppe",
  ...Object.fromEntries(
    ["Funk", "Armaturen", "Pumpe", "Schlauch", "Werkzeug", "Tragbare Leitern", "Löschgerät", "Leine", "Arbeitsgerät", "Sondergerät", "Sanitätsgerät", "Elektrogeräte"]
      .map((l) => [l, "equipment" as const]),
  ),
  Sonstiges: "other",
};
export const suggestCategory = (level: string): InventoryCategory => CATEGORY_BY_LEVEL[level] ?? "other";
export const isRecognizedLevel = (level: string) => level in CATEGORY_BY_LEVEL;

export function parseInventory(rows: Raw[]): ParsedItem[] {
  return rows.map((r) => {
    const levels = String(r["Inventartyp (Voll)"] ?? "").split("|").map((s) => clean(s)).filter((s): s is string => !!s);
    const price = clean(r["Kaufpreis"])?.replace(/[€\s]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".") ?? null;
    return {
      id: r["InventarID"] as number,
      levels,
      name: clean(r["Bezeichnung"]) ?? levels.at(-1) ?? t("import.inventory.unnamed"),
      number: clean(r["Inventarnr."]),
      serial: clean(r["Seriennr."]),
      commissionedAt: toIsoDate(r["Indienststellung"]),
      price: price && !Number.isNaN(Number(price)) && Number(price) > 0 ? Number(price).toFixed(2) : null,
      retiredAt: toIsoDate(r["Ausgemustert am"]),
      location: clean(r["Standort (komplett)"]),
    };
  });
}

export type Position = {
  gid: number; items: ParsedItem[]; name: string; category: InventoryCategory; quantity: number;
  tags: string[]; numbers: string[]; serials: string[]; commissionedAt: string | null; price: string | null;
  retiredAt: string | null; bundled: boolean; canBundle: boolean; groupSize: number; duplicateNumbers: string[];
  typePath: string; override: InventoryCategory | null; checkCategory: boolean;
};
export type InventoryPlan = { positions: Position[]; levels: { level: string; category: InventoryCategory; recognized: boolean; checkCategory: boolean }[]; rowCount: number; bundledRows: number };

export function planInventory(items: ParsedItem[], existingNumbers: Set<string>, body: Body): InventoryPlan {
  const levelNames = [...new Set(items.map((i) => i.levels[0] ?? ""))].sort();
  const levels = levelNames.map((level, i) => {
    const sel = str(body, `cat_${i}`);
    const confirmed = (CATEGORY_OPTIONS as string[]).includes(sel ?? "");
    const recognized = isRecognizedLevel(level);
    return { level, category: confirmed ? (sel as InventoryCategory) : suggestCategory(level), recognized, checkCategory: !recognized && !confirmed };
  });
  const levelOf = new Map(levels.map((l) => [l.level, l]));

  // Bündelungsschlüssel: Typ + Bezeichnung + Standort + Indienststellung (+ Ausmusterung).
  const groups = new Map<string, ParsedItem[]>();
  for (const it of items) {
    const k = [it.levels.join("|"), it.name, it.location, it.commissionedAt, it.retiredAt, it.price].join("\u0000");
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }

  const positions: Position[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const lv = levelOf.get(first.levels[0] ?? "")!;
    const ov = str(body, `pcat_${first.id}`);
    const override = (CATEGORY_OPTIONS as string[]).includes(ov ?? "") ? (ov as InventoryCategory) : null;
    const category = override ?? lv.category;
    const defaultTags = [...new Set([...first.levels, ...(first.location ? [first.location] : [])])];
    const canBundle = BATCH_CAPABLE.has(category) && group.length > 1;
    const bundled = canBundle && str(body, `nob_${first.id}`) !== "1";
    for (const part of bundled ? [group] : group.map((g) => [g])) {
      const numbers = part.map((p) => p.number).filter((n): n is string => !!n);
      const posted = parseTags(body, `tags_${part[0].id}`);
      positions.push({
        gid: first.id, items: part, name: first.name, category, quantity: part.length,
        tags: posted.length ? posted : defaultTags,
        numbers, serials: [...new Set(part.map((p) => p.serial).filter((s): s is string => !!s))],
        commissionedAt: first.commissionedAt, price: first.price, retiredAt: first.retiredAt,
        bundled, canBundle, groupSize: group.length, duplicateNumbers: numbers.filter((n) => existingNumbers.has(n)),
        typePath: first.levels.join(" › "), override, checkCategory: !override && lv.checkCategory,
      });
    }
  }
  const natural = (a: string, b: string) => a.localeCompare(b, "de", { numeric: true });
  positions.sort((a, b) => CATEGORY_OPTIONS.indexOf(a.category) - CATEGORY_OPTIONS.indexOf(b.category) || natural(a.typePath, b.typePath) || natural(a.name, b.name));
  return { positions, levels, rowCount: items.length, bundledRows: positions.filter((p) => p.bundled).reduce((n, p) => n + p.quantity, 0) };
}

export { normalizeIban };
