type Tone = "error" | "warning";
const toneClass = (tone?: Tone) => (tone ? `badge-${tone}` : "badge-ghost");

// Einheitlicher Bereich mit Überschrift: einklappbar (<details>) oder fest sichtbar, gleiche Optik.
export function Section({ id, title, badge, tone, open, collapsible = true, class: cls = "", attrs, children }: {
  id?: string; title: string; badge?: string | number; tone?: Tone; open?: boolean; collapsible?: boolean;
  class?: string; attrs?: Record<string, string>; children: unknown;
}) {
  const titleClass = "bg-base-300 text-lg font-bold flex items-center gap-2";
  const heading = (
    <>
      {title}
      {badge !== undefined && badge !== "" && <span class={`badge badge-sm ${toneClass(tone)}`}>{badge}</span>}
    </>
  );
  const box = `border border-base-300 bg-base-100 mb-3 scroll-mt-32 ${cls}`;
  if (!collapsible) {
    return (
      <section id={id} class={`rounded-box ${box}`} {...attrs}>
        <h2 class={`${titleClass} rounded-t-box px-4 py-4`} style="font-family: var(--font-heading)">{heading}</h2>
        <div class="p-4">{children as never}</div>
      </section>
    );
  }
  return (
    <details id={id} class={`collapse collapse-arrow ${box}`} open={open} {...attrs}>
      <summary class={`collapse-title ${titleClass}`} style="font-family: var(--font-heading)">{heading}</summary>
      <div class="collapse-content overflow-x-auto pt-4">{children as never}</div>
    </details>
  );
}
