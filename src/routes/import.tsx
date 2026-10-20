import { Hono } from "hono";
import { eq, isNotNull, sql } from "drizzle-orm";
import { ROLE_TYPE_IDS } from "../db/role-seed-data.js";
import { db } from "../db/index.js";
import { inventoryItemNumbers, inventoryItems, inventoryItemSerials, inventoryItemTags, memberRoleAssignments, memberRoles, members, persons } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { t } from "../i18n/index.js";
import { formatDate } from "../lib/format.js";
import { Layout } from "../components/layout.js";
import { HTTP_STATUS } from "../lib/constants.js";
import {
  ASSUMED_NOTE, ACTIVE_ROLE_ID, CATEGORY_OPTIONS, ImportError, MAX_UPLOAD_BYTES, checkUpload, memberKey, normalizeIban,
  parseInventory, parseMembers, planInventory, planMembers, readWorkbook, unmappedColumns,
  type ImportKind, type InventoryPlan, type MemberPlan, type RoleOption,
} from "../lib/import.js";
import type { InventoryCategory } from "../lib/inventory.js";

export const importRoutes = new Hono<{ Variables: Variables }>();
const guard = requireAuth("import:run");

type Body = Record<string, string | string[] | File | undefined>;

const KIND_LABEL: Record<ImportKind, string> = { members: t("import.kind.members"), inventory: t("import.kind.inventory") };
const CATEGORY_LABEL: Record<InventoryCategory, string> = {
  vehicle: t("inventory.category.vehicle"), scba: t("inventory.category.scba"), equipment: t("inventory.category.equipment"),
  ppe: t("inventory.category.ppe"), other: t("inventory.category.other"),
};
const today = () => new Date().toISOString().slice(0, 10);

const PageTitle = ({ children }: { children: string }) => (
  <h1 class="text-2xl font-bold mb-4" style="font-family: var(--font-heading)">{children}</h1>
);

// Zwischenstand im Browser: nur Formularwerte (nie die Datei), Schlüssel = Datei-Fingerprint, 24 h gültig.
const DRAFT_SCRIPT = `
(() => {
  const form = document.getElementById("import-form"); if (!form) return;
  const key = "onduty-import:" + form.dataset.fp, TTL = 864e5;
  for (const k of Object.keys(localStorage)) if (k.startsWith("onduty-import:")) { try { if (Date.now() - JSON.parse(localStorage[k]).at > TTL) localStorage.removeItem(k); } catch { localStorage.removeItem(k); } }
  const SKIP = new Set(["data", "fp", "kind", "name", "intent", "_seen"]);
  let dirty = false, submitting = false;
  const collect = () => [...form.elements].filter((e) => e.name && !SKIP.has(e.name) && e.type !== "submit").map((e) => [e.name, e.type === "checkbox" ? e.checked : e.value, e.type === "checkbox" ? e.value : null]);
  form.addEventListener("change", () => { dirty = true; localStorage[key] = JSON.stringify({ at: Date.now(), v: collect() }); });
  form.addEventListener("submit", (e) => { dirty = false; submitting = true; if (e.submitter && e.submitter.value === "run") localStorage.removeItem(key); });
  addEventListener("beforeunload", (e) => { if (dirty && !submitting) { e.preventDefault(); e.returnValue = ""; } });
  const saved = localStorage[key]; if (!saved || (form.elements.restored && form.elements.restored.value)) return;
  const { at, v } = JSON.parse(saved);
  const box = document.getElementById("restore-box"); box.classList.remove("hidden");
  document.getElementById("restore-at").textContent = new Date(at).toLocaleString("de-DE");
  document.getElementById("restore-yes").onclick = () => {
    for (const [n, val, cv] of v) for (const el of form.elements[n] ? (form.elements[n].length ? [...form.elements[n]] : [form.elements[n]]) : []) {
      if (el.type === "checkbox") { if (cv === null || el.value === cv) el.checked = val; } else el.value = val;
    }
    form.elements.restored.value = "1"; dirty = false; form.requestSubmit(document.getElementById("refresh-btn"));
  };
  document.getElementById("restore-no").onclick = () => { localStorage.removeItem(key); box.classList.add("hidden"); };
  document.getElementById("discard").onclick = () => localStorage.removeItem(key);
})();`;
const FP_SCRIPT = `
document.getElementById("file").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) document.getElementById("fp").value = f.name + "-" + f.size + "-" + f.lastModified; });`;

function UploadPage({ user, error }: { user: any; error?: string }) {
  return (
    <Layout title={t("common.nav.import")} user={user} activeNav="import">
      <div class="max-w-2xl mx-auto">
        <PageTitle>{t("import.title")}</PageTitle>
        {error && <div class="alert alert-error mb-4">{error}</div>}
        <div class="alert alert-info mb-6">{t("import.backupHint")}</div>

        <h2 class="text-lg font-bold mb-1" style="font-family: var(--font-heading)">{t("import.upload.supported")}</h2>
        <p class="text-sm opacity-70 mb-3">{t("import.upload.help")}</p>
        <div class="grid gap-4 sm:grid-cols-2 mb-2">
          {([["members", "membersDetect", "membersFields"], ["inventory", "inventoryDetect", "inventoryFields"]] as const).map(([kind, detect, fields]) => (
            <div class="card bg-base-200 shadow">
              <div class="card-body gap-2 p-4">
                <h3 class="font-bold">{t(`import.kind.${kind}`)}</h3>
                <p class="text-sm opacity-70">{t(`import.upload.${detect}`)}</p>
                <ul class="list-disc ml-5 text-sm">
                  {t(`import.upload.${fields}`).split(", ").map((f) => <li>{f}</li>)}
                </ul>
              </div>
            </div>
          ))}
        </div>
        <p class="text-sm opacity-60 mb-6">{t("import.upload.unsupported")}</p>

        <form method="post" action="/import/preview" enctype="multipart/form-data" class="card bg-base-200 shadow">
          <div class="card-body gap-3">
            <input id="file" type="file" name="file" accept=".xlsx" required class="file-input file-input-bordered w-full" />
            <input id="fp" type="hidden" name="fp" value="" />
            <p class="text-sm opacity-60">{t("import.draftHint")}</p>
            <div class="flex justify-end"><button type="submit" class="btn btn-primary">{t("import.upload.submit")}</button></div>
          </div>
        </form>
        <script dangerouslySetInnerHTML={{ __html: FP_SCRIPT }} />
      </div>
    </Layout>
  );
}

importRoutes.get("/", guard, (c) => c.html(<UploadPage user={c.get("user")} />));

async function loadContext() {
  const roles: RoleOption[] = (await db.select({ id: memberRoles.id, title: memberRoles.title, grantsActiveStatus: memberRoles.grantsActiveStatus }).from(memberRoles))
    .sort((x, y) => x.title.localeCompare(y.title, "de"));
  const people = await db.select({ lastName: persons.lastName, firstName: persons.firstName, birthDate: persons.birthDate }).from(persons).innerJoin(members, eq(members.personId, persons.id)).where(isNotNull(persons.birthDate));
  const existingKeys = new Set(people.map(memberKey));
  const numbers = new Set((await db.select({ n: inventoryItemNumbers.number }).from(inventoryItemNumbers)).map((r) => r.n));
  return { roles, existingKeys, numbers };
}

async function readUpload(body: Body): Promise<{ buf: Buffer; name: string; kind: ImportKind; headers: string[]; rows: ReturnType<typeof readWorkbook>["rows"] }> {
  let buf: Buffer, name: string;
  if (body.file instanceof File && body.file.size > 0) {
    name = body.file.name;
    buf = Buffer.from(await body.file.arrayBuffer());
  } else if (typeof body.data === "string" && body.data) {
    name = String(body.name ?? "import.xlsx");
    buf = Buffer.from(body.data, "base64");
  } else throw new ImportError(t("import.error.noFile"));
  checkUpload(name, buf);
  return { buf, name, ...readWorkbook(buf) };
}

// Durchsuchbare Rollenauswahl: sichtbares Textfeld mit <datalist>, die ID steckt im Hidden-Feld.
function RoleCombo({ name, value, roles, disabled }: { name: string; value: string; roles: RoleOption[]; disabled?: boolean }) {
  const label = value === "new" ? t("import.option.new") : roles.find((r) => r.id === value)?.title ?? "";
  return (
    <>
      <input type="text" list="role-options" data-combo value={label} disabled={disabled} autocomplete="off" placeholder={t("import.option.search")}
        class={`input input-bordered input-sm w-56 ${value === "new" ? "input-warning" : ""}`} />
      <input type="hidden" name={name} value={value} disabled={disabled} />
    </>
  );
}

type Tone = "error" | "warning";
const toneClass = (tone?: Tone) => (tone ? `badge-${tone}` : "badge-ghost");

// Einklappbarer Abschnitt; offen, wenn dort etwas zu tun ist.
function Section({ id, title, badge, tone, open, children }: { id?: string; title: string; badge?: string | number; tone?: Tone; open?: boolean; children: unknown }) {
  return (
    <details id={id} class="collapse collapse-arrow border border-base-300 bg-base-100 mb-3 scroll-mt-32" open={open}>
      <summary class="collapse-title bg-base-300 text-lg font-bold flex items-center gap-2" style="font-family: var(--font-heading)">
        {title}
        {badge !== undefined && badge !== "" && <span class={`badge badge-sm ${toneClass(tone)}`}>{badge}</span>}
      </summary>
      <div class="collapse-content overflow-x-auto pt-4">{children as never}</div>
    </details>
  );
}

const Err = ({ children }: { children: string }) => <span class="badge badge-error badge-sm">{children}</span>;

function MemberPreview({ plan, roles, confirmed }: { plan: MemberPlan; roles: RoleOption[]; confirmed: boolean }) {
  const selected = (c: { kind: string; roleId?: string }) => (c.kind === "role" ? c.roleId : c.kind);
  const newCount = plan.titles.filter((d) => d.choice.kind === "new" && !d.ignored).length;
  const included = plan.rows.filter((r) => r.included);
  const warned = included.filter((r) => r.warnings.length).length;
  const problems = plan.blockers + warned;
  return (
    <>
      <datalist id="role-options">
        <option value={t("import.option.new")} data-id="new" />
        {roles.map((r) => <option value={r.title} data-id={r.id} />)}
      </datalist>
      <Section title={t("import.titles.heading")} badge={newCount ? t("import.titles.newBadge", { count: newCount }) : plan.titles.length} tone={newCount ? "warning" : undefined} open={newCount > 0}>
        {plan.titles.length === 0 ? <p class="opacity-60">{t("import.titles.none")}</p> : (
          <table class="table table-zebra w-full">
            <thead><tr><th>{t("import.col.fwportal")}</th><th>{t("import.col.kind")}</th><th>{t("import.col.count")}</th><th>{t("import.col.mapping")}</th><th>{t("import.col.ignore")}</th><th>{t("import.col.grantsActive")}</th></tr></thead>
            <tbody>
              {plan.titles.map((d, i) => (
                <tr>
                  <td>{d.title}</td><td>{d.kind === "rank" ? t("import.kind.rank") : t("import.kind.function")}</td><td>{d.count}</td>
                  <td>
                    <RoleCombo name={`map_${i}`} value={d.choice.kind === "new" ? "new" : (d.choice as { roleId: string }).roleId} roles={roles} disabled={d.ignored} />
                  </td>
                  <td>
                    <label class="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" name={`ign_${i}`} value="1" class="toggle toggle-sm" checked={d.ignored} />
                      <span class="text-sm">{t("import.option.ignore")}</span>
                    </label>
                  </td>
                  <td>{d.choice.kind === "new" && !d.ignored ? <input type="checkbox" name={`grants_${i}`} value="1" class="checkbox checkbox-sm" checked={d.grants} /> : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {newCount > 0 && <p class="text-sm opacity-60 mt-1">{t("import.newRolesHint")}</p>}
      </Section>

      <Section title={t("import.members.title")} badge={t("import.members.badge", { selected: included.length, total: plan.rows.length })} open={problems > 0}>
        <label class="label cursor-pointer justify-start gap-2 mb-2">
          <input type="checkbox" class="checkbox checkbox-sm" data-only-problems />
          <span>{t("import.members.onlyProblems", { count: problems })}</span>
        </label>
        <table class="table table-zebra w-full">
          <thead><tr><th></th><th>{t("import.col.name")}</th><th>{t("import.col.birthDate")}</th><th>{t("import.col.entryDate")}</th><th>{t("import.col.address")}</th><th>{t("import.col.contact")}</th><th>{t("import.col.notes")}</th></tr></thead>
          <tbody>
            {plan.rows.map(({ m, included, duplicate, errors, warnings }) => (
              <tr data-problem={errors.length || warnings.length ? "1" : undefined} class={duplicate ? "opacity-50 italic" : undefined}>
                <td><input type="checkbox" name="inc" value={m.mid} class="checkbox checkbox-sm" checked={included} disabled={duplicate} /></td>
                <td>{m.lastName}, {m.firstName}</td>
                <td>{m.birthDate ? formatDate(m.birthDate) : <input type="date" name={`birth_${m.mid}`} class="input input-bordered input-sm" />}</td>
                <td>{m.entryDate ? formatDate(m.entryDate) : <input type="date" name={`entry_${m.mid}`} class="input input-bordered input-sm" />}</td>
                <td class="text-sm">
                  {[[m.street, m.houseNumber].filter(Boolean).join(" "), [m.zip, m.city].filter(Boolean).join(" ")].filter(Boolean).map((v) => <div>{v}</div>)}
                </td>
                <td class="text-sm">
                  {[m.phone, m.mobile, m.email].filter(Boolean).map((v) => <div>{v}</div>)}
                </td>
                <td class="space-x-1">
                  {duplicate && <span class="badge badge-info badge-sm not-italic">{t("import.badge.existing")}</span>}
                  {errors.map((e) => <Err>{e}</Err>)}
                  {warnings.map((w) => <span class="badge badge-warning badge-sm" title={w}>{w}</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="assignments" title={t("import.assignments.heading")} badge={plan.assumedCount ? t("import.assignments.badge", { count: plan.assumedCount }) : ""} tone="warning" open={plan.assumedCount > 0 && !confirmed}>
        {plan.assumedCount > 0 && (
          <label class="flex items-center gap-2 cursor-pointer mb-3 font-semibold">
            <input type="checkbox" name="assumed_ok" value="1" class="checkbox checkbox-sm" checked={confirmed} />
            <span>{t("import.assignments.confirm", { count: plan.assumedCount })}</span>
          </label>
        )}
        <div class="alert alert-warning mb-2">{t("import.assignments.assumedHint")}</div>
        <table class="table table-zebra w-full">
          <thead><tr><th>{t("import.col.person")}</th><th>{t("import.col.fwportal")}</th><th>{t("import.col.role")}</th><th>{t("import.col.note")}</th><th>{t("import.col.from")}</th><th>{t("import.col.skip")}</th></tr></thead>
          <tbody>
            {included.flatMap(({ m, assignments }) => assignments.filter((a) => a.key !== "a").map((a) => (
              <tr class={a.skipped ? "opacity-50" : undefined}>
                <td>{m.lastName}, {m.firstName}</td><td>{a.title}</td>
                <td>
                  <RoleCombo name={`arole_${m.mid}_${a.key}`} value={a.roleChoice.kind === "new" ? "new" : a.roleChoice.roleId} roles={roles} disabled={a.skipped} />
                </td>
                <td><input name={`note_${m.mid}_${a.key}`} value={a.note ?? ""} maxlength={200} class="input input-bordered input-sm" disabled={a.skipped} /></td>
                <td>
                  <input type="date" name={`from_${m.mid}_${a.key}`} value={a.from} class="input input-bordered input-sm" disabled={a.skipped} />
                  {a.assumed && <span class="badge badge-warning badge-sm ml-1">{t("import.badge.assumed")}</span>}
                </td>
                <td><input type="checkbox" name={`askip_${m.mid}_${a.key}`} value="1" class="toggle toggle-sm" checked={a.skipped} /></td>
              </tr>
            )))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

function InventoryPreview({ plan }: { plan: InventoryPlan }) {
  const otherLevels = plan.levels.filter((l) => l.category === "other").length;
  const existing = plan.positions.filter((p) => p.duplicateNumbers.length).length;
  return (
    <>
      <Section title={t("import.categories.heading")} badge={otherLevels ? t("import.categories.checkBadge", { count: otherLevels }) : plan.levels.length} tone={otherLevels ? "warning" : undefined} open={otherLevels > 0}>
        {otherLevels > 0 && <div class="alert alert-warning mb-2">{t("import.categories.otherHint")}</div>}
        <table class="table table-zebra w-full">
          <thead><tr><th>{t("import.col.itemType")}</th><th>{t("import.col.category")}</th></tr></thead>
          <tbody>
            {plan.levels.map((l, i) => (
              <tr><td>{l.level || "–"}</td><td>
                <select name={`cat_${i}`} class="select select-bordered select-sm">
                  {CATEGORY_OPTIONS.map((c) => <option value={c} selected={c === l.category}>{CATEGORY_LABEL[c]}</option>)}
                </select>
              </td></tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title={t("import.positions.title")} badge={t("import.positions.badge", { rows: plan.rowCount, positions: plan.positions.length })} tone={existing ? "warning" : undefined} open={existing > 0}>
        <label class="label cursor-pointer justify-start gap-2 mb-2">
          <input type="checkbox" class="checkbox checkbox-sm" data-only-problems />
          <span>{t("import.positions.onlyExisting", { count: existing })}</span>
        </label>
        <p class="text-sm opacity-70 mb-2">{t("import.positions.bundleHint")}</p>
        <table class="table table-zebra w-full">
          <thead><tr><th>{t("import.col.designation")}</th><th>{t("import.col.category")}</th><th>{t("import.col.count")}</th><th>{t("import.col.itemNumber")}</th><th>{t("import.positions.colCreateAs")}</th><th>{t("import.col.notes")}</th></tr></thead>
          <tbody>
            {plan.positions.map((p) => (
              <tr data-problem={p.duplicateNumbers.length ? "1" : undefined} class={p.duplicateNumbers.length ? "opacity-50 italic" : undefined}>
                <td>{p.name}</td><td class="whitespace-nowrap">{CATEGORY_LABEL[p.category]}</td><td>{p.quantity}</td>
                <td class="text-sm">
                  {p.numbers.slice(0, 5).join(", ")}{p.numbers.length > 5 && <span class="opacity-60" title={p.numbers.slice(5).join(", ")}> +{p.numbers.length - 5}</span>}
                </td>
                <td>
                  {p.canBundle && p.items[0].id === p.gid && (
                    <div class="join" title={t("import.positions.noBundleHelp")}>
                      <input type="radio" class="join-item btn btn-xs" name={`nob_${p.gid}`} value="" checked={p.bundled} aria-label={t("import.positions.optBundled", { count: p.groupSize })} />
                      <input type="radio" class="join-item btn btn-xs" name={`nob_${p.gid}`} value="1" checked={!p.bundled} aria-label={t("import.positions.optSingle", { count: p.groupSize })} />
                    </div>
                  )}
                </td>
                <td class="space-x-1">
                  {p.duplicateNumbers.length > 0 && <span class="badge badge-info badge-sm not-italic whitespace-nowrap" title={p.duplicateNumbers.join(", ")}>{t("import.badge.existing")}</span>}
                  {p.category === "other" && <span class="badge badge-warning badge-sm whitespace-nowrap">{t("import.badge.checkCategory")}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

// Eine Handler-Funktion für Vorschau (neu rendern) und Import (intent=run).
async function handle(c: any, run: boolean) {
  const user = c.get("user");
  const body = (await c.req.parseBody({ all: true })) as Body;
  try {
    const up = await readUpload(body);
    const ctx = await loadContext();
    const unmapped = unmappedColumns(up.kind, up.headers, up.rows);
    const fp = String(body.fp ?? "");
    const dataB64 = up.buf.toString("base64");
    const hidden = (
      <>
        <input type="hidden" name="data" value={dataB64} />
        <input type="hidden" name="name" value={up.name} />
        <input type="hidden" name="fp" value={fp} />
        <input type="hidden" name="_seen" value="1" />
        <input type="hidden" name="restored" value={String(body.restored ?? "")} />
      </>
    );

    if (up.kind === "members") {
      const plan = planMembers(parseMembers(up.rows), ctx.roles, ctx.existingKeys, body, today());
      const needsActive = plan.rows.some((r) => r.included && r.m.active && !r.m.deathDate);
      const activeMissing = needsActive && !ctx.roles.some((r) => r.id === ACTIVE_ROLE_ID);
      const canRun = plan.blockers === 0 && !activeMissing && (plan.assumedCount === 0 || body.assumed_ok === "1") && plan.rows.some((r) => r.included);
      if (run) {
        if (!canRun) throw new ImportError(activeMissing ? t("import.error.activeRoleMissing") : t("import.error.previewIncomplete"));
        const report = await runMembers(plan, ctx.roles, user);
        return c.html(<ReportPage kind="members" report={report} unmapped={unmapped} user={user} />);
      }
      return c.html(
        <PreviewShell user={user} kind="members" fp={fp} hidden={hidden} canRun={canRun} unmapped={unmapped}
          summary={[
            { label: t("import.summary.read"), value: plan.rows.length },
            { label: t("import.summary.toImport"), value: plan.rows.filter((r) => r.included).length },
            { label: t("import.summary.existing"), value: plan.rows.filter((r) => r.duplicate).length },
            { label: t("import.summary.errors"), value: plan.blockers, tone: "error" },
            { label: t("import.summary.assumed"), value: plan.assumedCount, tone: "warning" },
          ]}
          notices={[activeMissing && t("import.notice.activeRoleMissing"), plan.blockers > 0 && t("import.notice.incompleteRows", { count: plan.blockers }), plan.assumedCount > 0 && body.assumed_ok !== "1" && { text: t("import.notice.confirmAssumed"), href: "#assignments" }]}>
          <MemberPreview plan={plan} roles={ctx.roles} confirmed={body.assumed_ok === "1"} />
        </PreviewShell>,
      );
    }

    const plan = planInventory(parseInventory(up.rows), ctx.numbers, body);
    const canRun = plan.positions.some((p) => p.duplicateNumbers.length === 0);
    if (run) {
      if (!canRun) throw new ImportError(t("import.error.nothingNew"));
      const report = await runInventory(plan);
      return c.html(<ReportPage kind="inventory" report={report} unmapped={unmapped} user={user} />);
    }
    return c.html(
      <PreviewShell user={user} kind="inventory" fp={fp} hidden={hidden} canRun={canRun} unmapped={unmapped} notices={[]}
        summary={[
          { label: t("import.summary.read"), value: plan.rowCount },
          { label: t("import.summary.positions"), value: plan.positions.length },
          { label: t("import.summary.bundled"), value: plan.bundledRows },
          { label: t("import.summary.existing"), value: plan.positions.filter((p) => p.duplicateNumbers.length).length },
        ]}>
        <InventoryPreview plan={plan} />
      </PreviewShell>,
    );
  } catch (e) {
    if (e instanceof ImportError) return c.html(<UploadPage user={user} error={e.message} />, HTTP_STATUS.BAD_REQUEST);
    throw e;
  }
}

importRoutes.post("/preview", guard, (c) => handle(c, false));
importRoutes.post("/run", guard, (c) => handle(c, true));

const FILTER_SCRIPT = `
document.querySelectorAll("[data-only-problems]").forEach((cb) => cb.addEventListener("change", () => {
  const rows = cb.closest(".collapse-content").querySelectorAll("tbody tr");
  rows.forEach((tr) => { tr.hidden = cb.checked && !tr.dataset.problem; });
}));`;

// Zuordnung geändert → Vorschau neu berechnen lassen (Funktionszuweisungen hängen davon ab).
// Scrollposition und offene Abschnitte bleiben über das Neuladen erhalten.
const AUTOREFRESH_SCRIPT = `
(() => {
  const form = document.getElementById("import-form"); if (!form) return;
  const SK = "onduty-import-view", secs = [...document.querySelectorAll("details.collapse")];
  try {
    const v = JSON.parse(sessionStorage.getItem(SK) || "null"); sessionStorage.removeItem(SK);
    if (v) { secs.forEach((d, i) => { d.open = v.open.includes(i); }); scrollTo(0, v.y); }
  } catch {}
  form.addEventListener("change", (e) => {
    if (!/^((map|grants|ign|arole|askip|nob|cat)_|assumed_ok$)/.test(e.target.name || "")) return;
    sessionStorage.setItem(SK, JSON.stringify({ y: scrollY, open: secs.flatMap((d, i) => (d.open ? [i] : [])) }));
    form.requestSubmit(document.getElementById("refresh-btn"));
  });
})();`;

// Hinweis-Links öffnen den Ziel-Abschnitt, bevor sie dorthin springen.
const OPENLINK_SCRIPT = `
document.querySelectorAll("a[data-open]").forEach((a) => a.addEventListener("click", () => {
  const d = document.querySelector(a.getAttribute("href")); if (d) d.open = true;
}));`;

const COMBO_SCRIPT = `
(() => {
  const opts = [...document.querySelectorAll("#role-options option")];
  document.querySelectorAll("input[data-combo]").forEach((inp) => {
    const hidden = inp.nextElementSibling; let prev = inp.value;
    // Beim Fokus leeren, sonst zeigt die Liste nur den aktuellen Treffer.
    inp.addEventListener("focus", () => { prev = inp.value; inp.value = ""; });
    const commit = () => {
      const o = opts.find((x) => x.value === inp.value);
      if (!o) { inp.value = prev; return; }
      prev = inp.value;
      if (hidden.value !== o.dataset.id) { hidden.value = o.dataset.id; hidden.dispatchEvent(new Event("change", { bubbles: true })); }
    };
    inp.addEventListener("change", commit);
    inp.addEventListener("blur", () => { inp.value ? commit() : (inp.value = prev); });
  });
})();`;

type Summary = { label: string; value: number; tone?: Tone }[];

function PreviewShell(props: { user: any; kind: ImportKind; fp: string; hidden: unknown; canRun: boolean; unmapped: { column: string; count: number }[]; notices: (string | { text: string; href: string } | false)[]; summary: Summary; children: unknown }) {
  const notices = props.notices.filter((n): n is string | { text: string; href: string } => !!n);
  return (
    <Layout title={t("common.nav.import")} user={props.user} activeNav="import">
      <div class="max-w-6xl mx-auto">
        <PageTitle>{t("import.preview.title", { kind: KIND_LABEL[props.kind] })}</PageTitle>
        <div id="restore-box" class="alert alert-info mb-4 hidden">
          <span>{t("import.restore.prompt")} <span id="restore-at"></span></span>
          <div><button type="button" id="restore-yes" class="btn btn-sm btn-primary mr-2">{t("import.restore.yes")}</button><button type="button" id="restore-no" class="btn btn-sm">{t("common.no")}</button></div>
        </div>
        <form id="import-form" method="post" action="/import/run" data-fp={props.fp}>
          {props.hidden as never}
          <div class="sticky top-0 z-10 bg-base-100 border-b border-base-300 py-3 mb-4">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                {props.summary.map((x) => (
                  <span class={`text-sm ${x.value > 0 && x.tone ? (x.tone === "error" ? "text-error font-semibold" : "text-warning font-semibold") : ""}`}>
                    <span class="font-bold">{x.value}</span> {x.label}
                  </span>
                ))}
              </div>
              <div class="flex items-center gap-2">
                <a id="discard" href="/import" class="btn btn-sm">{t("import.preview.discard")}</a>
                <button id="refresh-btn" type="submit" formaction="/import/preview" class="btn btn-sm">{t("import.preview.refresh")}</button>
                <button type="submit" name="intent" value="run" class="btn btn-sm btn-primary" disabled={!props.canRun}>{t("import.preview.run")}</button>
              </div>
            </div>
            {notices.length > 0 && (
              <p class="text-sm text-warning mt-2">
                {notices.map((n, i) => <>{i > 0 && " · "}{typeof n === "string" ? n : <a href={n.href} data-open class="link">{n.text}</a>}</>)}
              </p>
            )}
            <p class="text-xs opacity-60 mt-1">{t("import.preview.dryRun")} {t("import.draftHint")}</p>
          </div>
          {props.children as never}
          {props.unmapped.length > 0 && (
            <Section title={t("import.unmapped.title")} badge={props.unmapped.length}>
              <ul class="list-disc ml-6">{props.unmapped.map((u) => <li>{t("import.report.unmappedLine", { column: u.column, count: u.count })}</li>)}</ul>
              <p class="text-sm opacity-60 mt-2">{t("import.unmapped.hint")}</p>
            </Section>
          )}
        </form>
        <script dangerouslySetInnerHTML={{ __html: DRAFT_SCRIPT + FILTER_SCRIPT + AUTOREFRESH_SCRIPT + OPENLINK_SCRIPT + COMBO_SCRIPT }} />
      </div>
    </Layout>
  );
}

type Report = { created: number; skipped: number; lines: string[]; links: { id: string; label: string }[]; newRoles: string[] };

function ReportPage({ kind, report, unmapped, user }: { kind: ImportKind; report: Report; unmapped: { column: string; count: number }[]; user: any }) {
  return (
    <Layout title={t("common.nav.import")} user={user} activeNav="import">
      <div class="max-w-3xl mx-auto">
        <PageTitle>{t("import.report.title", { kind: KIND_LABEL[kind] })}</PageTitle>
        <div class="alert alert-success mb-4">{t("import.report.summary", { created: report.created, skipped: report.skipped })}</div>
        {report.lines.map((l) => <p>{l}</p>)}
        {report.newRoles.length > 0 && <><h2 class="text-lg font-bold mt-4">{t("import.report.newRoles")}</h2><ul class="list-disc ml-6">{report.newRoles.map((r) => <li>{r}</li>)}</ul></>}
        {report.links.length > 0 && (
          <><h2 class="text-lg font-bold mt-4">{t("import.report.assumed")}</h2>
            <ul class="list-disc ml-6">{report.links.map((l) => <li><a class="link" href={`/members/${l.id}`}>{l.label}</a></li>)}</ul></>
        )}
        {unmapped.length > 0 && (
          <><h2 class="text-lg font-bold mt-4">{t("import.report.unmapped")}</h2>
            <ul class="list-disc ml-6">{unmapped.map((u) => <li>{t("import.report.unmappedLine", { column: u.column, count: u.count })}</li>)}</ul></>
        )}
        <script dangerouslySetInnerHTML={{ __html: `for (const k of Object.keys(localStorage)) if (k.startsWith("onduty-import:")) localStorage.removeItem(k);` }} />
        <a href="/import" class="btn mt-6">{t("import.report.another")}</a>
      </div>
    </Layout>
  );
}

async function runMembers(plan: MemberPlan, roles: RoleOption[], _user: unknown): Promise<Report> {
  const rows = plan.rows.filter((r) => r.included);
  let current = "";
  try {
    return await db.transaction(async (tx) => {
      // Neue Rollen einmal pro Titel anlegen, nur wenn eine importierte Zeile sie braucht.
      const roleIdByTitle = new Map<string, string>();
      const newRoles: string[] = [];
      const links: Report["links"] = [];
      for (const { m, assignments } of rows) {
        for (const a of assignments) {
          if (a.skipped || a.roleChoice.kind !== "new" || roleIdByTitle.has(a.title)) continue;
          const typeId = a.grants ? ROLE_TYPE_IDS.rank : ROLE_TYPE_IDS.other;
          const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${memberRoles.sortOrder}), 0)` }).from(memberRoles).where(eq(memberRoles.typeId, typeId));
          const [r] = await tx.insert(memberRoles).values({ title: a.title, grantsActiveStatus: a.grants, typeId, sortOrder: Number(max) + 1 }).returning({ id: memberRoles.id });
          roleIdByTitle.set(a.title, r.id);
          newRoles.push(`${a.title}${a.grants ? t("import.report.grantsActiveSuffix") : ""}`);
        }
      }
      for (const { m, assignments } of rows) {
        current = `${m.lastName}, ${m.firstName}`;
        const iban = m.iban ? normalizeIban(m.iban) : null;
        const [person] = await tx.insert(persons).values({
          lastName: m.lastName!, firstName: m.firstName!, street: m.street, houseNumber: m.houseNumber, zip: m.zip, city: m.city,
          gender: m.gender, birthDate: m.birthDate, phone: m.phone, mobile: m.mobile, email: m.email,
        }).returning({ id: persons.id });
        const [member] = await tx.insert(members).values({
          personId: person.id, entryDate: m.entryDate!, firstEntryDate: m.firstEntryDate, deathDate: m.deathDate, iban, bic: m.bic,
        }).returning({ id: members.id });
        let assumed = false;
        for (const a of assignments.filter((x) => !x.skipped)) {
          const roleId = a.roleChoice.kind === "role" ? a.roleChoice.roleId : roleIdByTitle.get(a.title)!;
          if (a.assumed) assumed = true;
          await tx.insert(memberRoleAssignments).values({
            memberId: member.id, memberRoleId: roleId, from: a.from,
            note: a.assumed ? [a.note, ASSUMED_NOTE].filter(Boolean).join("; ").slice(0, 200) : a.note,
          });
        }
        if (assumed) links.push({ id: member.id, label: current });
      }
      void roles;
      const skipped = plan.rows.length - rows.length;
      return { created: rows.length, skipped, lines: [t("import.report.rowsRead", { count: plan.rows.length })], links, newRoles };
    });
  } catch (e) {
    throw new ImportError(t("import.error.rolledBack", { item: current, message: (e as Error).message }));
  }
}

async function runInventory(plan: InventoryPlan): Promise<Report> {
  const todo = plan.positions.filter((p) => p.duplicateNumbers.length === 0);
  let current = "";
  try {
    return await db.transaction(async (tx) => {
      for (const p of todo) {
        current = p.numbers[0] ?? p.name;
        const [item] = await tx.insert(inventoryItems).values({
          name: p.name, category: p.category, commissionedAt: p.commissionedAt, purchasePrice: p.price,
          retiredAt: p.retiredAt, quantity: p.quantity, retiredQuantity: p.retiredAt ? p.quantity : 0,
        }).returning({ id: inventoryItems.id });
        if (p.numbers.length) await tx.insert(inventoryItemNumbers).values(p.numbers.map((number) => ({ inventoryItemId: item.id, number })));
        if (p.tags.length) await tx.insert(inventoryItemTags).values(p.tags.map((tag) => ({ inventoryItemId: item.id, tag })));
        if (p.serials.length) await tx.insert(inventoryItemSerials).values(p.serials.map((serial) => ({ inventoryItemId: item.id, serial })));
      }
      const rows = todo.reduce((n, p) => n + p.quantity, 0);
      return {
        created: todo.length, skipped: plan.positions.length - todo.length, links: [], newRoles: [],
        lines: [t("import.report.rowsToPositions", { rows, positions: todo.length }), ...plan.levels.map((l) => `${l.level || "–"} → ${CATEGORY_LABEL[l.category]}`)],
      };
    });
  } catch (e) {
    throw new ImportError(t("import.error.rolledBack", { item: current, message: (e as Error).message }));
  }
}

void MAX_UPLOAD_BYTES;
