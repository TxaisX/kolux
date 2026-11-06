# STATE
Status: RUNNING            (RUNNING | PAUSED | BLOCKED: reason)
Phase: 3                   (Phase 1 was done by the dirty-room team on 2026-10-06; Phase 2, the plan, on 2026-10-07)
Budget: 6 passes per day   (today: 4, date: 2026-11-04)
Next task: T-775 · the wave 201 live proof, remaining legs: Source Control from the app, real-key page chords, and the T-765 flood once it builds (the two P0 guards and the artifacts render/seek proof passed 2026-11-04)
Done: 852 / 914 tasks  ·  P0 cards passing: 206 / 228 cards  ·  cutline 0 / 18 left  ·  merge gate 1 waiting  (node scripts/plan-check.mjs --write-state)

How to read this: `PLAN.md` holds the 533 tasks in build order; each names the spec cards it must
make pass. Progress is counted in tasks ticked there and in P0 cards whose acceptance boxes all pass.
`node scripts/plan-check.mjs` proves the plan still covers every card exactly once.

What works today (2026-11-04, after trains 26, 27 and 28 and the wave 201 fixes): 851 of 914 tasks
are ticked and 206 of 228 P0 cards pass. Everything below still holds, and these landed since it was
written. **Data safety:** Delete, Remove from Kolux, Sleep, multi-select Remove, Cleanup and Quit all
ask about unsaved editor text first, name every dirty file, and Keep leaves every tab, folder and
draft as it was. **Artifacts** now carries only what it promises: a workspace's `artifacts/` folder is
scanned every 3 seconds and pages, pictures and videos appear in the viewer from the app's own
scheme, a picture renders at its real size, a video reports its duration and seeks; an unreadable
index is reported instead of being replaced by an empty one. **Light mode** stopped leaking: sidebar
rows, hover, inputs, tabs, syntax colours and diff marks come from the theme's own palette and clear
4.5:1, and the keyboard focus ring is one token everywhere. **Settings and accounts:** a damaged
settings file says so and offers a repair, the setup policy is one value the runner and the row share,
an unpicked Claude start takes the Settings model, a switch written `=false` is off, Remove deletes
only the sign-in, a Codex account whose file is gone reads needs sign-in, Connect an AI reaches a real
sign-in, and Opens first accepts only real screens. **Panes and history:** a restored tab that cannot
reattach keeps its tab with a reason and Try again, and History refuses to delete a session a pane is
writing. **Safety and agents:** per-project Safety rules apply to the folders agents really run in, a
hung automation run ends as stopped and can be cancelled, and Skills update works again. **First run
and chrome:** the checklist dismisses, the Setup Guide closes on Escape, the Classic Board has a way
back, an agent-reply file link opens where you can see it, sidebar page rows go to their page, Alt+1-9
picks the tab it names, close-left/right close the named side, Send feedback can be cancelled, and
multi-select Remove says what it deletes. Proven live this week: the P0 guards (screenshots in
`evidence/live-p0/`) and the artifacts picture/video render and seek.

What works today (2026-10-11; the paragraphs below this one are the task-by-task record): a
Windows desktop app (Tauri 2, Rust + React) with its own 36 px top bar: the Kolux mark, a sidebar
toggle, the Agents / Board / Terminals switcher, a search box showing the palette chord, a bell
that opens the Inbox, a usage pill with live Claude and Codex figures (it opens Settings > AI
connections), and the window controls. Terminals is a grid of 1 to 12 panes per workspace (the
Layout 1 / 2 / 4 / 6 strip, split right / down, close, tabs per cell, browser tabs beside the
terminals), each pane a PowerShell, Claude Code, Codex or other installed agent through a Rust
PTY and xterm.js (WebGL when the GPU allows). Board shows the same panes as cards in lanes (Needs
you, Working, Done, Stopped, Idle) with a chip saying what each agent is doing, Approve / Deny on
a card that waits for permission, and the live terminal inside an expanded card. Agents lists
the sessions under each saved agent (unmatched ones under Other sessions) with a status word and
a context ring on each row and the picked session's 5-hour figure in a footer, shows the picked
one's terminal or chooser, and adds a not-started preset with + (its chat body waits for T-050-b). The
Inbox lists what needs you, what is running and what finished
today. Agents report their own state through hooks Kolux installs for Claude Code and Codex
(permission, question, working, done, blocked, interrupted; subagents under their lead), with
one status vocabulary for every dot, chip and label, desktop notifications on finish and
permission, a quiet-terminal alert, tab and workspace unread marks, and a pane header with the
agent mark, name, branch (a detached checkout shows its short commit; a plain folder no chip), program, status word and gauge. Its "..." button or a right-click opens the pane menu (expand, split right or down, close); expand or Ctrl+Shift+Enter makes the pane fill the workspace and the same again restores every pane, terminals and their scrollback untouched. Dragging the line between two panes resizes them live (the 6 px divider of DT-A7), a release outside the window ends the drag where it was, and a narrow pane drops its branch chip, program word, buttons and status word in that order while the dot, mark and name stay. A tab's right-click menu closes it, the others, those to its right or left, or all (Ctrl+Alt+W), middle-click closes a tab, and closing the active tab goes back to the tab used before it. The command line answers in tens of milliseconds over the loopback port and an ask or waiting check stays up for minutes; removing a worktree ends its shells and everything they started, proves them gone, and refuses (unless forced) when one stays. Claude Code in a pane is made to ask before a force-push to main, a hard reset or forced clean, a database drop or truncate, a Stripe change, an infrastructure apply or destroy and a production deploy, each rule switchable in settings.json (the Safety page follows). A recursive delete aimed outside the workspace asks too, and every protected rule sees through wrappers, chains, substitutions, nested shells and encoded PowerShell. Paths on other machines are refused as text before any disk call, and a file handed to the system is revealed in its folder instead of run when it is a program. Discarding work in Source Control asks first, worded for what goes, and never follows a link out of the repository. File access stays inside your projects: a path outside them, or leading out through a link, is refused before the disk is touched, and one file at a time can be allowed for the run. The local endpoints agents' tools use answer only Kolux's own tools: a web page, another host or a bare connection gets nothing. The app keeps a short, capped, user-only log of its own starts, exits and terminal sessions; Settings > General > Diagnostics copies it with secrets masked or writes a review copy to look at and throw away. Settings > General > Privacy says the work stays on the computer, lists every connection the app makes, and Send feedback opens a pre-filled GitHub issue page in the browser instead of sending anything. Quit and reopen: every workspace's tabs and layout come back, a damaged saved entry is dropped on its own and the rest kept, and the workspace and tab that were active are active again while they still exist. A Claude Code or Codex tab comes back on its own session (the agent's resume command with the id its hooks last reported), after a quit or a kill alike.

## Needs Txais

13 open decisions in `DECISIONS.md` section 2 are marked "confirm". The loop builds each one's
recorded default until told otherwise; nothing here blocks a pass.

- [coordinator] 2026-11-04 · **Wave 201 is closed.** Trains 26, 27 and 28 are on main (`5050c4e2`) and
  the artifacts work is PR #223; the P0 guards and the artifacts render/seek proof passed live. What is
  left of the wave: the rest of T-775 (Source Control from the app, real-key page chords, the T-765
  flood, which needs the bundle ceiling) and the P1s still open in `proof/wave-200/REGISTER.md`. Your
  calls: cut 0.1.8 from this main, and whether to install 0.1.7 then 0.1.8 for the update proof, which
  closes every open pane.

- [coordinator] 2026-11-02 · **Cycle 5 is merged.** One merger (fa) took, in order, #54 #53 #55 #56 #57 #58 #59 #61 #43 #38 (squash) #60 #62 #63 #64 #65 #66 #67 #68 #70 #71 #73 #72 #74 #75 #76 #69, each with main merged in first and Windows CI green on that exact commit. Conflicts in PLAN, DECISIONS and PROVENANCE kept both sides; DECISIONS rows DT-C60 onward are back in number order. #46 was closed in favour of #66.
- [coordinator] 2026-11-02 · **#37 parked, see PR comment 6571248516.** It was not merged in cycle 5 and comes back in cycle 6.
- [skills] 2026-11-02 · **The spec still says four bundled skills.** DT-C64 (#38) added a fifth, video (HyperFrames and Higgsfield), but spec/15 SKILL-029 (lines 557, 562 and 564: Rules, Compat) and SKILL-032 box 1 (line 792) still name only kolux-cli, orchestration, koluxsecurity and koluxward. The spec text needs bringing in line with DT-C64.
- [coordinator] 2026-10-31 · **Live proofs have started on the real PC.** `docs/live-proofs-results-2026-10-31.md`
  holds the first results: VIEW-002 box 1 passes (P0 208 → 209), T-608's consent line passes on a fresh profile,
  and APP-070 box 1 passes so far. The rest need the app closed in bursts; Txais asked to keep using it for now.
- [coordinator] 2026-10-31 · **The installed 0.1.2 predates cycle 2.** The PATH fix (PR #19), delete safety
  (PR #21) and the App split (PR #22) are on main but not in the build on this PC. The next release (0.1.3)
  carries them and is what A-1, D-1, D-2, D-3 and D-4 are then proven on.
- [coordinator] 2026-10-31 · **Three dead Path entries, Txais's call.** The saved user Path holds
  `...\Programs\kolux\resources\bin` and two `G:\Dev\kolux-workspaces\...\resources\bin` entries, all naming
  folders that no longer exist; they keep the Path at 1,815 characters, above the installer's 1,024 limit.
  Removing them is reclaim work, not a build change.
- [product-ux] 2026-10-31 · Open: DT-C58 (artifacts from the files an agent creates) is built and tested
  in the small tests only, not yet seen in the running app. Check: in a Claude Code pane whose folder is a
  project, have it write a PNG and a report; open Artifacts from the sidebar and confirm both appear under
  that folder's name, the PNG shows in the viewer, a PDF opens in its own app, and the same file written
  again refreshes its one entry instead of adding a second. Codex and other agents are not captured yet
  (only Claude Code's transcripts are read), which is the next slice if Txais wants it.
- [coordinator] 2026-10-31 · **Cycle 3 landed** (TERM-068 complete, the window split, first load 3.18 → 1.86 MB,
  T-603 mixed endings, deletes that start at a link ask, the changed-files count off the window thread). Main is
  pushed; `evidence/cycle3-merge.txt` has the record, the gate lines and the smoke result.
- [coordinator] 2026-10-31 · **SAFE-004 box 3 is deliberately open** (DT-C59): the 3-second fallback was built and
  reverted on your word; the safe default stands. Nothing else changed on that card.
- [coordinator] 2026-10-31 · **First load is 1.86 MB, under the 2 MB guard but not under the 1.5 MB bar.** The
  remaining cut (the editor store stops carrying CodeMirror, measured at 1,470,936 bytes) is being redone on the
  current main as lane3/first-load-3; the first attempt conflicted with T-603 and was backed out rather than
  landing a wrong editor.
- [coordinator] 2026-10-31 · **0.1.3 is being released from this main.** It carries the PATH fix (PR #19) and
  delete safety (PR #21), which is what A-1, D-1, D-2, D-3 and D-4 are then proven on.
- [product-ux] 2026-10-30 · Open: live Windows checks for T-608 to T-612 (steps in each evidence/T-6xx.txt):
  the consent line on a fresh profile and the one-time card on an old one; a hand-started Claude asking permission
  shows Needs you on the Board, Tower, Inbox, needs strip, bell and sidebar; Review changes from a Done card and an
  Inbox row; Show Floor, Space, Workspace Statuses, Artifacts and Skills from the palette; Rename worktree from the
  palette with the sidebar closed; Open a session with no workspace asks for a folder; Escape closes the Tip.
- [integrator] 2026-10-30 · Open: reclaim the old Kolux (about 408 GB), as in docs/reclaim-old-kolux.md (the old GitHub
  repos are already removed, Txais 2026-10-31). (1) Sign test account A in at its new folder
  G:\Temp\live-signin\account-a. (2) Uninstall the old app, then run
  scripts/reclaim-old-kolux.ps1 (look first, move anything that is not an old-repo copy out of the backups folder, then
  -Delete and type DELETE). Leave ~/.kolux/agent-hooks alone for now.
- [reliability] 2026-10-30 · Open: live Windows checks on the installed build. T-565 (round 1 review fixed): Escape
  in the Usage Share card or the Send feedback box closes only that box (SettingsPage.tsx:318-334, 7 tests in
  SettingsPage.escape.test.ts); check Ctrl+, from a terminal then Escape, and Escape in Share and Send feedback.
  T-597 (round 1 review fixed): while a slow start waits, App hands out pane keys from 1_000_000 (applied from
  evidence/reliability-App.patch), so a wait tab never takes over a saved tab's running terminal;
  main.slowStart.test.ts tests 4 and 5 pass with it; check a start whose settings read takes over 1.5 s.
- [reliability] 2026-10-30 · Open (T-597 follow-up, from the PR #8 review): if two slow starts happen in a row within one
  run of the terminal service, a wait tab could reuse key 1000000 and attach to the previous run's leftover terminal. Fix
  later: kill the terminals of unsaved wait tabs at quit.
- [reliability] 2026-10-30 · Known flake: src/settings/__cards__/SET-006-link.test.ts "terminal-first" fails on the
  untouched base 025eda2 on the shared Linux machine (its until() waits about 400 ms for the Shortcuts page to load).
- [reliability] 2026-11-03 · Flake fixed (T-700 K1): notebook_run a_cell_that_sleeps_past_the_ceiling_is_killed lost
  "before" when a loaded runner took over 10 s to start Python (6 sightings); it now retries with a longer ceiling.
- [reliability] 2026-11-03 · Flake fixed (T-700 K2): git an_unattended_git_fails_fast_on_a_remote_that_wants_a_password
  ran past its 30 s bar on a loaded runner while failing correctly; it now fails only on a real wait (90 s).
- [reliability] 2026-11-03 · Flake fixed (T-700 K3): agent_hooks script_runs fix_2 tests: the script always runs with
  CLAUDE_CONFIG_DIR cleared (another test could set it mid-start), and the unset-config test retries a slow post.
- [reliability] 2026-11-03 · Trap fixed (T-700 K4): public/pdfjs/** -text, so pdfjsCopy.test.ts passes on an autocrlf
  checkout (an existing worktree must delete and re-check-out the three files once).
- [reliability] 2026-10-30 · Follow-ups not built (need new Rust): (1) T-599: a crash_note(summary) command in
  src-tauri/src/resources/recovery.rs that calls note_crash, registered in lib.rs and called from a componentDidCatch
  in src/recovery/ScreenBoundary.tsx with crashText(error), so Help > Report Crash can show a crash nobody reported
  before the reload. (2) T-598 audit: agent_creds.rs, projects.rs set_place, claude_key.rs and the `kolux agent hooks`
  CLI should send the settings-saved broadcast after they write settings.
- [editor] 2026-10-30 · Open: files with mixed CRLF/LF line endings. Today, when such a file first
  opens, its LF lines show joined to the next line. Pick one: (a) show every line separately and save
  the file exactly as it was; (b) show every line separately and convert the whole file to one line
  ending on the next save. Nothing changes until you pick (T-603).
- [updates] 2026-10-30 · The feed is now the public TxaisX/kolux itself (DT-R40); the signing key is at
  ~/.kolux-rs/release-signing/kolux-rs.key (no password) and releases ship from the owner's PC
  (`node scripts/release.mjs`). GitHub CI is not used (DT-C54), so no billing change, releases repo or
  release secrets are needed (T-622).
- [release-ci] 2026-10-30 · Open: live proofs. APP-025 box 2 (a downloaded update installs on a plain quit) and APP-043 (T-592)
  are on docs/live-proofs-windows.md. APP-059 box 1 and APP-060 box 1 (a release run on GitHub's runners) are not
  applicable (DT-C54).
- [release-ci] 2026-10-30 · Follow-ups from the PR #9 review, not built: scripts/license-check.mjs: anchor the MIT
  and BSD-2 patterns on the full licence text. (The CI-only items were dropped with DT-C54.)
- [status-hooks] 2026-10-30 · Question (T-585): a helper agent whose stop is lost without an Esc, or a background helper
  that stays silent from an Esc until the next prompt, can still keep a pane "working". Clearing those needs a signal Kolux
  does not have yet (for example Claude's Stop event listing which helpers are still alive, which is not confirmed). Should
  Kolux add a time-out guess, or leave it? Nothing changes until you say.
- [status-hooks] 2026-10-30 · Open: live Windows checks. T-566: a relaunch run where every taken-back pane shows its restored
  chip (needs the prover fix below first). T-583: an "agent finished" automation with a slow precheck while other panes'
  status keeps moving and a protected command in another Claude pane still asks. T-584: switch hooks on with a real
  settings.json holding "Stop": []. T-585: Esc a running sub-agent, send a new prompt, the pane ends Done. T-586: Ctrl+click
  a link after Chinese text and emoji. T-618: a new tab that reuses a closed tab's number after a restart shows no status.
- [status-hooks] 2026-10-30 · Follow-ups not built: (1) T-566: scripts/prove/live-T-544.mjs back() must read the restored
  chips before dismissFirstRun or any other key or click reaches the window, and match panes by their data-key attribute
  instead of their order (the lane gave it only as a description, not an exact edit, so it was not applied at integration).
  (2) product-ux lane (T-612): a Tip card that closes on Escape must take the key on a window keydown listener in the
  capture phase and stop it; otherwise the Escape reaches the focused terminal pane, clears its restored chip and sends ESC
  to the program. (3) Optional, T-618: drop a closed tab's saved status row at the moment it closes (App.tsx dropPanes
  already calls terminal_forget_history; a matching agent_hooks::saved forget needs one more command or a line in
  terminal.rs). (4) Optional, T-583: make protected::mask in protected.rs cheaper on very large commands, so one huge
  protected command's own reply stays under 1.5 s (it no longer holds up other panes). Done by lane/safety T-604: masking reads
  only the shown 2,000 characters and a 2,048-character margin (mask_head); a 1 MB command is answered in at most
  523 ms optimized (evidence/T-604.txt).
- [status-hooks] 2026-10-30 · Follow-ups from the PR #13 review, not built: (1) refresh the hook line's settings snapshot on
  every settings save (state.rs), so a protected rule changed while slow work holds the store applies at once, not from the
  first hook after the store frees. (2) Keep each pane's order for near-simultaneous events: two hooks of one pane that
  arrive together are stepped in the order their threads take the ORDER lock, not always the order they were sent.
  (3) automations.rs still starts a bare thread per job with no cap; give it a cap and a Builder spawn as the hook line has.
  (4) Found while fixing the review: protected_custom.rs Attempts::paused masks the whole command under the app-wide
  attempts lock (STORE), so while one huge protected command is masked, every other pane's protected command (and any
  prompt, which also takes that lock) waits for it: about 2 s in the hook tests. Mask before taking the lock. Not this
  lane's file, so not changed here; T-583's "holds up no other pane" is true only until that mask starts. DONE 2026-10-30
  (lane/safety, PR #15 review): the command is masked before the lock is taken and the list is copied under it and
  masked after; the 1 MB pane now holds the lock about 8 µs (was 8 ms with the lane's 4 KB mask cap), test
  protected_custom t604r5_a_second_panes_check_is_answered_while_a_1_mb_command_is_masked; evidence/T-604.txt.
- [accounts] 2026-10-09 · Resolved: the T-043-a live check made a real 1-year Claude Code key on
  Txais's account (stored sealed, removed with Disconnect two minutes later, never read or printed).
  Txais said the same evening that this was intended, not accidental; the key stays and no builder
  should ask for it to be revoked. Live checks still use stand-in programs and fake keys.

- [accounts] 2026-10-11 · Token analytics (T-136-b's USAGE-012 / 013, T-137) read the Claude Code
  and Codex logs on this PC. Claude Code's public docs say its transcript format "is internal
  ... and changes between versions", and Codex documents none, so a clean-room build has nothing
  public to parse against. Options: (a) let a builder read the shape (field names only, never the
  text) of a few of your own `~.claudeprojects` and `~.codexsessions` files; (b) count
  tokens only from what Kolux sees live; (c) leave token analytics out. Until you pick, T-136-b
  and T-137 stay unbuilt. USAGE-011's activity counts also wait for the status hooks (T-025).
  RESOLVED 2026-10-12: Txais chose (a). A builder may read the FIELD NAMES and value types (never the
  message text, prompts or paths) of a few of his own ~/.claude/projects/*.jsonl and ~/.codex/sessions files,
  record the observed shape with a date in PROVENANCE.md section 5, and parse defensively (unknown fields
  ignored, format changes degrade to "unknown", never crash). T-136-b, T-137 and T-140 are unblocked.

- [accounts] 2026-10-13 · Interface languages (T-210-b, SET-017's rest): the language choice and its
  dates, weekday names and sort order are built (T-210-a), but every menu and screen is still English.
  DT-A5 ties translation to language packs, and SKILL-040 cut those with the plugin runtime. Bundled
  packs would mean pulling every screen's text into lookup tables and writing five translations
  (Simplified Chinese, Korean, Japanese, Spanish, French) with nobody to check them. Pick one:
  (a) build bundled packs, machine-translated and marked as such; (b) build only the lookup and the
  English fallback now, packs later; (c) cut the rest of SET-017 and show the choice as dates-only.
  Until you pick, T-210-b stays unbuilt.
  Answered 2026-10-13 (relayed): (b). T-210-b is unblocked; DECISIONS.md DT-C30.

| ID | The call, in one line | Default the loop builds |
|---|---|---|
| OD-01 | Does Kolux call the AI provider's sign-in and usage services itself? | No: browser sign-in only, Claude renewal switched off, usage read from running sessions |
| OD-06 | Fork pull requests: keep the push and pull fallback a fork workspace needs? | Keep it; only the per-repository fork sync setting is cut |
| OD-08 | Mobile page | Cut (went with area 18) |
| OD-09 | One control tower overview of every agent | Skip for parity; Agents screen is the overview; Phase 4 candidate |
| OD-10 | Changed-files list: Mod-click and Shift-click select rows, or open in a split? | Selection wins; Alt-click and the row menu open in a split |
| OD-11 | Quick account switcher | Skip; accounts are added and listed without one |
| OD-12 | WSL | Nothing runs inside a distribution; WSL-stored projects open as local folders |
| OD-14 | Shared folders and archive script in a repository's kolux.yaml | Keep both entries; only the per-repository settings controls are cut |
| OD-15 | GitHub Projects roadmap timeline (half-done) | Show the unsupported notice |
| OD-16 | GitHub star prompt | Off until Kolux has a public repository of Txais's |
| OD-18 | Browser knobs after the browser settings page cut | Fixed defaults with toolbar-menu controls |
| OD-20 | Does the old app's update feed hand users over to Kolux? | No; own feed, manual first install, importer on first launch |
| OD-21 | Bundle the 24 department agents as default suggestions? | Not bundled; suggestions load from a folder the user points Kolux at |
| LOOK-1 | Bundle the UI and terminal fonts (Inter, JetBrains Mono / Cascadia Mono)? Their licence (SIL OFL 1.1) is not on the LOOP.md licence list | Not bundled; system font stacks only (Segoe UI, Cascadia Mono / Consolas), so the look depends on the fonts installed on the PC |
| LOOK-2 | Vendor marks: keep Anthropic's Claude Spark (from its public press kit, no terms shipped) as a model indicator in a public release? And may someone fetch OpenAI's kit file by hand (openai.com/brand refuses every automated fetch)? | Spark kept, as nominative use; the hand-redrawn OpenAI knot was removed the same day (not a kit file, so outside the "public brand kits only" rule) and Codex shows Kolux's neutral spark glyph until a kit file arrives; see src/assets/vendors/NOTICE.md |

## Decisions made for Txais

- 2026-11-05 · [projects] One folder row per project · DT-C213: the project row is the folder row and clicking it shows every pane opened in that folder in one grid; the heading reads Folders, and old worktree rows stay in the DOM but do not draw. The newcomer checklist leaves the sidebar the moment its last item is done.
- 2026-11-05 · [release] Public rename to Kolux · DT-C212: the window, About panel, copy, README, user and developer docs, `package.json` and the GitHub repository (`TxaisX/kolux`) now say Kolux. The installer product name, install folder, app identifier, profile folder, `~/.kolux-rs` hook folder, executable names and crate names stay for one release, because `~/.kolux` still holds the old app's hook files; the next identity release moves those with a tested migration.
- 2026-11-05 · [performance] First load made room for T-765 · the status bar, Help and recovery now call the update event bus directly instead of importing the update screen's door, and the Tower window's view/bridge split keeps its view out of the main window: 1,488,267 → 1,483,608 bytes against the 1,490,000 ceiling. T-765's frame queue now fits, with 6,392 bytes of headroom.
- 2026-11-01 · [skills] T-180-b · DT-C66: deleting a skill inside a WSL distribution runs inside that distribution. Txais confirmed it on 2026-11-01. Reversed 2026-11-02 by DT-C94 (T-658: listed, not deletable).
- 2026-11-02 · [editor] T-062-b · DT-C70: a worktree inside a WSL distribution is read every 4 s, never watched.
- 2026-11-02 · [editor] T-235-b · DT-C71: JPX (JPEG 2000) images in PDFs are decoded (Txais, 2026-11-01: allow JPX).
- 2026-11-02 · [help] T-248-c-rest · DT-C80: the Help menu's three web links.
- 2026-11-02 · [editor] T-316-b · DT-C81: a notebook cell runs in a fresh Python each time; there is no kernel.
- 2026-11-01 · [cli] CLI-011 · DT-C69: `kolux open` grants the running copy the foreground and reports whether its window came forward.
- 2026-11-01 · [view] T-610 · DT-C68: View > Workspace View lists the switcher's four and Floor.
- 2026-11-01 · [view] VIEW-078 · DT-C67: a Stop in the Ports popover ends only the program the row showed (replacing PR #42).
- 2026-10-30 · [safety] T-606 · AI writer agents (the commit-message button, the one-click flow, agent recipes, PR text, branch naming) run from an empty temp folder with Claude limited to user settings (`--setting-sources user`) and no project MCP (`--strict-mcp-config`). Custom commands and recipe templates still run in the workspace.
- 2026-10-30 · [status-hooks] T-583 · The order of a pane's status events is kept by one app-wide lock held only around the status step, the emit and the after-queue; a protected-command reply is worked out per connection, outside that lock, so one slow hook never holds up another pane.
- 2026-10-30 · [release-ci] T-588 · CI release signing acts only on the build this run's `--build-only` recorded, never on the newest output folder; a run on an already-released main ends with "nothing was built, nothing to sign".
- 2026-10-30 · [cli] T-596 · `--wait-submit` is capped at 300 s, the same cap as `kolux wait --timeout`; both the command line and the app refuse values outside 1 to 300.
- 2026-10-30 · [cli] T-594 · The installer adds <install>\bin to the user PATH on every install or update when it is missing. A user PATH longer than 1023 characters (Txais's is 1,815; the first live check failed, 2026-10-31) is left to the app: the installer writes kolux-path-pending.txt and Kolux adds the bin folder once at its next start (%VARIABLES% kept, REG_EXPAND_SZ); uninstall runs the app's own --uninstall-path, after the app-running check, to remove exactly our entry at any length (cycle 2, DT-C55). Open question for Txais, not blocking: should removing kolux in Settings > CLI stick across updates? Today the next update adds it back.
- 2026-10-30 · [editor] T-601 · A click on a collapsible section's heading (<summary>) keeps its normal action, so the section still opens. Mermaid's protected settings also cover fontFamily, altFontFamily and htmlLabels, so a diagram cannot change them. A note's inline style attributes are dropped.
- 2026-10-30 · [editor] T-602 · A note whose table has a row holding more cells than its header opens in source view, with the banner saying why.
- 2026-10-30 · [editor] T-603 · A reload switches a tab's line ending only when the new text uses one line ending throughout; text that mixes them keeps the tab's own. A second tab of an open file takes the first tab's line ending.
- 2026-10-30 · [editor] T-317 · A followed log waits while another tab of the same file has unsaved edits.
- 2026-10-12 · [release] T-105 · kolux-dev terminal list, show, create, split, rename, switch (focus) and close now work against the open window; new terminals stay in the background unless asked, close confirms each program stopped and leaves the caller's own terminal open, and terminal stop is a hidden alias (DT-R37).
- 2026-10-12 · [release] T-104-a · A pane with no program starts the best shell that will run (PowerShell 7, Windows PowerShell, then the command prompt in UTF-8), the header names the one that started, panes no longer inherit Kolux's own build variables, and a folder that is gone, unplugged or a drive root (for agents) gets a message (DT-R36).
- 2026-10-12 · [release] T-103-a · Terminals you are not looking at stay alive rather than being parked to save memory, so they come back exactly as left (DT-R35).
- 2026-10-12 · [release] T-101-a · New workspaces can start with several empty panes (never in the classic look or on reopen); a started session fills an empty pane first; Ctrl+] and Ctrl+[ move the keyboard between panes, wrapping (DT-R34).
- 2026-10-12 · [release] T-100-a · Effort and fast mode only on Claude models; Claude Code with nothing picked starts on Opus at high effort unless its own arguments name a model or effort; the last lineup is kept per project once an agent really starts (DT-R33).
- 2026-10-12 · [release] T-098 · Keyboard moves follow the sidebar as shown; history keeps 50 places; the palette's Create workspace row opens the name field prefilled instead of creating at once (DT-R32).
- 2026-10-12 · [release] T-205 · Earlier kit results are copied, not moved, into a dated folder; the run record is hidden in kit-results; waiting roles are checked every ten seconds (DT-R31).
- 2026-10-12 · [release] T-204 · Kit roles fall back round the connected AIs, results go to kit-results, samples live in kolux-rs\samples under their own Git name (DT-R30).
- 2026-10-12 · [release] T-203 · Secret-looking files are left out of a first commit by name, not content, and the user's own Git identity signs it (DT-R29).
- 2026-10-12 · [release] T-202 · Disconnect deletes only what Kolux made and always asks first; for a login the user made it only explains how to sign out in that tool, and removing the active Codex account leaves none active (DT-R28).
- 2026-10-12 · [release] T-185-a · The installed CLI is a kolux.exe plus kolux.cmd shim in the install's bin folder, built only by the release script; only a refused connection means the app is down, lost answers print an exact --retry-request command, and reset takes exactly one scope (DT-R27).
## Follow-ups (not built yet)

- 2026-11-05 · [release] Identity migration (DT-C212): move the installer product name and install folder to Kolux, then the app identifier, profile folder, `~/.kolux-rs` hook folder, executable names and crate names, with a tested upgrade that removes the old `Kolux RS` install and PATH entry and keeps every profile. Do not touch `~/.kolux/agent-hooks` until the old app's hooks are confirmed gone.
- 2026-10-30 · [product-ux] T-608 / T-612 · Docs not updated (not this lane's files): docs/guide/settings.md
  (lines 181, 187, 193), docs/guide/getting-started.md (12-14, 39) and docs/guide/board-agents-inbox.md (118)
  should describe the consent line, "Open a session" asking for a folder when there is no workspace, and a blocked
  pane reading Stopped rather than Needs you.
- 2026-10-30 · [workspaces] T-613 · Optional, Space lane: the Space batch delete names the branches it kept only in
  its summary note (src/space/view.ts:58-61); add them (batch.items[].kept) to the kept-branch list as the Projects
  panel does.

- 2026-10-30 · [safety] T-606 · Review of PR #15: the Cursor writer now gets --trust (it runs in the empty temp folder,
  so it trusts nothing of the workspace); confirm that is wanted when Cursor's writer is checked live.
- 2026-10-30 · [safety] T-606 · Review of PR #15: a writer installed as a non-npm .cmd/.bat script refuses a multi-line
  prompt with a plain message (cmd.exe cannot take a line break); a typed or file hand-over would lift that.



- 2026-10-30 · [safety] T-604 · Review of PR #15 (round 8): a user whose own environment sets CDPATH is asked about
  every relative `cd ... && rm -rf ...` (an extra question, not a hole).

- 2026-10-31 · [product-ux-2] T-609 · The sidebar's changed-files count reads scm_status (git status with untracked files)
  as foreground work, now on by default for every workspace (src/look/cardChanges.ts:344, ponytail); give it a
  count-only background command or a longer cache.
- 2026-10-31 · [product-ux-2] T-608b · Docs: docs/guide/board-agents-inbox.md still describes three Inbox groups; add
  Stopped.

- 2026-10-31 · [data-loss] T-604b · Review, not fixed: a symlink start point inside the workspace is judged by its
  text, so `find link/ -name '*.pyc' -delete` (and `rm -rf link/`) can delete outside it; resolve start points that
  are links. A `-delete` after an escaped `\(` group is not seen (protected.rs:191). `rm`, `del` and `rd` used as
  PowerShell aliases still follow the bash and cmd wildcard rules.
- 2026-10-31 · [data-loss] T-613b · Review: a commit held only by a tag still keeps its branch (safe, some noise).

- 2026-10-31 · [engineering] App split · Review: src/App.tsx is 221 lines, but shell/WindowView.tsx is one 1,077-line
  function unpacking about 330 names from one bag, and shell/windowStore.ts is a run of useState calls, not a store.
  Split WindowView into per-surface components with narrow props or context, behind a reducer or store they subscribe
  to. src/shell/windowSource.ts:4 lists the window's files by hand for seven source tests; guard it (assert it covers
  App.tsx's local imports).
- 2026-10-31 · [engineering] First load · 3.366 MB raw / 1.028 MB gzip against the 1.5 MB bar (evidence/T-ENG-first-load.txt):
  main.tsx needs the App chunk (2,359 kB) for the first frame. Load CodeMirror, Lexical, highlight.js and the browser
  and PDF panes on first use.
- 2026-10-31 · [engineering] Test time · `pnpm test` from a clean shell: 1 min 52 s, 5,131 passed, 3 failed (SET-006-link and
  the two richCodeColourTime timing tests, failing on main too), so it is not green yet (evidence/T-ENG-test-time.txt).

## Last 10 passes  (date · task · result · evidence)
- 2026-11-06 · [release] 0.1.8 · published from 304b75d: public Kolux name and repo, first-load 1,484,283 bytes with T-765's frame queue, one folder row per project and the checklist leaving when done. Installer `Kolux RS_0.1.8_x64-setup.exe`, signed, `latest.json` live at TxaisX/kolux. CI green on the exact commit; the release checkout's junction path needed `KOLUX_RELEASE_CHECKOUT` resolved to the real folder, now fixed in release.mjs.
- 2026-11-05 · [projects] folder row + checklist · DT-C213: the project row is the folder row (state dot, branch, running count, click opens its grid), the heading reads Folders, old worktree rows stay in the DOM but do not draw, and First steps leaves the sidebar when its item is done; 6,428 front-end tests pass, first load 1,484,283 bytes
- 2026-11-05 · [performance] T-765 code · merged `s-72/flood`: terminal output draws once a frame through one window-wide queue, ports skip chunks with no address and use the pane decoder; the Tower view left the first load. First load 1,483,608 bytes (6,392 under the 1,490,000 ceiling), 6,427 tests pass; the live flood proof is still pending
- 2026-11-05 · [release] public rename · window, About, copy, README, docs, package name and GitHub repository say Kolux; installer and runtime identity stay for the next identity release (DT-C212) · branch `opt/first-load-headroom` also lands the 2.4 KB first-load cut that unblocks T-765
- 2026-11-04 · [wave-201] train 28 · merged #224: eleven P1 fixes (settings truth, accounts, panes and history, tabs, light mode, Source Control, Skills) · CI green, evidence in the PR
- 2026-11-04 · [wave-201] artifacts · merged #223: a workspace's pictures and videos are imported and shown from the app's own scheme; an unreadable index is reported · CI green; live proof 12/12 with `scripts/prove/live-artifacts.mjs`
- 2026-11-04 · [wave-201] T-768/T-769 · merged #219: Delete, Remove, Sleep, multi-select Remove and Cleanup ask about unsaved editor text, Quit and Force Reload ask about a floating note, and Keep keeps every tab and draft · CI green, evidence in the PR
- 2026-11-04 · [wave-201] T-761/T-762/T-763 · merged #218: the shortcuts file follows `KOLUX_KEYBINDINGS_HOME`, one focus-ring token everywhere, and one IPC guard for every live prove harness · CI green, evidence in the PR
- 2026-11-02 · [cycle5] T-235-b · merged #69: CI check details tab (steps, annotations, Fix with AI); check tab code loads on demand to stay under the bundle budget · Windows CI green, evidence in the PR
- 2026-11-02 · [cycle5] T-316-b · merged #76: notebook cells run Python after you trust the notebook · Windows CI green, evidence in the PR
- 2026-11-02 · [cycle5] T-547 · merged #75: Check now asks Kimi and MiniMax for the balance on a key you added · Windows CI green, evidence in the PR
- 2026-11-02 · [cycle5] T-248-c-rest · merged #74: Help menu: Settings, docs links, diagnostics copy and Restart Kolux · Windows CI green, evidence in the PR
- 2026-11-02 · [cycle5] T-193-b · merged #72: Hermes and OpenClaw automations in the list · Windows CI green, evidence in the PR
- 2026-11-02 · [cycle5] artifact-ipc-isolation · merged #73: Artifacts viewer frame isolation, tested live · Windows CI green, evidence in the PR
