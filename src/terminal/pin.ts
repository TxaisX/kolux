// TERM-046: pinned tabs. Pure: the grid order, the tab menu, the bulk-close set and the close
// question for a pinned tab; App.tsx keeps the pinned keys and asks. ponytail: pinned keys are a
// Set in window state, saved with the layout (after-list #100).
// One session per cell (2026-11-12): a "tab" is a pane in its own cell, so the order the close rows and the tab keys
// measure is the grid's. A pinned pane keeps its cell (the grid is never reordered by a pin); the pin keeps it out of
// bulk closes and middle-click and asks before it closes.
import { sameDir, viewOf } from "../workspaces";
import { tabMenu } from "./tabs";
import { closeSet, type Which } from "./tabClose";

/** Settings field: false turns the ask-before-closing-a-pinned-tab off (on by default). */
export const PIN_ASK_FIELD = "pinnedTabsAsk";

export const pinAsks = (settings: Record<string, unknown>): boolean => settings[PIN_ASK_FIELD] !== false;

/** Pinned tabs sit first, each group keeping its own order. */
export const orderPinnedFirst = (order: number[], pinned: Set<number>): number[] => [...order.filter((k) => pinned.has(k)), ...order.filter((k) => !pinned.has(k))];

/** C06-R1-01: the order as the user sees it around pane `key`: the panes of its grid (DT-C274: by `viewOf`), cell by
 *  cell. Every row that measures a side of a pane (the close rows, Select Tab 1-9) measures this, so "Close to the left"
 *  closes the cells drawn before it. */
export const gridOrderOf = (panes: readonly { key: number; cwd: string | null; view?: string | null }[], key: number): number[] => {
  const p = panes.find((x) => x.key === key);
  return p ? panes.filter((x) => sameDir(viewOf(x), viewOf(p))).map((x) => x.key) : [];
};

export type PinMenuItem = { id: "rename" | "pin" | "close"; label: string; keys?: string; disabled?: boolean };

/** TERM-048's tab menu with Pin/Unpin before Close; Close is disabled for a pinned tab. */
export const pinMenu = (kind: string | undefined, pinned: boolean): PinMenuItem[] =>
  tabMenu(kind).flatMap((item): PinMenuItem[] => (item.id === "close" ? [{ id: "pin", label: pinned ? "Unpin tab" : "Pin tab" }, { ...item, disabled: pinned }] : [item]));

/** A bulk close (others, left, right, all) skips pinned tabs unless the user confirmed it; a
 *  confirmed kill-all then closes pinned terminals without a second prompt. */
export const bulkCloseSet = (order: number[], at: number, which: Which, pinned: Set<number>, confirmed = false): number[] =>
  closeSet(order, at, which).filter((k) => confirmed || !pinned.has(k));

/** C01-R4-01: `tab.closeAll` is the editor's "Close all editor tabs" (COMPAT.md keeps that name and
 *  chord), so it takes the strip's editor tabs only: the file, preview, diff, changes and check tabs.
 *  A terminal (no kind) stays, and a pinned tab is spared like every bulk close. */
export function editorCloseSet(order: readonly number[], panes: readonly { key: number; kind?: string }[], pinned: ReadonlySet<number>): number[] {
  const isEditor = (k: number) => {
    const p = panes.find((x) => x.key === k);
    return p !== undefined && p.kind !== undefined && p.kind !== "terminal";
  };
  return order.filter((k) => isEditor(k) && !pinned.has(k));
}

/** TERM-044, one session per cell: the grid's bulk closes as the Pane menu offers them, only the ones that would close
 *  something besides the pane itself (Close Pane is its own row). Pinned panes are spared, as in every bulk close. */
const BULK: readonly (readonly [Exclude<Which, "one">, string])[] = [
  ["others", "Close Others"],
  ["right", "Close to the Right"],
  ["left", "Close to the Left"],
  ["all", "Close All"],
];
export const bulkCloses = (order: number[], key: number, pinned: Set<number>): { id: string; name: string; title: string; keys: number[] }[] =>
  BULK.map(([which, name]) => ({ id: `close-${which}`, name, title: "Closes these panes of this grid, asking first if a program is running; pinned panes stay", keys: bulkCloseSet(order, key, which, pinned) })).filter((r) => r.keys.length > 0 && !(r.keys.length === 1 && r.keys[0] === key));

/** Middle-click never closes a pinned tab. */
export const middleClickCloses = (key: number, pinned: Set<number>): boolean => !pinned.has(key);

/** What closing one tab needs: nothing for an unpinned tab, a question for a pinned one while the
 *  setting is on, and a plain close when the user turned the question off. */
export const closeOne = (key: number, pinned: Set<number>, settings: Record<string, unknown>): "close" | "ask" => (pinned.has(key) && pinAsks(settings) ? "ask" : "close");

export const pinQuestion = (name: string): { title: string; body: string } => ({ title: `Close pinned tab “${name}”?`, body: "This tab is pinned. Closing it stops anything still running in it." });
