// TERM-046: pinned tabs. Pure: the strip order, the tab menu, the bulk-close set and the close
// question for a pinned tab; App.tsx keeps the pinned keys and asks. ponytail: pinned keys are a
// Set in window state (not saved), like the strip order itself.
import { groupOf } from "./grid";
import { tabMenu } from "./tabs";
import { closeSet, type Which } from "./tabClose";

/** Settings field: false turns the ask-before-closing-a-pinned-tab off (on by default). */
export const PIN_ASK_FIELD = "pinnedTabsAsk";

export const pinAsks = (settings: Record<string, unknown>): boolean => settings[PIN_ASK_FIELD] !== false;

/** Pinned tabs sit first, each group keeping its own order. */
export const orderPinnedFirst = (order: number[], pinned: Set<number>): number[] => [...order.filter((k) => pinned.has(k)), ...order.filter((k) => !pinned.has(k))];

/** C06-R1-01: the strip as the user sees it for the cell holding pane `key`: that cell's tabs, pinned
 *  first. Every row that measures a side of a tab (the close rows, Select Tab 1-9) measures this, never
 *  the pane array, or a pinned tab's "Close to the left" closes a tab drawn on its right. */
export const stripOrderOf = (panes: readonly { key: number; group?: number }[], key: number, pinned: Set<number>): number[] => {
  const p = panes.find((x) => x.key === key);
  return p ? orderPinnedFirst(panes.filter((x) => groupOf(x) === groupOf(p)).map((x) => x.key), pinned) : [];
};

export type PinMenuItem = { id: "rename" | "pin" | "close"; label: string; keys?: string; disabled?: boolean };

/** TERM-048's tab menu with Pin/Unpin before Close; Close is disabled for a pinned tab. */
export const pinMenu = (kind: string | undefined, pinned: boolean): PinMenuItem[] =>
  tabMenu(kind).flatMap((item): PinMenuItem[] => (item.id === "close" ? [{ id: "pin", label: pinned ? "Unpin tab" : "Pin tab" }, { ...item, disabled: pinned }] : [item]));

/** A bulk close (others, left, right, all) skips pinned tabs unless the user confirmed it; a
 *  confirmed kill-all then closes pinned terminals without a second prompt. */
export const bulkCloseSet = (order: number[], at: number, which: Which, pinned: Set<number>, confirmed = false): number[] =>
  closeSet(order, at, which).filter((k) => confirmed || !pinned.has(k));

/** Middle-click never closes a pinned tab. */
export const middleClickCloses = (key: number, pinned: Set<number>): boolean => !pinned.has(key);

/** What closing one tab needs: nothing for an unpinned tab, a question for a pinned one while the
 *  setting is on, and a plain close when the user turned the question off. */
export const closeOne = (key: number, pinned: Set<number>, settings: Record<string, unknown>): "close" | "ask" => (pinned.has(key) && pinAsks(settings) ? "ask" : "close");

export const pinQuestion = (name: string): { title: string; body: string } => ({ title: `Close pinned tab “${name}”?`, body: "This tab is pinned. Closing it stops anything still running in it." });
