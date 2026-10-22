import { t } from "../i18n/index.js";

// Sticky pager; bottom-6 keeps it above the fixed version footer (layout.tsx, 1.5rem). Must be placed OUTSIDE any overflow-x-auto wrapper, otherwise
// sticky binds to that scroll container instead of the viewport.
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
        {page > 1 && <a href={pageUrl(page - 1)} class="join-item btn">«</a>}
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
          <a key={p} href={pageUrl(p)} class={`join-item btn${p === page ? " btn-active" : ""}`}>{p}</a>
        ))}
        {page < totalPages && <a href={pageUrl(page + 1)} class="join-item btn">»</a>}
      </div>
    </div>
  );
}
