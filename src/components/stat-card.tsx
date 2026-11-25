import type { Child } from "hono/jsx";
import { Icon } from "./icon.js";

// Statistikkachel. Mit `href` klickbar: `funnel` = filtert die Liste, `arrow-right` = wechselt die Ansicht.
// Doku: docs/style-guide.md → „Statistikkarten".
export function StatCard({ label, value, tone, href, link, inline, highlight, selected, hint, children }: {
  selected?: boolean; // Liste ist genau auf diese Karte gefiltert; Klick hebt den Filter auf
  hint?: string; // kleine Zeile unter dem Label
  highlight?: boolean; // Aufmerksamkeit: Ring, Glow, getönter Hintergrund
  label: string;
  value: Child;
  tone?: string; // Textfarbe der Zahl, z. B. "text-error"
  href?: string;
  link?: "filter" | "view";
  inline?: boolean; // Zahl und children nebeneinander (Mitglieder: Geschlechter-Aufteilung)
  children?: Child; // z. B. stat-desc
}) {
  const num = <div class={`stat-value text-2xl @4xl:text-3xl${tone ? ` ${tone}` : ""}`}>{value}</div>;
  const body = (
    <>
      {href && <Icon name={selected ? "icon-[tabler--x]" : link === "view" ? "icon-[tabler--arrow-right]" : "icon-[tabler--filter]"} class="absolute top-2 right-2 w-4 h-4 opacity-50" />}
      <div class="stat-title text-xs">{label}{hint && <span class="block opacity-60">{hint}</span>}</div>
      {inline
        ? <div class="flex flex-wrap items-baseline gap-x-2">{num}{children}</div>
        : <>{num}{children}</>}
    </>
  );
  const cls = `stat ${highlight ? "bg-base-200 text-base-content" : "bg-base-200"} rounded-box px-3 py-2 @4xl:p-4 relative${selected ? " ring-2 ring-primary" : ""}`;
  const card = href
    ? <a href={href} aria-current={selected ? "true" : undefined} class={`${cls} hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-primary`}>{body}</a>
    : <div class={cls}>{body}</div>;
  // daisyUI-Aura: Wrapper mit rotierendem Lichtrand; Farbe über text-*
  return highlight ? <div class="aura aura-gold flex">{card}</div> : card;
}

/** Responsiver Raster-Wrapper: 1 Spalte → 2 → 3 → alle `cols` Karten in einer Zeile (Container-Breite). */
export function StatGrid({ id, cols, class: cls, children }: { id: string; cols: number; class?: string; children?: Child }) {
  return (
    <div id={id} class={`@container mb-6${cls ? ` ${cls}` : ""}`}>
      <div style={`--stat-cols:${cols}`} class="grid auto-rows-fr grid-cols-1 @xs:grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-[repeat(var(--stat-cols),minmax(0,1fr))] gap-2 @4xl:gap-4">
        {children}
      </div>
    </div>
  );
}
