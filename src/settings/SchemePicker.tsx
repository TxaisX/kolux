// SET-023: the terminal scheme lists in Settings > Appearance. One search box narrows both lists
// (dark mode and light mode); each row shows the scheme's ground and four of its colours.
import type { ITheme } from "@xterm/xterm";
import { classic, terminalFor, terminalTheme, type Appearance } from "../theme";
import { CATALOGUE, findSchemes } from "../terminal/schemes";
import { ResetButton } from "./SafetyRules";

export type SchemeOption = { id: string; name: string; colours: ITheme; custom?: boolean };

/** Kolux and Match app theme first, then the catalogue, then the user's own schemes. */
export function schemeOptions(look: Appearance, dark: boolean): SchemeOption[] {
  return [
    { id: "default", name: "Kolux", colours: terminalTheme(classic) },
    { id: "match", name: "Match app theme", colours: terminalFor({ ...look, terminal: "match", lightScheme: "match" }, dark) },
    ...CATALOGUE.map((c) => ({ id: c.id, name: c.name, colours: c.colours })),
    ...look.custom.map(({ name, ...colours }) => ({ id: "custom:" + name, name, colours, custom: true })),
  ];
}

type Props = { label: string; options: SchemeOption[]; query: string; value: string; disabled?: boolean; onPick: (id: string) => void; onRemove?: (id: string) => void };

export function SchemeList({ label, options, query, value, disabled, onPick, onRemove }: Props) {
  const shown = findSchemes(options, query);
  return (
    <div className={disabled ? "scheme-list off" : "scheme-list"}>
      <span className="scheme-label">{label}</span>
      {/* T-757: a list of pressed buttons, not a listbox: an option may not hold or sit beside Remove. */}
      {shown.length === 0 ? <p className="conn-detail">No scheme matches “{query}”.</p> : <ul className="scheme-rows" aria-label={label}>
        {shown.map((o) => (
          <li key={o.id} className="scheme-row">
            <button type="button" aria-pressed={o.id === value} disabled={disabled} className={o.id === value ? "scheme-pick sel" : "scheme-pick"} onClick={() => onPick(o.id)}>
              <span className="scheme-swatch" style={{ background: o.colours.background, color: o.colours.foreground }}>
                Aa
                {(["red", "green", "yellow", "blue"] as const).map((k) => (
                  <i key={k} style={{ background: o.colours[k] }} />
                ))}
              </span>
              <span className="name">{o.name}</span>
            </button>
            {o.custom && onRemove && (
              <ResetButton label="×" className="scheme-remove" title={`Remove ${o.name}`} ariaLabel={`Remove ${o.name}`} yes="Yes, remove" onReset={() => onRemove(o.id)} />
            )}
          </li>
        ))}
      </ul>}
    </div>
  );
}
