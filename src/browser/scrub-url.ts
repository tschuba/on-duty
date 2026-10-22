// Path pattern: strip IDs (UUID/numeric), drop query/hash.
export function scrubUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/\/(?:[0-9a-f]{8}-[0-9a-f-]{27}|\d+)(?=\/|$)/gi, "/:id");
  } catch {
    return url;
  }
}
