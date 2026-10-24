import { Icon } from "./icon.js";
import type { MemberStatus } from "../lib/status.js";
import { t } from "../i18n/index.js";

export const STATUS_LABELS: Record<MemberStatus, string> = {
  aktiv: t("status.aktiv"),
  passiv: t("status.passiv"),
  foerdernd: t("status.foerdernd"),
  kinder: t("status.kinder"),
  jugend: t("status.jugend"),
  ausgetreten: t("status.ausgetreten"),
  verstorben: t("status.verstorben"),
};

export const STATUS_BADGE_CLASS: Record<MemberStatus, string> = {
  aktiv: "badge badge-sm badge-success",
  passiv: "badge badge-sm badge-neutral",
  foerdernd: "badge badge-sm badge-secondary",
  kinder: "badge badge-sm badge-warning",
  jugend: "badge badge-sm badge-info",
  ausgetreten: "badge badge-sm badge-ghost opacity-60",
  verstorben: "",
};

// Verstorbene: Kreuz statt Badge; compact (Tabellen) nur Icon im Badge-Format, sonst Icon + Text.
export function StatusBadge({ status, compact = false }: { status: MemberStatus; compact?: boolean }) {
  if (status === "verstorben") {
    const label = STATUS_LABELS.verstorben;
    return compact ? (
      <span class="badge badge-sm badge-ghost opacity-60" title={label} role="img" aria-label={label}><Icon name="cross" class="w-3.5 h-3.5" /></span>
    ) : (
      <span class="badge badge-sm badge-ghost opacity-60 gap-1"><Icon name="cross" class="w-3.5 h-3.5" />{label}</span>
    );
  }
  return <span class={STATUS_BADGE_CLASS[status]}>{STATUS_LABELS[status]}</span>;
}
