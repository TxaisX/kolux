# Lane o1-tools — Round 5 Report

## Status

Eight more audit findings are closed: every panel link opens through one helper, the prefix sample
and the Artifacts folder walk stop asking on every keystroke/tick, settings writes made from code
join the page save's turn, and three dead plumbing paths (chat commands, worktree-per-run, a double
list read) are gone. The automation page also lost 232 lines to a new detail module. Both queued bugs
are closed and my queue is empty.

## Done this round

### 1. Queued bug (queue now empty)

| Bug | Result |
|---|---|
| `20261112-1251-shortcutrows-browser-scope` | Already fixed in round 4 (`5f4b9ba5`); re-verified this round (`tsc exit: 0`) and moved to `_shared/bugs/done/` with the `fixed-by` line. |

### 2. Audit findings (highest severity first)

| # | Fix | Commit |
|---|---|---|
| N-19 (P2) | `panelUx.openInBrowser(url, open?)` returns the note to show or null. ChecksPanel, StackMap and AutoPrStatus each keep their own sink but share the road and the words, so a refused link cannot be swallowed by one panel and worded differently by another. New test drives both answers. | `a6aacc4a` |
| N-46 (P2) | The branch-prefix sample runs on `useSettled(typed)`: Rust is asked after a 150 ms pause, not on every keystroke (it was one IPC call per character typed into the custom-prefix box). | `a6aacc4a` |
| N-49 (P2) | `patchSettings(patch)` in `useSettings.ts` is the page save's own turn: read the disk copy, merge, `tidySettings`, write, read back. The setup card's resume switch, Claude account upkeep and the appearance flush used to read-merge-write on their own, so they could interleave with a page save and skip the tidy (SET-035). Three tests: it merges rather than replaces, it tidies, and a failure rejects so the caller still takes its switch back. | `9d3f7e6b` |
| N-27 (P2) | Deleted the composer's `commands` prop and the `reported` half of `commandsFor`/`menuFor`: nothing ever passed them, so a session's own command list was reachable only from a test. | `fd34fe85` |
| N-28 (P2) | Deleted the automation dialog's `mode`, `base`, `runSetup` constants and `setupChoice` — the last of the "new worktree per run" plumbing. The saved input still carries `workspaceMode: "existing"`, `baseBranch: ""`, `runSetup: false`, so the back end sees exactly what it saw. | `fd34fe85` |
| N-32 (P3) | A Hermes/OpenClaw row action reads the automation list once: `refresh()` already ends in `load()`, so the `act()` wrapper was a second read per click. | `fd34fe85` |
| N-39 (P3) | `Detail` and `HermesRuns` moved to `AutomationDetail.tsx` (props only, no cycle): `AutomationsPage.tsx` 761 → **529** lines, 238 in the new file. The page test imports `HermesRuns`/`HermesState` from the new module. | `8e12541c` |
| N-21 (P2) | `scanWhileShown` (exported, tested) starts the Artifacts folder scan at once and every 3 s while the page is shown, and stops it while the window is hidden; the first scan runs on return. A failed scan is now named once instead of swallowed, so a folder Kolux cannot read no longer looks idle. Three fake-timer tests. | `b783c5d7` |

### 3. Findings verified closed (no code needed)

N-40 (no link switch on General or Terminal; the Terminal text says the user's own browser),
N-41 (`browserSearchSessionUrl` gone from `src/`), N-44 (c3-terminal `a4671921` wired
`removePlan`, so the "Removing a started session" setting is honoured).

## Proof (run fresh after the last change, `b783c5d7`)

- `node node_modules/typescript/bin/tsc --noEmit` → no output, `tsc exit: 0`.
- `npx vitest run src/editor src/scm src/settings src/ports src/artifacts src/automations src/skills src/chat src/open src/editmenu scripts/nowin-spawns.test.mjs`
  → `Test Files  326 passed (326) · Tests  2836 passed (2836)`.
- `npx vitest run src/scm` alone → `45 passed (45) · 375 tests`; `src/settings` alone → `103 passed · 549 tests`;
  `src/automations src/chat` → `44 passed · 467 tests`; `src/artifacts` → `7 passed · 41 tests`.
- `git merge --no-edit integrate/wave-1` merged clean (2 files: CHANGELOG, wave-1-progress) at the top of the round.
- No UI screenshot: every change is behind a panel (a link helper, a settle timer, a save turn, a scan
  timer, removed plumbing), each has a test or a tsc proof, and no dev instance was started, so nothing
  is claimed about pixels.

## Next round

1. **N-45**: settings search mounts every matching page in full (a `claude_setup` disk scan for typing
   "claude"). Pass a `searching` flag so the heavy cards skip their load. Biggest remaining P2 in my area.
2. **The feature walk** (lane brief item 2) is still not done: nobody has walked my screens against
   `docs/guide/feature-index.md` with the app running. It needs one `pnpm local` launch and one harness
   instance — do it before more refactoring.
3. **N-30 / N-52**: a fake-DOM test for one IPC-heavy component (start with `ShortcutsPage`'s global key
   capture, which intercepts keys everywhere).

## For the coordinator

- **CHANGELOG lines:**
  - "A link in any Checks panel opens in your own browser through one path, so a refusal is never silent."
  - "Settings written from code (resume setup, Claude account upkeep, appearance) now take the same turn as a page save and are tidied the same way."
  - "The Artifacts folder scan pauses while the window is hidden, and says why when a folder cannot be read."
  - "The custom branch-prefix sample checks after you pause typing instead of on every keystroke."
- **No DECISIONS row requested this round** (round 4's `keyOf` row still stands).
- **Nothing needed from another lane.** My bug queue is empty.
- **Not mine, found while working:** N-51 (`usageReads` is read by the panes but nothing in the app
  writes it — an orphan key only editable by hand) lives in `src/usage/`, which this lane does not own.
  Worth a bug to c1-coord or whoever holds `src/usage/`.
- **Round 3's dependency ask still stands** (informational): `src/editor` is green on Lexical 0.53.
