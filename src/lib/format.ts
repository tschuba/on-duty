export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}.${m}.${y}`;
}
