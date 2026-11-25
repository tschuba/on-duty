import { Hono } from "hono";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { Section } from "../components/section.js";
import { Icon } from "../components/icon.js";
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

function TipCards({ tips }: { tips: Tip[] }) {
  if (!tips.length) return <p class="opacity-70">{t("help.tips.empty")}</p>;
  return (
    <div class="grid gap-4 sm:grid-cols-2">
      {tips.map((x) => (
        <article class="card card-border bg-base-100 border-base-300">
          <div class="card-body gap-2">
            <h3 class="card-title text-base"><Icon name={x.icon} class="h-5 w-5 text-primary" />{t(x.title)}</h3>
            <p>{t(x.text)}</p>
            <p class="text-sm opacity-70"><span class="font-semibold">{t("help.tips.example")}:</span> {t(x.example)}</p>
            <div class="card-actions justify-end"><a href={x.href} class="btn btn-sm btn-outline btn-primary">{t("help.tips.open")}<Icon name="icon-[tabler--arrow-right]" class="h-4 w-4" /></a></div>
          </div>
        </article>
      ))}
    </div>
  );
}

helpRoutes.get("/", requireAuth(), (c) => {
  const user = c.get("user");
  const from = helpFrom(c.req.query("from"));
  const topics = [
    { href: "/help/members", icon: "icon-[tabler--users]" as const, title: t("help.members.title"), text: t("help.members.card") },
    { href: "/help/rights", icon: "icon-[tabler--shield-lock]" as const, title: t("help.rights.title"), text: t("help.rights.card") },
    { href: "/help/tips", icon: "icon-[tabler--bulb]" as const, title: t("help.tips.title"), text: t("help.tips.card") },
  ];
  return c.html(
    <Layout title={t("help.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.title")} subtitle={t("help.intro")} {...(from ? { backHref: from, backLabel: t("help.backToOrigin") } : {})} />
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
  const caseKey = (n: number, k: "title" | "cause" | "fix") => `help.members.case.${n}.${k}` as Parameters<typeof t>[0];
  return c.html(
    <Layout title={t("help.members.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.members.title")} {...backProps(helpFrom(c.req.query("from")))} subtitle={<>{t("help.members.hero")}{HelpLink(helpFrom(c.req.query("from")))}</>} />

        <Section id="status" title={t("help.members.steps")} collapsible={false}>
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

        <Section id="matrix" title={t("help.members.relation")} collapsible={false}>
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

        <Section id="trouble" title={t("help.members.trouble")} collapsible={false}>
          <div class="space-y-2">
            {cases.map((n) => (
              <details id={`case-${n}`} class="scroll-mt-48 collapse collapse-arrow border border-base-300 bg-base-100">
                <summary class="collapse-title font-semibold">{t(caseKey(n, "title"), p)}</summary>
                <div class="collapse-content space-y-2">
                  {n === 1
                    // Gleicher Text wie die Fehlermeldung beim Anlegen, keine zweite Formulierung.
                    ? <p>{t("members.error.status.activeNoRole", { name: t("members.form.thisMember") })}</p>
                    : <>
                      <p><span class="font-semibold">{t("help.members.cause")}:</span> {t(caseKey(n, "cause"), p)}</p>
                      <p><span class="font-semibold">{t("help.members.fix")}:</span> {t(caseKey(n, "fix"), p)}</p>
                    </>}
                </div>
              </details>
            ))}
          </div>
        </Section>

        <script dangerouslySetInnerHTML={{ __html: `
(function(){var o=function(){var e=location.hash&&document.querySelector('details'+location.hash.replace(/[^#\\w-]/g,''));if(e){e.open=true;e.scrollIntoView();}};o();addEventListener('hashchange',o);})();` }} />

        <Section id="tips" title={t("help.members.tips")} collapsible={false}>
          <TipCards tips={visibleTips(user.permissions, ["members"])} />
        </Section>
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
  const caseKey = (n: number, k: "title" | "cause" | "fix") => `help.rights.case.${n}.${k}` as Parameters<typeof t>[0];
  const isAdmin = user.permissions.has("system:admin");
  return c.html(
    <Layout title={t("help.rights.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.rights.title")} {...backProps(helpFrom(c.req.query("from")))} subtitle={<>{t("help.rights.hero")}{HelpLink(helpFrom(c.req.query("from")))}</>} />

        <Section id="begriffe" title={t("help.rights.terms")} collapsible={false}>
          <dl class="space-y-3">
            {(["right", "role", "function", "scope"] as const).map((k) => (
              <div><dt class="font-semibold">{t(`help.rights.term.${k}.title`)}</dt><dd>{t(`help.rights.term.${k}.text`)}</dd></div>
            ))}
          </dl>
        </Section>

        <Section id="meine" title={t("help.rights.mine")} collapsible={false}>
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

        <Section id="fragen" title={t("help.rights.trouble")} collapsible={false}>
          <div class="space-y-2">
            {cases.map((n) => (
              <details id={`case-${n}`} class="scroll-mt-48 collapse collapse-arrow border border-base-300 bg-base-100">
                <summary class="collapse-title font-semibold">{t(caseKey(n, "title"))}</summary>
                <div class="collapse-content space-y-2">
                  <p><span class="font-semibold">{t("help.members.cause")}:</span> {t(caseKey(n, "cause"))}</p>
                  <p><span class="font-semibold">{t("help.members.fix")}:</span> {t(caseKey(n, "fix"))} {isAdmin ? <a class="link" href="/admin/permissions">{t("help.rights.adminLink")}</a> : t("help.rights.askAdmin")}</p>
                </div>
              </details>
            ))}
          </div>
        </Section>

        <script dangerouslySetInnerHTML={{ __html: `
(function(){var o=function(){var e=location.hash&&document.querySelector('details'+location.hash.replace(/[^#\\w-]/g,''));if(e){e.open=true;e.scrollIntoView();}};o();addEventListener('hashchange',o);})();` }} />
      </div>
    </Layout>
  );
});
