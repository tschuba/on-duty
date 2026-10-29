type Tone = "error" | "warning";
const toneClass = (tone?: Tone) => (tone ? `badge-${tone}` : "badge-ghost");

// Einheitlicher Bereich mit Überschrift: einklappbar (<details>) oder fest sichtbar, gleiche Optik.
export function Section({ id, title, badge, badge2, tone, open, collapsible = true, class: cls = "", attrs, actions, children }: {
  id?: string; title: string; badge?: string | number; badge2?: string; tone?: Tone; open?: boolean; collapsible?: boolean;
  // Rechts im Titel; bei einklappbaren Bereichen nur sichtbar, solange der Bereich offen ist.
  actions?: unknown;
  class?: string; attrs?: Record<string, string>; children: unknown;
}) {
  const titleClass = "bg-base-300 text-lg font-bold flex items-center gap-2";
  const heading = (
    <>
      {title}
      {badge !== undefined && badge !== "" && <span class={`badge badge-sm ${toneClass(tone)}`}>{badge}</span>}
      {badge2 && <span class="badge badge-sm badge-warning">{badge2}</span>}
      {actions ? <span class="section-actions flex flex-1 justify-end font-normal" style="font-family: var(--font-body)">{actions as never}</span> : null}
    </>
  );
  const box = `border border-base-300 bg-base-100 mb-3 scroll-mt-32 ${cls}`;
  if (!collapsible) {
    return (
      <section id={id} class={`rounded-box ${box}`} {...attrs}>
        <h2 class={`@container ${titleClass} rounded-t-box px-4 py-4`} style="font-family: var(--font-heading)">{heading}</h2>
        <div class="p-4">{children as never}</div>
      </section>
    );
  }
  return (
    <details id={id} class={`collapse collapse-arrow ${box}`} open={open} {...attrs}>
      <summary class={`collapse-title @container ${titleClass}`} style="font-family: var(--font-heading)">{heading}</summary>
      <div class="collapse-content overflow-x-auto pt-4">{children as never}</div>
    </details>
  );
}
