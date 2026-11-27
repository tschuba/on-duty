import { mkdir, readFile, rm, writeFile, access, constants } from "node:fs/promises";
import { join } from "node:path";

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
export const RECEIPT_EXT: Record<string, string> = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png" };

const MAGIC: [string, number[]][] = [
  ["application/pdf", [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
];

/** MIME type derived from magic bytes only; the client's content type is never trusted. */
export function detectReceiptType(buf: Uint8Array): string | null {
  return MAGIC.find(([, m]) => m.every((b, i) => buf[i] === b))?.[0] ?? null;
}

const root = () => process.env.UPLOAD_PATH || "./uploads";
// Only UUIDs reach the filesystem (ids come from the DB lookup, the guard is defensive).
const UUID = /^[0-9a-f-]{36}$/i;
const path = (id: string) => {
  if (!UUID.test(id)) throw new Error("invalid donation id");
  return join(root(), "donations", id);
};

export async function ensureUploadDir(): Promise<void> {
  const dir = join(root(), "donations");
  await mkdir(dir, { recursive: true });
  await access(dir, constants.W_OK);
}
export async function writeReceiptFile(id: string, body: Uint8Array): Promise<void> {
  await mkdir(join(root(), "donations"), { recursive: true });
  await writeFile(path(id), body);
}
export const readReceiptFile = (id: string): Promise<Buffer> => readFile(path(id));
export const removeReceiptFile = (id: string): Promise<void> => rm(path(id), { force: true });
