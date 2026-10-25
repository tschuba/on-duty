export type ToggleItem = { label: string; checked: boolean; disabled?: boolean; href: string };

/** Two toggles over one value: "" = both on, otherwise the single active value. Switching off the last one switches on the other. */
export function pairToggles(
  value: string,
  [a, b]: [{ value: string; label: string }, { value: string; label: string }],
  href: (value: string) => string,
): ToggleItem[] {
  const on = { [a.value]: !value || value === a.value, [b.value]: !value || value === b.value };
  const item = (x: typeof a, other: typeof a): ToggleItem => ({
    label: x.label,
    checked: on[x.value],
    href: href(on[x.value] ? other.value : on[other.value] ? "" : x.value),
  });
  return [item(a, b), item(b, a)];
}

export function ToggleFilter({ items }: { items: ToggleItem[] }) {
  return (
    <>
      {items.map((i) => (
        <label key={i.label} class="flex items-center gap-2 min-h-11 cursor-pointer">
          <input type="checkbox" class="toggle toggle-primary" checked={i.checked} disabled={i.disabled} data-href={i.href} />
          <span class="text-sm">{i.label}</span>
        </label>
      ))}
      <script dangerouslySetInnerHTML={{ __html: "document.addEventListener('change',function(e){var h=e.target.dataset&&e.target.dataset.href;if(h)location.href=h;});" }} />
    </>
  );
}
