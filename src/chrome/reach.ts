// T-610 (brief "Path to an A", Phase 0): how the screens off the top bar's switcher are reached. A command
// that shows a screen toggles it with Terminals (the window's key switch reads SCREEN_OF, so a shortcut and
// its palette row do the same); Artifacts and Skills, which have no command, get palette rows of their own.
// The switcher keeps VIEW-002's four (Agents, Board, Terminals, Tower; its cycle order is a P0 rule).
// T-708 (DT-C144): every screen has a palette row, the switcher's too.
import type { Screen } from "./TopBar";
import type { PaletteItem } from "../projects/WorktreePalette";

/** The commands that show a screen. Floor is reached from the palette, never the sidebar (VIEW-013, DT-08). */
export const SCREEN_OF: Readonly<Record<string, Screen>> = { "view.inbox": "inbox", "view.tower": "tower", "view.floor": "floor", "view.space": "space" };

/** The screens the top bar's switcher draws (TopBar.tsx `screens`); reach.test.ts keeps the two in step. */
const SWITCHER_SCREENS: readonly Screen[] = ["agents", "board", "terminals", "tower"];

/**
 * C12-R5-01: the screen a row shows. The Classic look has one view: it draws no switcher (titleHeader.ts),
 * its View menu has no Workspace View and view.cycleWorkspaceView only says so. A row for one of the
 * switcher's screens therefore keeps Terminals instead of switching to a screen whose only way back is
 * that missing switcher (Board has no Close, Back is disabled off Terminals and Escape does not leave it).
 * Artifacts and Skills keep their own destination: each has a way back of its own.
 */
export const screenTarget = (s: Screen, classic: boolean): Screen => (classic && SWITCHER_SCREENS.includes(s) ? "terminals" : s);

/** Palette rows for the screens no command shows: the switcher's Agents, Board and Terminals, and Artifacts and
 *  Skills (the sidebar's buttons open those too). */
export function screenRows(go: (s: Screen) => void, classic = false): PaletteItem[] {
  // a label lowercased is its screen id; reach.test.ts fails on a typo
  return ["Agents", "Board", "Terminals", "Artifacts", "Skills"].map((l) => {
    const s = l.toLowerCase() as Screen;
    return { section: "Commands", label: `Show ${l}`, run: () => go(screenTarget(s, classic)) };
  });
}
