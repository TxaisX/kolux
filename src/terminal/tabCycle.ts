// TERM-050 / TERM-051 / TERM-052 (T-219, T-220): moving between tabs from the keyboard. Pure; the
// window hands in the strip's visible order (pinned first, after any drag reordering), the tabs
// used most recently first, and applies the key that comes back. A tab whose content is gone is
// skipped everywhere.
export type TabInfo = { key: number; kind?: string; seats?: unknown };

/** What a tab holds: its pane kind, a chooser still asking what to run, or a terminal / agent. */
export const typeOf = (t: TabInfo): string => t.kind ?? (t.seats ? "chooser" : "terminal");

export type CycleMode = "same" | "all" | "terminals";

/**
 * TERM-051: the tab `step` (1 next, -1 previous) away from `from` in the strip, wrapping. "same"
 * keeps to tabs of the type `from` has, "all" takes any, "terminals" takes terminals and agents
 * only. `gone` tabs are skipped. Null when no other tab qualifies.
 */
export function cycleTab(strip: TabInfo[], from: number, step: 1 | -1, mode: CycleMode, gone: ReadonlySet<number> = new Set()): number | null {
  const i = strip.findIndex((t) => t.key === from);
  const here = strip[i];
  const wanted = (t: TabInfo) => !gone.has(t.key) && (mode === "all" || (mode === "terminals" ? typeOf(t) === "terminal" : here !== undefined && typeOf(t) === typeOf(here)));
  const n = strip.length;
  if (n === 0) return null;
  // a focus outside the strip starts before the first tab (next) or after the last (previous)
  const start = i < 0 ? (step === 1 ? -1 : n) : i;
  for (let k = 1; k <= n; k++) {
    const t = strip[(((start + step * k) % n) + n) % n];
    if (t.key === from) return null;
    if (wanted(t)) return t.key;
  }
  return null;
}

/** TERM-052: the tab at 1-based position `n` of the strip, skipping gone ones; null when there is none. */
export function tabByNumber(strip: TabInfo[], n: number, gone: ReadonlySet<number> = new Set()): number | null {
  const live = strip.filter((t) => !gone.has(t.key));
  return Number.isInteger(n) && n >= 1 ? (live[n - 1]?.key ?? null) : null;
}

/** C01-R1-01: the tab a Select Tab chord or palette row names. `index` is the digit the keymap reports
 *  (Alt+1 gives 1) and the palette's row number, so it is the 1-based position itself; a chord rebound
 *  off the digits names the first tab, as normaliseIndexChord rewrites it to 1. */
export const tabAtDigit = (strip: TabInfo[], index: number | undefined, gone: ReadonlySet<number> = new Set()): number | null => tabByNumber(strip, index ?? 1, gone);

/** Settings field: "recent" (default, most recently used first) or "order" (left to right). */
export const SWITCH_ORDER_FIELD = "tabSwitchOrder";
export type SwitchOrder = "recent" | "order";
export const switchOrderOf = (settings: Record<string, unknown>): SwitchOrder => (settings[SWITCH_ORDER_FIELD] === "order" ? "order" : "recent");

/** The open switcher: the tabs in the order it steps through, and the highlighted one. */
export type Switcher = { list: number[]; at: number };

/**
 * TERM-050: Ctrl+Tab pressed. With most-recent order the list is `current` then the tabs used before
 * it, so one press highlights the tab used just before; with left-to-right order it is the strip as
 * shown and one press highlights the tab to the right. Null when there is nowhere to go.
 */
export function openSwitcher(strip: number[], recent: number[], current: number, order: SwitchOrder, gone: ReadonlySet<number> = new Set()): Switcher | null {
  const live = strip.filter((k) => !gone.has(k));
  if (live.length < 2 || !live.includes(current)) return null;
  if (order === "order") return { list: live, at: (live.indexOf(current) + 1) % live.length };
  const used = recent.filter((k) => live.includes(k) && k !== current);
  const list = [current, ...used, ...live.filter((k) => k !== current && !used.includes(k))];
  return { list, at: 1 };
}

/** Another press of Tab (or Shift+Tab) while Ctrl is held: the highlight moves, wrapping. */
export function stepSwitcher(s: Switcher, step: 1 | -1): Switcher {
  const n = s.list.length;
  return { list: s.list, at: (((s.at + step) % n) + n) % n };
}

/** Releasing Ctrl opens the highlighted tab. */
export const chosenTab = (s: Switcher): number => s.list[s.at];
