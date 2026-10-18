import { t } from "../i18n/index.js";

// Hover popover rendered in the top layer (Popover API + anchor positioning), so
// ancestors with overflow clipping (e.g. overflow-x-auto tables) cannot cut it off.
let popoverSeq = 0;

const HOVER_SCRIPT = `
if (!window.__rolePopoverBound) {
  window.__rolePopoverBound = true;
  const toggle = (e, show) => {
    const trigger = e.target.closest && e.target.closest('[data-role-popover]');
    const pop = trigger && document.getElementById(trigger.dataset.rolePopover);
    if (!pop) return;
    if (show) pop.showPopover(); else if (pop.matches(':popover-open')) pop.hidePopover();
  };
  document.addEventListener('mouseover', (e) => toggle(e, true));
  document.addEventListener('mouseout', (e) => toggle(e, false));
  document.addEventListener('focusin', (e) => toggle(e, true));
  document.addEventListener('focusout', (e) => toggle(e, false));
}`;

export function RolePopover({ roles, label }: { roles: string[]; label: string }) {
  const id = `role-popover-${++popoverSeq}`;
  return (
    <div onclick="event.stopPropagation()">
      <div
        tabindex={0}
        role="button"
        class="badge badge-neutral badge-sm cursor-pointer whitespace-nowrap"
        data-role-popover={id}
        style={`anchor-name:--${id}`}
      >
        {label}
      </div>
      <div id={id} popover="manual" class="role-popover bg-base-100 border border-base-300 rounded-box shadow p-2" style={`position-anchor:--${id}`}>
        <div class="flex flex-wrap gap-1 max-w-48">
          {roles.map((r) => <span class="badge badge-outline badge-sm whitespace-nowrap">{r}</span>)}
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: HOVER_SCRIPT }} />
    </div>
  );
}
