export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

type ListUrlValue = string | number | string[] | undefined | null;

// Rebuilds a list page's URL from its current state plus field overrides —
// e.g. click a sort column while keeping search/filters/pagination intact.
export function buildListUrl(
  path: string,
  current: Record<string, ListUrlValue>,
  overrides: Record<string, ListUrlValue> = {},
): string {
  const merged: Record<string, ListUrlValue> = { ...current, ...overrides };
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) { for (const x of v) params.append(k, x); }
    else params.set(k, String(v));
  }
  return `${path}?${params}`;
}

export function parsePagination(q: Record<string, string>): { page: number; pageSize: number } {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
  return { page, pageSize };
}
