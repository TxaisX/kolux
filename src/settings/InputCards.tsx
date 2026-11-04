// Settings > Terminal & sessions, the drawing and input controls of SET-022 / SET-025 (T-247-d) and the
// PowerShell version of SET-026. The values are read and corrected by terminal/inputPrefs.ts; panes follow a
// save at once (terminal/inputWire.ts). TerminalPage places the two cards.
import { useEffect, useState } from "react";
import { useLeaveSave } from "./leave";
import type { Platform } from "../keys/actions";
import { clampNumber } from "../terminal/text";
import { FULL_SCREEN_SCROLL, INPUT_FIELDS, osc52Save, readInput, shellCardShown, type Auto } from "../terminal/inputPrefs";
import { Segmented } from "./GeneralPage";

type Save = (patch: Record<string, unknown>) => void;
const AUTO_OPTIONS: Array<{ id: Auto; label: string }> = [
  { id: "auto", label: "Automatic" },
  { id: "on", label: "On" },
  { id: "off", label: "Off" },
];

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="conn-switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A typed number corrected on Enter or leaving the field. */
function Lines({ value, onSave }: { value: number; onSave: (n: number) => void }) {
  const [typed, setTyped] = useState(String(value));
  useEffect(() => setTyped(String(value)), [value]);
  const commit = () => {
    const n = clampNumber(typed, FULL_SCREEN_SCROLL.min, FULL_SCREEN_SCROLL.max, value);
    setTyped(String(n));
    if (n !== value) onSave(n);
  };
  useLeaveSave(() => typed !== String(value) && commit()); // SET-036: changing page or closing keeps what was typed
  return (
    <label className="num-field">
      <span>Full-screen scroll speed (lines per step)</span>
      <input type="number" min={FULL_SCREEN_SCROLL.min} max={FULL_SCREEN_SCROLL.max} value={typed} onChange={(e) => setTyped(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </label>
  );
}

/** SET-022 / SET-025: ligatures, GPU drawing, and the mouse, pointer and key rules. */
export function InputCard({ settings, platform, onSave }: { settings: Record<string, unknown>; platform: Platform; onSave: Save }) {
  const p = readInput(settings, platform);
  return (
    <section className="conn-card" data-section="input">
      <h2 className="conn-name">Drawing and input</h2>
      <div className="look-select">
        <span>Font ligatures</span>
        <Segmented label="Font ligatures" options={AUTO_OPTIONS} value={p.ligatures} onPick={(v) => onSave({ [INPUT_FIELDS.ligatures]: v })} />
      </div>
      <p className="conn-detail">Joins characters such as {"=> != <="} into one symbol in fonts that draw them. Automatic turns them on for fonts known to have them.</p>
      <div className="look-select">
        <span>GPU drawing</span>
        <Segmented label="GPU drawing" options={AUTO_OPTIONS} value={p.gpu} onPick={(v) => onSave({ [INPUT_FIELDS.gpu]: v })} />
      </div>
      <p className="conn-detail">Automatic uses the graphics chip when the computer has one that works, and plain drawing otherwise. Up to six terminals use it at a time; the rest draw the plain way. Open terminals keep how they were drawn until they are reopened.</p>
      <Switch label="Middle-click pastes (the selection, else the clipboard)" checked={p.middleClick} onChange={(on) => onSave({ [INPUT_FIELDS.middleClick]: on })} />
      <Switch label="Programs may copy to the clipboard (OSC 52)" checked={p.osc52} onChange={(on) => onSave(osc52Save(on))} />
      <p className="conn-detail">The Privacy setting for clipboard access by programs must be on as well.</p>
      <Switch label="Hide the pointer while typing" checked={p.hidePointer} onChange={(on) => onSave({ [INPUT_FIELDS.hidePointer]: on })} />
      <Switch label="Focus follows the mouse" checked={p.focusFollowsMouse} onChange={(on) => onSave({ [INPUT_FIELDS.focusFollowsMouse]: on })} />
      <Lines value={p.fullScreenScroll} onSave={(n) => onSave({ [INPUT_FIELDS.fullScreenScroll]: n })} />
      {platform === "darwin" && (
        <>
          <div className="look-select">
            <span>Option key acts as Alt</span>
            <Segmented label="Option key acts as Alt" options={AUTO_OPTIONS} value={p.optionAsAlt} onPick={(v) => onSave({ [INPUT_FIELDS.optionAsAlt]: v })} />
          </div>
          <p className="conn-detail">Automatic keeps Option typing its characters on layouts that need them, and makes it Alt otherwise.</p>
        </>
      )}
      <Switch label="Yen key types a backslash" checked={p.yenBackslash} onChange={(on) => onSave({ [INPUT_FIELDS.yenBackslash]: on })} />
    </section>
  );
}

/** SET-026: which PowerShell the PowerShell default opens; the card is for Windows only. */
export function PowerShellCard({ settings, platform, onSave }: { settings: Record<string, unknown>; platform: Platform; onSave: Save }) {
  if (!shellCardShown(platform)) return null;
  const p = readInput(settings, platform);
  return (
    <section className="conn-card" data-section="powershell">
      <h2 className="conn-name">PowerShell version</h2>
      <Segmented
        label="PowerShell version"
        options={[
          { id: "auto", label: "Automatic" },
          { id: "7", label: "PowerShell 7" },
          { id: "5", label: "Windows PowerShell 5" },
        ]}
        value={p.powershell}
        onPick={(v) => onSave({ [INPUT_FIELDS.powershell]: v })}
      />
      <p className="conn-detail">Automatic uses PowerShell 7 when it is installed. If the one you pick is not installed, the other opens instead.</p>
    </section>
  );
}
