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
