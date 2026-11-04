// Settings > Terminal & sessions. TERM-045 / SET-043: whether closing a terminal with a live program
// asks first. TERM-005: how many panes a new workspace starts with. SET-022: terminal text and the
// cursor, with a live sample. SET-025: history, scrolling and the clipboard. SET-026: the default
// shell on Windows. TERM-099 / TERM-100: bring in Ghostty settings and Warp themes.
import { useEffect, useRef, useState } from "react";
import { useLeaveSave } from "./leave";
import { invoke } from "@tauri-apps/api/core";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { CONFIRM_CLOSE_FIELD, asksBeforeClose } from "../terminal/closing";
import { PIN_ASK_FIELD, pinAsks } from "../terminal/pin";
import { REMOVE_FIELD, readRemove } from "../terminal/remove";
import { DEFAULT_PANES_FIELD, PANE_COUNTS, seedCount } from "../terminal/grid";
import { clampNumber, CURSORS, DEFAULT_SHELL_FIELD, FIELDS, LINE_HEIGHT, optionsOf, readText, SCROLLBACK, SIZE, WEIGHTS, type TerminalText } from "../terminal/text";
import { currentTerminal, TERMINAL_EVENT } from "../theme";
import { FontField } from "./AppearancePage";
import { Segmented } from "./GeneralPage";
import { InputCard, PowerShellCard } from "./InputCards";
import { detectPlatform } from "../keys/keymap";
import { readLook } from "./general";
import TerminalImport from "./TerminalImport";
import { openSettings } from "./pages";
import { useSettings } from "./useSettings";
import { DENSITIES, DENSITY_FIELD, readDensity } from "../shell/paneChrome";
import { KOLUX_FIELD, switchPatch } from "../shell/linkAsk";

/** TERM-119: on unless switched off; the app reads the same field when it starts a shell. */
const SHELL_HISTORY_FIELD = "shellHistoryPerWorktree";
type ShellInfo = { id: string; name: string };
const onWindows = () => /Windows/.test(navigator.userAgent);
const platform = detectPlatform();
const SAMPLE = "\x1b[32m~/kolux\x1b[0m $ git status\r\nOn branch \x1b[36mmain\x1b[0m\r\n\x1b[1mbold\x1b[0m normal \x1b[33myellow\x1b[0m \x1b[31mred\x1b[0m \x1b[34mblue\x1b[0m\r\n=> != <= 0O 1lI\r\n$ ";

/** SET-022: the sample is a real terminal that lives only while the page is open. */
function Sample({ text }: { text: TerminalText }) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const first = useRef(text);
  useEffect(() => {
    if (!host.current) return;
    const t = new Terminal({ ...optionsOf(first.current), theme: currentTerminal(), rows: 5, cols: 64, disableStdin: true });
    t.open(host.current);
    t.write(SAMPLE);
    term.current = t;
    const recolour = () => (t.options.theme = currentTerminal());
    window.addEventListener(TERMINAL_EVENT, recolour);
    return () => {
      window.removeEventListener(TERMINAL_EVENT, recolour);
      t.dispose();
      term.current = null;
    };
  }, []);
  useEffect(() => {
    if (term.current) Object.assign(term.current.options, optionsOf(text));
  }, [text]);
  return <div className="term-sample" ref={host} role="img" aria-label="Sample terminal" />;
}

/** A typed number corrected on Enter or leaving; `buttons` adds minus and plus, greyed at the ends. */
function NumberField({ label, value, min, max, step = 1, buttons = false, onSave }: { label: string; value: number; min: number; max: number; step?: number; buttons?: boolean; onSave: (n: number) => void }) {
  const [typed, setTyped] = useState(String(value));
  useEffect(() => setTyped(String(value)), [value]);
  const commit = (raw: unknown) => {
    const n = clampNumber(raw, min, max, value, step);
    setTyped(String(n));
    if (n !== value) onSave(n);
  };
  useLeaveSave(() => typed !== String(value) && commit(typed)); // SET-036: changing page or closing keeps what was typed
  return (
    <label className="num-field">
      <span>{label}</span>
      {buttons && (
        <button type="button" className="btn" aria-label={`Smaller ${label.toLowerCase()}`} disabled={value <= min} onClick={() => commit(value - step)}>
          −
        </button>
      )}
      <input type="number" min={min} max={max} step={step} value={typed} onChange={(e) => setTyped(e.target.value)} onBlur={() => commit(typed)} onKeyDown={(e) => e.key === "Enter" && commit(typed)} />
      {buttons && (
        <button type="button" className="btn" aria-label={`Larger ${label.toLowerCase()}`} disabled={value >= max} onClick={() => commit(value + step)}>
          +
        </button>
      )}
    </label>
  );
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="conn-switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function WeightField({ label, value, onPick }: { label: string; value: string; onPick: (w: string) => void }) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onPick(e.target.value)}>
        {WEIGHTS.map((w) => (
          <option key={w} value={w}>
            {w === "normal" ? "Normal" : w === "bold" ? "Bold" : w}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function TerminalPage() {
  const { settings, error, save } = useSettings();
  const [shells, setShells] = useState<ShellInfo[] | null>(null);
  useEffect(() => {
    if (onWindows()) invoke<ShellInfo[]>("shell_list").then(setShells, () => setShells([]));
  }, []);
  const text = settings ? readText(settings) : null;
  const shellChoice = typeof settings?.[DEFAULT_SHELL_FIELD] === "string" ? (settings[DEFAULT_SHELL_FIELD] as string) : "auto";
  const shellOptions = [{ id: "auto", name: "Automatic (PowerShell 7 when installed)" }, ...(shells ?? []).filter((s, i, all) => all.findIndex((o) => o.id === s.id) === i)];
  return (
    <>
      {error && <p className="conn-detail warn">{error}</p>}
      {settings && (
        <section className="conn-card" data-section="panes">
          <h2 className="conn-name">New workspaces start with</h2>
          <Segmented
            label="New workspaces start with"
            options={PANE_COUNTS.map((n) => ({ id: String(n), label: n === 1 ? "1 pane" : `${n} panes` }))}
            value={String(seedCount(settings[DEFAULT_PANES_FIELD], false))}
            onPick={(v) => save({ [DEFAULT_PANES_FIELD]: Number(v) })}
          />
          <p className="conn-detail">{readLook(settings) === "classic" ? "The classic look always starts with one pane." : "The first pane is a terminal; the others wait for you to pick what runs in them."}</p>
        </section>
      )}
      {text && (
        <section className="conn-card" data-section="text">
          <h2 className="conn-name">Terminal text and cursor</h2>
          <Sample text={text} />
          <div className="term-fields">
            <NumberField label="Font size" value={text.size} min={SIZE.min} max={SIZE.max} buttons onSave={(n) => save({ [FIELDS.size]: n })} />
            <FontField label="Font" value={text.family} placeholder="Default (Cascadia Mono)" onPick={(f) => save({ [FIELDS.family]: f })} />
            <WeightField label="Weight" value={text.weight} onPick={(w) => save({ [FIELDS.weight]: w })} />
            <WeightField label="Bold weight" value={text.bold} onPick={(w) => save({ [FIELDS.bold]: w })} />
            <NumberField label="Line height" value={text.lineHeight} min={LINE_HEIGHT.min} max={LINE_HEIGHT.max} step={0.05} onSave={(n) => save({ [FIELDS.lineHeight]: n })} />
          </div>
          <div className="look-select">
            <span>Cursor</span>
            <Segmented label="Cursor" options={CURSORS.map((c) => ({ id: c, label: c[0].toUpperCase() + c.slice(1) }))} value={text.cursor} onPick={(c) => save({ [FIELDS.cursor]: c })} />
          </div>
          <Switch label="Blinking cursor" checked={text.blink} onChange={(on) => save({ [FIELDS.blink]: on })} />
          <Switch label="Minimum contrast: keep text readable on any colour scheme" checked={text.contrast} onChange={(on) => save({ [FIELDS.contrast]: on })} />
          <div className="look-select">
            <span>Pane headers</span>
            <Segmented label="Pane headers" options={DENSITIES.map((d) => ({ id: d, label: d[0].toUpperCase() + d.slice(1) }))} value={readDensity(settings)} onPick={(d) => save({ [DENSITY_FIELD]: d })} />
          </div>
        </section>
      )}
      {text && (
        <section className="conn-card" data-section="scrolling">
          <h2 className="conn-name">History and scrolling</h2>
          <div className="term-fields">
            <NumberField label="Scrollback rows" value={text.scrollback} min={SCROLLBACK.min} max={SCROLLBACK.max} onSave={(n) => save({ [FIELDS.scrollback]: n })} />
            <NumberField label="Scroll sensitivity" value={text.scroll} min={0.1} max={5} step={0.1} onSave={(n) => save({ [FIELDS.scroll]: n })} />
            <NumberField label="Fast scroll (with Alt)" value={text.fastScroll} min={1} max={20} onSave={(n) => save({ [FIELDS.fastScroll]: n })} />
          </div>
          {settings && (
            <>
              <Switch label="Keep shell history separate for each workspace" checked={settings[SHELL_HISTORY_FIELD] !== false} onChange={(on) => save({ [SHELL_HISTORY_FIELD]: on })} />
              <p className="conn-detail">The up arrow in bash, zsh and fish then shows the commands run in that workspace only. Command Prompt and PowerShell are left as they are, and a history file you set yourself is kept. Applies to terminals opened after the change.</p>
            </>
          )}
        </section>
      )}
      {text && (
        <section className="conn-card" data-section="links">
          <h2 className="conn-name">Links</h2>
          <Switch label="Open web links from the terminal in the Kolux browser" checked={settings?.[KOLUX_FIELD] === true} onChange={(on) => save(switchPatch(on))} />
          <p className="conn-detail">Off opens them in your system browser. Hold Shift with Ctrl (Cmd on macOS) and click to use the system browser for a single link. Turning this switch yourself also stops the first-click question.</p>
          <Switch label="Link menu on Ctrl+right-click (Cmd+right-click on macOS)" checked={text.linkMenu} onChange={(on) => save({ [FIELDS.linkMenu]: on })} />
          <p className="conn-detail">Offers opening a link in either browser, copying it, or coming back here. Off also drops it from the hint shown over a link.</p>
        </section>
      )}
      {text && (
        <section className="conn-card" data-section="clipboard">
          <h2 className="conn-name">Clipboard</h2>
          <Switch label="Copy on select" checked={text.copyOnSelect} onChange={(on) => save({ [FIELDS.copyOnSelect]: on })} />
          <Switch label="Right-click pastes (or copies the selection)" checked={text.rightClickPaste} onChange={(on) => save({ [FIELDS.rightClickPaste]: on })} />
        </section>
      )}
      {settings && <TerminalImport settings={settings} save={save} />}
      {settings && <InputCard settings={settings} platform={platform} onSave={save} />}
      {settings && (
        <section className="conn-card" data-section="keys">
          <h2 className="conn-name">Keys in terminals</h2>
          <p className="conn-detail">
            Which keys reach the terminal and which Kolux keeps for itself is set in{" "}
            <button className="btn link" onClick={() => openSettings("shortcuts", "terminal-first")}>
              Shortcuts settings
            </button>
            .
          </p>
        </section>
      )}
      {settings && shells && (
        <section className="conn-card" data-section="shell">
          <h2 className="conn-name">Default shell</h2>
          <label className="num-field">
            <span>New terminals open in</span>
            <select value={shellOptions.some((o) => o.id === shellChoice) ? shellChoice : "auto"} onChange={(e) => save({ [DEFAULT_SHELL_FIELD]: e.target.value })}>
              {shellOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <p className="conn-detail">Only the shells found on this computer are listed. Open terminals keep the shell they started with.</p>
        </section>
      )}
      {settings && <PowerShellCard settings={settings} platform={platform} onSave={save} />}
      {settings && (
        <section className="conn-card" data-section="closing">
          <h2 className="conn-name">Closing terminals</h2>
          <Switch label="Ask before closing running terminals" checked={asksBeforeClose(settings)} onChange={(on) => save({ [CONFIRM_CLOSE_FIELD]: on })} />
          <p className="conn-detail">An idle shell always closes straight away.</p>
          <label className="conn-switch">
            <input type="checkbox" role="switch" checked={pinAsks(settings)} onChange={(e) => save({ [PIN_ASK_FIELD]: e.target.checked })} />
            Ask before closing a pinned tab
          </label>
          <p className="conn-detail">Pinned tabs sit first in the strip and stay out of Close others, Close all and middle-click.</p>
          <h2 className="conn-name">Removing a started session</h2>
          <Segmented
            label="Removing a started session"
            options={[
              { id: "ask", label: "Ask first" },
              { id: "stop", label: "Stop without asking" },
            ]}
            value={readRemove(settings)}
            onPick={(v) => save({ [REMOVE_FIELD]: v })}
          />
          <p className="conn-detail">Applies to Remove session on a running agent or a busy shell. A pane that has not started, or an idle shell, is removed straight away.</p>
        </section>
      )}
    </>
  );
}
