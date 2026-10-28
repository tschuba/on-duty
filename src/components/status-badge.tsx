import { Icon } from "./icon.js";
import type { MemberStatus } from "../lib/status.js";
import { t } from "../i18n/index.js";

export const STATUS_LABELS: Record<MemberStatus, string> = {
  active: t("status.active"),
  passive: t("status.passive"),
  supporting: t("status.supporting"),
  children: t("status.children"),
  youth: t("status.youth"),
  left: t("status.left"),
  deceased: t("status.deceased"),
};

export const STATUS_BADGE_CLASS: Record<MemberStatus, string> = {
  active: "badge badge-sm badge-success",
  passive: "badge badge-sm badge-neutral",
  supporting: "badge badge-sm badge-secondary",
  children: "badge badge-sm badge-warning",
  youth: "badge badge-sm badge-info",
  left: "badge badge-sm badge-ghost opacity-60",
  deceased: "",
};

// Verstorbene: Kreuz statt Badge; compact (Tabellen) nur Icon im Badge-Format, sonst Icon + Text.
export function StatusBadge({ status, compact = false }: { status: MemberStatus; compact?: boolean }) {
  if (status === "deceased") {
    const label = STATUS_LABELS.deceased;
    return compact ? (
      <span class="badge badge-sm badge-ghost opacity-60" title={label} role="img" aria-label={label}><Icon name="cross" class="w-3.5 h-3.5" /></span>
    ) : (
      <span class="badge badge-sm badge-ghost opacity-60 gap-1"><Icon name="cross" class="w-3.5 h-3.5" />{label}</span>
    );
  }
  return <span class={STATUS_BADGE_CLASS[status]}>{STATUS_LABELS[status]}</span>;
}
