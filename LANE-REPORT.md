# LANE-REPORT c2-agents

NOTE: this file is deliberately NOT committed on integrate/wave-1. Committing it would put a
LANE-REPORT.md on the integration branch and every lane's round-start merge would hit an
add/add conflict with its own report. It persists on disk in this worktree. See AUDIT-c1-coord.md #0.

## Status (plain words, 3 lines max)
The Floor page and the detached Tower window no longer read or redraw while the window is hidden; the Floor catches up the moment it is shown.
The sidebar's pull-request polling now lives in its own small file; the sidebar file is about 50 lines shorter, behaviour unchanged.
Last round of the wave: no queued bugs for this lane; the Grok/OpenCode smoke run still waits on c3's pane-type fix.

## Done this round (round 6)
- Start: `git merge --no-edit integrate/wave-1` clean (CHANGELOG + wave-1-progress). Bug queue empty. Handoffs read: only c1-coord r3 mentions c2 (tsc red on o1's shortcutRows.ts, not ours). c3 bug 20261112-1320-grok-opencode-panes-read-as-shell.md still open in c3's queue, so smoke flow 6 was not rerun.
- Audit 34 (78bd4c6f): FloorView skips its 5 s `activity_timeline` read while `document.hidden` and reads once on `visibilitychange` to shown; TowerWindow's 1 s clock stops redrawing while hidden. New test "audit 34: no Floor re-reads while the window is hidden..." (hidden 20 s -> 0 reads; shown -> 1 read at once, then every 5 s).
  `npx vitest run src/floor src/tower` -> `Test Files 9 passed (9)`, `Tests 78 passed (78)`.
  Demo.tsx (150 ms) left as is: while hidden its loop returns the same frame, so React skips the redraw. Guides.tsx 1 s check only runs while a dialog blocks a guide step; left.
- Refactor (a7d28e4a, 1e9a34de): the pull-request background poll moved unchanged from ProjectsPanel.tsx into src/projects/usePrPoll.ts (2909 -> 2861 lines).
  `npx vitest run src/projects src/launch src/scm` -> `Test Files 147 passed (147)`, `Tests 953 passed (953)`; after the comment tidy `npx vitest run src/projects` -> `Tests 407 passed (407)`.
- Closed with no change: audit 20 (covered by VIEW-051 box 3 panel test: 6 agents in 3 worktrees -> 1 folder row, 6 session rows, 0 worktree rows; plus rows.test.ts prunedTeamFolders/hiddenTeamFolders). Audit 30 (CardFacts.agents = 0 is Txais's 2026-11-12 call: the card leaves out the agent count; the field lives in src/look, not ours).
- `npx tsc --noEmit` -> only `src/settings/shortcutRows.ts(9,102) ... 'browser' does not exist in type 'Record<Scope, string>'` (o1-tools, already queued).
- useWorktreeScan split NOT done: sweepWorktrees touches setMessage, teamRef, onSettingRef, index, setPushedBy, scanned/unseen refs and three setters; it needs a state object passed in, not a clean move.

## Next round (top 3)
1. Once c3 adds grok/opencode to the pane Agent type: rerun smoke flow 6 on lane ports, expect 5/5; measure New session -> agent prompt time.
2. useWorktreeScan out of ProjectsPanel.tsx (pass a small state bag), then remaining files over 800 lines per AUDIT-c2-agents.md.
3. Audit 25 (one bounded-process runner for git.rs/scm.rs/scm_writers.rs), audit 31 (stale #[allow(dead_code)]).

## For the coordinator
- CHANGELOG: "The Floor page and the Tower window stop working in the background while Kolux is hidden, and catch up as soon as it is shown."
- c3-terminal: 20261112-1320-grok-opencode-panes-read-as-shell.md still blocks the 5-agent smoke proof (Grok pane reads as data-agent="shell").
- o1-tools: tsc red on shortcutRows.ts is still open on the merged branch.
- Decisions still wanted: (1) agents start through Windows PowerShell 5.1 when PowerShell 7 is absent, with the user's profile loaded; (2) should OpenCode lead the New session dropdown?
- Token ledger refreshed: all-time 17.75B tokens, $4,638.92 API-equivalent; recorded pay-per-token spend (OpenCode) $78.06.
