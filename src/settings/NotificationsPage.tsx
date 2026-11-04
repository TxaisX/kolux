// Settings > Notifications (SET-034): which kinds of event may notify, the sound and its volume,
// a test button that shows a sample notification with that sound, and a link to the system's own
// notification settings (offered prominently when the system has notifications switched off).
// USAGE-009: the usage-alerts preference, on by default (shown in the same view).
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { AUDIO_TYPES, audioTypeAllowed, CLOSE_TO_TRAY_FIELD, CUSTOM_FIELD, KINDS, loadSound, preparePlan, readNotifications, SOUND_FIELD, SOUNDS, settledValue, SUPPRESS_FOCUSED_FIELD, VOLUME_FIELD, type Sound } from "./notifications";
import { ALERTS_FIELD, alertsOn } from "../usage/alerts";
import { useSettings } from "./useSettings";
import { useLeaveSave } from "./leave";
import { MASTER_FIELD, masterOn, testOutcome } from "../status/notifyMaster";

type Result = { shown: boolean; blocked: boolean };

export function NotificationsView({ settings, onSave }: { settings: Record<string, unknown>; onSave: (patch: Record<string, unknown>) => void }) {
  const n = readNotifications(settings);
  const [result, setResult] = useState<Result | { error: string } | null>(null);
  const openSystem = () => invoke("open_notification_settings").catch((e) => setResult({ error: String(e) }));
  // The volume saves when the slider is let go, not on every step of the drag.
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);
  const releaseVolume = () => {
    const v = settledValue(volumeDraft, n.volume);
    setVolumeDraft(null);
    if (v !== null) onSave({ [VOLUME_FIELD]: v });
  };
  useLeaveSave(releaseVolume); // leaving the page or closing the window with the slider moved saves it too (SET-036)
  const volume = volumeDraft ?? n.volume;
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  // APP-007: the close-to-tray switch shows only where closing can hide the window and a tray icon exists.
  const [closeSwitch, setCloseSwitch] = useState(false);
  useEffect(() => {
    invoke<boolean>("tray_close_switch_available").then(setCloseSwitch).catch(() => setCloseSwitch(false));
  }, []);
  const test = () => {
    void preparePlan(n).then(({ plan, play, close, problem }) => {
      setFileProblem(problem);
      return invoke<Result>("notification_test", { sound: plan.toastSound })
        .then((r) => {
          setResult(r);
          if (r.shown) play();
        })
        .catch((e) => {
          close();
          setResult({ error: String(e) });
        });
    });
  };
  // STAT-043: a custom sound must be an allowed audio type; the file is read once here so a bad one
  // is refused with a reason instead of being saved and failing silently later.
  const choose = async () => {
    const picked = await open({ multiple: false, directory: false, filters: [{ name: "Audio", extensions: [...AUDIO_TYPES] }] }).catch(() => null);
    if (typeof picked !== "string") return;
    if (!audioTypeAllowed(picked)) return setFileProblem(`That file is not an allowed sound type (${AUDIO_TYPES.join(", ")}).`);
    try {
      (await loadSound(picked, 1)).close();
    } catch (e) {
      return setFileProblem(`That file cannot be used as a sound: ${String(e)}`);
    }
    setFileProblem(null);
    onSave({ [CUSTOM_FIELD]: picked, [SOUND_FIELD]: "custom" });
  };
  const fileName = n.customFile?.split(/[\\/]/).pop() ?? null;
  // STAT-042 (T-124-b): the master switch greys out everything beneath it; a test the system did
  // not show offers Open Settings on Windows and macOS and says "not supported" elsewhere.
  const on = masterOn(settings);
  const outcome = result ? testOutcome(result, navigator.platform) : null;
  return (
    <>
      <section className="conn-card" data-section="master">
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={on} onChange={(e) => onSave({ [MASTER_FIELD]: e.target.checked })} />
          <span>
            Notifications
            <small>Off, Kolux raises no notifications and every choice below is kept as it is.</small>
          </span>
        </label>
      </section>
      <fieldset disabled={!on} data-section="beneath-master" style={{ border: 0, padding: 0, margin: 0, minWidth: 0, opacity: on ? 1 : 0.5 }}>
      <section className="conn-card" data-section="kinds">
        <h2 className="conn-name">What notifies you</h2>
        {KINDS.map((k) => (
          <label key={k.key} className="conn-switch">
            <input type="checkbox" role="switch" checked={n.kinds[k.key]} onChange={(e) => onSave({ [k.key]: e.target.checked })} />
            {k.label}
          </label>
        ))}
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={n.suppressFocused} onChange={(e) => onSave({ [SUPPRESS_FOCUSED_FIELD]: e.target.checked })} />
          <span>
            Stay quiet about the workspace you are looking at
            <small>While Kolux has focus, events in the workspace you are viewing are not announced; other workspaces still are.</small>
          </span>
        </label>
        {closeSwitch && (
          <label className="conn-switch">
            <input type="checkbox" role="switch" checked={n.closeToTray} onChange={(e) => onSave({ [CLOSE_TO_TRAY_FIELD]: e.target.checked })} />
            <span>
              Closing the window keeps Kolux in the tray
              <small>Windows only. The agents keep running; Quit from the tray icon stops everything.</small>
            </span>
          </label>
        )}
      </section>
      <section className="conn-card" data-section="sound">
        <h2 className="conn-name">Sound</h2>
        <div className="look-select">
          <span>Sound</span>
          <select aria-label="Notification sound" value={n.sound} onChange={(e) => onSave({ [SOUND_FIELD]: e.target.value as Sound })}>
            {SOUNDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        {n.sound === "custom" && (
          <div className="look-select">
            <span>Custom file</span>
            <span className="notif-volume">
              <output>{fileName ?? "No file chosen: the system sound plays"}</output>
              <button className="btn" onClick={() => void choose()}>
                Choose a sound file
              </button>
            </span>
          </div>
        )}
        {fileProblem && (
          <p className="conn-detail warn" role="alert">
            {fileProblem}
          </p>
        )}
        <div className="look-select">
          <span>Volume</span>
          <span className="notif-volume">
            <input type="range" min={0} max={100} step={5} aria-label="Volume" value={volume} onChange={(e) => setVolumeDraft(Number(e.target.value))} onPointerUp={releaseVolume} onPointerCancel={releaseVolume} onKeyUp={releaseVolume} onBlur={releaseVolume} />
            <output>{volume === 0 ? "Silent" : `${volume}%`}</output>
          </span>
        </div>
        <p className="conn-detail">The volume covers every sound Kolux plays. The system default sound plays at the system's own volume, and not at all at 0.</p>
        <div className="btn-row">
          <button className="btn" onClick={test}>
            Send a test notification
          </button>
          <button className="btn link" onClick={() => void openSystem()}>
            System notification settings
          </button>
        </div>
        {outcome?.kind === "failed" && (
          <p className="conn-detail warn" role="alert">
            {outcome.text}{" "}
            {outcome.openSettings && (
              <button className="btn link" onClick={() => void openSystem()}>
                Open Settings
              </button>
            )}
          </p>
        )}
        {result && "shown" in result && result.shown && (
          <p className="conn-detail" role="status">
            Test sent{n.volume === 0 ? " in silence" : ""}. If it did not appear, check System notification settings.
          </p>
        )}
      </section>
      <section className="conn-card" data-section="usage-alerts">
        <h2 className="conn-name">Usage alerts</h2>
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={alertsOn(settings)} onChange={(e) => onSave({ [ALERTS_FIELD]: e.target.checked })} />
          Tell me when an account reaches 80% and 95% of a usage window
        </label>
        <p className="conn-detail">Each alert comes once per window and again only after that window resets.</p>
      </section>
      </fieldset>
    </>
  );
}

export default function NotificationsPage() {
  const { settings, error, save } = useSettings();
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && <NotificationsView settings={settings} onSave={save} />}
    </>
  );
}
