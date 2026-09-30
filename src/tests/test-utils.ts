export function formBody(fields: Record<string, string | string[]>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) {
    for (const val of Array.isArray(v) ? v : [v]) params.append(k, val);
  }
  return params;
}
