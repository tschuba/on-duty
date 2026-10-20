import { Hono } from "hono";
import { eq, and, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { anniversaryYears } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout, MemberTabs } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { ModalScaffold } from "./admin.js";
import { SortIcon } from "./members.js";
import { setFlash } from "../lib/flash.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { t } from "../i18n/index.js";

export const yearRoutes = new Hono<{ Variables: Variables }>();
const yearsRead = requireAuth("anniversary-years:read");
const yearsWrite = requireAuth("anniversary-years:write");
const yearsDelete = requireAuth("anniversary-years:delete");

const ANNIVERSARY_KINDS = ["service", "membership"] as const;
type AnniversaryKind = (typeof ANNIVERSARY_KINDS)[number];
const isKind = (k: string): k is AnniversaryKind => (ANNIVERSARY_KINDS as readonly string[]).includes(k);

// ── /anniversary-years ──────────────────────────────────────────────────────
yearRoutes.get("/", yearsRead, async (c) => {
  const user = c.get("user");
  const canWrite = user.permissions.has("anniversary-years:write");
  const canDelete = user.permissions.has("anniversary-years:delete");
  const kindParam = c.req.query("kind") ?? "";
  const kindFilter = isKind(kindParam) ? kindParam : null;
  const allYears = await db.select().from(anniversaryYears).orderBy(asc(anniversaryYears.kind), asc(anniversaryYears.year));

  type YearSort = "kind" | "year" | "title";
  const sortParam = c.req.query("sort");
  const sort: YearSort = sortParam === "year" || sortParam === "title" ? sortParam : "kind";
  const dir = c.req.query("dir") === "desc" ? "desc" : "asc";
  const sign = dir === "desc" ? -1 : 1;
  // Ties fall back to kind, year so the order stays stable.
  const cmp = (a: (typeof allYears)[number], b: (typeof allYears)[number]) =>
    (sort === "year" ? a.year - b.year
      : sort === "title" ? (a.title ?? "").localeCompare(b.title ?? "", "de")
      : a.kind.localeCompare(b.kind)) * sign
    || a.kind.localeCompare(b.kind) || a.year - b.year;
  const years = (kindFilter ? allYears.filter((y) => y.kind === kindFilter) : allYears).sort(cmp);
  const sortUrl = (col: YearSort) => {
    const q = new URLSearchParams();
    if (kindFilter) q.set("kind", kindFilter);
    q.set("sort", col);
    q.set("dir", sort === col && dir === "asc" ? "desc" : "asc");
    return `/anniversary-years?${q}`;
  };

  return c.html(
    <Layout title={t("admin.anniversaries.title")} user={user} activeNav="members">
      <MemberTabs active="anniversaryYears" user={user} />
      <div class="max-w-4xl mx-auto">
      <PageHeader title={t("admin.anniversaries.title")} actions={canWrite && <HeaderAction variant="primary" icon="plus" label={t("admin.anniversaries.newYear")} class="btn-primary" attrs={{ "hx-get": "/anniversary-years/new", "hx-target": "#modal-content", "hx-swap": "innerHTML" }} />} />

      <div class="join mb-4">
        <a href={`/anniversary-years?sort=${sort}&dir=${dir}`} class={`join-item btn${!kindFilter ? " btn-primary btn-outline" : " btn-ghost"}`}>{t("anniversaries.filter.all")}</a>
        {ANNIVERSARY_KINDS.map((k) => (
          <a href={`/anniversary-years?kind=${k}&sort=${sort}&dir=${dir}`} class={`join-item btn${kindFilter === k ? " btn-primary btn-outline" : " btn-ghost"}`}>{t(`admin.anniversaries.kind.${k}`)}</a>
        ))}
      </div>

      {canWrite && <ClickToEditHint />}
      <div class="overflow-x-auto mb-6">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th><a href={sortUrl("kind")} class="link link-hover">{t("admin.anniversaries.table.kind")} <SortIcon col="kind" active={sort} dir={dir} /></a></th>
              <th><a href={sortUrl("year")} class="link link-hover">{t("admin.anniversaries.table.years")} <SortIcon col="year" active={sort} dir={dir} /></a></th>
              <th><a href={sortUrl("title")} class="link link-hover">{t("admin.anniversaries.table.title")} <SortIcon col="title" active={sort} dir={dir} /></a></th>
              {canDelete && <th />}
            </tr>
          </thead>
          <tbody>
            {years.length === 0 ? (
              <tr>
                <td colspan={canDelete ? 4 : 3} class="text-center opacity-50 py-4">
                  {t("admin.anniversaries.empty")}
                </td>
              </tr>
            ) : (
              years.map((y) => (
                <tr
                  key={`${y.kind}-${y.year}`}
                  {...(canWrite && {
                    class: "cursor-pointer hover",
                    "hx-get": `/anniversary-years/${y.kind}/${y.year}/edit`,
                    "hx-target": "#modal-content",
                    "hx-swap": "innerHTML",
                  })}
                >
                  <td>{t(`admin.anniversaries.kind.${y.kind}`)}</td>
                  <td class="font-medium">{y.year}</td>
                  <td class="opacity-70">{y.title ?? "–"}</td>
                  {canDelete && (
                  <td>
                    <div class="flex gap-2 justify-end">
                      <button
                        class="btn btn-outline btn-error btn-xs"
                        onclick={`event.stopPropagation(); document.getElementById('delete-year-${y.kind}-${y.year}').showModal()`}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                    <dialog id={`delete-year-${y.kind}-${y.year}`} class="modal" onclick="event.stopPropagation()">
                      <div class="modal-box">
                        <p>
                          {y.title
                            ? t("admin.anniversaries.confirmDelete.bodyWithTitle", { kind: t(`admin.anniversaries.kind.${y.kind}`), year: String(y.year), title: y.title })
                            : t("admin.anniversaries.confirmDelete.body", { kind: t(`admin.anniversaries.kind.${y.kind}`), year: String(y.year) })}
                        </p>
                        <div class="modal-action">
                          <form method="dialog">
                            <button class="btn">{t("common.cancel")}</button>
                          </form>
                          <form method="post" action={`/anniversary-years/${y.kind}/${y.year}/delete`}>
                            <button type="submit" class="btn btn-error">
                              {t("common.delete")}
                            </button>
                          </form>
                        </div>
                      </div>
                      <form method="dialog" class="modal-backdrop">
                        <button>{t("common.close")}</button>
                      </form>
                    </dialog>
                  </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      </div>

      <ModalScaffold />
    </Layout>
  );
});

// HTMX fragment: new anniversary year modal
yearRoutes.get("/new", yearsWrite, (c) => {
  const kind = "service";
  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.anniversaries.modal.create")}</h3>
      <form method="post" action="/anniversary-years" class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.anniversaries.modal.kindLabel")} <span class="text-error">*</span></span>
          <select name="kind" class="select select-bordered w-full" required>
            {ANNIVERSARY_KINDS.map((k) => <option value={k} selected={k === kind}>{t(`admin.anniversaries.kind.${k}`)}</option>)}
          </select>
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.anniversaries.modal.yearLabel")} <span class="text-error">*</span></span>
          <input type="number" name="year" min="1" max="200" class="input input-bordered w-full" required placeholder={t("admin.anniversaries.modal.yearPlaceholder")} />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.anniversaries.modal.titleLabel")}</span>
          <input type="text" name="title" class="input input-bordered w-full" placeholder={t("admin.anniversaries.modal.titlePlaceholder")} />
        </div>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn btn-primary">
            {t("common.add")}
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

// HTMX fragment: edit anniversary year modal
yearRoutes.get("/:kind/:year/edit", yearsWrite, async (c) => {
  const kind = c.req.param("kind");
  const year = parseInt(c.req.param("year"), 10);
  const [y] = await db.select().from(anniversaryYears).where(and(eq(anniversaryYears.kind, kind as AnniversaryKind), eq(anniversaryYears.year, year)));
  if (!y) return c.html("", HTTP_STATUS.NOT_FOUND);

  return c.html(
    <>
      <h3 class="font-bold text-lg mb-4">{t("admin.anniversaries.modal.edit")}</h3>
      <form method="post" action={`/anniversary-years/${kind}/${year}`} class="flex flex-col gap-3">
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.anniversaries.modal.kindLabel")} <span class="text-error">*</span></span>
          <select name="kind" class="select select-bordered w-full" required>
            {ANNIVERSARY_KINDS.map((k) => <option value={k} selected={k === kind}>{t(`admin.anniversaries.kind.${k}`)}</option>)}
          </select>
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.anniversaries.modal.yearLabel")} <span class="text-error">*</span></span>
          <input type="number" name="year" value={y.year} min="1" max="200" class="input input-bordered w-full" required />
        </div>
        <div class="grid grid-cols-[8rem_1fr] items-center gap-x-3">
          <span class="label-text text-right">{t("admin.anniversaries.modal.titleLabel")}</span>
          <input type="text" name="title" value={y.title ?? ""} class="input input-bordered w-full" placeholder={t("admin.anniversaries.modal.titlePlaceholder")} />
        </div>
        <div class="modal-action mt-2">
          <button
            type="button"
            class="btn btn-ghost"
            onclick="document.getElementById('admin-modal').close()"
          >
            {t("common.cancel")}
          </button>
          <button type="submit" class="btn btn-primary">
            {t("common.save")}
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
});

// POST /anniversary-years — create
yearRoutes.post("/", yearsWrite, async (c) => {
  const body = await c.req.parseBody();
  const year = parseInt(String(body.year ?? ""), 10);
  const kind = String(body.kind ?? "");
  const title = String(body.title ?? "").trim() || null;

  if (!isKind(kind) || !year || year < 1 || year > 200) {
    setFlash(c, t("admin.anniversaries.flash.invalidYear"), "error");
    return c.redirect("/anniversary-years");
  }

  await db.insert(anniversaryYears).values({ kind, year, title }).onConflictDoNothing();
  setFlash(c, t("admin.anniversaries.flash.added", { year }), "success");
  return c.redirect("/anniversary-years");
});

// POST /anniversary-years/:year — update
yearRoutes.post("/:kind/:year", yearsWrite, async (c) => {
  const oldKind = c.req.param("kind");
  const oldYear = parseInt(c.req.param("year"), 10);
  if (!isKind(oldKind)) return c.html("", HTTP_STATUS.NOT_FOUND);
  const [existing] = await db.select().from(anniversaryYears).where(and(eq(anniversaryYears.kind, oldKind), eq(anniversaryYears.year, oldYear)));
  if (!existing) return c.html("", HTTP_STATUS.NOT_FOUND);

  const body = await c.req.parseBody();
  const newYear = parseInt(String(body.year ?? ""), 10);
  const newKind = String(body.kind ?? "");
  const title = String(body.title ?? "").trim() || null;

  if (!isKind(newKind) || !newYear || newYear < 1 || newYear > 200) {
    setFlash(c, t("admin.anniversaries.flash.invalidYear"), "error");
    return c.redirect("/anniversary-years");
  }

  if (newYear !== oldYear || newKind !== oldKind) {
    const [conflict] = await db
      .select({ year: anniversaryYears.year })
      .from(anniversaryYears)
      .where(and(eq(anniversaryYears.kind, newKind), eq(anniversaryYears.year, newYear)));
    if (conflict) {
      setFlash(c, t("admin.anniversaries.flash.yearExists", { year: newYear }), "error");
      return c.redirect("/anniversary-years");
    }
  }

  await db
    .update(anniversaryYears)
    .set({ kind: newKind, year: newYear, title })
    .where(and(eq(anniversaryYears.kind, oldKind), eq(anniversaryYears.year, oldYear)));
  setFlash(c, t("admin.anniversaries.flash.saved"), "success");
  return c.redirect("/anniversary-years");
});

// POST /anniversary-years/:year/delete
yearRoutes.post("/:kind/:year/delete", yearsDelete, async (c) => {
  const kind = c.req.param("kind");
  if (!isKind(kind)) return c.html("", HTTP_STATUS.NOT_FOUND);
  const year = parseInt(c.req.param("year"), 10);
  await db.delete(anniversaryYears).where(and(eq(anniversaryYears.kind, kind), eq(anniversaryYears.year, year)));
  setFlash(c, t("admin.anniversaries.flash.deleted", { year }), "success");
  return c.redirect("/anniversary-years");
});

