import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectReceiptType, writeReceiptFile, readReceiptFile, removeReceiptFile } from "../lib/receipt-files.js";

const ID = "11111111-1111-4111-8111-111111111111";

describe("receipt files", () => {
  it("detects types by magic bytes only", () => {
    expect(detectReceiptType(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
    expect(detectReceiptType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(detectReceiptType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectReceiptType(Buffer.from("<svg"))).toBeNull();
    expect(detectReceiptType(Buffer.alloc(0))).toBeNull();
  });
  it("writes, reads, removes and rejects non-uuid ids", async () => {
    process.env.UPLOAD_PATH = mkdtempSync(join(tmpdir(), "uploads-"));
    await writeReceiptFile(ID, Buffer.from("%PDF-x"));
    expect((await readReceiptFile(ID)).toString()).toBe("%PDF-x");
    await removeReceiptFile(ID);
    await expect(readReceiptFile(ID)).rejects.toThrow();
    await expect(writeReceiptFile("../x", Buffer.from("a"))).rejects.toThrow();
  });
});
