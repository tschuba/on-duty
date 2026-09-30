export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export function parsePagination(q: Record<string, string>): { page: number; pageSize: number } {
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = (PAGE_SIZE_OPTIONS as readonly number[]).includes(Number(q.pageSize)) ? Number(q.pageSize) : 25;
  return { page, pageSize };
}
