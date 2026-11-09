import { describe, it, expect, vi, beforeEach } from "vitest";

const mockEnv = vi.hoisted(() => ({ CAP_API_ENDPOINT: undefined as string | undefined, CAP_SECRET: undefined as string | undefined }));
vi.mock("../env.js", () => ({ env: mockEnv }));

const { verifyCap } = await import("../lib/cap.js");
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("verifyCap", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    mockEnv.CAP_API_ENDPOINT = "https://cap.example.org/key";
    mockEnv.CAP_SECRET = "s";
  });

  it("is a no-op when unconfigured", async () => {
    mockEnv.CAP_API_ENDPOINT = undefined;
    expect(await verifyCap(undefined)).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing token without calling the server", async () => {
    expect(await verifyCap("")).toBe("invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts secret and token to siteverify", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true })));
    expect(await verifyCap("tok")).toBe("ok");
    expect(fetchMock.mock.calls[0][0]).toBe("https://cap.example.org/key/siteverify");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ secret: "s", response: "tok" });
  });

  it("rejects success:false and 4xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ success: false })));
    expect(await verifyCap("tok")).toBe("invalid");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 400 }));
    expect(await verifyCap("tok")).toBe("invalid");
  });

  it("fails closed when the server is unreachable or 5xx", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"));
    expect(await verifyCap("tok")).toBe("unavailable");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));
    expect(await verifyCap("tok")).toBe("unavailable");
  });
});

describe("CapWidget", () => {
  it("renders nothing when unconfigured and the inline script when configured", async () => {
    vi.doMock("../lib/org-config.js", () => ({ loadOrgConfig: vi.fn(), privacyMode: vi.fn(), isImpressumComplete: vi.fn() }));
    const { CapWidget } = await import("../components/public-form.js");
    mockEnv.CAP_API_ENDPOINT = undefined;
    expect(String(CapWidget({}))).toBe("");
    mockEnv.CAP_API_ENDPOINT = "https://cap.example.org/key";
    mockEnv.CAP_SECRET = "s";
    const html = String(CapWidget({}));
    expect(html).toContain('id="cap-field"');
    expect(html).toContain("cap-msg");
  });
});
