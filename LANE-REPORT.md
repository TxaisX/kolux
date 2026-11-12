# Lane o1-tools — Round 3 Report

## Status

The editor passes on Lexical 0.53 with one small change, so the dependency bump is ready for the coordinator.
Four audit findings are fixed: the Checks tab follows the worktree instead of reading git once, right-click
copies a text selection anywhere, the preview stops re-drawing per keystroke, and Ports keeps its list.
The queued native-terminal switch exists, and c3-terminal's scope removal can no longer break my files.

## Done this round

### 1. Queued bugs

| Bug | Result |
|---|---|
| `20261112-1130-native-terminal-toggle` | **fixed** (`64917622`). New `src/settings/NativeTerminalCard.tsx` on Settings > Terminal, Windows only, off by default: saves `terminalNative` (the field `inputPrefs.ts` reads as `INPUT_FIELDS.native`, which `TerminalPane.tsx:417` hands to the engine), carries the DLL hint, and shows `native_term_available`'s own reason when the engine is missing. Search entry `terminal/native`. Tests: `NativeTerminalCard.test.ts` (3), plus `search.test.ts` now knows the file. |
| `20261112-1152-lexical-053-markdown-roundtrip` | **fixed and reported** (`d00de81c`). Root cause: 0.53's markdown **export** escapes `[ ] < &` as `&#91;`/`&#60;`/`&#38;` (`@lexical/markdown` dist `LexicalMarkdown.dev.js:1653`, against `:1280` in 0.52). Kolux's rich view must write back what was typed, so 21 editor tests failed. `src/editor/mdExport.ts` turns those four entities back in the one place the editor, the round-trip check and a `<details>` body export through. Deps reverted to `^0.52.0` as asked; the bump is filed to c1-coord. |
| `20261112-1730-browser-scope-gone-settings-and-imports` | **fixed ahead of the merge** (`ed23998a`). `SourceControlPanel` opens a commit through `openExternal`; two tests stopped mocking `../browser/*`; the Shortcuts area map is `{...} as Record<Scope, string>` so it compiles with the browser scope present or gone (ShortcutsPage draws no area with no rows). |

### 2. Audit findings fixed (highest severity first)

| # | Fix | Commit |
|---|---|---|
| N-01 (P1) | Already closed by round 2: `htmlPreview.ts` opens the served address through `openExternal`. Verified, no change needed. | — |
| N-15 (P1) | Already closed by round 2: `ChecksPanel.tsx:156` calls `openOut(pr.url)` → `openExternal`. Verified, no change needed. | — |
| N-16 (P2) | `PrStart` subscribes to `watchStatus(dir)`, re-renders when the five-minute readiness answer goes stale, and reads once when nothing on screen answers. Commit in a terminal now moves the offer. | `d5d771ea` |
| N-07 (P2) | Right-click on a text selection outside a field gets a Copy-only row (`editMenuItems` gains `plainSelection`); `runEdit` copies the selection through the clipboard without focusing, since focusing drops it. No selection: menu stays hidden as before. | `a5703046` |
| N-04 (P2) | The preview draws from the text once it has settled (300 ms, the same wait the editor's own preview uses) instead of re-parsing and re-sanitising the whole note per transaction. | `979ecaf7` |
| N-17 (P2) | The ports scan only clears the list when the workspace changed, not when the popover opens or closes, so the count and the last good list survive a click and a failed scan. | `4b76b9e6` |
| N-06 (P2) | The Explorer's dotfile pass, ignored pass, flattened rows and selected index are memoised on what they read, so a scroll tick no longer walks every folder. | `93f9719e` |

## Proof

- `npx tsc --noEmit` → exit 0, no output (run after the last change, `ed23998a`).
- `npx vitest run src/settings src/scm src/ports src/editor` →
  `Test Files 259 passed (259) · Tests 2192 passed (2192)`.
- On Lexical 0.53 in this worktree (deps since reverted): `npx vitest run src/editor` →
  `Test Files 112 passed (112) · Tests 1264 passed (1264)`; tsc clean. Back on 0.52: the same 112/1264.
- No UI screenshot this round: every fix here is logic a test covers, and no dev instance was started
  (the harness launch was not needed to prove them). The native-terminal switch is drawn by a test, not
  by a screenshot — that is the one gap in this report.

## Next round

1. **N-03**: every visible editor tab still runs its own 2 s `file_stamps` poll (`EditorPane.tsx:446-450`),
   and each poll lists worktrees under the fence mutex. One shared poller for all visible paths.
2. **N-05 / N-11**: All Changes stringifies old and new on every watcher tick; the path key is
   re-implemented four times and the rail's copy mangles WSL paths.
3. **N-20**: `PrStart.tsx` and `CommentsPanel.tsx` have no test. There is no DOM environment in this repo,
   so either add one (a dependency, so c1-coord) or pull their logic into pure helpers and test those.

## For the coordinator

- **CHANGELOG lines:**
  - "The Checks tab follows your branch: commit in a terminal and the Create pull request button appears without leaving the tab."
  - "Right-click copies selected text anywhere in Kolux — previews, chat messages and diffs — not just in text boxes."
  - "A preview no longer re-draws on every keystroke, and the Ports list keeps its count when you open it."
  - "Settings > Terminal has a switch for the experimental Windows Terminal engine (Windows only, off by default)."
- **DECISIONS row requested:** the eight Lexical packages move to `^0.53.0`; the rich view keeps the
  characters the user typed by undoing Lexical's four text entities in `src/editor/mdExport.ts`. Known
  cost, stated: a note literally containing `&#60;`/`&#91;`/`&#93;`/`&#38;` would save the character.
- **Dependency ask (c1-coord):** `src/editor` is green on 0.53 — take the bump when convenient
  (`_shared/bugs/c1-coord/20261112-1310-lexical-053-verified-take-the-bump.md`).
- **Still red from round 2:** `guide-check` names four deleted files in `docs/guide/files-and-browser.md`
  (c1's file). Nothing else in `pnpm check` was re-run this round.
