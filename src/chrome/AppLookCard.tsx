// T-301 (APP-012, SET-041; SET-016: the app icon chooser sits at the bottom of Settings > Appearance,
// after Window & Sidebar). A pick is saved, then the window takes it at once (app_look_apply).
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../settings/useSettings";
import { APP_ICONS, appIcon, applyWindowBlur, BLUR_FIELD, blurOn, ICON_FIELD } from "./appLook";

export default function AppLookCard() {
  const { settings, error, save } = useSettings();
  const [failed, setFailed] = useState<string | null>(null);
  if (!settings) return null;
  const pick = (patch: Record<string, unknown>) => {
    applyWindowBlur({ ...settings, ...patch });
    setFailed(null);
    void save(patch).then(() => invoke("app_look_apply").catch((e) => setFailed(`The window could not take the new look: ${e}`)));
  };
  const icon = appIcon(settings);
  return (
    <section className="conn-card" data-section="app-icon">
      <h2 className="conn-name">App icon</h2>
      <div className="app-icon-picks" role="radiogroup" aria-label="App icon">
        {APP_ICONS.map((i) => (
          <label key={i.id} className={icon === i.id ? "app-icon-pick on" : "app-icon-pick"}>
            <input type="radio" name="app-icon" checked={icon === i.id} onChange={() => pick({ [ICON_FIELD]: i.id })} />
            <span className={`app-icon-swatch ${i.id}`} aria-hidden="true" />
            {i.label}
          </label>
        ))}
      </div>
      <p className="conn-detail">The taskbar icon changes right away.</p>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={blurOn(settings)} onChange={(e) => pick({ [BLUR_FIELD]: e.target.checked })} />
        <span>
          Blur the window background
          <small>Shows a blurred view of what is behind the window where the page has no colour of its own. Windows 10 and 11.</small>
        </span>
      </label>
      {(error ?? failed) && <p className="conn-detail warn">{error ?? failed}</p>}
    </section>
  );
}
