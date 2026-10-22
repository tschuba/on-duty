import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  env: { BACKUP_LOCAL_PATH: "/b", S3_ENDPOINT: undefined as string | undefined, BACKUP_SCHEDULE: "* * * * *", BACKUP_RETENTION_COUNT: 3, S3_BUCKET: "b", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "s" },
  dumpErr: null as Error | null,
  s3Send: vi.fn(),
}));

vi.mock("../env.js", () => ({ env: h.env }));
vi.mock("../db/index.js", () => ({ db: { insert: () => ({ values: () => Promise.resolve() }) } }));
vi.mock("node-cron", () => ({ default: { schedule: vi.fn((_e: string, cb: () => void) => { cb(); return { stop() {} }; }) } }));
vi.mock("node:child_process", () => ({ execFile: (_c: string, _a: string[], cb: (e: Error | null) => void) => cb(h.dumpErr) }));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class { send = h.s3Send; },
  PutObjectCommand: class {}, ListObjectsV2Command: class {}, DeleteObjectCommand: class {},
}));
vi.mock("node:fs", () => ({
  constants: { W_OK: 2 },
  promises: {
    access: vi.fn(), copyFile: vi.fn(), readdir: vi.fn(async () => []), readFile: vi.fn(async () => Buffer.from("")),
    unlink: vi.fn(async () => {}),
  },
}));

import { promises as fs } from "node:fs";
import { logger } from "../lib/logger.js";
import { runBackup, startBackupScheduler } from "../lib/backup.js";

describe("backup logging", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    h.dumpErr = null;
    h.env.S3_ENDPOINT = undefined;
    h.env.BACKUP_LOCAL_PATH = "/b";
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.spyOn(logger, "info").mockImplementation(() => {});
  });

  it("logs pg_dump failure", async () => {
    h.dumpErr = new Error("dump");
    await runBackup();
    expect(logger.error).toHaveBeenCalledWith({ err: h.dumpErr }, "[backup] pg_dump failed");
  });

  it("logs local write failure", async () => {
    vi.mocked(fs.copyFile).mockRejectedValueOnce(new Error("disk"));
    await runBackup();
    expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, "[backup] local write failed");
  });

  it("logs S3 write failure", async () => {
    h.env.BACKUP_LOCAL_PATH = undefined as never;
    h.env.S3_ENDPOINT = "http://s3";
    h.s3Send.mockRejectedValueOnce(new Error("s3"));
    await runBackup();
    expect(logger.error).toHaveBeenCalledWith({ err: expect.any(Error) }, "[backup] S3 write failed");
  });

  it("exits when the local path is not writable", async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error("ro"));
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    h.env.BACKUP_LOCAL_PATH = "/b";
    await startBackupScheduler();
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith({ path: "/b", reason: "ro" }, expect.any(String));
  });

  it("warns when no target is configured", async () => {
    h.env.BACKUP_LOCAL_PATH = undefined as never;
    await startBackupScheduler();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("logs the unhandled error of a scheduled run and the start", async () => {
    h.dumpErr = new Error("x");
    await startBackupScheduler();
    expect(logger.info).toHaveBeenCalledWith({ schedule: "* * * * *" }, expect.any(String));
  });
});
