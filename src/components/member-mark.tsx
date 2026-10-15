import { Icon } from "./icon.js";
import { t } from "../i18n/index.js";

// "Ist Mitglied"-Markierung; Link auf die Mitgliederseite nur mit members:read.
// stopPropagation: Klick soll nicht die Zeilennavigation (onclick am <tr>) auslösen.
export function MemberMark({ memberId, canLink, class: size = "w-4 h-4" }: { memberId: string | null | undefined; canLink: boolean; class?: string }) {
  if (!memberId) return null;
  const cls = `inline-block ${size} align-middle ml-2`;
  return canLink ? (
    <a href={`/members/${memberId}`} title={t("common.member")} aria-label={t("common.member")} onclick="event.stopPropagation()">
      <Icon name="users" class={cls} />
    </a>
  ) : (
    <span title={t("common.member")} role="img" aria-label={t("common.member")}><Icon name="users" class={cls} /></span>
  );
}

// Exklusive Dreier-Auswahl (Alle / A / B) als verbundene Links.
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
