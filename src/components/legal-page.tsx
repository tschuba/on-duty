import type { Child } from "hono/jsx";
import { Layout } from "./layout.js";
import { PageHeader } from "./page-header.js";
import { t } from "../i18n/index.js";
import { isImpressumComplete, loadOrgConfig, privacyMode } from "../lib/org-config.js";

const clean = (...p: (string | undefined)[]) => p.map((x) => x?.trim()).filter(Boolean).join(" ");

// Name + Anschrift der Organisation, wie im Impressum und in der Datenschutzerklärung.
export function OrgAddress({ cfg }: { cfg: Record<string, string> }) {
  const lines = [cfg.orgName, clean(cfg.orgStreet, cfg.orgHouseNumber), clean(cfg.orgZip, cfg.orgCity)].map((x) => x?.trim()).filter(Boolean);
  return <address class="not-italic">{lines.map((l, i) => <div class={i === 0 ? "font-semibold" : ""}>{l}</div>)}</address>;
}

// E-Mail und Telefon als klickbare Links.
export function OrgContact({ cfg }: { cfg: Record<string, string> }) {
  const email = cfg.orgContactEmail?.trim();
  const phone = cfg.orgContactPhone?.trim();
  return (
    <div class="flex flex-col">
      {email && <a class="link" href={`mailto:${email}`}>{email}</a>}
      {phone && <a class="link" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a>}
    </div>
  );
}

// Beschriftete Angabe innerhalb einer LegalPage.
export function LegalSection({ label, children }: { label: string; children: Child }) {
  return <section><h2 class="text-xs font-semibold uppercase tracking-wide opacity-60 mb-1">{label}</h2>{children}</section>;
}

// Gemeinsamer Rahmen für Impressum und Datenschutzerklärung; verlinkt im Fuß die jeweils andere Seite, wenn sie existiert.
export async function LegalPage({ title, current, children }: { title: string; current: "impressum" | "privacy"; children: Child }) {
  const cfg = await loadOrgConfig();
  const other = current === "impressum"
    ? (privacyMode(cfg) === "text" && cfg.orgPrivacyText?.trim() ? { href: "/datenschutz", label: t("privacy.title") } : undefined)
    : (isImpressumComplete(cfg) ? { href: "/impressum", label: t("impressum.title") } : undefined);
  return (
    <Layout title={title}>
      <div class="max-w-2xl mx-auto">
        <PageHeader title={title} />
        <div class="rounded-box border border-base-300 bg-base-100 p-6 flex flex-col gap-6">{children}</div>
        {other && <p class="mt-4 text-sm text-center"><a class="link" href={other.href}>{other.label}</a></p>}
      </div>
    </Layout>
  );
}
