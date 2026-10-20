// Pure helpers for role types (Spec 47): validation of type+flag and ordering.

/** The final state counts: a role may only grant active status if its type allows it. */
export function flagAllowed(grantsActiveStatus: boolean, type: { allowsActiveStatus: boolean }): boolean {
  return !grantsActiveStatus || type.allowsActiveStatus;
}

/** Moves `id` one step up/down; returns the new order (unchanged at the edges / for unknown ids). */
export function moveId(ids: string[], id: string, dir: "up" | "down"): string[] {
  const i = ids.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** A posted order is valid only if it is a permutation of the current ids (stays within one group). */
export function isPermutation(posted: string[], current: string[]): boolean {
  return posted.length === current.length && new Set(posted).size === posted.length && posted.every((p) => current.includes(p));
}
