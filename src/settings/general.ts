// SET-037: the Classic or New look and the workspace screen that opens first. Both live in General.
import type { Screen } from "../chrome/TopBar";
import type { Page } from "../projects/ProjectsPanel";
import { FIELD } from "../theme";
import type { SavedLayout } from "../terminal/layout";

export type Look = "classic" | "new";
export const LOOK_FIELD = "uiLook";
export const FIRST_FIELD = "firstScreen";

/** A profile that already had settings before this choice existed stays Classic until the user
 *  picks New; a fresh profile (no settings yet) starts New. */
export function readLook(s: Record<string, unknown>): Look {
  const v = s[LOOK_FIELD];
  if (v === "classic" || v === "new") return v;
  return Object.keys(s).length === 0 ? "new" : "classic";
}

/** The settings with the look written down, so a fresh profile stays New once other fields are
 *  saved, and (T-418) a missing mode written down as Dark, so a first launch is dark; null when both
 *  are already there. Only ever given settings read from disk, never the empty stand-in a slow read
 *  leaves, or it would write New and Dark over a profile it never saw. */
export function stampLook(s: Record<string, unknown>): Record<string, unknown> | null {
  const look = s[LOOK_FIELD] === "classic" || s[LOOK_FIELD] === "new";
  const mode = s[FIELD.mode] === "light" || s[FIELD.mode] === "dark" || s[FIELD.mode] === "system";
  if (look && mode) return null;
  return { ...s, ...(look ? {} : { [LOOK_FIELD]: readLook(s) }), ...(mode ? {} : { [FIELD.mode]: "dark" }) };
}

/** The saved first screen (VIEW-001 as amended for the trial, DT-C40: Terminals when never chosen or unknown). */
export function savedFirst(s: Record<string, unknown>): Screen {
  const v = s[FIRST_FIELD];
  return v === "agents" || v === "board" || v === "tower" ? v : "terminals";
}

/** C17-R1-01: the first screen the General page shows and the start reads, so the radio can only
 *  write a value the start honours. Agents and Board stay Terminals under Classic. */
export function shownFirst(s: Record<string, unknown>, classic: boolean): Screen {
  const v = savedFirst(s);
  return classic && (v === "agents" || v === "board") ? "terminals" : v;
}

/** VIEW-005: the screen in front at quit. Picking a first screen in General writes it too, so the
 *  next start honours that choice; after that the screen the user left wins. */
export const LAST_SCREEN_FIELD = "lastScreen";

/** The screen the window opens on: the one left at quit (Agents and Board only under New), else the
 *  first-screen choice under New (Terminals when none, DT-C40), else Terminals; an unknown saved value counts as none. */
export function startScreen(s: Record<string, unknown>): Screen {
  const classic = readLook(s) === "classic";
  const last = s[LAST_SCREEN_FIELD];
  if (last === "terminals" || last === "artifacts" || last === "inbox" || last === "skills" || last === "tower") return last; // VIEW-011 (T-189-b): the Skills page left open at quit is shown again
  if (last === "agents" || last === "board") return classic ? "terminals" : last;
  return shownFirst(s, classic);
}

/** VIEW-005: a burst of changes is written once, `ms` after the last; `flush` writes a pending one
 *  at once (the window closing). */
export function lastWriter<T>(write: (v: T) => void, ms = 400) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T;
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    write(pending);
  };
  const set = (v: T) => {
    pending = v;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, ms);
  };
  return { set, flush };
}


/** VIEW-107 (T-069-b): the layout's durable part, the tabs and the workspace in front; the focus,
 *  each cell's active tab and the stacking are what a fallback save leaves out. */
export const durableOnly = (l: SavedLayout): SavedLayout => ({ panes: l.panes, activeTab: {}, focused: 0, activeDir: l.activeDir, stacked: {} });

/** VIEW-107 (T-069-b): writes the layout; a failed write is tried once more after `wait` ms, then the
 *  durable part alone is written. Rejects only when that last write fails too. */
export async function saveLayout(l: SavedLayout, write: (l: SavedLayout) => Promise<unknown>, wait = 300): Promise<"saved" | "retried" | "durable"> {
  try {
    await write(l);
    return "saved";
  } catch {
    await new Promise((r) => setTimeout(r, wait));
  }
  try {
    await write(l);
    return "retried";
  } catch {
    await write(durableOnly(l));
    return "durable";
  }
}

/** VIEW-011: the page that was open at quit, shown again at start (none when unset or unknown). */
export const OPEN_PAGE_FIELD = "openPage";
export function openPageAt(s: Record<string, unknown>): Page | null {
  const v = s[OPEN_PAGE_FIELD];
  return v === "automations" || v === "routing" || v === "tasks" ? v : null;
}

/** TERM-029: the needs-you strip above the grid, on unless turned off. */
export const NEEDS_STRIP_FIELD = "needsStrip";
export const stripOn = (s: Record<string, unknown>): boolean => s[NEEDS_STRIP_FIELD] !== false;
