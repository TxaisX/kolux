// Cycle 2 (the App.tsx split; moved to src/test/ in review 0.2.0, it is a test helper): the window's source text for the tests that read it (paneStatus, paneMark,
// commands, savedLaunch, noticeMount, explorerBar, main.slowStart): App.tsx and the files its code was
// moved into, as one text. A test helper, imported by tests only.
//
// Cycle 3: the drawing is a folder (shell/window). Every module there joins by existing, so moving code
// out of WindowView.tsx into a new surface cannot drop it from these tests. The window's files outside
// that folder are listed once; windowSource.test.ts fails when one disappears or is renamed, and
// plainWords.test.ts reads this same list instead of keeping a second one.
const DRAWING = import.meta.glob(["../shell/window/*.{ts,tsx}", "!../shell/window/*.test.ts", "!../shell/window/*.test.tsx", "!../shell/window/__cards__/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
/** The window's modules outside shell/window: App.tsx, the shell files beside this one, and the hooks the split made. */
const OUTSIDE = import.meta.glob(
  [
    "../App.tsx",
    "../shell/windowStore.ts",
    "../shell/useWindowStart.ts",
    "../shell/useStartAsk.ts",
    "../shell/windowLate.ts",
    "../shell/useWindowSave.ts",
    "../shell/WindowView.tsx",
    "../shell/windowBag.ts",
    "../shell/AboutPanel.tsx",
    "../shell/LinkAskDialog.tsx",
    "../shell/TabSearch.tsx",
    "../shell/closeAsk.ts",
    "../shell/tidy.ts",
    "../shell/paletteCaps.ts",
    "../shell/findTab.ts",
    "../settings/useSettingsPlumbing.ts",
    "../chrome/useWindowChrome.ts",
    "../launch/launchActions.ts",
    "../terminal/paneActions.ts",
    "../terminal/reviewActions.ts",
    "../terminal/tabName.tsx",
    "../keys/useWindowKeys.ts",
    "../terminal/useResumeHint.ts",
    "../chrome/useScreens.tsx",
    "../status/useStatusSurfaces.ts",
    "../agents/useRailAndTower.ts",
    "../terminal/useLayoutReport.ts",
    "../terminal/paneGrid.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** `./App.tsx`, `./shell/window/Content.tsx`: every key here starts with `../` (this file sits in src/test), so a path from src. */
const rel = (k: string) => `./${k.slice(3)}`;

/** Every window file's text by its path from src (`./shell/window/Content.tsx`). */
export const windowFiles: Record<string, string> = Object.fromEntries(
  [...Object.entries(OUTSIDE), ...Object.entries(DRAWING)].map(([k, text]) => [rel(k), text]),
);

/** Every window file's text, App.tsx first, joined by a blank line. */
export const windowSource: string = [windowFiles["./App.tsx"], ...Object.keys(windowFiles).filter((f) => f !== "./App.tsx").sort().map((f) => windowFiles[f])].join("\n\n");
