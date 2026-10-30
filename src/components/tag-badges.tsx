import { Icon } from "./icon.js";
import type { IconName } from "./icons.generated.js";

// Namensgebundenes Styling der mitgelieferten Vorlagen-Tags (Schlüssel kleingeschrieben); alle anderen Tags sind neutral.
// success/warning/error bleiben dem Prüfstatus vorbehalten (docs/style-guide.md, Abschnitt Badges).
export const TAG_STYLES: Record<string, { icon: IconName; badge: string }> = {
  fahrzeug: { icon: "firetruck", badge: "badge-primary" },
  atemschutz: { icon: "scuba-diving-tank", badge: "badge-info" },
  gerät: { icon: "axe", badge: "badge-secondary" },
  psa: { icon: "jacket", badge: "badge-accent" },
  sonstiges: { icon: "squares-2x2", badge: "badge-neutral" },
  hydrant: { icon: "fire-hydrant", badge: "badge-secondary badge-outline" },
};

// Alle Tags als Badge; das Icon trägt nur der erste Tag mit eigenem Stil.
export function TagBadges({ tags }: { tags: string[] }) {
  const iconTag = tags.find((tag) => TAG_STYLES[tag.toLowerCase()]);
  return (
    <>
      {tags.map((tag) => {
        const style = TAG_STYLES[tag.toLowerCase()];
        return (
          <span class={`badge badge-sm ${style?.badge ?? "badge-ghost"}${tag === iconTag ? " gap-1" : ""}`}>
            {tag === iconTag && style && <Icon name={style.icon} class="size-3.5" />}
            {tag}
          </span>
        );
      })}
    </>
  );
}
