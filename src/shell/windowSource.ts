// Cycle 2 (the App.tsx split): the window's source text for the tests that read it (paneStatus, paneMark,
// commands, savedLaunch, noticeMount, explorerBar, main.slowStart): App.tsx and the files its code was
// moved into, as one text. A test helper, imported by tests only.
//
// Cycle 3: the drawing is a folder (shell/window). Every module there joins by existing, so moving code
// out of WindowView.tsx into a new surface cannot drop it from these tests. The window's files outside
// that folder are listed once; windowSource.test.ts fails when one disappears or is renamed, and
// plainWords.test.ts reads this same list instead of keeping a second one.
const DRAWING = import.meta.glob(["./window/*.{ts,tsx}", "!./window/*.test.ts", "!./window/*.test.tsx", "!./window/__cards__/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
/** The window's modules outside shell/window: App.tsx, the shell files beside this one, and the hooks the split made. */
const OUTSIDE = import.meta.glob(
  [
    "../App.tsx",
    "./windowStore.ts",
    "./useWindowStart.ts",
    "./windowLate.ts",
    "./useWindowSave.ts",
    "./WindowView.tsx",
    "./windowBag.ts",
    "./AboutPanel.tsx",
    "./LinkAskDialog.tsx",
    "./TabSearch.tsx",
    "./closeAsk.ts",
    "./tidy.ts",
    "./paletteCaps.ts",
    "./findTab.ts",
    "../settings/useSettingsPlumbing.ts",
    "../chrome/useWindowChrome.ts",
    "../browser/useBrowserChords.ts",
    "../launch/launchActions.ts",
    "../terminal/paneActions.ts",
    "../editor/reviewActions.ts",
    "../terminal/tabName.tsx",
    "../keys/useWindowKeys.ts",
    "../projects/useCliBridge.ts",
    "../chrome/useScreens.tsx",
    "../status/useStatusSurfaces.ts",
    "../agents/useRailAndTower.ts",
    "../terminal/useLayoutReport.ts",
    "../terminal/paneGrid.ts",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** `./App.tsx` for a `../` key, `./shell/...` for a key beside this file. */
const rel = (k: string) => (k.startsWith("../") ? `./${k.slice(3)}` : `./shell/${k.replace(/^\.\//, "")}`);

/** Every window file's text by its path from src (`./shell/window/Content.tsx`). */
export const windowFiles: Record<string, string> = Object.fromEntries(
  [...Object.entries(OUTSIDE), ...Object.entries(DRAWING)].map(([k, text]) => [rel(k), text]),
);

/** Every window file's text, App.tsx first, joined by a blank line. */
export const windowSource: string = [windowFiles["./App.tsx"], ...Object.keys(windowFiles).filter((f) => f !== "./App.tsx").sort().map((f) => windowFiles[f])].join("\n\n");
