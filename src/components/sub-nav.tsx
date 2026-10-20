import type { Child } from "hono/jsx";

export type SubNavItem = { href: string; label: Child; active: boolean; badge?: Child };

// Untermenü: kompakt (~40 px), eigener Hintergrund, sticky ab md (siehe app.css, --subnav-h).
export function SubNav({ items }: { items: SubNavItem[] }) {
  return (
    <div role="tablist" data-subnav class="subnav tabs tabs-sm h-10 bg-base-300 -mt-6 mb-4 sticky z-30 items-stretch">
      {items.map((i) => (
        <a href={i.href} role="tab" class={`tab h-full ${i.active ? "tab-active text-primary font-semibold" : ""}`}>
          {i.label}
          {i.badge}
        </a>
      ))}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){var n=document.currentScript.parentElement;function u(){n.toggleAttribute("data-more-l",n.scrollLeft>2);n.toggleAttribute("data-more-r",n.scrollLeft+n.clientWidth<n.scrollWidth-2)}var a=n.querySelector(".tab-active");if(a)n.scrollLeft=a.offsetLeft-n.clientWidth/2+a.offsetWidth/2;n.addEventListener("scroll",u,{passive:true});addEventListener("resize",u);u()})()`,
        }}
      />
    </div>
  );
}
