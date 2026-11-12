# Lane o1-tools — Round 6 Report

## Status

Settings search no longer costs a disk scan: typing a word draws each matching page's headings and
controls, and the reads (Claude setup scan, GitHub budget, shell list, sample terminal, per-project
workspace lists, the agents' log scan) wait until the page is opened. Four duplicate or dead helpers
are gone (two number boxes, one number draft field, six dead exports), and the shortcut list is
filtered once per change instead of once per area group. My bug queue was empty; eight findings are
closed, two remain open by design.

## Done this round

### 1. Queued bugs

None. `_shared/bugs/o1-tools/` was empty at the start and stayed empty.

### 2. Audit findings (highest severity first)

| # | Fix | Commit |
|---|---|---|
| N-45 (P2) | A `SearchRun` context says a search is drawing the page. While true: `ClaudeSetupPage` runs neither `project_list` nor the `claude_setup` disk scan and offers no workspace picker; `GitPage` runs neither `scm_gh_budget` nor `branch_prefix_check`; `AutoPrSettings` runs no `project_list`/`workspace_list`; `TerminalPage` asks for no `shell_list`, no memory profile and builds no xterm sample; the usage page runs neither `Activity` nor `TokenAnalytics` (the agents' log scan). Each still draws its headings and controls, with one line saying the value shows when the page is opened — the search result stays editable, it just stops reading. Five fake-DOM tests hold both answers (searched: no read; opened: the read). | `590f3b81`, `fd0183c9` |
| N-47 (P2) | `NumberDraftField` is the one "typed text stays as typed, a pause saves a finished number in range, leaving clamps and saves" box; the auto-save delay and the agent sleep minutes pass their parse, range and label. | `2b9db16e` |
| N-48 (P2) | `NumberField` (typed number, corrected on Enter/blur/leave, kept when the page closes) moved to its own module; `InputCards`' `Lines` is it. One rule, two call sites. | `fd0183c9` |
| N-50 (P3) | Deleted `pickers.ts` + its test (4 exports only the test used) and five dead exports: `NEUTRAL`, `hasChanges`, `autoSaver`, `hiddenWhitespace`, `openInItems`. The two Open in tests now assert through `scm/openWith.fileApps`, the real menu builder, so the deletion did not lose the assertion. | `a7e8b506` |
| N-53 (P3) | One `useMemo` filters the shortcut rows, one groups them by area, keyed on rows/filter/query. No debounce: the filter is an `includes` over ~200 rows, so a settle timer would add latency and buy nothing. | `86ba3125` |
| N-52 (P3) | Partly closed. The global key recording was already covered by the SET-009 cards (`__cards__/SET-008-013.test.ts` mounts the page on the fake DOM and drives the window's own `keydown`: record, Esc keeps the old chord and lets go of the keyboard, Reset) — recorded in the audit, no duplicate test written. Added `NotificationsPage.test.tsx`: the volume saves once when the slider is let go (not per drag step), an untouched slider saves nothing, and the test button asks the window for a sample notification. | `a7e8b506`-next |

### 3. Not done, and why

- **The feature walk (lane brief item 2) is still not done.** Nobody has walked my screens against
  `docs/guide/feature-index.md` with the app running. Every change this round is behind a panel and
  carries a test, and no dev instance was started, so nothing is claimed about pixels. It needs one
  harness instance (vite 1460, CDP 9344, `com.txaisxiong.kolux.o1`) and about an hour; the next
  session that opens Settings should do it first, before any more refactoring.
- **N-30** (fake-DOM tests for `ChatView`, `MessageBox`, `RunsDashboard`, `SkillUpdate`) and the rest of
  **N-52** (`CustomThemeEditor`, `GeneralPage` handlers) are still open — roughly 3 h together.

## Proof (run fresh after the last change, `a7e8b506` + the notifications test)

- `node node_modules/typescript/bin/tsc --noEmit` → no output, `tsc exit: 0`.
- `npx vitest run src/editor src/scm src/settings src/ports src/artifacts src/automations src/skills src/chat src/open src/editmenu`
  → `Test Files  326 passed (326) · Tests  2835 passed (2835)` (round 5: 2836 — three tests of deleted dead
  helpers went, eight new ones came).
- `npx vitest run src/settings/searchRun.test.ts` → `5 passed (5)`; `src/settings/NotificationsPage.test.tsx`
  → `3 passed (3)`; `src/settings` alone → `104 passed · 554 tests`.
- `git merge --no-edit integrate/wave-1` → `Already up to date` at the top of the round.
- No screenshot: no dev instance was started, and no pixel is claimed.

## Next round

1. **The feature walk** against `docs/guide/feature-index.md`, with the harness running, before more refactoring.
2. **N-30**: fake-DOM tests for `ChatView`, `MessageBox`, `RunsDashboard`, `SkillUpdate`.
3. **N-52 rest**: `CustomThemeEditor` (save/rename/duplicate/delete/import) and `GeneralPage`'s handlers.

## For the coordinator

- **CHANGELOG lines:**
  - "Searching Settings no longer reads every page it finds: the Claude setup scan, the GitHub budget, the shell list and the sample terminal, each project's workspace list and the usage log scan now wait until you open the page."
  - "The shortcut list filters once per change instead of once per group on every render."
  - "Removed six helpers nothing called, and merged two pairs of duplicate number boxes."
- **No DECISIONS row requested this round** (round 4's `keyOf` row still stands).
- **Nothing needed from another lane.** My bug queue is empty; c2-agents' round-6 ask (`browser` out of
  `shortcutRows.ts` `AREAS`) was already done in round 5 — verified by grep this round.
- **Still not mine:** N-51 (`usageReads` is read but nothing writes it) lives in `src/usage/`; the new
  `SearchRun` context means the usage page is no longer mounted by a search, so the orphan key is only
  reachable from the page itself.
