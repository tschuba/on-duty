import { Icon } from "./icon.js";
import type { IconName } from "./icons.generated.js";

// Namensgebundenes Styling der mitgelieferten Vorlagen-Tags (Schlüssel kleingeschrieben); alle anderen Tags sind neutral.
// success/warning/error bleiben dem Prüfstatus vorbehalten (docs/style-guide.md, Abschnitt Badges).
export const TAG_STYLES: Record<string, { icon: IconName; badge: string; avatar: string }> = {
  fahrzeug: { icon: "firetruck", badge: "badge-primary", avatar: "bg-primary text-primary-content" },
  atemschutz: { icon: "scuba-diving-tank", badge: "badge-info", avatar: "bg-info text-info-content" },
  gerät: { icon: "axe", badge: "badge-secondary", avatar: "bg-secondary text-secondary-content" },
  psa: { icon: "jacket", badge: "badge-accent", avatar: "bg-accent text-accent-content" },
  sonstiges: { icon: "squares-2x2", badge: "badge-neutral", avatar: "bg-neutral text-neutral-content" },
  hydrant: { icon: "fire-hydrant", badge: "badge-secondary badge-outline", avatar: "border border-secondary text-secondary" },
};

// Alle Tags als Badge, Tags mit eigenem Stil zuerst (stabil); das Icon trägt der erste von ihnen.
export function TagBadges({ tags }: { tags: string[] }) {
  const styled = (tag: string) => Boolean(TAG_STYLES[tag.toLowerCase()]);
  const sorted = [...tags.filter(styled), ...tags.filter((tag) => !styled(tag))];
  return (
    <>
      {sorted.map((tag, i) => {
        const style = TAG_STYLES[tag.toLowerCase()];
        return (
          <span class={`badge badge-sm ${style?.badge ?? "badge-ghost"}${i === 0 && style ? " gap-1" : ""}`}>
            {i === 0 && style && <Icon name={style.icon} class="size-3.5" />}
            {tag}
          </span>
        );
      })}
    </>
  );
}

// Runder Avatar mit Icon; Farbe und Icon folgen TAG_STYLES, ohne Eintrag dezent neutral (Auswahl-Cards).
export function TagAvatar({ tag, fallbackIcon = "squares-2x2" }: { tag?: string; fallbackIcon?: IconName }) {
  const style = tag ? TAG_STYLES[tag.toLowerCase()] : undefined;
  return (
    <div class="avatar avatar-placeholder shrink-0">
      <div class={`size-10 sm:size-12 lg:size-14 rounded-full ${style?.avatar ?? "bg-base-200 text-base-content/50"}`}>
        <Icon name={style?.icon ?? fallbackIcon} class="size-5 sm:size-6 lg:size-7" />
      </div>
    </div>
  );
}
