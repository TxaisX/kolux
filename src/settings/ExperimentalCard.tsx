// TERM-123 / HID-028 (T-817): the Experimental card on the General page. The rebuild has no Experimental
// page (SET-044), so its experimental switches sit on the pages they belong to; agent sleep gets this card
// because it touches every agent pane. On on a fresh profile (Txais 2026-11-10: "Default on"), off once saved off; the delay box saves a clamped whole number
// of minutes (5 to 240), the way the editor's auto-save delay does (DelayField).
import { IDLE, idleMinutes, minutesFromText, SLEEP_MINUTES_FIELD, SLEEP_ON_FIELD, sleepOn } from "../sleep/agentSleep";
import { t } from "../i18n/lookup";
import { NumberDraftField } from "./NumberDraftField";

function MinutesField({ value, onSave }: { value: number; onSave: (v: number) => Promise<boolean> }) {
  return <NumberDraftField value={value} parse={minutesFromText} onSave={onSave} label={t("sleep.settings.minutes")} min={IDLE.min} max={IDLE.max} step={1} />;
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
