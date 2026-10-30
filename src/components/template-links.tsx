import { Fragment } from "hono/jsx";

// Verwendungsnachweis „Verwendet in Artikelvorlagen": Namen als Links auf die Detailseite, leer → null (ViewField zeigt „—").
export function TemplateLinks({ templates }: { templates: { id: string; name: string }[] }) {
  if (templates.length === 0) return null;
  return (
    <>
      {templates.map((tpl, i) => (
        <Fragment>{i > 0 && ", "}<a class="link" href={`/inventory/templates/${tpl.id}`}>{tpl.name}</a></Fragment>
      ))}
    </>
  );
}
