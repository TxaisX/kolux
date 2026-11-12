# Lane o1-tools — Round 4 Report

## Status

Both queued bugs are fixed, so the merged gate's two red marks in my files are gone (tsc on
`shortcutRows.ts`, the `windowsHide` check on `scripts/local-run.mjs`). Five audit findings closed:
one shared disk-stamp poll for every editor tab, a cheap comparison on the All Changes watcher tick,
one path key across the editor, a tested answer behind the Checks panel's empty state, and the
CodeMirror theme moved out of the 900-line pane.

## Done this round

### 1. Queued bugs (both done, files moved to `_shared/bugs/done/`)

| Bug | Result |
|---|---|
| `20261112-1250-shortcutrows-browser-scope-tsc` | **fixed** (`5f4b9ba5`). The `browser` row in `AREAS` could not be hidden by a type assertion once c3-terminal removed the scope (TS2353 is an excess-property check, which a cast does not silence). The row is gone and the map is `Record<Scope, string>` with exactly the live scopes; `shortcutRows.test.ts` counts 128 rows (136 − the 8 browser commands). |
| `20261112-1305-local-run-spawns-windowshide` | **fixed** (`5f4b9ba5`). `windowsHide: true` on both spawns in `scripts/local-run.mjs` (the `tauri build` and the detached launch). `npx vitest run scripts/nowin-spawns.test.mjs` → 2 passed. |

### 2. Audit findings (highest severity first)

| # | Fix | Commit |
|---|---|---|
| N-05 (P2) | `All Changes` no longer `JSON.stringify`s every file's old and new text on each watcher tick. `listSignature` reads only what the pane draws plus the per-file `stamp` Rust sends, which changes whenever the change does; a tick that finds the same signature keeps the list. Two tests: same change → same signature however the array was built; any drawn field, the order, or the membership → different. | `f3497eaa` |
| N-03 (P2) | One disk-stamp poll for every visible editor tab. Before: N tabs → N `file_stamps` calls per 2 s, each running `fence.allow` (which lists the worktrees under the fence mutex). After: one call per 2 s for all of them, one interval, one window focus listener; a tab coming forward is still checked at once. The gone/EDIT-032 wording stays per tab, on the rare null answer. Five tests, including "three watchers → one call" and "the answer lines up with the paths". | `01e62fad` |
| N-11 (P3) | `buffers.ts` `keyOf` is now the only path key in the editor: `rail.ts` (WSL notes never matched their file — the real bug), `desktopDrops.ts` (a drop with two spellings of one file opened it twice) and `closeGuard.ts` (an open file under another spelling was missed, so its empty note could be deleted). `noteLinks.ts` already used it. WSL test added. | `a2c071d7` |
| N-20 (P2) | The Checks panel's empty state draws from `startPr.offerUi` — the block reason, the "checking" line, the create button's wording and the one-click — so ten plain tests cover the gating that used to be inline conditionals with no test. New `PrStart.test.ts` renders the panel (nothing to click, says "checking", asks Rust nothing during render) and `CommentsPanel.test.ts` renders the hidden tab. `useSyncExternalStore` got React's server snapshot in `prDraft.ts` and `oneClick.ts`, which is what makes a panel renderable without a DOM. The `act()` → `rowError` wire stays covered at the model level (`panelUx.test.ts`): a click cannot be driven here. | `4d02b88a` |
| N-14 (P3) | `look` (the CodeMirror theme, ~20 lines) moved to `src/editor/editorTheme.ts`. The diff, All Changes and the disk banner each imported the 933-line `EditorPane` for that one object — the cycle the build warned about. | `93809bb1` |

## Proof (run fresh after the last change, `93809bb1`)

- `npx tsc --noEmit` → `tsc exit: 0`, no output.
- `npx vitest run src/editor src/scm src/settings src/ports src/artifacts src/automations src/skills src/chat src/open scripts/nowin-spawns.test.mjs`
  → `Test Files  321 passed (321) · Tests  2807 passed (2807)`.
- `npx vitest run scripts/nowin-spawns.test.mjs` alone → `2 passed`.
- `git merge --no-edit integrate/wave-1` merged clean (115 files) at the top of the round.
- No UI screenshot: every change this round is logic behind a panel (polls, comparisons, path keys,
  gating rules) and each has a test; no dev instance was started, so nothing is claimed about pixels.

## Next round

1. **N-09**: `frontMatter.ts` is 777 lines and 90% a gap-placement engine; split `richPlacement.ts`.
2. **N-23 / N-39**: `scm/model.ts` (686) has three clean seams; `automations/AutomationsPage.tsx` (760)
   can lose `Detail` and `HermesRuns` to `AutomationDetail.tsx`.
3. **The feature walk** the lane brief asks for (item 2) is still not done: nobody has walked my
   screens against `docs/guide/feature-index.md` with the app running. It needs a `pnpm local` build
   and one harness instance; do it before more refactoring.

## For the coordinator

- **CHANGELOG lines:**
  - "Editor tabs share one disk check, so a window full of open files asks Rust once per two seconds instead of once per tab."
  - "Notes and dragged files match their file however its path is spelled, including inside a WSL distribution."
  - "The Checks tab says why it cannot offer a pull request, in one tested place, and no longer offers anything before it knows the branch's state."
- **DECISIONS row requested (small):** the editor's path key is `buffers.ts` `keyOf` and nothing else
  normalises paths in `src/editor`. Cost, stated: a Linux file inside WSL keeps its letter case, so
  `a.md` and `A.md` stay two files (as Linux does).
- **Nothing needed from another lane this round.** The two bug files I was sent are closed.
- **Round 3's dependency ask still stands:** `src/editor` is green on Lexical 0.53, the bump is
  c1-coord's call (`_shared/bugs/c1-coord/20261112-1310-lexical-053-verified-take-the-bump.md`).