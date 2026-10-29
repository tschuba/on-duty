import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({ BACKUP_STATUS_FILE: undefined as string | undefined, BACKUP_STATUS_MAX_AGE_HOURS: 26 }));
vi.mock("../env.js", () => ({ env: mockEnv }));
const { getBackupStatus } = await import("../lib/backup.js");

const dir = mkdtempSync(join(tmpdir(), "backup-"));
const write = (body: string) => {
  const f = join(dir, "status.json");
  writeFileSync(f, body);
  mockEnv.BACKUP_STATUS_FILE = f;
};
const now = new Date("2024-01-02T12:00:00Z");

describe("getBackupStatus", () => {
  it("unconfigured without file env", async () => {
    mockEnv.BACKUP_STATUS_FILE = undefined;
    expect((await getBackupStatus(now)).state).toBe("unconfigured");
  });
  it("unknown for missing or invalid file", async () => {
    mockEnv.BACKUP_STATUS_FILE = join(dir, "nope.json");
    expect((await getBackupStatus(now)).state).toBe("unknown");
    write("not json");
    expect((await getBackupStatus(now)).state).toBe("unknown");
  });
  it("ok when fresh success", async () => {
    write('{"timestamp":"2024-01-02T06:00:00Z","status":"success","lastSuccess":"2024-01-02T06:00:00Z"}');
    expect((await getBackupStatus(now)).state).toBe("ok");
  });
  it("stale when success older than threshold", async () => {
    write('{"timestamp":"2024-01-01T06:00:00Z","status":"success","lastSuccess":"2024-01-01T06:00:00Z"}');
    expect((await getBackupStatus(now)).state).toBe("stale");
  });
  it("failed keeps lastSuccess (also null)", async () => {
    write('{"timestamp":"2024-01-02T06:00:00Z","status":"failed","lastSuccess":null}');
    const s = await getBackupStatus(now);
    expect(s.state).toBe("failed");
    expect(s.lastSuccess).toBeNull();
  });
});
