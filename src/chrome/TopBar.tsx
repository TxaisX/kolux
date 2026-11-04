// The 36 px top bar (DESIGN.md section 4): app mark, overflow, sidebar toggle, back/forward on
// the left; the centred Agents / Board / Terminals switcher; panel toggle, search hint, bell,
// usage pill and the window's own minimize / maximize / close on the right. The bar is the
// window's drag region (the window has no OS title bar): T-620, a press anywhere on it that is not a
// control moves the window ("deep"); the switcher's frame and the pop-up menus drawn inside the bar opt
// out ("false"), so a press that just misses a segment does not move the window and a click on a
// menu's backdrop still closes it. The search box shows the palette chord
// from the keymap (T-005), so an edit to ~/.kolux/keybindings.json changes the chips.
import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, ArrowRight, Bell, Clock, Close, Mark, Maximize, Minimize, PanelLeft, PanelRight, Restore, Search } from "./icons";
import { Kbd } from "../keys/KeymapContext";
import UsagePill from "../usage/UsagePill";
import AccountSwitcher from "../switcher/AccountSwitcher";
import { weeklyOf } from "../usage/claude";
import { usePlan } from "../usage/plan";
import { APP_MENU_FAILED, popAppMenu } from "./useChrome";
import { chromeLayout } from "./titleHeader";
import { t } from "../i18n/lookup";
import { useSettings } from "../settings/useSettings";
import { readStatusBar, usagePills } from "./statusItems";

/** Artifacts is reached from the sidebar only, so it is not in the top bar's cycle. */
/** The three switcher screens, and the Inbox behind the bell (STAT-050: its own top-level view).
 *  T-610: every one is reached from the switcher or the palette (chrome/reach.ts, reach.test.ts). */
export const SCREEN_IDS = ["agents", "board", "terminals", "artifacts", "inbox", "tower", "floor", "skills", "space"] as const;
export type Screen = (typeof SCREEN_IDS)[number];
export const screens: Array<{ id: Screen; label: string }> = [
  { id: "agents", label: "Agents" },
  { id: "board", label: "Board" },
  { id: "terminals", label: "Terminals" },
  { id: "tower", label: "Tower" },
];

/** `classic` (SET-037): the Classic look has no screen switcher; the window stays on Terminals.
 * `sidebarWidth` (T-049-c): Classic draws a title header exactly as wide as the left sidebar card, so it follows the card. */
/** `automations` (VIEW-011): the Automations page button, present only when it is turned on in Settings > Appearance. */
export type TopBarProps = { screen: Screen; classic?: boolean; sidebarWidth?: number; onScreen: (s: Screen) => void; sidebarOpen: boolean; onToggleSidebar: () => void; rightOpen: boolean; onToggleRight: () => void; appName?: boolean; automations?: { open: boolean; onToggle: () => void }; installed?: string[]; onSearch?: () => void; onBack?: () => void; onForward?: () => void; onZoom?: (how: "in" | "out" | "reset") => void; fullPage?: boolean; codexAccount?: boolean; appMenu?: boolean; uiZoom?: number; needsYou?: number; onNotice?: (text: string) => void };

/** The bell opens the Inbox, and closes it back to the screen that was showing before (never past it to Terminals). */
export const bellTarget = (screen: Screen, before: Screen): Screen => (screen === "inbox" ? before : "inbox");

/** TERM-078: the overflow menu's View section; each item names its keybinding id. */
export const VIEW_ITEMS = [
  { id: "zoom.in", how: "in", label: "Zoom In" },
  { id: "zoom.out", how: "out", label: "Zoom Out" },
  { id: "zoom.reset", how: "reset", label: "Reset Size" },
] as const;

/** `appName` (SET-020): the app name beside the mark, off by default (DT-A6). */
export default function TopBar({ screen, classic = false, sidebarWidth, onScreen, sidebarOpen, onToggleSidebar, rightOpen, onToggleRight, appName = false, automations, installed = [], onSearch, onBack, onForward, onZoom, fullPage = false, codexAccount = false, appMenu = false, uiZoom = 1, needsYou = 0, onNotice }: TopBarProps) {
  // The screen the bell returns to when the Inbox is closed: the one that was showing before it opened.
  const before = useRef<Screen>("terminals");
  if (screen !== "inbox") before.current = screen;
  const [maximized, setMaximized] = useState(false);
  const [menuAt, setMenuAt] = useState<{ top: number; left: number } | null>(null);
  // USAGE-008 / VIEW-008: a pill per provider, only with a weekly figure (or Codex's refused
  // sign-in) and an installed CLI; with neither, nothing is drawn. T-550: the pill is one button
  // that opens Settings > Accounts & keys (Ctrl+, still opens Settings, app.settings).
  const plan = usePlan();
  const { settings } = useSettings();
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
          title={appMenu ? "Kolux menu" : "Kolux RS"}
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
        <button
          className="ib dots"
          title="Terminal zoom"
          aria-label="Terminal zoom"
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ top: r.bottom + 4, left: r.left });
          }}
        >
          <Search d="M5 7h4M7 5v4" />
        </button>
        {menuAt && (
          <>
            <div className="menu-backdrop" onClick={() => setMenuAt(null)} aria-hidden="true" data-tauri-drag-region="false" />
            <div className="menu" role="menu" aria-label="Terminal zoom" style={menuAt} onKeyDown={(e) => e.key === "Escape" && setMenuAt(null)} data-tauri-drag-region="false">
              <div className="menu-title">Terminal zoom</div>
              {VIEW_ITEMS.map((i, n) => (
                <button key={i.id} role="menuitem" className="menu-item" autoFocus={n === 0} disabled={!onZoom} title={`${i.label} the focused terminal`} onClick={() => (setMenuAt(null), onZoom?.(i.how))}>
                  <span className="name">{i.label}</span>
                  <Kbd id={i.id} />
                </button>
              ))}
            </div>
          </>
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
            <button key={s.id} aria-pressed={screen === s.id} onClick={() => onScreen(s.id)}>
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
        <button className="ib panel" hidden={fullPage} title={rightOpen ? "Hide the right panel" : "Show the right panel"} aria-pressed={rightOpen} onClick={onToggleRight}>
          <PanelRight />
        </button>
        <button className="searchbox" title="Jump to a workspace, tab, project or setting" onClick={onSearch}>
          <Search />
          <span className="ph">Search</span>
          <Kbd id="worktree.palette" />
        </button>
        <button className="ib bell" aria-label={needsYou > 0 ? t(needsYou === 1 ? "inbox.bell.needs.one" : "inbox.bell.needs.many", { count: needsYou }) : "Inbox"} title="Inbox" aria-pressed={screen === "inbox"} onClick={() => onScreen(bellTarget(screen, before.current))}>
          <Bell />
          {needsYou > 0 && <span className="bell-count" aria-hidden="true">{needsYou > 99 ? "99+" : needsYou}</span>}
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
