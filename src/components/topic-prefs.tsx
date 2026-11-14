import { t } from "../i18n/index.js";

// Schalter für freie Themen (Backlog 156); `value` ist der Wert, der beim Anhaken abgeschickt wird.
export function TopicPrefs({ name, prefs, inputValue = (topic: string) => topic, onchange }: { name: string; prefs: { topic: string; enabled: boolean }[]; inputValue?: (topic: string) => string; onchange?: string }) {
  return (
    <>
      {prefs.map((p) => (
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" name={name} value={inputValue(p.topic)} class="checkbox" checked={p.enabled} onchange={onchange} />
          <span>{t("mail.prefs.topic", { topic: p.topic })}</span>
        </label>
      ))}
    </>
  );
}
