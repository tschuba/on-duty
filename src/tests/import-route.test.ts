import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";

// Jede Abfragekette ist awaitbar und liefert eine leere Liste.
const state = vi.hoisted(() => ({ roles: [] as any[], types: [] as any[], inserts: [] as any[] }));
vi.mock("../db/index.js", () => {
  const chain: any = new Proxy(() => {}, {
    get: (_t, k) => (k === "then" ? (r: any) => r([]) : chain),
    apply: () => chain,
  });
  const txChain: any = new Proxy(() => {}, {
    get: (_t, k) => (k === "then" ? (r: any) => r([{ id: "x" }]) : txChain),
    apply: () => txChain,
  });
  const templates = [
    { id: "t-psa", name: "PSA", enabledFields: ["quantity", "numbers"] },
    { id: "t-geraet", name: "Gerät", enabledFields: ["quantity", "numbers", "serials"] },
    { id: "t-sonst", name: "Sonstiges", enabledFields: ["quantity"] },
  ];
  const rows = (data: () => any[]): any => new Proxy(() => {}, { get: (_t, k) => (k === "then" ? (r: any) => r(data()) : rows(data)), apply: () => rows(data) });
  const insertChain = { values: (v: any) => { state.inserts.push(v); return txChain; } };
  const select = (f?: any) => (f && "typeName" in f ? rows(() => state.roles) : f && "allowsActiveStatus" in f && !("typeName" in f) ? rows(() => state.types) : chain);
  return { db: { select, query: { inventoryTemplates: { findMany: async () => [...templates] } }, transaction: async (fn: any) => fn({ insert: () => insertChain, select: () => txChain }) } };
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
    const res = await post("/preview", upload(MEMBER_HEAD, [{ mID: 1, Name: "Muster", Vorname: "Max", Status: "active", Geburtstag: "01.02.1990", Eintritt: "01.01.2010" }]));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Muster");
  });
  it("omits the notes column and filter when no member row has notes", async () => {
    const html = await (await post("/preview", upload(MEMBER_HEAD, [{ mID: 1, Name: "Muster", Vorname: "Max", Status: "active", Geburtstag: "01.02.1990", Eintritt: "01.01.2010" }]))).text();
    expect(html).not.toContain('sm" data-only-problems');
    expect(html).not.toContain("<th>Hinweise</th>");
  });
  it("shows the notes column and filter when a member row has a problem", async () => {
    const html = await (await post("/preview", upload(MEMBER_HEAD, [{ mID: 1, Name: "Muster", Vorname: "Max", Status: "active" }]))).text();
    expect(html).toContain("data-only-problems");
    expect(html).toContain("<th>Hinweise</th>");
  });
  it("shows no assignment banner and an empty hint without assignments; member badge has both counts", async () => {
    const html = await (await post("/preview", upload(MEMBER_HEAD, [{ mID: 1, Name: "Muster", Vorname: "Max", Status: "active", Geburtstag: "01.02.1990", Eintritt: "01.01.2010" }]))).text();
    expect(html).toContain("Keine Funktionszuweisungen zu übernehmen.");
    expect(html).not.toContain("alert-warning");
    expect(html).toContain("1 · 1 übernommen");
  });
  it("renders the role mapping as a bordered combo with chevron and aria-label", async () => {
    const html = await (await post("/preview", upload(MEMBER_HEAD, [{ mID: 1, Name: "Muster", Vorname: "Max", Status: "active", Funktionen: "Kassier" }]))).text();
    expect(html).toContain('class="input input-sm w-56');
    expect(html).not.toContain("<th>Art</th>");
    expect(html).toContain("<th colspan=\"5\" class=\"bg-base-200 text-left\">Funktionen</th>");
    expect(html).not.toContain(">Dienstgrade</th>"); // leere Gruppe entfällt
    expect(html).toContain('name="type_0"'); // „neu“ → Funktionstyp-Auswahl
    expect(html).toContain('aria-label="Kassier – Zuordnung"');
    expect(html).toContain("Zuordnung kann geändert werden");
  });
  it("previews an inventory list", async () => {
    const res = await post("/preview", upload(INV_HEAD, [
      { InventarID: 1, "Inventartyp (Voll)": "Schlauch", Bezeichnung: "B-Schlauch", "Inventarnr.": "A1", "Standort (komplett)": "Auto", Indienststellung: 42000 },
      { InventarID: 2, "Inventartyp (Voll)": "Schlauch", Bezeichnung: "B-Schlauch", "Inventarnr.": "A2", "Standort (komplett)": "Auto", Indienststellung: 42000 },
    ]));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("B-Schlauch");
    expect(html).toContain('name="tpl_0"');
    expect(html).toContain("Gerät");
  });
  it("rejects a file of the wrong kind when kind is set", async () => {
    const fd = upload(INV_HEAD, [{ InventarID: 1, Bezeichnung: "X" }]);
    fd.set("kind", "members");
    const res = await post("/preview", fd);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Inventar-Export");
  });
  it("limits the upload page to the given kind", async () => {
    const html = await (await importRoutes.request("/?kind=inventory")).text();
    expect(html).toContain('name="kind" value="inventory"');
    expect(html).not.toContain("mID");
  });
  it("accepts a matching file with kind and ignores an invalid kind", async () => {
    const fd = upload(INV_HEAD, [{ InventarID: 1, "Inventartyp (Voll)": "Schlauch", Bezeichnung: "B-Schlauch", "Inventarnr.": "A1" }]);
    fd.set("kind", "inventory");
    expect((await post("/preview", fd)).status).toBe(200);
    const bad = upload(INV_HEAD, [{ InventarID: 1, Bezeichnung: "X" }]);
    bad.set("kind", "foo");
    expect((await post("/preview", bad)).status).toBe(200);
    const html = await (await importRoutes.request("/?kind=foo")).text();
    expect(html).toContain("mID");
    expect(html).toContain("InventarID");
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
    const fd = upload(MEMBER_HEAD, [{ mID: 1, Name: "Muster", Vorname: "Max", Status: "passive", Geburtstag: "01.02.1990", Eintritt: "01.01.2010" }]);
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
  const full = { Name: "Muster", Vorname: "Max", Status: "active", Geschlecht: "m", Geburtstag: "01.02.1990", Eintritt: "01.01.2010", Dienstgrad: "Hauptfeuerwehrmann", Funktionen: "Kassier", Telefon: "0960 1", "e-Mail": "a@b.de", Strasse: "Weg", "Nr.": "1", PLZ: "95000", Ort: "Hof" };
  it("previews members with assumed data, confirmed and not", async () => {
    for (const ok of [false, true]) {
      const fd = upload(MEMBER_HEAD, [{ mID: 1, ...full }, { mID: 2, ...full, Vorname: "Eva", Status: "deceased", "Verstorben am": "01.01.2020" }, { mID: 3, ...full, Vorname: "Bad", Geburtstag: "xx" }]);
      if (ok) fd.set("assumed_ok", "1");
      fd.set("inc", "1");
      const res = await post("/preview", fd);
      expect(res.status).toBe(200);
    }
  });
  it("shows banner and checkbox when assignments carry assumed dates", async () => {
    const html = await (await post("/preview", upload(MEMBER_HEAD, [{ mID: 1, ...full }]))).text();
    expect(html).toContain("alert-warning");
    expect(html).toContain('name="assumed_ok"');
    expect(html).not.toContain("Keine Funktionszuweisungen zu übernehmen.");
  });
  it("previews inventory with overrides", async () => {
    const rows = [
      { InventarID: 1, "Inventartyp (Voll)": "Fahrzeug", Bezeichnung: "TLF", "Inventarnr.": "F1", "Standort (komplett)": "Halle", Kaufpreis: 1000, "Ausgemustert am": "01.01.2020" },
      { InventarID: 2, "Inventartyp (Voll)": "Atemschutz", Bezeichnung: "PA", "Inventarnr.": "P1", "Seriennr.": "S1" },
      { InventarID: 3, "Inventartyp (Voll)": "Schlauchbrücke", Bezeichnung: "Brücke", "Inventarnr.": "B1" },
      { InventarID: 4, "Inventartyp (Voll)": "Schlauchbrücke", Bezeichnung: "Brücke", "Inventarnr.": "B2" },
      { InventarID: 5, "Inventartyp (Voll)": "Schlauchbrücke", Bezeichnung: "Brücke", "Inventarnr.": "" },
    ];
    for (const extra of [{}, { tpl_0: "t-geraet", nob_0: "1" }, { nob_0: "" }]) {
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

  describe("role mapping with known roles", () => {
    const T = { rank: "ty-rank", pos: "ty-pos", club: "ty-club" };
    const types = [
      { id: T.rank, name: "Dienstgrad", sortOrder: 1, allowsActiveStatus: true },
      { id: T.pos, name: "Dienststellung", sortOrder: 2, allowsActiveStatus: true },
      { id: T.club, name: "Verein", sortOrder: 3, allowsActiveStatus: false },
    ];
    const role = (id: string, title: string, grantsActiveStatus: boolean, ty: typeof types[number]) => ({ id, title, grantsActiveStatus, typeId: ty.id, typeName: ty.name, typeSortOrder: ty.sortOrder, typeAllowsActive: ty.allowsActiveStatus });
    const withRoles = () => { state.types = types; state.roles = [role("r-k", "Kommandant", true, types[1]), role("r-v", "Vorstand", false, types[2])]; state.inserts = []; };
    const member = (extra: Record<string, unknown>) => ({ mID: 1, Name: "Muster", Vorname: "Max", Status: "Passiv", Geburtstag: "01.02.1990", Eintritt: "01.01.2010", ...extra });
    const withFields = (fd: FormData, f: Record<string, string>) => { for (const [k, v] of Object.entries(f)) fd.set(k, v); return fd; };

    it("shows Ja/Nein for existing roles and a checkbox for new ones", async () => {
      withRoles();
      const html = await (await post("/preview", upload(MEMBER_HEAD, [member({ Funktionen: "Kommandant, Vorstand, Kassier" })]))).text();
      expect(html).toMatch(/<span title="Macht aktiv">Ja<\/span>/);
      expect(html).toMatch(/<span title="Macht aktiv">Nein<\/span>/);
      expect(html).toContain('name="grants_0"'); // Kassier (Index 0) = neu
    });
    it("offers pending new functions but no 'new' option in the member assignment list", async () => {
      withRoles();
      const html = await (await post("/preview", upload(MEMBER_HEAD, [member({ Funktionen: "Kassier" })]))).text();
      const [titles, assignments] = html.split('id="assignments"');
      expect(titles).toContain("＋ Neue Rolle anlegen");
      expect(assignments).not.toContain("＋ Neue Rolle anlegen");
      expect(assignments).toContain('name="arole_1_0"');
      expect(assignments).toContain('value="new:0"');
      expect(assignments).toContain(">neu</span>");
      expect(assignments).toContain('<li class="text-xs font-semibold opacity-60 px-2 pt-2" data-msf-group="true">Dienststellung</li>');
    });
    it("disables 'Macht aktiv' when the chosen type does not allow active status", async () => {
      withRoles();
      const html = await (await post("/preview", withFields(upload(MEMBER_HEAD, [member({ Funktionen: "Kassier" })]), { _seen: "1", inc: "1", use_0: "1", ause_1_0: "1", type_0: T.club, grants_0: "1" }))).text();
      expect(html).toMatch(/name="grants_0"[^>]*disabled/);
      expect(html).not.toMatch(/name="grants_0"[^>]*checked/);
    });
    it("creates a new role with the chosen type on run", async () => {
      withRoles();
      const res = await post("/run", withFields(upload(MEMBER_HEAD, [member({ Funktionen: "Kassier" })]), { intent: "run", _seen: "1", inc: "1", use_0: "1", ause_1_0: "1", type_0: T.club }));
      expect(res.status).toBe(200);
      expect(state.inserts).toContainEqual(expect.objectContaining({ title: "Kassier", typeId: T.club, grantsActiveStatus: false }));
    });
    it("run keeps grantsActiveStatus for a type that allows it", async () => {
      withRoles();
      await post("/run", withFields(upload(MEMBER_HEAD, [member({ Funktionen: "Kassier" })]), { intent: "run", _seen: "1", inc: "1", use_0: "1", ause_1_0: "1", type_0: T.pos, grants_0: "1" }));
      expect(state.inserts).toContainEqual(expect.objectContaining({ title: "Kassier", typeId: T.pos, grantsActiveStatus: true }));
    });
  });
});
