// TERM-123 / HID-028 (T-817): the Experimental card on the General page. The rebuild has no Experimental
// page (SET-044), so its experimental switches sit on the pages they belong to; agent sleep gets this card
// because it touches every agent pane. Off on a fresh profile; the delay box saves a clamped whole number
// of minutes (5 to 240), the way the editor's auto-save delay does (DelayField).
import { useDraft } from "./useDraft";
import { IDLE, idleMinutes, minutesFromText, SLEEP_MINUTES_FIELD, SLEEP_ON_FIELD, sleepOn } from "../sleep/agentSleep";
import { t } from "../i18n/lookup";

function MinutesField({ value, onSave }: { value: number; onSave: (v: number) => Promise<boolean> }) {
  // Resolves to the stored text, so on leaving a clamped value shows as stored (typed "2", box shows "5").
  const { props, draft } = useDraft(
    String(value),
    async (text) => {
      const v = minutesFromText(text);
      if (v === null) return false;
      return v === value || (await onSave(v)) !== false ? String(v) : false;
    },
    (text) => String(minutesFromText(text)) === text,
  );
  const onBlur = async () => {
    await draft.leave();
    if (minutesFromText(draft.state().text) === null) draft.discard();
  };
  return <input className="field" type="number" aria-label={t("sleep.settings.minutes")} min={IDLE.min} max={IDLE.max} step={1} {...props} onBlur={onBlur} />;
}

export default function ExperimentalCard({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => Promise<boolean> }) {
  const on = sleepOn(settings);
  return (
    <section className="conn-card" data-section="experimental">
      <h2 className="conn-name">{t("sleep.settings.card")}</h2>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={on} onChange={(e) => void onSave({ [SLEEP_ON_FIELD]: e.target.checked })} /> {t("sleep.settings.switch")}
      </label>
      <p className="conn-detail">{t("sleep.settings.detail")}</p>
      <label className="look-select">
        <span>{t("sleep.settings.minutes")}</span>
        <MinutesField value={idleMinutes(settings)} onSave={(v) => onSave({ [SLEEP_MINUTES_FIELD]: v })} />
      </label>
    </section>
  );
}
