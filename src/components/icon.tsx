// Tabler icon via @iconify/tailwind4. Pass a complete literal class (`icon-[tabler--trash]`), never an interpolated one, or Tailwind will not generate it.
export type IconName = `icon-[tabler--${string}]`;

export function Icon({ name, class: className }: { name: IconName; class?: string }) {
  return <span class={`${name} ${className ?? ""}`} aria-hidden="true" />;
}
