import { Icon } from "./icon.js";

// Hilfe-Icon hinter dem Seitentitel (Style-Guide: gleiche Position auf allen Funktionsseiten).
export function HelpLink({ href, label }: { href: string; label: string }) {
  return <a href={href} class="shrink-0 btn btn-ghost btn-circle btn-sm ml-2 align-middle opacity-60 hover:opacity-100 @2xl:@max-[890px]:ml-4 @2xl:@max-[890px]:border @2xl:@max-[890px]:border-info/50 @2xl:@max-[890px]:text-info @2xl:@max-[890px]:opacity-100" aria-label={label} title={label}><Icon name="icon-[tabler--help]" class="h-5 w-5" /></a>;
}
