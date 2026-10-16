import { Icon } from "./icon.js";
import { t } from "../i18n/index.js";

// "Ist Mitglied"-Markierung (nur Icon). Navigation läuft über MemberLink am Namen.
export function MemberMark({ memberId, class: size = "w-4 h-4" }: { memberId: string | null | undefined; canLink?: boolean; class?: string }) {
  if (!memberId) return null;
  return <span class="inline-block align-middle ml-1 p-1 opacity-70" title={t("common.member")} role="img" aria-label={t("common.member")}><Icon name="users" class={`inline-block ${size} align-middle`} /></span>;
}

// Name als Link auf die Mitgliederseite, nur mit members:read.
// stopPropagation: Klick soll nicht die Zeilennavigation (onclick am <tr>) auslösen.
export function MemberLink({ memberId, canLink, children }: { memberId: string | null | undefined; canLink: boolean; children?: any }) {
  return memberId && canLink ? <a href={`/members/${memberId}`} class="link link-hover" onclick="event.stopPropagation()">{children}</a> : <>{children}</>;
}

export function MemberFilter({ value, options, href }: {
  value: string;
  options: { value: string; label: string }[];
  href: (value: string) => string;
}) {
  return (
    <div class="join">
      {options.map((o) => (
        <a key={o.value} href={href(o.value)} class={`join-item btn${o.value === value ? " btn-outline btn-primary" : ""}`}>{o.label}</a>
      ))}
    </div>
  );
}
