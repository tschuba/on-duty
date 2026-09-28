// Permission keys are added alongside the feature that enforces them, not upfront —
// see the backlog's 05_RBAC-Rollensystem.md reversal note. Each future feature doc
// (Inventar, Ausbildungsverzeichnis, Spenden, Digitale Anträge) lists which key(s) it adds.
export const PERMISSIONS = [
  "members:read",
  "members:write",
  "system:admin",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
