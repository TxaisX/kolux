// UX audit skills-automations.md:19 (Skills half): the keyboard side of the Skills page menus. Focus goes to
// the first item when a menu opens, the arrow keys (menuStep, the link menu's stepping) move between items, and
// focus goes back to the button that opened it. The rules are plain functions so a test can drive them.
import { menuStep } from "../terminal/LinkActionMenu";
import { restoreFocus } from "../shell/paletteCaps";

export type Item = { disabled?: boolean; focus: () => void };

const ITEMS = '[role^="menuitem"]';
const enabled = (menu: ParentNode): HTMLElement[] => Array.from(menu.querySelectorAll<HTMLElement>(ITEMS)).filter((i) => !(i as HTMLButtonElement).disabled);

/** The item that takes focus after `key` (null: not a menu key). `at` is the focused item's place, -1 for none. */
export function stepTo<T extends Item>(items: T[], at: number, key: string): T | null {
  const to = menuStep(items.length, at, key);
  return to === null ? null : items[to];
}

/** A ref callback for a menu's box: focuses its first enabled item as the menu appears. */
export const focusFirst = (menu: HTMLElement | null): void => void (menu && enabled(menu)[0]?.focus());

/** onKeyDown for a menu's box: arrows, Home and End move between its enabled items. */
export function onMenuKey(e: { key: string; currentTarget: ParentNode; preventDefault: () => void; stopPropagation: () => void }): void {
  const items = enabled(e.currentTarget);
  const next = stepTo(items, items.indexOf(document.activeElement as HTMLElement), e.key);
  if (!next) return;
  e.preventDefault();
  e.stopPropagation();
  next.focus();
}

/** Focus was lost when a menu closed (its item left the page) rather than moved on to a dialog or field. */
export const focusLost = (active: unknown, body: unknown): boolean => !active || active === body;

/** Focus is stranded: nothing has it, the page body has it, or the element that has it was just disabled (keys sent
 *  there reach no handler of the dialog around it). */
export const focusStranded = (active: unknown, body: unknown): boolean => focusLost(active, body) || (typeof active === "object" && (active as { disabled?: boolean }).disabled === true);

type Focusable = { isConnected: boolean; focus: () => void };

/** Gives focus back to `prev` when it is still on the page, else to the first fallback that exists. Unlike the palette's
 *  restore it never reaches for a terminal or editor, which can sit hidden behind the Skills page. True when something took it. */
export function returnFocus(prev: Focusable | null, fallbacks: Array<() => Focusable | null>): boolean {
  if (prev?.isConnected) return restoreFocus(prev, () => null);
  for (const find of fallbacks) {
    const el = find();
    if (el?.isConnected) {
      el.focus();
      return true;
    }
  }
  return false;
}

/** The Skills page's own controls a dialog or menu can fall back to when its opener is gone. */
export const MORE_ACTIONS = 'button[aria-label="More actions"]';
export const PAGE_HEADING = ".skills-head h2";

/** After focus leaves the dialog: it still counts as the dialog's when it went nowhere (a button was removed
 *  or turned off) or stayed inside; focus taken by something else (an overlay opened over it) is not reclaimed. */
export function stillHeld(to: Node | null, box: Node): boolean {
  return to === null || box.contains(to);
}
