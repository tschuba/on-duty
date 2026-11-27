import { Hono } from "hono";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { Section } from "../components/section.js";
import { Icon, type IconName } from "../components/icon.js";
import { StatusBadge } from "../components/status-badge.js";
import { env } from "../env.js";
import { t } from "../i18n/index.js";
import { deriveMemberStatus, type MemberStatus } from "../lib/status.js";
import { visibleTips, type Tip } from "../lib/help-tips.js";
import { inArray, asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { appRoles } from "../db/schema/index.js";
import { PERMISSIONS, PERMISSION_AREAS, type Permission } from "../lib/roles.js";
import { PERMISSION_LABELS } from "../components/permission-badges.js";
import { cashPerms, hasCash } from "../lib/cash.js";
import { MEMBER_STATUSES, type StatusScope } from "../lib/member-scope.js";

export const helpRoutes = new Hono<{ Variables: Variables }>();

type Limits = { children: number; youth: number; active: number };
const LIMITS = (): Limits => ({ children: env.CHILDREN_AGE_LIMIT, youth: env.YOUTH_AGE_LIMIT, active: env.ACTIVE_AGE_LIMIT });

// Matrix aus derselben Funktion wie der echte Status: je Altersband ein Beispielmitglied mit/ohne laufende Funktion.
export function statusMatrix(l: Limits, today = new Date()): { from: number; to: number | null; withRole: MemberStatus; without: MemberStatus }[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const birth = (age: number) => {
    const d = new Date(today.getFullYear() - age, today.getMonth(), today.getDate() - 1); // Vortag: robust gegen Zeitzonen-Grenzfall
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const role = [{ from: null, to: null, role: { grantsActiveStatus: true } }] as never;
  const derive = (age: number, withRole: boolean) =>
    deriveMemberStatus({ birthDate: birth(age), exitDate: null, deathDate: null }, withRole ? role : [], l.children, l.youth, l.active, today);
  const bands: [number, number | null][] = [[0, l.children], [l.children, l.youth], [l.youth, l.active], [l.active, null]];
  return bands.map(([from, to]) => ({ from, to, withRole: derive(from, true), without: derive(from, false) }));
}

// Direkt vergebene Rechte je Bereich, in der Reihenfolge von PERMISSIONS; leere Bereiche entfallen.
export function rightsByArea(perms: ReadonlySet<string>): { area: string; perms: Permission[] }[] {
  return PERMISSION_AREAS.map((a) => ({
    area: a.key,
    perms: PERMISSIONS.filter((p) => perms.has(p) && (a.resources as readonly string[]).includes(p.split(":")[0])),
  })).filter((a) => a.perms.length > 0);
}

// Ursprungsseite (?from=) nur als interner Pfad; sonst Open-Redirect bzw. Schleife in die Hilfe.
export const helpFrom = (v: string | undefined) => (v && /^\/(?![/\\])/.test(v) && !v.startsWith("/help") ? v : undefined);
const backProps = (from?: string) => (from ? { backHref: from, backLabel: t("help.backToOrigin") } : { backHref: "/help", backLabel: t("help.title") });
// Mit Ursprung ist der Zurück-Link belegt; die Hilfe-Übersicht bleibt als zweiter Link erreichbar.
const HelpLink = (from?: string) => (from ? <> · <a href={withFrom("/help", from)} class="link link-hover">{t("help.title")}</a></> : null);
const withFrom = (href: string, from?: string) => (from ? `${href}?from=${encodeURIComponent(from)}` : href);

function ScopeBadges({ scope }: { scope: StatusScope }) {
  if (scope === "all" || scope.size === 0) return <span>{t("help.rights.scope.all")}</span>;
  return <span class="flex flex-wrap gap-1">{MEMBER_STATUSES.filter((x) => scope.has(x)).map((x) => <StatusBadge status={x} />)}</span>;
}

// Öffnet das per #case-N verlinkte <details>.
const OpenCaseOnHash = () => <script dangerouslySetInnerHTML={{ __html: `
(function(){var o=function(){var e=location.hash&&document.querySelector('details'+location.hash.replace(/[^#\\w-]/g,''));if(e){e.open=true;e.scrollIntoView();}};o();addEventListener('hashchange',o);})();` }} />;

// Markiert Linkwörter im i18n-Text als [Wort]; ohne Ziel (kein Recht) bleibt Klartext.
export function linkify(text: string, href: string | null) {
  return text.split(/\[([^\]]+)\]/).map((part, i) => i % 2 === 0 ? part : href ? <a href={href} class="link link-primary">{part}</a> : part);
}

type CasesProps = { prefix: "members" | "rights" | "cash" | "inventory" | "lending" | "donations"; count: number; params?: Record<string, number>; body?: (n: number) => unknown; fixExtra?: (n: number) => unknown };
// Aufklappbare Fehlerfälle (Ursache/Lösung); `body` ersetzt den Standardinhalt eines Falls.
function HelpCases({ prefix, count, params, body, fixExtra }: CasesProps) {
  const k = (n: number, f: "title" | "cause" | "fix") => `help.${prefix}.case.${n}.${f}` as Parameters<typeof t>[0];
  return (
    <div class="space-y-2">
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <details id={`case-${n}`} class="scroll-mt-48 collapse collapse-arrow border border-base-300 bg-base-100">
          <summary class="collapse-title font-semibold">{t(k(n, "title"), params)}</summary>
          <div class="collapse-content space-y-2">
            {(body?.(n) as never) ?? <>
              <p><span class="font-semibold">{t("help.common.cause")}:</span> {t(k(n, "cause"), params)}</p>
              <p><span class="font-semibold">{t("help.common.fix")}:</span> {t(k(n, "fix"), params)} {fixExtra?.(n) as never}</p>
            </>}
          </div>
        </details>
      ))}
    </div>
  );
}

function TipCards({ tips, max }: { tips: Tip[]; max?: number }) {
  if (!tips.length) return <p class="opacity-70">{t("help.tips.empty")}</p>;
  const shown = max ? tips.slice(0, max) : tips;
  return (
    <>
    <div class="grid gap-4 sm:grid-cols-2">
      {shown.map((x) => (
        <article class="card bg-base-200">
          <div class="card-body gap-2">
            <h3 class="card-title text-base"><Icon name={x.icon} class="h-5 w-5 text-primary" />{t(x.title)}<span class="badge badge-sm badge-ghost ml-auto">{t("help.tips.badge")}</span></h3>
            <p>{t(x.text)}</p>
            <p class="text-sm opacity-70"><span class="font-semibold">{t("help.tips.example")}:</span> {t(x.example)}</p>
            <div class="card-actions justify-end"><a href={x.href} class="btn btn-sm btn-outline btn-primary">{t("help.tips.open")}<Icon name="icon-[tabler--arrow-right]" class="h-4 w-4" /></a></div>
          </div>
        </article>
      ))}
    </div>
    {max && <p class="mt-3 text-right"><a href="/help/tips" class="link link-primary">{t("help.tips.all")}</a></p>}
    </>
  );
}

helpRoutes.get("/", requireAuth(), (c) => {
  const user = c.get("user");
  const from = helpFrom(c.req.query("from"));
  const topics: { href: string; icon: IconName; title: string; text: string }[] = [
    { href: "/help/members", icon: "icon-[tabler--users]" as const, title: t("help.members.title"), text: t("help.members.card") },
    { href: "/help/rights", icon: "icon-[tabler--shield-lock]" as const, title: t("help.rights.title"), text: t("help.rights.card") },
  ];
  if (user.permissions.has("inventory:read")) topics.push({ href: "/help/inventory", icon: "icon-[tabler--building-warehouse]" as const, title: t("help.inventory.title"), text: t("help.inventory.card") });
  if (user.permissions.has("lending:read")) topics.push({ href: "/help/lending", icon: "icon-[tabler--arrows-exchange]" as const, title: t("help.lending.title"), text: t("help.lending.card") });
  if (user.permissions.has("donations:read")) topics.push({ href: "/help/donations", icon: "icon-[tabler--heart-handshake]" as const, title: t("help.donations.title"), text: t("help.donations.card") });
  if (hasCash(user.permissions, "report")) topics.push({ href: "/help/cash", icon: "icon-[tabler--cash-register]" as const, title: t("help.cash.title"), text: t("help.cash.card") });
  return c.html(
    <Layout title={t("help.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.title")} subtitle={t("help.intro")} {...(from ? { backHref: from, backLabel: t("help.backToOrigin") } : {})} />
        <h2 class="text-sm font-semibold uppercase tracking-wide opacity-70 mb-3">{t("help.group.explained")}</h2>
        <div class="grid gap-4 sm:grid-cols-2">
          {topics.map((x) => (
            <a href={withFrom(x.href, from)} class="card card-border bg-base-100 border-base-300 hover:border-primary focus-visible:outline-2">
              <div class="card-body gap-2">
                <h2 class="card-title"><Icon name={x.icon} class="h-6 w-6 text-primary" />{x.title}</h2>
                <p>{x.text}</p>
              </div>
            </a>
          ))}
        </div>
        <h2 class="text-sm font-semibold uppercase tracking-wide opacity-70 mt-8 mb-3">{t("help.group.discover")}</h2>
        <a href={withFrom("/help/tips", from)} class="card bg-base-200 hover:bg-base-300 focus-visible:outline-2">
          <div class="card-body gap-1">
            <h3 class="card-title"><Icon name="icon-[tabler--bulb]" class="h-6 w-6 text-primary" />{t("help.tips.title")}</h3>
            <p>{t("help.tips.card")}</p>
          </div>
        </a>
      </div>
    </Layout>
  );
});

helpRoutes.get("/tips", requireAuth(), (c) => {
  const user = c.get("user");
  return c.html(
    <Layout title={t("help.tips.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.tips.title")} {...backProps(helpFrom(c.req.query("from")))} subtitle={<>{t("help.tips.hero")}{HelpLink(helpFrom(c.req.query("from")))}</>} />
        <TipCards tips={visibleTips(user.permissions)} />
      </div>
    </Layout>
  );
});

helpRoutes.get("/cash", requireAuth(cashPerms("report")), (c) => {
  const user = c.get("user");
  const from = helpFrom(c.req.query("from"));
  const levels = ["report", "read", "manage", "cancel", "lending", "reopen"] as const;
  const key = (l: string) => `help.cash.right.${l}` as Parameters<typeof t>[0];
  const flow = [1, 2, 3, 4] as const;
  const entries = ["storno", "tags", "events", "donation", "lending"] as const;
  const cases = [1, 2, 3, 4, 5, 6] as const;
  // Sprunglink in die Kasse; nur sichtbar, wenn der Nutzer das Ziel auch öffnen darf.
  const go = (ok: boolean, href: string, label: string) => ok ? <a href={href} class="link link-primary inline-flex items-center gap-1 text-sm">{label}<Icon name="icon-[tabler--arrow-right]" class="h-4 w-4" /></a> : null;
  const manage = hasCash(user.permissions, "manage");
  const read = hasCash(user.permissions, "read");
  const flowGo: Record<number, ReturnType<typeof go>> = {
    1: go(manage, "/cash", t("cash.title")),
    2: go(manage, "/cash/new", t("cash.newEntry")),
    3: go(manage, "/cash", t("cash.view.entries")),
    4: go(manage, "/cash?view=report", t("cash.view.report")),
  };
  // Ziel je Eintrag; ohne Recht bleibt das [Wort] im Text Klartext.
  const entryLink: Record<string, { href: string; ok: boolean }> = {
    tags: { href: "/cash?view=tags", ok: read },
    events: { href: "/cash?view=events", ok: read },
    donation: { href: "/donations", ok: user.permissions.has("donations:read") },
    lending: { href: "/lending", ok: user.permissions.has("lending:read") },
  };
  const entryText = (n: string) => {
    const l = entryLink[n];
    return linkify(t(`help.cash.entries.${n}` as Parameters<typeof t>[0]), l?.ok ? l.href : null);
  };
  const caseGo: Record<number, ReturnType<typeof go>> = {
    1: go(manage, "/cash", t("cash.title")),
    2: go(manage, "/cash?view=report", t("cash.view.report")),
    5: go(read, "/cash?view=tags", t("cash.view.tags")),
  };
  return c.html(
    <Layout title={t("help.cash.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.cash.title")} {...backProps(from)} subtitle={<>{t("help.cash.hero")}{HelpLink(from)} · {go(true, "/cash", t("cash.title"))}</>} />

        <Section id="rights" class="scroll-mt-48" title={t("help.cash.rights")} collapsible={false}>
          <p class="mb-4">{t("help.cash.rights.intro")}</p>
          <ul class="space-y-3">
            {levels.map((l) => {
              const own = hasCash(user.permissions, l);
              return (
                <li class={`rounded-box border p-3 ${own ? "border-primary/50 bg-primary/5" : "border-base-300"}`}>
                  <div class="flex flex-wrap items-center gap-2 mb-1">
                    <span class={`badge ${own ? "badge-primary" : "badge-ghost"}`}>{PERMISSION_LABELS[`cash:${l}` as Permission]}</span>
                    {own && <span class="text-xs opacity-70">{t("help.cash.right.own")}</span>}
                  </div>
                  <p>{t(key(l))}</p>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section id="flow" class="scroll-mt-48" title={t("help.cash.flow")} collapsible={false}>
          <ol class="space-y-4">
            {flow.map((n) => {
              const [head, ...rest] = t(`help.cash.flow.${n}` as Parameters<typeof t>[0]).split(": ");
              return (
                <li class="flex items-start gap-3">
                  <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-content text-sm font-bold" aria-hidden="true">{n}</span>
                  <div><div class="font-semibold">{head}</div><p class="opacity-80">{rest.join(": ")}</p>{flowGo[n]}</div>
                </li>
              );
            })}
          </ol>
        </Section>

        <Section id="entries" class="scroll-mt-48" title={t("help.cash.entries")} collapsible={false}>
          <div role="alert" class="alert alert-info mb-4"><Icon name="icon-[tabler--info-circle]" class="h-5 w-5" /><span>{t("help.cash.entries.storno")}</span></div>
          <ul class="list-disc pl-6 space-y-2">{entries.filter((n) => n !== "storno").map((n) => <li>{entryText(n)}</li>)}</ul>
        </Section>

        <Section id="report" class="scroll-mt-48" title={t("help.cash.report")} collapsible={false}>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="rounded-box border border-base-300 p-4 space-y-2">
              <div class="flex flex-wrap items-center gap-2"><Icon name="icon-[tabler--report]" class="h-5 w-5 text-primary" /><span class="font-semibold">{t("help.cash.report.summary.title")}</span><span class={`badge h-auto whitespace-normal py-0.5 text-left ${hasCash(user.permissions, "report") ? "badge-primary" : "badge-ghost"}`}>{PERMISSION_LABELS["cash:report"]}</span></div>
              <p>{t("help.cash.report.summary")}</p>
              {go(true, "/cash?view=report", t("cash.view.report"))}
            </div>
            <div class="rounded-box border border-base-300 p-4 space-y-2">
              <div class="flex flex-wrap items-center gap-2"><Icon name="icon-[tabler--file-spreadsheet]" class="h-5 w-5 text-primary" /><span class="font-semibold">{t("help.cash.report.detail.title")}</span><span class={`badge h-auto whitespace-normal py-0.5 text-left ${read ? "badge-primary" : "badge-ghost"}`}>{PERMISSION_LABELS["cash:read"]}</span></div>
              <p>{t("help.cash.report.detail")}</p>
              <p>{t("help.cash.report.csv")}</p>
              <div class="flex flex-wrap gap-1">{t("help.cash.report.csv.cols").split(",").map((c) => <span class="badge badge-outline">{c}</span>)}</div>
            </div>
          </div>
          <div role="alert" class="alert alert-info mt-4"><Icon name="icon-[tabler--info-circle]" class="h-5 w-5" /><span>{t("help.cash.report.provisional")}</span></div>
        </Section>

        <Section id="settings" class="scroll-mt-48" title={t("help.cash.settings")} collapsible={false}>
          <p class="mb-4 flex flex-wrap items-center gap-2">{t("help.cash.settings.need")}<span class={`badge h-auto whitespace-normal py-0.5 text-left ${manage ? "badge-primary" : "badge-ghost"}`}>{PERMISSION_LABELS["cash:manage"]}</span></p>
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="rounded-box border border-base-300 p-4 space-y-2">
              <div class="flex items-center gap-2"><Icon name="icon-[tabler--calendar]" class="h-5 w-5 text-primary" /><span class="font-semibold">{t("help.cash.settings.mode.title")}</span></div>
              <p class="opacity-80">{t("help.cash.settings.mode")}</p>
              <ul class="space-y-1">{([1, 2, 3] as const).map((n) => <li class="flex gap-2"><Icon name="icon-[tabler--point]" class="h-5 w-5 shrink-0 text-primary" /><span class={n === 3 ? "font-mono" : ""}>{t(`help.cash.settings.mode.${n}` as Parameters<typeof t>[0])}</span></li>)}</ul>
            </div>
            <div class="rounded-box border border-base-300 p-4 space-y-2">
              <div class="flex items-center gap-2"><Icon name="icon-[tabler--scale]" class="h-5 w-5 text-primary" /><span class="font-semibold">{t("help.cash.settings.basis.title")}</span></div>
              <p class="opacity-80">{t("help.cash.settings.basis")}</p>
              <dl class="space-y-1">{([1, 2] as const).map((n) => <div><dt class="font-medium">{t(`help.cash.settings.basis.${n}` as Parameters<typeof t>[0])}</dt><dd class="opacity-80">{t(`help.cash.settings.basis.${n}.text` as Parameters<typeof t>[0])}</dd></div>)}</dl>
            </div>
          </div>
          <div role="alert" class="alert alert-warning mt-4"><Icon name="icon-[tabler--alert-triangle]" class="h-5 w-5" /><span>{t("help.cash.settings.apply")}</span></div>
        </Section>

        <Section id="tips" class="scroll-mt-48" title={t("help.cash.tips")} collapsible={false}>
          <TipCards tips={visibleTips(user.permissions, ["cash"])} max={2} />
        </Section>

        <Section id="trouble" class="scroll-mt-48" title={t("help.cash.trouble")} collapsible={false}>
          <HelpCases prefix="cash" count={cases.length} fixExtra={(n) => caseGo[n]} />
        </Section>

        <OpenCaseOnHash />

      </div>
    </Layout>
  );
});

type Key = Parameters<typeof t>[0];
const goLink = (ok: boolean, href: string, label: string) => ok ? <a href={href} class="link link-primary inline-flex items-center gap-1 text-sm">{label}<Icon name="icon-[tabler--arrow-right]" class="h-4 w-4" /></a> : null;

// Rechte-Liste: eigene Rechte hervorgehoben.
function RightsList({ items }: { items: { perm: Permission; own: boolean; text: string }[] }) {
  return (
    <ul class="space-y-3">
      {items.map((r) => (
        <li class={`rounded-box border p-3 ${r.own ? "border-primary/50 bg-primary/5" : "border-base-300"}`}>
          <div class="flex flex-wrap items-center gap-2 mb-1">
            <span class={`badge h-auto whitespace-normal py-0.5 text-left ${r.own ? "badge-primary" : "badge-ghost"}`}>{PERMISSION_LABELS[r.perm]}</span>
            {r.own && <span class="text-xs opacity-70">{t("help.cash.right.own")}</span>}
          </div>
          <p>{r.text}</p>
        </li>
      ))}
    </ul>
  );
}

// Nummerierter Ablauf; Text „Kopf: Erklärung“, optional Sprunglink je Schritt.
function FlowSteps({ prefix, count, go }: { prefix: "inventory" | "lending" | "donations"; count: number; go?: Record<number, unknown> }) {
  return (
    <ol class="space-y-4">
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
        const [head, ...rest] = t(`help.${prefix}.flow.${n}` as Key).split(": ");
        return (
          <li class="flex items-start gap-3">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-content text-sm font-bold" aria-hidden="true">{n}</span>
            <div><div class="font-semibold">{head}</div><p class="opacity-80">{rest.join(": ")}</p>{go?.[n] as never}</div>
          </li>
        );
      })}
    </ol>
  );
}

// Status-Legende: Badge links, Erklärung rechts.
function BadgeLegend({ items }: { items: { badge: string; label: string; text: string }[] }) {
  return (
    <dl class="grid gap-x-4 gap-y-3 sm:grid-cols-[max-content_1fr] items-center">
      {items.map((x) => <><dt><span class={`badge ${x.badge}`}>{x.label}</span></dt><dd>{x.text}</dd></>)}
    </dl>
  );
}

helpRoutes.get("/inventory", requireAuth("inventory:read"), (c) => {
  const user = c.get("user");
  const from = helpFrom(c.req.query("from"));
  const has = (p: Permission) => user.permissions.has(p);
  const rights: [Permission, string][] = [
    ["inventory:read", "read"], ["inventory:manage", "manage"], ["inventory:configure", "configure"], ["inventory:inspect", "inspect"], ["inventory:inspection:delete", "inspectionDelete"],
  ];
  const due = [["badge-success", "ok"], ["badge-warning", "soon"], ["badge-error", "overdue"], ["badge-ghost", "none"]] as const;
  return c.html(
    <Layout title={t("help.inventory.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.inventory.title")} {...backProps(from)} subtitle={<>{t("help.inventory.hero")}{HelpLink(from)} · {goLink(true, "/inventory", t("inventory.title"))}</>} />

        <Section id="rights" class="scroll-mt-48" title={t("help.inventory.rights")} collapsible={false}>
          <p class="mb-4">{t("help.inventory.rights.intro")}</p>
          <RightsList items={rights.map(([perm, k]) => ({ perm, own: has(perm), text: t(`help.inventory.right.${k}` as Key) }))} />
        </Section>

        <Section id="flow" class="scroll-mt-48" title={t("help.inventory.flow")} collapsible={false}>
          <FlowSteps prefix="inventory" count={4} go={{
            1: goLink(has("inventory:manage"), "/inventory/new", t("inventory.newItem")),
            2: goLink(has("inventory:configure"), "/inventory/inspections?view=templates", t("inventory.tabs.inspectionTemplates")),
            3: goLink(true, "/inventory/inspections", t("inventory.tabs.inspections")),
          }} />
        </Section>

        <Section id="status" class="scroll-mt-48" title={t("help.inventory.status")} collapsible={false}>
          <p class="mb-4 opacity-70">{t("help.inventory.status.intro")}</p>
          <BadgeLegend items={[
            { badge: "badge-success", label: t("inventory.status.active"), text: t("help.inventory.status.active") },
            { badge: "badge-info", label: t("inventory.status.lendable"), text: t("help.inventory.status.lendable") },
            { badge: "badge-neutral", label: t("inventory.status.retired"), text: t("help.inventory.status.retired") },
          ]} />
          <h3 class="font-semibold mt-6 mb-3">{t("inventory.table.dueDate")}</h3>
          <BadgeLegend items={due.map(([badge, k]) => ({ badge, label: t(`inventory.map.legend.${k}` as Key), text: t(`help.inventory.due.${k}` as Key) }))} />
        </Section>

        <Section id="trouble" class="scroll-mt-48" title={t("help.inventory.trouble")} collapsible={false}>
          <HelpCases prefix="inventory" count={6} />
        </Section>

        <OpenCaseOnHash />
      </div>
    </Layout>
  );
});

helpRoutes.get("/lending", requireAuth("lending:read"), (c) => {
  const user = c.get("user");
  const from = helpFrom(c.req.query("from"));
  const manage = user.permissions.has("lending:manage");
  const states = [
    ["badge-warning", t("lending.overview.status.requested"), "requested"], ["badge-ghost", t("lending.overview.status.planned"), "planned"],
    ["badge-info", t("lending.overview.status.active"), "active"], ["badge-error", t("lending.overview.status.overdue"), "overdue"],
    ["badge-success", t("lending.overview.status.returned"), "returned"], ["badge-ghost", t("lending.overview.status.rejected"), "rejected"],
  ] as const;
  const caseGo: Record<number, ReturnType<typeof goLink>> = { 1: goLink(true, "/inventory/lending", t("lending.title")), 6: goLink(true, "/inventory/lending", t("lending.title")) };
  return c.html(
    <Layout title={t("help.lending.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.lending.title")} {...backProps(from)} subtitle={<>{t("help.lending.hero")}{HelpLink(from)} · {goLink(true, "/inventory/lending", t("lending.title"))}</>} />

        <Section id="rights" class="scroll-mt-48" title={t("help.lending.rights")} collapsible={false}>
          <p class="mb-4">{t("help.lending.rights.intro")}</p>
          <RightsList items={([["lending:read", "read"], ["lending:manage", "manage"]] as const).map(([perm, k]) => ({ perm, own: user.permissions.has(perm), text: t(`help.lending.right.${k}` as Key) }))} />
        </Section>

        <Section id="flow" class="scroll-mt-48" title={t("help.lending.flow")} collapsible={false}>
          <FlowSteps prefix="lending" count={4} go={{
            2: goLink(manage, "/inventory/lending?status=requested", t("lending.overview.status.requested")),
            3: goLink(manage, "/inventory/lending/loans/new", t("lending.newLoan")),
          }} />
        </Section>

        <Section id="status" class="scroll-mt-48" title={t("help.lending.status")} collapsible={false}>
          <BadgeLegend items={states.map(([badge, label, k]) => ({ badge, label, text: t(`help.lending.status.${k}` as Key) }))} />
        </Section>

        <Section id="public" class="scroll-mt-48" title={t("help.lending.public")} collapsible={false}>
          <ul class="space-y-2">
            {([1, 2, 3] as const).map((n) => <li class="flex gap-2"><Icon name="icon-[tabler--point]" class="h-5 w-5 shrink-0 text-primary" /><span>{t(`help.lending.public.${n}` as Key)}</span></li>)}
          </ul>
          <div role="alert" class="alert alert-info mt-4"><Icon name="icon-[tabler--info-circle]" class="h-5 w-5" /><span>{t("help.lending.public.where")}</span></div>
        </Section>

        <Section id="trouble" class="scroll-mt-48" title={t("help.lending.trouble")} collapsible={false}>
          <HelpCases prefix="lending" count={6} fixExtra={(n) => caseGo[n]} />
        </Section>

        <OpenCaseOnHash />
      </div>
    </Layout>
  );
});

helpRoutes.get("/donations", requireAuth("donations:read"), (c) => {
  const user = c.get("user");
  const from = helpFrom(c.req.query("from"));
  const issue = user.permissions.has("donations:issue-receipts");
  const states = [["badge-warning", "receiptOpen", "open"], ["badge-success", "receiptIssued", "issued"], ["badge-ghost", "receiptNotRequired", "not_required"]] as const;
  const go = goLink(true, "/donations", t("donations.title"));
  return c.html(
    <Layout title={t("help.donations.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.donations.title")} {...backProps(from)} subtitle={<>{t("help.donations.hero")}{HelpLink(from)} · {go}</>} />

        <Section id="rights" class="scroll-mt-48" title={t("help.donations.rights")} collapsible={false}>
          <RightsList items={(["read", "record", "issue-receipts", "delete"] as const).map((k) => ({ perm: `donations:${k}`, own: user.permissions.has(`donations:${k}`), text: t(`help.donations.right.${k}` as Key) }))} />
        </Section>

        <Section id="flow" class="scroll-mt-48" title={t("help.donations.flow")} collapsible={false}>
          <FlowSteps prefix="donations" count={4} go={{ 1: goLink(user.permissions.has("donations:record"), "/donations/new", t("donations.newDonation")) }} />
        </Section>

        <Section id="status" class="scroll-mt-48" title={t("help.donations.status")} collapsible={false}>
          <BadgeLegend items={states.map(([badge, label, k]) => ({ badge, label: t(`donations.table.${label}` as Key), text: t(`help.donations.status.${k}` as Key) }))} />
        </Section>

        <Section id="trouble" class="scroll-mt-48" title={t("help.donations.trouble")} collapsible={false}>
          <HelpCases prefix="donations" count={issue ? 4 : 1} />
        </Section>

        <OpenCaseOnHash />
      </div>
    </Layout>
  );
});

helpRoutes.get("/members", requireAuth(), (c) => {
  const user = c.get("user");
  const l = LIMITS();
  const p = { aktiv: l.active, kinder: l.children, jugend: l.youth };
  const steps: { status: MemberStatus; text: string }[] = [
    { status: "deceased", text: t("help.members.step.deceased") },
    { status: "left", text: t("help.members.step.left") },
    { status: "active", text: t("help.members.step.running", p) },
    { status: "passive", text: t("help.members.step.passive", p) },
    { status: "supporting", text: t("help.members.step.supporting") },
  ];
  const timeline: MemberStatus[] = ["children", "youth", "active", "passive"];
  const cases = [1, 2, 3, 4, 5, 6, 7] as const;
  return c.html(
    <Layout title={t("help.members.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.members.title")} {...backProps(helpFrom(c.req.query("from")))} subtitle={<>{t("help.members.hero")}{HelpLink(helpFrom(c.req.query("from")))}</>} />

        <Section id="status" class="scroll-mt-48" title={t("help.members.steps")} collapsible={false}>
          <p class="mb-4 opacity-70">{t("help.members.stepsHint")}</p>
          <ol class="space-y-3">
            {steps.map((s, i) => (
              <li class="flex items-start gap-3">
                <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-content text-sm font-bold" aria-hidden="true">{i + 1}</span>
                <div class="flex flex-col items-start gap-1"><StatusBadge status={s.status} /><span>{s.text}</span></div>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="matrix" class="scroll-mt-48" title={t("help.members.relation")} collapsible={false}>
          <ul class="flex flex-wrap items-center gap-2 mb-4" aria-label={t("help.members.timeline")}>
            {timeline.map((s, i) => <li class="flex items-center gap-2">{i > 0 && <Icon name="icon-[tabler--arrow-right]" class="h-4 w-4 opacity-60" />}<StatusBadge status={s} /></li>)}
          </ul>
          <p class="mb-4">{t("help.members.timeline")}</p>
          <div class="overflow-x-auto">
            <table class="table">
              <thead><tr><th>{t("help.members.matrix.age")}</th><th>{t("help.members.matrix.with")}</th><th>{t("help.members.matrix.without")}</th></tr></thead>
              <tbody>
                {statusMatrix(l).map((r) => (
                  <tr>
                    <td>{r.to === null || r.from > 0 ? t("help.members.matrix.row", { von: r.from }) : t("help.members.matrix.rowFirst", { bis: r.to })}</td>
                    <td><StatusBadge status={r.withRole} /></td>
                    <td><StatusBadge status={r.without} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="mt-4">{t("help.members.roles")}</p>
          <div role="alert" class="alert alert-warning mt-4"><Icon name="icon-[tabler--alert-triangle]" class="h-5 w-5" /><span>{t("help.members.endRole")}</span></div>
        </Section>

        <Section id="tips" class="scroll-mt-48" title={t("help.members.tips")} collapsible={false}>
          <TipCards tips={visibleTips(user.permissions, ["members"])} max={2} />
        </Section>

        <Section id="trouble" class="scroll-mt-48" title={t("help.members.trouble")} collapsible={false}>
          <HelpCases prefix="members" count={cases.length} params={p} body={(n) => n === 1
            // Gleicher Text wie die Fehlermeldung beim Anlegen, keine zweite Formulierung.
            ? <p>{t("members.error.status.activeNoRole", { name: t("members.form.thisMember") })}</p>
            : undefined} />
        </Section>

        <OpenCaseOnHash />

      </div>
    </Layout>
  );
});

helpRoutes.get("/rights", requireAuth(), async (c) => {
  const user = c.get("user");
  const ids = [...user.roleIds];
  const roles = ids.length ? await db.select({ name: appRoles.name }).from(appRoles).where(inArray(appRoles.id, ids)).orderBy(asc(appRoles.name)) : [];
  const areas = rightsByArea(user.permissions);
  const scopes = (["read", "write", "delete"] as const).filter((k) => user.permissions.has(`members:${k}` as Permission));
  const cases = [1, 2, 3, 4, 5, 6, 7] as const;
  const isAdmin = user.permissions.has("system:admin");
  return c.html(
    <Layout title={t("help.rights.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.rights.title")} {...backProps(helpFrom(c.req.query("from")))} subtitle={<>{t("help.rights.hero")}{HelpLink(helpFrom(c.req.query("from")))}</>} />

        <Section id="terms" class="scroll-mt-48" title={t("help.rights.terms")} collapsible={false}>
          <dl class="space-y-3">
            {(["right", "role", "function", "scope"] as const).map((k) => (
              <div><dt class="font-semibold">{t(`help.rights.term.${k}.title`)}</dt><dd>{t(`help.rights.term.${k}.text`)}</dd></div>
            ))}
          </dl>
        </Section>

        <Section id="mine" class="scroll-mt-48" title={t("help.rights.mine")} collapsible={false}>
          <h3 class="font-semibold mb-2">{t("help.rights.myRoles")}</h3>
          {roles.length
            ? <div class="flex flex-wrap gap-2 mb-4">{roles.map((r) => <span class="badge badge-primary">{r.name}</span>)}</div>
            : <p class="opacity-70 mb-4">{t("help.rights.noRoles")}</p>}
          <h3 class="font-semibold mb-2">{t("help.rights.myRights")}</h3>
          {areas.length
            ? areas.map((a) => (
              <div class="mb-3">
                <div class="text-xs font-bold uppercase tracking-wide text-base-content/60 mb-1">{t(`admin.permissions.area.${a.area}` as Parameters<typeof t>[0])}</div>
                <div class="flex flex-wrap gap-1">{a.perms.map((x) => <span class="badge badge-outline badge-sm h-auto whitespace-normal py-0.5 text-left">{PERMISSION_LABELS[x]}</span>)}</div>
              </div>
            ))
            : <p class="opacity-70">{t("help.rights.noRights")}</p>}
          <p class="text-sm opacity-70 mt-2">{t("help.rights.impliedHint")}</p>
          {scopes.length > 0 && (
            <>
              <h3 class="font-semibold mt-4 mb-2">{t("help.rights.myScope")}</h3>
              <ul class="space-y-2">
                {scopes.map((k) => <li class="flex flex-wrap items-center gap-2"><span class="font-medium">{t(`help.rights.scope.${k}`)}:</span><ScopeBadges scope={user.memberScope[k]} /></li>)}
              </ul>
              <p class="text-sm opacity-70 mt-2">{t("help.rights.scopeHint")}</p>
            </>
          )}
        </Section>

        <Section id="trouble" class="scroll-mt-48" title={t("help.rights.trouble")} collapsible={false}>
          <HelpCases prefix="rights" count={cases.length} fixExtra={(n) => isAdmin ? <a class="link" href="/admin/permissions">{t("help.rights.adminLink")}</a> : t("help.rights.askAdmin")} />
        </Section>

        <OpenCaseOnHash />
      </div>
    </Layout>
  );
});
