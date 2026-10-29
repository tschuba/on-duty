import { promises as fs } from "node:fs";
import { env } from "../env.js";

// Status, den der Hook im Backup-Container nach jedem Lauf schreibt (siehe docs/backup.md).
export type BackupState = "ok" | "failed" | "stale" | "unknown" | "unconfigured";

export type BackupStatus = {
  state: BackupState;
  timestamp: Date | null;
  lastSuccess: Date | null;
};

const toDate = (v: unknown): Date | null => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

export async function getBackupStatus(now = new Date()): Promise<BackupStatus> {
  const file = env.BACKUP_STATUS_FILE;
  if (!file) return { state: "unconfigured", timestamp: null, lastSuccess: null };
  try {
    const j = JSON.parse(await fs.readFile(file, "utf8"));
    const timestamp = toDate(j.timestamp);
    const lastSuccess = toDate(j.lastSuccess);
    if (!timestamp || (j.status !== "success" && j.status !== "failed")) throw new Error("invalid");
    if (j.status === "failed") return { state: "failed", timestamp, lastSuccess };
    const stale = now.getTime() - timestamp.getTime() > env.BACKUP_STATUS_MAX_AGE_HOURS * 3600_000;
    return { state: stale ? "stale" : "ok", timestamp, lastSuccess: lastSuccess ?? timestamp };
  } catch {
    return { state: "unknown", timestamp: null, lastSuccess: null };
  }
}
