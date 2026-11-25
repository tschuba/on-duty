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
  const topics = [
    { href: "/help/members", icon: "icon-[tabler--users]" as const, title: t("help.members.title"), text: t("help.members.card") },
    { href: "/help/tips", icon: "icon-[tabler--bulb]" as const, title: t("help.tips.title"), text: t("help.tips.card") },
  ];
  return c.html(
    <Layout title={t("help.title")} user={user}>
      <div class="max-w-4xl mx-auto">
        <PageHeader title={t("help.title")} subtitle={t("help.intro")} />
        <div class="grid gap-4 sm:grid-cols-2">
          {topics.map((x) => (
            <a href={x.href} class="card card-border bg-base-100 border-base-300 hover:border-primary focus-visible:outline-2">
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
        <PageHeader title={t("help.tips.title")} backHref="/help" backLabel={t("help.title")} subtitle={t("help.tips.hero")} />
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
        <PageHeader title={t("help.members.title")} backHref="/help" backLabel={t("help.title")} subtitle={t("help.members.hero")} />

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
