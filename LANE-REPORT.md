# LANE-REPORT: c2-agents

## Status (plain words, 3 lines max)
Round 1 (audit only) done: all three top bugs are traced to a root cause with a fix design; 37 findings in AUDIT-c2-agents.md.
No code changed. Claude's "won't start" is most likely its folder-trust question defaulting to "No, exit"; Grok's account is at its weekly limit.
Round 2 starts the fixes.

## Done this round
- Merged integrate/wave-1: `git merge --no-edit integrate/wave-1` -> "Already up to date." Bug queue `_shared/bugs/c2-agents/` empty.
- Wrote AUDIT-c2-agents.md (four read-only audit agents; launch path, sidebar/projects, Rust git/scm/github, onboarding/tasks/board/inbox/floor/tower).
- Filed bugs: c3-terminal `20261112-1600-agent-shell-wrap-hook.md` (hook point + logical program + spawn-error logging),
  c3-terminal and o1-tools `20261112-1601-keep-browser-tower-rs.md`, o1-tools `20261112-1602-browser-pane-callers-in-c2.md`.
- Side effect to know: an auditor ran `grok -- version`, which opened a real Grok session and sent "version" as a prompt;
  it was killed by timeout and showed "You hit your weekly limit". No other live agent use.

## Next round (top 3)
1. Bug 1: log start failures (agents.rs:779) and the skipped pre-trust reason + pane notice (~2 h, may fix the symptom);
   move Claude's inline `--agents` JSON to a file; add src-tauri/src/agent_shell.rs + per-agent/per-OS tests;
   wire once c3-terminal lands the terminal.rs:1133 hook. Proof: harness screenshots of 5 agents at their prompt.
2. Bug 2: sidebar folders only (ProjectsPanel.tsx:2266 + launchActions.ts:120/433), keep green "synced" on the folder row. Proof: screenshot of 6 sessions, one folder row.
3. Bug 3: sheetStart (seats.ts:355) leaves folder mode unset unless the user picked it (~45 min, tests).
Then P2 quick wins: scm.rs spawn_blocking x3 (20 min), upgrade.rs panic guard, Grok --reasoning-effort.

## For the coordinator
- No CHANGELOG lines this round (audit only).
- Decision wanted: shell-wrap on Windows uses Windows PowerShell 5.1 when pwsh is absent and loads the user's profile
  (matches "as if typed"); falls back to direct start if ExecutionPolicy is Restricted/AllSigned. OK?
- Cross-lane: c3-terminal must land the terminal.rs:1133 / pty_service.rs:240 hook and the logical-program change for bug 1.
- Not owned by c2, needs an owner: src/keys/useWindowKeys.ts and src/status/useStatusSurfaces.ts browser-pane references (filed to o1-tools).
- If bug 3 needs src/terminal/paneActions.ts:93 changed after all, c2 will file it; plan is to fix inside src/launch/seats.ts only.
