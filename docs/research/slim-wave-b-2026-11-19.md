# Slim-down wave B: the engine parts behind the old screens are out (2026-11-19)

Stage 2 of the rebuild plan (folders of chats). Wave A took the old screens out of Kolux. Wave B takes out the engine parts those screens used, plus the leftovers that still pointed at them: menus, tours, palette rows, settings, translations and the user guide. The app keeps building and its tests stay green.

This wave was built and checked in a Linux cloud session, not on the Windows PC. Every check that can run on Linux ran here (the Rust lint ran for the Windows target too). The live test on the second screen could not run; see Checks.

## What changed for the user

- The `kolux` command is gone, `kolux open` included. The installer no longer puts it on the PATH, and on install and uninstall it takes the old entry off and deletes the old `kolux.exe` and `kolux.cmd`. A PATH longer than the 1,023 characters the installer can edit keeps a harmless entry that points at an empty folder.
- Orchestration (workers, mail, worker tab labels), automations, protected-action rules, model routing and Kolux's own skill install, update and delete are gone. The Claude hook no longer asks before a risky command; Claude's own permission prompts work as before. The chat composer still lists your skills, just not Kolux's built-in guides.
- Status hooks are installed for Claude Code and Codex only. Other agents still launch; their status dot reads the terminal's title and screen. Hooks an earlier Kolux added to other agents' settings stay until you remove them; they do nothing now.
- No Install button or install checklist for agents in the launcher, onboarding or Settings > Agents. A missing agent shows its docs link. The WinGet install for Claude Code and Codex in Settings stays.
- Grok still launches as a terminal agent and uses Grok's own sign-in. Kolux no longer stores an xAI key or passes it to Grok panes.
- The Kimi and MiniMax "Check now" is gone, and so is the Settings > Agents "Agent Teams" card (it could never be offered without the command line).
- The OpenRouter key can now be saved. Before this it was refused, because its name was missing from the secrets list.
- A second launch now brings back a window hidden to the tray, also when the channel between the two copies is not available, and that window then minimises and maximises normally.
- The View menu's Workspace View lists Terminals only; Appearance loses the Tasks, Automations and Skills switches, the Agents and Board screen modes and the editor font; General loses the Editor and diffs card. Three shortcuts are unbound: Mod+Alt+V, Mod+Shift+F, Mod+Alt+W.
- Help > Tours lists only "Agents in parallel". The Setup Guide has four steps (notifications, default agent, multi-task, multiple repos), and the command-line startup tip is gone. Explore Kolux loses the Tasks, Orchestration, Editor and review-notes stops.
- Adding a project no longer offers to import another tool's setup file: nothing runs setup scripts now (that was already true after wave A).
- The sidebar's "Hide workspaces made by automations" switch and the Automation tag on cards are gone.
- A recovery reload no longer waits 1.5 seconds for an answer no page sends.
- The user guide describes only what is left: the Board/Agents/Inbox page and the command-line page are gone, and the feature index marks 136 rows "removed".

## Building blocks for the next stage

Kept on purpose, though no screen uses them yet: the chat engine, the History write-ups, new project with its GitHub badge, chat finish, the shared Claude setup for extra accounts, the Everyday fence, the OpenRouter route and past chats from other accounts. The pane prompt send (agent prompt send, review send) was moved out of the command line into its own small module, so it keeps working without it.

## Size

- 82 commits on top of main (77 changes and 5 merges of the parallel build lanes), squashed into one commit on main.
- 429 files changed: 3,868 lines added, 73,725 removed. 131 files deleted, 83 of them in the engine.
- Engine (src-tauri): 171 files, 2,491 lines added, 66,697 removed. The engine's registered commands went from 464 to 303.
- Engine files deleted include the command line (13,100 lines), orchestration, automations (6,400), protected actions and routing (5,700), the skills installer and skill delete (4,000), the other agents' hooks and installers (5,900), Grok's key engine, the provider and credential modules, the Recycle Bin file actions, artifacts, and the editor, notebook, PDF, HTML-preview and terminal-import engines.
- Dependencies: the Recycle Bin library (`trash`) left, taking the unmaintained chrono with it; `libc` left too. The chrono exception came out of the dependency check's list.
- Front end (src): 187 files, 702 lines added, 3,464 removed. The first load is 1,348,853 bytes (wave A: 1,365,238).

## Checks

| Check | Result |
|---|---|
| Invoke contract and the other front-end checks (`pnpm check`) | green: 472 invoke calls against 303 registered commands; plan, glossary, guide (10 pages), workflow and licence checks OK |
| Whole vitest suite | first run: 4,733 passed, 2 failed (stale tests, below). Final run on the last commit: 702 files, 4,733 passed, 0 failed, 1 skipped |
| Production build + bundle budget | first load 1,348,853 bytes in 42 chunks, under the 1,499,000 ceiling |
| Rust lint for the Windows target (clippy, warnings as errors) | clean |
| Rust lint on Linux | 68 errors, all Linux-only unused-code notes that main already has (71 on main); none new. GitHub lints on Windows |
| Full Rust test suite (Linux, scratch homes) | final run: 2,070 passed, 70 failed, 3 ignored (233 s). Every failure also fails on unchanged main on this Linux machine (main: 3,172 passed, 100 failed): they test Windows-only behaviour, and one log-rotation test is timing-sensitive. None new. GitHub runs the suite on Windows |
| Dependency check (cargo-deny 0.20.2, the version GitHub uses) | advisories, bans, licences and sources all OK |
| Spec firewall | 25 known hits in 13 files, 0 new |
| Live smoke on the second screen | not run: it needs the Windows app, WebView2 and a desktop, and this session had no Windows PC attached. Run `node scripts/evidence/smoke.mjs -- --offscreen` on the PC |

## Stale tests fixed (none were real bugs)

1. The notices test still expected the release step to add the command line to the installer's files.
2. The privacy hosts test expected more than 10 outside hosts in the code; 6 are left.

The build lanes also updated the tests that named removed commands, settings, steps and counts as they removed each part.

## Reviews

**First review** (independent, read-only, whole change; no P0 or P1):
- Fixed now: a window brought back from the tray by a second launch's fallback could disappear again at the next minimise or maximise, because the window library had not seen it come back. Kolux now shows it again through the library when it gains focus.
- Fixed now: the Settings > Agents hooks text promised to remove hooks from every agent and still named the Board; Explore Kolux still had a review-notes stop; COMPAT.md now states the long-PATH exception; the add-project setup import offer is gone.
- Moved to the next wave: a one-time clean-up of the hook entries an earlier Kolux wrote into other agents' settings, and the rest of the half-retired setup-script feature.

**Second review** of the fixes (no P0 or P1):
- Fixed now: the focus event the tray fix waited for comes from the web view, which may stay silent while it is told it is out of sight. A check in the app's existing two-second background loop now backs it up: a tray-hidden window that something outside put back on screen is shown again properly, but only after the loop has seen it hidden, so a hide still on its way is never undone. A unit test covers that rule.
- Fixed now: two engine commands for the setup import lost their last caller and went, with the file writer behind them.
- Noted: one fix commit on the branch carried three file deletions that belonged to the next commit, so it does not build on its own. The pull request is squashed, so main gets a single commit and nothing on main is affected.
- Moved to the next wave: the sidebar's setup suggestion card and Settings > Repo setup still describe setup scripts that no longer run.

**Third look** at the background check (no P0 or P1):
- Fixed now: the check showed the window but left the tray dot thinking it was hidden; it now clears the dot as any show does.
- Fixed now: the check could restore a window the user had just minimised and pull it in front. It now acts only on a window that is on screen and not minimised, and never restores or focuses it.
- Fixed now: the import dialog's leftover styles, its row in the Base UI migration list and an unused derive.
- Accepted: a window raised from outside within two to four seconds of being hidden is not caught by the background check, only by the focus event. Nothing is lost: the tray's Open Kolux brings it back fully.

## Left for the next wave

- Quit and relaunch (live smoke flow 5): still to re-check on the PC, as wave A asked. This session could only read the code: the startup file that a second launch reads is now written by the app itself (no command line), and the new tray fix only acts on focus.
- A one-time clean-up of the hook entries an earlier Kolux wrote into Gemini, Antigravity, Amp, Cursor, Droid, Kimi, Copilot, Devin, Pi, Hermes, Command Code and Grok settings. They do nothing now, but nothing removes them.
- The rest of the setup-script feature: the sidebar's setup suggestion card, Settings > Repo setup and their engine commands. Setup scripts no longer run, and no screen can grant script trust, so archive scripts run only for repositories trusted before.
- Unmounted front-end leftovers: the Agents rail (AgentsRail, rail.ts), scm/history.ts, and the layout report's unread fields.
- Stress scenario S10 still drives the removed Source Control panel; two live proofs (USAGE-007, STAT-053) stop with a message until their setup goes through the window.
- Spec cards still describing removed steps and stops (ONB-014, 018, 022, 023, 024, 033, 042) and the Tasks filter cards (GIT-054, 055).
- The architecture drawing and the infographic still show the command line and the preview server.

## Commits

- Five build lanes ran side by side in separate worktrees (front end and guide; agents and keys; command line and orchestration; engine removals; engine code of the wave A screens), then a cleanup pass for code that only became dead once all five were merged.
- One lane broke two working rules once each in its own worktree: it ran `git checkout HEAD -- <file>` and `git reset HEAD <file>`, both only on its own uncommitted edits. Nothing else was touched.
- The disk filled once during the cleanup pass; a half-written COMPAT.md was restored from the last commit and the edit redone.
- Guide markers: the three guide pages whose markers named a wave A branch commit lost in the squash merge point at a commit in the history again.

## GitHub checks after the merge

- Pull request 260: every required check passed on its last commit before the merge: the four test shards; types, licences, plan and workflows; and the Rust job on Windows (lint clean; 2,232 tests passed, 0 failed, 5 ignored across 18 test programs; the dependency check's four parts and the spec firewall green). The installer job is on demand and was skipped. It was squash-merged into main as bf88bbb3 only after that.
- Main on bf88bbb3: GitHub's checks on the merge commit were still running when this was written; the result follows here once they finish.
- Follow-up pull request: the squash left the guide pages' markers on a branch commit main does not have, so the local guide check failed on main (as it had since wave A for three pages). The markers now point at bf88bbb3. The same pull request adds `pnpm release --version x.y.z`, so the next update can ship as 0.2.0 (without it the release script only adds one to the last number).
