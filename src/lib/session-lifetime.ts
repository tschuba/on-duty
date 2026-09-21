const MULTIPLIERS = { d: 86400, h: 3600, m: 60, s: 1 } as const;

// Returns seconds. Integer input = minutes; string like "7d" / "24h" / "30m".
export function parseSessionLifetime(value: string): number {
  const n = Number(value);
  if (!isNaN(n) && value.trim() !== "") return n * 60;

  const match = value.match(/^(\d+)(d|h|m|s)$/);
  if (!match) return 7 * 86400; // fallback: 7 days
  return Number(match[1]) * MULTIPLIERS[match[2] as keyof typeof MULTIPLIERS];
}
