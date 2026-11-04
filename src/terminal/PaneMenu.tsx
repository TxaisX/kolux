// The pane menu (TERM-025 / TERM-035): the header's "..." button and a right-click on the header or
// inside the pane open it. paneMenuItems() decides which items apply and in what order (tested in
// PaneMenu.test.ts); the component only draws them, keeps them on screen and dismisses on Escape or
// an outside click, never on the click that opened it.
import { Fragment, useLayoutEffect, useRef, type CSSProperties } from "react";
import { useMenuFocus } from "../chrome/dialogFocus";
import { useLabel } from "../keys/KeymapContext";

export type MenuItem = {
  id: string;
  name: string;
  /** The keybinding id whose chord is shown beside the name, once one is assigned. */
  key?: string;
  run: () => void;
  title?: string;
  /** TERM-035: Close Pane reads as destructive. */
  danger?: boolean;
  /** Items of one group sit together; a rule is drawn between groups. */
  group: number;
};

/** What the pane can do right now; an item whose handler is missing, or that does not apply, is left out. */
export type MenuContext = {
  /** Copy appears only when text is selected. */
  selected: boolean;
  expanded: boolean;
  /** Expand / Collapse appears only when the pane can expand (a lone classic pane cannot). */
  canExpand: boolean;
  onCopy?: () => void;
  onSelectAll?: () => void;
  onPaste?: () => void;
  /** Agent actions, in order. */
  agentActions?: { id: string; name: string; title?: string; run: () => void }[];
  onSplit?: (dir: "right" | "down") => void;
  /** Given only when the grid is split into more than one pane. */
  onEqualize?: () => void;
  /** TERM-016: given when the pane has a neighbouring cell to fold into as a tab. */
  onMoveToTab?: () => void;
  onExpand?: () => void;
  onSetTitle?: () => void;
  /** Clear Title appears only when the pane has a title of its own. */
  hasTitle: boolean;
  onClearTitle?: () => void;
  copyIds?: { id: string; name: string; run: () => void }[];
  onDiagnostics?: () => void;
  /** Close Pane appears only when the pane can be closed. */
  onClose?: () => void;
  onClear?: () => void;
  onFind?: () => void;
};

/** TERM-035 order: Copy, Select All, Paste; agent actions; Split Right, Split Down, Equalize, Expand / Collapse;
 * Set Title, Clear Title; copy ids; diagnostics; Clear Screen, Find; Close Pane last, apart. */
export function paneMenuItems(c: MenuContext): MenuItem[] {
  const out: MenuItem[] = [];
  const add = (group: number, id: string, name: string, run: (() => void) | undefined, more: Partial<MenuItem> = {}) => {
    if (run) out.push({ id, name, run, group, ...more });
  };
  add(0, "copy", "Copy", c.selected ? c.onCopy : undefined, { key: "terminal.copySelection" });
  add(0, "selectAll", "Select All", c.onSelectAll, { key: "terminal.selectAll" });
  add(0, "paste", "Paste", c.onPaste, { key: "terminal.paste" });
  for (const a of c.agentActions ?? []) add(1, a.id, a.name, a.run, { title: a.title });
  const split = c.onSplit;
  add(2, "splitRight", "Split Right", split && (() => split("right")), { key: "terminal.splitRight" });
  add(2, "splitDown", "Split Down", split && (() => split("down")), { key: "terminal.splitDown" });
  add(2, "equalize", "Equalize", c.onEqualize, { key: "terminal.equalizePaneSizes", title: "Gives every pane in the grid the same size" });
  add(2, "moveToTab", "Move to Tab", c.onMoveToTab, { title: "Moves this pane into the tab strip of the pane beside it; the program keeps running" });
  add(2, "expand", c.expanded ? "Collapse" : "Expand", c.canExpand ? c.onExpand : undefined, { key: "terminal.expandPane" });
  add(3, "setTitle", "Set Title…", c.onSetTitle, { key: "terminal.setTitle" });
  add(3, "clearTitle", "Clear Title", c.hasTitle ? c.onClearTitle : undefined, { key: "terminal.clearPaneTitle" });
  for (const i of c.copyIds ?? []) add(3, i.id, i.name, i.run);
  add(3, "diagnostics", "Copy terminal diagnostics", c.onDiagnostics, { title: "A scrubbed snapshot of this pane for a bug report, to the clipboard" });
  add(4, "clear", "Clear Screen", c.onClear, { key: "terminal.clear", title: "Clears the screen and the scrollback of this pane" });
  add(4, "find", "Find…", c.onFind, { key: "terminal.search", title: "Find text in this pane's screen and scrollback" });
  // UX audit terminal F5: the destructive item sits last, apart from the rest, so a slip of the hand lands elsewhere.
  // T-717 (DT-C153): the chord shown is tab.close's, which owns Mod+W and closes the focused pane.
  add(5, "close", "Close Pane", c.onClose, { key: "tab.close", danger: true, title: "Ends the program in this pane" });
  return out;
}

/** What clicking a menu item does: the menu goes first, then the action runs (so Close Pane's own question opens over a closed menu). */
export const chooseItem = (item: Pick<MenuItem, "run">, onDismiss: () => void): void => {
  onDismiss();
  item.run();
};

/** The click or right-click that opened the menu must not close it; anything after this long may. */
export const OPEN_GUARD_MS = 150;
export const outsideDismisses = (openedAt: number, now: number): boolean => now - openedAt >= OPEN_GUARD_MS;

/** Where a menu of `size` px starting at `at` sits so it stays inside a window of `limit` px. */
export const fitIn = (at: number, size: number, limit: number, margin = 8): number => Math.max(margin, Math.min(at, limit - size - margin));

/** T-710: the keys that open a context menu (Shift+F10 and the Menu key, with no Ctrl, Alt or Meta: those chords stay
 *  the program's). The terminal leaves them to the engine, which raises contextmenu on the focused element; the
 *  program in the pane never sees them. */
export const menuKey = (e: { key: string; shiftKey: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }): boolean =>
  !e.ctrlKey && !e.altKey && !e.metaKey && (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10"));

/** T-720: when a menu key last went down. Chromium marks the contextmenu a menu key raises with button -1; WebKit may
 *  give it button 2 like a mouse right-click, so a contextmenu right after a menu key counts as keyboard too. */
let menuKeyAt = -Infinity;
export const noteMenuKey = (e: Parameters<typeof menuKey>[0] & { timeStamp: number }): void => {
  if (menuKey(e)) menuKeyAt = e.timeStamp;
};
if (typeof window !== "undefined") window.addEventListener("keydown", noteMenuKey, true);
/** A contextmenu from the keyboard (opened at the focused item), not from the mouse (opened at the pointer). */
export const fromKeys = (e: { button: number; timeStamp: number }): boolean => e.button < 0 || e.timeStamp - menuKeyAt < 500;

/** The row to focus after `key` when `at` of `count` rows has focus (-1: none), or null when the key is not a menu key. */
export function menuStep(count: number, at: number, key: string): number | null {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return at < 0 ? 0 : (at + 1) % count;
  if (key === "ArrowUp") return at < 0 ? count - 1 : (at - 1 + count) % count;
  return null;
}

/** `text` with the chord in brackets once one is assigned ("Close pane (Ctrl+W)"); the bare text when there is none. */
export const withChord = (text: string, parts: string[]): string => (parts.length ? `${text} (${parts.join("+")})` : text);

/** A shortcut shows only once one is assigned. */
function Chord({ id }: { id: string }) {
  const parts = useLabel(id);
  return parts.length ? <span className="muted">{parts.join("+")}</span> : null;
}

type Props = {
  style: CSSProperties;
  items: MenuItem[];
  onDismiss: () => void;
  /** The menu's accessible name. */
  label?: string;
  /** A z-index for the menu and its backdrop, for a host that stacks above the default layer (the floating panel). */
  layer?: number;
};

export default function PaneMenu({ style, items, onDismiss, label = "Pane menu", layer }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const openedAt = useRef(typeof performance === "undefined" ? 0 : performance.now());
  // T-720: the shared menu keyboard (chrome/dialogFocus): focus on the first row; the arrows, Home and End move
  // (UX audit terminal F1/F6); Escape, wherever focus is, and Tab close it; focus goes back to where it was unless an
  // item moved it. It holds the menu element itself, so StrictMode's dev double mount hands focus back too.
  useMenuFocus(box, true, onDismiss);
  // The menu is taller than a small window; keep all of it on screen.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.top = `${fitIn(r.top, r.height, window.innerHeight)}px`;
    el.style.left = `${fitIn(r.left, r.width, window.innerWidth)}px`;
  }, [items.length]);
  const outside = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (outsideDismisses(openedAt.current, performance.now())) onDismiss();
  };
  return (
    <>
      <div className="menu-backdrop" style={layer ? { zIndex: layer } : undefined} onClick={outside} onContextMenu={outside} aria-hidden="true" />
      <div ref={box} className="menu pane-menu" role="menu" aria-label={label} style={{ ...style, ...(layer ? { zIndex: layer + 1 } : null), overflowY: "auto" }}>
        {items.map((it, i) => (
          <Fragment key={it.id}>
            {i > 0 && items[i - 1].group !== it.group && <div role="separator" style={{ height: 1, margin: "4px 6px", background: "var(--line-strong)" }} />}
            <button
              role="menuitem"
              className={`menu-item${it.danger ? " danger" : ""}`}
              style={it.danger ? { color: "var(--danger)" } : undefined}
              title={it.title}
              onClick={() => chooseItem(it, onDismiss)}
            >
              <span className="name">{it.name}</span>
              {it.key && <Chord id={it.key} />}
            </button>
          </Fragment>
        ))}
      </div>
    </>
  );
}
