// DT-C249: Settings > Appearance > Finish. Glass and metal (the look a first start draws) turns the panels
// see-through over a still stage of light in a colour of the user's choice; Flat is the solid look Kolux
// had before it. AppearancePage draws the card around this body (it holds the data-section the settings
// search checks against its page).
import { Segmented } from "../settings/GeneralPage";
import { SPAN, type Appearance } from "../theme";
import type { Finish } from "./glass";

export const FINISH_LABEL: Record<Finish, string> = { flat: "Flat", glass: "Glass and metal" };
const NOTE: Record<Finish, string> = {
  flat: "Solid panels, with no light behind them.",
  glass: "Panels are see-through over soft light in the metal's colour, and their edges catch it. Terminals and editors keep a solid ground, and dim text is brightened where it needs it so everything stays readable.",
};
/** The metals offered as one-click choices; any other colour comes from the picker beside them. */
export const METALS = [
  ["Steel", "#8fa3bf"],
  ["Silver", "#c3c8d0"],
  ["Graphite", "#70757d"],
  ["Gold", "#d4a94a"],
  ["Copper", "#c87f5a"],
  ["Rose gold", "#d99aa5"],
  ["Emerald", "#4fb58a"],
  ["Sapphire", "#4f7fe0"],
  ["Amethyst", "#9a7be0"],
] as const;
export const metalName = (hex: string) => METALS.find(([, h]) => h === hex.toLowerCase())?.[0] ?? "Your own colour";

/** The inside of the Finish card: two choices; Glass and metal adds the metal, its colour and a strength. Changes show at once. */
export function FinishBody({ look, onChange }: { look: Appearance; onChange: (a: Appearance) => void }) {
  return (
    <>
      <h2 className="conn-name">Finish</h2>
      <div className="look-select">
        <span>Panels</span>
        <Segmented<Finish> label="Finish" options={(["glass", "flat"] as const).map((f) => ({ id: f, label: FINISH_LABEL[f] }))} value={look.finish} onPick={(finish) => onChange({ ...look, finish })} />
      </div>
      <p className="conn-detail">{NOTE[look.finish]}</p>
      {look.finish === "glass" && (
        <>
          <div className="look-swatches" role="radiogroup" aria-label="Metal">
            {METALS.map(([name, hex]) => (
              <button key={hex} role="radio" aria-checked={look.finishTint === hex} title={name} aria-label={`${name} metal`} className={look.finishTint === hex ? "look-swatch on" : "look-swatch"} style={{ background: hex }} onClick={() => onChange({ ...look, finishTint: hex })} />
            ))}
            <div className="look-name">{metalName(look.finishTint)}</div>
          </div>
          <div className="look-select pane-colour">
            <span>Metal colour</span>
            <input type="color" aria-label="Metal colour" value={look.finishTint} onChange={(e) => onChange({ ...look, finishTint: e.target.value })} />
            <span className="conn-detail">{look.finishTint}</span>
          </div>
          <label className="look-slider">
            <span>Strength</span>
            <input type="range" aria-label="Finish strength" min={SPAN.finishStrength[0]} max={SPAN.finishStrength[1]} step={1} value={look.finishStrength} onChange={(e) => onChange({ ...look, finishStrength: Number(e.target.value) })} />
            <output>{look.finishStrength} %</output>
          </label>
        </>
      )}
    </>
  );
}
