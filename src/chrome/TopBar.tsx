// The 36 px top bar (DESIGN.md section 4): app mark, overflow, sidebar toggle, back/forward on
// the left; the centred Agents / Terminals switcher; panel toggle, search hint,
// usage pill and the window's own minimize / maximize / close on the right. The bar is the
// window's drag region (the window has no OS title bar): T-620, a press anywhere on it that is not a
// control moves the window ("deep"); the switcher's frame and the pop-up menus drawn inside the bar opt
// out ("false"), so a press that just misses a segment does not move the window and a click on a
// menu's backdrop still closes it. The search box shows the palette chord
// from the keymap (T-005), so an edit to ~/.kolux/keybindings.json changes the chips.
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, ArrowRight, Clock, Close, Mark, Maximize, Minimize, PanelLeft, PanelRight, Restore, Search } from "./icons";
import { Kbd, useKeymap } from "../keys/KeymapContext";
import { usePaletteHint } from "../keys/paletteKey";
import UsagePill from "../usage/UsagePill";
import AccountSwitcher from "../switcher/AccountSwitcher";
import { weeklyOf } from "../usage/claude";
import { usePlan } from "../usage/plan";
import { APP_MENU_FAILED, popAppMenu } from "./useChrome";
import { chromeLayout } from "./titleHeader";
import { usePackLoaded } from "../shell/usePackLoaded";
import { useSettings } from "../settings/useSettings";
import { readStatusBar, usagePills } from "./statusItems";
import { AgentsPanel, Explorer } from "../lazy/pages";

/** The surface each control opens, read on hover and focus so the click draws it in its own frame. A screen
 *  not listed here (Terminals) has nothing to read. */
const screenWarm: Partial<Record<Screen, () => void>> = { agents: AgentsPanel.warm };

/** Artifacts is reached from the sidebar only, so it is not in the top bar's cycle. */
/** The switcher screens. T-610: every one is reached from the switcher or the palette (chrome/reach.ts, reach.test.ts). */
export const SCREEN_IDS = ["agents", "terminals", "artifacts", "skills"] as const;
export type Screen = (typeof SCREEN_IDS)[number];
export const screens: Array<{ id: Screen; label: string }> = [
  { id: "agents", label: "Agents" },
  { id: "terminals", label: "Terminals" },
];

/** `classic` (SET-037): the Classic look has no screen switcher; the window stays on Terminals.
 * `sidebarWidth` (T-049-c): Classic draws a title header exactly as wide as the left sidebar card, so it follows the card. */
/** `automations` (VIEW-011): the Automations page button, present only when it is turned on in Settings > Appearance. */
export type TopBarProps = { screen: Screen; classic?: boolean; sidebarWidth?: number; onScreen: (s: Screen) => void; sidebarOpen: boolean; onToggleSidebar: () => void; rightOpen: boolean; onToggleRight: () => void; appName?: boolean; automations?: { open: boolean; onToggle: () => void }; installed?: string[]; onSearch?: () => void; onBack?: () => void; onForward?: () => void; fullPage?: boolean; codexAccount?: boolean; appMenu?: boolean; uiZoom?: number; onNotice?: (text: string) => void };

/** `appName` (SET-020): the app name beside the mark, off by default (DT-A6). */
export default function TopBar({ screen, classic = false, sidebarWidth, onScreen, sidebarOpen, onToggleSidebar, rightOpen, onToggleRight, appName = false, automations, installed = [], onSearch, onBack, onForward, fullPage = false, codexAccount = false, appMenu = false, uiZoom = 1, onNotice }: TopBarProps) {
  usePackLoaded();
  const [maximized, setMaximized] = useState(false);
  // USAGE-008 / VIEW-008: a pill per provider, only with a weekly figure (or Codex's refused
  // sign-in) and an installed CLI; with neither, nothing is drawn. T-550: the pill is one button
  // that opens Settings > Accounts & keys (Ctrl+, still opens Settings, app.settings).
  const plan = usePlan();
  const { settings } = useSettings();
  const keymap = useKeymap();
  const paletteKeys = usePaletteHint(keymap); // Ctrl+K only while it would open the palette from where the focus is
  // The usage items in the status-bar list (Settings > Appearance) switch each provider off here.
  const { claude: claudeOn, codex: codexOn, any: anyPill } = usagePills({
    claudeInstalled: installed.includes("claude"),
    claudeWeekly: !!weeklyOf(plan.claude),
    // T-543-b: the Codex pill needs a Codex account, not only the CLI installed.
    codexInstalled: installed.includes("codex"),
    codexAccount,
    codexFigure: !!(plan.codex?.weekly || plan.codex?.state === "sign-in-again"),
    hidden: readStatusBar(settings ?? {}).hidden,
  });
  useEffect(() => {
    const win = getCurrentWindow();
    let stop = () => {};
    win.isMaximized().then(setMaximized).catch(() => {});
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((un) => (stop = un))
      .catch(() => {});
    return () => stop();
  }, []);
  const win = () => getCurrentWindow();
  // T-049-c / VIEW-003: Classic wears a sidebar-width title header and no top bar.
  const layout = chromeLayout(classic, sidebarOpen, sidebarWidth);

  return (
    <header className={layout.bar} data-tauri-drag-region="deep">
      <div className="topbar-left" style={layout.headerWidth === null ? undefined : { width: layout.headerWidth }}>
        {/* APP-009 / T-248-a: the Kolux mark opens the app menu (File, Edit, View, Window, Help). */}
        <button
          className="ib mark"
          title={appMenu ? "Kolux menu" : "Kolux"}
          aria-haspopup={appMenu ? "menu" : undefined}
          disabled={!appMenu}
          // The mark never takes focus, so Edit acts on the field or terminal that had it.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            popAppMenu(r.left, r.bottom + 4, uiZoom, () => onNotice?.(APP_MENU_FAILED));
          }}
        >
          <Mark />
        </button>
        {appName && (
          <span className="app-name">Kolux</span>
        )}
        <button className="ib panel" title={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-pressed={sidebarOpen} onClick={onToggleSidebar}>
          <PanelLeft />
        </button>
        <button className="ib back" title="Back to the last workspace or page shown" disabled={!onBack} onClick={onBack}>
          <ArrowLeft size={12} />
        </button>
        <button className="ib fwd" title="Forward" disabled={!onForward} onClick={onForward}>
          <ArrowRight size={12} />
        </button>
      </div>

      {layout.switcher && (
        <nav className="switcher" aria-label="Screen" data-tauri-drag-region="false">
          {screens.map((s) => (
            <button key={s.id} aria-pressed={screen === s.id} onPointerEnter={screenWarm[s.id]} onFocus={screenWarm[s.id]} onClick={() => onScreen(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
      )}

      <div className="topbar-right">
        {automations && (
          <button className="ib" title="Automations" aria-pressed={automations.open} onClick={automations.onToggle}>
            <Clock />
          </button>
        )}
        {/* VIEW-009: while a full page shows, the right sidebar and its control are hidden. */}
        <button className="ib panel" data-testid="right-sidebar-toggle" hidden={fullPage} title={rightOpen ? "Hide the right panel" : "Show the right panel"} aria-pressed={rightOpen} onPointerEnter={Explorer.warm} onFocus={Explorer.warm} onClick={onToggleRight}>
          <PanelRight />
        </button>
        <button className="searchbox" title="Go to a workspace, tab, project or setting, or run a command" onClick={onSearch}>
          <Search />
          <span className="ph">Go to / Run a command</span>
          <Kbd id="worktree.palette" shown={paletteKeys} />
        </button>
        <AccountSwitcher />
        <UsagePill hidden={!anyPill} claudeOn={claudeOn} codexOn={codexOn} />
        <div className="wc">
          <button title="Minimize" onClick={() => win().minimize()}>
            <Minimize size={16} />
          </button>
          <button title={maximized ? "Restore" : "Maximize"} onClick={() => win().toggleMaximize()}>
            {maximized ? <Restore size={16} /> : <Maximize size={16} />}
          </button>
          <button className="close" title="Close" onClick={() => win().close()}>
            <Close size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
