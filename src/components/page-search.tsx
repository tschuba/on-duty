// Seitensuche ohne sichtbares Feld: Die Navbar-Suche (global-search.tsx) füllt dieses Feld über den Eintrag
// „Auf dieser Seite suchen“. Standard: GET-Formular mit Reload, `hidden` trägt Sortierung, Filter und View mit.
// `client`: kein Formular, das Navbar-Skript löst nur ein `input`-Event aus; die Seite filtert selbst (oninput/Listener).
// `chip`: zusätzliche Einschränkung ohne Eingabe (z. B. ein Gegenstand); die Navbar zeigt sie als Plakette, ✕ folgt `href` (Ziel ohne die Einschränkung).
export function PageSearch({ name = "search", label, value = "", action, hidden = [], client, id, oninput, chip }: {
  name?: string; label: string; value?: string; action?: string; hidden?: [string, string][]; client?: boolean; id?: string; oninput?: string; chip?: { label: string; href: string };
}) {
  return (
    <>
      {chip && <a data-page-chip href={chip.href} hidden>{chip.label}</a>}
      {client
        ? <input type="search" id={id} value={value} oninput={oninput} data-page-search data-client data-label={label} hidden />
        : (
          <form method="get" action={action} hidden>
            {hidden.map(([k, v]) => <input type="hidden" name={k} value={v} />)}
            <input type="search" name={name} value={value} data-page-search data-label={label} />
          </form>
        )}
    </>
  );
}
