import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://app.test";
const PDF = Buffer.from("%PDF-1.7 test");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

let donation: any;
let metaRows: any[];
let insertFails = false;
const inserts: any[] = [];
const deletes: any[] = [];

vi.mock("../env.js", () => ({ env: { OIDC_APP_URL: "https://app.test" } }));
vi.mock("../db/index.js", () => ({
  db: {
    query: { donations: { findFirst: vi.fn(async () => donation) } },
    select: () => ({ from: () => ({ where: async () => metaRows }) }),
    insert: () => ({
      values: (v: any) => ({
        onConflictDoUpdate: async () => {
          if (insertFails) throw new Error("db down");
          inserts.push(v);
        },
      }),
    }),
    delete: () => ({ where: async () => { deletes.push(1); } }),
  },
}));
let perms = new Set(["donations:issue-receipts"]);
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (required?: string | string[]) => async (c: any, next: any) => {
    const need = ([] as string[]).concat(required ?? []);
    if (need.length && !need.some((p) => perms.has(p))) return c.text("forbidden", 403);
    c.set("user", { id: "u1", permissions: perms });
    await next();
  },
}));

const { donationRoutes } = await import("../routes/donations.js");
const { writeReceiptFile, readReceiptFile } = await import("../lib/receipt-files.js");

function upload(bytes: Buffer | null, opts: { origin?: string | null; name?: string; id?: string } = {}) {
  const fd = new FormData();
  if (bytes) fd.append("file", new File([new Uint8Array(bytes)], opts.name ?? "x.pdf", { type: "text/plain" }));
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.Origin = opts.origin ?? ORIGIN;
  return donationRoutes.request(`/${opts.id ?? ID}/receipt-file`, { method: "POST", body: fd, headers });
}
const flashOf = (res: Response) => decodeURIComponent(res.headers.get("set-cookie") ?? "");

beforeEach(() => {
  process.env.UPLOAD_PATH = mkdtempSync(join(tmpdir(), "uploads-"));
  donation = { id: ID, donorId: "d1", date: "2026-03-01", donor: { person: { firstName: "Anna", lastName: "Bauer" } } };
  metaRows = [];
  insertFails = false;
  inserts.length = 0;
  deletes.length = 0;
  perms = new Set(["donations:issue-receipts"]);
});

describe("POST /:id/receipt-file", () => {
  it.each([["pdf", PDF, "application/pdf"], ["png", PNG, "image/png"]])("stores a valid %s by magic bytes", async (_n, bytes, type) => {
    const res = await upload(bytes, { name: "evil.exe" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`/donations/${ID}/edit`);
    expect(inserts[0]).toMatchObject({ donationId: ID, contentType: type, size: bytes.length, uploadedBy: "u1" });
    expect(await readReceiptFile(ID)).toEqual(bytes);
  });

  it("replaces on type change without leftovers", async () => {
    await upload(PDF);
    await upload(PNG);
    expect(await readReceiptFile(ID)).toEqual(PNG);
    expect(inserts.map((i) => i.contentType)).toEqual(["application/pdf", "image/png"]);
  });

  it("rejects wrong magic bytes, empty and missing file with a flash", async () => {
    for (const body of [Buffer.from("<svg/>"), Buffer.alloc(0), null]) {
      const res = await upload(body);
      expect(res.headers.get("location")).toBe(`/donations/${ID}/edit`);
      expect(flashOf(res)).toContain("error");
    }
    expect(inserts).toHaveLength(0);
    expect(existsSync(join(process.env.UPLOAD_PATH!, "donations", ID))).toBe(false);
  });

  it("rejects files over 5 MB and over the body limit without a bare 413", async () => {
    const over = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
    expect((await upload(over)).status).toBe(302);
    const huge = Buffer.concat([PDF, Buffer.alloc(6 * 1024 * 1024)]);
    const res = await upload(huge);
    expect(res.status).toBe(302);
    expect(flashOf(res)).toContain("error");
    expect(inserts).toHaveLength(0);
  });

  it("removes the file again when the DB write fails", async () => {
    insertFails = true;
    const res = await upload(PDF);
    expect(flashOf(res)).toContain("error");
    expect(existsSync(join(process.env.UPLOAD_PATH!, "donations", ID))).toBe(false);
  });

  it("needs donations:issue-receipts", async () => {
    perms = new Set(["donations:record"]);
    expect((await upload(PDF)).status).toBe(403);
  });

  it("rejects a foreign or missing Origin (CSRF)", async () => {
    expect((await upload(PDF, { origin: "https://evil.test" })).status).toBe(403);
    expect((await upload(PDF, { origin: null })).status).toBe(403);
    expect(inserts).toHaveLength(0);
  });

  it("404 for an unknown donation", async () => {
    donation = undefined;
    expect((await upload(PDF)).status).toBe(404);
  });
});

describe("GET /:id/receipt-file", () => {
  it("serves the stored file inline with its stored type and nosniff", async () => {
    await writeReceiptFile(ID, PDF);
    metaRows = [{ contentType: "application/pdf" }];
    const res = await donationRoutes.request(`/${ID}/receipt-file`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="Zuwendungsbestaetigung_Bauer_Anna_2026-03-01_.*\.pdf"$/);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(PDF);
  });

  it("404 without row, without file, for an unknown donation; 403 without right", async () => {
    expect((await donationRoutes.request(`/${ID}/receipt-file`)).status).toBe(404);
    metaRows = [{ contentType: "application/pdf" }];
    expect((await donationRoutes.request(`/${ID}/receipt-file`)).status).toBe(404);
    donation = undefined;
    expect((await donationRoutes.request(`/${ID}/receipt-file`)).status).toBe(404);
    perms = new Set(["donations:read"]);
    expect((await donationRoutes.request(`/${ID}/receipt-file`)).status).toBe(403);
  });
});

describe("POST /:id/receipt-file/delete", () => {
  const del = (origin = ORIGIN) => donationRoutes.request(`/${ID}/receipt-file/delete`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: "" });

  it("removes row and file", async () => {
    await writeReceiptFile(ID, PDF);
    const res = await del();
    expect(res.headers.get("location")).toBe(`/donations/${ID}/edit`);
    expect(deletes).toHaveLength(1);
    await expect(readReceiptFile(ID)).rejects.toThrow();
  });

  it("CSRF, permission and unknown donation are rejected", async () => {
    expect((await del("https://evil.test")).status).toBe(403);
    donation = undefined;
    expect((await del()).status).toBe(404);
    perms = new Set(["donations:record"]);
    expect((await del()).status).toBe(403);
  });
});

describe("POST /:id/delete removes the file", () => {
  it("deletes the stored file before the DB row", async () => {
    perms = new Set(["donations:delete"]);
    donation = { ...donation, receiptStatus: "open" };
    await writeReceiptFile(ID, PDF);
    const res = await donationRoutes.request(`/${ID}/delete`, { method: "POST" });
    expect(res.headers.get("location")).toBe("/donations");
    await expect(readReceiptFile(ID)).rejects.toThrow();
  });
});
