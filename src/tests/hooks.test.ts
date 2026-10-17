import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let file: string | undefined;
const handle = vi.fn();
const verify = vi.fn();
vi.mock("../env.js", () => ({ env: { get ZITADEL_WEBHOOK_SECRET_FILE() { return file; } } }));
vi.mock("../lib/zitadel-webhook.js", () => ({ handleZitadelEvent: (...a: unknown[]) => handle(...a), verifySignature: (...a: unknown[]) => verify(...a) }));

const { hookRoutes } = await import("../routes/hooks.js");
const post = () => hookRoutes.request("/zitadel", { method: "POST", body: "{}", headers: { "zitadel-signature": "s" } });

beforeEach(() => {
  handle.mockReset();
  verify.mockReset();
  const f = join(mkdtempSync(join(tmpdir(), "hook-")), "key");
  writeFileSync(f, "secret\n");
  file = f;
});

describe("POST /zitadel", () => {
  it("404 without configured key", async () => {
    file = undefined;
    expect((await post()).status).toBe(404);
  });
  it("404 when key file is missing", async () => {
    file = "/nonexistent/key";
    expect((await post()).status).toBe(404);
  });
  it("401 on bad signature", async () => {
    verify.mockReturnValue(false);
    expect((await post()).status).toBe(401);
  });
  it("200 with handler result", async () => {
    verify.mockReturnValue(true);
    handle.mockResolvedValue("created");
    const res = await post();
    expect(await res.json()).toEqual({ result: "created" });
    expect(verify.mock.calls[0][2]).toBe("secret");
  });
  it("500 when handler throws", async () => {
    verify.mockReturnValue(true);
    handle.mockRejectedValue(new Error("x"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await post()).status).toBe(500);
  });
});
