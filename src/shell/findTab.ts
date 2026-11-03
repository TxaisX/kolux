// TERM-053 (T-305 rest): the tab search box's mount. The matching rule lives in inputExtras.ts (names only,
// late answers dropped); this file is the trigger (one event, fired by the shortcut and the palette command),
// the listener the box mounts on, and the list the box shows for a query.
import { latestOnly, searchTabs } from "./inputExtras";

export const TAB_SEARCH_EVENT = "kolux:tab-search";
/** The command's id in the shortcut table (src/keys/actions.ts); its Commands row in the palette shows its keys (T-708). */
export const TAB_SEARCH_ACTION = "tab.search";

/** What opens the box: the shortcut and the palette command both call this. */
export function openTabSearch(target: EventTarget = window): void {
  target.dispatchEvent(new Event(TAB_SEARCH_EVENT));
}

/** What the box listens on; returns the way to stop listening. */
export function onTabSearch(open: () => void, target: EventTarget = window): () => void {
  target.addEventListener(TAB_SEARCH_EVENT, open);
  return () => target.removeEventListener(TAB_SEARCH_EVENT, open);
}

/** A tab the box can list: its own name, and the worktree folder it sits in (shown, never searched). */
export type TabEntry = { label: string; hint?: string; run: () => void };

/** The palette sections the tab search lists: terminal tabs and browser pages are both tabs to the user. */
export const isTabRow = (row: { section: string }): boolean => row.section === "Open tabs" || row.section === "Browser pages";

/** The box's answer to a typed query: tabs whose own name matches. The worktree name is never part of the match. */
export function tabMatches(query: string, tabs: TabEntry[]): TabEntry[] {
  return searchTabs(query, tabs.map((t) => ({ ...t, name: t.label })));
}

/** Runs one search at a time: only the newest query's answer reaches `show`; an older answer that arrives late is dropped. */
export function tabSearcher(list: () => TabEntry[] | Promise<TabEntry[]>, show: (rows: TabEntry[]) => void) {
  const ticket = latestOnly();
  return async (query: string): Promise<void> => {
    const mine = ticket.next();
    const tabs = await list();
    if (ticket.isCurrent(mine)) show(tabMatches(query, tabs));
  };
}
