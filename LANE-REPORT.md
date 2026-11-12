# LANE-REPORT c1-coord

NOTE: this file is deliberately NOT committed on integrate/wave-1. Committing it would put a
LANE-REPORT.md on the integration branch and every lane's round-start merge would hit an
add/add conflict with its own report. It persists on disk in this worktree. See AUDIT-c1-coord.md #0.

## Status (plain words, 3 lines max)
Bug queue cleared: the Setup Guide's "Create a workspace" step works again, the wizard redraws in a newly loaded language, the sidebar row has a test hook, and a red gate test is green.
Starting an agent spends less time finding its program: 67 ms -> 18 ms for the lookups on this PC.
Two huge Rust files halved by moving their tests out (projects.rs 6921 -> 3323 lines, scm.rs 5801 -> 2984).

## Done this round (round 4)
- Start: lib.rs showed as modified with an empty diff (stat-only, autocrlf); `git -c core.autocrlf=false add` cleared it without a content change, then `git merge --no-edit integrate/wave-1` merged cleanly. No handoff notes from other lanes existed yet.
- Bug sidebar test id (6e76a581): the worktree-style sidebar row carries `data-testid="sidebar-workspace"`. Moved to done.
- Bug wizard language redraw (66463f13): Wizard calls `usePackLoaded()`; hooksConsent.test.ts stubs that hook (its stand-in React has no useReducer). Moved to done.
- Bug guide "Create a workspace" (adc5a612): `plusFor` now clicks the project's folder row, then `button.sb-new`; tests updated. Moved to done.
  Proof: `npx vitest run src/onboarding src/projects` -> `Test Files 112 passed (112)`, `Tests 761 passed (761)`; `npx tsc --noEmit` exit 0.
- Bug tower entry test (0f2cad06): language mock carries `locale`/`onLanguageChange`. Proof: `npx vitest run src/tower` -> `Tests 61 passed (61)`, no unhandled errors. Moved to done.
- Bug new-session latency 1050 ms: traced; the measured path (pane + > Blank terminal) is `onSplit("right")` in c3's TerminalPane.tsx, no c2 code in it. Analysis appended, routed to c3-terminal.
- Bug web-entry kind/space copy: both halves are c3 files (src/space/ is c3's); routed to c3 with the rename plan.
- Audit 12, session start speed (e3fd1fb4): `program_finder()` reads the search path once per agent start.
  Before/after: `cargo test --lib program_finder_timing -- --ignored --nocapture` -> `per start: old 66.681245ms, shared finder 18.19634ms`.
  `cargo test --lib agent` -> `test result: ok. 350 passed; 0 failed; 2 ignored`.
- Refactor (af847b54): projects.rs tests -> projects_tests.rs. `cargo test --lib projects::` -> 131 passed before and after.
- Refactor (f3f1100f): scm.rs tests -> scm_tests.rs; 27 lines inside multi-line string literals kept byte-identical. `cargo test --lib scm` -> 169 passed before and after.
- `cargo clippy --lib --tests`: no warnings in agents/agent_shell/projects/scm/git files.

## Next round (top 3)
1. Bug 1 go-live once c3 wires `agent_shell::via_shell` (`_shared/bugs/c3-terminal/20261112-1600-agent-shell-wrap-hook.md`): harness screenshots of Claude Code, Grok, Codex, OpenCode, Terminal at their prompts; measure agent New session to prompt.
2. Fold `installed_program` into `program_finder` (the last extra search-path read, ~20 ms); rename newTabEntryRun.ts `kind: "browser"` -> "web" once c3 says Pane.tsx is ready.
3. ProjectsPanel.tsx split (useWorktreeScan, usePrPoll); audit 20 (panel test of worktree hiding), audit 34 (timers while hidden).

## For the coordinator
- CHANGELOG: "Setup Guide: Create a workspace opens New session on the right folder again." / "The first-run wizard switches language as soon as the pack loads." / "Starting an agent finds its program faster (one search-path read instead of up to four)."
- Gate: src/tower/entry.test.ts fixed (was red on the merged gate).
- Cross-lane, still open: c3-terminal wires `crate::agents::agent_shell::via_shell` (bug file has exact lines); c3 owns the new-session latency (pane split path) and the "browser" kind rename.
- Decision still wanted (from round 1): agents started through Windows PowerShell 5.1 when PowerShell 7 is absent, with the user's profile loaded. OK?
- Audit 27 product call still open: should OpenCode lead the New session dropdown?
- Token ledger refreshed: all-time 17.66B tokens, $4,630.25 API-equivalent; recorded pay-per-token spend (OpenCode) $77.53.
