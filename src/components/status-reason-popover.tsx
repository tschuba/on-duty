import { Icon } from "./icon.js";
import { StatusBadge, STATUS_LABELS } from "./status-badge.js";
import { formatDate } from "../lib/format.js";
import { t } from "../i18n/index.js";
import type { MemberStatus, StatusReason } from "../lib/status.js";

// Hilfeanker je Grund (/help/members); case-1..3 sind die Fehlerfälle "Erwartet Aktiv, ist Fördernd" / "Passiv".
const HELP_HREF: Record<StatusReason["kind"], string> = {
  deceased: "#status", left: "#status", runningRole: "#status", passiveAtCutoff: "#status",
  noOpenRole: "#case-1", openRoleNotActive: "#case-2", noRoleAtCutoff: "#case-3",
};

export function statusReasonText(status: MemberStatus, r: StatusReason): string {
  switch (r.kind) {
    case "deceased": return t("members.statusReason.deceased", { datum: formatDate(r.date) });
    case "left": return t("members.statusReason.left", { datum: formatDate(r.date) });
    case "runningRole":
      return status === "active"
        ? t("members.statusReason.active", { titel: r.roleTitle })
        : t("members.statusReason.ageGroup", { status: STATUS_LABELS[status], titel: r.roleTitle, alter: r.age });
    case "passiveAtCutoff": return t("members.statusReason.passive", { alter: r.age, titel: r.roleTitle, datum: formatDate(r.cutoff), grenze: r.limit });
    case "noOpenRole": return t("members.statusReason.noOpenRole");
    case "openRoleNotActive": return t("members.statusReason.openRoleNotActive", { titel: r.roleTitle });
    case "noRoleAtCutoff": return t("members.statusReason.noRoleAtCutoff", { datum: formatDate(r.cutoff), grenze: r.limit });
  }
}

// Hover (nur Maus) blendet ein/aus, Klick heftet an bzw. löst; Esc/Klick daneben schließt.
const SCRIPT = `
if (!window.__statusReasonBound) {
  window.__statusReasonBound = true;
  const pop = (el) => { const b = el.closest && el.closest('[data-status-reason]'); return b && { b, p: document.getElementById(b.dataset.statusReason) }; };
  const show = (x) => { x.p.showPopover(); x.b.setAttribute('aria-expanded', 'true'); };
  const hide = (x) => { if (x.p.matches(':popover-open')) x.p.hidePopover(); x.b.setAttribute('aria-expanded', 'false'); x.b.dataset.pinned = ''; };
  const wrap = (el) => el.closest && el.closest('[data-status-reason-wrap]');
  document.addEventListener('pointerover', (e) => { const w = wrap(e.target); if (e.pointerType !== 'mouse' || !w || w.contains(e.relatedTarget)) return; show(pop(w.querySelector('[data-status-reason]'))); });
  document.addEventListener('pointerout', (e) => { const w = wrap(e.target); if (e.pointerType !== 'mouse' || !w || w.contains(e.relatedTarget)) return; const x = pop(w.querySelector('[data-status-reason]')); if (!x.b.dataset.pinned) hide(x); });
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('.status-reason-popover a');
    if (a && !matchMedia('(display-mode: standalone)').matches) { a.target = '_blank'; a.rel = 'noopener'; }
    const x = e.target.closest && pop(e.target);
    if (x && e.target.closest('button')) { if (x.b.dataset.pinned) hide(x); else { x.b.dataset.pinned = '1'; show(x); } return; }
    document.querySelectorAll('[data-status-reason][data-pinned="1"]').forEach((b) => { if (!wrap(e.target) || wrap(e.target) !== wrap(b)) hide({ b, p: document.getElementById(b.dataset.statusReason) }); });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('[data-status-reason]').forEach((b) => hide({ b, p: document.getElementById(b.dataset.statusReason) })); });
}`;

let seq = 0;

export function StatusReasonPopover({ status, reason }: { status: MemberStatus; reason: StatusReason }) {
  const id = `status-reason-${++seq}`;
  return (
    <span class="inline-block align-middle" data-status-reason-wrap>
      <button type="button" class="inline-flex items-center gap-1 cursor-pointer rounded" data-status-reason={id} aria-expanded="false" aria-controls={id} aria-label={`${STATUS_LABELS[status]}: ${t("members.statusReason.aria")}`} style={`anchor-name:--${id}`}>
        <StatusBadge status={status} /><Icon name="icon-[tabler--info-circle]" class="h-4 w-4 opacity-60" />
      </button>
      <div id={id} popover="manual" class="status-reason-popover bg-base-100 border border-base-300 rounded-box shadow p-3 text-sm font-normal whitespace-normal text-left" style={`position-anchor:--${id};font-family:var(--font-body)`}>
        <p class="max-w-[min(20rem,90vw)]">{statusReasonText(status, reason)}</p>
        <a href={`/help/members${HELP_HREF[reason.kind]}`} class="link link-primary mt-2 inline-block">{t("members.statusReason.more")}</a>
      </div>
      <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
    </span>
  );
}
