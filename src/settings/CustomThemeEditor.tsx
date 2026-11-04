// T-648 (DT-C87): make your own colour theme. Four colours up front (accent, background, panels, text),
// every other colour under Advanced, the terminal's colours in a section of their own, a contrast chip
// with a Fix button, and save / rename / duplicate / delete / reset / export / import. Every pick shows on
// the whole window at once (the Appearance page applies each change) and is saved through the page's
// usual save, as part of the look. Loaded on demand from AppearancePage.
import { useLeaveSave } from "./leave";
import { invoke } from "@tauri-apps/api/core";
import { useMemo, useState, type CSSProperties } from "react";
import { buildTheme, customOf, isDark, terminalFor, type Appearance } from "../theme";
import { NAME_MAX, TERMINAL_KEYS, ownLook, tidyThemes, type CustomTheme } from "./customTheme";
import { AA, contrast, nudgeToContrast, pairsOf, ratioText, type Pair } from "./customThemeContrast";
import { MAX_BYTES, exportTheme, parseThemeFile } from "./customThemeFile";
import { deleteTheme, duplicateTheme, freeName, newTheme, nameProblem, resetToDefault, saveTheme } from "./customThemeStore";

type Props = { look: Appearance; onChange: (a: Appearance) => void };

/** The four colours shown first. */
export const MAIN = [
  { key: "accent", label: "Accent", hint: "Highlights and links" },
  { key: "app-bg", label: "Background", hint: "Behind everything" },
  { key: "surface", label: "Panels", hint: "Cards and sidebars" },
  { key: "fg", label: "Text", hint: "Main text" },
] as const;

/** Every other colour, grouped; the unit test checks that nothing in the classic palette is missing. */
export const ADVANCED: { title: string; keys: string[] }[] = [
  { title: "Text", keys: ["fg-muted", "fg-row", "fg-nav", "fg-label", "fg-faint", "fg-icon-dim", "fg-disabled", "mark", "link"] },
  { title: "Backgrounds", keys: ["strip-bg", "pane-bg", "input-bg", "chip-bg", "kbd-bg", "tab-track", "row-selected", "seg-active", "gauge-track"] },
  { title: "Borders", keys: ["kbd-border", "line-subtle", "line-inner", "line", "line-strong", "line-focus", "tab-track-border", "button-border"] },
  { title: "Status", keys: ["working", "working-icon", "done", "done-icon", "dot-live", "dot-idle", "gauge", "gauge-text", "warn", "danger", "danger-line", "meter-danger", "cost-fg"] },
  { title: "Code", keys: ["syn-comment", "syn-definition", "syn-function", "syn-invalid", "syn-keyword", "syn-name", "syn-number", "syn-operator", "syn-string", "syn-type"] },
];

const TERMINAL_TOP = [["foreground", "Text"], ["background", "Background"], ["cursor", "Cursor"], ["selectionBackground", "Selection"]] as const;
const ANSI_NAMES = TERMINAL_KEYS.slice(4);
const label = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const without = (m: Record<string, string>, key: string) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== key));

function Chip({ pair, onFix }: { pair: Pair; onFix: () => void }) {
  const r = contrast(pair.fg, pair.ground);
  const ok = r >= AA;
  return (
    <span className={ok ? "ct-chip ok" : "ct-chip low"} data-pair={pair.id} role={ok ? undefined : "status"}>
      {pair.label}: {ratioText(r)}:1 {ok ? "AA" : `is below ${AA}:1`}
      {!ok && (
        <button type="button" className="ct-fix" onClick={onFix}>
          Fix
        </button>
      )}
    </span>
  );
}

function Swatch({ id, text, value, changed, hint, onPick, onReset }: { id: string; text: string; value: string; changed: boolean; hint?: string; onPick: (v: string) => void; onReset: () => void }) {
  return (
    <div className="ct-colour" data-colour={id}>
      <input type="color" aria-label={text} value={value} onChange={(e) => onPick(e.target.value)} />
      <span className="ct-name">
        <b title={text}>{text}</b>
        <small title={hint ?? value}>{hint ?? value}</small>
      </span>
      {changed && (
        <button type="button" className="ct-undo" title={`Put ${text} back to the base theme`} aria-label={`Reset ${text}`} onClick={onReset}>
          ↺
        </button>
      )}
    </div>
  );
}

/** Saves an edit to the theme in use; the edit never changes the theme's own tint, saturation and depth. */
export const keepLook = (look: Appearance, next: CustomTheme, cur: CustomTheme) => saveTheme(look, { ...next, ...ownLook(cur) }, cur.name);

export default function CustomThemeEditor({ look: saved, onChange }: Props) {
  // The saved list as the editor sees it: tidied, so a hand-edited settings file cannot break this page.
  const list = useMemo(() => tidyThemes(saved.userThemes, saved), [saved.userThemes]); // eslint-disable-line react-hooks/exhaustive-deps
  const look = useMemo(() => ({ ...saved, userThemes: list }), [saved, list]);
  const cur = customOf(look);
  const [name, setName] = useState(cur?.name ?? "");
  const [seen, setSeen] = useState(cur?.name);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState("");
  const [paste, setPaste] = useState("");
  const [sure, setSure] = useState(false);
  if (seen !== cur?.name) {
    setSeen(cur?.name);
    setName(cur?.name ?? "");
    setSure(false);
  }
  const say = (n: string, b = "") => {
    setNote(n);
    setBad(b);
  };
  // The sliders are off while a custom theme is in use, so an edit keeps the theme's own tint, saturation and depth.
  const edit = (next: CustomTheme) => cur && onChange(keepLook(look, next, cur));
  const tokens = buildTheme(look, isDark(look)) as Record<string, string>;
  const term = terminalFor({ ...look, terminal: "match", lightScheme: "match", lightTerminal: true }, isDark(look)) as Record<string, string>;

  const add = (t: CustomTheme) => {
    try {
      onChange({ ...saveTheme(look, t), userTheme: t.name });
      say(`Saved ${t.name}.`);
    } catch (e) {
      say("", e instanceof Error ? e.message : String(e));
    }
  };
  const rename = () => {
    if (!cur || name.trim() === cur.name) return;
    const problem = nameProblem(look, name, cur.name);
    if (problem) return say("", problem);
    edit({ ...cur, name: name.trim() });
    say("Renamed.");
  };
  useLeaveSave(rename); // SET-036: changing page or closing keeps a typed name
  const importText = (text: string, from: string) => {
    try {
      const t = parseThemeFile(text);
      add({ ...t, name: freeName(look.userThemes.map((x) => x.name), t.name) });
    } catch (e) {
      say("", `${from}: ${e instanceof Error ? e.message : String(e)} Nothing was changed.`);
    }
  };
  const exportIt = () => {
    if (!cur) return;
    // The system Save dialog (theme_file.rs), the way a note is saved as a PDF; nothing is written until a place is chosen.
    invoke<string | null>("theme_export_save", { name: cur.name, text: exportTheme(cur) })
      .then((path) => say(path ? `Saved the theme to ${path}.` : "Export cancelled. Nothing was saved."))
      .catch((e) => say("", `Could not save the theme file: ${e instanceof Error ? e.message : String(e)}`));
  };

  const setColour = (key: string, v: string) => cur && edit({ ...cur, overrides: { ...cur.overrides, [key]: v } });
  const setTerm = (key: string, v: string) => cur && edit({ ...cur, terminal: { ...cur.terminal, [key]: v } });
  const fix = (p: Pair) => {
    const key = p.id === "fg-muted" ? "fg-muted" : "fg";
    setColour(key, nudgeToContrast((tokens[key] ?? tokens.link), key === "fg" ? [tokens["app-bg"], tokens.surface] : [tokens.surface]));
  };
  const colour = (key: string, text: string, hint?: string) => (
    <Swatch key={key} id={key} text={text} hint={hint} value={tokens[key] ?? tokens.link} changed={!!cur && key in cur.overrides} onPick={(v) => setColour(key, v)} onReset={() => cur && edit({ ...cur, overrides: without(cur.overrides, key) })} />
  );
  const swatch = (key: string, text: string) => (
    <Swatch key={key} id={key} text={text} value={term[key] ?? tokens["row-selected"]} changed={!!cur && key in cur.terminal} onPick={(v) => setTerm(key, v)} onReset={() => cur && edit({ ...cur, terminal: without(cur.terminal, key) })} />
  );
  const isDefault = look.theme === "classic" && !look.userTheme && look.tint === 0 && look.saturation === 100 && look.depth === 0;

  return (
    <div className="ct" data-section="custom-themes">
      <div className="ct-bar">
        <button type="button" className="btn" onClick={() => add(newTheme(look))}>
          New theme
        </button>
        <label className="btn ct-file">
          Import a theme file
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Theme file to import"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && f.size > MAX_BYTES) say("", `${f.name}: That file is too big to be a Kolux theme. Nothing was changed.`);
              else if (f) void f.text().then((t) => importText(t, f.name));
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={isDefault}
          onClick={() => {
            onChange(resetToDefault(look));
            say("Back to the Classic theme. Your saved themes are still in the list.");
          }}
        >
          Reset to default
        </button>
      </div>
      {look.userThemes.length === 0 && <p className="conn-detail">Make a theme of your own: New theme starts from the colours you see now and shows every pick at once.</p>}
      {(note || bad) && (
        <p className={bad ? "conn-detail warn" : "conn-detail"} role="status">
          {bad || note}
        </p>
      )}
      <details className="ct-paste">
        <summary>Paste a theme instead</summary>
        <textarea rows={4} aria-label="Theme text to import" placeholder={'{ "format": "kolux-theme", "version": 1, "name": "Mine", "base": "classic", "overrides": { "accent": "#ff8800" } }'} value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button
          type="button"
          className="btn"
          disabled={!paste.trim()}
          onClick={() => {
            importText(paste, "The pasted text");
            setPaste("");
          }}
        >
          Import
        </button>
      </details>

      {cur && (
        <>
          <div className="ct-head">
            <label className="ct-rename">
              <span>Theme name</span>
              <input type="text" value={name} maxLength={NAME_MAX} aria-label="Theme name" onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === "Enter" && rename()} />
            </label>
            <div className="btn-row">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  try {
                    onChange(duplicateTheme(look, cur.name));
                    say(`Made a copy of ${cur.name}.`);
                  } catch (e) {
                    say("", e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Duplicate
              </button>
              <button type="button" className="btn" onClick={exportIt}>
                Export
              </button>
              {sure ? (
                <>
                  <button
                    type="button"
                    className="btn danger"
                    onClick={() => {
                      onChange(deleteTheme(look, cur.name));
                      say(`Deleted ${cur.name}.`);
                    }}
                  >
                    Delete {cur.name}
                  </button>
                  <button type="button" className="btn" onClick={() => setSure(false)}>
                    Keep it
                  </button>
                </>
              ) : (
                <button type="button" className="btn danger" onClick={() => setSure(true)}>
                  Delete
                </button>
              )}
            </div>
          </div>
          <p className="conn-detail">Starts from the {cur.base[0].toUpperCase() + cur.base.slice(1)} theme; only the colours you change are kept. The arrow ↺ puts one back.</p>
          <div className="ct-main">{MAIN.map((m) => colour(m.key, m.label, m.hint))}</div>
          <div className="ct-chips" aria-label="Contrast">
            {pairsOf(tokens).map((p) => (
              <Chip key={p.id} pair={p} onFix={() => fix(p)} />
            ))}
          </div>
          <details className="ct-fold" data-fold="advanced">
            <summary>Advanced: every other colour</summary>
            {ADVANCED.map((g) => (
              <div key={g.title}>
                <h3 className="ct-group">{g.title}</h3>
                <div className="ct-grid">{g.keys.map((k) => colour(k, k))}</div>
              </div>
            ))}
          </details>
          <details className="ct-fold" data-fold="terminal-palette">
            <summary>Terminal colours</summary>
            <div className="ct-grid">{TERMINAL_TOP.map(([k, t]) => swatch(k, t))}</div>
            <h3 className="ct-group">The 16 colours</h3>
            <div className="ct-grid ct-ansi">{ANSI_NAMES.map((k) => swatch(k, label(k)))}</div>
            <div className="ct-term" style={{ background: term.background, color: term.foreground } as CSSProperties} aria-label="Terminal preview">
              <span>$ git diff</span>
              <span style={{ color: term.green }}>+ added line</span>
              <span style={{ color: term.red }}>- removed line</span>
              <span className="ct-dots">
                {ANSI_NAMES.map((k) => (
                  <i key={k} title={label(k)} style={{ background: term[k] }} />
                ))}
              </span>
            </div>
            <div className="btn-row">
              <button type="button" className="btn" disabled={Object.keys(cur.terminal).length === 0} onClick={() => edit({ ...cur, terminal: {} })}>
                Derive from the app theme
              </button>
              <button type="button" className="btn" disabled={look.terminal === "match"} onClick={() => onChange({ ...look, terminal: "match", lightScheme: "match" })}>
                Use these for terminals
              </button>
            </div>
            <p className="conn-detail">{look.terminal === "match" ? "Terminals use these colours." : "Terminals use these colours when their scheme is Match app theme; the button above sets that."}</p>
          </details>
        </>
      )}
      {look.userThemes.length > 0 && !cur && <p className="conn-detail">Pick one of your themes in the swatches above to edit it.</p>}
    </div>
  );
}
