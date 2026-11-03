// VIEW-056 / VIEW-057 (T-146-a): one right sidebar on the Terminals screen. It holds the Explorer
// and Insights as tabs (T-646: tokens, estimated cost and what every session is doing, across all
// workspaces; it replaced Source Control, T-644), opens with Ctrl+L, and comes back after a restart open or closed, on
// the same tab and at the same width; its left edge drags to resize. VIEW-073 adds Checks; Agents,
// Search, the More overflow and folder-workspace tabs come with T-146-b. VIEW-050 (T-051): the left
// sidebar's width lives here too, and both sidebars resize by the same Grip.
// VIEW 057 rest (T-146-b): when the sidebar is too narrow for every tab, the extra tabs move into a
// More menu while the active tab stays on the strip; a remembered tab that is not offered here opens
// the first offered one; and if a panel's code throws, the panel shows a plain notice with Try again
// while the rest of the window keeps running (VIEW 056 rest). The Agents, Search and folder-workspace
// tabs are T-146-g.
import { Component, useEffect, useRef, useState, type ErrorInfo, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useMenuFocus } from "./dialogFocus";
import { menuStep } from "../terminal/LinkActionMenu";
import { NARROW_PX } from "../shell/window/narrow";

export type RightTab = "explorer" | "insights" | "checks" | "agents" | "attached" | "prchecks";
export const RIGHT_TABS: { id: RightTab; label: string; hint: string }[] = [
  { id: "explorer", label: "Explorer", hint: "Explorer (Ctrl+Shift+E)" },
  { id: "insights", label: "Insights", hint: "Tokens, estimated cost and what every session is doing, across all workspaces" },
  { id: "checks", label: "Checks", hint: "Checks on this workspace's pull request" },
  { id: "attached", label: "Attached", hint: "Worktrees attached to this folder (folder workspaces)" },
  { id: "prchecks", label: "PR Checks", hint: "Pull request checks of the attached worktrees (folder workspaces)" },
  { id: "agents", label: "Agents", hint: "Past agent sessions: search, resume, copy the resume command" },
];
export const RIGHT_KEYS = { open: "rightSidebarOpen", tab: "rightSidebarTab", width: "rightSidebarWidth" } as const;
export const RIGHT_MIN = 240;
const RIGHT_DEFAULT = 300;
/** What the workspace keeps beside the sidebars, so the panes never vanish. */
const RESERVED = 400;

export function readRight(s: Record<string, unknown>): { open: boolean; tab: RightTab; width: number } {
  const w = s[RIGHT_KEYS.width];
  return {
    open: s[RIGHT_KEYS.open] !== false,
    // an older saved "search" or "scm" (Source Control, removed in T-644) tab, or any other unknown one, opens the Explorer
    tab: RIGHT_TABS.some((t) => t.id === s[RIGHT_KEYS.tab]) ? (s[RIGHT_KEYS.tab] as RightTab) : "explorer",
    width: typeof w === "number" && Number.isFinite(w) && w >= RIGHT_MIN ? Math.round(w) : RIGHT_DEFAULT,
  };
}

/** T-146-b: the room one tab takes on the strip with its gap, estimated from its label (12px UI
 * font; measured live: Explorer 65, Checks 59, More 50 px, 2 px gaps). */
export const tabWidth = (label: string) => Math.ceil(label.length * 5.4) + 30;
/** The More button's own room on the strip. */
export const MORE_WIDTH = 52;
/** The strip's side padding and the sidebar's own edge. */
export const STRIP_PAD = 8;

/** T-146-b: which of `tabs` sit on the strip at `width` and which go into the More menu. Tabs keep
 * their order; the active tab is never in the menu: when it would be, it takes the last strip slot
 * that fits it and the tab there moves into the menu instead. */
export function splitTabs<T extends { id: string; label: string }>(tabs: T[], active: string, width: number): { shown: T[]; more: T[] } {
  const total = tabs.reduce((n, t) => n + tabWidth(t.label), 0);
  if (total <= width - STRIP_PAD) return { shown: tabs, more: [] };
  const room = width - STRIP_PAD - MORE_WIDTH;
  const act = tabs.find((t) => t.id === active);
  const shown: T[] = [];
  let used = act ? tabWidth(act.label) : 0;
  for (const t of tabs) {
    if (t === act) continue;
    if (used + tabWidth(t.label) > room) break;
    shown.push(t);
    used += tabWidth(t.label);
  }
  if (act) shown.push(act);
  const order = (t: T) => tabs.indexOf(t);
  shown.sort((a, b) => order(a) - order(b));
  return { shown, more: tabs.filter((t) => !shown.includes(t)) };
}

/** T-146-b: the tab to show: the remembered one when it is offered here, else the first offered. */
/** The tab a key moves to from the one at `at` of `count`: Left and Right wrap, Home and End jump; null for any other key. */
export const tabStep = (count: number, at: number, key: string): number | null => key === "ArrowRight" ? menuStep(count, at, "ArrowDown") : key === "ArrowLeft" ? menuStep(count, at, "ArrowUp") : key === "Home" || key === "End" ? menuStep(count, at, key) : null;

export const pickTab = (remembered: RightTab, offered: RightTab[]): RightTab | null => (offered.includes(remembered) ? remembered : (offered[0] ?? null));

/** VIEW 056 rest: a panel whose code throws (or fails to load) is caught here; the notice says so
 * in one sentence and Try again draws the panel afresh. Switching tabs also starts afresh. */
export class PanelGuard extends Component<{ tab: string; children: ReactNode }, { failed: string | null; tab: string }> {
  state = { failed: null as string | null, tab: this.props.tab };
  static getDerivedStateFromError(err: unknown) {
    return { failed: err instanceof Error ? err.message : String(err) };
  }
  static getDerivedStateFromProps(props: { tab: string }, state: { failed: string | null; tab: string }) {
    return props.tab === state.tab ? null : { failed: null, tab: props.tab };
  }
  componentDidCatch(err: unknown, info: ErrorInfo) {
    console.error("right sidebar panel failed", err, info.componentStack);
  }
  render() {
    if (this.state.failed === null) return this.props.children;
    return (
      <div className="sb-hint warn" role="alert">
        <p>This panel stopped working and was closed; the rest of Kolux keeps running. ({this.state.failed})</p>
        <button type="button" className="btn" onClick={() => this.setState({ failed: null })}>
          Try again
        </button>
      </div>
    );
  }
}

/** The width actually used: at least the minimum, and never into the workspace's reserved room. T-719 (DT-C155): under
 *  NARROW_PX the left sidebar is stepped aside (T-699), so its width does not count. */
export const clampWidth = (w: number, windowWidth: number, leftWidth: number) => Math.max(RIGHT_MIN, Math.min(w, windowWidth - (windowWidth < NARROW_PX ? 0 : leftWidth) - RESERVED));

export const LEFT_KEY = "leftSidebarWidth";
export const LEFT_MIN = 220;
export const LEFT_MAX = 480;
export const LEFT_DEFAULT = 289;
export const clampLeft = (w: number) => Math.round(Math.max(LEFT_MIN, Math.min(LEFT_MAX, w)));
/** VIEW-050: a saved left width is clamped into range; anything that is not a number keeps `current`. */
export function readLeft(s: Record<string, unknown>, current = LEFT_DEFAULT): number {
  const w = s[LEFT_KEY];
  return typeof w === "number" && Number.isFinite(w) ? clampLeft(w) : current;
}

/** A sidebar's drag edge. `side` is where the sidebar sits: dragging away from it widens it. T-711 (DT-C147): it is also
 *  a focusable separator: Left/Right move it 16 px (Shift: 64), Home/End go to `min`/`max`, each step saved; the
 *  caller's onWidth clamps keys and drags alike, and styles.css keeps T-703's workspace floor. */
export function Grip({ side, width, min, max, label, className, onWidth }: { side: "left" | "right"; width: number; min: number; max: number; label: string; className: string; onWidth: (w: number, done: boolean) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const dir = side === "left" ? 1 : -1; // which way of the pointer or arrow key widens it
  const at = (x: number) => (drag.current ? drag.current.w + dir * (x - drag.current.x) : width);
  // T-703 (DT-C139): the width as drawn, which styles.css may have narrowed below `width`. The left grip sits right after
  // ProjectsPanel's .sidebar-wrap (shell/window/Sidebar.tsx renders both on one condition); the right one is inside aside.rside.
  const drawn = (el: Element) => (side === "left" ? (el.previousElementSibling as HTMLElement).offsetWidth - 8 : (el.parentElement as HTMLElement).offsetWidth);
  return (
    <div
      className={className}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      onKeyDown={(e) => {
        // Home/End ask for far past either end and the caller's clamp lands on min/max (first-load budget: no branch per key).
        const d = ({ ArrowLeft: -dir * 16, ArrowRight: dir * 16, Home: -1e5, End: 1e5 } as Record<string, number>)[e.key];
        if (!d) return;
        e.preventDefault();
        onWidth(drawn(e.currentTarget) + d * (e.shiftKey ? 4 : 1), true);
      }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, w: drawn(e.currentTarget) };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => drag.current && onWidth(at(e.clientX), false)}
      onPointerUp={(e) => {
        if (!drag.current) return;
        onWidth(at(e.clientX), true);
        drag.current = null;
      }}
    />
  );
}

type Props = { tab: RightTab; width: number; max: number; hidden?: boolean; offered?: RightTab[]; onTab: (t: RightTab) => void; onWidth: (w: number, done: boolean) => void; children: ReactNode };

export default function RightSidebar({ tab, width, max, hidden = false, offered, onTab, onWidth, children }: Props) {
  const tabs = offered ? RIGHT_TABS.filter((t) => offered.includes(t.id)) : RIGHT_TABS;
  const current = pickTab(tab, tabs.map((t) => t.id));
  const { shown, more } = splitTabs(tabs, current ?? "", width);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (current !== null && current !== tab) onTab(current);
  }, [current, tab]);
  // The More menu takes focus, answers the arrow keys, and Escape closes it before the terminal sees the key.
  const moreMenu = useRef<HTMLDivElement>(null);
  useMenuFocus(moreMenu, menu !== null, () => setMenu(null));
  // Only the open tab is a tab stop; Left, Right, Home and End move between the tabs and open the one reached.
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const tabEls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
    const to = tabStep(tabEls.length, tabEls.indexOf(document.activeElement as HTMLElement), e.key);
    if (to === null) return;
    e.preventDefault();
    tabEls[to].focus();
    onTab(shown[to].id);
  };
  return (
    <aside className="rside" aria-label="Right sidebar" hidden={hidden} style={{ width }}>
      <Grip side="right" width={width} min={RIGHT_MIN} max={max} label="Resize the right sidebar" className="rside-grip" onWidth={onWidth} />
      <div className="rside-tabs" role="tablist" aria-label="Right sidebar tabs" onKeyDown={onTabKey}>
        {shown.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={t.id === current} tabIndex={t.id === current ? 0 : -1} title={t.hint} className="rside-tab" onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
        {more.length > 0 && (
          <button
            type="button"
            className="rside-tab rside-more"
            title={`More: ${more.map((t) => t.label).join(", ")}`}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu(menu ? null : { x: Math.max(8, r.right - 230), y: r.bottom + 4 });
            }}
          >
            More
          </button>
        )}
      </div>
      {menu && more.length > 0 && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(null)} aria-hidden="true" />
          <div ref={moreMenu} className="menu" role="menu" aria-label="More tabs" style={{ left: menu.x, top: menu.y }}>
            {more.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                className="menu-item"
                title={t.hint}
                onClick={() => {
                  setMenu(null);
                  onTab(t.id);
                }}
              >
                <span className="name">{t.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="rside-body" role="tabpanel" aria-label={tabs.find((t) => t.id === current)?.label}>
        <PanelGuard tab={current ?? ""}>{children}</PanelGuard>
      </div>
    </aside>
  );
}
