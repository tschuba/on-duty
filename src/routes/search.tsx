import { Hono } from "hono";
import { and, asc, desc, gte, ilike, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { events, inventoryItems } from "../db/schema/index.js";
import { Icon, type IconName } from "../components/icon.js";
import { createLinks, menuLinks } from "../components/nav-menu.js";
import { requireAuth, type Variables } from "../middleware/auth.js";
import { t } from "../i18n/index.js";
import { formatDay, now, resolveTimezone } from "../lib/datetime.js";
import { visibilityCondition } from "../lib/events.js";
import { inScope } from "../lib/member-scope.js";
import { fetchMembersWithStatus } from "./members.js";

export const searchRoutes = new Hono<{ Variables: Variables }>();

const LIMIT = 5;
const MIN_CHARS = 2;

type Hit = { title: string; href: string; icon: IconName; extra?: string; cancelled?: boolean; external?: boolean };
type Group = { label: string; hits: Hit[] };

// Neue Quelle = eigener Provider mit eigener Rechteprüfung (siehe docs/style-guide.md, Navigation).
const escapeLike = (q: string) => q.replace(/[\\%_]/g, "\\$&");

searchRoutes.get("/", requireAuth(), async (c) => {
  const user = c.get("user");
  const q = (c.req.query("q") ?? "").trim();
  const toHit = (l: ReturnType<typeof createLinks>[number]): Hit => ({ title: l.label, href: l.href, icon: "icon-[tabler--plus]" });
  const creates = (needle: string) => createLinks(user).filter((l) => l.label.toLowerCase().includes(needle)).map(toHit);
  const createGroup = (hits: Hit[]): Group => ({ label: t("search.group.create"), hits });
  if (q.length === 0) return c.html(renderGroups([createGroup(creates(""))]));
  if (q.length < MIN_CHARS) return c.html(<div class="px-3 py-2 text-sm opacity-60">{t("search.minChars")}</div>);

  const has = (p: string) => user.permissions.has(p as never);
  const needle = q.toLowerCase();
  const like = `%${escapeLike(q)}%`;
  const tz = resolveTimezone(c);
  const today = now();
  const from = new Date(today); from.setMonth(from.getMonth() - 12);

  const [menu, members, inventory, evs] = await Promise.all([
    Promise.resolve(
      menuLinks(user).filter((l) => `${l.label} ${l.parent ?? ""}`.toLowerCase().includes(needle)).slice(0, 12)
        .map<Hit>((l) => ({ title: l.label, href: l.href, icon: l.icon, extra: l.parent, external: l.external })),
    ),
    has("members:read")
      ? fetchMembersWithStatus(q).then((l) => l
          .filter((m) => m.status !== "left" && m.status !== "deceased" && inScope(user.memberScope?.read, m.status))
          .sort((a, b) => a.lastName.localeCompare(b.lastName, "de") || a.firstName.localeCompare(b.firstName, "de"))
          .slice(0, LIMIT)
          .map<Hit>((m) => ({ title: `${m.firstName} ${m.lastName}`, href: `/members/${m.id}`, icon: "icon-[tabler--users]", extra: t(`status.${m.status}` as const) })))
      : [],
    has("inventory:read")
      ? db.select({ id: inventoryItems.id, name: inventoryItems.name, quantity: inventoryItems.quantity }).from(inventoryItems)
          .where(and(ilike(inventoryItems.name, like), isNull(inventoryItems.retiredAt))).orderBy(asc(inventoryItems.name)).limit(LIMIT)
          .then((rows) => rows.map<Hit>((i) => ({ title: i.name, href: `/inventory/${i.id}`, icon: "icon-[tabler--building-warehouse]", extra: i.quantity > 1 ? `${i.quantity}×` : undefined })))
      : [],
    // Kommende zuerst (aufsteigend), danach vergangene (absteigend).
    db.select({ id: events.id, title: events.title, startsAt: events.startsAt, cancelledAt: events.cancelledAt }).from(events)
      .where(and(ilike(events.title, like), gte(events.endsAt, from), visibilityCondition(user)))
      .orderBy(sql`(${events.endsAt} < ${today}) asc`, sql`case when ${events.endsAt} >= ${today} then ${events.startsAt} end asc`, desc(events.startsAt)).limit(LIMIT)
      .then((rows) => rows.map<Hit>((e) => ({ title: e.title, href: `/events/${e.id}`, icon: "icon-[tabler--calendar]", extra: formatDay(e.startsAt, tz), cancelled: Boolean(e.cancelledAt) }))),
  ]);

  const created = creates(needle);
  // Ohne Labeltreffer steht die Aktion als erster Eintrag in der Gruppe der gefundenen Kategorie.
  const withAction = (key: string, hits: Hit[]) => {
    const a = createLinks(user).find((l) => l.key === key);
    return a && hits.length > 0 && !created.some((h) => h.href === a.href) ? [toHit(a), ...hits] : hits;
  };
  const groups: Group[] = [
    createGroup(created),
    { label: t("search.group.menu"), hits: menu },
    { label: t("search.group.members"), hits: withAction("members", members) },
    { label: t("search.group.inventory"), hits: withAction("inventory", inventory) },
    { label: t("search.group.events"), hits: withAction("events", evs) },
  ].filter((g) => g.hits.length > 0);

  if (groups.length === 0) return c.html(<div class="px-3 py-2 text-sm opacity-60">{t("common.nav.noResults")}</div>);
  return c.html(renderGroups(groups));
});

function renderGroups(groups: Group[]) {
  let first = true;
  return (
    <>
      {groups.map((g) => (
        <div role="group" aria-label={g.label}>
          <div class="px-3 pt-2 pb-1 text-xs font-semibold uppercase opacity-60">{g.label}</div>
          {g.hits.map((h) => {
            const sel = first; first = false;
            return (
              <a href={h.href} role="option" data-gs-item aria-selected={sel ? "true" : "false"}
                class="flex items-center gap-2 px-3 py-1.5 hover:bg-base-300 aria-selected:bg-base-300"
                {...(h.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
                <Icon name={h.icon} class="h-5 w-5 shrink-0" />
                <span class={`flex-1 truncate ${h.cancelled ? "line-through" : ""}`}>{h.title}</span>
                {h.cancelled && <span class="badge badge-sm badge-error">{t("events.cancelled")}</span>}
                {h.extra && <span class="text-sm opacity-60">{h.extra}</span>}
                {h.external && <Icon name="icon-[tabler--external-link]" class="h-4 w-4 opacity-60" />}
              </a>
            );
          })}
        </div>
      ))}
    </>
  );
}
