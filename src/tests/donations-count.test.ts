import { describe, it, expect, vi } from "vitest";
import { donations } from "../db/schema/index.js";

const whereArg = vi.fn();
vi.mock("../db/index.js", () => ({
  db: { select: () => ({ from: () => ({ where: (w: unknown) => { whereArg(w); return Promise.resolve([{ id: "1" }, { id: "2" }]); } }) }) },
}));

import { countOpenReceipts } from "../lib/donations.js";

describe("countOpenReceipts", () => {
  it("counts rows filtered by receiptStatus = open", async () => {
    expect(await countOpenReceipts()).toBe(2);
    const w = JSON.stringify(whereArg.mock.calls[0][0], (_k, v) => (typeof v === "object" && v && "dataType" in v ? undefined : v));
    expect(w).toContain("open");
    expect(donations.receiptStatus.name).toBe("receipt_status");
  });
});
