import { Icon } from "./icon.js";
import type { IconName } from "./icons.generated.js";

// Action button inside a table row: icon always, label only from md up (see style guide "Responsive thresholds").
// aria-label is always the label; title falls back to it (disabled buttons carry their reason in title).
export function RowAction({ icon, label, class: cls = "btn-ghost", href, type = "button", onclick, disabled, title, attrs }: {
  icon: IconName;
  label: string;
  class?: string; // daisyUI classes, e.g. "btn-outline btn-error", "join-item"
  href?: string;
  type?: "submit" | "button";
  onclick?: string;
  disabled?: boolean;
  title?: string;
  attrs?: Record<string, string>; // e.g. hx-post, hx-confirm
}) {
  const inner = (<>
    <Icon name={icon} class="h-4 w-4 shrink-0" />
    <span class="max-md:hidden">{label}</span>
  </>);
  const c = `btn btn-xs row-action ${cls}`;
  return href ? (
    <a href={href} class={c} onclick={onclick} {...attrs} aria-label={label} title={title ?? label}>{inner}</a>
  ) : (
    <button type={type} class={c} onclick={onclick} disabled={disabled} {...attrs} aria-label={label} title={title ?? label}>{inner}</button>
  );
}
