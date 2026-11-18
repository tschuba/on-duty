import type { Child } from "hono/jsx";
import { Icon } from "./icon.js";

// Statistikkachel. Mit `href` klickbar: `funnel` = filtert die Liste, `arrow-right` = wechselt die Ansicht.
// Doku: docs/style-guide.md → „Statistikkarten".
export function StatCard({ label, value, tone, href, link, inline, highlight, children }: {
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
      {href && <Icon name={link === "view" ? "arrow-right" : "funnel"} class="absolute top-2 right-2 w-4 h-4 opacity-50" />}
      <div class="stat-title text-xs">{label}</div>
      {inline
        ? <div class="flex flex-wrap items-baseline gap-x-2">{num}{children}</div>
        : <>{num}{children}</>}
    </>
  );
  const cls = `stat ${highlight ? "bg-base-200 text-base-content" : "bg-base-200"} rounded-box px-3 py-2 @4xl:p-4 relative`;
  const card = href
    ? <a href={href} class={`${cls} hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-primary`}>{body}</a>
    : <div class={cls}>{body}</div>;
  // daisyUI-Aura: Wrapper mit rotierendem Lichtrand; Farbe über text-*
  return highlight ? <div class="aura aura-gold flex">{card}</div> : card;
}
