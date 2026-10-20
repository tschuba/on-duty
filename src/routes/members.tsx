import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { eq, and, asc, getTableColumns } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../db/index.js";
import { members, persons, memberRoles, memberRoleTypes, memberRoleAssignments, applications, applicationGuardians, donors, inventoryItemAssignments, lendingLoans } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout, MemberTabs } from "../components/layout.js";
import { Section } from "../components/section.js";
import { Icon } from "../components/icon.js";
import { FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { RolePopover } from "../components/role-popover.js";
import { ACTIVE_ROLE_ID } from "../lib/import.js";
import { ageLimitDate, deriveMemberStatus, isFormer, type MemberStatus } from "../lib/status.js";
import { setFlash } from "../lib/flash.js";
import { MultiSelectFilter } from "../components/multi-select-filter.js";
import { parsePagination, buildListUrl, PAGE_SIZE_OPTIONS } from "../lib/list-query.js";
import { formatDate } from "../lib/format.js";
import { trimmed } from "../lib/forms.js";
import { SEARCH_DEBOUNCE_MS } from "../lib/constants.js";
import { env } from "../env.js";
import { t } from "../i18n/index.js";
import { formatIban, isValidIban, normalizeIban } from "../lib/iban.js";
import { sendMail } from "../lib/mail.js";

export const memberRoutes = new Hono<{ Variables: Variables }>();

// ── Types ────────────────────────────────────────────────────────────────────

type Person = typeof persons.$inferSelect;
type MemberRow = typeof members.$inferSelect;
// birthDate is nullable in `persons` (donor-only persons need none) but this route's
// own form validation always requires it for a member — re-asserted non-null here.
type Member = Omit<Person, "id" | "birthDate"> & MemberRow & { birthDate: string };
type Role = typeof memberRoles.$inferSelect & { typeName?: string };

// Sorted by (type.sort_order, role.sort_order); typeName feeds tabs and filter groups.
export function fetchRoles(): Promise<Role[]> {
  return db
    .select({ ...getTableColumns(memberRoles), typeName: memberRoleTypes.name })
    .from(memberRoles)
    .innerJoin(memberRoleTypes, eq(memberRoleTypes.id, memberRoles.typeId))
    .orderBy(asc(memberRoleTypes.sortOrder), asc(memberRoles.sortOrder));
}
type Assignment = typeof memberRoleAssignments.$inferSelect & { role: Role };
type MemberWithStatus = Member & { assignments: Assignment[]; status: MemberStatus };

// ── DB helpers ───────────────────────────────────────────────────────────────

// ponytail: search filters in JS, not SQL — Drizzle's relational query API can't
// filter the base table by a `with` relation's columns, and the full list is
// already loaded into memory for stats/sort/pagination either way.
async function fetchMembersWithStatus(search?: string): Promise<MemberWithStatus[]> {
  const rows = await db.query.members.findMany({
    with: { person: true, assignments: { with: { role: true } } },
  });

  const all = rows.map(({ person, ...m }) => {
    const member = { ...(person as Person), ...m } as Member;
    return {
      ...member,
      assignments: m.assignments as Assignment[],
      status: deriveMemberStatus(member, m.assignments as Assignment[], env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT),
    };
  });

  if (!search) return all;
  const needle = search.toLowerCase();
  return all.filter((m) => m.lastName.toLowerCase().includes(needle) || m.firstName.toLowerCase().includes(needle));
}

async function fetchMember(id: string): Promise<MemberWithStatus | null> {
  const row = await db.query.members.findFirst({
    where: eq(members.id, id),
    with: { person: true, assignments: { with: { role: true } } },
  });
  if (!row) return null;
  const { person, ...m } = row;
  const member = { ...(person as Person), ...m } as Member;
  return {
    ...member,
    assignments: m.assignments as Assignment[],
    status: deriveMemberStatus(member, m.assignments as Assignment[], env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT),
  };
}

// Deleting a member also erases its person record (see backlog 19_Mitglieder-loeschen.md),
// but that record may still be needed elsewhere — donations carry retention duties of
// their own, and applications are a separate workflow. Block rather than cascade.
export type PersonBlockingLink = "donor" | "application" | "loan" | null;

async function findPersonBlockingLink(personId: string): Promise<PersonBlockingLink> {
  const [donorRow] = await db.select({ id: donors.id }).from(donors).where(eq(donors.personId, personId));
  if (donorRow) return "donor";
  const [applicationRow] = await db.select({ id: applications.id }).from(applications).where(eq(applications.personId, personId));
  if (applicationRow) return "application";
  const [guardianRow] = await db.select({ id: applicationGuardians.id }).from(applicationGuardians).where(eq(applicationGuardians.personId, personId));
  if (guardianRow) return "application";
  const [loanRow] = await db.select({ id: lendingLoans.id }).from(lendingLoans).where(eq(lendingLoans.borrowerPersonId, personId));
  if (loanRow) return "loan";
  return null;
}

// Not a blocking link (the assignment row is cascade-deleted, the inventory item
// itself survives and just loses this assignment) — just an informational count
// for the delete confirmation.
async function countAssignedInventoryItems(memberId: string): Promise<number> {
  const rows = await db.select({ quantity: inventoryItemAssignments.quantity }).from(inventoryItemAssignments).where(eq(inventoryItemAssignments.memberId, memberId));
  return rows.reduce((sum, r) => sum + r.quantity, 0);
}

// ── Sort / filter helpers ────────────────────────────────────────────────────

type SortKey = "lastName" | "birthDate" | "entryDate";
const DATE_SORT_KEYS: SortKey[] = ["birthDate", "entryDate"];

export function sortMembers(list: MemberWithStatus[], sort: SortKey, dir: "asc" | "desc"): MemberWithStatus[] {
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (sort === "lastName") {
      cmp = a.lastName.localeCompare(b.lastName, "de");
    } else {
      cmp = (a[sort] ?? "").localeCompare(b[sort] ?? "");
    }
    if (cmp === 0) cmp = a.lastName.localeCompare(b.lastName, "de");
    if (cmp === 0) cmp = a.firstName.localeCompare(b.firstName, "de");
    return dir === "asc" ? cmp : -cmp;
  });
}

// ── Flash cookie helpers ─────────────────────────────────────────────────────

// ── JSX components ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<MemberStatus, string> = {
  aktiv: t("status.aktiv"),
  passiv: t("status.passiv"),
  foerdernd: t("status.foerdernd"),
  kinder: t("status.kinder"),
  jugend: t("status.jugend"),
  ausgetreten: t("status.ausgetreten"),
  verstorben: t("status.verstorben"),
};

const STATUS_BADGE_CLASS: Record<MemberStatus, string> = {
  aktiv: "badge badge-sm badge-success",
  passiv: "badge badge-sm badge-neutral",
  foerdernd: "badge badge-sm badge-secondary",
  kinder: "badge badge-sm badge-warning",
  jugend: "badge badge-sm badge-info",
  ausgetreten: "badge badge-sm badge-ghost opacity-60",
  verstorben: "",
};

// Verstorbene: Kreuz statt Badge; compact (Tabellen) nur Icon im Badge-Format, sonst Icon + Text.
function StatusBadge({ status, compact = false }: { status: MemberStatus; compact?: boolean }) {
  if (status === "verstorben") {
    const label = STATUS_LABELS.verstorben;
    return compact ? (
      <span class="badge badge-sm badge-ghost opacity-60" title={label} role="img" aria-label={label}><Icon name="cross" class="w-3.5 h-3.5" /></span>
    ) : (
      <span class="badge badge-sm badge-ghost opacity-60 gap-1"><Icon name="cross" class="w-3.5 h-3.5" />{label}</span>
    );
  }
  return <span class={STATUS_BADGE_CLASS[status]}>{STATUS_LABELS[status]}</span>;
}
// Badge mit Platzhalter: ändert die Bearbeitung den Status, liegt das neue Badge leicht versetzt über dem gespeicherten.
function StatusBadgeSlot({ saved, next, oob }: { saved: MemberStatus; next?: MemberStatus; oob?: boolean }) {
  const changed = !!next && next !== saved;
  return (
    <span id="status-badge-slot" class="relative inline-block" hx-swap-oob={oob ? "true" : undefined}>
      <span class={changed ? "opacity-40" : ""}><StatusBadge status={saved} /></span>
      {changed && (
        <span class="absolute left-1/2 top-3/4 inline-flex rounded-full ring-2 ring-warning shadow-[0_0_8px_var(--color-warning)]" aria-live="polite">
          <span class="sr-only">{t("members.form.statusBecomes")} </span>
          <StatusBadge status={next} />
        </span>
      )}
    </span>
  );
}

export function SortIcon<T extends string>({ col, active, dir }: { col: T; active: T; dir: "asc" | "desc" }) {
  if (col !== active) return <span class="opacity-30 ml-1">↕</span>;
  return <span class="ml-1">{dir === "asc" ? "↑" : "↓"}</span>;
}

export function StatsCards({ all }: { all: MemberWithStatus[] }) {
  const counts = { aktiv: 0, passiv: 0, foerdernd: 0, kinder: 0, jugend: 0, ausgetreten: 0, verstorben: 0 };
  const genderCount = (status: "aktiv" | "kinder" | "jugend") => {
    const subset = all.filter((m) => m.status === status);
    return {
      m: subset.filter((m) => m.gender === "male").length,
      w: subset.filter((m) => m.gender === "female").length,
      o: subset.filter((m) => !m.gender).length,
    };
  };

  for (const m of all) counts[m.status]++;
  const aktiv = genderCount("aktiv");
  const jugend = genderCount("jugend");
  const kinder = genderCount("kinder");

  return (
    <div class="grid grid-cols-2 sm:grid-cols-6 gap-4 mb-6">
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.active")}</div>
        <div class="flex flex-wrap items-baseline gap-x-3">
          <div class="stat-value text-success">{counts.aktiv}</div>
          <div class="stat-desc text-base flex flex-1 gap-x-3 min-w-28"><span>{aktiv.m} ♂</span><span>{aktiv.w} ♀</span><span>{aktiv.o} o.A.</span></div>
        </div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.passive")}</div>
        <div class="stat-value">{counts.passiv}</div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.supporting")}</div>
        <div class="stat-value">{counts.foerdernd}</div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.youth")}</div>
        <div class="flex flex-wrap items-baseline gap-x-3">
          <div class="stat-value text-info">{counts.jugend}</div>
          <div class="stat-desc text-base flex flex-1 gap-x-3 min-w-28"><span>{jugend.m} ♂</span><span>{jugend.w} ♀</span><span>{jugend.o} o.A.</span></div>
        </div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.children")}</div>
        <div class="flex flex-wrap items-baseline gap-x-3">
          <div class="stat-value text-warning">{counts.kinder}</div>
          <div class="stat-desc text-base flex flex-1 gap-x-3 min-w-28"><span>{kinder.m} ♂</span><span>{kinder.w} ♀</span><span>{kinder.o} o.A.</span></div>
        </div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.former")}</div>
        <div class="stat-value text-base-content/40">{counts.ausgetreten + counts.verstorben}</div>
      </div>
    </div>
  );
}

export function MembersTable({
  items, sort, dir, page, pageSize, totalPages, totalCount, search, statusFilter, roleFilter, isEditor,
}: {
  items: MemberWithStatus[];
  sort: SortKey;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  search: string;
  statusFilter: MemberStatus[];
  roleFilter: string[];
  isEditor: boolean;
}) {
  const currentState = { search, status: statusFilter, role: roleFilter, sort, sort_dir: dir, page, pageSize };

  function sortUrl(col: SortKey) {
    const defaultDir = DATE_SORT_KEYS.includes(col) ? "desc" : "asc";
    const newDir = sort === col ? (dir === "asc" ? "desc" : "asc") : defaultDir;
    return buildListUrl("/members", currentState, { sort: col, sort_dir: newDir, page: 1 });
  }

  function pageUrl(p: number) {
    return buildListUrl("/members", currentState, { page: p });
  }

  const openRoles = (m: MemberWithStatus) =>
    m.assignments.filter((a) => !a.to).map((a) => roleLabel(a.role.title, a.note));

  return (
    <div id="members-results">
      <div>
        <ClickToEditHint />
        <table class="table table-zebra w-full">
          <thead>
            <tr>
              <th><a href={sortUrl("lastName")} class="link link-hover">{t("members.table.lastName")} <SortIcon col="lastName" active={sort} dir={dir} /></a></th>
              <th>{t("members.table.firstName")}</th>
              <th><a href={sortUrl("birthDate")} class="link link-hover">{t("members.table.birthDate")} <SortIcon col="birthDate" active={sort} dir={dir} /></a></th>
              <th><a href={sortUrl("entryDate")} class="link link-hover">{t("members.table.entryDate")} <SortIcon col="entryDate" active={sort} dir={dir} /></a></th>
              <th>{t("members.table.roles")}</th>
              <th>{t("members.table.status")}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colspan={6} class="text-center opacity-50 py-8">{t("members.table.empty")}</td></tr>
            ) : items.map((m) => (
              <tr
                key={m.id}
                class="cursor-pointer hover"
                onclick={`window.location='/members/${m.id}'`}
              >
                <td class="font-medium">{m.lastName}</td>
                <td>{m.firstName}</td>
                <td>{formatDate(m.birthDate)}</td>
                <td>{formatDate(m.entryDate)}</td>
                <td>
                  {(() => {
                    const roles = openRoles(m);
                    return (
                      <div class="flex flex-nowrap gap-1 items-center">
                        {roles.length === 1
                          ? <span class="badge badge-outline badge-sm whitespace-nowrap">{roles[0]}</span>
                          : roles.length > 1 && (
                            <RolePopover roles={roles} label={t("members.table.roleCount", { count: roles.length })} />
                          )}
                      </div>
                    );
                  })()}
                </td>
                <td><StatusBadge status={m.status} compact /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination + page size */}
      <div class="flex flex-wrap items-center justify-end gap-4 mt-4">
        <span class="text-sm opacity-70 mr-auto">{t("members.table.count", { count: totalCount })}</span>
        <div class="flex items-center gap-2 text-sm opacity-70">
          <span class="whitespace-nowrap">{t("members.table.pageSize")}</span>
          <select
            class="select select-bordered"
            onchange={`
              const v = this.value;
              localStorage.setItem('members_pageSize', v);
              const url = new URL(window.location.href);
              url.searchParams.set('pageSize', v);
              url.searchParams.set('page', '1');
              window.location = url.toString();
            `}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n} selected={n === pageSize}>{n}</option>
            ))}
          </select>
        </div>

        <div class="join">
          {page > 1 && <a href={pageUrl(page - 1)} class="join-item btn">«</a>}
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <a
              key={p}
              href={pageUrl(p)}
              class={`join-item btn${p === page ? " btn-active" : ""}`}
            >
              {p}
            </a>
          ))}
          {page < totalPages && <a href={pageUrl(page + 1)} class="join-item btn">»</a>}
        </div>
      </div>
    </div>
  );
}

// "Zeile hinzufügen"-Button: liest/schreibt data-next-index auf #role-rows statt
// querySelectorAll(...).length zu zählen — letzteres kollidiert nach Löschen einer
// Zwischenzeile (gleicher index für zwei Zeilen), was mit popovertarget (eindeutige
// id-Referenz) sichtbar würde statt wie bisher eine folgenlose doppelte DOM-id zu sein.
function RoleRowsAddButton({ initialCount }: { initialCount: number }) {
  return (
    <>
      <button
        type="button"
        class="btn btn-ghost"
        hx-get="/members/role-row"
        hx-target="#role-rows"
        hx-swap="beforeend"
        hx-include="[id='role-rows'] input[name='assignment_id[]']"
      >
        {t("members.form.addAssignment")}
      </button>
      <script dangerouslySetInnerHTML={{ __html: `
        (function () {
          var rows = document.getElementById('role-rows');
          if (!rows.dataset.nextIndex) rows.dataset.nextIndex = '${initialCount}';
          document.querySelector('[hx-get="/members/role-row"]').addEventListener('htmx:configRequest', function (e) {
            var next = parseInt(rows.dataset.nextIndex, 10);
            e.detail.parameters['index'] = next;
            rows.dataset.nextIndex = String(next + 1);
          });
        })();
      ` }} />
    </>
  );
}

function roleTypeTabs(roles: Role[]) {
  const seen = new Map<string, { id: string; name: string }>();
  for (const r of roles) if (!seen.has(r.typeId)) seen.set(r.typeId, { id: r.typeId, name: r.typeName ?? "" });
  return [...seen.values()];
}

const normalizeNote = (v?: string) => v?.trim().slice(0, 200) || null;
const roleLabel = (title: string, note?: string | null) => (note ? `${title} (${note})` : title);

export function RoleRow({
  index,
  roles,
  assignment,
  auto,
}: {
  index: number;
  roles: Role[];
  assignment?: Assignment;
  auto?: boolean;
}) {
  const selected = assignment ? roles.find((r) => r.id === assignment.memberRoleId) : undefined;
  const selectedTitle = selected?.title ?? "";
  const types = roleTypeTabs(roles);
  const activeType = selected?.typeId ?? types[0]?.id;
  return (
    <>
    <tr id={`role-row-${index}`} data-autofrom={auto ? "1" : undefined}>
      <td>
        <input type="hidden" name="assignment_idx[]" value={String(index)} />
        <input type="hidden" name="assignment_id[]" value={assignment?.id ?? ""} />
        <input type="hidden" name="assignment_role[]" class="role-combobox-value" value={assignment?.memberRoleId ?? ""} />
        <div class="relative">
          <button
            type="button"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded="false"
            aria-controls={`role-combobox-popover-${index}`}
            class={`role-combobox-trigger btn btn-outline justify-start font-normal min-w-48${selectedTitle ? "" : " opacity-50"}`}
            style={`anchor-name:--role-combobox-anchor-${index}`}
            data-placeholder={t("members.form.roleSelect")}
          >
            {selectedTitle || t("members.form.roleSelect")}
          </button>
          <div
            id={`role-combobox-popover-${index}`}
            popover="auto"
            class="role-combobox-popover dropdown-content bg-base-100 rounded-box shadow p-2"
            style={`position-anchor:--role-combobox-anchor-${index}`}
          >
            <label class="input input-bordered input-sm flex items-center gap-2 w-full mb-1">
              <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
              <input
                type="text"
                autocomplete="off"
                role="searchbox"
                aria-autocomplete="list"
                aria-controls={`role-combobox-list-${index}`}
                class="role-combobox-search grow min-w-0"
                placeholder={t("common.searchPlaceholder")}
              />
            </label>
            {types.length > 1 && (
              <div role="tablist" class="role-combobox-tabs tabs tabs-border mb-1">
                {types.map((ty) => (
                  <button
                    key={ty.id}
                    type="button"
                    role="tab"
                    data-type={ty.id}
                    class={`role-combobox-tab tab${ty.id === activeType ? " tab-active" : ""}`}
                  >
                    {ty.name}
                  </button>
                ))}
              </div>
            )}
            <ul id={`role-combobox-list-${index}`} role="listbox" class="role-combobox-list menu p-0">
              {roles.map((r) => (
                <li
                  key={r.id}
                  id={`role-combobox-option-${index}-${r.id}`}
                  role="option"
                  data-id={r.id}
                  data-title={r.title}
                  data-type={r.typeId}
                  aria-selected={r.id === assignment?.memberRoleId ? "true" : "false"}
                >
                  <a class="min-h-11 flex items-center gap-2">{r.title}{r.grantsActiveStatus && <span class="badge badge-sm badge-outline">{t("members.form.roleActive")}</span>}</a>
                </li>
              ))}
              <li class="role-combobox-no-match hidden"><a class="disabled pointer-events-none opacity-50 min-h-11 flex items-center">{t("members.form.roleNoMatch")}</a></li>
            </ul>
            <button type="button" class={`role-combobox-reset btn btn-sm btn-ghost w-full mt-1${selectedTitle ? "" : " hidden"}`}>
              {t("common.reset")}
            </button>
          </div>
        </div>
      </td>
      <td>
        <input
          type="date"
          name="assignment_from[]"
          class="input input-bordered w-full min-w-40"
          value={assignment?.from ?? ""}
          required
        />
      </td>
      <td>
        <input
          type="date"
          name="assignment_to[]"
          class="input input-bordered w-full min-w-40"
          value={assignment?.to ?? ""}
        />
      </td>
      <td>
        <input type="text" name="assignment_note[]" class="input input-bordered w-full min-w-48" maxlength={200} value={assignment?.note ?? ""} />
      </td>
      <td>
        <button
          type="button"
          class="btn btn-ghost text-error"
          onclick={`var f=this.closest('form'),tr=this.closest('tr');tr.nextElementSibling.remove();tr.remove();f.dispatchEvent(new Event('change'))`}
        >
          ✕
        </button>
      </td>
      <script dangerouslySetInnerHTML={{ __html: `
        if (!window.__roleComboboxBound) {
          window.__roleComboboxBound = true;

          function rcWrap(trigger) { return trigger.closest('.relative'); }
          function rcPopover(trigger) { return rcWrap(trigger).querySelector('.role-combobox-popover'); }
          function rcSearch(trigger) { return rcPopover(trigger).querySelector('.role-combobox-search'); }
          function rcList(trigger) { return rcPopover(trigger).querySelector('.role-combobox-list'); }
          function rcHidden(trigger) { return trigger.closest('td').querySelector('.role-combobox-value'); }
          function rcResetBtn(trigger) { return rcPopover(trigger).querySelector('.role-combobox-reset'); }
          function rcOptions(list) { return Array.from(list.querySelectorAll('li[role=option]')); }
          function rcNoMatch(list) { return list.querySelector('.role-combobox-no-match'); }

          function rcClearActive(list) {
            rcOptions(list).forEach(function (li) { li.classList.remove('menu-active'); });
          }

          function rcSetActive(trigger, li) {
            var list = rcList(trigger);
            rcClearActive(list);
            if (li) li.classList.add('menu-active');
          }

          function rcVisibleOptions(list) {
            return rcOptions(list).filter(function (li) { return li.style.display !== 'none'; });
          }

          function rcFilter(trigger) {
            var list = rcList(trigger);
            var needle = rcSearch(trigger).value.trim().toLowerCase();
            var tab = rcPopover(trigger).querySelector('.role-combobox-tab.tab-active');
            var anyVisible = false;
            rcOptions(list).forEach(function (li) {
              // Search spans all types; without a search term only the active tab shows.
              var match = needle ? li.dataset.title.toLowerCase().includes(needle) : (!tab || li.dataset.type === tab.dataset.type);
              li.style.display = match ? '' : 'none';
              if (match) anyVisible = true;
            });
            rcNoMatch(list).classList.toggle('hidden', anyVisible);
            rcClearActive(list);
          }

          function rcIsOpen(trigger) { return rcPopover(trigger).matches(':popover-open'); }

          function rcOpen(trigger) {
            rcPopover(trigger).showPopover();
            trigger.setAttribute('aria-expanded', 'true');
            rcSearch(trigger).value = '';
            var tabs = Array.from(rcPopover(trigger).querySelectorAll('.role-combobox-tab'));
            if (tabs.length) {
              var sel = rcOptions(rcList(trigger)).find(function (o) { return o.getAttribute('aria-selected') === 'true'; });
              var want = sel ? sel.dataset.type : tabs[0].dataset.type;
              tabs.forEach(function (tb) { tb.classList.toggle('tab-active', tb.dataset.type === want); });
            }
            rcFilter(trigger);
            rcSearch(trigger).focus();
          }

          function rcClose(trigger) {
            rcPopover(trigger).hidePopover();
            trigger.setAttribute('aria-expanded', 'false');
            rcClearActive(rcList(trigger));
          }

          function rcSetValue(trigger, id, title) {
            rcHidden(trigger).value = id;
            rcHidden(trigger).dispatchEvent(new Event('change', { bubbles: true }));
            trigger.textContent = title || trigger.dataset.placeholder;
            trigger.classList.toggle('opacity-50', !id);
            trigger.classList.remove('btn-error');
            trigger.removeAttribute('aria-invalid');
            rcResetBtn(trigger).classList.toggle('hidden', !id);
          }

          function rcSelect(trigger, li) {
            rcSetValue(trigger, li.dataset.id, li.dataset.title);
            rcOptions(rcList(trigger)).forEach(function (o) { o.setAttribute('aria-selected', o === li ? 'true' : 'false'); });
            rcClose(trigger);
            trigger.focus();
          }

          document.body.addEventListener('click', function (e) {
            var trigger = e.target.closest('.role-combobox-trigger');
            if (trigger) {
              if (rcIsOpen(trigger)) { rcClose(trigger); } else { rcOpen(trigger); }
              return;
            }
            var tabBtn = e.target.closest('.role-combobox-tab');
            if (tabBtn) {
              var tabTrigger = rcWrap(tabBtn.closest('.role-combobox-popover')).querySelector('.role-combobox-trigger');
              rcPopover(tabTrigger).querySelectorAll('.role-combobox-tab').forEach(function (tb) { tb.classList.toggle('tab-active', tb === tabBtn); });
              rcSearch(tabTrigger).value = '';
              rcFilter(tabTrigger);
              rcSearch(tabTrigger).focus();
              return;
            }
            var resetBtn = e.target.closest('.role-combobox-reset');
            if (resetBtn) {
              var t = rcWrap(resetBtn).querySelector('.role-combobox-trigger');
              rcSetValue(t, '', '');
              rcOptions(rcList(t)).forEach(function (o) { o.setAttribute('aria-selected', 'false'); });
              rcClose(t);
              t.focus();
              return;
            }
            var li = e.target.closest('.role-combobox-list li[role=option]');
            if (li) {
              var trig = rcWrap(li.closest('.role-combobox-popover')).querySelector('.role-combobox-trigger');
              rcSelect(trig, li);
              return;
            }
            var openTrigger = document.querySelector('.role-combobox-trigger[aria-expanded=true]');
            if (openTrigger && !rcPopover(openTrigger).contains(e.target)) rcClose(openTrigger);
          });

          document.body.addEventListener('input', function (e) {
            var trigger = e.target.closest('.role-combobox-search') && rcWrap(e.target).querySelector('.role-combobox-trigger');
            if (!trigger) return;
            rcFilter(trigger);
          });

          document.body.addEventListener('keydown', function (e) {
            var trigger = e.target.closest('.role-combobox-trigger');
            if (trigger && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
              e.preventDefault();
              if (!rcIsOpen(trigger)) rcOpen(trigger);
              return;
            }
            var searchInput = e.target.closest('.role-combobox-search');
            if (!searchInput) return;
            var trig = rcWrap(searchInput).querySelector('.role-combobox-trigger');
            var list = rcList(trig);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              var visible = rcVisibleOptions(list);
              if (!visible.length) return;
              var current = visible.findIndex(function (li) { return li.classList.contains('menu-active'); });
              var next = e.key === 'ArrowDown' ? current + 1 : current - 1;
              if (next < 0) next = 0;
              if (next > visible.length - 1) next = visible.length - 1;
              rcSetActive(trig, visible[next]);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              var active = list.querySelector('li.menu-active');
              if (active) rcSelect(trig, active);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              rcClose(trig);
              trig.focus();
            }
          });

          document.currentScript.closest('form').addEventListener('submit', function (e) {
            var missing = Array.from(document.querySelectorAll('.role-combobox-trigger')).filter(function (trig) {
              return !rcHidden(trig).value;
            });
            missing.forEach(function (trig) { trig.classList.add('btn-error'); trig.setAttribute('aria-invalid', 'true'); });
            if (missing.length) { e.preventDefault(); missing[0].focus(); }
          });
        }
      ` }} />
    </tr>
    <tr class="border-0"><td colSpan={5} class="p-0"><div id={`role-hint-${index}`} /></td></tr>
    </>
  );
}

// Bank data is plaintext, protected by permission only (backlog 34). Without read
// permission the section is not rendered at all — not even a hint that data exists.
function parseBankData(body: Record<string, any>, errors: Record<string, string>) {
  const rawIban = trimmed(body, "iban");
  const iban = rawIban ? normalizeIban(rawIban) : null;
  if (iban && !isValidIban(iban)) errors.iban = t("members.error.ibanInvalid");
  return { iban, bic: trimmed(body, "bic").toUpperCase() || null, accountHolder: trimmed(body, "accountHolder") || null };
}

function BankDataSection({
  m,
  editable,
  errors,
}: {
  m: Partial<Member>;
  editable: boolean;
  errors?: Record<string, string>;
}) {
  const iban = m.iban ? formatIban(m.iban) : "";
  const key = `bank-open:${m.id ?? "new"}`;
  const body = editable ? (
    <>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-control">
          <label class="label"><span class="label-text">{t("members.bank.iban")}</span></label>
          <input type="text" name="iban" value={iban} class={`input input-bordered w-full${errors?.iban ? " input-error" : ""}`} />
          {errors?.iban && <span class="text-error text-sm mt-1">{errors.iban}</span>}
        </div>
        <div class="form-control">
          <label class="label"><span class="label-text">{t("members.bank.bic")}</span></label>
          <input type="text" name="bic" value={m.bic ?? ""} class="input input-bordered w-full" />
        </div>
      </div>
      <div class="form-control">
        <label class="label"><span class="label-text">{t("members.bank.accountHolder")}</span></label>
        <input type="text" name="accountHolder" value={m.accountHolder ?? ""} class="input input-bordered w-full" />
        <span class="text-sm opacity-60 mt-1">{t("members.bank.accountHolderHint")}</span>
      </div>
    </>
  ) : (
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <ViewField label={t("members.bank.iban")} value={iban} />
      <ViewField label={t("members.bank.bic")} value={m.bic} />
      <ViewField label={t("members.bank.accountHolder")} value={m.accountHolder || `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim()} />
    </div>
  );
  // Zugeklappt, außer bei IBAN-Fehler; Felder bleiben im DOM und werden mitgeschickt.
  // Zustand pro Tab in sessionStorage, damit er Ansicht ↔ Bearbeiten überdauert.
  return (
    <>
      <Section title={t("members.bank.title")} open={!!errors?.iban} class="mt-6" attrs={{ "data-bank-key": key }}>
        <div class="space-y-4">{body}</div>
      </Section>
      <script dangerouslySetInnerHTML={{ __html: `(function(){var d=document.currentScript.previousElementSibling,k=d.dataset.bankKey;
try{if(sessionStorage.getItem(k))d.open=true;}catch(e){}
d.addEventListener('toggle',function(){try{d.open?sessionStorage.setItem(k,'1'):sessionStorage.removeItem(k);}catch(e){}});})();` }} />
    </>
  );
}

// Live preview of the derived status: HTMX posts the whole form to /members/status-preview,
// which uses the same deriveMemberStatus as saving.
function StatusPreview({ saved }: { saved?: MemberStatus }) {
  return (
    <div
      hx-post="/members/status-preview"
      hx-include="closest form"
      hx-trigger="load, input from:closest form delay:300ms, change from:closest form"
      hx-target="#status-preview"
      hx-swap="innerHTML"
    >
      {saved && <input type="hidden" name="savedStatus" value={saved} />}
      <div id="status-preview" class="text-sm opacity-80 space-y-1" />
    </div>
  );
}

function parseFormAssignments(body: Record<string, any>, allRoles: Role[]): (Assignment & { rowIdx?: string })[] {
  const roles = [body["assignment_role[]"]].flat() as string[];
  const froms = [body["assignment_from[]"]].flat() as string[];
  const tos = [body["assignment_to[]"]].flat() as string[];
  const idxs = [body["assignment_idx[]"]].flat() as string[];
  return roles.flatMap((r, i) => {
    const role = allRoles.find((x) => x.id === r);
    return role && froms[i] ? [{ from: froms[i], to: tos[i] || null, role, rowIdx: idxs[i] } as Assignment & { rowIdx?: string }] : [];
  });
}

// POST /members/status-preview — HTMX fragment: derived status, conflict with the start choice, age-limit hints
memberRoutes.post("/status-preview", requireAuth("members:write"), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const birthDate = trimmed(body, "birthDate");
  const allRoles = await db.select().from(memberRoles);
  const planned = parseFormAssignments(body, allRoles);
  const member = { exitDate: trimmed(body, "exitDate") || null, deathDate: trimmed(body, "deathDate") || null, birthDate };
  if (!birthDate) return c.html(<></>);
  const status = deriveMemberStatus(member, planned, env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT);
  const choice = trimmed(body, "startStatus");
  const name = `${trimmed(body, "firstName")} ${trimmed(body, "lastName")}`.trim() || t("members.form.thisMember");
  const conflict = ["aktiv", "passiv", "foerdernd"].includes(choice)
    ? checkStartStatus(choice as StartStatus, member, planned, name)
    : undefined;
  const saved = trimmed(body, "savedStatus") as MemberStatus;
  const cutoff = ageLimitDate(birthDate, env.ACTIVE_AGE_LIMIT);
  const hintKey = new Date().toISOString().slice(0, 10) >= cutoff ? "members.form.roleAgeLimitHint.past" : "members.form.roleAgeLimitHint.future";
  // Nur anzeigen, wenn die Altersgrenze erreicht ist oder innerhalb des nächsten Jahres erreicht wird.
  const horizon = new Date();
  horizon.setFullYear(horizon.getFullYear() + 1);
  const nearLimit = cutoff <= horizon.toISOString().slice(0, 10);
  const hinted = new Set(
    !nearLimit ? [] : planned.filter((a) => a.role.grantsActiveStatus && (!a.to || a.to >= cutoff)).map((a) => a.rowIdx)
  );
  const datum = new Date(cutoff).toLocaleDateString("de-DE");
  // Alle Zeilen schicken, damit nicht mehr zutreffende Hinweise wieder verschwinden.
  const allIdx = [body["assignment_idx[]"]].flat().filter(Boolean) as string[];
  return c.html(
    <>
      {saved && <StatusBadgeSlot saved={saved} next={status} oob />}
      {conflict && <p class="text-warning">{conflict.message}</p>}
      {allIdx.map((i) => (
        <div id={`role-hint-${i}`} hx-swap-oob="true" class={hinted.has(i) ? "text-warning text-sm px-4 pb-2" : ""}>
          {hinted.has(i) && t(hintKey, { datum })}
        </div>
      ))}
    </>
  );
});

function MemberFormFields({
  m,
  errors,
}: {
  m?: Partial<Member>;
  errors?: Record<string, string>;
}) {
  function field(
    name: keyof Member,
    label: string,
    type = "text",
    required = false
  ) {
    const value = m?.[name] ?? "";
    const err = errors?.[name as string];
    return (
      <div class="form-control">
        <label class="label">
          <span class="label-text">{label}{required && <span class="text-error ml-1">*</span>}</span>
        </label>
        <input
          type={type}
          name={name as string}
          value={value as string}
          class={`input input-bordered w-full${err ? " input-error" : ""}`}
          {...(required ? { required: true } : {})}
        />
        {err && <span class="text-error text-sm mt-1">{err}</span>}
      </div>
    );
  }

  const genderErr = errors?.gender;
  return (
    <>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("lastName", t("members.form.lastName"), "text", true)}
        {field("firstName", t("members.form.firstName"), "text", true)}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="form-control">
          <label class="label"><span class="label-text">{t("members.form.gender")}</span></label>
          <div class="flex flex-wrap gap-x-6 gap-y-2 min-h-12 items-center">
            {([["", "genderNone"], ["male", "genderMale"], ["female", "genderFemale"]] as const).map(([v, k]) => (
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="gender" value={v} class="radio radio-sm" checked={(m?.gender ?? "") === v} />
                <span>{t(`members.form.${k}`)}</span>
              </label>
            ))}
          </div>
          {genderErr && <span class="text-error text-sm mt-1">{genderErr}</span>}
        </div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("birthDate", t("members.form.birthDate"), "date", true)}
        {field("deathDate", t("members.form.deathDate"), "date")}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("firstEntryDate", t("members.form.firstEntryDate"), "date")}
        {field("entryDate", t("members.form.entryDate"), "date", true)}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("exitDate", t("members.form.exitDate"), "date")}
      </div>
      <Section title={t("members.contact.title")} open>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("street", t("members.form.street"))}
        {field("houseNumber", t("members.form.houseNumber"))}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("zip", t("members.form.zip"))}
        {field("city", t("members.form.city"))}
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("phone", t("members.form.phone"))}
        {field("mobile", t("members.form.mobile"), "tel")}
        {field("email", t("members.form.email"), "email")}
      </div>
      </Section>
    </>
  );
}

function ReactivationModal({
  memberId,
  formData,
}: {
  memberId: string;
  formData: Record<string, string | string[]>;
}) {
  return (
    <dialog class="modal modal-open">
      <div class="modal-box">
        <h3 class="font-bold text-lg">{t("members.reactivation.title")}</h3>
        <p class="py-4 opacity-70">{t("members.reactivation.body")}</p>
        <div class="modal-action flex gap-2">
          <form method="post" action={`/members/${memberId}?reactivate=1`}>
            {Object.entries(formData).flatMap(([k, v]) =>
              Array.isArray(v)
                ? v.map((val, i) => <input key={`${k}-${i}`} type="hidden" name={k} value={val} />)
                : [<input key={k} type="hidden" name={k} value={v} />]
            )}
            <button type="submit" class="btn btn-primary">{t("common.yes")}</button>
          </form>
          <form method="post" action={`/members/${memberId}?reactivate=0`}>
            {Object.entries(formData).flatMap(([k, v]) =>
              Array.isArray(v)
                ? v.map((val, i) => <input key={`${k}-${i}`} type="hidden" name={k} value={val} />)
                : [<input key={k} type="hidden" name={k} value={v} />]
            )}
            <button type="submit" class="btn btn-ghost">{t("common.no")}</button>
          </form>
          <a href={`/members/${memberId}`} class="btn btn-ghost">{t("common.cancel")}</a>
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <a href={`/members/${memberId}`}>×</a>
      </form>
    </dialog>
  );
}

// ── Delete member ────────────────────────────────────────────────────────────

function DeleteMemberButton({
  member,
  blockedBy,
  assignedItemsCount,
}: {
  member: Pick<MemberWithStatus, "id" | "firstName" | "lastName">;
  blockedBy: PersonBlockingLink;
  assignedItemsCount: number;
}) {
  if (blockedBy) {
    return (
      <button
        class="btn btn-ghost text-base-content/30"
        disabled
        aria-label={t("common.delete")}
        title={t(`members.delete.blocked${blockedBy === "donor" ? "Donor" : blockedBy === "loan" ? "Loan" : "Application"}`)}
      >
        <Icon name="trash" class="h-5 w-5" />
        <span class="@max-xl:hidden">{t("common.delete")}</span>
      </button>
    );
  }

  return (
    <>
      <HeaderAction icon="trash" label={t("common.delete")} class="btn-outline btn-error" onclick="document.getElementById('delete-member-modal').showModal()" />
      <dialog id="delete-member-modal" class="modal">
        <div class="modal-box">
          <h3 class="font-bold text-lg">{t("members.delete.confirmTitle")}</h3>
          <p class="py-2 opacity-70">
            {t("members.delete.confirmBody", { name: `${member.firstName} ${member.lastName}` })}
          </p>
          {assignedItemsCount > 0 && (
            <p class="alert alert-info text-sm">{t("members.delete.hintInventory", { count: assignedItemsCount })}</p>
          )}
          <div class="modal-action">
            <form method="dialog">
              <button class="btn">{t("common.cancel")}</button>
            </form>
            <form method="post" action={`/members/${member.id}/delete`}>
              <button type="submit" class="btn btn-error">{t("common.delete")}</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>{t("common.close")}</button>
        </form>
      </dialog>
    </>
  );
}

// ── Export modal ─────────────────────────────────────────────────────────────

function MembersExportModal() {
  return (
    <>
      <dialog id="members-export-modal" class="modal">
        <div class="modal-box">
          <h3 class="font-bold text-lg mb-4">{t("common.excelExport")}</h3>
          <p class="text-sm opacity-60 mb-4">{t("members.export.subtitle")}</p>
          <div class="space-y-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="exp-addr" class="checkbox checkbox-sm" />
              <span>{t("members.export.address")} <span class="opacity-50 text-xs">{t("members.export.addressHint")}</span></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="exp-contact" class="checkbox checkbox-sm" />
              <span>{t("members.export.contact")} <span class="opacity-50 text-xs">{t("members.export.contactHint")}</span></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="exp-dates" class="checkbox checkbox-sm" />
              <span>{t("members.export.dates")} <span class="opacity-50 text-xs">{t("members.export.datesHint")}</span></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="exp-gender" class="checkbox checkbox-sm" />
              <span>{t("members.export.genderCol")}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="exp-assignments" class="checkbox checkbox-sm" />
              <span>{t("members.export.assignments")} <span class="opacity-50 text-xs">{t("members.export.assignmentsHint")}</span></span>
            </label>
          </div>
          <div class="modal-action">
            <button id="members-export-download" class="btn btn-primary">{t("common.download")}</button>
            <form method="dialog"><button class="btn btn-ghost">{t("common.cancel")}</button></form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop"><button>×</button></form>
      </dialog>
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          var fields=['addr','contact','dates','gender','assignments'];
          fields.forEach(function(f){
            var el=document.getElementById('exp-'+f);
            var s=localStorage.getItem('members_export_'+f);
            el.checked=s===null?true:s==='1';
            el.addEventListener('change',function(){localStorage.setItem('members_export_'+f,el.checked?'1':'0');});
          });
          document.getElementById('members-export-download').addEventListener('click',function(){
            var p=new URLSearchParams();
            fields.forEach(function(f){if(document.getElementById('exp-'+f).checked)p.set(f,'1');});
            window.location='/members/export?'+p;
            document.getElementById('members-export-modal').close();
          });
        })();
      ` }} />
    </>
  );
}

// ── Role filter dropdown ──────────────────────────────────────────────────────

function RoleFilterDropdown({ roles, roleFilter, activeRoleIds }: {
  roles: Role[];
  roleFilter: string[];
  activeRoleIds: Set<string>;
}) {
  return (
    <MultiSelectFilter
      param="role"
      autoApply
      searchable
      options={roles.map((r) => ({ value: r.id, label: r.title, group: r.typeName, dim: !activeRoleIds.has(r.id), hint: activeRoleIds.has(r.id) ? undefined : "(0)" }))}
      selected={roleFilter}
      allLabel={t("members.filter.allRoles")}
      countLabel={(count) => t("members.table.roleCount", { count })}
      applyLabel={t("common.apply")}
      resetLabel={t("common.reset")}
      searchPlaceholder={t("common.searchPlaceholder")}
    />
  );
}

// ── List query parsing ──────────────────────────────────────────────────────

export type ListQuery = {
  search: string;
  sort: SortKey;
  dir: "asc" | "desc";
  statusFilter: MemberStatus[];
  roleFilter: string[];
  page: number;
  pageSize: number;
};

export function parseListQuery(q: Record<string, string>, statusRaw: string[], roleFilterRaw: string[]): ListQuery {
  const search = q.search ?? "";
  const sort = (q.sort as SortKey) || "lastName";
  const dir = (q.sort_dir as "asc" | "desc") || "asc";
  const statusParsed = statusRaw.filter((s) => STATUS_LABELS[s as MemberStatus]); // unbekannte (z. B. altes "archiviert") ignorieren
  const statusFilter: MemberStatus[] = (statusParsed.length > 0
    ? statusParsed
    : ["aktiv", "passiv", "foerdernd", "kinder", "jugend"]) as MemberStatus[];
  const roleFilter = roleFilterRaw.filter(Boolean);
  const { page, pageSize } = parsePagination(q);

  return { search, sort, dir, statusFilter, roleFilter, page, pageSize };
}

// ── Routes ───────────────────────────────────────────────────────────────────

// GET /members — list
memberRoutes.get("/", requireAuth("members:read"), async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const { search, sort, dir, statusFilter, roleFilter, page, pageSize } = parseListQuery(
    q, c.req.queries("status") ?? [], c.req.queries("role") ?? []
  );

  const [all, allRoles] = await Promise.all([
    fetchMembersWithStatus(search || undefined),
    fetchRoles(),
  ]);
  const activeRoleIds = new Set(
    all.flatMap((m) => m.assignments.filter((a) => !a.to).map((a) => a.memberRoleId))
  );
  const filtered = all
    .filter((m) => statusFilter.includes(m.status))
    .filter((m) => roleFilter.length === 0 || m.assignments.some((a) => !a.to && roleFilter.includes(a.memberRoleId)));
  const sorted = sortMembers(filtered, sort, dir);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize);

  const isEditor = user.permissions.has("members:write");
  const isHtmx = c.req.header("HX-Request") === "true";

  const tableEl = (
    <MembersTable
      items={pageItems}
      sort={sort}
      dir={dir}
      page={page}
      pageSize={pageSize}
      totalPages={totalPages}
      totalCount={sorted.length}
      search={search}
      statusFilter={statusFilter}
      roleFilter={roleFilter}
      isEditor={isEditor}
    />
  );

  if (isHtmx) return c.html(tableEl);

  function filterToggleUrl(s: MemberStatus) {
    const next = statusFilter.includes(s)
      ? statusFilter.filter((x) => x !== s)
      : [...statusFilter, s];
    return buildListUrl("/members", { search, status: statusFilter, role: roleFilter, sort, sort_dir: dir, page, pageSize }, { status: next, page: 1 });
  }

  return c.html(
    <Layout title={t("members.title")} user={user} activeNav="members">
      <MemberTabs active="members" user={user} />
      <PageHeader title={t("members.title")} actions={<>
        <HeaderAction icon="arrow-down-tray" label={t("common.export")} onclick="document.getElementById('members-export-modal').showModal()" />
        {isEditor && <HeaderAction variant="primary" icon="plus" label={t("members.addMember")} href="/members/new" class="btn-primary" />}
      </>} />

      <StatsCards all={all} />

      {/* Toolbar */}
      <div class="flex flex-wrap gap-3 mb-4 items-center">
        <label class="input input-bordered flex items-center gap-2 w-64">
          <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
          <input
            type="search"
            name="search"
            placeholder={t("common.searchPlaceholder")}
            value={search}
            class="grow min-w-0"
            hx-get="/members"
            hx-trigger={`input changed delay:${SEARCH_DEBOUNCE_MS}ms`}
            hx-target="#members-results"
            hx-include="[name='search']"
            hx-vals={JSON.stringify({ sort, sort_dir: dir, status: statusFilter, role: roleFilter, page: 1, pageSize })}
          />
        </label>
        <div class="join">
          {(["aktiv", "passiv", "foerdernd", "jugend", "kinder", "ausgetreten", "verstorben"] as MemberStatus[]).map((s) => (
            <a
              key={s}
              href={filterToggleUrl(s)}
              class={`btn join-item${statusFilter.includes(s) ? " btn-primary btn-outline" : " btn-ghost"}`}
            >
              {s === "verstorben" && <Icon name="cross" class="w-4 h-4 inline-block align-middle mr-1" />}{STATUS_LABELS[s]}
            </a>
          ))}
        </div>
        <RoleFilterDropdown roles={allRoles} roleFilter={roleFilter} activeRoleIds={activeRoleIds} />
      </div>

      {tableEl}

      <MembersExportModal />

      {/* Restore pageSize from localStorage on first load */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const saved = localStorage.getItem('members_pageSize');
          const url = new URL(window.location.href);
          if (saved && !url.searchParams.has('pageSize')) {
            url.searchParams.set('pageSize', saved);
            url.searchParams.set('page', '1');
            history.replaceState(null, '', url.toString());
            window.location.reload();
          }
        })();
      ` }} />
    </Layout>
  );
});

// GET /members/new — new member form. ?personId (+?applicationId) links an existing
// persons row instead of creating a new one — used by the "Annehmen" step of the
// applications review workflow (see routes/applications.tsx). ?linkMemberId
// (+?applicationId) instead links a duplicate-matched members row (archived: a
// reactivation; active: an update), prefilled with the application's (fresher)
// contact data.
memberRoutes.get("/new", requireAuth("members:write"), async (c) => {
  const user = c.get("user");
  const canWriteBank = user.permissions.has("members:bank-data:write");
  const roles = await fetchRoles();
  const personId = c.req.query("personId");
  const linkMemberId = c.req.query("linkMemberId");
  const applicationId = c.req.query("applicationId");

  let prefill: Partial<Member> | undefined;
  let linkedWasArchived = false;
  if (personId) {
    const [alreadyMember] = await db.select({ id: members.id }).from(members).where(eq(members.personId, personId));
    if (alreadyMember) {
      setFlash(c, t("members.error.personAlreadyMember"), "error");
      return c.redirect(applicationId ? `/applications/${applicationId}` : "/members");
    }
    const [person] = await db.select().from(persons).where(eq(persons.id, personId));
    if (person) prefill = { ...person, birthDate: person.birthDate ?? "" };
  } else if (linkMemberId) {
    const target = await fetchMember(linkMemberId);
    if (!target) return c.notFound();
    linkedWasArchived = !!(target.exitDate || target.deathDate);
    let contactOverride: Partial<Member> = {};
    if (applicationId) {
      const app = await db.query.applications.findFirst({ where: eq(applications.id, applicationId), with: { person: true } });
      if (app) {
        contactOverride = {
          lastName: app.person.lastName, firstName: app.person.firstName, birthDate: app.person.birthDate ?? "",
          street: app.person.street, houseNumber: app.person.houseNumber, zip: app.person.zip, city: app.person.city,
          email: app.person.email, phone: app.person.phone,
        };
      }
    }
    const { assignments: _assignments, status: _status, ...targetMember } = target;
    prefill = { ...targetMember, ...contactOverride, exitDate: "", deathDate: "" };
  }

  return c.html(
    <Layout title={t("members.newMember")} user={user} activeNav="members">
      <PageHeader title={t("members.newMember")} backHref="/members" subtitle={t("common.requiredLegend")} actions={<FormActions formId="member-form" cancelHref="/members" saveAndNew />} />
      <form id="member-form" method="post" action="/members/new" class="space-y-4 max-w-4xl">
        {personId && <input type="hidden" name="personId" value={personId} />}
        {linkMemberId && <input type="hidden" name="linkMemberId" value={linkMemberId} />}
        {applicationId && <input type="hidden" name="applicationId" value={applicationId} />}
        {applicationId && !linkMemberId && <p class="alert alert-info text-sm">{t("members.applicant.notice")}</p>}
        {linkMemberId && <p class="alert alert-info text-sm">{t(linkedWasArchived ? "members.relink.notice" : "members.relink.noticeActive")}</p>}
        <StartStatusSelect value="" />
        <MemberFormFields m={prefill} />
        {canWriteBank && !linkMemberId && <BankDataSection m={prefill ?? {}} editable />}
        {applicationId && (
          <label class="label cursor-pointer justify-start gap-3">
            <input type="checkbox" name="notifyApplicant" class="checkbox" />
            <span class="label-text">{t("members.form.notifyApplicant")}</span>
          </label>
        )}
        <Section title={t("members.form.assignments")} open>
        <StatusPreview />
        <PassiveHint show={false} />
        <div class="overflow-x-auto">
          <table class="table w-full">
            <thead>
              <tr>
                <th>{t("members.form.role")} <span class="text-error">*</span></th>
                <th>{t("members.form.from")} <span class="text-error">*</span></th>
                <th>{t("members.form.to")}</th><th>{t("members.form.note")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="role-rows"></tbody>
          </table>
        </div>
        <RoleRowsAddButton initialCount={0} />
        <input type="hidden" id="roles-json" value={JSON.stringify(roles)} />
        </Section>
      </form>
    </Layout>
  );
});

type StartStatus = "aktiv" | "passiv" | "foerdernd";

function PassiveHint({ show }: { show: boolean }) {
  return <p id="startStatusPassiveHint" class="text-sm opacity-70" hidden={!show}>{t("members.form.startStatusPassiveHint", { grenze: String(env.ACTIVE_AGE_LIMIT) })}</p>;
}

function StartStatusSelect({ value }: { value: StartStatus | "" }) {
  return (
    <fieldset class="space-y-2">
      <legend class="sr-only">{t("members.form.startStatus")}</legend>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(["aktiv", "passiv", "foerdernd"] as const).map((s) => (
          <label class="card bg-base-200 border-2 border-transparent cursor-pointer has-[:checked]:border-primary">
            <div class="card-body p-4 gap-1">
              <div class="flex items-center gap-2">
                <input type="radio" name="startStatus" value={s} class="radio radio-primary radio-sm" checked={s === value} required />
                <span class="font-semibold">{STATUS_LABELS[s]}</span>
              </div>
              <p class="text-xs opacity-70">{t(`members.form.startStatus.${s}`)}</p>
            </div>
          </label>
        ))}
      </div>
      <p id="startStatusError" class="text-error text-sm" role="alert" hidden>{t("members.form.startStatusRequired")}</p>
      <script dangerouslySetInnerHTML={{ __html: `
        document.addEventListener('DOMContentLoaded', function () {
          var form = document.querySelector('input[name="startStatus"]').closest('form'), rows = document.getElementById('role-rows');
          function current() { var c = form.querySelector('input[name="startStatus"]:checked'); return c ? c.value : ''; }
          function prefill() {
            if (current() !== 'aktiv' || rows.children.length) return;
            var i = parseInt(rows.dataset.nextIndex || '0', 10);
            rows.dataset.nextIndex = String(i + 1);
            htmx.ajax('GET', '/members/role-row?' + new URLSearchParams({ index: i, roleId: '${ACTIVE_ROLE_ID}', from: form.elements.entryDate.value, auto: '1' }), { target: '#role-rows', swap: 'beforeend' });
          }
          var err = document.getElementById('startStatusError');
          form.querySelectorAll('input[name="startStatus"]').forEach(function (r) {
            // Eigene Meldung bei der Kartengruppe statt der Browser-Blase am einzelnen Radio.
            r.addEventListener('invalid', function (e) { e.preventDefault(); err.hidden = false; err.scrollIntoView({ block: 'center' }); });
            r.addEventListener('change', function () {
              err.hidden = true;
              document.getElementById('startStatusPassiveHint').hidden = current() !== 'passiv';
              prefill();
            });
          });
          form.elements.entryDate.addEventListener('input', function (e) {
            rows.querySelectorAll('tr[data-autofrom] input[name="assignment_from[]"]').forEach(function (el) { el.value = e.target.value; });
          });
          rows.addEventListener('input', function (e) {
            if (e.target.name === 'assignment_from[]') e.target.closest('tr').removeAttribute('data-autofrom');
          });
          prefill();
        });
      ` }} />
    </fieldset>
  );
}

// Vergleicht die gewählte Anlage-Auswahl mit dem abgeleiteten Status. Kinder/Jugend zählen als aktiv.
function checkStartStatus(
  choice: StartStatus,
  member: { exitDate: string | null; deathDate: string | null; birthDate: string },
  planned: Assignment[],
  name: string
): { message: string; suggest?: StartStatus } | undefined {
  const derived = deriveMemberStatus(member, planned, env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT);
  if (isFormer(derived)) return undefined;
  const grenze = String(env.ACTIVE_AGE_LIMIT);
  const datum = new Date(ageLimitDate(member.birthDate, env.ACTIVE_AGE_LIMIT)).toLocaleDateString("de-DE");
  const runningActive = planned.find((a) => a.role.grantsActiveStatus && !a.to);
  const anyActive = planned.find((a) => a.role.grantsActiveStatus);
  const isActiveFamily = derived === "aktiv" || derived === "kinder" || derived === "jugend";
  const suggest = isActiveFamily ? (derived === "aktiv" ? "aktiv" : undefined) : (derived as StartStatus);
  if (choice === "aktiv" && !isActiveFamily) {
    return derived === "passiv"
      ? { message: t("members.error.status.activeAgeLimit", { grenze, datum, name }), suggest }
      : { message: t("members.error.status.activeNoRole", { name }), suggest };
  }
  if (choice === "passiv" && derived !== "passiv") {
    return derived === "foerdernd"
      ? { message: t("members.error.status.passiveNoRole", { grenze, datum, name }), suggest }
      : { message: t("members.error.status.passiveRunning", { grenze, datum, name }), suggest };
  }
  if (choice === "foerdernd" && derived !== "foerdernd") {
    const titel = (runningActive ?? anyActive)?.role.title ?? "";
    const status = STATUS_LABELS[derived].toLowerCase();
    return { message: t("members.error.status.supportingHasRole", { titel, name, status }), suggest };
  }
  return undefined;
}

// GET /members/role-row — HTMX fragment: one assignment row
memberRoutes.get("/role-row", requireAuth("members:write"), async (c) => {
  const index = Number(c.req.query("index") ?? 0);
  const roles = await fetchRoles();
  // Optional prefill (used for the "aktiv" start choice): ?roleId=&from=&auto=1
  const roleId = c.req.query("roleId");
  const assignment = roleId
    ? ({ id: "", memberRoleId: roleId, from: c.req.query("from") ?? "", to: null, note: null } as Assignment)
    : undefined;
  return c.html(<RoleRow index={index} roles={roles} assignment={assignment} auto={c.req.query("auto") === "1"} />);
});

// POST /members/new — create member (or link an existing person, see GET /new)
memberRoutes.post("/new", requireAuth("members:write"), async (c) => {
  const user = c.get("user");
  const canWriteBank = user.permissions.has("members:bank-data:write");
  const body = await c.req.parseBody({ all: true });
  const errors: Record<string, string> = {};

  const personId = trimmed(body, "personId") || undefined;
  const linkMemberId = trimmed(body, "linkMemberId") || undefined;
  // Re-linking reuses an existing member row, so bank data is only taken for brand-new members.
  const bank = canWriteBank && !linkMemberId ? parseBankData(body, errors) : null;
  const applicationId = trimmed(body, "applicationId") || undefined;
  const notifyApplicant = body.notifyApplicant === "on";

  let targetPersonId: string | undefined;
  let linkedWasArchived = false;
  if (linkMemberId) {
    const [target] = await db.select({ personId: members.personId, exitDate: members.exitDate, deathDate: members.deathDate }).from(members).where(eq(members.id, linkMemberId));
    if (!target) return c.notFound();
    targetPersonId = target.personId;
    linkedWasArchived = !!(target.exitDate || target.deathDate);
  }

  const lastName = trimmed(body, "lastName");
  const firstName = trimmed(body, "firstName");
  const birthDate = trimmed(body, "birthDate");
  const entryDate = trimmed(body, "entryDate");
  const firstEntryDate = trimmed(body, "firstEntryDate") || null;

  if (!lastName) errors.lastName = t("common.required");
  if (!firstName) errors.firstName = t("common.required");
  if (!birthDate) errors.birthDate = t("common.required");
  if (!entryDate) errors.entryDate = t("common.required");
  if (firstEntryDate && entryDate && firstEntryDate > entryDate) errors.firstEntryDate = t("members.form.firstEntryDateAfterEntry");

  // Parse assignments (keep rows unfiltered so index i stays aligned across role/from/to)
  const assignmentRoles = [body["assignment_role[]"]].flat() as string[];
  const assignmentFroms = [body["assignment_from[]"]].flat() as string[];
  const assignmentTos = [body["assignment_to[]"]].flat() as string[];
  const assignmentNotes = [body["assignment_note[]"]].flat() as (string | undefined)[];

  // Validate that every non-empty row has both a role and a from date
  if (assignmentRoles.some((r, i) => (r || assignmentFroms[i]) && (!r || !assignmentFroms[i]))) {
    errors._assignments = t("members.error.assignmentIncomplete");
  }

  // Check for duplicate open assignments (same role without to-date)
  const openRoles = assignmentRoles.filter((r, i) => r && !assignmentTos[i]);
  const dupRole = openRoles.find((r, i) => openRoles.indexOf(r) !== i);
  if (dupRole && !errors._assignments) {
    const role = await db.select().from(memberRoles).where(eq(memberRoles.id, dupRole)).then((r) => r[0]);
    errors._assignments = t("members.error.duplicateRole", { role: role?.title ?? dupRole });
  }

  // Auswahl aktiv/passiv/fördernd gegen den abgeleiteten Status prüfen (nur Anlegen, Server entscheidet).
  const startStatus = (trimmed(body, "switchStatus") || trimmed(body, "startStatus")) as StartStatus;
  let statusConflict: { message: string; suggest?: "aktiv" | "passiv" | "foerdernd" } | undefined;
  if (Object.keys(errors).length === 0 && ["aktiv", "passiv", "foerdernd"].includes(startStatus)) {
    const allRoles = await db.select().from(memberRoles);
    const planned = assignmentRoles.flatMap((r, i) => {
      const role = allRoles.find((x) => x.id === r);
      return role && assignmentFroms[i] ? [{ from: assignmentFroms[i], to: assignmentTos[i] || null, role } as Assignment] : [];
    });
    const exitDate = (body.exitDate as string) || null;
    const deathDate = (body.deathDate as string) || null;
    statusConflict = checkStartStatus(startStatus, { exitDate, deathDate, birthDate }, planned, `${firstName} ${lastName}`);
    if (statusConflict) errors._status = statusConflict.message;
  }

  if (Object.keys(errors).length > 0) {
    const roles = await fetchRoles();
    const m: Partial<Member> = {
      lastName, firstName,
      street: body.street as string,
      houseNumber: body.houseNumber as string,
      zip: body.zip as string,
      city: body.city as string,
      gender: (body.gender as any) || null,
      birthDate,
      entryDate,
      exitDate: (body.exitDate as string) || null,
      deathDate: (body.deathDate as string) || null,
      phone: body.phone as string,
      mobile: body.mobile as string,
      email: body.email as string,
      ...(bank && { ...bank, iban: trimmed(body, "iban") }),
    };
    return c.html(
      <Layout title={t("members.newMember")} user={user} activeNav="members">
        <PageHeader title={t("members.newMember")} backHref="/members" subtitle={t("common.requiredLegend")} actions={<FormActions formId="member-form" cancelHref="/members" saveAndNew />} />
        {errors._assignments && (
          <div class="alert alert-error mb-4">{errors._assignments}</div>
        )}
        <form id="member-form" method="post" action="/members/new" class="space-y-4 max-w-4xl">
          {personId && <input type="hidden" name="personId" value={personId} />}
          {linkMemberId && <input type="hidden" name="linkMemberId" value={linkMemberId} />}
          {applicationId && <input type="hidden" name="applicationId" value={applicationId} />}
          {applicationId && !linkMemberId && <p class="alert alert-info text-sm">{t("members.applicant.notice")}</p>}
          {linkMemberId && <p class="alert alert-info text-sm">{t(linkedWasArchived ? "members.relink.notice" : "members.relink.noticeActive")}</p>}
          {statusConflict && (
            <div class="alert alert-error text-sm flex-wrap">
              <span>{statusConflict.message}</span>
              {statusConflict.suggest && (
                <button type="submit" name="switchStatus" value={statusConflict.suggest} class="btn btn-sm">
                  {t("members.form.createAs", { status: STATUS_LABELS[statusConflict.suggest].toLowerCase() })}
                </button>
              )}
            </div>
          )}
          <StartStatusSelect value={startStatus} />
          <MemberFormFields m={m} errors={errors} />
          {canWriteBank && !linkMemberId && <BankDataSection m={m} editable errors={errors} />}
          {applicationId && (
            <label class="label cursor-pointer justify-start gap-3">
              <input type="checkbox" name="notifyApplicant" class="checkbox" checked={notifyApplicant} />
              <span class="label-text">{t("members.form.notifyApplicant")}</span>
            </label>
          )}
          <Section title={t("members.form.assignments")} open>
          <StatusPreview />
          <PassiveHint show={startStatus === "passiv"} />
          <div class="overflow-x-auto">
            <table class="table w-full">
              <thead><tr><th>{t("members.form.role")} <span class="text-error">*</span></th><th>{t("members.form.from")} <span class="text-error">*</span></th><th>{t("members.form.to")}</th><th>{t("members.form.note")}</th><th></th></tr></thead>
              <tbody id="role-rows">
                {assignmentRoles.map((_, i) => (
                  <RoleRow key={i} index={i} roles={roles} assignment={{
                    id: "",
                    memberId: "",
                    memberRoleId: assignmentRoles[i],
                    from: assignmentFroms[i] ?? "",
                    to: assignmentTos[i] || null,
                    note: normalizeNote(assignmentNotes[i]),
                    autoClosed: false,
                    role: roles.find((r) => r.id === assignmentRoles[i])!,
                  }} />
                ))}
              </tbody>
            </table>
          </div>
          <RoleRowsAddButton initialCount={assignmentRoles.length} />
          </Section>
        </form>
      </Layout>,
      422
    );
  }

  const personFields = {
    lastName, firstName,
    street: (body.street as string) || null,
    houseNumber: (body.houseNumber as string) || null,
    zip: (body.zip as string) || null,
    city: (body.city as string) || null,
    gender: (body.gender as any) || null,
    birthDate,
    phone: (body.phone as string) || null,
    mobile: (body.mobile as string) || null,
    email: (body.email as string) || null,
  };

  const [{ id: newMemberId }] = await db.transaction(async (tx) => {
    let pid = personId;
    let memberId: string;

    if (linkMemberId && targetPersonId) {
      pid = targetPersonId;
      await tx.update(persons).set(personFields).where(eq(persons.id, pid));
      await tx.update(members).set({
        entryDate,
        firstEntryDate,
        exitDate: (body.exitDate as string) || null,
        deathDate: (body.deathDate as string) || null,
      }).where(eq(members.id, linkMemberId));
      memberId = linkMemberId;
    } else {
      if (pid) {
        await tx.update(persons).set(personFields).where(eq(persons.id, pid));
      } else {
        const [person] = await tx.insert(persons).values(personFields).returning();
        pid = person.id;
      }

      const [m] = await tx.insert(members).values({
        personId: pid,
        entryDate,
        firstEntryDate,
        exitDate: (body.exitDate as string) || null,
        deathDate: (body.deathDate as string) || null,
        ...bank,
      }).returning();
      memberId = m.id;
    }

    for (let i = 0; i < assignmentRoles.length; i++) {
      if (!assignmentRoles[i]) continue;
      await tx.insert(memberRoleAssignments).values({
        memberId,
        memberRoleId: assignmentRoles[i],
        from: assignmentFroms[i],
        to: assignmentTos[i] || null,
        note: normalizeNote(assignmentNotes[i]),
      });
    }

    // Guarded by status="open" so a double-submit (e.g. two tabs) can't re-approve
    // an application that already went through this once.
    if (applicationId) {
      await tx.update(applications)
        .set({ status: "approved", reviewedAt: new Date(), reviewedBy: user.id })
        .where(and(eq(applications.id, applicationId), eq(applications.status, "open")));
    }

    return [{ id: memberId }];
  });

  if (applicationId && notifyApplicant && personFields.email) {
    const bodyKey = linkMemberId && linkedWasArchived ? "applications.mail.approvedBodyRejoin" : "applications.mail.approvedBody";
    await sendMail(personFields.email, t("applications.mail.approvedSubject"), t(bodyKey));
  }

  setFlash(c, t("members.flash.created"), "success");
  const saveAndNew = String(body._action ?? "") === "save_and_new";
  return c.redirect(saveAndNew ? "/members/new" : "/members");
});

// ── Export sheet building ───────────────────────────────────────────────────

export type ExportOptions = { addr: boolean; contact: boolean; dates: boolean; gender: boolean; assignments: boolean };
export type ExportAssignmentRow = { memberId: string; roleTitle: string; note?: string | null; from: string | null; to: string | null };
export type ExportSheet = { name: string; header: string[]; rows: (string | Date | null)[][] };

export function buildExportSheets(
  rawMembers: Member[],
  rawAssignments: ExportAssignmentRow[],
  opts: ExportOptions
): ExportSheet[] {
  const allMembers = [...rawMembers].sort((a, b) => {
    const cmp = a.lastName.localeCompare(b.lastName, "de");
    return cmp !== 0 ? cmp : a.firstName.localeCompare(b.firstName, "de");
  });

  const header: string[] = [t("members.table.lastName"), t("members.table.firstName")];
  if (opts.gender) header.push(t("members.export.genderCol"));
  if (opts.dates) header.push(t("members.form.birthDate"), t("members.form.entryDate"), t("members.form.firstEntryDate"), t("members.form.exitDate"), t("members.form.deathDate"));
  if (opts.addr) header.push(t("members.form.street"), t("members.form.houseNumber"), t("members.form.zip"), t("members.form.city"));
  if (opts.contact) header.push(t("members.form.phone"), t("members.form.mobile"), t("members.form.email"));

  const GENDER: Record<string, string> = { male: t("members.form.genderMale"), female: t("members.form.genderFemale") };
  const toDate = (s: string | null) => s ? new Date(s + "T00:00:00") : null;

  const rows = allMembers.map((m) => {
    const row: (string | Date | null)[] = [m.lastName, m.firstName];
    if (opts.gender) row.push(GENDER[m.gender ?? ""] ?? t("members.form.genderNone"));
    if (opts.dates) row.push(toDate(m.birthDate), toDate(m.entryDate), toDate(m.firstEntryDate), toDate(m.exitDate), toDate(m.deathDate));
    if (opts.addr) row.push(m.street ?? "", m.houseNumber ?? "", m.zip ?? "", m.city ?? "");
    if (opts.contact) row.push(m.phone ?? "", m.mobile ?? "", m.email ?? "");
    return row;
  });

  const sheets: ExportSheet[] = [{ name: t("members.export.sheetMembers"), header, rows }];

  if (opts.assignments) {
    const nameMap = new Map(allMembers.map((m) => [m.id, m]));
    const asgns = [...rawAssignments].sort((a, b) => {
      const ma = nameMap.get(a.memberId)!, mb = nameMap.get(b.memberId)!;
      const cmp = ma.lastName.localeCompare(mb.lastName, "de");
      if (cmp !== 0) return cmp;
      const cmp2 = ma.firstName.localeCompare(mb.firstName, "de");
      return cmp2 !== 0 ? cmp2 : (a.from ?? "").localeCompare(b.from ?? "");
    });

    const asgHeader = [t("members.table.lastName"), t("members.table.firstName"), t("members.form.role"), t("members.form.from"), t("members.form.to"), t("members.form.note")];
    const asgRows = asgns.map((a) => {
      const m = nameMap.get(a.memberId);
      return [m?.lastName ?? "", m?.firstName ?? "", a.roleTitle, toDate(a.from), toDate(a.to), a.note ?? ""];
    });
    sheets.push({ name: t("members.export.sheetAssignments"), header: asgHeader, rows: asgRows });
  }

  return sheets;
}

// GET /members/export — xlsx download
memberRoutes.get("/export", requireAuth("members:read"), async (c) => {
  const q = c.req.query();
  const opts: ExportOptions = {
    addr: q.addr === "1",
    contact: q.contact === "1",
    dates: q.dates === "1",
    gender: q.gender === "1",
    assignments: q.assignments === "1",
  };

  const memberRows = await db.query.members.findMany({ with: { person: true } });
  const allMembers: Member[] = memberRows.map(({ person, ...m }) => ({ ...(person as Person), ...m } as Member));
  const rawAssignments: ExportAssignmentRow[] = opts.assignments
    ? await db.select({
        memberId: memberRoleAssignments.memberId,
        roleTitle: memberRoles.title,
        from: memberRoleAssignments.from,
        to: memberRoleAssignments.to,
        note: memberRoleAssignments.note,
      })
        .from(memberRoleAssignments)
        .innerJoin(memberRoles, eq(memberRoles.id, memberRoleAssignments.memberRoleId))
    : [];

  const sheets = buildExportSheets(allMembers, rawAssignments, opts);

  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([sheet.header, ...sheet.rows]), sheet.name);
  }

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = `${env.ORG_NAME.replace(/\s+/g, "_")}_mitglieder_${today}.xlsx`;

  c.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
});

// GET /members/:id — view or edit
// Zurück zur Herkunftsseite (Referer, same-origin); Mitgliederseiten selbst ausgenommen.
function backHref(c: Context): string {
  try {
    const ref = new URL(c.req.header("referer") ?? "");
    if (ref.host === new URL(c.req.url).host && !ref.pathname.startsWith("/members/")) return ref.pathname + ref.search;
  } catch {}
  return "/members";
}

memberRoutes.get("/:id", requireAuth("members:read"), async (c) => {
  const user = c.get("user");
  const m = await fetchMember(c.req.param("id"));
  if (!m) return c.notFound();

  const isEditor = user.permissions.has("members:write");
  const canWriteBank = user.permissions.has("members:bank-data:write");
  const canReadBank = canWriteBank || user.permissions.has("members:bank-data:read");
  const roles = isEditor ? await fetchRoles() : [];

  const canDelete = user.permissions.has("members:delete");
  const blockedBy = canDelete ? await findPersonBlockingLink(m.personId) : null;
  const assignedItemsCount = canDelete ? await countAssignedInventoryItems(m.id) : 0;

  if (!isEditor) {
    // Read-only view
    const openRoles = m.assignments.filter((a) => !a.to);
    return c.html(
      <Layout title={`${m.firstName} ${m.lastName}`} user={user} activeNav="members">
        <PageHeader title={<>{m.firstName} {m.lastName} <StatusBadge status={m.status} /></>} backHref={backHref(c)} actions={<>{canDelete && <DeleteMemberButton member={m} blockedBy={blockedBy} assignedItemsCount={assignedItemsCount} />}</>} />
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
          <ViewField label={t("members.form.lastName")} value={m.lastName} />
          <ViewField label={t("members.form.firstName")} value={m.firstName} />
          <ViewField label={t("members.form.birthDate")} value={formatDate(m.birthDate)} />
          {m.firstEntryDate && <ViewField label={t("members.form.firstEntryDate")} value={formatDate(m.firstEntryDate)} />}
          <ViewField label={t("members.form.entryDate")} value={formatDate(m.entryDate)} />
          <ViewField label={t("members.form.gender")} value={m.gender === "male" ? t("members.form.genderMale") : m.gender === "female" ? t("members.form.genderFemale") : t("members.form.genderNone")} />
          {m.exitDate && <ViewField label={t("members.form.exitDate")} value={formatDate(m.exitDate)} />}
          {m.deathDate && <ViewField label={t("members.form.deathDate")} value={formatDate(m.deathDate)} />}
        </div>
        <Section title={t("members.contact.title")} open class="mt-6">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <ViewField label={t("members.view.streetNr")} value={[m.street, m.houseNumber].filter(Boolean).join(" ") || null} />
            <ViewField label={t("members.view.zipCity")} value={[m.zip, m.city].filter(Boolean).join(" ") || null} />
            <ViewField label={t("members.form.phone")} value={m.phone} />
            <ViewField label={t("members.form.mobile")} value={m.mobile} />
            <ViewField label={t("members.form.email")} value={m.email} />
          </div>
        </Section>
        {openRoles.length > 0 && (
          <Section title={t("members.view.activeFunctions")} open>
            <div class="flex flex-wrap gap-2">
              {openRoles.map((a) => (
                <span class="badge badge-outline">{roleLabel(a.role.title, a.note)} {t("members.view.sinceDate", { date: formatDate(a.from) })}</span>
              ))}
            </div>
          </Section>
        )}
        {canWriteBank ? (
          <form method="post" action={`/members/${m.id}`} class="space-y-4">
            <BankDataSection m={m} editable />
            <button type="submit" class="btn btn-primary">{t("common.save")}</button>
          </form>
        ) : canReadBank && <BankDataSection m={m} editable={false} />}
      </Layout>
    );
  }

  return c.html(
    <Layout title={`${m.firstName} ${m.lastName}`} user={user} activeNav="members">
      <PageHeader title={<>{m.firstName} {m.lastName} <StatusBadgeSlot saved={m.status} /></>} backHref={backHref(c)} subtitle={t("common.requiredLegend")} actions={<>{canDelete && <DeleteMemberButton member={m} blockedBy={blockedBy} assignedItemsCount={assignedItemsCount} />}<FormActions formId="member-form" cancelHref={backHref(c)} /></>} />
      <form id="member-form" method="post" action={`/members/${m.id}`} class="space-y-4 max-w-4xl">
        <MemberFormFields m={m} />
        {canReadBank && <BankDataSection m={m} editable={canWriteBank} />}
        <Section title={t("members.form.assignments")} open>
        <StatusPreview saved={m.status} />
        <div class="overflow-x-auto">
          <table class="table w-full">
            <thead><tr><th>{t("members.form.role")} <span class="text-error">*</span></th><th>{t("members.form.from")} <span class="text-error">*</span></th><th>{t("members.form.to")}</th><th>{t("members.form.note")}</th><th></th></tr></thead>
            <tbody id="role-rows">
              {m.assignments.map((a, i) => (
                <RoleRow key={a.id} index={i} roles={roles} assignment={a} />
              ))}
            </tbody>
          </table>
        </div>
        <RoleRowsAddButton initialCount={m.assignments.length} />
        </Section>
      </form>
    </Layout>
  );
});

// POST /members/:id — update member
memberRoutes.post("/:id", requireAuth(["members:write", "members:bank-data:write"]), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const reactivateParam = c.req.query("reactivate");
  const canWriteMaster = user.permissions.has("members:write");
  const canWriteBank = user.permissions.has("members:bank-data:write");

  const existing = await fetchMember(id);
  if (!existing) return c.notFound();

  const body = await c.req.parseBody({ all: true });
  const errors: Record<string, string> = {};

  // Fields without permission are ignored, not rejected: bank-only users never touch master data.
  if (!canWriteMaster) {
    const bank = parseBankData(body, errors);
    if (errors.iban) {
      return c.html(
        <Layout title={`${existing.firstName} ${existing.lastName}`} user={user} activeNav="members">
          <form method="post" action={`/members/${id}`} class="space-y-4">
            <BankDataSection m={{ ...existing, ...bank, iban: trimmed(body, "iban") }} editable errors={errors} />
            <button type="submit" class="btn btn-primary">{t("common.save")}</button>
          </form>
        </Layout>,
        422
      );
    }
    await db.update(members).set(bank).where(eq(members.id, id));
    setFlash(c, t("members.flash.saved"), "success");
    return c.redirect(`/members/${id}`);
  }
  const bank = canWriteBank ? parseBankData(body, errors) : null;

  const lastName = trimmed(body, "lastName");
  const firstName = trimmed(body, "firstName");
  const birthDate = trimmed(body, "birthDate");
  const entryDate = trimmed(body, "entryDate");
  const firstEntryDate = trimmed(body, "firstEntryDate") || null;
  const exitDate = (body.exitDate as string) || null;
  const deathDate = (body.deathDate as string) || null;

  if (!lastName) errors.lastName = t("common.required");
  if (!firstName) errors.firstName = t("common.required");
  if (!birthDate) errors.birthDate = t("common.required");
  if (!entryDate) errors.entryDate = t("common.required");
  if (firstEntryDate && entryDate && firstEntryDate > entryDate) errors.firstEntryDate = t("members.form.firstEntryDateAfterEntry");

  const assignmentIds = [body["assignment_id[]"]].flat() as string[];
  // Keep rows unfiltered so index i stays aligned across role/from/to
  const assignmentRoles = [body["assignment_role[]"]].flat() as string[];
  const assignmentFroms = [body["assignment_from[]"]].flat() as string[];
  const assignmentTos = [body["assignment_to[]"]].flat() as string[];
  const assignmentNotes = [body["assignment_note[]"]].flat() as (string | undefined)[];

  // Validate that every non-empty row has both a role and a from date
  if (assignmentRoles.some((r, i) => (r || assignmentFroms[i]) && (!r || !assignmentFroms[i]))) {
    errors._assignments = t("members.error.assignmentIncomplete");
  }

  const openRoles = assignmentRoles.filter((r, i) => r && !assignmentTos[i]);
  const dupRole = openRoles.find((r, i) => openRoles.indexOf(r) !== i);
  if (dupRole && !errors._assignments) {
    const role = await db.select().from(memberRoles).where(eq(memberRoles.id, dupRole)).then((r) => r[0]);
    errors._assignments = t("members.error.duplicateRole", { role: role?.title ?? dupRole });
  }

  if (Object.keys(errors).length > 0) {
    const roles = await fetchRoles();
    const m = { ...existing, lastName, firstName, birthDate, entryDate, firstEntryDate, exitDate, deathDate,
      street: body.street as string, houseNumber: body.houseNumber as string,
      zip: body.zip as string, city: body.city as string,
      gender: (body.gender as any) || null,
      phone: body.phone as string, mobile: body.mobile as string, email: body.email as string,
      ...(bank && { ...bank, iban: trimmed(body, "iban") }) };
    return c.html(
      <Layout title={`${firstName} ${lastName}`} user={user} activeNav="members">
        <PageHeader title={<>{firstName} {lastName} <StatusBadgeSlot saved={existing.status} /></>} backHref={"/members"} subtitle={t("common.requiredLegend")} actions={<><FormActions formId="member-form" cancelHref={`/members/${id}`} /></>} />
        {errors._assignments && <div class="alert alert-error mb-4">{errors._assignments}</div>}
        <form id="member-form" method="post" action={`/members/${id}`} class="space-y-4 max-w-4xl">
          <MemberFormFields m={m} errors={errors} />
          {canWriteBank && <BankDataSection m={m} editable errors={errors} />}
          <Section title={t("members.form.assignments")} open>
          <StatusPreview saved={existing.status} />
          <div class="overflow-x-auto">
            <table class="table w-full">
              <thead><tr><th>{t("members.form.role")} <span class="text-error">*</span></th><th>{t("members.form.from")} <span class="text-error">*</span></th><th>{t("members.form.to")}</th><th>{t("members.form.note")}</th><th></th></tr></thead>
              <tbody id="role-rows">
                {assignmentRoles.map((_, i) => (
                  <RoleRow key={i} index={i} roles={roles} assignment={{
                    id: assignmentIds[i] ?? "",
                    memberId: id,
                    memberRoleId: assignmentRoles[i],
                    from: assignmentFroms[i] ?? "",
                    to: assignmentTos[i] || null,
                    note: normalizeNote(assignmentNotes[i]),
                    autoClosed: false,
                    role: roles.find((r) => r.id === assignmentRoles[i])!,
                  }} />
                ))}
              </tbody>
            </table>
          </div>
          <RoleRowsAddButton initialCount={assignmentRoles.length} />
          </Section>
        </form>
      </Layout>,
      422
    );
  }

  // Reactivation check: was archived before, will not be after save
  const wasArchived = isFormer(existing.status);
  const willBeArchived = !!(exitDate || deathDate);
  const isReactivation = wasArchived && !willBeArchived;
  const autoClosedAssignments = existing.assignments.filter((a) => a.autoClosed);

  if (isReactivation && autoClosedAssignments.length > 0 && reactivateParam === undefined) {
    const roles = await fetchRoles();
    const formData: Record<string, string | string[]> = {
      lastName, firstName,
      street: (body.street as string) ?? "",
      houseNumber: (body.houseNumber as string) ?? "",
      zip: (body.zip as string) ?? "",
      city: (body.city as string) ?? "",
      gender: (body.gender as string) ?? "",
      birthDate, entryDate, firstEntryDate: firstEntryDate ?? "",
      exitDate: exitDate ?? "",
      deathDate: deathDate ?? "",
      ...(canWriteBank && { iban: trimmed(body, "iban"), bic: trimmed(body, "bic"), accountHolder: trimmed(body, "accountHolder") }),
      phone: (body.phone as string) ?? "",
      mobile: (body.mobile as string) ?? "",
      email: (body.email as string) ?? "",
      "assignment_id[]": assignmentIds,
      "assignment_role[]": assignmentRoles,
      "assignment_from[]": assignmentFroms,
      "assignment_to[]": assignmentTos.map((t) => t ?? ""),
    };

    return c.html(
      <Layout title={`${firstName} ${lastName}`} user={user} activeNav="members">
        <PageHeader title={<>{firstName} {lastName} <StatusBadgeSlot saved={existing.status} /></>} backHref={"/members"} subtitle={t("common.requiredLegend")} actions={<><FormActions formId="member-form" cancelHref={`/members/${id}`} /></>} />
        <form id="member-form" method="post" action={`/members/${id}`} class="space-y-4 max-w-4xl">
          <MemberFormFields m={{ ...existing, lastName, firstName, birthDate, entryDate, firstEntryDate, exitDate, deathDate,
            street: body.street as string, houseNumber: body.houseNumber as string,
            zip: body.zip as string, city: body.city as string, gender: (body.gender as any) || null,
            phone: body.phone as string, mobile: body.mobile as string, email: body.email as string }} />
          <Section title={t("members.form.assignments")} open>
          <StatusPreview saved={existing.status} />
          <div class="overflow-x-auto">
            <table class="table w-full">
              <thead><tr><th>{t("members.form.role")} <span class="text-error">*</span></th><th>{t("members.form.from")} <span class="text-error">*</span></th><th>{t("members.form.to")}</th><th>{t("members.form.note")}</th><th></th></tr></thead>
              <tbody id="role-rows">
                {assignmentRoles.map((_, i) => (
                  <RoleRow key={i} index={i} roles={roles} assignment={{
                    id: assignmentIds[i] ?? "",
                    memberId: id,
                    memberRoleId: assignmentRoles[i],
                    from: assignmentFroms[i] ?? "",
                    to: assignmentTos[i] || null,
                    note: normalizeNote(assignmentNotes[i]),
                    autoClosed: false,
                    role: roles.find((r) => r.id === assignmentRoles[i])!,
                  }} />
                ))}
              </tbody>
            </table>
          </div>
          <RoleRowsAddButton initialCount={assignmentRoles.length} />
          </Section>
        </form>
        <ReactivationModal memberId={id} formData={formData} />
      </Layout>
    );
  }

  await db.transaction(async (tx) => {
    // Update person + member fields
    await tx.update(persons).set({
      lastName, firstName,
      street: (body.street as string) || null,
      houseNumber: (body.houseNumber as string) || null,
      zip: (body.zip as string) || null,
      city: (body.city as string) || null,
      gender: (body.gender as any) || null,
      birthDate,
      phone: (body.phone as string) || null,
      mobile: (body.mobile as string) || null,
      email: (body.email as string) || null,
    }).where(eq(persons.id, existing.personId));

    await tx.update(members).set({
      entryDate,
      firstEntryDate,
      exitDate: exitDate || null,
      deathDate: deathDate || null,
      ...bank,
    }).where(eq(members.id, id));

    // Archive: close open assignments when exitDate or deathDate set
    if ((exitDate || deathDate) && !(existing.exitDate || existing.deathDate)) {
      await tx.update(memberRoleAssignments)
        .set({ to: (exitDate || deathDate)!, autoClosed: true })
        .where(eq(memberRoleAssignments.memberId, id));
    }

    // Reactivation: reopen auto_closed if requested
    if (isReactivation && reactivateParam === "1") {
      await tx.update(memberRoleAssignments)
        .set({ to: null, autoClosed: false })
        .where(eq(memberRoleAssignments.memberId, id));
    }

    // Reconcile role assignments: delete removed, upsert existing/new
    const submittedIds = assignmentIds.filter(Boolean);
    const existingIds = existing.assignments.map((a) => a.id);
    const deletedIds = existingIds.filter((eid) => !submittedIds.includes(eid));

    for (const did of deletedIds) {
      await tx.delete(memberRoleAssignments).where(eq(memberRoleAssignments.id, did));
    }

    for (let i = 0; i < assignmentRoles.length; i++) {
      if (!assignmentRoles[i]) continue;
      const aid = assignmentIds[i];
      const vals = {
        memberId: id,
        memberRoleId: assignmentRoles[i],
        from: assignmentFroms[i],
        to: assignmentTos[i] || null,
        note: normalizeNote(assignmentNotes[i]),
      };
      if (aid) {
        await tx.update(memberRoleAssignments).set(vals).where(eq(memberRoleAssignments.id, aid));
      } else {
        await tx.insert(memberRoleAssignments).values(vals);
      }
    }
  });

  setFlash(c, t("members.flash.saved"), "success");
  return c.redirect(`/members/${id}`);
});

// POST /members/:id/delete — permanently deletes the member AND its person record
// (name, address, contact data). Role assignments cascade at the DB level. Blocked
// (not cascaded further) if the same person still has a donor profile or is linked
// to an application — see findPersonBlockingLink.
memberRoutes.post("/:id/delete", requireAuth("members:delete"), async (c) => {
  const id = c.req.param("id");
  const existing = await fetchMember(id);
  if (!existing) return c.notFound();

  const blockedBy = await findPersonBlockingLink(existing.personId);
  if (blockedBy) {
    setFlash(c, t(`members.delete.blocked${blockedBy === "donor" ? "Donor" : blockedBy === "loan" ? "Loan" : "Application"}`), "error");
    return c.redirect(`/members/${id}`);
  }

  await db.transaction(async (tx) => {
    await tx.delete(members).where(eq(members.id, id));
    await tx.delete(persons).where(eq(persons.id, existing.personId));
  });

  setFlash(c, t("members.flash.deleted"), "success");
  return c.redirect("/members");
});

// ── Read-only view field helper ───────────────────────────────────────────────

function ViewField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div class="text-sm opacity-60">{label}</div>
      <div class="font-medium">{value || "—"}</div>
    </div>
  );
}
