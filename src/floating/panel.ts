// TERM-059 / TERM-061 (T-220): what the floating workspace panel holds and how its keys act. Pure
// state over tabs (terminal, agent, browser, markdown): the window component renders it and runs the
// side effects (starting a program, saving a file). The panel stays open when its last tab closes,
// an empty panel never starts a terminal by itself, a program exiting is kept apart from the user
// closing a tab, and unsaved markdown tabs are asked about one at a time.
import { cycleTab, tabByNumber, type CycleMode, type TabInfo } from "../terminal/tabCycle";

export type Kind = "terminal" | "agent" | "browser" | "markdown";

export type Tab = {
  key: number;
  kind: Kind;
  /** The name shown on the tab. */
  title: string;
  /** Browser: the address. Markdown: the file. */
  path?: string;
  /** Agent: the agent's id (its program and arguments come from the agents list when it starts). */
  agent?: string;
  /** Terminal and agent: where it starts. Floating terminals start in the home folder unless told otherwise. */
  cwd?: string;
  /** Markdown: the file has unsaved changes. */
  dirty?: boolean;
  /** Terminal and agent: the program exited on its own. The tab stays so its output can be read. */
  exited?: boolean;
};

/** The floating panel's keys start here so they never collide with the window's own pane keys. */
export const KEY_BASE = 1_000_000;

export type Panel = {
  open: boolean;
  tabs: Tab[];
  active: number | null;
  next: number;
  /** Tab to put typing focus in, set when something was just opened or selected; the view clears it with `focused`. */
  focus: number | null;
  /** Unsaved markdown tabs waiting to be asked about, the first being the one on screen. */
  asking: number[];
  /** Folders the user said to trust, remembered. */
  trusted: string[];
};

export const empty = (trusted: string[] = []): Panel => ({ open: false, tabs: [], active: null, next: KEY_BASE, focus: null, asking: [], trusted });

export type Add = { kind: Kind; title?: string; path?: string; agent?: string; cwd?: string };

const titleOf = (a: Add): string =>
  a.title ?? (a.kind === "browser" ? "Browser" : a.kind === "markdown" ? (a.path?.split(/[\\/]/).pop() ?? "Untitled") : a.kind === "agent" ? (a.agent ?? "Agent") : "Terminal");

const info = (t: Tab): TabInfo => ({ key: t.key, kind: t.kind === "terminal" || t.kind === "agent" ? undefined : t.kind });

/** TERM-059: Cmd/Ctrl+Alt+A (or the button) shows the panel; again hides it. Opening never creates a terminal and puts focus in the active tab. */
export const toggle = (p: Panel): Panel => (p.open ? hide(p) : show(p));
export const show = (p: Panel): Panel => (p.open ? p : { ...p, open: true, focus: p.active });
export const hide = (p: Panel): Panel => (p.open ? { ...p, open: false, focus: null } : p);

/** A tab added to the panel is selected and focused straight away (also a new agent tab started from the panel); the panel opens if it was closed. */
export function add(p: Panel, a: Add): Panel {
  const tab: Tab = { key: p.next, kind: a.kind, title: titleOf(a), path: a.path, agent: a.agent, cwd: a.kind === "terminal" || a.kind === "agent" ? a.cwd : undefined };
  return { ...p, open: true, tabs: [...p.tabs, tab], active: tab.key, next: p.next + 1, focus: tab.key };
}

/** APP-015: a web link clicked in the panel opens as a browser tab of the panel itself (an open tab on the same address is reused),
 *  so the window's active worktree and its tabs stay as they are. Anything but http(s) is left to the caller. */
export function openLink(p: Panel, url: string): Panel {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return p;
    host = u.host;
  } catch {
    return p;
  }
  const same = p.tabs.find((t) => t.kind === "browser" && t.path === url);
  return same ? { ...select(p, same.key), open: true } : add(p, { kind: "browser", path: url, title: host });
}

export const select = (p: Panel, key: number): Panel => (p.tabs.some((t) => t.key === key) ? { ...p, active: key, focus: key } : p);

/** TERM-052 inside the panel: the tab at position n (1-based); a number past the tab count does nothing. */
export function selectNumber(p: Panel, n: number): Panel {
  const key = tabByNumber(p.tabs.map(info), n);
  return key === null ? p : select(p, key);
}

/** The next or previous tab, wrapping, among tabs of the given kind rule. */
export function step(p: Panel, by: 1 | -1, mode: CycleMode): Panel {
  if (p.active === null) return p;
  const key = cycleTab(p.tabs.map(info), p.active, by, mode);
  return key === null ? p : select(p, key);
}

/** TERM-061: tabs can be reordered; `to` is the new index. */
export function reorder(p: Panel, key: number, to: number): Panel {
  const from = p.tabs.findIndex((t) => t.key === key);
  if (from < 0) return p;
  const tabs = p.tabs.slice();
  const [t] = tabs.splice(from, 1);
  tabs.splice(Math.min(Math.max(to, 0), tabs.length), 0, t);
  return { ...p, tabs };
}

export const setTitle = (p: Panel, key: number, title: string): Panel => ({ ...p, tabs: p.tabs.map((t) => (t.key === key ? { ...t, title } : t)) });
export const setDirty = (p: Panel, key: number, dirty: boolean): Panel => ({ ...p, tabs: p.tabs.map((t) => (t.key === key && !!t.dirty !== dirty ? { ...t, dirty } : t)) });

/** TERM-061: a program ended on its own. The tab stays, marked, so the output can be read; this is not the user closing the pane. */
export const programExited = (p: Panel, key: number): Panel => ({ ...p, tabs: p.tabs.map((t) => (t.key === key && !t.exited ? { ...t, exited: true } : t)) });

/**
 * UX audit destructive F4: the terminals among `keys` that may hold a live program. A tab that has not started
 * (no terminal id yet) has nothing to stop. A tab marked `exited` is still listed: the same pane can start again
 * (Enter in an ended agent pane, a dead shell's Restart) and the mark does not reset, while the backend's busy
 * check reads false for an ended terminal, so asking about it costs nothing. Returns the tabs' keys and their
 * ids, in step, for the busy check.
 */
export function liveTerminalTabs(p: Panel, keys: number[], ptys: Record<number, number>): { keys: number[]; ids: number[] } {
  const live = keys.filter((k) => {
    const t = p.tabs.find((x) => x.key === k);
    return !!t && (t.kind === "terminal" || t.kind === "agent") && ptys[k] !== undefined;
  });
  return { keys: live, ids: live.map((k) => ptys[k]) };
}

/** The tab to select after `key` goes: the one that took its place, else the one before, else none. */
function neighbour(tabs: Tab[], key: number, active: number | null): number | null {
  if (active !== key) return active;
  const i = tabs.findIndex((t) => t.key === key);
  const rest = tabs.filter((t) => t.key !== key);
  return rest[Math.min(i, rest.length - 1)]?.key ?? null;
}

const drop = (p: Panel, key: number): Panel => {
  const active = neighbour(p.tabs, key, p.active);
  return { ...p, tabs: p.tabs.filter((t) => t.key !== key), active, asking: p.asking.filter((k) => k !== key), focus: active };
};

/**
 * TERM-061: the user closes tabs. Clean ones go at once; an unsaved markdown tab is queued to be
 * asked about, one at a time. Closing the last tab leaves the panel open on its empty state.
 */
export function close(p: Panel, keys: number[]): Panel {
  let out = p;
  const ask: number[] = [];
  for (const key of keys) {
    const t = out.tabs.find((x) => x.key === key);
    if (!t) continue;
    if (t.kind === "markdown" && t.dirty) ask.push(key);
    else out = drop(out, key);
  }
  return ask.length ? { ...out, asking: [...out.asking.filter((k) => !ask.includes(k)), ...ask], focus: null } : out;
}

/** The unsaved markdown tab being asked about, or null. */
export const asked = (p: Panel): Tab | null => p.tabs.find((t) => t.key === p.asking[0]) ?? null;

/**
 * The answer to the question on screen. `discard` closes that tab and moves on to the next waiting
 * one; `save` is the caller's job first (it calls `close` again once saved); `keep` cancels this
 * question and every one still waiting, so nothing else closes.
 */
export function answer(p: Panel, what: "discard" | "keep"): Panel {
  const key = p.asking[0];
  if (key === undefined) return p;
  if (what === "keep") return { ...p, asking: [], active: key, focus: key };
  return drop(p, key);
}

/**
 * TERM-061: Save in the question. The tab closes only when that same tab is still the one asked about
 * and its file is clean now. `stillDirty` comes from the editor's own buffer after the save, not this
 * panel's mirrored flag, which can lag the save and leave the question up. A refused or unnamed save
 * keeps the question up; a question that moved on during the save (Don't save on this tab) is left
 * alone, so the next unsaved tab is never closed without its own answer.
 */
export function saved(p: Panel, key: number, stillDirty: boolean): Panel {
  if (p.asking[0] !== key || stillDirty) return p;
  return drop(p, key);
}

/** Cmd/Ctrl+W in the panel: an empty panel minimizes; otherwise the active tab closes (asking first when unsaved). */
export function closeKey(p: Panel): Panel {
  if (p.tabs.length === 0 || p.active === null) return hide(p);
  return close(p, [p.active]);
}

/** Trusted folders are remembered; a folder is trusted once. */
export const trust = (p: Panel, folder: string): Panel => (p.trusted.includes(folder) ? p : { ...p, trusted: [...p.trusted, folder] });
export const isTrusted = (p: Panel, folder: string): boolean => p.trusted.includes(folder);

/** Floating terminals start in the home folder by default. */
export const startFolder = (home: string, asked?: string | null): string => (asked && asked.trim() ? asked : home);

/** The view has put focus where `focus` named. */
export const focused = (p: Panel): Panel => (p.focus === null ? p : { ...p, focus: null });

/**
 * UX audit destructive: while one of the layer's own dialogs or menus is up (the close question, the Save question,
 * the "+" menu) it sits outside `.float-panel`, so the tab commands would fall through to the window and close its
 * tab. This says whether a key press belongs to that dialog alone: every chord (Ctrl, Meta, Alt, or a function key)
 * except Escape. Plain keys (Tab, Enter, arrows) are not chords and keep working inside the dialog.
 */
export function modalHolds(up: boolean, e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  if (!up || e.key === "Escape") return false;
  return e.ctrlKey || e.metaKey || e.altKey || /^F\d{1,2}$/.test(e.key);
}

/**
 * Mod+S while a floating editor is the active tab saves only that tab's file; it does not touch the
 * main editor, and it works outside a workspace screen. Null when focus is not in the panel or the
 * active tab is not a markdown file.
 */
export function saveTarget(p: Panel, focusInPanel: boolean): number | null {
  if (!p.open || !focusInPanel) return null;
  const t = p.tabs.find((x) => x.key === p.active);
  return t && t.kind === "markdown" ? t.key : null;
}

export type Op =
  | { op: "toggle" | "maximize" | "minimize" | "save" | "close" | "none" }
  | { op: "select"; n: number }
  | { op: "step"; by: 1 | -1; mode: CycleMode }
  | { op: "add"; kind: Kind };

/**
 * What a bound command does for the panel; null leaves it to the window. The three panel commands
 * work anywhere; the tab commands only while focus is inside the open panel, where they act on the
 * panel's tabs and never on the window's (so Mod+W cannot close a main tab from the panel).
 */
export function route(id: string, index: number | undefined, open: boolean, inPanel: boolean): Op | null {
  switch (id) {
    case "floatingTerminal.toggle":
      return { op: "toggle" };
    case "floatingWorkspace.maximize":
      return open ? { op: "maximize" } : null;
    case "floatingWorkspace.minimize":
      return open ? { op: "minimize" } : null;
  }
  if (!open || !inPanel) return null;
  switch (id) {
    case "editor.save":
      return { op: "save" };
    case "tab.close":
      return { op: "close" };
    case "tab.selectByIndex":
      return { op: "select", n: (index ?? 0) + 1 };
    case "tab.nextSameType":
      return { op: "step", by: 1, mode: "same" };
    case "tab.previousSameType":
      return { op: "step", by: -1, mode: "same" };
    case "tab.nextAllTypes":
      return { op: "step", by: 1, mode: "all" };
    case "tab.previousAllTypes":
      return { op: "step", by: -1, mode: "all" };
    case "tab.nextTerminal":
      return { op: "step", by: 1, mode: "terminals" };
    case "tab.previousTerminal":
      return { op: "step", by: -1, mode: "terminals" };
    case "tab.newTerminal":
      return { op: "add", kind: "terminal" };
    case "tab.newBrowser":
      return { op: "add", kind: "browser" };
    case "tab.newAgent":
      return { op: "add", kind: "agent" };
    case "tab.newMarkdown":
      return { op: "add", kind: "markdown" };
  }
  return id.startsWith("tab.") ? { op: "none" } : null;
}
