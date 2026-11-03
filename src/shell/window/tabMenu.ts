// TERM-044 / TERM-046 / TERM-049: the close items of a tab's right-click menu, moved out of the menu's
// drawing so the five labels, their order and the pinned rules are one pure function the menu runs.
import { closeSet, type Which } from "../../terminal/tabClose";
import { bulkCloseSet } from "../../terminal/pin";

/** The menu's close rows, in the order it draws them. */
export type CloseRow = { label: string; which: Which; keys: number[]; disabled: boolean; why?: string };

/** TERM-044: Close, Close others, Close to the right, Close to the left, Close all. A pinned tab is
 *  never closed by its own row or by a bulk row (TERM-046); a row that would close nothing is disabled. */
export const CLOSE_ROWS: ReadonlyArray<readonly [string, Which]> = [
  ["Close", "one"],
  ["Close others", "others"],
  ["Close to the right", "right"],
  ["Close to the left", "left"],
  ["Close all", "all"],
];

/** What each close row would close from strip `order`, and whether it can run. */
export function closeRows(order: number[], key: number, pinned: Set<number>): CloseRow[] {
  return CLOSE_ROWS.map(([label, which]) => {
    const keys = bulkCloseSet(order, key, which, pinned);
    const pinnedOwn = which === "one" && pinned.has(key);
    const disabled = keys.length === 0 || pinnedOwn;
    if (!disabled) return { label, which, keys, disabled };
    return { label, which, keys, disabled, why: pinnedOwn ? "A pinned tab stays open. Unpin it first to close it." : which === "one" ? "This tab is already closed." : NOTHING_TO_CLOSE[which] };
  });
}

/** UX lane A (shell.md row 14): why a close row is disabled, shown as its tooltip. */
const NOTHING_TO_CLOSE: Record<Exclude<Which, "one">, string> = {
  others: "There is no other tab to close. Pinned tabs are never closed in bulk.",
  right: "There is no tab to the right to close. Pinned tabs are never closed in bulk.",
  left: "There is no tab to the left to close. Pinned tabs are never closed in bulk.",
  all: "There is nothing to close. Pinned tabs are never closed in bulk.",
};

/** UX lane A (destructive.md row 21): the confirm button of the close question says how many tabs go. */
export const closeConfirmLabel = (count: number): string => (count === 1 ? "Close tab" : `Close ${count} tabs`);

/** The tab menu is about 240 px wide and 330 px tall; `menuAnchor` keeps its top-left corner where the whole menu
 *  still fits in the window, and never off the top or left edge, even in a very small window. */
export const MENU_SIZE = { width: 240, height: 330, margin: 8 } as const;
export function menuAnchor(x: number, y: number, viewW: number, viewH: number): { top: number; left: number } {
  const { width, height, margin } = MENU_SIZE;
  return { top: Math.max(margin, Math.min(y, viewH - height - margin)), left: Math.max(margin, Math.min(x, viewW - width - margin)) };
}

/** The keys a confirmed close-all would take, pinned tabs included (the question says so). */
export const allKeys = (order: number[], key: number): number[] => closeSet(order, key, "all");
