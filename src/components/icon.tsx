import { ICONS, type IconName } from "./icons.generated.js";

export function Icon({ name, class: className }: { name: IconName; class?: string }) {
  const icon = ICONS[name];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" class={className} viewBox={icon.viewBox} fill={icon.fill} stroke={icon.stroke} stroke-width={icon.strokeWidth} aria-hidden="true">
      {icon.paths.map((p) => (
        <path stroke-linecap="round" stroke-linejoin="round" fill-rule={p.fillRule} clip-rule={p.clipRule} d={p.d} />
      ))}
    </svg>
  );
}
