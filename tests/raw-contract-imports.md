# `?raw` contract tests, by area (queued bug 20261112-1118)

Generated 2026-11-12 by lane `o2-tests` from every `src/**/*.test.ts(x)` that reads source text through Vite's `?raw`.

**75 test files** in 22 areas. Vite caches those transforms, so a stale entry can make such a test
fail on correct code (seen in lane o3-rune on 2026-11-12) or, worse, pass on code that has already changed. Count it again with:

```
grep -rl '?raw' src/ --include=*.test.ts --include=*.test.tsx | wc -l
```

Fix, per area owner: read the file with `node:fs` instead — `readFileSync(new URL("./X.tsx", import.meta.url), "utf8")`,
as `src/usage/usageStatusUx.test.ts:20-21` already does for `src/styles.css`. A `import.meta.glob(..., { query: "?raw" })`
scan cannot be swapped that way: it needs `node:fs` + `readdirSync`. Until every area is swapped, delete
`node_modules/.vite` before a full-suite run, or point `cacheDir` at a per-run folder.

## Counts per area

| Area | Files | How they read source | Owner lane |
|---|---:|---|---|
| `shell` | 17 | static import, import.meta.glob | c3-terminal |
| `terminal` | 7 | static import | c3-terminal |
| `editor` | 6 | static import, import.meta.glob | o1-tools |
| `scm` | 6 | static import | o1-tools |
| `onboarding` | 5 | static import | c2-agents |
| `browser` | 4 | static import | o1-tools |
| `chrome` | 4 | import.meta.glob, static import | c3-terminal |
| `(src root)` | 3 | import.meta.glob, static import | c1-coord (shared) |
| `projects` | 3 | static import | c2-agents |
| `keys` | 2 | static import, import.meta.glob | c3-terminal |
| `launch` | 2 | static import | c2-agents |
| `look` | 2 | dynamic import, import.meta.glob | c3-terminal |
| `marks` | 2 | import.meta.glob | c3-terminal |
| `settings` | 2 | import.meta.glob | o1-tools |
| `status` | 2 | static import | c3-terminal |
| `usage` | 2 | import.meta.glob, static import | c1-coord (shared) |
| `carry` | 1 | import.meta.glob | c2-agents |
| `chat` | 1 | static import | o1-tools |
| `inbox` | 1 | static import | c2-agents |
| `insights` | 1 | static import | c1-coord (shared) |
| `setup` | 1 | import.meta.glob | c2-agents |
| `tower` | 1 | import.meta.glob | c2-agents |

**75** files in 22 areas.

## Files

### shell (17)

- `src/shell/browserOpen.test.ts` — static import
- `src/shell/checkboxHit.test.ts` — static import
- `src/shell/findTab.test.ts` — static import
- `src/shell/rowKeys.test.ts` — static import
- `src/shell/screenReaderNames.test.ts` — static import
- `src/shell/settingsRead.test.ts` — static import
- `src/shell/tabSearchFocus.test.ts` — static import
- `src/shell/wave3.test.ts` — static import
- `src/shell/window/chooserKey.test.ts` — static import
- `src/shell/window/lostWords.test.ts` — static import
- `src/shell/window/notices.test.ts` — static import
- `src/shell/window/screenBoundary.test.ts` — static import
- `src/shell/window/sidebarScreens.test.ts` — static import
- `src/shell/window/tabKeys.test.ts` — static import
- `src/shell/window/tabMenu.test.ts` — static import
- `src/shell/window/tabMenuKeys.test.ts` — static import
- `src/shell/windowSource.test.ts` — import.meta.glob

### terminal (7)

- `src/terminal/handover.test.ts` — static import
- `src/terminal/openFileScreen.test.ts` — static import
- `src/terminal/PaneMenu.test.ts` — static import
- `src/terminal/pin.test.ts` — static import
- `src/terminal/restoreAsk.test.ts` — static import
- `src/terminal/tabCycle.test.ts` — static import
- `src/terminal/xtermLogger.test.ts` — static import

### editor (6)

- `src/editor/contentSearchHidden.test.ts` — static import
- `src/editor/explorerAsk.t722.test.ts` — static import
- `src/editor/imageFiles.test.ts` — import.meta.glob
- `src/editor/mixedLineEnds.test.ts` — static import
- `src/editor/pdfPageLayers.test.ts` — static import
- `src/editor/t756.test.ts` — static import

### scm (6)

- `src/scm/actionError.test.ts` — static import
- `src/scm/autoPrWatch.test.ts` — static import
- `src/scm/commitRowKeys.test.ts` — static import
- `src/scm/commitShortcut.test.ts` — static import
- `src/scm/mergeBox.test.ts` — static import
- `src/scm/panelUx.test.ts` — static import

### onboarding (5)

- `src/onboarding/followLoop.test.ts` — static import
- `src/onboarding/guideGettingStarted.test.ts` — static import
- `src/onboarding/guideKeys.test.ts` — static import
- `src/onboarding/helpItems.test.ts` — static import
- `src/onboarding/hooksGuide.test.ts` — static import

### browser (4)

- `src/browser/chordKeys.test.ts` — static import
- `src/browser/dragThrough.test.ts` — static import
- `src/browser/extraHeaders.test.ts` — static import
- `src/browser/reopen.test.ts` — static import

### chrome (4)

- `src/chrome/outOfFlow.test.ts` — import.meta.glob
- `src/chrome/paletteOpen.test.ts` — static import
- `src/chrome/reach.test.ts` — static import
- `src/chrome/visualConsistency.test.ts` — static import

### (src root) (3)

- `src/main.slowStart.test.ts` — import.meta.glob
- `src/plainWords.test.ts` — import.meta.glob
- `src/theme.test.ts` — static import

### projects (3)

- `src/projects/model.test.ts` — static import
- `src/projects/settingsWarm.test.ts` — static import
- `src/projects/statusRefresh.test.ts` — static import

### keys (2)

- `src/keys/commands.test.ts` — static import
- `src/keys/keyScopes.test.ts` — import.meta.glob

### launch (2)

- `src/launch/paneMark.test.ts` — static import
- `src/launch/pickerRules.test.ts` — static import

### look (2)

- `src/look/cardChanges.test.ts` — dynamic import
- `src/look/glass.test.ts` — import.meta.glob

### marks (2)

- `src/marks/noPetArt.test.ts` — import.meta.glob
- `src/marks/registry.test.ts` — import.meta.glob

### settings (2)

- `src/settings/leave.test.ts` — import.meta.glob
- `src/settings/search.test.ts` — import.meta.glob

### status (2)

- `src/status/notificationClick.test.ts` — static import
- `src/status/resourceManagerUx.test.ts` — static import

### usage (2)

- `src/usage/ShareButton.test.ts` — import.meta.glob
- `src/usage/usageStatusUx.test.ts` — static import

### carry (1)

- `src/carry/settingsRegistry.test.ts` — import.meta.glob

### chat (1)

- `src/chat/ChatText.focus.test.ts` — static import

### inbox (1)

- `src/inbox/guideGroups.test.ts` — static import

### insights (1)

- `src/insights/insightsUx.test.ts` — static import

### setup (1)

- `src/setup/askArchive.test.ts` — import.meta.glob

### tower (1)

- `src/tower/pageWindows.test.ts` — import.meta.glob
