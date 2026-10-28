import { RowAction } from "../components/row-action.js";
import type { Context } from "hono";
import { EmailField, Field, PhoneField, ViewField, ViewGrid } from "../components/field.js";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { eq, and, asc, isNull, getTableColumns } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../db/index.js";
import { members, persons, memberRoles, memberRoleTypes, memberRoleAssignments, applications, applicationGuardians, donors, inventoryItemAssignments, lendingLoans } from "../db/schema/index.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { ClickToEditHint, Layout } from "../components/layout.js";
import { Section } from "../components/section.js";
import { Icon } from "../components/icon.js";
import { StatusBadge, STATUS_LABELS } from "../components/status-badge.js";
import { ActionContent, DetailActions, FormActions, HeaderAction, PageHeader } from "../components/page-header.js";
import { RolePopover } from "../components/role-popover.js";
import { AGE_GROUPS, ageGroupOf, ageLimitDate, deriveMemberStatus, isFormer, type AgeGroup, type MemberStatus } from "../lib/status.js";
import { setFlash } from "../lib/flash.js";
import { MultiSelectFilter } from "../components/multi-select-filter.js";
import { parsePagination, buildListUrl, PAGE_SIZE_OPTIONS } from "../lib/list-query.js";
import { formatDate } from "../lib/format.js";
import { trimmed } from "../lib/forms.js";
import { SEARCH_DEBOUNCE_MS, ASSIGNMENT_NOTE_MAX_LENGTH } from "../lib/constants.js";
import { env } from "../env.js";
import { Pager } from "../components/pager.js";
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

function genderBreakdown(c: { m: number; w: number; o: number }) {
  return <>{c.m > 0 && <span>{c.m} ♂</span>}{c.w > 0 && <span>{c.w} ♀</span>}{c.o > 0 && <span>{c.o} o.A.</span>}</>;
}

export function StatsCards({ all }: { all: MemberWithStatus[] }) {
  const counts = { active: 0, passive: 0, supporting: 0, children: 0, youth: 0, left: 0, deceased: 0 };
  const genderCount = (status: "active" | "children" | "youth") => {
    const subset = all.filter((m) => m.status === status);
    return {
      m: subset.filter((m) => m.gender === "male").length,
      w: subset.filter((m) => m.gender === "female").length,
      o: subset.filter((m) => !m.gender).length,
    };
  };

  for (const m of all) counts[m.status]++;
  const active = genderCount("active");
  const youth = genderCount("youth");
  const children = genderCount("children");

  return (
    <div id="members-stats" class="hidden sm:grid grid-cols-2 sm:grid-cols-6 gap-4 mb-6">
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.active")}</div>
        <div class="flex flex-wrap items-baseline gap-x-3">
          <div class="stat-value text-success">{counts.active}</div>
          <div class="stat-desc text-base flex flex-1 gap-x-3 min-w-28">{genderBreakdown(active)}</div>
        </div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.passive")}</div>
        <div class="stat-value">{counts.passive}</div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.supporting")}</div>
        <div class="stat-value text-secondary">{counts.supporting}</div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.youth")}</div>
        <div class="flex flex-wrap items-baseline gap-x-3">
          <div class="stat-value text-info">{counts.youth}</div>
          <div class="stat-desc text-base flex flex-1 gap-x-3 min-w-28">{genderBreakdown(youth)}</div>
        </div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.children")}</div>
        <div class="flex flex-wrap items-baseline gap-x-3">
          <div class="stat-value text-warning">{counts.children}</div>
          <div class="stat-desc text-base flex flex-1 gap-x-3 min-w-28">{genderBreakdown(children)}</div>
        </div>
      </div>
      <div class="stat bg-base-200 rounded-box p-4">
        <div class="stat-title">{t("members.stats.former")}</div>
        <div class="flex flex-wrap items-baseline gap-x-3">
          <div class="stat-value text-base-content/40">{counts.left + counts.deceased}</div>
          <div class="stat-desc text-base flex flex-1 gap-x-3 min-w-28">
            {counts.left > 0 && <span class="inline-flex items-center gap-1" title={t("members.stats.formerLeft")}>{counts.left} <Icon name="arrow-right-start-on-rectangle" class="w-3.5 h-3.5" /></span>}
            {counts.deceased > 0 && <span class="inline-flex items-center gap-1" title={t("members.stats.formerDeceased")}>{counts.deceased} <Icon name="cross" class="w-3.5 h-3.5" /></span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MembersTable({
  items, sort, dir, page, pageSize, totalPages, totalCount, search, statusFilter, roleFilter, ageFilter, isEditor,
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
  ageFilter: AgeGroup[];
  isEditor: boolean;
}) {
  const currentState = { search, status: statusFilter, role: roleFilter, age: ageFilter, sort, sort_dir: dir, page, pageSize };

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
              <th class="hidden xl:table-cell"><a href={sortUrl("birthDate")} class="link link-hover">{t("members.table.birthDate")} <SortIcon col="birthDate" active={sort} dir={dir} /></a></th>
              <th class="hidden lg:table-cell"><a href={sortUrl("entryDate")} class="link link-hover">{t("members.table.entryDate")} <SortIcon col="entryDate" active={sort} dir={dir} /></a></th>
              <th class="hidden md:table-cell">{t("members.table.roles")}</th>
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
                <td class="hidden xl:table-cell">{formatDate(m.birthDate)}</td>
                <td class="hidden lg:table-cell">{formatDate(m.entryDate)}</td>
                <td class="hidden md:table-cell">
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

      <Pager
        countLabel={t("members.table.count", { count: totalCount })}
        page={page}
        totalPages={totalPages}
        pageUrl={pageUrl}
        pageSize={pageSize}
        pageSizeOptions={PAGE_SIZE_OPTIONS}
        pageSizeStorageKey="members_pageSize"
      />
    </div>
  );
}

function roleTypeTabs(roles: Role[]) {
  const seen = new Map<string, { id: string; name: string }>();
  for (const r of roles) if (!seen.has(r.typeId)) seen.set(r.typeId, { id: r.typeId, name: r.typeName ?? "" });
  return [...seen.values()];
}

// Umbrüche werden als \n gespeichert (\r\n → \n), damit der Zähler im Browser und das Limit hier gleich zählen.
const normalizeNote = (v?: string) => v?.replace(/\r\n?/g, "\n").trim().slice(0, ASSIGNMENT_NOTE_MAX_LENGTH) || null;
// Einzeilige Darstellung (Badge, Klammer-Label, Export): Umbrüche werden zu Leerzeichen.
const singleLine = (v: string) => v.replace(/\s*\n\s*/g, " ");
const roleLabel = (title: string, note?: string | null) => (note ? `${title} (${singleLine(note)})` : title);

type AssignmentRowData = { id: string; roleId: string; roleTitle: string; from: string; to: string | null; note: string | null; idx?: string };

const toRowData = (a: Assignment): AssignmentRowData => ({ id: a.id, roleId: a.memberRoleId, roleTitle: a.role.title, from: a.from, to: a.to, note: a.note });
// Offene (ohne „bis“) zuerst, danach „von“ absteigend.
const sortRows = (rows: AssignmentRowData[]) => [...rows].sort((a, b) => (a.to ? 1 : 0) - (b.to ? 1 : 0) || b.from.localeCompare(a.from));

const ADD_CLICK = "if(event.detail.successful){var d=document.getElementById('assignment-modal');d.showModal();setTimeout(function(){var f=d.querySelector('.role-picker-search');if(f)f.focus()},50)}";

// Eine Zeile der read-only Tabelle. Neuanlage (kein memberId): Werte stecken als Hidden-Inputs im Hauptformular.
function AssignmentRow({ r, memberId, index, readOnly }: { r: AssignmentRowData; memberId?: string; index?: string; readOnly?: boolean }) {
  return (
    <>
      <tr>
        <td>
          {!memberId && (
            <>
              <input type="hidden" name="assignment_idx[]" value={index} />
              <input type="hidden" name="assignment_id[]" value="" />
              <input type="hidden" name="assignment_role[]" value={r.roleId} />
              <input type="hidden" name="assignment_from[]" value={r.from} />
              <input type="hidden" name="assignment_to[]" value={r.to ?? ""} />
              <input type="hidden" name="assignment_note[]" value={r.note ?? ""} />
            </>
          )}
          {r.roleTitle}
        </td>
        <td class="assignment-from">{formatDate(r.from)}</td>
        <td>{r.to ? formatDate(r.to) : ""}</td>
        <td class="whitespace-pre-line">{r.note}</td>
        <td class="text-right whitespace-nowrap">
          {!readOnly && memberId && (
            <>
              <RowAction icon="pencil" label={t("common.edit")} attrs={{ "hx-get": `/members/${memberId}/assignments/${r.id}/edit`, "hx-target": "#assignment-modal-body", "hx-swap": "innerHTML", "hx-on::after-request": ADD_CLICK }} />
              <RowAction icon="trash" label={t("common.delete")} class="btn-outline btn-error" attrs={{ "hx-post": `/members/${memberId}/assignments/${r.id}/delete`, "hx-confirm": t("members.assignment.confirmDelete"), "hx-target": "#assignments-box", "hx-swap": "outerHTML" }} />
            </>
          )}
          {!readOnly && !memberId && (
            <RowAction icon="trash" label={t("common.delete")} class="btn-outline btn-error" onclick="var f=this.closest('form'),tr=this.closest('tr');tr.nextElementSibling.remove();tr.remove();f.dispatchEvent(new Event('change',{bubbles:true}))" />
          )}
        </td>
      </tr>
      {!memberId && <tr class="border-0"><td colSpan={5} class="p-0"><div id={`role-hint-${index}`} /></td></tr>}
    </>
  );
}

// „Hinzufügen“ im Bereichstitel (nur bei offenem Bereich sichtbar, siehe .section-actions in app.css).
function AssignmentAddButton({ memberId }: { memberId?: string }) {
  return (
    <button type="button" class="btn btn-outline btn-primary" aria-label={t("members.form.addAssignment")} title={t("members.form.addAssignment")} onclick="event.preventDefault();event.stopPropagation()" hx-get={memberId ? `/members/${memberId}/assignments/new` : "/members/assignments/new"} hx-target="#assignment-modal-body" hx-swap="innerHTML" {...{ "hx-on::after-request": ADD_CLICK }}>
      <ActionContent icon="plus" label={t("members.form.addAssignment")} />
    </button>
  );
}

// Read-only Tabelle; Änderungen laufen über das Modal (#assignment-modal).
function AssignmentsBox({ rows, memberId, readOnly }: { rows: AssignmentRowData[]; memberId?: string; readOnly?: boolean }) {
  return (
    <div id="assignments-box">
      <div class="overflow-x-auto">
        <table class="table w-full">
          <thead><tr><th>{t("members.form.role")}</th><th>{t("members.form.from")}</th><th>{t("members.form.to")}</th><th>{t("members.form.note")}</th><th></th></tr></thead>
          <tbody id="role-rows" data-next-index={String(rows.length)}>
            <tr class="assignment-empty hidden only:table-row"><td colSpan={5} class="text-center opacity-50 py-4">{t("members.assignment.empty")}</td></tr>
            {sortRows(rows).map((r, i) => <AssignmentRow key={r.id || i} r={r} memberId={memberId} index={r.idx ?? String(i)} readOnly={readOnly} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Dialog außerhalb des Hauptformulars (kein verschachteltes <form>).
function AssignmentModalScaffold() {
  return (
    <>
      <dialog id="assignment-modal" class="modal">
        <div class="modal-box max-w-xl" id="assignment-modal-body" />
        <form method="dialog" class="modal-backdrop"><button>{t("common.close")}</button></form>
      </dialog>
      <script dangerouslySetInnerHTML={{ __html: `
        (function () {
          var d = document.getElementById('assignment-modal');
          // htmx swappt 4xx nicht: Validierungsfehler (422) ins Modal statt in die Tabelle.
          document.body.addEventListener('htmx:beforeSwap', function (e) {
            if (e.detail.xhr.status === 422 && d.contains(e.detail.requestConfig.elt)) {
              e.detail.shouldSwap = true; e.detail.isError = false;
              e.detail.target = document.getElementById('assignment-modal-body'); e.detail.swapOverride = 'innerHTML';
            }
          });
          document.body.addEventListener('assignment-modal', function (e) {
            if (e.detail.value === 'close') d.close();
            else { var t = d.querySelector('.role-picker-search'); if (t) t.focus(); }
          });
        })();
      ` }} />
    </>
  );
}

type AssignmentFormValues = { roleId?: string; from?: string; to?: string | null; note?: string | null };

export function AssignmentModalForm({ roles, action, values = {}, error, title, collect }: { roles: Role[]; action: string; values?: AssignmentFormValues; error?: string; title: string; collect?: boolean }) {
  const selectedId = values.roleId;
  const selected = roles.find((r) => r.id === selectedId);
  const selectedTitle = selected?.title ?? "";
  const types = roleTypeTabs(roles);
  const activeType = selected?.typeId ?? types[0]?.id;
  return (
    <form hx-post={action} hx-target="#assignments-box" hx-swap="outerHTML" hx-include={collect ? "#assignments-box" : undefined} class="space-y-4">
      <h3 class="font-bold text-lg">{title}</h3>
      {error && <div class="alert alert-error text-sm" role="alert">{error}</div>}
      <Field label={t("members.form.role")} required floating={false}>
        <div class="role-picker" data-selected={selectedId ?? ""}>
          <input type="hidden" name="role" class="role-picker-value" value={selectedId ?? ""} />
          <label class="input flex items-center gap-2 w-full mb-1">
            <Icon name="magnifying-glass" class="w-4 h-4 opacity-60" />
            <input type="text" autocomplete="off" role="searchbox" aria-controls="role-picker-list" class="role-picker-search grow min-w-0" placeholder={t("common.searchPlaceholder")} />
            <button type="button" class="role-picker-clear btn btn-ghost btn-xs btn-circle hidden" aria-label={t("common.reset")}><Icon name="x-mark" class="w-4 h-4" /></button>
          </label>
          {types.length > 1 && (
            <div role="tablist" class="role-picker-tabs tabs tabs-border mb-1">
              {types.map((ty) => (
                <button key={ty.id} type="button" role="tab" data-type={ty.id} class={`role-picker-tab tab${ty.id === activeType ? " tab-active" : ""}`}>{ty.name}</button>
              ))}
            </div>
          )}
          <ul id="role-picker-list" role="listbox" class="role-picker-list menu menu-sm p-0 w-full flex-nowrap overflow-y-auto border border-base-300 rounded-box" style="max-height:min(16rem,32vh)">
            {roles.map((r) => (
              <li key={r.id} role="option" data-id={r.id} data-title={r.title} data-type={r.typeId} aria-selected={r.id === selectedId ? "true" : "false"}>
                <a class="min-h-9 flex items-center gap-2">{r.title}{r.grantsActiveStatus && <span class="badge badge-sm badge-outline">{t("members.form.roleActive")}</span>}<span class="role-picker-type ml-auto text-xs opacity-60 hidden">{r.typeName}</span></a>
              </li>
            ))}
            <li class="role-picker-no-match hidden"><a class="disabled pointer-events-none opacity-50">{t("members.form.roleNoMatch")}</a></li>
          </ul>
        </div>
      </Field>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label={t("members.form.from")} required>
          <input type="date" name="from" class="input w-full" value={values.from ?? ""} required />
        </Field>
        <Field label={t("members.form.to")}>
          <input type="date" name="to" class="input w-full" value={values.to ?? ""} />
        </Field>
      </div>
      <Field label={t("members.form.note")} after={<span class="text-xs block text-right mt-1 note-counter-wrap" aria-live="polite"><span class="note-counter opacity-60"><span class="note-count">{(values.note ?? "").length}</span> {t("members.assignment.noteCount", { max: String(ASSIGNMENT_NOTE_MAX_LENGTH) })}</span></span>}>
        <textarea name="note" rows={3} class="note-input textarea w-full" maxlength={ASSIGNMENT_NOTE_MAX_LENGTH} placeholder={t("members.form.note")}>{values.note ?? ""}</textarea>
      </Field>
      <div class="modal-action @container">
        <div class="flex w-full justify-end gap-2">
          <button type="button" class="btn" aria-label={t("common.cancel")} title={t("common.cancel")} onclick="this.closest('dialog').close()"><ActionContent icon="x-mark" label={t("common.cancel")} variant="primary" /></button>
          <button type="submit" name="more" value="1" class="btn btn-outline btn-primary" aria-label={t("common.saveAndNew")} title={t("common.saveAndNew")}><ActionContent icon="plus" label={t("common.saveAndNew")} variant="primary" /></button>
          <button type="submit" class="btn btn-primary" aria-label={t("common.save")} title={t("common.save")}><ActionContent icon="check" label={t("common.save")} variant="primary" /></button>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: `
        (function () {
          var root = document.currentScript.parentNode.querySelector('.role-picker');
          var value = root.querySelector('.role-picker-value'), search = root.querySelector('.role-picker-search');
          var clear = root.querySelector('.role-picker-clear'), list = root.querySelector('.role-picker-list'), noMatch = root.querySelector('.role-picker-no-match');
          var opts = Array.from(list.querySelectorAll('li[role=option]')), tabs = Array.from(root.querySelectorAll('.role-picker-tab'));
          function activeType() { var t = root.querySelector('.role-picker-tab.tab-active'); return t ? t.dataset.type : null; }
          function visible() { return opts.filter(function (o) { return !o.hidden; }); }
          function mark(li) { opts.forEach(function (o) { o.classList.toggle('menu-active', o === li); }); if (li) li.scrollIntoView({ block: 'nearest' }); }
          function filter() {
            var q = search.value.trim().toLowerCase(), type = q ? null : activeType();
            opts.forEach(function (o) { o.hidden = !(o.dataset.title.toLowerCase().includes(q) && (!type || o.dataset.type === type)); });
            noMatch.classList.toggle('hidden', visible().length > 0);
            // Suche geht über alle Typen: Tabs abblenden, Typ pro Treffer zeigen.
            clear.classList.toggle('hidden', !q);
            var bar = root.querySelector('.role-picker-tabs');
            if (bar) { bar.classList.toggle('opacity-40', !!q); bar.classList.toggle('pointer-events-none', !!q); }
            opts.forEach(function (o) { o.querySelector('.role-picker-type').classList.toggle('hidden', !q); });
            mark(null);
          }
          function pick(li) {
            value.value = li.dataset.id; value.dispatchEvent(new Event('change', { bubbles: true }));
            opts.forEach(function (o) { o.setAttribute('aria-selected', o === li ? 'true' : 'false'); o.classList.toggle('menu-active', o === li); });
          }
          function setTab(t) { tabs.forEach(function (x) { x.classList.toggle('tab-active', x === t); }); filter(); }
          tabs.forEach(function (t) { t.addEventListener('click', function () { search.value = ''; setTab(t); search.focus(); }); });
          list.addEventListener('click', function (e) { var li = e.target.closest('li[role=option]'); if (li) pick(li); });
          search.addEventListener('input', filter);
          clear.addEventListener('click', function () { search.value = ''; filter(); search.focus(); });
          search.addEventListener('keydown', function (e) {
            // Escape leert zuerst den Suchbegriff; erst bei leerem Feld schließt es das Modal (Browser-Standard).
            if (e.key === 'Escape' && search.value) { e.preventDefault(); e.stopPropagation(); search.value = ''; filter(); return; }
            var v = visible(), cur = v.findIndex(function (o) { return o.classList.contains('menu-active'); });
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mark(v[Math.max(0, Math.min(v.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))]); }
            else if (e.key === 'Tab' && cur >= 0 && !e.shiftKey) { e.preventDefault(); pick(v[cur]); }
            else if (e.key === 'Enter') { e.preventDefault(); if (cur >= 0) pick(v[cur]); else if (v.length === 1) pick(v[0]); else root.closest('form').querySelector('[name=from]').focus(); }
          });
          var sel = opts.find(function (o) { return o.getAttribute('aria-selected') === 'true'; });
          if (sel) { var t = tabs.find(function (x) { return x.dataset.type === sel.dataset.type; }); if (t) setTab(t); sel.classList.add('menu-active'); sel.scrollIntoView({ block: 'nearest' }); }
          else filter();
          search.focus();
          var note = root.closest('form').querySelector('.note-input'), counter = root.closest('form').querySelector('.note-counter');
          function count() {
            // Browser und Server zählen einen Umbruch gleich als 1 Zeichen.
            var n = note.value.length, max = note.maxLength;
            counter.querySelector('.note-count').textContent = n;
            counter.classList.toggle('text-error', n >= max);
            counter.classList.toggle('text-warning', n >= max * 0.9 && n < max);
            counter.classList.toggle('opacity-60', n < max * 0.9);
          }
          note.addEventListener('input', count); count();
        })();
      ` }} />
    </form>
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
        <Field label={t("members.bank.iban")}>
          <input type="text" name="iban" value={iban} class={`input w-full${errors?.iban ? " input-error" : ""}`} placeholder={t("members.bank.iban")} />
          {errors?.iban && <span class="text-error text-sm mt-1">{errors.iban}</span>}
        </Field>
        <Field label={t("members.bank.bic")}>
          <input type="text" name="bic" value={m.bic ?? ""} class="input w-full" placeholder={t("members.bank.bic")} />
        </Field>
      </div>
      <Field label={t("members.bank.accountHolder")} hint={t("members.bank.accountHolderHint")}>
        <input type="text" name="accountHolder" value={m.accountHolder ?? ""} class="input w-full" placeholder={t("members.bank.accountHolder")} />
      </Field>
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
      hx-trigger="load, input from:closest form delay:300ms, change from:closest form, assignment-modal from:body delay:100ms, htmx:afterSettle from:#role-rows delay:100ms"
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
  const conflict = ["active", "passive", "supporting"].includes(choice)
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
    if (type === "email" || type === "tel") {
      const Cmp = type === "email" ? EmailField : PhoneField;
      return (
        <>
          <Cmp {...(name === "mobile" ? { mobile: true } : {})} label={label} name={name as string} value={value as string} required={required} error={!!err} />
          {err && <span class="text-error text-sm mt-1">{err}</span>}
        </>
      );
    }
    return (
      <Field label={label} required={required}>
        <input
          type={type}
          name={name as string}
          value={value as string}
          placeholder={label}
          class={`input w-full${err ? " input-error" : ""}`}
          {...(required ? { required: true } : {})}
        />
        {err && <span class="text-error text-sm mt-1">{err}</span>}
      </Field>
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
        <Field label={t("members.form.gender")} floating={false}>
          <div class="flex flex-wrap gap-x-6 gap-y-2 min-h-12 items-center">
            {([["", "genderNone"], ["male", "genderMale"], ["female", "genderFemale"]] as const).map(([v, k]) => (
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="gender" value={v} class="radio radio-sm" checked={(m?.gender ?? "") === v} />
                <span>{t(`members.form.${k}`)}</span>
              </label>
            ))}
          </div>
          {genderErr && <span class="text-error text-sm mt-1">{genderErr}</span>}
        </Field>
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
      <div class="space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div class="sm:col-span-3">{field("street", t("members.form.street"))}</div>
        <div class="sm:col-span-1">{field("houseNumber", t("members.form.houseNumber"))}</div>
        <div class="sm:col-span-1">{field("zip", t("members.form.zip"))}</div>
        <div class="sm:col-span-3">{field("city", t("members.form.city"))}</div>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {field("phone", t("members.form.phone"), "tel")}
        {field("mobile", t("members.form.mobile"), "tel")}
        {field("email", t("members.form.email"), "email")}
      </div>
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
      <HeaderAction icon="trash" label={t("common.delete")} class="btn-outline btn-error mr-6" onclick="document.getElementById('delete-member-modal').showModal()" />
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
            <label class="flex items-center gap-2 cursor-pointer pointer-coarse:min-h-11">
              <input type="checkbox" id="exp-addr" class="checkbox checkbox-sm" />
              <span>{t("members.export.address")} <span class="opacity-50 text-xs">{t("members.export.addressHint")}</span></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer pointer-coarse:min-h-11">
              <input type="checkbox" id="exp-contact" class="checkbox checkbox-sm" />
              <span>{t("members.export.contact")} <span class="opacity-50 text-xs">{t("members.export.contactHint")}</span></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer pointer-coarse:min-h-11">
              <input type="checkbox" id="exp-dates" class="checkbox checkbox-sm" />
              <span>{t("members.export.dates")} <span class="opacity-50 text-xs">{t("members.export.datesHint")}</span></span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer pointer-coarse:min-h-11">
              <input type="checkbox" id="exp-gender" class="checkbox checkbox-sm" />
              <span>{t("members.export.genderCol")}</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer pointer-coarse:min-h-11">
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
            var url=new URL(window.location.href);
            ['search','sort','sort_dir'].forEach(function(k){var v=url.searchParams.get(k);if(v)p.set(k,v);});
            ['status','role','age'].forEach(function(k){url.searchParams.getAll(k).forEach(function(v){p.append(k,v)});});
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
      options={roles.map((r) => ({ value: r.id, label: r.title, group: r.typeName, dim: !activeRoleIds.has(r.id), unused: !activeRoleIds.has(r.id), hint: activeRoleIds.has(r.id) ? undefined : "(0)" }))}
      unusedToggle={{ label: t("members.filter.showUnusedRoles"), storageKey: "members.showUnusedRoles" }}
      selected={roleFilter}
      allLabel={t("members.filter.allRoles")}
      countLabel={(count) => t("members.table.roleCount", { count })}
      applyLabel={t("common.apply")}
      resetLabel={t("common.reset")}
      searchPlaceholder={t("common.searchPlaceholder")}
    />
  );
}

function AgeFilterDropdown({ ageFilter }: { ageFilter: AgeGroup[] }) {
  const c = env.CHILDREN_AGE_LIMIT, y = env.YOUTH_AGE_LIMIT, a = env.ACTIVE_AGE_LIMIT;
  const labels: Record<AgeGroup, string> = {
    children: t("members.filter.age.children", { limit: c }),
    youth: t("members.filter.age.youth", { from: c, to: y - 1 }),
    adult: t("members.filter.age.adult", { from: y, to: a - 1 }),
    senior: t("members.filter.age.senior", { limit: a }),
  };
  return (
    <MultiSelectFilter
      param="age"
      autoApply
      options={AGE_GROUPS.map((g) => ({ value: g, label: labels[g] }))}
      selected={ageFilter}
      allLabel={t("members.filter.allAges")}
      countLabel={(count) => t("members.table.ageCount", { count })}
      applyLabel={t("common.apply")}
      resetLabel={t("common.reset")}
    />
  );
}

const STATUS_ORDER: MemberStatus[] = ["active", "passive", "supporting", "youth", "children", "left", "deceased"];
const DEFAULT_STATUS: MemberStatus[] = ["active", "passive", "supporting", "children", "youth"];

function StatusFilterDropdown({ statusFilter }: { statusFilter: MemberStatus[] }) {
  const isDefault = statusFilter.length === DEFAULT_STATUS.length && DEFAULT_STATUS.every((s) => statusFilter.includes(s));
  return (
    <MultiSelectFilter
      param="status"
      autoApply
      searchable
      options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s], icon: s === "deceased" ? "cross" : undefined }))}
      selected={statusFilter}
      labelOverride={isDefault ? t("members.filter.currentStatus") : undefined}
      allLabel={t("members.filter.allStatus")}
      countLabel={(count) => t("members.table.statusCount", { count })}
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
  ageFilter: AgeGroup[];
  page: number;
  pageSize: number;
};

export function parseListQuery(q: Record<string, string>, statusRaw: string[], roleFilterRaw: string[], ageRaw: string[]): ListQuery {
  const search = q.search ?? "";
  const sort = (q.sort as SortKey) || "lastName";
  const dir = (q.sort_dir as "asc" | "desc") || "asc";
  const statusParsed = statusRaw.filter((s) => STATUS_LABELS[s as MemberStatus]); // unbekannte (z. B. altes "archiviert") ignorieren
  const statusFilter: MemberStatus[] = (statusParsed.length > 0
    ? statusParsed
    : ["active", "passive", "supporting", "children", "youth"]) as MemberStatus[];
  const roleFilter = roleFilterRaw.filter(Boolean);
  const ageFilter = ageRaw.filter((a): a is AgeGroup => AGE_GROUPS.includes(a as AgeGroup));
  const { page, pageSize } = parsePagination(q);

  return { search, sort, dir, statusFilter, roleFilter, ageFilter, page, pageSize };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function filterMembers(all: MemberWithStatus[], statusFilter: MemberStatus[], roleFilter: string[], ageFilter: AgeGroup[]): MemberWithStatus[] {
  return all
    .filter((m) => statusFilter.includes(m.status))
    .filter((m) => ageFilter.length === 0 || ageFilter.includes(ageGroupOf(m.birthDate, env.CHILDREN_AGE_LIMIT, env.YOUTH_AGE_LIMIT, env.ACTIVE_AGE_LIMIT)))
    .filter((m) => roleFilter.length === 0 || m.assignments.some((a) => !a.to && roleFilter.includes(a.memberRoleId)));
}

// Export-Button der Mitgliederliste; bei leerer Trefferliste deaktiviert. oob: per HTMX nachführen.
function MembersExportButton({ empty, oob }: { empty: boolean; oob?: boolean }) {
  return (
    <span id="members-export-btn" class="contents" {...(oob ? { "hx-swap-oob": "true" } : {})}>
      <HeaderAction icon="arrow-down-tray" label={t("common.export")} onclick="document.getElementById('members-export-modal').showModal()" disabled={empty ? t("common.exportEmpty") : undefined} />
    </span>
  );
}

// GET /members — list
memberRoutes.get("/", requireAuth("members:read"), async (c) => {
  const user = c.get("user");
  const q = c.req.query();
  const { search, sort, dir, statusFilter, roleFilter, ageFilter, page, pageSize } = parseListQuery(
    q, c.req.queries("status") ?? [], c.req.queries("role") ?? [], c.req.queries("age") ?? []
  );

  const [all, allRoles, activeRoleRows] = await Promise.all([
    fetchMembersWithStatus(search || undefined),
    fetchRoles(),
    db.selectDistinct({ id: memberRoleAssignments.memberRoleId }).from(memberRoleAssignments).where(isNull(memberRoleAssignments.to)),
  ]);
  // Unabhängig von Suche/Statusfilter, damit "ungenutzt" stabil bleibt.
  const activeRoleIds = new Set(activeRoleRows.map((r) => r.id));
  const filtered = filterMembers(all, statusFilter, roleFilter, ageFilter);
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
      ageFilter={ageFilter}
      isEditor={isEditor}
    />
  );

  if (isHtmx) return c.html(<>{tableEl}<MembersExportButton empty={sorted.length === 0} oob /></>);

  return c.html(
    <Layout title={t("members.title")} user={user}>
      <PageHeader title={t("members.title")} actions={<>
        <label class="flex items-center gap-2 cursor-pointer" title={t("members.stats.toggle")}>
          <Icon name="chart-bar" class="w-5 h-5" />
          <span class="@max-xl:hidden">{t("members.stats.toggle")}</span>
          <input type="checkbox" id="members-stats-toggle" class="toggle" aria-label={t("members.stats.toggle")} onchange="toggleMembersStats(this.checked)" />
        </label>
        {user.permissions.has("import:run") && <HeaderAction icon="arrow-up-tray" label={t("import.action")} href="/import?kind=members" />}
        <MembersExportButton empty={sorted.length === 0} />
        {isEditor && <HeaderAction variant="primary" icon="plus" label={t("members.addMember")} href="/members/new" class="btn-primary" />}
      </>} />

      <StatsCards all={all} />

      {/* Toolbar */}
      <div class="filter-bar flex flex-wrap gap-3 mb-4 items-center">
        <label class="input flex items-center gap-2 w-64">
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
        <StatusFilterDropdown statusFilter={statusFilter} />
        <RoleFilterDropdown roles={allRoles} roleFilter={roleFilter} activeRoleIds={activeRoleIds} />
        <AgeFilterDropdown ageFilter={ageFilter} />
      </div>

      {tableEl}

      <MembersExportModal />

      {/* Restore pageSize from localStorage on first load */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const stats = document.getElementById('members-stats');
          const savedStats = localStorage.getItem('members_statsVisible');
          if (stats && savedStats) stats.style.display = savedStats === '1' ? 'grid' : 'none';
          document.getElementById('members-stats-toggle').checked = getComputedStyle(stats).display !== 'none';
          window.toggleMembersStats = function(show) {
            stats.style.display = show ? 'grid' : 'none';
            localStorage.setItem('members_statsVisible', show ? '1' : '0');
          };
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
  const copyFrom = c.req.query("copyFrom");

  let prefill: Partial<Member> | undefined;
  let copyRows: AssignmentRowData[] = [];
  let linkedWasArchived = false;
  if (personId) {
    const [alreadyMember] = await db.select({ id: members.id }).from(members).where(eq(members.personId, personId));
    if (alreadyMember) {
      setFlash(c, t("members.error.personAlreadyMember"), "error");
      return c.redirect(applicationId ? `/applications/${applicationId}` : "/members");
    }
    const [person] = await db.select().from(persons).where(eq(persons.id, personId));
    if (person) prefill = { ...person, birthDate: person.birthDate ?? "" };
  } else if (copyFrom) {
    const src = await fetchMember(copyFrom);
    if (!src) return c.notFound();
    prefill = { street: src.street, houseNumber: src.houseNumber, zip: src.zip, city: src.city, companyName: src.companyName };
    copyRows = src.assignments.map((a, i) => ({ ...toRowData(a), id: "", idx: String(i) }));
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
    <Layout title={t("members.newMember")} user={user}>
      <PageHeader title={t("members.newMember")} backHref="/members" subtitle={t("common.requiredLegend")} actions={<FormActions formId="member-form" saveAndNew />} />
      <form id="member-form" method="post" action="/members/new" class="space-y-4 max-w-4xl">
        <NewMemberDraft ctx={draftCtx({ personId, linkMemberId, applicationId })} />
        {personId && <input type="hidden" name="personId" value={personId} />}
        {linkMemberId && <input type="hidden" name="linkMemberId" value={linkMemberId} />}
        {applicationId && <input type="hidden" name="applicationId" value={applicationId} />}
        {applicationId && !linkMemberId && <p class="alert alert-info text-sm">{t("members.applicant.notice")}</p>}
        {linkMemberId && <p class="alert alert-info text-sm">{t(linkedWasArchived ? "members.relink.notice" : "members.relink.noticeActive")}</p>}
        <StartStatusSelect value="" />
        <MemberFormFields m={prefill} />
        {canWriteBank && !linkMemberId && <BankDataSection m={prefill ?? {}} editable />}
        {applicationId && (
          <label class="label cursor-pointer justify-start gap-3 pointer-coarse:min-h-11">
            <input type="checkbox" name="notifyApplicant" class="checkbox" />
            <span class="text-sm">{t("members.form.notifyApplicant")}</span>
          </label>
        )}
        <div id="assignments-wrap"><Section title={t("members.form.assignments")} open actions={<AssignmentAddButton />}>
        <StatusPreview />
        <PassiveHint show={false} />
        <AssignmentsBox rows={copyRows} />
        </Section></div>
      </form>
        <AssignmentModalScaffold />
    </Layout>
  );
});

const draftCtx = (o: { personId?: string; linkMemberId?: string; applicationId?: string }) =>
  o.personId ? `person:${o.personId}` : o.linkMemberId ? `link:${o.linkMemberId}` : o.applicationId ? `app:${o.applicationId}` : "new";

// Entwurf der Neuanlage (localStorage, ohne Bankdaten, 7 Tage). Schlüssel je Kontext; Banner statt Auto-Wiederherstellung.
function NewMemberDraft({ ctx, rerender }: { ctx: string; rerender?: boolean }) {
  const texts = JSON.stringify({ banner: t("members.draft.banner"), restore: t("members.draft.restore"), discard: t("members.draft.discard") });
  return (
    <script dangerouslySetInnerHTML={{ __html: `
      document.addEventListener('DOMContentLoaded', function () {
        var KEY = 'member-draft:' + ${JSON.stringify(ctx)}, TTL = 7 * 864e5, TX = ${texts};
        var form = document.getElementById('member-form'), skip = /^(iban|bic|accountHolder|personId|linkMemberId|applicationId|switchStatus|_action)$/;
        function save() {
          var data = [];
          new FormData(form).forEach(function (v, k) { if (!skip.test(k) && typeof v === 'string') data.push([k, v]); });
          localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data: data }));
        }
        var timer; function later() { clearTimeout(timer); timer = setTimeout(save, 500); }
        form.addEventListener('input', later); form.addEventListener('change', later);
        document.body.addEventListener('assignment-modal', function () { setTimeout(save, 600); });
        form.addEventListener('submit', function () { clearTimeout(timer); });
        window.addEventListener('pagehide', function () { clearTimeout(timer); });
        if (${rerender ? "true" : "false"}) { save(); return; }
        var raw = localStorage.getItem(KEY), d; try { d = raw && JSON.parse(raw); } catch (e) {}
        if (d && Date.now() - d.at > TTL) { localStorage.removeItem(KEY); d = null; }
        if (!d) return;
        var bar = document.createElement('div'); bar.className = 'alert alert-info text-sm flex-wrap max-w-4xl mb-4';
        var msg = document.createElement('span'); msg.textContent = TX.banner; bar.appendChild(msg);
        function btn(label, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm'; b.textContent = label; b.onclick = fn; bar.appendChild(b); }
        btn(TX.restore, function () {
          var rows = {};
          d.data.forEach(function (kv) {
            if (/^assignment_/.test(kv[0])) { (rows[kv[0]] = rows[kv[0]] || []).push(kv[1]); return; }
            var els = form.querySelectorAll('[name="' + kv[0] + '"]');
            els.forEach(function (el) { if (el.type === 'radio' || el.type === 'checkbox') el.checked = el.value === kv[1]; else el.value = kv[1]; });
          });
          if (rows['assignment_role[]']) htmx.ajax('POST', '/members/assignments/rows', { values: rows, target: '#assignments-box', swap: 'outerHTML' });
          else { var sr = form.querySelector('input[name="startStatus"]:checked'); if (sr) sr.dispatchEvent(new Event('change', { bubbles: true })); }
          bar.remove();
        });
        btn(TX.discard, function () { localStorage.removeItem(KEY); bar.remove(); });
        form.parentNode.insertBefore(bar, form);
      });
    ` }} />
  );
}

type StartStatus = "active" | "passive" | "supporting";

function PassiveHint({ show }: { show: boolean }) {
  return <p id="startStatusPassiveHint" class="text-sm opacity-70" hidden={!show}>{t("members.form.startStatusPassiveHint", { grenze: String(env.ACTIVE_AGE_LIMIT) })}</p>;
}

function StartStatusSelect({ value }: { value: StartStatus | "" }) {
  return (
    <fieldset class="space-y-2">
      <legend class="sr-only">{t("members.form.startStatus")}</legend>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(["active", "passive", "supporting"] as const).map((s) => (
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
          var form = document.querySelector('input[name="startStatus"]').closest('form');
          function current() { var c = form.querySelector('input[name="startStatus"]:checked'); return c ? c.value : ''; }
          // Fördernd: Funktionen ausblenden und deaktivieren (nichts wird gesendet); Zeilen bleiben im DOM erhalten.
          var wrap = document.getElementById('assignments-wrap');
          function sync() {
            var off = current() === 'supporting';
            wrap.hidden = off;
            wrap.querySelectorAll('input,select,textarea,button').forEach(function (el) { el.disabled = off; });
          }
          document.body.addEventListener('htmx:afterSettle', sync);
          var err = document.getElementById('startStatusError');
          form.querySelectorAll('input[name="startStatus"]').forEach(function (r) {
            // Eigene Meldung bei der Kartengruppe statt der Browser-Blase am einzelnen Radio.
            r.addEventListener('invalid', function (e) { e.preventDefault(); err.hidden = false; err.scrollIntoView({ block: 'center' }); });
            r.addEventListener('change', function () {
              err.hidden = true;
              document.getElementById('startStatusPassiveHint').hidden = current() !== 'passive';
              sync();
            });
          });
          sync();
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
  const isActiveFamily = derived === "active" || derived === "children" || derived === "youth";
  const suggest = isActiveFamily ? (derived === "active" ? "active" : undefined) : (derived as StartStatus);
  if (choice === "active" && !isActiveFamily) {
    return derived === "passive"
      ? { message: t("members.error.status.activeAgeLimit", { grenze, datum, name }), suggest }
      : { message: t("members.error.status.activeNoRole", { name }), suggest };
  }
  if (choice === "passive" && derived !== "passive") {
    return derived === "supporting"
      ? { message: t("members.error.status.passiveNoRole", { grenze, datum, name }), suggest }
      : { message: t("members.error.status.passiveRunning", { grenze, datum, name }), suggest };
  }
  if (choice === "supporting" && derived !== "supporting") {
    const titel = (runningActive ?? anyActive)?.role.title ?? "";
    const status = STATUS_LABELS[derived].toLowerCase();
    return { message: t("members.error.status.supportingHasRole", { titel, name, status }), suggest };
  }
  return undefined;
}

function rowsFromBody(body: Record<string, any>, allRoles: Role[]): AssignmentRowData[] {
  const col = (k: string) => [body[`assignment_${k}[]`]].flat().filter((v) => v !== undefined) as string[];
  const [ids, roleIds, froms, tos, notes, idxs] = ["id", "role", "from", "to", "note", "idx"].map(col);
  return roleIds.flatMap((roleId, i) => {
    const role = allRoles.find((r) => r.id === roleId);
    return role && froms[i] ? [{ id: ids[i] ?? "", roleId, roleTitle: role.title, from: froms[i], to: tos[i] || null, note: notes[i] || null, idx: idxs[i] ?? String(i) }] : [];
  });
}

// Gemeinsame Validierung (Neuanlage und Edit): Pflichtfelder, bis ≥ von, keine zwei offenen Zuweisungen derselben Funktion.
function validateAssignment(
  v: { id?: string; roleId: string; from: string; to?: string | null },
  others: { id?: string; roleId: string; to?: string | null }[],
  roles: { id: string; title: string }[],
): string | undefined {
  if (!v.roleId || !v.from) return t("members.error.assignmentIncomplete");
  if (v.to && v.to < v.from) return t("members.error.assignmentRange");
  if (!v.to && others.some((o) => o.roleId === v.roleId && !o.to && (!v.id || o.id !== v.id))) {
    return t("members.error.duplicateRole", { role: roles.find((r) => r.id === v.roleId)?.title ?? v.roleId });
  }
}

function parseAssignmentForm(body: Record<string, any>) {
  return { roleId: trimmed(body, "role"), from: trimmed(body, "from"), to: trimmed(body, "to") || null, note: normalizeNote(trimmed(body, "note")) };
}

// Modal-Antwort nach Speichern: Tabelle (+ Badge im Edit) und je nach Button Modal schließen oder leeres Formular.
async function assignmentResult(c: Context<{ Variables: Variables }>, box: any, more: boolean, form: any, badge?: any) {
  c.header("HX-Trigger", JSON.stringify({ "assignment-modal": more ? "more" : "close" }));
  return c.html(<>{box}{badge}{more && <div id="assignment-modal-body" hx-swap-oob="innerHTML">{form}</div>}</>);
}

// POST /members/assignments/rows — Tabelle aus gesammelten Zeilen (Entwurf wiederherstellen)
memberRoutes.post("/assignments/rows", requireAuth("members:write"), async (c) => {
  const body = await c.req.parseBody({ all: true });
  return c.html(<AssignmentsBox rows={rowsFromBody(body, await fetchRoles())} />);
});

// GET /members/assignments/new — Modal-Inhalt der Neuanlage (kollektiert Zeilen clientseitig)
memberRoutes.get("/assignments/new", requireAuth("members:write"), async (c) => {
  return c.html(<AssignmentModalForm roles={await fetchRoles()} action="/members/assignments/validate" title={t("members.assignment.titleNew")} collect />);
});

// POST /members/assignments/validate — zustandslos: neue Zeile + bereits gesammelte Zeilen
memberRoutes.post("/assignments/validate", requireAuth("members:write"), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const roles = await fetchRoles();
  const rows = rowsFromBody(body, roles);
  const v = parseAssignmentForm(body);
  const err = validateAssignment(v, rows, roles);
  const form = (values: AssignmentFormValues, error?: string) => <AssignmentModalForm roles={roles} action="/members/assignments/validate" title={t("members.assignment.titleNew")} collect values={values} error={error} />;
  if (err) return c.html(form(v, err), 422);
  const idx = String(Math.max(-1, ...rows.map((r) => Number(r.idx))) + 1);
  const role = roles.find((r) => r.id === v.roleId)!;
  rows.push({ id: "", roleId: v.roleId, roleTitle: role.title, from: v.from, to: v.to, note: v.note, idx });
  return assignmentResult(c, <AssignmentsBox rows={rows} />, trimmed(body, "more") === "1", form({}));
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

  // Fördernd: keine Funktionen, gesendete Felder ignorieren.
  if ((trimmed(body, "switchStatus") || trimmed(body, "startStatus")) === "supporting") for (const k of ["id", "role", "from", "to", "note", "idx"]) delete body[`assignment_${k}[]`];

  // Parse assignments (keep rows unfiltered so index i stays aligned across role/from/to)
  const assignmentRoles = [body["assignment_role[]"]].flat() as string[];
  const assignmentFroms = [body["assignment_from[]"]].flat() as string[];
  const assignmentTos = [body["assignment_to[]"]].flat() as string[];
  const assignmentNotes = [body["assignment_note[]"]].flat() as (string | undefined)[];

  const allRolesForCheck = await fetchRoles();
  const submitted = assignmentRoles.map((roleId, i) => ({ roleId, from: assignmentFroms[i], to: assignmentTos[i] })).filter((r) => r.roleId || r.from);
  for (let i = 0; i < submitted.length && !errors._assignments; i++) {
    const err = validateAssignment(submitted[i], submitted.slice(0, i), allRolesForCheck);
    if (err) errors._assignments = err;
  }

  // Auswahl aktiv/passiv/fördernd gegen den abgeleiteten Status prüfen (nur Anlegen, Server entscheidet).
  const startStatus = (trimmed(body, "switchStatus") || trimmed(body, "startStatus")) as StartStatus;
  let statusConflict: { message: string; suggest?: "active" | "passive" | "supporting" } | undefined;
  if (Object.keys(errors).length === 0 && ["active", "passive", "supporting"].includes(startStatus)) {
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
      <Layout title={t("members.newMember")} user={user}>
        <PageHeader title={t("members.newMember")} backHref="/members" subtitle={t("common.requiredLegend")} actions={<FormActions formId="member-form" saveAndNew />} />
        {errors._assignments && (
          <div class="alert alert-error mb-4">{errors._assignments}</div>
        )}
        <form id="member-form" method="post" action="/members/new" class="space-y-4 max-w-4xl">
          <NewMemberDraft ctx={draftCtx({ personId, linkMemberId, applicationId })} rerender />
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
            <label class="label cursor-pointer justify-start gap-3 pointer-coarse:min-h-11">
              <input type="checkbox" name="notifyApplicant" class="checkbox" checked={notifyApplicant} />
              <span class="text-sm">{t("members.form.notifyApplicant")}</span>
            </label>
          )}
          <div id="assignments-wrap" hidden={startStatus === "supporting"}><Section title={t("members.form.assignments")} open actions={<AssignmentAddButton />}>
          <StatusPreview />
          <PassiveHint show={startStatus === "passive"} />
        <AssignmentsBox rows={rowsFromBody(body, await db.select().from(memberRoles))} />
          </Section></div>
        </form>
        <AssignmentModalScaffold />
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
  // Entwurf erst nach erfolgreichem Anlegen löschen: Layout-Skript entfernt den Schlüssel auf der Folgeseite.
  setCookie(c, "draft-clear", draftCtx({ personId, linkMemberId, applicationId }), { path: "/", maxAge: 60, httpOnly: false });
  const saveAndNew = String(body._action ?? "") === "save_and_new";
  return c.redirect(saveAndNew ? "/members/new" : `/members/${newMemberId}`);
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
  const allMembers = rawMembers; // Reihenfolge wie übergeben (Sortierung der Liste)

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
    const asgns = rawAssignments.filter((a) => nameMap.has(a.memberId)).sort((a, b) => {
      const ma = nameMap.get(a.memberId)!, mb = nameMap.get(b.memberId)!;
      const cmp = ma.lastName.localeCompare(mb.lastName, "de");
      if (cmp !== 0) return cmp;
      const cmp2 = ma.firstName.localeCompare(mb.firstName, "de");
      return cmp2 !== 0 ? cmp2 : (a.from ?? "").localeCompare(b.from ?? "");
    });

    const asgHeader = [t("members.table.lastName"), t("members.table.firstName"), t("members.form.role"), t("members.form.from"), t("members.form.to"), t("members.form.note")];
    const asgRows = asgns.map((a) => {
      const m = nameMap.get(a.memberId);
      return [m?.lastName ?? "", m?.firstName ?? "", a.roleTitle, toDate(a.from), toDate(a.to), singleLine(a.note ?? "")];
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

  const { search, sort, dir, statusFilter, roleFilter, ageFilter } = parseListQuery(q, c.req.queries("status") ?? [], c.req.queries("role") ?? [], c.req.queries("age") ?? []);
  const exported = sortMembers(filterMembers(await fetchMembersWithStatus(search || undefined), statusFilter, roleFilter, ageFilter), sort, dir);
  if (exported.length === 0) {
    setFlash(c, t("common.exportEmpty"), "error");
    const back = new URLSearchParams();
    for (const [k, v] of new URL(c.req.url).searchParams) if (k === "search" || k === "status" || k === "role" || k === "age" || k === "sort" || k === "sort_dir") back.append(k, v);
    return c.redirect(`/members?${back}`, 302);
  }
  const allMembers: Member[] = exported;
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

  const canDelete = user.permissions.has("members:delete");
  const blockedBy = canDelete ? await findPersonBlockingLink(m.personId) : null;
  const assignedItemsCount = canDelete ? await countAssignedInventoryItems(m.id) : 0;

  {
    const openRoles = m.assignments.filter((a) => !a.to);
    return c.html(
      <Layout title={`${m.firstName} ${m.lastName}`} user={user}>
        <PageHeader title={<>{m.firstName} {m.lastName} <StatusBadge status={m.status} /></>} backHref={backHref(c)} actions={<DetailActions editHref={isEditor ? `/members/${m.id}/edit` : undefined} copyHref={isEditor ? `/members/new?copyFrom=${m.id}` : undefined} remove={canDelete && <DeleteMemberButton member={m} blockedBy={blockedBy} assignedItemsCount={assignedItemsCount} />} />} />
        <ViewGrid>
          <ViewField label={t("members.form.lastName")} value={m.lastName} />
          <ViewField label={t("members.form.firstName")} value={m.firstName} />
          <ViewField label={t("members.form.birthDate")} value={formatDate(m.birthDate)} />
          {m.firstEntryDate && <ViewField label={t("members.form.firstEntryDate")} value={formatDate(m.firstEntryDate)} />}
          <ViewField label={t("members.form.entryDate")} value={formatDate(m.entryDate)} />
          <ViewField label={t("members.form.gender")} value={m.gender === "male" ? t("members.form.genderMale") : m.gender === "female" ? t("members.form.genderFemale") : t("members.form.genderNone")} />
          {m.exitDate && <ViewField label={t("members.form.exitDate")} value={formatDate(m.exitDate)} />}
          {m.deathDate && <ViewField label={t("members.form.deathDate")} value={formatDate(m.deathDate)} />}
        </ViewGrid>
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
});

memberRoutes.get("/:id/edit", requireAuth("members:read"), async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!user.permissions.has("members:write")) return c.redirect(`/members/${id}`);
  const m = await fetchMember(id);
  if (!m) return c.notFound();

  const canWriteBank = user.permissions.has("members:bank-data:write");
  const canReadBank = canWriteBank || user.permissions.has("members:bank-data:read");

  return c.html(
    <Layout title={`${m.firstName} ${m.lastName}`} user={user}>
      <PageHeader title={<>{m.firstName} {m.lastName} <StatusBadgeSlot saved={m.status} /></>} backHref={backHref(c)} subtitle={t("common.requiredLegend")} actions={<><FormActions formId="member-form" cancelHref={`/members/${m.id}`} /></>} />
      <form id="member-form" method="post" action={`/members/${m.id}`} class="space-y-4 max-w-4xl">
        <MemberFormFields m={m} />
        {canReadBank && <BankDataSection m={m} editable={canWriteBank} />}
        <Section title={t("members.form.assignments")} open actions={!(m.exitDate || m.deathDate) && <AssignmentAddButton memberId={m.id} />}>
        <AssignmentsBox rows={m.assignments.map(toRowData)} memberId={m.id} readOnly={!!(m.exitDate || m.deathDate)} />
        </Section>
      </form>
        <AssignmentModalScaffold />
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
        <Layout title={`${existing.firstName} ${existing.lastName}`} user={user}>
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

  if (Object.keys(errors).length > 0) {
    const roles = await fetchRoles();
    const m = { ...existing, lastName, firstName, birthDate, entryDate, firstEntryDate, exitDate, deathDate,
      street: body.street as string, houseNumber: body.houseNumber as string,
      zip: body.zip as string, city: body.city as string,
      gender: (body.gender as any) || null,
      phone: body.phone as string, mobile: body.mobile as string, email: body.email as string,
      ...(bank && { ...bank, iban: trimmed(body, "iban") }) };
    return c.html(
      <Layout title={`${firstName} ${lastName}`} user={user}>
        <PageHeader title={<>{firstName} {lastName} <StatusBadgeSlot saved={existing.status} /></>} backHref={"/members"} subtitle={t("common.requiredLegend")} actions={<><FormActions formId="member-form" cancelHref={`/members/${id}`} /></>} />
        <form id="member-form" method="post" action={`/members/${id}`} class="space-y-4 max-w-4xl">
          <MemberFormFields m={m} errors={errors} />
          {canWriteBank && <BankDataSection m={m} editable errors={errors} />}
          <Section title={t("members.form.assignments")} open actions={!(existing.exitDate || existing.deathDate) && <AssignmentAddButton memberId={id} />}>
        <AssignmentsBox rows={existing.assignments.map(toRowData)} memberId={id} readOnly={!!(existing.exitDate || existing.deathDate)} />
          </Section>
        </form>
        <AssignmentModalScaffold />
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
    };

    return c.html(
      <Layout title={`${firstName} ${lastName}`} user={user}>
        <PageHeader title={<>{firstName} {lastName} <StatusBadgeSlot saved={existing.status} /></>} backHref={"/members"} subtitle={t("common.requiredLegend")} actions={<><FormActions formId="member-form" cancelHref={`/members/${id}`} /></>} />
        <form id="member-form" method="post" action={`/members/${id}`} class="space-y-4 max-w-4xl">
          <MemberFormFields m={{ ...existing, lastName, firstName, birthDate, entryDate, firstEntryDate, exitDate, deathDate,
            street: body.street as string, houseNumber: body.houseNumber as string,
            zip: body.zip as string, city: body.city as string, gender: (body.gender as any) || null,
            phone: body.phone as string, mobile: body.mobile as string, email: body.email as string }} />
          <Section title={t("members.form.assignments")} open actions={!(existing.exitDate || existing.deathDate) && <AssignmentAddButton memberId={id} />}>
        <AssignmentsBox rows={existing.assignments.map(toRowData)} memberId={id} readOnly={!!(existing.exitDate || existing.deathDate)} />
          </Section>
        </form>
        <AssignmentModalScaffold />
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
  });

  setFlash(c, t("members.flash.saved"), "success");
  return c.redirect(`/members/${id}`);
});

// ── Funktionszuweisungen (Edit: sofort persistent) ───────────────────────────

async function assignmentsAfterChange(c: Context<{ Variables: Variables }>, id: string, more: boolean) {
  const m = (await fetchMember(id))!;
  const roles = await fetchRoles();
  const form = <AssignmentModalForm roles={roles} action={`/members/${id}/assignments`} title={t("members.assignment.titleNew")} />;
  return assignmentResult(c, <AssignmentsBox rows={m.assignments.map(toRowData)} memberId={id} />, more, form, <StatusBadgeSlot saved={m.status} oob />);
}

const isArchived = (m: { exitDate: string | null; deathDate: string | null }) => !!(m.exitDate || m.deathDate);

memberRoutes.get("/:id/assignments/new", requireAuth("members:write"), async (c) => {
  const id = c.req.param("id");
  return c.html(<AssignmentModalForm roles={await fetchRoles()} action={`/members/${id}/assignments`} title={t("members.assignment.titleNew")} />);
});

memberRoutes.get("/:id/assignments/:aid/edit", requireAuth("members:write"), async (c) => {
  const id = c.req.param("id");
  const a = (await fetchMember(id))?.assignments.find((x) => x.id === c.req.param("aid"));
  if (!a) return c.notFound();
  return c.html(<AssignmentModalForm roles={await fetchRoles()} action={`/members/${id}/assignments/${a.id}`} title={t("members.assignment.titleEdit")} values={{ roleId: a.memberRoleId, from: a.from, to: a.to ?? "", note: a.note ?? "" }} />);
});

async function saveAssignment(c: Context<{ Variables: Variables }>, aid?: string) {
  const id = c.req.param("id")!;
  const m = await fetchMember(id);
  if (!m) return c.notFound();
  if (isArchived(m)) return c.body(null, 403);
  if (aid && !m.assignments.some((a) => a.id === aid)) return c.notFound();
  const body = await c.req.parseBody({ all: true });
  const roles = await fetchRoles();
  const v = parseAssignmentForm(body);
  const err = validateAssignment({ ...v, id: aid }, m.assignments.map((a) => ({ id: a.id, roleId: a.memberRoleId, to: a.to })), roles);
  if (err) {
    const action = aid ? `/members/${id}/assignments/${aid}` : `/members/${id}/assignments`;
    return c.html(<AssignmentModalForm roles={roles} action={action} title={t(aid ? "members.assignment.titleEdit" : "members.assignment.titleNew")} values={v} error={err} />, 422);
  }
  const vals = { memberId: id, memberRoleId: v.roleId, from: v.from, to: v.to, note: v.note };
  if (aid) await db.update(memberRoleAssignments).set(vals).where(and(eq(memberRoleAssignments.id, aid), eq(memberRoleAssignments.memberId, id)));
  else await db.insert(memberRoleAssignments).values(vals);
  return assignmentsAfterChange(c, id, trimmed(body, "more") === "1" && !aid);
}

memberRoutes.post("/:id/assignments", requireAuth("members:write"), (c) => saveAssignment(c));
memberRoutes.post("/:id/assignments/:aid", requireAuth("members:write"), (c) => saveAssignment(c, c.req.param("aid")));

memberRoutes.post("/:id/assignments/:aid/delete", requireAuth("members:write"), async (c) => {
  const id = c.req.param("id");
  const m = await fetchMember(id);
  if (!m) return c.notFound();
  if (isArchived(m)) return c.body(null, 403);
  await db.delete(memberRoleAssignments).where(and(eq(memberRoleAssignments.id, c.req.param("aid")), eq(memberRoleAssignments.memberId, id)));
  const fresh = (await fetchMember(id))!;
  return c.html(<><AssignmentsBox rows={fresh.assignments.map(toRowData)} memberId={id} /><StatusBadgeSlot saved={fresh.status} oob /></>);
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

