// Statusfarbiger Pin als divIcon, geteilt von Inventarkarte und Detailansicht.
import L from "leaflet";

export type Status = "none" | "ok" | "soon" | "overdue";

export const COLOR: Record<Status, string> = { none: "var(--color-neutral)", ok: "var(--color-success)", soon: "var(--color-warning)", overdue: "var(--color-error)" };
const SIGN: Record<Status, string> = { none: "", ok: "✓", soon: "!", overdue: "⚠" };

export const pin = (status: Status, icon: string) =>
  L.divIcon({
    className: "",
    iconSize: [34, 42],
    iconAnchor: [17, 42],
    popupAnchor: [0, -38],
    html: `<div class="relative" style="width:34px;height:42px;color:${COLOR[status]}">
      <svg viewBox="0 0 34 42" width="34" height="42"><path d="M17 41C17 41 2 26 2 15a15 15 0 0 1 30 0c0 11-15 26-15 26z" fill="currentColor" stroke="white" stroke-width="2"/></svg>
      <span class="absolute left-1.5 top-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-base-100 text-base-content [&>svg]:h-4 [&>svg]:w-4">${icon}</span>
      ${SIGN[status] ? `<span class="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-base-100 text-[11px] font-bold leading-none text-base-content ring-1 ring-current" style="color:${COLOR[status]}">${SIGN[status]}</span>` : ""}
    </div>`,
  });
