// Settings > Notifications: the quiet-alert minutes (STAT-045, 10 by default, 0 off). The kinds'
// switches (STAT-041, STAT-023) are KINDS in notifications.ts. A plain settings key; the importer
// task carries the old app's saved choice into it.
import { useSettings } from "./useSettings";
import { useDraft } from "./useDraft";
import { quietFromText } from "./notifications";
import { masterOn, quietMinutes } from "../status/notifyMaster";

export const QUIET_FIELD = "quietMinutes";

export default function Notifications() {
  const { settings, save } = useSettings();
  // STAT-042 (T-124-b): a missing threshold reads as 10; greyed out with the master switch off.
  const minutes = quietMinutes(settings ?? {}, QUIET_FIELD);
  // The minutes save after a pause or on leaving the box (SET-036), not on every keystroke. The pause
  // saves only a whole number as typed: an emptied box (about to be retyped) is not turned into 0, which
  // would switch the alert off. Leaving the box saves what is there and shows what was stored: "12.9" as 12, "" as 0.
  const { props } = useDraft(
    String(minutes),
    async (text) => {
      const v = quietFromText(text);
      return v === minutes || (await save({ [QUIET_FIELD]: v })) !== false ? String(v) : false;
    },
    (text) => String(quietFromText(text)) === text,
  );
  if (!settings) return null;
  const on = masterOn(settings);
  return (
    <section className="conn-card" aria-label="Notifications">
      <label className="conn-switch">
        <input type="number" disabled={!on} min={0} max={600} step={1} aria-label="Quiet alert minutes" {...props} />
        <span>
          Quiet alert after this many minutes
          <small>One notification when a working agent prints nothing for that long. 0 turns it off.</small>
        </span>
      </label>
    </section>
  );
}
