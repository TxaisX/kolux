// The two parts of the tab menu the window needs before the menu's own code has loaded (TabMenuView.tsx, on first
// use): where the menu opens (Grid.tsx) and the close question's button (Dialogs.tsx). Kept apart from tabMenu.ts so
// the close rows and their reasons load with the menu, not at start (scripts/bundle-budget.mjs).
/** UX lane A (destructive.md row 21): the confirm button of the close question says how many tabs go. */
export const closeConfirmLabel = (count: number): string => (count === 1 ? "Close tab" : `Close ${count} tabs`);

/** The tab menu is about 240 px wide and 330 px tall; `menuAnchor` keeps its top-left corner where the whole menu
 *  still fits in the window, and never off the top or left edge, even in a very small window. */
export const MENU_SIZE = { width: 240, height: 330, margin: 8 } as const;
export function menuAnchor(x: number, y: number, viewW: number, viewH: number): { top: number; left: number } {
  const { width, height, margin } = MENU_SIZE;
  return { top: Math.max(margin, Math.min(y, viewH - height - margin)), left: Math.max(margin, Math.min(x, viewW - width - margin)) };
}
