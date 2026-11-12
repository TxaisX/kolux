# LANE-REPORT: c2-agents

## Status (plain words, 3 lines max)
Sidebar fix proven in the real app: one folder row, its 6 sessions under it, no worktree rows; "synced" no longer runs into the branch name.
The "start agents through your own shell" code is finished and tested on our side; it goes live once c3-terminal plugs it into the pane start.
Smaller wins: one git process fewer per sidebar status read, one shared folder-compare rule, five dead helpers gone, git.rs tests split out.

## Done this round (round 3)
- Start: `git merge --no-edit integrate/wave-1` merged cleanly (npm patch bumps + AUDIT-c1-coord.md). Queue: browser-removal bug was already fixed by round 2 (70d1f42c); moved to `_shared/bugs/done/` with fixed-by.
- Round 2 left its LANE-REPORT un-updated. Round 2 commits for the record: bug 3 chooser (482afcdc), audit 16/17/18/21 (5d587fe1), browser removal 15/32/33 (70d1f42c), bug 2 sidebar + audit 5-9 (da20db33), audit 36 (004b7ce6).
- Bug 1 (agents start through the user's shell), c2 side: 2d4bd3cc. `agent_shell.rs` is now declared from agents.rs (`crate::agents::agent_shell`), so lib.rs (c3-owned) is untouched; c3 bug file updated with the new path.
  Proof: `cargo test --lib agent` -> `test result: ok. 349 passed; 0 failed; 1 ignored`. `cargo clippy --lib --tests`: no warnings in agents.rs/agent_shell.rs.
- Bug 2 proof (sidebar): harness run, vite 1440 / CDP 9420 / com.txaisxiong.kolux.c2-0, scratch repo, 4 Claude stand-ins in own folders + 2 terminals.
  `artifacts/round3/sidebar-6-sessions.png`: 1 folder row, 6 session rows, 0 worktree rows; folder row "sbproof | main | synced", synced = rgb(1,200,143) green. DOM dump `artifacts/round3/sidebar-dump.json`, script `artifacts/round3/sidebar-proof.mjs`.
- Folder row "mainsynced" spacing (found by the proof run): ProjectsPanel.tsx gives the folder row's push tag a 6 px gap (styles.css is c3's). Proof: rerun `artifacts/round3/folder-row-gap-after.png` shows "main  synced" with a gap (DOM: `"text": "sbproof | main | synced"`, push `hint push good` rgb(1, 200, 143)); that rerun's sessions did not start because a leftover "Report a crash" dialog from the earlier harness run covered Start, so the 6-session shot stays the first run's; `npx vitest run src/projects/__cards__/VIEW-051.test.ts` -> 5 passed.
- Audit 19 (c37be95c): workspaces.ts `dirKey` exported; parentDrop/model/deleting/scanView use it. New `src/projects/pathKeys.test.ts` (3 tests). `npx vitest run src/projects src/workspaces` -> `Test Files 75 passed (75)`, `Tests 417 passed (417)`; `npx tsc --noEmit` clean.
- Audit 29 (db16923c): deleted notesToShow, linkLabel, isRoot, fullOnHover, runningUnder + their tests (grep: declaration and own test only). `npx vitest run src/projects` -> `Tests 408 passed (408)`.
- Audit 22 (53c8b371): `Git::detect` keeps the first `git --version`; one git process fewer per status read. `cargo test --lib git::` -> 83 passed; `cargo test --lib scm` -> 169 passed.
- Refactor: git.rs tests moved to git_tests.rs (git.rs 4513 -> 2346 lines). Proof: `cargo test --lib git::` -> `test result: ok. 83 passed; 0 failed` (same 83 as before the move).
- Closed without change: audit 11 (`grok --help`: `--reasoning-effort ... [aliases: --effort]`, so `--effort` works); audit 35 (the `Command::new("powershell")` hits are inside tests only).

## Next round (top 3)
1. Bug 1 go-live: once c3-terminal lands the hook (`_shared/bugs/c3-terminal/20261112-1600-agent-shell-wrap-hook.md`), take harness screenshots of Claude Code, Grok, Codex, OpenCode and Terminal reaching their prompts; measure new-session-to-prompt time (goal: shell ready < 300 ms).
2. Refactor splits from AUDIT-c2-agents.md: scm.rs tests out (5792 lines), projects.rs tests out (6921), then ProjectsPanel.tsx (useWorktreeScan, usePrPoll).
3. Audit 12 (up to 4 PATH walks per agent pane, session-start speed) and audit 20 (panel-level test of worktree hiding), audit 34 (timers while hidden).

## For the coordinator
- CHANGELOG: "The sidebar shows each workspace folder with its sessions under it, never worktree rows (proven with 6 sessions)." / "Sidebar folder row: the push state no longer runs into the branch name." / "Faster sidebar refresh: one fewer git process per status read."
- Cross-lane, still open: c3-terminal must wire `crate::agents::agent_shell::via_shell` at terminal.rs spawn + pty_service fallback, keep the logical program for marks, and log terminal_spawn failures (bug file has exact lines). If c3 prefers `crate::agent_shell`, it may move the `mod` line into lib.rs.
- Decision still wanted (from round 1): agents started through Windows PowerShell 5.1 when PowerShell 7 is absent, with the user's profile loaded. OK?
- Audit 27 (two FEATURED agent lists: dropdown leads with claude/codex/grok; install list adds opencode) needs a product call: should OpenCode lead the New session dropdown? Left as is.
- Harness tip for other lanes: set `COREPACK_HOME` to the real corepack cache, or pnpm hangs on a download prompt under the scratch HOME.
