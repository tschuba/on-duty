import type { Child } from "hono/jsx";

export type SubNavItem = { href: string; label: Child; active: boolean; badge?: Child };

// Untermenü: kompakt (~32 px), eigener Hintergrund, sticky ab md (siehe app.css, --subnav-h).
export function SubNav({ items }: { items: SubNavItem[] }) {
  return (
    <div role="tablist" data-subnav class="subnav tabs tabs-sm h-8 bg-base-300 border-b border-base-content/20 -mx-4 px-4 mb-4 sticky z-30 items-stretch">
      {items.map((i) => (
        <a href={i.href} role="tab" class={`tab h-full border-b-2 ${i.active ? "tab-active border-primary font-semibold" : "border-transparent"}`}>
          {i.label}
          {i.badge}
        </a>
      ))}
    </div>
  );
}
