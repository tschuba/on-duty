import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  ACTIVE_ROLE_ID, ImportError, checkUpload, cleanPhones, parseInventory, parseMembers, planInventory, planMembers,
  readWorkbook, suggestRole, toIsoDate, unmappedColumns,
} from "../lib/import.js";

const MEMBER_HEAD = ["mID", "Name", "Vorname", "Status", "Geschlecht", "Geburtstag", "Eintritt", "Eintritt (erste FW)", "Verstorben am", "Strasse", "Nr.", "PLZ", "Ort", "Dienstgrad", "Datum Beförderung", "Funktionen", "Telefon", "Mobil", "e-Mail", "Kontonummer / IBAN", "BLZ / BIC", "Beruf"];
const INV_HEAD = ["InventarID", "Inventartyp (Voll)", "Bezeichnung", "Inventarnr.", "Seriennr.", "Indienststellung", "Kaufpreis", "Ausgemustert am", "Standort (komplett)"];

function book(head: string[], rows: unknown[][], marker = true): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([[], [marker ? "Liste" : ""], [], head, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
const mrow = (o: Record<string, unknown>) => MEMBER_HEAD.map((h) => o[h] ?? null);

describe("helpers", () => {
  it("converts excel serials and german dates", () => {
    expect(toIsoDate(12006)).toBe("1932-11-13");
    expect(toIsoDate("05.03.2001")).toBe("2001-03-05");
    expect(toIsoDate("")).toBeNull();
  });
  it("splits, cleans and dedupes phones", () => {
    expect(cleanPhones("\u202D0960 1\u202C,0960 2, 0960 1")).toBe("0960 1, 0960 2");
    expect(cleanPhones(null)).toBeNull();
  });
  it("validates uploads", () => {
    expect(() => checkUpload("a.csv", Buffer.from("PK"))).toThrow(ImportError);
    expect(() => checkUpload("a.xlsx", Buffer.from("not a zip"))).toThrow(ImportError);
    expect(() => checkUpload("a.xlsx", book(INV_HEAD, []))).not.toThrow();
  });
});

describe("readWorkbook", () => {
  it("detects members, skips summary rows", () => {
    const buf = book(MEMBER_HEAD, [mrow({ mID: 1, Name: "A", Vorname: "B" }), ["Anzahl:", 1]]);
    const r = readWorkbook(buf);
    expect(r.kind).toBe("members");
    expect(r.rows).toHaveLength(1);
  });
  it("names missing columns", () => {
    expect(() => readWorkbook(book(["InventarID", "Bezeichnung"], []))).toThrow(/Fehlende Spalten: .*Inventartyp/);
  });
  it("reports filled unmapped columns only", () => {
    const r = readWorkbook(book(MEMBER_HEAD, [mrow({ mID: 1, Beruf: "Maurer" }), mrow({ mID: 2 })]));
    expect(unmappedColumns(r.kind, r.headers, r.rows)).toEqual([{ column: "Beruf", count: 1 }]);
  });
});

const roles = [
  { id: "r-k", title: "Kommandant", grantsActiveStatus: true },
  { id: "r-v", title: "Vorstand", grantsActiveStatus: false },
  { id: ACTIVE_ROLE_ID, title: "Aktives Mitglied", grantsActiveStatus: true },
];

describe("members", () => {
  const rows = [
    mrow({ mID: 1, Name: "Muster", Vorname: "Max", Status: "Aktiv", Geschlecht: "männlich", Geburtstag: 30000, Eintritt: 40000, "Eintritt (erste FW)": 39000, Funktionen: "1. Kommandant", Dienstgrad: "Löschmeister" }),
    mrow({ mID: 2, Name: "Passiv", Vorname: "Pia", Status: "Passiv", Geburtstag: 31000, Eintritt: 41000, "Eintritt (erste FW)": 41000, Dienstgrad: "nicht gepflegt" }),
    mrow({ mID: 3, Name: "Luecke", Vorname: "Lara", Status: "Aktiv", Eintritt: 41000 }),
    mrow({ mID: 4, Name: "Tot", Vorname: "Tom", Status: "Aktiv", Geburtstag: 20000, Eintritt: 30000, "Verstorben am": 40000, Funktionen: "X" }),
  ];
  const parsed = parseMembers(readWorkbook(book(MEMBER_HEAD, rows)).rows);

  it("maps fields", () => {
    expect(parsed[0]).toMatchObject({ gender: "male", active: true, functions: ["1. Kommandant"], rank: "Löschmeister" });
    expect(parsed[0].firstEntryDate).toBe("2006-10-10"); // differs from Eintritt
    expect(parsed[1].firstEntryDate).toBeNull(); // identical → entryDate only
    expect(parsed[1].rank).toBeNull();
  });

  it("suggests fixed role mapping with note, falls back to title match, else new", () => {
    expect(suggestRole("1. Kommandant", roles)).toEqual({ choice: { kind: "role", roleId: "r-k" }, note: "1." });
    expect(suggestRole("vorstand", roles).choice).toEqual({ kind: "role", roleId: "r-v" });
    expect(suggestRole("Löschmeister", roles).choice).toEqual({ kind: "new" });
    expect(suggestRole("Schriftführerin", [roles[0]]).choice).toEqual({ kind: "new" });
  });

  it("blocks rows with missing required values until supplied", () => {
    const p1 = planMembers(parsed, roles, new Set(), {}, "2026-01-01");
    expect(p1.rows[2].errors).toContain("Geburtsdatum fehlt");
    expect(p1.blockers).toBe(1);
    const p2 = planMembers(parsed, roles, new Set(), { _seen: "1", inc: ["1", "2", "3"], birth_3: "1990-02-03" }, "2026-01-01");
    expect(p2.blockers).toBe(0);
    expect(p2.rows[2].m.birthDate).toBe("1990-02-03");
    const p3 = planMembers(parsed, roles, new Set(), { _seen: "1", inc: ["1", "2"] }, "2026-01-01");
    expect(p3.blockers).toBe(0);
  });

  it("plans assignments, assumed flags, active role, deceased and duplicates", () => {
    const p = planMembers(parsed, roles, new Set(["muster|max|1982-02-18"]), {}, "2026-01-01");
    expect(p.rows[0].duplicate).toBe(true);
    expect(p.rows[0].included).toBe(false);
    const plan = planMembers(parsed, roles, new Set(), {}, "2026-01-01");
    const a = plan.rows[0].assignments;
    expect(a.map((x) => x.title)).toEqual(["Aktives Mitglied", "1. Kommandant", "Löschmeister"]);
    expect(a[1]).toMatchObject({ note: "1.", from: "2026-01-01", assumed: true });
    expect(a[2].assumed).toBe(true); // no Datum Beförderung → from = Eintritt, flagged
    expect(plan.rows[1].assignments).toEqual([]); // passive: no role
    expect(plan.rows[3].assignments).toEqual([]); // deceased
    expect(plan.titles.find((t) => t.title === "Löschmeister")).toMatchObject({ kind: "rank", grants: true });
  });

  it("honours ignore choice and warns when a passive gets an active-granting role", () => {
    const passiveWithRole = parseMembers(readWorkbook(book(MEMBER_HEAD, [mrow({ mID: 9, Name: "P", Vorname: "Q", Status: "Passiv", Geburtstag: 30000, Eintritt: 40000, Funktionen: "Kommandant" })])).rows);
    const warn = planMembers(passiveWithRole, roles, new Set(), {}, "2026-01-01");
    expect(warn.rows[0].warnings).toHaveLength(1);
    const ign = planMembers(passiveWithRole, roles, new Set(), { _seen: "1", inc: ["9"], ign_0: "1" }, "2026-01-01");
    expect(ign.rows[0].assignments).toEqual([]);
  });
});

describe("per-assignment overrides", () => {
  const rows = parseMembers(readWorkbook(book(MEMBER_HEAD, [mrow({ mID: 5, Name: "A", Vorname: "B", Status: "Aktiv", Geburtstag: 30000, Eintritt: 40000, Funktionen: "1. Kommandant" })])).rows);
  it("lets a single assignment use another role or be skipped", () => {
    const base = { _seen: "1", inc: ["5"] };
    expect(planMembers(rows, roles, new Set(), { ...base, arole_5_0: "r-v" }, "2026-01-01").rows[0].assignments[1].roleChoice).toEqual({ kind: "role", roleId: "r-v" });
    expect(planMembers(rows, roles, new Set(), { ...base, arole_5_0: "new" }, "2026-01-01").rows[0].assignments[1].roleChoice).toEqual({ kind: "new" });
    const skipped = planMembers(rows, roles, new Set(), { ...base, askip_5_0: "1" }, "2026-01-01");
    expect(skipped.rows[0].assignments[1].skipped).toBe(true);
    expect(skipped.assumedCount).toBe(0);
  });
});

describe("inventory", () => {
  const irow = (id: number, level: string, name: string, nr: string, loc = "Auto", extra: Partial<Record<string, unknown>> = {}) =>
    INV_HEAD.map((h) => ({ InventarID: id, "Inventartyp (Voll)": level, Bezeichnung: name, "Inventarnr.": nr, "Standort (komplett)": loc, Indienststellung: 42000, ...extra } as Record<string, unknown>)[h] ?? null);
  const items = parseInventory(readWorkbook(book(INV_HEAD, [
    irow(1, "Funk | Funkgerät", "Mikro", "00 1"),
    irow(2, "Funk | Funkgerät", "Mikro", "00 2"),
    irow(3, "Kleidung | Helm", "Helm", "00 3"),
    irow(4, "Neu | Ding", "Ding", "00 4", "Auto", { "Seriennr.": "C Strahlrohr 1" }),
  ])).rows);

  it("suggests categories and tags every level + location", () => {
    const plan = planInventory(items, new Set(), {});
    expect(plan.levels.map((l) => [l.level, l.category])).toEqual([["Funk", "equipment"], ["Kleidung", "ppe"], ["Neu", "other"]]);
    const mikro = plan.positions.find((p) => p.name === "Mikro")!;
    expect(mikro).toMatchObject({ quantity: 2, bundled: true, numbers: ["00 1", "00 2"] });
    expect(mikro.tags).toEqual(["Funk", "Funkgerät", "Auto"]);
    expect(plan.positions.find((p) => p.name === "Ding")!.serials).toEqual(["C Strahlrohr 1"]);
    expect(plan.positions).toHaveLength(3);
  });

  it("can unbundle, honours category override, flags existing numbers", () => {
    const plan = planInventory(items, new Set(["00 2"]), { nob_1: "1", cat_0: "ppe" });
    expect(plan.positions.filter((p) => p.name === "Mikro")).toHaveLength(2);
    expect(plan.positions.find((p) => p.numbers[0] === "00 2")!.duplicateNumbers).toEqual(["00 2"]);
    expect(plan.positions[0].category).toBe("ppe");
  });

  it("never bundles non-batch categories", () => {
    const veh = parseInventory(readWorkbook(book(INV_HEAD, [irow(1, "Fahrzeug | A", "A", "1"), irow(2, "Fahrzeug | A", "A", "2")])).rows);
    const plan = planInventory(veh, new Set(), { cat_0: "vehicle" });
    expect(plan.positions).toHaveLength(2);
  });
});
