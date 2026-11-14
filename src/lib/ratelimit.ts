type Entry = { count: number; lockedUntil: number };
const store = new Map<string, Entry>();

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function checkRateLimit(ip: string): { allowed: boolean } {
  const now = Date.now();
  const entry = store.get(ip);
  if (entry && entry.lockedUntil > now) return { allowed: false };
  return { allowed: true };
}

export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = store.get(ip) ?? { count: 0, lockedUntil: 0 };
  // Only reset after an actual, previously-set lockout has expired — not for a fresh
  // entry, where lockedUntil defaults to 0 and is always "in the past" relative to
  // now, which used to reset count on every single call and made the lockout
  // (entry.count >= MAX_ATTEMPTS below) unreachable.
  if (entry.lockedUntil > 0 && entry.lockedUntil < now) entry.count = 0;
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) entry.lockedUntil = now + LOCKOUT_MS;
  store.set(ip, entry);
}

// Je Adresse höchstens eine Mail pro Fenster (Backlog 151); true = darf senden und merkt sich den Versand.
const ADDRESS_WINDOW_MS = 5 * 60 * 1000;
const sentTo = new Map<string, number>();
export function takeAddressSlot(address: string): boolean {
  const now = Date.now();
  for (const [k, at] of sentTo) if (at + ADDRESS_WINDOW_MS < now) sentTo.delete(k);
  if (sentTo.has(address)) return false;
  sentTo.set(address, now);
  return true;
}

export function resetRateLimit(ip: string): void {
  store.delete(ip);
}
