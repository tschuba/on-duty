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
              <button
                key={p}
                type="button"
                class="join-item btn btn-primary"
                aria-current="page"
                title={t("pager.selectPage")}
                onclick="document.getElementById('pager-dialog').showModal()"
              >{p} ▾</button>
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
      {totalPages > WINDOW_ALL && (
        <dialog
          id="pager-dialog"
          class="modal"
          aria-label={t("pager.selectPage")}
          onclick="if (event.target === this) this.close()"
        >
          <div class="modal-box">
            {totalPages <= GRID_MAX_PAGES ? (
              <div class="grid grid-cols-5 gap-2">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <a key={p} href={pageUrl(p)} class={`btn${p === page ? " btn-primary" : ""}`}>{p}</a>
                ))}
              </div>
            ) : (
              <label class="flex items-center gap-2">
                <span>{t("pager.goToPage")}</span>
                <input
                  type="number"
                  class="input input-bordered w-16 text-base"
                  min="1"
                  max={totalPages}
                  value={page}
                  inputmode="numeric"
                  enterkeyhint="go"
                  onkeydown={`
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    const n = Math.min(${totalPages}, Math.max(1, parseInt(this.value, 10) || 0));
                    if (!n || n === ${page}) { this.closest('dialog').close(); return; }
                    const url = new window.URL(window.location.href);
                    url.searchParams.set('page', String(n));
                    window.location = url.toString();
                  `}
                />
              </label>
            )}
          </div>
        </dialog>
      )}
    </div>
  );
}
