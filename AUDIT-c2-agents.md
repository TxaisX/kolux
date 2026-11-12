# AUDIT: lane c2-agents (round 1, 2026-11-12, base 2029d743)

Read-only audit by four parallel read-only agents (launch path, sidebar/projects, Rust git/scm/github,
onboarding/tasks/board/inbox/floor/tower). CONFIRMED = traced end to end or ran; PLAUSIBLE = read only.
Nothing was built or launched. Line numbers are at 2029d743.

## Top bug 1: Claude Code and Grok don't start from "Start new session"

Call chain (Windows):
1. src/launch/ChooserPane.tsx:673 onStart -> src/launch/launchActions.ts:78-232 startSeats
   (:159 pretrust -> trust_folders_cmd, failure swallowed to a toast; :174 invoke agent_start_line;
   :185 pane {program: line.program ?? a.program, args, env, typed}).
2. src/launch/seats.ts:198 seatArgs (--model, effortFlag, --settings {"fastMode":true}).
3. src-tauri/src/agents.rs:773 agent_start_line -> :817 launch_line -> installed_program (:832),
   via_cmd closure (find_program + pty::through_cmd), start_line_as (:687) -> line_for (:544) -> route (:406).
   add_team (:798-810): Claude only, not via_cmd: prepends `--agents <inline JSON>` and
   `--append-system-prompt <multi-line LEAD_NOTE>`, env CLAUDE_CODE_SUBAGENT_MODEL=sonnet.
4. src/terminal/TerminalPane.tsx:1111 terminal_spawn; :1118 opens the output gate unless printsMarks(program).
5. src-tauri/src/terminal.rs:2085 terminal_spawn -> Terminals::spawn :1110 -> **:1133 program_command(p, args, cwd)**
   (service path: pty_link.rs:330 -> pty_service.rs:229, fallback :240).
6. src-tauri/src/pty.rs:323 program_command -> full_path_program (:333) -> command_for (:356):
   npm .cmd shim -> npm_target (node + script); other .cmd -> cmd.exe /d /c; native .exe -> direct.

What resolves on this machine (where.exe, 2026-11-12):

| Agent | Resolves to | Kolux start path |
|---|---|---|
| claude | ~/.local/bin/claude.exe (native, Bun, v2.1.322) | direct exe + inline --agents JSON |
| grok | WinGet Links grok.exe symlink (v1.0.62) | direct exe + `-- <prompt>` |
| codex | npm shim (.cmd/.ps1) | node + script |
| opencode | npm shim (.cmd/.ps1) | node + script |

pwsh not installed; Windows PowerShell 5.1; ExecutionPolicy CurrentUser RemoteSigned.

Root causes:
- R1 CONFIRMED pattern: the failing agents are exactly the two native .exe starts; the working two are npm shims.
  Direct-exe spawn is not proven broken (kolux.log has many "terminal N started (claude)").
- R2 PLAUSIBLE (strongest, Claude): pane histories 127-129 (team worktrees, 2026-11-12 10:15) CONFIRMED stuck at
  Claude's "Quick safety check" with **"No, exit" preselected**; Enter quits Claude = "didn't start". No trust entries
  for those folders in the CLAUDE_CONFIG_DIR .claude.json. Pre-trust only covers Kolux-made worktrees whose HEAD is on
  an origin ref (trust.rs:334-340, projects.rs:329-354); skips are silent (launchActions.ts:369-384).
- R3 PLAUSIBLE (Grok): xAI account is at its weekly limit (CONFIRMED: "You hit your weekly limit"). kolux.log has no grok
  start line at all -> either a pre-spawn failure or never tried; unknowable because of R4.
- R4 CONFIRMED: agent_start_line / terminal_spawn errors return to the window and are never logged.
- R5 CONFIRMED by code: agents never start through the user's shell (Txais's requirement).

Fix design (round 2):
1. New owned module src-tauri/src/agent_shell.rs `via_shell(program, args, cwd, settings) -> Option<CommandBuilder>`:
   Windows `powershell.exe -NoLogo -EncodedCommand <b64 UTF-16LE of "Set-Location -LiteralPath '<cwd>'; & '<name>' 'a1' ...; exit $LASTEXITCODE">`
   (pwsh if present; single-quote args with '' doubling; escape `"` for 5.1 legacy passing; profile loaded, no -NoExit).
   Unix `$SHELL -l -i -c 'exec "$0" "$@"' <name> <args...>`. Returns None for shell panes. Fallback to direct start if
   execution policy is Restricted/AllSigned or the script would exceed ~30K chars.
2. add_team writes --agents JSON (and FAST_SETTINGS --settings) to a file and passes the path; opening prompt via the
   typed route when wrapped.
3. Hook at terminal.rs:1133 and pty_service.rs:240 (c3-terminal owns; bug filed).
4. Keep the logical program ("claude", not "powershell.exe") for Terminals::started (terminal.rs:2203) / Mark.program,
   else printsMarks("powershell") holds the gate and the pane stays blank.
5. Log first (F1) and add a trust notice (F2): cheap, may fix the reported symptom on its own.
Tests: argv per agent x (pwsh 7.4, PS 5.1, zsh, bash); quoting round-trip (' " $ ` ; newline, trailing \, non-ASCII);
add_team file path; typed prompt when wrapped; logical program kept; fallbacks; grok `--` with a `-`-leading prompt;
shell panes never wrapped. Cost: about 1-1.5 days (+1 h to log and diagnose first).

## Top bug 2: sidebar should show workspace folders only

Root cause CONFIRMED: own-folder mode is the default (src/projects/singleFolder.ts:8-16), so
ProjectsPanel.projectBlock takes the non-folder branch: src/projects/ProjectsPanel.tsx:2266
`folder = singleFolder() && main !== undefined` is false -> header has no click; the `sb-main` row (:2314-2325) opens
the grid; worktree rows render via row() (:1878-2229) under :2378-2408. Rows that still appear after DT-C274:
team worktrees once nothing is open in them (hiddenTeamFolders only hides while open); one-AI own-folder launches
(launchActions.ts:120 `team = makes && picked>=2`); sidebar quick launch (launchActions.ts:433-436, no view/record);
Pinned (:2687-2699) and non-project grouping (:2703-2720).
Green text = pushTag(main) "synced" (.hint.push.good, --done) on the sb-main row (:2319); the folder header variant
(:2287-2291) does not render it (PLAUSIBLE identification; confirm on screenshot).

Fix (builds on DT-C274): :2266 `folder = main !== undefined`; header renders worktreeLabel + pushTag(main);
sb-main and worktree wrapper always get `old-workspaces`; drop the header "+ New workspace" button and pass
projectMenu(true, ...) (else nameField opens invisibly); Pinned/grouped lists filter to isMain;
launchActions.ts:120 `team = makes` with view = project root; launch() own-folder branch records the team folder and
gives the pane view = project path. Tests: removeCommits.test.ts:159-164 (T-729), removePaths.test.ts own-folder
variant, VIEW-051 box 3, menu/singleFolder tests, startSeatsTeam 1-AI case, launch() own-folder case.
Cost: 2-3 h (half a day if openIn/startIn signature change spreads).

## Top bug 3: chooser stays on "Same folder for all" at 2+ seats

Root cause CONFIRMED: src/launch/seats.ts:355-359 sheetStart returns copies "shared" (defaultCopies(1) or last
1-AI lineup), and src/terminal/paneActions.ts:93 stores it explicitly on the sheet, so
SeatChooser.tsx:51 / launchActions.ts:116 `copies ?? defaultCopies(seats)` never falls through.
Fix inside my area: sheetStart leaves copies undefined unless the last lineup departed from the default
(= user picked); onCopies/onUseLineup/onPickSaved already set it explicitly. If paneActions.ts must change,
file to its owner. Also launchActions.ts:195 records `makes ? separate : shared` instead of the user's choice (F-S17).
Tests: sheetStart picked/unpicked; 1 seat -> raise to 2 = separate; explicit shared + raise = stays shared.
Cost: about 45 min.

## Findings (highest severity first)

| # | Sev | Status | Where | What is wrong | Fix | Cost |
|---|---|---|---|---|---|---|
| 1 | P1 | CONFIRMED | src-tauri/src/agents.rs:779-780, terminal.rs terminal_spawn | Pre-spawn start failures never logged; "Grok never started" undiagnosable | log::warn id, program, resolved path, error (terminal.rs part filed to c3) | 30 min |
| 2 | P1 | PLAUSIBLE | launchActions.ts:369-384, trust.rs:334-391 | Skipped pre-trust is silent; Claude then defaults to "No, exit" | log not_pre_trusted_why; pane notice "choose Yes"; find why team worktrees fail made_by_kolux/head_is_on_origin | 1-2 h |
| 3 | P1 | CONFIRMED | agents.rs:808-809 | Claude gets inline JSON + multi-line system prompt on argv (breaks under shell wrap, eats 32K limit) | write to file, pass path | 1-2 h |
| 4 | P1 | CONFIRMED | pty.rs:323 via terminal.rs:1133 | Agents not started through user's shell | agent_shell.rs (bug 1 design) | 1-1.5 d |
| 5 | P1 | CONFIRMED | launchActions.ts:433-436 | Sidebar quick launch (own folder) makes a worktree with no team record or view; separate grid | record team folder, view = project | 45 min |
| 6 | P1 | CONFIRMED | launchActions.ts:120 | One-AI own-folder launch is not a "team": own row, own grid | team = makes | 20 min |
| 7 | P1 | CONFIRMED | ProjectsPanel.tsx:2295-2299, 2405 | With rows hidden, "+ New workspace" opens nameField inside display:none (latent today in one-folder mode via keyboard) | drop button / move nameField out | 30 min |
| 8 | P2 | CONFIRMED | ProjectsPanel.tsx:2687-2720 | Pinned and non-project grouping show every worktree | filter to isMain | 20 min |
| 9 | P2 | CONFIRMED | ProjectsPanel.tsx:497-523, 573 | 5 s scan polls scm_pushed, PRs, card changes for hidden worktrees (~6 extra git reads/tick per 6-agent team) | poll mains only | 30 min |
| 10 | P2 | CONFIRMED | terminal.rs:2203, shellMarks.ts:153 | Gate keys on argv[0]; a shell-wrapped agent pane would stay blank | report logical program (c3 bug) | 1 h |
| 11 | P2 | PLAUSIBLE | seats.ts:151 | Grok effortFlag "--effort"; grok --help lists --reasoning-effort | switch after confirming | 15 min |
| 12 | P2 | CONFIRMED | agents.rs:834, :779, :862, pty.rs:334 | Up to 4 full PATH walks (2 registry reads + probes each) per agent pane | resolve once, cache search_dirs ~2 s | 2-3 h |
| 13 | P2 | CONFIRMED | src-tauri/src (none) | No test round-trips the Windows command line for direct-exe agents | cmdline() -> CommandLineToArgvW test | 1 h |
| 14 | P2 | PLAUSIBLE | agents.rs:262-264, 309-352 | Unix agent detection ignores login-shell PATH (fnm/mise/asdf missed when Finder-launched) | add login_env PATH | 1 h |
| 15 | P2 | CONFIRMED | src/launch/newTabEntryRun.ts:5,9,13 | URL row opens the embedded browser pane (being removed); consumed in src/keys/useWindowKeys.ts | open_url to system browser | 30-60 min |
| 16 | P2 | PLAUSIBLE | orchestration/upgrade.rs:114-127 | serde_json IndexMut panics on a non-object message in a corrupt mail store, at startup | skip non-objects | 20 min |
| 17 | P2 | CONFIRMED | scm.rs:824 scm_github_repo | git + file reads on the async worker (neighbours use spawn_blocking) | spawn_blocking | 5 min |
| 18 | P2 | CONFIRMED | scm.rs:2907-2925 scm_watch | ancestors + git rev-parse on async worker; blocks on network/WSL paths | spawn_blocking | 10 min |
| 19 | P2 | PLAUSIBLE | ProjectsPanel.tsx:1660 `same`, :524 `norm`, parentDrop.ts:13, model.ts:113, deleting.ts:67, scanView.ts:10 | Local path compares ignore `\` vs `/` (sameDir handles it) | use sameDir/pathKey | 1 h |
| 20 | P2 | CONFIRMED | ProjectsPanel.tsx:262-271, 490-495 | No panel-level test of DT-C274 hiding or the scan prune | VIEW-051 box + sweep test | 1 h |
| 21 | P3 | CONFIRMED | scm.rs:2823-2830 | scm_ignore_heavy fs work on async worker | spawn_blocking | 5 min |
| 22 | P3 | CONFIRMED | scm.rs:243, git.rs:1864 | Every status read spawns `git --version`; ~8 git procs per read | OnceLock version | 30 min |
| 23 | P3 | PLAUSIBLE | scm.rs:258-269 | Conflict files read whole, uncapped, every status | cap 1 MB | 15 min |
| 24 | P3 | CONFIRMED | scm.rs:95-99 | heavy_folders: up to 12 sequential git check-ignore | one --stdin call | 30 min |
| 25 | P3 | CONFIRMED | git.rs:1717, scm.rs:941-1088, scm_writers.rs:~330 | Three bounded-process runners | shared process_run.rs | 1 d |
| 26 | P3 | CONFIRMED | agents.rs:249-258, lifecycle.rs:735, pty.rs:146 | Registry Path read written three times | reuse stored_paths (lifecycle/pty not mine: c1 bug if wider) | 20 min |
| 27 | P3 | CONFIRMED | launch/agents.ts:57 vs launch/agentInstall.ts:17 | Two different FEATURED lists (OpenCode in one only) | one constant | 20 min |
| 28 | P3 | CONFIRMED | agentstart/rules.ts:73,76; launch/launchOrder.ts:94 | Dead: launchFailed, promptFailed, launchInOrder (tests only) | delete | 15 min |
| 29 | P3 | CONFIRMED | projects: baseHint.ts:21, details.ts:14, folderWorkspace.ts:53, headers.ts:26, renameOnWork.ts:41, filter.ts:13, rows.ts runningUnder | Dead exports (only declaration + test) | delete with tests | 30 min |
| 30 | P3 | CONFIRMED | ProjectsPanel.tsx:1886, look/cards.ts:62-67 | CardFacts.agents hard-coded 0; agent-count branch dead | drop field | 30 min |
| 31 | P3 | CONFIRMED | projects.rs:2571,3068,3074; session_list.rs:19; session_rows.rs:18 | Stale #[allow(dead_code)] (all registered); module-wide allows may hide dead fns | remove, fix cargo warnings | 30-60 min |
| 32 | P3 | CONFIRMED | src/onboarding (tour.ts, guide.ts, demos.ts, stopCards.ts + 7 tests) | Browser tour/step/demo/stop and notePage (called from BrowserPane) go stale when the pane is removed | remove browser stop + notePage after o1-tools deletes src/browser | 1-2 h |
| 33 | P3 | CONFIRMED | src/projects/space.ts:30,67 | Copy "a browser is open" in delete-skip reason | reword | 15 min |
| 34 | P3 | PLAUSIBLE | onboarding/Demo.tsx:18, tower/TowerWindow.tsx:22, floor/FloorView.tsx:32, onboarding/Guides.tsx:411,597 | Timers re-render while hidden / unchanged (150 ms, 1 s, 5 s poll, 1 s DOM poll) | pause on document.hidden, skip unchanged | 20-30 min each |
| 35 | P3 | PLAUSIBLE | agent_hooks/vendors.rs:802 | Command::new("powershell") PATH lookup, can be shadowed | System32 full path | 20 min |
| 36 | P3 | CONFIRMED | workspaces.ts:26 | Orphaned doc comment above nameOf (belongs to sameDir) | move | 2 min |
| 37 | P3 | CONFIRMED | scm_open.rs | No test module | add | 30 min |

## Files over ~800 lines (split plans for round 2+ refactor)

| File | Lines | Seam |
|---|---|---|
| src-tauri/src/projects.rs | 6921 | ~3600 are tests -> projects/tests.rs; icons.rs (3005-3302), naming.rs (1323-1506), rename.rs (1952-2296), remove.rs, records.rs (2822-3004), place.rs, origins.rs, start_git.rs |
| src-tauri/src/scm.rs | 5792 | tests 2975-5792 out; status, remote, gh (+shared runner), pr, message, tasks, history, commands |
| src-tauri/src/git.rs | 4507 | tests 2339-4507 out; guard (137-1128), runner (1284-1810), trash, diff, mod |
| src/projects/ProjectsPanel.tsx | 2871 | useWorktreeScan, usePrPoll, NameField/create flow, WorkspaceRow, ProjectBlock, ProjectSettingsForm, GroupForm (after bug 2) |
| src-tauri/src/agents.rs | 1785 | detection / start lines / prompt handoff / tests |
| src-tauri/src/scm_watch.rs | 1785 | not reviewed for seams |
| src-tauri/src/agent_install.rs | 1530 | same pattern as agents.rs |
| src-tauri/src/github.rs | 1356 | ~580 tests; no split needed |
| src-tauri/src/session_list.rs | 1034 | tests out; Claude vs Codex readers |

Clean results: every literal invoke() in onboarding/tasks/setup/board/inbox/floor/tower/carry/orchestration has a
Rust fn; all 55 scm/git/github tauri commands are registered and called; all git calls go through one builder with
timeouts; no hardcoded colors in the scanned TS dirs. Coverage gaps: src/sessions past notices.ts not scanned for dead
exports; scm_watch.rs not split-planned.

Note: src/tower's "browser arguments" (pageWindows, ownWindow) are WebView2 args built by
src-tauri/src/browser_tower.rs for the Tower window, not the browser pane. Deleting browser_*.rs wholesale would break
Tower (bug filed to c3-terminal and o1-tools).
