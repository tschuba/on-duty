import { t } from "../i18n/index.js";

// Sticky pager; bottom-6 keeps it above the fixed version footer (layout.tsx, 1.5rem). Must be placed OUTSIDE any overflow-x-auto wrapper, otherwise
// sticky binds to that scroll container instead of the viewport.
const WINDOW_ALL = 7;
export const GRID_MAX_PAGES = 50;

// Shortened page list: first, last, current ±1, "…" for gaps. Up to WINDOW_ALL pages: all.
export function pageWindow(page: number, total: number): (number | "…")[] {
  if (total <= WINDOW_ALL) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [...new Set([1, page - 1, page, page + 1, total])].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  return pages.flatMap((p, i) => (i > 0 && p - pages[i - 1] > 1 ? ["…" as const, p] : [p]));
}

export function Pager(props: {
  countLabel: string;
  page: number;
  totalPages: number;
  pageUrl: (p: number) => string;
  pageSize?: number;
  pageSizeOptions?: readonly number[];
  pageSizeStorageKey?: string;
}) {
  const { countLabel, page, totalPages, pageUrl, pageSize, pageSizeOptions, pageSizeStorageKey } = props;
  return (
    <div class="sticky bottom-6 z-10 bg-base-100 border-t border-base-300 py-2 mt-4 flex flex-wrap items-center justify-end gap-4">
      <span class="text-sm opacity-70 mr-auto">{countLabel}</span>
      {pageSizeOptions && (
        <div class="flex items-center gap-2 text-sm opacity-70">
          <span class="whitespace-nowrap">{t("members.table.pageSize")}</span>
          <select
            class="select select-bordered"
            onchange={`
              const v = this.value;
              ${pageSizeStorageKey ? `localStorage.setItem('${pageSizeStorageKey}', v);` : ""}
              const url = new window.URL(window.location.href);
              url.searchParams.set('pageSize', v);
              url.searchParams.set('page', '1');
              window.location = url.toString();
            `}
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n} selected={n === pageSize}>{n}</option>
            ))}
          </select>
        </div>
      )}
      <div class="join">
        {page <= 1 ? (
          <span class="join-item btn btn-disabled" aria-disabled="true" aria-label={t("pager.prev")}>«</span>
        ) : (
          <a href={pageUrl(page - 1)} class="join-item btn" aria-label={t("pager.prev")}>«</a>
        )}
        {pageWindow(page, totalPages).map((p, i) => {
          if (p === "…") return <span key={`gap${i}`} class="join-item btn btn-disabled hidden sm:inline-flex" aria-disabled="true">…</span>;
          if (p === page) {
            return totalPages > WINDOW_ALL ? (
              <div key={p} class="dropdown dropdown-top dropdown-end join-item">
                <div tabindex={0} role="button" class="btn btn-primary join-item gap-1 rounded-none" aria-current="page" aria-haspopup="true" title={t("pager.selectPage")}>
                  {p}
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="size-4" aria-hidden="true"><path fill-rule="evenodd" d="M5.22 12.78a.75.75 0 0 0 1.06 0L10 9.06l3.72 3.72a.75.75 0 1 0 1.06-1.06l-4.25-4.25a.75.75 0 0 0-1.06 0L5.22 11.72a.75.75 0 0 0 0 1.06Z" clip-rule="evenodd" /></svg>
                </div>
                <div tabindex={0} class="dropdown-content z-20 mb-3 rounded-box border border-base-300 bg-base-100 p-3 shadow-lg">
                  {totalPages <= GRID_MAX_PAGES ? (
                    <div class="grid grid-cols-5 gap-2">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                        <a key={n} href={pageUrl(n)} class={`btn btn-sm${n === page ? " btn-primary" : ""}`}>{n}</a>
                      ))}
                    </div>
                  ) : (
                    <label class="flex items-center gap-2 whitespace-nowrap">
                      <span>{t("pager.goToPage")}</span>
                      <input
                        type="number"
                        class="input input-bordered w-16 text-base"
                        min={1}
                        max={totalPages}
                        value={page}
                        inputmode="numeric"
                        enterkeyhint="go"
                        onkeydown={`
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          const n = Math.min(${totalPages}, Math.max(1, parseInt(this.value, 10) || 0));
                          if (!n || n === ${page}) { this.blur(); return; }
                          const url = new window.URL(window.location.href);
                          url.searchParams.set('page', String(n));
                          window.location = url.toString();
                        `}
                      />
                    </label>
                  )}
                  {/* speech-balloon arrow pointing down at the trigger */}
                  <span class="absolute -bottom-[7px] right-4 size-3 rotate-45 border-b border-r border-base-300 bg-base-100" aria-hidden="true" />
                </div>
              </div>
            ) : (
              <span key={p} class="join-item btn btn-primary" aria-current="page">{p}</span>
            );
          }
          const edge = p === 1 || p === totalPages;
          return <a key={p} href={pageUrl(p)} class={`join-item btn${edge ? "" : " hidden sm:inline-flex"}`}>{p}</a>;
        })}
        {page >= totalPages ? (
          <span class="join-item btn btn-disabled" aria-disabled="true" aria-label={t("pager.next")}>»</span>
        ) : (
          <a href={pageUrl(page + 1)} class="join-item btn" aria-label={t("pager.next")}>»</a>
        )}
      </div>
    </div>
  );
}
