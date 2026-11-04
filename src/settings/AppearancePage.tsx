// Settings > Appearance: the colour theme row (SET-001), its tint / saturation / depth sliders
// (SET-002) and the terminal colours picker with "Match app theme" (SET-003). Every change shows at
// once on the whole window; the save follows a moment later so a slider drag is one write.
import { lazy, Suspense, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLeaveSave } from "./leave";
import { MAX_LEVEL, MIN_LEVEL, onZoom, percentOf, stepZoom, zoomLevel, type ZoomStep } from "./zoom";
import { SearchFolds } from "./search";
import { saveChanged, settingsDiff } from "./saveChanged";
import { applyAppearance, buildTheme, customOf, isDark, MODES, previewOf, readAppearance, SPAN, swatch, themeLabel, terminalFor, themeVars, THEMES, uiFont, monoFont, writeAppearance, WEIGHTS, THEMED_SCREENS, type Appearance, type FontWeight, type Mode } from "../theme";
import { importScheme, type CustomScheme } from "../terminal/schemes";
import { parseSchemeFile, planImport, planSummary, sameColours } from "./importSchemes";
import { schemeOptions, SchemeList } from "./SchemePicker";
import { useSettings } from "./useSettings";
import { fontStack, loadFonts, rankFonts } from "./fonts";
import { FIELDS as STATUS_FIELDS, readStatusBar, STATUS_ITEMS, toggleItem } from "../chrome/statusItems";
import { CHROME, chromeShown, windowSummary } from "../chrome/chromeItems";
import AppLookCard from "../chrome/AppLookCard";
import { PERCENT_FIELD, percentMode, type PercentMode } from "../usage/meter";
import { Segmented } from "./GeneralPage";
import { CardDensityBody, SidebarLookBody } from "../look/SidebarSettings";
import { applyLanguage, LANGUAGE_FIELD, LANGUAGES, savedLanguage, systemLanguage, type LanguageChoice } from "../language";

/** T-648: the editor for the user's own themes loads when the Colour theme card draws it, not with the page. */
const CustomThemeEditor = lazy(() => import("./CustomThemeEditor"));

const MODE_LABEL: Record<Mode, string> = { system: "System", light: "Light", dark: "Dark" };

const SLIDERS = [
  { key: "tint", label: "Tint", unit: "°" },
  { key: "saturation", label: "Saturation", unit: " %" },
  { key: "depth", label: "Depth", unit: "" },
] as const;

/** A small window drawn in the given look, beside the swatches. */
export function ThemePreview({ look }: { look: Appearance }) {
  return (
    <div className="look-preview" style={themeVars(buildTheme(previewOf(look), isDark(look))) as CSSProperties} aria-label={`Preview: ${customOf(look)?.name ?? themeLabel(previewOf(look).theme)}`}>
      <div className="lp-top" />
      <div className="lp-body">
        <div className="lp-side">
          <span className="lp-row sel" />
          <span className="lp-row" />
          <span className="lp-row" />
        </div>
        <div className="lp-pane">
          <span className="lp-line" />
          <span className="lp-line short" />
        </div>
      </div>
    </div>
  );
}

/** The picker dot for one of the user's themes: its background and its accent, split on the diagonal. */
function customSwatch(look: Appearance, name: string): CSSProperties {
  const t = buildTheme({ ...look, userTheme: name }, true);
  return { background: `linear-gradient(135deg, ${t["app-bg"]} 50%, ${t.accent ?? t.link} 50%)` };
}

/** SET-016: a foldable section of the Appearance page; folded, its header sums up what it holds. */
function Fold({ id, title, summary, open, onToggle, children }: { id: string; title: string; summary: string; open: boolean; onToggle: (open: boolean) => void; children: ReactNode }) {
  // SET-007: while a search runs a fold with a match is held open and one without is left out;
  // its own open state is untouched, so clearing the search puts it back.
  const found = useContext(SearchFolds);
  if (found && !found.has(id)) return null;
  const shown = !!found || open;
  return (
    <details className="look-fold" data-fold={id} open={shown} onToggle={(e) => !found && onToggle(e.currentTarget.open)}>
      <summary aria-disabled={found ? true : undefined} onClick={found ? (e) => e.preventDefault() : undefined}>
        <span className="look-fold-title">{title}</span>
        {!shown && <span className="look-fold-sum">{summary}</span>}
      </summary>
      {children}
    </details>
  );
}

/** SET-019: the interface zoom, in steps; the zoom keys and the View menu change the same level. */
function ZoomControl() {
  const [level, setLevel] = useState(zoomLevel);
  useEffect(() => onZoom(setLevel), []);
  const [failed, setFailed] = useState<string | null>(null);
  const step = (how: ZoomStep) => (setFailed(null), stepZoom(how, setFailed));
  return (
    <section className="conn-card" data-section="zoom">
      <h2 className="conn-name">Zoom</h2>
      <div className="look-select">
        <span>Interface size</span>
        <div className="zoom-row">
          <button className="btn" aria-label="Zoom out" disabled={level <= MIN_LEVEL} onClick={() => step("out")}>
            −
          </button>
          <output className="zoom-level">{percentOf(level)} %</output>
          <button className="btn" aria-label="Zoom in" disabled={level >= MAX_LEVEL} onClick={() => step("in")}>
            +
          </button>
          <button className="btn" disabled={level === 0} onClick={() => step("reset")}>
            Reset
          </button>
        </div>
      </div>
      <p className="conn-detail">Text and controls grow or shrink together. Ctrl+Alt+=, Ctrl+Alt+- and Ctrl+Alt+0 (Cmd+Option on macOS) do the same from anywhere.</p>
      {failed && <p className="conn-detail warn" role="alert">{failed}</p>}
    </section>
  );
}

/** SET-018: a font family field; suggestions come from the installed fonts, the whole list when the
 *  field is entered and the best matches once the user types. Applies on pick, Enter or leaving. */
export function FontField({ label, value, placeholder, onPick }: { label: string; value: string; placeholder: string; onPick: (family: string) => void }) {
  const [text, setText] = useState(value);
  const [fonts, setFonts] = useState<string[] | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [hi, setHi] = useState(-1); // T-742: the suggestion Up/Down has reached; Enter picks it
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setText(value), [value]);
  useEffect(() => (list.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" }), [hi]);
  const shown = fonts ? rankFonts(fonts, typed ? text : "") : [];
  const active = open && hi >= 0 && hi < shown.length ? hi : -1;
  const commit = (f: string) => {
    setText(f);
    setOpen(false);
    if (f.trim() !== value) onPick(f.trim());
  };
  useLeaveSave(() => text !== value && commit(text)); // SET-036: changing page or closing keeps what was typed
  return (
    <label className="font-field">
      <span>{label}</span>
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={open && shown.length > 0 ? `${id}-list` : undefined}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        maxLength={100}
        spellCheck={false}
        placeholder={placeholder}
        value={text}
        style={{ fontFamily: fontStack(text, "var(--ui-font)") }}
        onFocus={() => {
          setTyped(false);
          setOpen(true);
          setHi(-1);
          void loadFonts().then(setFonts);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setTyped(true);
          setOpen(true);
          setHi(-1);
        }}
        onKeyDown={(e) => {
          const n = shown.length;
          if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n > 0) {
            e.preventDefault();
            const down = e.key === "ArrowDown";
            setOpen(true);
            setHi((down ? active + 1 : (active < 0 ? n : active) - 1 + n) % n); // from what is shown: none once the list closed
          }
          if (e.key === "Enter") commit(active >= 0 ? shown[active] : text);
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
        onBlur={() => commit(text)}
      />
      {open && shown.length > 0 && (
        <div ref={list} className="font-list" id={`${id}-list`} role="listbox" data-popup aria-label={`${label} suggestions`}>
          {shown.map((f, i) => (
            <button key={f} id={`${id}-${i}`} className={i === active ? "hi" : undefined} type="button" role="option" aria-selected={f === value} tabIndex={-1} style={{ fontFamily: fontStack(f, "var(--ui-font)") }} onMouseDown={(e) => e.preventDefault()} onClick={() => commit(f)}>
              {f}
            </button>
          ))}
        </div>
      )}
    </label>
  );
}

const firstFamily = (stack: string) => stack.split(",")[0].replace(/"/g, "").trim();

/** `windowPart` and `windowSummary` fill the Window & Sidebar section (they live in other settings). */
/** SET-017: the interface language, each choice in its own language; System says what it resolves to. */
export function LanguageView({ value, onPick, os = navigator.languages }: { value: LanguageChoice; onPick: (v: LanguageChoice) => void; os?: readonly string[] }) {
  const sys = LANGUAGES.find((l) => l.id === systemLanguage(os))?.name;
  return (
    <section className="conn-card" data-section="language">
      <h2 className="conn-name">Language</h2>
      <label className="look-select">
        <span>Language</span>
        <select aria-label="Interface language" value={value} onChange={(e) => onPick(e.target.value as LanguageChoice)}>
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.id === "system" ? `System (${sys})` : l.name}
            </option>
          ))}
        </select>
      </label>
      <p className="conn-detail">Dates, times and sorted lists follow the language. Some of Kolux's own words are machine-translated; any text a language lacks stays in English.</p>
    </section>
  );
}

/** The folds' open state for this run of the app (SET-007, SET-016). */
let folds = { interface: true, terminal: true, window: true };

export function AppearanceView({ look, onChange, windowPart, windowSummary = "", languagePart }: { look: Appearance; onChange: (a: Appearance) => void; windowPart?: ReactNode; windowSummary?: string; languagePart?: ReactNode }) {
  const custom = customOf(look);
  const classic = look.theme === "classic" || !!custom; // a custom theme sets its own colours, so the sliders rest
  // All three sections open at first; a link into a folded one unfolds it (SettingsPage). The
  // state outlives the page, which a search draws afresh, so clearing a search restores it.
  const [open, setOpen] = useState(() => ({ ...folds }));
  const fold = (k: keyof typeof open) => ({ open: open[k], onToggle: (o: boolean) => setOpen((p) => (p[k] === o ? p : (folds = { ...p, [k]: o }))) });
  const name = (id: string) => schemeOptions(look, true).find((o) => o.id === id)?.name ?? id;
  return (
    <>
      <Fold id="interface" title="Interface" summary={[MODE_LABEL[look.mode], custom?.name ?? themeLabel(look.theme), look.appFont || "Default font"].join(" · ")} {...fold("interface")}>
      <section className="conn-card" data-section="interface">
        <h2 className="conn-name">Mode</h2>
        <div className="look-select">
          <span>Mode</span>
          <Segmented<Mode> label="Mode" options={MODES.map((m) => ({ id: m, label: MODE_LABEL[m] }))} value={look.mode} off={custom ? [...MODES] : []} onPick={(mode) => onChange({ ...look, mode })} />
        </div>
        {custom && <p className="conn-detail" data-note="custom-mode">A custom theme sets its own light or dark look, so these are off while it is on.</p>}
        {look.mode === "system" && <p className="conn-detail">Follows Windows, also while Kolux is running.</p>}
        {/* VIEW-006: one of the three workspace screens can paint in its own mode. */}
        {THEMED_SCREENS.map((s) => (
          <div key={s} className="look-select" data-screen-theme={s}>
            <span>{s[0].toUpperCase() + s.slice(1)} screen</span>
            <Segmented<Mode | "app">
              label={`${s} screen mode`}
              options={[{ id: "app", label: "Same as app" }, ...MODES.map((m) => ({ id: m, label: MODE_LABEL[m] }))]}
              value={look.screens[s] ?? "app"}
              off={custom ? ["app", ...MODES] : []}
              onPick={(m) => {
                const rest = Object.fromEntries(Object.entries(look.screens).filter(([k]) => k !== s));
                onChange({ ...look, screens: m === "app" ? rest : { ...rest, [s]: m } });
              }}
            />
          </div>
        ))}
        <p className="conn-detail">Inbox and Artifacts follow the Terminals screen. The classic look uses the Terminals choice everywhere.</p>
      </section>
      <ZoomControl />
      {languagePart}
      <section className="conn-card" data-section="theme">
        <h2 className="conn-name">Colour theme</h2>
        <div className="look-row">
          <div className="look-swatches" role="radiogroup" aria-label="Colour theme">
            {THEMES.map((t) => (
              <button key={t} role="radio" aria-checked={look.theme === t && !custom} title={themeLabel(t)} aria-label={themeLabel(t)} className={look.theme === t && !custom ? "look-swatch on" : "look-swatch"} style={{ background: swatch(t) }} onClick={() => onChange({ ...look, theme: t, userTheme: "" })} />
            ))}
            {/* T-648: the user's own themes sit in the same row; the dot shows the accent over the background. */}
            {look.userThemes.map((c) => (
              <button key={"custom:" + c.name} role="radio" aria-checked={c.name === look.userTheme} title={c.name} aria-label={c.name} className={c.name === look.userTheme ? "look-swatch custom on" : "look-swatch custom"} style={customSwatch(look, c.name)} onClick={() => onChange({ ...look, userTheme: c.name })} />
            ))}
            <div className="look-name">{custom?.name ?? themeLabel(look.theme)}</div>
          </div>
          <ThemePreview look={look} />
        </div>
        {SLIDERS.map(({ key, label, unit }) => (
          <label key={key} className={classic ? "look-slider off" : "look-slider"}>
            <span>{label}</span>
            <input type="range" min={SPAN[key][0]} max={SPAN[key][1]} step={1} value={look[key]} disabled={classic} onChange={(e) => onChange({ ...look, [key]: Number(e.target.value) })} />
            <output>
              {look[key]}
              {unit}
            </output>
          </label>
        ))}
        {classic && <p className="conn-detail">{custom ? "A custom theme sets its own colours, so the sliders rest. Pick a built-in colour to use them." : "Classic keeps the original neutral look; pick a colour to use the sliders."}</p>}
        <Suspense fallback={<p className="conn-detail">Loading the theme editor…</p>}>
          <CustomThemeEditor look={look} onChange={onChange} />
        </Suspense>
      </section>
      <section className="conn-card" data-section="fonts">
        <h2 className="conn-name">Fonts</h2>
        <FontField label="App font" value={look.appFont} placeholder={`Default (${firstFamily(uiFont)})`} onPick={(appFont) => onChange({ ...look, appFont })} />
        <FontField label="Editor font" value={look.editorFont} placeholder="Same as the terminal font" onPick={(editorFont) => onChange({ ...look, editorFont })} />
        <p className="conn-detail">Leave a field empty for the default. A font that is not installed falls back to the default, so text always shows.</p>
      </section>
      </Fold>
      <Fold id="terminal" title="Terminal" summary={[look.termFont || firstFamily(monoFont), `${look.termSize} pt`, look.lightTerminal ? `${name(look.terminal)} / ${name(look.lightScheme)}` : name(look.terminal)].join(" · ")} {...fold("terminal")}>
      <section className="conn-card" data-section="terminal-font">
        <h2 className="conn-name">Terminal font</h2>
        {/* TERM-097: every pane and, unless it has its own font, the editor redraw with these. */}
        <FontField label="Terminal font" value={look.termFont} placeholder={`Default (${firstFamily(monoFont)})`} onPick={(termFont) => onChange({ ...look, termFont })} />
        <label className="look-slider">
          <span>Size</span>
          <input type="range" min={SPAN.termSize[0]} max={SPAN.termSize[1]} step={1} value={look.termSize} onChange={(e) => onChange({ ...look, termSize: Number(e.target.value) })} />
          <output>{look.termSize} pt</output>
        </label>
        <label className="look-slider">
          <span>Line height</span>
          <input type="range" min={SPAN.termLineHeight[0]} max={SPAN.termLineHeight[1]} step={0.1} value={look.termLineHeight} onChange={(e) => onChange({ ...look, termLineHeight: Number(e.target.value) })} />
          <output>{look.termLineHeight.toFixed(1)}</output>
        </label>
        {([["termWeight", "Weight"], ["termWeightBold", "Bold weight"]] as const).map(([key, label]) => (
          <label key={key} className="look-select">
            <span>{label}</span>
            <select aria-label={label} value={look[key]} onChange={(e) => onChange({ ...look, [key]: e.target.value as FontWeight })}>
              {WEIGHTS.map((w) => (
                <option key={w} value={w}>
                  {w[0].toUpperCase() + w.slice(1)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <p className="conn-detail">Zoom In, Zoom Out and Reset Size (the View menu, Ctrl+= / Ctrl+- / Ctrl+0) change only the focused terminal.</p>
      </section>
      <section className="conn-card" data-section="terminal-colours">
        <h2 className="conn-name">Terminal colours</h2>
        <TerminalColours look={look} onChange={onChange} />
      </section>
      <PaneLook look={look} onChange={onChange} />
      </Fold>
      <Fold id="window" title="Window & Sidebar" summary={windowSummary} {...fold("window")}>
        <section className="conn-card" data-section="sidebar-look">
          <SidebarLookBody look={look} onChange={onChange} />
        </section>
        {windowPart}
      </Fold>
    </>
  );
}

/** SET-023: the gap between panes (width, and a colour per mode) and how far panes not in focus fade. */
export function PaneLook({ look, onChange }: { look: Appearance; onChange: (a: Appearance) => void }) {
  const colour = (key: "dividerDark" | "dividerLight", label: string, blank: string) => (
    <div className="look-select pane-colour">
      <span>{label}</span>
      <input type="color" aria-label={label} value={look[key] || blank} onChange={(e) => onChange({ ...look, [key]: e.target.value })} />
      <span className="conn-detail">{look[key] || "None"}</span>
      {look[key] && (
        <button type="button" className="menu-item scheme-add-btn" onClick={() => onChange({ ...look, [key]: "" })}>
          Clear
        </button>
      )}
    </div>
  );
  const slider = (key: "dividerWidth" | "paneDim", label: string, unit: string) => (
    <label className="look-slider">
      <span>{label}</span>
      <input type="range" min={SPAN[key][0]} max={SPAN[key][1]} step={1} value={look[key]} onChange={(e) => onChange({ ...look, [key]: Number(e.target.value) })} />
      <output>
        {look[key]}
        {unit}
      </output>
    </label>
  );
  return (
    <section className="conn-card pane-look" data-section="panes">
      <h2 className="conn-name">Panes</h2>
      {slider("dividerWidth", "Divider width", " px")}
      {colour("dividerDark", "Divider colour, dark mode", "#2f2f2f")}
      {colour("dividerLight", "Divider colour, light mode", "#d0d0d0")}
      {slider("paneDim", "Panes not in focus", "%")}
      <p className="conn-detail">With no divider colour the window shows between panes. At 100% panes not in focus do not dim; lower fades them over a moment when focus moves.</p>
    </section>
  );
}

/** SET-023: a scheme for dark mode and one for light mode, a search box over both, and schemes
 *  pasted in Windows Terminal's JSON format. Removing a scheme in use falls back to the default. */
type Incoming = { file: string; scheme?: CustomScheme; problem?: string; same?: boolean };

/** SET-024: schemes brought in from Warp theme files or a Ghostty configuration. Each file is
 *  previewed first; only the ticked ones join the custom list, within the cap. */
function SchemeImport({ look, onChange }: { look: Appearance; onChange: (a: Appearance) => void }) {
  const [incoming, setIncoming] = useState<Incoming[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState("");
  const read = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const now = terminalFor(look, true);
    const rows = await Promise.all(
      [...files].map(async (f): Promise<Incoming> => {
        try {
          const scheme = parseSchemeFile(f.name, await f.text());
          return { file: f.name, scheme, same: sameColours(scheme, now) };
        } catch (e) {
          return { file: f.name, problem: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    setIncoming(rows);
    setTicked(new Set());
    setResult("");
  };
  const usable = incoming.filter((r) => r.scheme && !r.same);
  const toggle = (name: string, on: boolean) => setTicked((t) => (on ? new Set(t).add(name) : new Set([...t].filter((n) => n !== name))));
  const apply = () => {
    const plan = planImport(look.custom, usable.filter((r) => ticked.has(r.scheme!.name)).map((r) => r.scheme!));
    if (plan.added.length || plan.replaced.length) onChange({ ...look, custom: plan.custom });
    setResult(planSummary(plan));
    setIncoming([]);
    setTicked(new Set());
  };
  return (
    <div className="scheme-import">
      <label className="scheme-add">
        <span>Bring in from Warp or Ghostty</span>
        <input type="file" aria-label="Warp theme or Ghostty configuration files" multiple accept=".yaml,.yml,.conf,.config,text/plain,*" onChange={(e) => void read(e.target.files).finally(() => (e.target.value = ""))} />
      </label>
      <p className="conn-detail">Pick Warp theme files (.yaml) or your Ghostty configuration file. Nothing changes until you tick schemes and apply.</p>
      {incoming.length > 0 && (
        <div role="group" aria-label="Schemes to bring in">
          {usable.length > 1 && (
            <label className="conn-switch">
              <input type="checkbox" aria-label="Select all" checked={ticked.size === usable.length} onChange={(e) => setTicked(e.target.checked ? new Set(usable.map((r) => r.scheme!.name)) : new Set())} />
              <span>Select all</span>
            </label>
          )}
          {incoming.map((r) =>
            r.scheme && !r.same ? (
              <label key={r.file} className="conn-switch scheme-incoming">
                <input type="checkbox" aria-label={`Bring in ${r.scheme.name}`} checked={ticked.has(r.scheme.name)} onChange={(e) => toggle(r.scheme!.name, e.target.checked)} />
                <span className="scheme-swatch" style={{ background: r.scheme.background, color: r.scheme.foreground }}>
                  Aa
                  {(["red", "green", "yellow", "blue"] as const).map((k) => (
                    <i key={k} style={{ background: r.scheme![k] }} />
                  ))}
                </span>
                <span>
                  {r.scheme.name}
                  <small>{look.custom.some((c) => c.name.toLowerCase() === r.scheme!.name.toLowerCase()) ? `Replaces your scheme ${r.scheme.name}.` : "Joins your custom schemes."}</small>
                </span>
              </label>
            ) : (
              <p key={r.file} className={r.same ? "conn-detail" : "conn-detail warn"}>
                {r.file}: {r.same ? "already matches your current terminal colours, so there is nothing to apply." : r.problem}
              </p>
            ),
          )}
          <div className="btn-row">
            <button type="button" className="btn" disabled={ticked.size === 0} onClick={apply}>
              Bring in {ticked.size || ""}
            </button>
            <button type="button" className="btn" onClick={() => setIncoming([])}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {result && <p className="conn-detail">{result}</p>}
    </div>
  );
}

function TerminalColours({ look, onChange }: { look: Appearance; onChange: (a: Appearance) => void }) {
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState("");
  const [problem, setProblem] = useState("");
  const add = () => {
    try {
      const s = importScheme(paste);
      if (look.custom.some((c) => c.name.toLowerCase() === s.name.toLowerCase())) throw new Error(`You already have a scheme called ${s.name}.`);
      onChange({ ...look, custom: [...look.custom, s] });
      setPaste("");
      setProblem("");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };
  const remove = (id: string) => {
    const custom = look.custom.filter((c) => "custom:" + c.name !== id);
    const tidy = readAppearance(writeAppearance({}, { ...look, custom }));
    onChange(tidy);
  };
  return (
    <>
      <input className="scheme-search" type="search" maxLength={80} placeholder="Search schemes" aria-label="Search schemes" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="scheme-cols">
        <SchemeList label="Dark mode" options={schemeOptions(look, true)} query={query} value={look.terminal} onPick={(terminal) => onChange({ ...look, terminal })} onRemove={remove} />
        <SchemeList label="Light mode" options={schemeOptions(look, false)} query={query} value={look.lightScheme} disabled={!look.lightTerminal} onPick={(lightScheme) => onChange({ ...look, lightScheme })} onRemove={remove} />
      </div>
      <p className="conn-detail">Match app theme works the terminal background, text and colours out of the app's colour, and follows it as it changes.</p>
      <label className="conn-switch">
        <input type="checkbox" role="switch" checked={look.lightTerminal} onChange={(e) => onChange({ ...look, lightTerminal: e.target.checked })} />
        <span>
          Light scheme in light mode
          <small>Terminals turn light with the app. Off keeps the dark mode scheme in both modes.</small>
        </span>
      </label>
      <label className="scheme-add">
        <span>Add a scheme</span>
        <textarea rows={3} placeholder='Paste a Windows Terminal scheme, e.g. { "name": "Mine", "background": "#101010", ... }' value={paste} onChange={(e) => setPaste(e.target.value)} />
      </label>
      <button type="button" className="menu-item scheme-add-btn" disabled={!paste.trim()} onClick={add}>
        Add scheme
      </button>
      {problem && <p className="conn-detail warn">{problem}</p>}
      <SchemeImport look={look} onChange={onChange} />
    </>
  );
}

/** USAGE-025: how plan usage percentages read. Only the Agents screen's usage footer follows it. */
export function UsagePercentPick({ value, onPick }: { value: PercentMode; onPick: (v: PercentMode) => void }) {
  return (
    <>
      <div className="look-select">
        <span>Usage percentages</span>
        <select aria-label="Usage percentages" className="field" value={value} onChange={(e) => onPick(percentMode(e.target.value))}>
          <option value="used">Used</option>
          <option value="remaining">Remaining</option>
        </select>
      </div>
      <p className="conn-detail">How the Agents screen's usage footer reads plan use; the top bar always shows what is left.</p>
    </>
  );
}

/** SET-020: the app name, the Tasks and Automations buttons, and the status bar with its items.
 *  VIEW-096: a status bar hidden from its right-click menu comes back here. */
function WindowSwitches({ settings, error, save }: ReturnType<typeof useSettings>) {
  if (!settings) return null;
  const bar = readStatusBar(settings);
  return (
    <>
      <section className="conn-card" data-section="card-density">
        <CardDensityBody settings={settings} save={(p) => void save(p)} />
      </section>
      <section className="conn-card" data-section="window-items">
        <h2 className="conn-name">Title bar and sidebar</h2>
        {CHROME.map((c) => (
          <label key={c.id} className="conn-switch">
            <input type="checkbox" role="switch" checked={chromeShown(settings, c.id)} onChange={(e) => void save({ [c.id]: e.target.checked })} />
            <span>{c.label}</span>
          </label>
        ))}
      </section>
      <section className="conn-card" data-section="status-bar">
        <h2 className="conn-name">Status bar</h2>
        <label className="conn-switch">
          <input type="checkbox" role="switch" checked={bar.visible} onChange={(e) => void save({ [STATUS_FIELDS.visible]: e.target.checked })} />
          <span>
            Show status bar
            <small>Or right-click the bar to choose which items it shows.</small>
          </span>
        </label>
        <div className="status-ticks" aria-label="Status bar items">
          {STATUS_ITEMS.map((i) => (
            <label key={i.id} className={bar.visible ? "status-tick" : "status-tick off"}>
              <input type="checkbox" disabled={!bar.visible} checked={!bar.hidden.includes(i.id)} onChange={() => void save({ [STATUS_FIELDS.hidden]: toggleItem(bar.hidden, i.id) })} />
              {i.label}
            </label>
          ))}
        </div>
        <UsagePercentPick value={percentMode(settings[PERCENT_FIELD])} onPick={(v) => void save({ [PERCENT_FIELD]: v })} />
        {error && <p className="conn-detail warn">{error}</p>}
      </section>
    </>
  );
}


export default function AppearancePage() {
  const [look, setLook] = useState<Appearance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = useSettings();
  const timer = useRef<number | undefined>(undefined);
  // SET-036: a change still waiting out the pause is written when the page goes away or the window closes, not dropped.
  const waiting = useRef<Appearance | null>(null);
  // T-598 (F02-settings-update.3): the look as stored when the waiting change began. A save writes only the
  // fields that differ from it, so one another page saved meanwhile (the Terminal card's font size) stays.
  const base = useRef<Appearance | null>(null);
  // Saves run one after another: each one diffs against the base the save before it left, so a change made
  // while a slow save is still open is written too (100 -> 0 saving, back to 100: the 100 is sent), and saves
  // never land out of order.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const flush = () => {
    window.clearTimeout(timer.current);
    const next = waiting.current;
    waiting.current = null;
    if (!next) return;
    chain.current = chain.current.then(async () => {
      const from = base.current;
      if (!from) return;
      const changed = settingsDiff(writeAppearance({}, from), writeAppearance({}, next)).set;
      if (Object.keys(changed).length === 0) return;
      try {
        await saveChanged({}, changed);
        base.current = next;
        setError(null);
      } catch (e) {
        setError(String(e)); // the base stays, so the next change tries these fields again
      }
    });
  };
  useLeaveSave(flush);
  // The page shows what is stored and follows saves made on any page or window, except while its own change waits.
  useEffect(() => {
    if (!status.settings || waiting.current) return;
    base.current = readAppearance(status.settings);
    setLook(base.current);
  }, [status.settings]);
  const change = (next: Appearance) => {
    setLook(next);
    applyAppearance(next);
    window.clearTimeout(timer.current);
    waiting.current = next;
    timer.current = window.setTimeout(flush, 250);
  };
  const shown = error ?? (look ? null : status.error); // a first read that failed; later ones show in the Window card
  return (
    <>
      {shown && <p className="conn-detail warn">{shown}</p>}
      {look && <AppearanceView look={look} onChange={change} languagePart={status.settings && <LanguageView value={savedLanguage(status.settings[LANGUAGE_FIELD])} onPick={(v) => { applyLanguage(v); void status.save({ [LANGUAGE_FIELD]: v }); }} />} windowPart={<WindowSwitches {...status} />} windowSummary={status.settings ? windowSummary(status.settings) : ""} />}
      {look && <AppLookCard />}
    </>
  );
}
