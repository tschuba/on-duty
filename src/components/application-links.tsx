import { Field } from "./field.js";
import { ImpressumHint } from "./impressum-hint.js";
import { Icon } from "./icon.js";
import { env } from "../env.js";
import { t } from "../i18n/index.js";
import { isFormCurrentlyActive, type ApplicationForm } from "../lib/application-forms.js";

export const TYPE_LABELS = {
  membership: t("applications.type.membership"),
  youth: t("applications.type.youth"),
} as const;

// Describes the *configured rule* in plain text (e.g. "Aktiv bis 01.09.2026"),
// independent of the "active" flag below which reflects whether that rule
// currently resolves to active — see isFormCurrentlyActive's window semantics.
export function formatFormStatusText(form: ApplicationForm | undefined): { text: string; active: boolean } {
  const active = isFormCurrentlyActive(form);
  if (!form) return { text: t("applications.formStatus.inactive"), active };
  const fmt = (d: string) => new Date(d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const { isActive, startDate, endDate } = form;
  if (!startDate && !endDate) {
    return { text: t(isActive ? "applications.formStatus.active" : "applications.formStatus.inactive"), active };
  }
  if (startDate && !endDate) {
    return { text: t(isActive ? "applications.formStatus.activeFrom" : "applications.formStatus.inactiveFrom", { date: fmt(startDate) }), active };
  }
  if (!startDate && endDate) {
    return { text: t(isActive ? "applications.formStatus.activeUntil" : "applications.formStatus.inactiveUntil", { date: fmt(endDate) }), active };
  }
  return { text: t(isActive ? "applications.formStatus.activeRange" : "applications.formStatus.inactiveRange", { start: fmt(startDate!), end: fmt(endDate!) }), active };
}


type Forms = Partial<Record<"membership" | "youth", ApplicationForm | undefined>>;

// Links zu den öffentlichen Antragsformularen (Dropdown) – gezeigt in der Mitgliederliste.
export function ApplicationLinks({ forms, canManageForms }: { forms: Forms; canManageForms: boolean }) {
  return (
        <div class="dropdown dropdown-end" onfocusin={`
          const c = this.querySelector('.dropdown-content');
          c.style.translate = '';
          const b = c.getBoundingClientRect(), vw = document.documentElement.clientWidth, m = 8;
          const dx = Math.max(m - b.left, Math.min(0, vw - m - b.right));
          if (dx) c.style.translate = dx + 'px';
        `}>
          <div
            tabindex={0}
            role="button"
            class="btn btn-ghost gap-2"
            aria-label={`${t("applications.links.title")}: ${(["membership", "youth"] as const).map((type) => `${TYPE_LABELS[type]}: ${formatFormStatusText(forms[type]).text}`).join(", ")}`}
          >
            <Icon name="icon-[tabler--link]" class="h-5 w-5" />
            <span class="@max-4xl:hidden">{t("applications.links.title")}</span>
            <span class="flex items-center gap-2 border-l border-base-content/20 pl-2">
              {(["membership", "youth"] as const).map((type) => {
                const status = formatFormStatusText(forms[type]);
                return (
                  <span key={type} class={`flex items-center gap-1 ${status.active ? "text-success" : "text-error opacity-40"}`} title={`${TYPE_LABELS[type]}: ${status.text}`}>
                    <Icon name={type === "membership" ? "icon-[tabler--users-plus]" : "icon-[tabler--mood-boy]"} class="h-5 w-5" />
                  </span>
                );
              })}
            </span>
          </div>
          <ul tabindex={0} class="dropdown-content bg-base-200 rounded-box z-50 w-72 max-w-[calc(100vw-1rem)] p-2 shadow">
            {(["membership", "youth"] as const).map((type) => {
              const url = new URL(type === "membership" ? "/apply" : "/apply/youth", env.OIDC_APP_URL).toString();
              const status = formatFormStatusText(forms[type]);
              return (
                <li key={type} class="px-2 py-2 border-b border-base-content/15 last:border-b-0">
                  <div class="flex items-center gap-2 text-sm">
                    <span class={`inline-block h-2 w-2 shrink-0 rounded-full ${status.active ? "bg-success" : "bg-error"}`} />
                    <span class="font-semibold">{TYPE_LABELS[type]}</span>
                    <span class="text-xs opacity-60 truncate">{status.text}</span>
                  </div>
                  <div class="join w-full mt-2">
                    <button type="button" class="btn join-item flex-1 h-11 apply-link-copy" data-url={url} title={t("applications.links.copy")} aria-label={t("applications.links.copy")}>
                      <Icon name="icon-[tabler--clipboard]" class="h-5 w-5" />
                    </button>
                    <a href={url} target="_blank" rel="noopener" class="btn join-item flex-1 h-11" title={t("applications.links.open")} aria-label={t("applications.links.open")} onclick="document.activeElement.blur()">
                      <Icon name="icon-[tabler--external-link]" class="h-5 w-5" />
                    </a>
                    {canManageForms && (
                      <button
                        type="button"
                        class="btn join-item flex-1 h-11"
                        title={t("applications.links.settings")}
                        aria-label={t("applications.links.settings")}
                        onclick={`document.getElementById('form-settings-${type}').showModal();document.activeElement.blur()`}
                      >
                        <Icon name="icon-[tabler--settings]" class="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
  );
}

export function ApplicationFormSettings({ forms }: { forms: Forms }) {
  return (
    <>
      {(["membership", "youth"] as const).map((type) => {
        const form = forms[type];
        return (
          <dialog id={`form-settings-${type}`} class="modal" key={`form-settings-${type}`}>
            <div class="modal-box">
              <h3 class="font-bold text-lg mb-4">{t("applications.formSettings.title", { type: TYPE_LABELS[type] })}</h3>
              <form method="post" action={`/applications/forms/${type}`} class="space-y-4 form-settings-form">
                <label class="label cursor-pointer justify-start gap-3">
                  <input type="checkbox" name="status" value="active" class="toggle border-2 border-base-content/50 text-base-content/60 hover:border-base-content checked:border-success checked:bg-success checked:text-success-content" checked={form?.isActive === true} />
                  <span class="text-sm">{t("applications.formSettings.active")}</span>
                </label>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label={t("applications.formSettings.startDate")} class="form-start">
                    <input type="date" name="startDate" value={form?.startDate ?? ""} class="input w-full" />
                  </Field>
                  <Field label={t("applications.formSettings.endDate")} class="form-end">
                    <input type="date" name="endDate" value={form?.endDate ?? ""} class="input w-full" />
                  </Field>
                </div>
                <p class="text-sm form-status-preview"></p>
                <p class="text-xs opacity-60">{t("applications.formSettings.dateHint")}</p>
                <ImpressumHint />
                <div class="modal-action">
                  <button type="button" class="btn" onclick="this.closest('dialog').close()">{t("common.cancel")}</button>
                  <button type="submit" class="btn btn-primary">{t("applications.formSettings.save")}</button>
                </div>
              </form>
            </div>
            <form method="dialog" class="modal-backdrop">
              <button>{t("common.close")}</button>
            </form>
          </dialog>
        );
      })}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          document.querySelectorAll('.apply-link-copy').forEach(function(btn) {
            btn.addEventListener('click', function() {
              navigator.clipboard.writeText(btn.dataset.url).then(function() {
                document.body.dispatchEvent(new CustomEvent('showToast', { detail: { message: ${JSON.stringify(t("applications.links.copied"))}, type: 'info' } }));
              });
            });
          });

          var labels = {
            active: { start: ${JSON.stringify(t("applications.formSettings.startDate"))}, end: ${JSON.stringify(t("applications.formSettings.endDate"))} },
            inactive: { start: ${JSON.stringify(t("applications.formSettings.inactiveStartDate"))}, end: ${JSON.stringify(t("applications.formSettings.inactiveEndDate"))} },
          };
          var statusText = {
            active: ${JSON.stringify(t("applications.formStatus.active"))},
            inactive: ${JSON.stringify(t("applications.formStatus.inactive"))},
            activeFrom: ${JSON.stringify(t("applications.formStatus.activeFrom"))},
            activeUntil: ${JSON.stringify(t("applications.formStatus.activeUntil"))},
            activeRange: ${JSON.stringify(t("applications.formStatus.activeRange"))},
            inactiveFrom: ${JSON.stringify(t("applications.formStatus.inactiveFrom"))},
            inactiveUntil: ${JSON.stringify(t("applications.formStatus.inactiveUntil"))},
            inactiveRange: ${JSON.stringify(t("applications.formStatus.inactiveRange"))},
          };
          function fmt(iso) {
            var p = iso.split('-');
            return p[2] + '.' + p[1] + '.' + p[0];
          }
          document.querySelectorAll('.form-settings-form').forEach(function(form) {
            var startInput = form.querySelector('input[name="startDate"]');
            var endInput = form.querySelector('input[name="endDate"]');
            var startLabel = form.querySelector('.form-start label > span');
            var endLabel = form.querySelector('.form-end label > span');
            var preview = form.querySelector('.form-status-preview');
            function update() {
              var mode = form.querySelector('input[name="status"]').checked ? 'active' : 'inactive';
              startLabel.textContent = labels[mode].start;
              endLabel.textContent = labels[mode].end;
              var start = startInput.value, end = endInput.value;
              if (!start && !end) preview.textContent = statusText[mode];
              else if (start && !end) preview.textContent = statusText[mode + 'From'].replace('{date}', fmt(start));
              else if (!start && end) preview.textContent = statusText[mode + 'Until'].replace('{date}', fmt(end));
              else preview.textContent = statusText[mode + 'Range'].replace('{start}', fmt(start)).replace('{end}', fmt(end));
            }
            form.querySelector('input[name="status"]').addEventListener('change', update);
            startInput.addEventListener('input', update);
            endInput.addEventListener('input', update);
            form.closest('dialog').addEventListener('close', function() { form.reset(); update(); });
            update();
          });
        })();
      ` }} />
    </>
  );
}
