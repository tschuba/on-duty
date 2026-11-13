import { Hono, type Context } from "hono";
import { db } from "../db/index.js";
import { events } from "../db/schema/index.js";
import { eq } from "drizzle-orm";
import { Layout } from "../components/layout.js";
import { PageHeader } from "../components/page-header.js";
import { PublicFooter, clientIp } from "../components/public-form.js";
import { t } from "../i18n/index.js";
import { env } from "../env.js";
import { HTTP_STATUS } from "../lib/constants.js";
import { checkRateLimit, recordFailedAttempt } from "../lib/ratelimit.js";
import { verifyLinkToken, type LinkPayload } from "../lib/links.js";
import { invitedMembers, isActiveMember, setRsvp, type SetRsvpResult } from "../lib/events.js";
import { setOptOut } from "../lib/event-mail.js";
import { members } from "../db/schema/index.js";

// Öffentliche tokenbasierte Links (Backlog 149): GET zeigt nur eine Bestätigung, erst POST ändert etwas (Mail-Scanner rufen Links auf).
export const linkRoutes = new Hono();

function Page({ title, children }: { title: string; children?: unknown }) {
  return (
    <Layout title={title}>
      <div class="max-w-xl mx-auto">
        <PageHeader title={title} />
        {children}
        <PublicFooter />
      </div>
    </Layout>
  );
}

async function guard(c: Context, token: string): Promise<{ payload: LinkPayload } | { res: Response }> {
  const ip = clientIp(c);
  if (!checkRateLimit(ip).allowed) return { res: c.html(<Page title={t("link.invalid.title")}><p>{t("link.rateLimited")}</p></Page>, HTTP_STATUS.TOO_MANY_REQUESTS) as never };
  const payload = verifyLinkToken(token);
  if (!payload) {
    recordFailedAttempt(ip);
    return { res: c.html(<Page title={t("link.invalid.title")}><p>{t("link.invalid.body")}</p></Page>, HTTP_STATUS.NOT_FOUND) as never };
  }
  return { payload };
}

const RSVP_REASON: Record<Exclude<SetRsvpResult, "ok">, string> = {
  cancelled: "events.rsvp.lock.cancelled", deadline: "link.rsvp.deadline", full: "link.rsvp.full", notFound: "link.rsvp.notFound",
};

linkRoutes.get("/:token", async (c) => {
  const g = await guard(c, c.req.param("token"));
  if ("res" in g) return g.res;
  const key = g.payload.p.replace(".", "_");
  return c.html(
    <Page title={t(`link.${key}.title` as never)}>
      <p class="py-2">{t(`link.${key}.body` as never)}</p>
      <form method="post" action={`/link/${c.req.param("token")}`}>
        <button type="submit" class="btn btn-primary">{t(`link.${key}.button` as never)}</button>
      </form>
    </Page>,
  );
});

linkRoutes.post("/:token", async (c) => {
  const g = await guard(c, c.req.param("token"));
  if ("res" in g) return g.res;
  const { p, m, e, t: topic } = g.payload;

  if (p === "mail.optout" || p === "mail.optout-address") {
    const ok = await setOptOut(m, topic!, true, p === "mail.optout" ? "person" : "address", p === "mail.optout" ? "link" : "address-link");
    return ok
      ? c.html(<Page title={t("link.optedOut.title")}><p>{t("link.optedOut.body")}</p></Page>)
      : c.html(<Page title={t("link.invalid.title")}><p>{t("link.invalid.body")}</p></Page>, HTTP_STATUS.NOT_FOUND);
  }

  // event.rsvp-yes | event.rsvp-no
  const [ev] = await db.select().from(events).where(eq(events.id, e!));
  const [member] = await db.select({ id: members.id, exitDate: members.exitDate, deathDate: members.deathDate }).from(members).where(eq(members.id, m));
  const eventLink = ev && <p class="mt-4"><a class="link" href={`${env.OIDC_APP_URL}/events/${ev.id}`}>{t("link.rsvp.toEvent")}</a></p>;
  if (!ev || !member || !isActiveMember(member) || !(await invitedMembers(ev)).includes(member.id)) {
    return c.html(<Page title={t("link.rsvp.failed")}><p>{t("link.rsvp.notFound")}</p></Page>, HTTP_STATUS.NOT_FOUND);
  }
  const res = await setRsvp(ev.id, member.id, p === "event.rsvp-yes" ? "yes" : "no", false);
  if (res !== "ok") return c.html(<Page title={t("link.rsvp.failed")}><p>{t(RSVP_REASON[res] as never)}</p>{eventLink}</Page>, HTTP_STATUS.UNPROCESSABLE_ENTITY);
  return c.html(<Page title={t(p === "event.rsvp-yes" ? "link.rsvp.doneYes" : "link.rsvp.doneNo")}><p>{ev.title}</p>{eventLink}</Page>);
});
