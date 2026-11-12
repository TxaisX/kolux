# LANE-REPORT c2-agents

NOTE: this file is deliberately NOT committed on integrate/wave-1. Committing it would put a
LANE-REPORT.md on the integration branch and every lane's round-start merge would hit an
add/add conflict with its own report. It persists on disk in this worktree. See AUDIT-c1-coord.md #0.

## Status (plain words, 3 lines max)
Agents now start inside the user's own shell, proven live: Claude Code, Codex and Grok each started from New session as PowerShell -> agent and took typed input.
OpenCode starts the same way; in the throwaway test profile it exits with code 1, exactly as it does when `opencode` is typed by hand in that profile.
One fewer search-path read per agent start; two dead exports removed from the sidebar code.

## Done this round (round 5)
- Start: `git merge --no-edit integrate/wave-1` clean; `pnpm install --frozen-lockfile` (lexical 0.53.0). Bug queue empty.
- Bug 1 go-live (c3 wired via_shell in 2cb2e273). `node scripts/evidence/smoke.mjs --only 6 --keep --port 1440 --cdp 9420 --identifier com.txaisxiong.kolux.c2.smoke --temp artifacts/round5/smoke6`:
  Claude Code and Codex stand-ins echoed their lines (marks: `smoke6-claude-mwe12lmb`, `smoke6-codex-mwe12pkk`); flow then
  `FAIL 6: timed out after 30000 ms waiting for a Grok pane` because the Grok pane carries data-agent="shell" (VendorMark's Agent type has no grok/opencode; c3 bug filed).
  By hand over CDP 9420: typed `r5-grok-mark` into the Grok pane -> `marks/agent-grok.txt` holds `r5-grok-mark`.
  Process tree (Win32_Process under kolux.exe 35628): each agent pane is `powershell.exe -NoLogo -EncodedCommand ...` -> `cmd.exe /c "...standin\claude.cmd" --permission-m...` (same for codex.cmd, grok.cmd). No agent exe is the pane's own process.
  OpenCode (real binary, stand-ins already restored): New session > Show more agents > OpenCode -> "Starting background server..." then `terminal 5 exited (Some(1))`; typing `opencode; echo EXIT=$LASTEXITCODE` in the same app's plain shell pane gave the same error and EXIT=1 (scratch profile). Screenshots: artifacts/round5/grok-fail.png, five-agents.png, opencode-by-hand.png (first-run dialog covers part of the grid).
  App and dev server stopped afterwards (port 1440 free).
- Audit 12 follow-up (5aff4941): `installed_program_with` takes the start's shared finder; `agent_start_line` reads the search path once, was twice.
  `cargo test --lib agent` -> `test result: ok. 350 passed; 0 failed; 2 ignored`. Timing: `cargo test --lib program_finder_timing -- --ignored --nocapture` -> `per start: old 38.689955ms, shared finder 12.7704ms` (the removed extra read is one more full read of the same size). `cargo clippy --lib --tests`: nothing in agents.rs.
- Audit 29 (8e30ff6b): deleted `renameError` + its write-only map and projects `headers.overflows` (grep: only their own tests). `npx vitest run src/projects src/launch` -> `Test Files 104 passed (104)`, `Tests 587 passed (587)`.
- Closed with no change: audit 11 (`grok --help`: `--reasoning-effort <EFFORT> ... [aliases: --effort]`, so `--effort` works); audit 35 (the `Command::new("powershell")` is inside a #[cfg(test)] test only); audit 28 `launchInOrder` kept (its tests are the SESS-026 order contract); audit 15/33 already done via integrate (`kind: "web"`).
- `npx tsc --noEmit` -> one error, not mine: `src/settings/shortcutRows.ts(9,102) ... 'browser' does not exist in type 'Record<Scope, string>'` (already in o1-tools queue: 20261112-1251-shortcutrows-browser-scope.md).

## Next round (top 3)
1. Once c3 adds grok/opencode to the pane Agent type: rerun smoke flow 6 on lane ports, expect 5/5; measure New session -> agent prompt time.
2. ProjectsPanel.tsx split (useWorktreeScan, usePrPoll); audit 20 (panel-level test of worktree hiding).
3. Audit 34 (timers while hidden: Demo, TowerWindow, FloorView, Guides) and audit 19 (path compares via sameDir).

## For the coordinator
- CHANGELOG: "Agents started from New session now run inside your own shell (PowerShell on Windows), the same as typing `claude` or `grok` in a terminal."
- c3-terminal: bug 20261112-1600-agent-shell-wrap-hook.md is proven live by this round (move to done); new bug 20261112-1320-grok-opencode-panes-read-as-shell.md (makes smoke flow 6 fail).
- o1-tools: tsc red on shortcutRows.ts is still open on the merged branch.
- Decision still wanted (round 1): agents start through Windows PowerShell 5.1 when PowerShell 7 is absent, with the user's profile loaded. OK? (That is what runs today on this PC.)
- Audit 27 product call still open: should OpenCode lead the New session dropdown? (Today it sits under "Show more agents".)
- Token ledger refreshed: all-time 17.72B tokens, $4,636.29 API-equivalent; recorded pay-per-token spend (OpenCode) $77.83.
