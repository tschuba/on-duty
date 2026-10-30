import { HeaderAction } from "./page-header.js";
import { RowAction } from "./row-action.js";
import { t } from "../i18n/index.js";

// Löschen mit Bestätigungsdialog: Trigger `btn-outline btn-error`, ausführender Button solid. `header`: Trigger im Seitenkopf statt in einer Tabellenzeile.
export function DeleteDialog({ id, action, title, body, header }: { id: string; action: string; title: string; body: string; header?: boolean }) {
  const open = `event.stopPropagation(); document.getElementById('delete-${id}').showModal()`;
  return (
    <>
      {header
        ? <HeaderAction icon="trash" label={t("common.delete")} class="btn-outline btn-error" onclick={open} />
        : <RowAction icon="trash" label={t("common.delete")} class="btn-outline btn-error" onclick={open} />}
      <dialog id={`delete-${id}`} class="modal">
        <div class="modal-box">
          <h3 class="font-bold text-lg">{title}</h3>
          <p class="py-2 opacity-70">{body}</p>
          <div class="modal-action">
            <form method="dialog">
              <button class="btn">{t("common.cancel")}</button>
            </form>
            <form method="post" action={action}>
              <button type="submit" class="btn btn-error">{t("common.delete")}</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>{t("common.close")}</button>
        </form>
      </dialog>
    </>
  );
}
