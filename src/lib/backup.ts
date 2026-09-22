import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import { join } from "node:path";
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import cron from "node-cron";
import { desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { backupHistory } from "../db/schema/index.js";
import { env } from "../env.js";

let running = false;

type TargetResult = { type: "local" | "s3"; status: "success" | "error"; error?: string };

function pgDump(outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile("pg_dump", ["-Fc", `--dbname=${env.DATABASE_URL}`, "-f", outFile], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function writeLocal(tempFile: string, filename: string): Promise<TargetResult> {
  try {
    await fs.copyFile(tempFile, join(env.BACKUP_LOCAL_PATH!, filename));
    await applyRetentionLocal();
    return { type: "local", status: "success" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[backup] local write failed:", error);
    return { type: "local", status: "error", error };
  }
}

async function applyRetentionLocal(): Promise<void> {
  const dir = env.BACKUP_LOCAL_PATH!;
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".dump")).sort();
  const excess = files.slice(0, Math.max(0, files.length - env.BACKUP_RETENTION_COUNT));
  await Promise.all(excess.map((f) => fs.unlink(join(dir, f))));
}

let s3Client: S3Client | null = null;
function getS3(): S3Client {
  return (s3Client ??= new S3Client({
    endpoint: env.S3_ENDPOINT!,
    region: env.S3_REGION ?? "us-east-1",
    credentials: { accessKeyId: env.S3_ACCESS_KEY!, secretAccessKey: env.S3_SECRET_KEY! },
    forcePathStyle: true,
  }));
}

async function writeS3(tempFile: string, filename: string): Promise<TargetResult> {
  try {
    const key = (env.S3_PREFIX ?? "") + filename;
    await getS3().send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET!, Key: key, Body: await fs.readFile(tempFile) }),
    );
    await applyRetentionS3();
    return { type: "s3", status: "success" };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[backup] S3 write failed:", error);
    return { type: "s3", status: "error", error };
  }
}

async function applyRetentionS3(): Promise<void> {
  const prefix = env.S3_PREFIX ?? "";
  const res = await getS3().send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET!, Prefix: prefix }));
  const sorted = (res.Contents ?? [])
    .filter((o) => o.Key?.endsWith(".dump"))
    .sort((a, b) => (a.LastModified?.getTime() ?? 0) - (b.LastModified?.getTime() ?? 0));
  const excess = sorted.slice(0, Math.max(0, sorted.length - env.BACKUP_RETENTION_COUNT));
  await Promise.all(
    excess.map((o) => getS3().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET!, Key: o.Key! }))),
  );
}

export async function runBackup(): Promise<void> {
  if (running) return;
  running = true;
  const startedAt = new Date();
  const ts = startedAt.toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const filename = `backup_${ts}.dump`;
  const tempFile = join("/tmp", filename);
  const results: TargetResult[] = [];
  try {
    await pgDump(tempFile);
    if (env.BACKUP_LOCAL_PATH) results.push(await writeLocal(tempFile, filename));
    if (env.S3_ENDPOINT) results.push(await writeS3(tempFile, filename));
    const status = results.some((r) => r.status === "error") ? "failed" : "success";
    await db.insert(backupHistory).values({ startedAt, finishedAt: new Date(), status, targets: JSON.stringify(results) });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[backup] pg_dump failed:", error);
    await db
      .insert(backupHistory)
      .values({ startedAt, finishedAt: new Date(), status: "failed", targets: JSON.stringify(results), errorMessage: error });
  } finally {
    running = false;
    await fs.unlink(tempFile).catch(() => {});
  }
}

export async function getLastBackup() {
  const rows = await db.select().from(backupHistory).orderBy(desc(backupHistory.startedAt)).limit(1);
  return rows[0] ?? null;
}

export function isBackupConfigured(): boolean {
  return !!(env.BACKUP_LOCAL_PATH || env.S3_ENDPOINT);
}

export function getCronScheduleTimes(expression: string): { prev: Date | null; next: Date | null } {
  const task = cron.schedule(expression, () => {});
  // ponytail: accesses internal timeMatcher — node-cron v4 exposes it as a public property
  const matcher = (task as any).timeMatcher as { getNextMatch(d: Date): Date | null };
  const now = new Date();
  const next = matcher.getNextMatch(now) ?? null;
  let prev: Date | null = null;
  let cursor = new Date(now.getTime() - 35 * 24 * 60 * 60 * 1000);
  for (let i = 0; i < 1000; i++) {
    const candidate = matcher.getNextMatch(cursor);
    if (!candidate || candidate >= now) break;
    prev = candidate;
    cursor = new Date(candidate.getTime() + 60_000);
  }
  task.stop();
  return { prev, next };
}

export async function startBackupScheduler(): Promise<void> {
  if (env.BACKUP_LOCAL_PATH) {
    try {
      await fs.access(env.BACKUP_LOCAL_PATH, constants.W_OK);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`BACKUP_LOCAL_PATH "${env.BACKUP_LOCAL_PATH}" nicht schreibbar: ${reason}`);
      process.exit(1);
    }
  }
  if (!isBackupConfigured()) {
    console.warn("[backup] Kein Backup-Ziel konfiguriert — Scheduler nicht gestartet.");
    return;
  }
  cron.schedule(env.BACKUP_SCHEDULE, () => {
    runBackup().catch((err) => console.error("[backup] Unbehandelter Fehler:", err));
  });
  console.log(`[backup] Scheduler gestartet (${env.BACKUP_SCHEDULE})`);
}
