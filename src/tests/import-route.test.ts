import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";

// Jede Abfragekette ist awaitbar und liefert eine leere Liste.
vi.mock("../db/index.js", () => {
  const chain: any = new Proxy(() => {}, {
    get: (_t, k) => (k === "then" ? (r: any) => r([]) : chain),
    apply: () => chain,
  });
  const txChain: any = new Proxy(() => {}, {
    get: (_t, k) => (k === "then" ? (r: any) => r([{ id: "x" }]) : txChain),
    apply: () => txChain,
  });
  return { db: { select: () => chain, transaction: async (fn: any) => fn({ insert: () => txChain, select: () => txChain }) } };
});
vi.mock("../middleware/auth.js", () => ({
  requireAuth: () => async (c: any, next: any) => {
    c.set("user", { id: "u1", permissions: new Set(["import:run"]), disabled: false });
    await next();
  },
}));

const { importRoutes } = await import("../routes/import.js");

const MEMBER_HEAD = ["mID", "Name", "Vorname", "Status", "Geschlecht", "Geburtstag", "Eintritt", "Eintritt (erste FW)", "Verstorben am", "Strasse", "Nr.", "PLZ", "Ort", "Dienstgrad", "Datum Beförderung", "Funktionen", "Telefon", "Mobil", "e-Mail", "Kontonummer / IBAN", "BLZ / BIC", "Beruf"];
const INV_HEAD = ["InventarID", "Inventartyp (Voll)", "Bezeichnung", "Inventarnr.", "Seriennr.", "Indienststellung", "Kaufpreis", "Ausgemustert am", "Standort (komplett)"];

function upload(head: string[], rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.aoa_to_sheet([[], ["Liste"], [], head, ...rows.map((r) => head.map((h) => r[h] ?? null))]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(buf)], "liste.xlsx"));
  return fd;
}
const post = (path: string, body: BodyInit) => importRoutes.request(path, { method: "POST", body });

describe("import routes", () => {
  it("renders the upload page", async () => {
    const res = await importRoutes.request("/");
    expect(res.status).toBe(200);
  });
  it("previews a member list", async () => {
    const res = await post("/preview", upload(MEMBER_HEAD, [{ mID: 1, Name: "Muster", Vorname: "Max", Status: "aktiv", Geburtstag: "01.02.1990", Eintritt: "01.01.2010" }]));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Muster");
  });
  it("previews an inventory list", async () => {
    const res = await post("/preview", upload(INV_HEAD, [
      { InventarID: 1, "Inventartyp (Voll)": "Schlauch", Bezeichnung: "B-Schlauch", "Inventarnr.": "A1", "Standort (komplett)": "Auto", Indienststellung: 42000 },
      { InventarID: 2, "Inventartyp (Voll)": "Schlauch", Bezeichnung: "B-Schlauch", "Inventarnr.": "A2", "Standort (komplett)": "Auto", Indienststellung: 42000 },
    ]));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("B-Schlauch");
  });
  it("shows an error without a file", async () => {
    const res = await post("/preview", new FormData());
    expect(res.status).toBeLessThan(500);
  });
  it("refuses to run an incomplete preview", async () => {
    const fd = upload(MEMBER_HEAD, []);
    fd.set("intent", "run");
    const res = await post("/run", fd);
    expect(res.status).toBeLessThan(500);
  });
  it("runs a member import", async () => {
    const fd = upload(MEMBER_HEAD, [{ mID: 1, Name: "Muster", Vorname: "Max", Status: "passiv", Geburtstag: "01.02.1990", Eintritt: "01.01.2010" }]);
    fd.set("intent", "run");
    const res = await post("/run", fd);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Import");
  });
  it("runs an inventory import", async () => {
    const fd = upload(INV_HEAD, [{ InventarID: 1, "Inventartyp (Voll)": "Schlauch", Bezeichnung: "B-Schlauch", "Inventarnr.": "A1", "Standort (komplett)": "Auto", Indienststellung: 42000 }]);
    fd.set("intent", "run");
    const res = await post("/run", fd);
    expect(res.status).toBe(200);
  });
  const full = { Name: "Muster", Vorname: "Max", Status: "aktiv", Geschlecht: "m", Geburtstag: "01.02.1990", Eintritt: "01.01.2010", Dienstgrad: "Hauptfeuerwehrmann", Funktionen: "Kassier", Telefon: "0960 1", "e-Mail": "a@b.de", Strasse: "Weg", "Nr.": "1", PLZ: "95000", Ort: "Hof" };
  it("previews members with assumed data, confirmed and not", async () => {
    for (const ok of [false, true]) {
      const fd = upload(MEMBER_HEAD, [{ mID: 1, ...full }, { mID: 2, ...full, Vorname: "Eva", Status: "verstorben", "Verstorben am": "01.01.2020" }, { mID: 3, ...full, Vorname: "Bad", Geburtstag: "xx" }]);
      if (ok) fd.set("assumed_ok", "1");
      fd.set("inc", "1");
      const res = await post("/preview", fd);
      expect(res.status).toBe(200);
    }
  });
  it("previews inventory with overrides", async () => {
    const rows = [
      { InventarID: 1, "Inventartyp (Voll)": "Fahrzeug", Bezeichnung: "TLF", "Inventarnr.": "F1", "Standort (komplett)": "Halle", Kaufpreis: 1000, "Ausgemustert am": "01.01.2020" },
      { InventarID: 2, "Inventartyp (Voll)": "Atemschutz", Bezeichnung: "PA", "Inventarnr.": "P1", "Seriennr.": "S1" },
      { InventarID: 3, "Inventartyp (Voll)": "Schlauchbrücke", Bezeichnung: "Brücke", "Inventarnr.": "B1" },
      { InventarID: 4, "Inventartyp (Voll)": "Schlauchbrücke", Bezeichnung: "Brücke", "Inventarnr.": "B2" },
      { InventarID: 5, "Inventartyp (Voll)": "Schlauchbrücke", Bezeichnung: "Brücke", "Inventarnr.": "" },
    ];
    for (const extra of [{}, { cat_0: "equipment", nob_0: "1" }, { nob_0: "" }]) {
      const fd = upload(INV_HEAD, rows);
      for (const [k, v] of Object.entries(extra)) fd.set(k, v);
      const res = await post("/preview", fd);
      expect(res.status).toBe(200);
    }
  });
  it("rejects garbage files", async () => {
    const fd = new FormData();
    fd.set("file", new File(["nope"], "x.csv"));
    expect((await post("/preview", fd)).status).toBeLessThan(500);
  });
  it("accepts the hidden data fields and unmapped columns", async () => {
    const head = [...MEMBER_HEAD, "Lieblingsfarbe"];
    const src = upload(head, [{ mID: 1, ...full, Lieblingsfarbe: "rot" }]);
    const buf = Buffer.from(await (src.get("file") as File).arrayBuffer());
    const fd = new FormData();
    fd.set("data", buf.toString("base64"));
    fd.set("name", "x.xlsx");
    fd.set("fp", "f");
    fd.set("restored", "1");
    fd.set("intent", "run");
    fd.set("assumed_ok", "1");
    fd.set("inc", "1");
    for (const path of ["/preview", "/run"]) {
      const res = await post(path, fd);
      expect(res.status).toBe(200);
    }
  });
});
