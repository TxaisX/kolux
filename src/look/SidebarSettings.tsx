// Settings > Appearance > Window & Sidebar: the left sidebar's look (SET-021, VIEW-052) and how
// much a workspace card shows (SET-021, PROJ-062). AppearancePage draws the two cards around these
// bodies (it holds their data-section, which the settings search checks against its page).
import { Segmented } from "../settings/GeneralPage";
import { SPAN, type Appearance } from "../theme";
import { SIDEBAR_LABEL, SIDEBAR_LOOKS, type SidebarLook } from "./sidebar";
import { PIN_COPIES_SETTING } from "../projects/rows";
import { densityPatch, DENSITIES, DENSITY_LABEL, DENSITY_NOTE, readCardDetails, type Density } from "./cards";

const LOOK_NOTE: Record<SidebarLook, string> = {
  standard: "The plain surface colour.",
  terminal: "The sidebar takes the terminal's background colour.",
  tinted: "A colour of your choice laid over the standard surface.",
};

/** The inside of the sidebar look card: three choices; Tinted adds a colour and a strength. Changes show at once. */
export function SidebarLookBody({ look, onChange }: { look: Appearance; onChange: (a: Appearance) => void }) {
  const tinted = look.sidebarLook === "tinted";
  return (
    <>
      <h2 className="conn-name">Left sidebar</h2>
      <div className="look-select">
        <span>Look</span>
        <Segmented<SidebarLook> label="Sidebar look" options={SIDEBAR_LOOKS.map((l) => ({ id: l, label: SIDEBAR_LABEL[l] }))} value={look.sidebarLook} onPick={(sidebarLook) => onChange({ ...look, sidebarLook })} />
      </div>
      <p className="conn-detail">{LOOK_NOTE[look.sidebarLook]}</p>
      {tinted && (
        <>
          <div className="look-select pane-colour">
            <span>Tint colour</span>
            <input type="color" aria-label="Sidebar tint colour" value={look.sidebarTint} onChange={(e) => onChange({ ...look, sidebarTint: e.target.value })} />
            <span className="conn-detail">{look.sidebarTint}</span>
          </div>
          <label className="look-slider">
            <span>Strength</span>
            <input type="range" aria-label="Sidebar tint strength" min={SPAN.sidebarStrength[0]} max={SPAN.sidebarStrength[1]} step={1} value={look.sidebarStrength} onChange={(e) => onChange({ ...look, sidebarStrength: Number(e.target.value) })} />
            <output>{look.sidebarStrength} %</output>
          </label>
        </>
      )}
    </>
  );
}

/** The card layout: Default, Compact or Detailed. A custom set of details (the sidebar's card
 *  details chooser, PROJ-062) shows as Custom until one of the three is picked again. */
export function CardDensityBody({ settings, save }: { settings: Record<string, unknown>; save: (patch: Record<string, unknown>) => void }) {
  const { density } = readCardDetails(settings);
  return (
    <>
      <h2 className="conn-name">Workspace cards</h2>
      <div className="look-select">
        <span>Layout</span>
        <Segmented<Density | "custom">
          label="Workspace card layout"
          options={[...DENSITIES.map((d) => ({ id: d as Density | "custom", label: DENSITY_LABEL[d] })), ...(density === "custom" ? [{ id: "custom" as const, label: "Custom" }] : [])]}
          value={density}
          onPick={(d) => d !== "custom" && save(densityPatch(d))}
        />
      </div>
      <p className="conn-detail">{density === "custom" ? "You chose the details one by one in the sidebar's card settings." : DENSITY_NOTE[density]}</p>
      <label className="conn-switch">
        <input type="checkbox" role="switch" aria-label="Pinned workspaces also in their groups" checked={settings[PIN_COPIES_SETTING] === true} onChange={(e) => save({ [PIN_COPIES_SETTING]: e.target.checked })} />
        <span>
          Show pinned workspaces in their groups too
          <small>Pinned workspaces sit at the top; this also keeps them in their usual place. Off by default.</small>
        </span>
      </label>
    </>
  );
}
