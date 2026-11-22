import type { MemberStatus } from "./status.js";

export const MEMBER_STATUSES: MemberStatus[] = ["children", "youth", "active", "passive", "supporting", "left", "deceased"];

/** "all" = unrestricted; otherwise the set of statuses a user may access. */
export type StatusScope = Set<MemberStatus> | "all";
export type MemberScope = { read: StatusScope; write: StatusScope; delete: StatusScope };
export const SCOPE_ALL: MemberScope = { read: "all", write: "all", delete: "all" };

export function inScope(scope: StatusScope | undefined, status: MemberStatus): boolean {
  return !scope || scope === "all" || scope.has(status);
}

/** Union over the roles holding the permission; any role without restriction (or empty list) wins as "all". */
export function unionScope(roleScopes: (MemberStatus[] | undefined)[]): StatusScope {
  const out = new Set<MemberStatus>();
  for (const s of roleScopes) {
    if (!s || s.length === 0) return "all";
    s.forEach((x) => out.add(x));
  }
  return roleScopes.length === 0 ? "all" : out;
}

export function parseStatuses(raw: unknown): MemberStatus[] {
  return ([] as unknown[]).concat(raw ?? []).filter((s): s is MemberStatus => (MEMBER_STATUSES as unknown[]).includes(s));
}

/** Ids of members the user may read; null = no restriction. Status is derived, so filtered in app code. */
export async function readableMemberIds(scope: StatusScope | undefined): Promise<((id: string | null | undefined) => boolean)> {
  if (!scope || scope === "all") return () => true;
  const [{ db }, { env }, { deriveMemberStatus }] = await Promise.all([import("../db/index.js"), import("../env.js"), import("./status.js")]);
  const rows = await db.query.members.findMany({ with: { person: true, assignments: { with: { role: true } } } });
  const ids = new Set(
    rows.filter(({ person, assignments, ...m }) =>
      scope.has(deriveMemberStatus({ ...m, birthDate: person!.birthDate! } as any, assignments as any, env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT))
    ).map((r) => r.id)
  );
  return (id) => !!id && ids.has(id);
}
