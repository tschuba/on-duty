import { ToggleFilter, pairToggles } from "../components/toggle-filter.js";
import { Icon } from "../components/icon.js";
import { RowAction } from "../components/row-action.js";
import { Field } from "../components/field.js";
import { Hono, type Context } from "hono";
import { eq, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { anniversaryYears } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout } from "../components/layout.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { ModalScaffold } from "./admin.js";
import { SortIcon } from "./members.js";
import { setFlash } from "../lib/flash.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { t } from "../i18n/index.js";
import { TitleSwitch } from "../components/title-switch.js";

export const yearRoutes = new Hono<{ Variables: Variables }>();
const yearsRead = requireAuth("anniversary-years:read");
const yearsWrite = requireAuth("anniversary-years:write");
const yearsDelete = requireAuth("anniversary-years:delete");

const ANNIVERSARY_KINDS = ["service", "membership"] as const;
type AnniversaryKind = (typeof ANNIVERSARY_KINDS)[number];
const isKind = (k: string): k is AnniversaryKind => (ANNIVERSARY_KINDS as readonly string[]).includes(k);

// ── /anniversary-years ──────────────────────────────────────────────────────
// Ansichten-Umschalter für die gemeinsame Seite /anniversaries (Jubiläen | Jubiläumsjahre); nur erlaubte Ansichten.
export function anniversaryViews(perms: Set<string>, years: boolean) {
  return [
    ...(perms.has("members:read") ? [{ active: !years, href: "/anniversaries", label: t("anniversaries.title") }] : []),
    ...(perms.has("anniversary-years:read") ? [{ active: years, href: "/anniversaries?view=years", label: t("common.nav.anniversaryYears") }] : []),
  ];
}

// Alte Links (/anniversary-years?kind=…&sort=…) bleiben gültig.
yearRoutes.get("/", yearsRead, (c) => c.redirect(`/anniversaries?${new URLSearchParams({ ...c.req.query(), view: "years" })}`));

type YearRow = typeof anniversaryYears.$inferSelect;

export async function renderYears(c: Context<{ Variables: Variables }>) {
  const user = c.get("user")!;
  const canWrite = user.permissions.has("anniversary-years:write");
  const canDelete = user.permissions.has("anniversary-years:delete");
  const kindParam = c.req.query("kind") ?? "";
  const kindFilter = isKind(kindParam) ? kindParam : null;
  const allYears = await db.select().from(anniversaryYears).orderBy(asc(anniversaryYears.year), asc(anniversaryYears.kind));

  // Eine Zeile je Jahr; die Arten (service/membership) werden als Badges zusammengefasst.
  type YearSort = "year" | "title";
  const sortParam = c.req.query("sort");
  const sort: YearSort = sortParam === "title" ? "title" : "year";
  const dir = c.req.query("dir") === "desc" ? "desc" : "asc";
  const sign = dir === "desc" ? -1 : 1;
  const byYear = new Map<number, YearRow[]>();
  for (const y of kindFilter ? allYears.filter((r) => r.kind === kindFilter) : allYears) byYear.set(y.year, [...(byYear.get(y.year) ?? []), y]);
  const firstTitle = (rows: YearRow[]) => rows.find((r) => r.title)?.title ?? "";
  const groups = [...byYear.entries()].sort(([ya, a], [yb, b]) =>
    (sort === "title" ? firstTitle(a).localeCompare(firstTitle(b), "de") : ya - yb) * sign || ya - yb);
  const sortUrl = (col: YearSort) => {
    const q = new URLSearchParams();
    if (kindFilter) q.set("kind", kindFilter);
    q.set("sort", col);
    q.set("dir", sort === col && dir === "asc" ? "desc" : "asc");
    return `/anniversaries?view=years&${q}`;
  };
  const kindLabel = (k: AnniversaryKind) => t(`admin.anniversaries.kind.${k}`);
  const titleText = (rows: YearRow[]) =>
    rows.every((r) => r.title === rows[0].title)
      ? rows[0].title ?? "–"
      : rows.filter((r) => r.title).map((r) => `${kindLabel(r.kind)}: ${r.title}`).join(" · ");

  return c.html(
    <Layout title={t("admin.anniversaries.title")} user={user}>
      <div class="max-w-4xl mx-auto">
      <PageHeader title={<TitleSwitch items={anniversaryViews(user.permissions as Set<string>, true)} />} actions={canWrite && <HeaderAction variant="primary" icon="icon-[tabler--plus]" label={t("admin.anniversaries.newYear")} class="btn-primary" attrs={{ "hx-get": "/anniversary-years/new", "hx-target": "#modal-content", "hx-swap": "innerHTML" }} />} />

      <div class="filter-bar mb-4 flex flex-wrap items-center gap-x-4">
        <ToggleFilter items={pairToggles(kindFilter ?? "",
          [{ value: "service", label: kindLabel("service") }, { value: "membership", label: kindLabel("membership") }],
          (v) => `/anniversaries?view=years&${v ? `kind=${v}&` : ""}sort=${sort}&dir=${dir}`)} />
      </div>

      {canWrite && <ClickToEditHint />}
      {groups.length === 0 ? (
        <p class="text-center opacity-50 py-8">{t("admin.anniversaries.empty")}</p>
      ) : (
      <div class="overflow-x-auto mb-6">
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th><a href={sortUrl("year")} class="link link-hover">{t("admin.anniversaries.table.years")} <SortIcon col="year" active={sort} dir={dir} /></a></th>
              <th>{t("admin.anniversaries.table.kinds")}</th>
              <th class="max-md:hidden"><a href={sortUrl("title")} class="link link-hover">{t("admin.anniversaries.table.title")} <SortIcon col="title" active={sort} dir={dir} /></a></th>
              {(canWrite || canDelete) && <th />}
            </tr>
          </thead>
          <tbody>
            {groups.map(([year, rows]) => (
                <tr
                  key={year}
                  {...(canWrite && {
                    class: "cursor-pointer hover",
                    "hx-get": `/anniversary-years/${year}/edit`,
                    "hx-target": "#modal-content",
                    "hx-swap": "innerHTML",
                  })}
                >
                  <td class="font-medium">{year}</td>
                  <td>
                    <div class="flex flex-wrap gap-1">
                      {rows.map((r) => {
                        const color = r.kind === "service" ? "badge-primary" : "badge-secondary";
                        const label = `${kindLabel(r.kind)}, ${t(r.title ? "admin.anniversaries.badge.withTitle" : "admin.anniversaries.badge.noTitle")}`;
                        return (
                          <span class={`badge badge-sm ${r.title ? color : `${color} badge-outline`}`} title={label} aria-label={label}>
                            {r.title && <Icon name="icon-[tabler--tag]" class="h-3 w-3" />}
                            {kindLabel(r.kind)}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td class="opacity-70 max-md:hidden">{titleText(rows)}</td>
                  {(canWrite || canDelete) && (
                  <td>
                    <div class="flex gap-2 justify-end">
                      {canDelete && <RowAction icon="icon-[tabler--trash]" label={t("common.delete")} class="btn-outline btn-error" onclick={`event.stopPropagation(); document.getElementById('delete-year-${year}').showModal()`} />}
                    </div>
                    {canDelete && <dialog id={`delete-year-${year}`} class="modal" onclick="event.stopPropagation()">
                      <div class="modal-box">
                        <p>{t("admin.anniversaries.confirmDelete.body", { year: String(year) })}</p>
                        <div class="modal-action">
                          <form method="dialog">
                            <button class="btn">{t("common.cancel")}</button>
                          </form>
                          <form method="post" action={`/anniversary-years/${year}/delete`}>
                            <button type="submit" class="btn btn-error">
                              {t("common.delete")}
                            </button>
                          </form>
                        </div>
                      </div>
                      <form method="dialog" class="modal-backdrop">
                        <button>{t("common.close")}</button>
                      </form>
                    </dialog>}
                  </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      )}
      </div>

      <ModalScaffold />
    </Layout>
  );
}

// Gemeinsames Formular: Jahr + je Art ein Toggle mit eigenem Titel; mindestens ein Toggle bleibt an.
const FORM_SCRIPT = `(function(){var f=document.currentScript.parentElement,b=[].slice.call(f.querySelectorAll('input[type=checkbox][data-kind]'));
function sync(){b.forEach(function(x){var i=f.querySelector('input[name="title_'+x.dataset.kind+'"]');i.disabled=!x.checked;i.closest('label').parentElement.classList.toggle('hidden',!x.checked)})}
b.forEach(function(x){x.addEventListener('change',function(){if(!b.some(function(y){return y.checked}))b.filter(function(y){return y!==x})[0].checked=true;sync()})});sync()})();`;

function YearForm({ action, heading, submit, year, rows }: { action: string; heading: string; submit: string; year?: number; rows: YearRow[] }) {
  const by = new Map(rows.map((r) => [r.kind, r]));
  return (
    <>
      <h3 class="font-bold text-lg mb-4">{heading}</h3>
      <form method="post" action={action} class="flex flex-col gap-3">
        <Field label={t("admin.anniversaries.modal.yearLabel")} required>
          <input type="number" name="year" value={year} placeholder={t("admin.anniversaries.modal.yearLabel")} min="1" max="200" class="input w-full" required />
        </Field>
        {ANNIVERSARY_KINDS.map((k) => (
          <div class="flex flex-col gap-2">
            <label class="label cursor-pointer justify-start gap-2 pointer-coarse:min-h-11">
              <input type="checkbox" name={k} value="1" data-kind={k} class="toggle toggle-primary" checked={rows.length === 0 || by.has(k)} />
              <span>{t(`admin.anniversaries.kind.${k}`)}</span>
            </label>
            <Field label={t("admin.anniversaries.modal.titleLabel")} hint={t("admin.anniversaries.modal.titlePlaceholder")}>
              <input type="text" name={`title_${k}`} value={by.get(k)?.title ?? ""} placeholder={t("admin.anniversaries.modal.titleLabel")} class="input w-full" />
            </Field>
          </div>
        ))}
        <div class="modal-action mt-2">
          <button type="button" class="btn btn-ghost" onclick="document.getElementById('admin-modal').close()">{t("common.cancel")}</button>
          <button type="submit" class="btn btn-primary">{submit}</button>
        </div>
        <script dangerouslySetInnerHTML={{ __html: FORM_SCRIPT }} />
      </form>
      <script dangerouslySetInnerHTML={{ __html: "document.getElementById('admin-modal').showModal();" }} />
    </>
  );
}

// HTMX fragment: new anniversary year modal
yearRoutes.get("/new", yearsWrite, (c) =>
  c.html(<YearForm action="/anniversary-years" heading={t("admin.anniversaries.modal.create")} submit={t("common.add")} rows={[]} />));

// HTMX fragment: edit anniversary year modal
yearRoutes.get("/:year/edit", yearsWrite, async (c) => {
  const year = parseInt(c.req.param("year"), 10);
  const rows = await db.select().from(anniversaryYears).where(eq(anniversaryYears.year, year));
  if (rows.length === 0) return c.html("", HTTP_STATUS.NOT_FOUND);
  return c.html(<YearForm action={`/anniversary-years/${year}`} heading={t("admin.anniversaries.modal.edit")} submit={t("common.save")} year={year} rows={rows} />);
});

// Liest das Formular: Jahr + ausgewählte Arten (immer mindestens eine). null = ungültig.
async function parseYearForm(c: Context<{ Variables: Variables }>) {
  const body = await c.req.parseBody();
  const year = parseInt(String(body.year ?? ""), 10);
  const kinds = ANNIVERSARY_KINDS.filter((k) => body[k]);
  if (!year || year < 1 || year > 200 || kinds.length === 0) return null;
  return { year, rows: kinds.map((kind) => ({ kind, year, title: String(body[`title_${kind}`] ?? "").trim() || null })) };
}

// POST /anniversary-years — create
yearRoutes.post("/", yearsWrite, async (c) => {
  const form = await parseYearForm(c);
  if (!form) {
    setFlash(c, t("admin.anniversaries.flash.invalidYear"), "error");
    return c.redirect("/anniversaries?view=years");
  }
  const [exists] = await db.select().from(anniversaryYears).where(eq(anniversaryYears.year, form.year));
  if (exists) {
    setFlash(c, t("admin.anniversaries.flash.yearExists", { year: form.year }), "error");
    return c.redirect("/anniversaries?view=years");
  }
  await db.insert(anniversaryYears).values(form.rows);
  setFlash(c, t("admin.anniversaries.flash.added", { year: form.year }), "success");
  return c.redirect("/anniversaries?view=years");
});

// POST /anniversary-years/:year — update (ersetzt alle Arten des Jahres)
yearRoutes.post("/:year", yearsWrite, async (c) => {
  const oldYear = parseInt(c.req.param("year"), 10);
  const [existing] = await db.select().from(anniversaryYears).where(eq(anniversaryYears.year, oldYear));
  if (!existing) return c.html("", HTTP_STATUS.NOT_FOUND);

  const form = await parseYearForm(c);
  if (!form) {
    setFlash(c, t("admin.anniversaries.flash.invalidYear"), "error");
    return c.redirect("/anniversaries?view=years");
  }
  if (form.year !== oldYear) {
    const [conflict] = await db.select().from(anniversaryYears).where(eq(anniversaryYears.year, form.year));
    if (conflict) {
      setFlash(c, t("admin.anniversaries.flash.yearExists", { year: form.year }), "error");
      return c.redirect("/anniversaries?view=years");
    }
  }
  await db.transaction(async (tx) => {
    await tx.delete(anniversaryYears).where(eq(anniversaryYears.year, oldYear));
    await tx.insert(anniversaryYears).values(form.rows);
  });
  setFlash(c, t("admin.anniversaries.flash.saved"), "success");
  return c.redirect("/anniversaries?view=years");
});

// POST /anniversary-years/:year/delete — löscht alle Arten des Jahres
yearRoutes.post("/:year/delete", yearsDelete, async (c) => {
  const year = parseInt(c.req.param("year"), 10);
  await db.delete(anniversaryYears).where(eq(anniversaryYears.year, year));
  setFlash(c, t("admin.anniversaries.flash.deleted", { year }), "success");
  return c.redirect("/anniversaries?view=years");
});
