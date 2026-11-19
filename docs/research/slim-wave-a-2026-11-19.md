# Slim-down wave A: screens out, app still whole (2026-11-19)

Stage 2 of the rebuild plan (folders of chats). Wave A takes the old screens out of Kolux and keeps the app building, testing green and opening. Wave B takes out the engine parts those screens used.

## What changed for the user

- Gone from the app: the code editor, the Tasks and Automations screens, Kolux's own skills page, the control tower and its pop-out window, the board, artifacts, agent hand-off, insights, the disk map, the inbox, setup scripts, ports, the activity floor and the orchestration screen. Their Settings pages went with them.
- Still there: projects, the sidebar, terminal agents, sign-ins, auto pull request, updates, tray, notifications.
- Your own skills still work in every agent. Only Kolux's page for managing them went. The skill scan the chat composer uses stays.
- Kolux no longer opens Markdown files handed to it. `kolux open <file>` now says "Kolux no longer opens files; open it in your editor."
- A second launch of Kolux now always brings the running window forward, including the case where the channel between the two copies is not available yet.
- Automatic pull requests now open ready for review, not as drafts.
- Folder projects now survive a restart (they were wiped at every start before).
- The chat view has no screen to live on right now. That is intended: it comes back as the main surface in stage 3.

## Also in this merge: stage 3 building blocks (not on screen yet)

- The chat engine: one hidden Claude program per chat, talking in structured messages instead of typing into a terminal.
- The write-up writer: one History file per chat.
- New project, GitHub badge and chat finish (merge on Done) building blocks.
- One shared Claude setup for extra accounts, and the Everyday fence that keeps the Claude folder's own Git repo out of Everyday chats.
- The OpenRouter route's settings, and past chats from other accounts and the OpenRouter route.
- A second launch is handled by the single-instance plugin instead of the command-line channel.

## Size

- 816 files changed: 8,409 lines added, 68,517 removed (against the saved classic tag).
- Screen folders deleted: editor (222 files), tasks (45), settings pages (35), skills (21), automations (20), tower (12), setup, inbox, artifacts, agent start, space, board, ports, insights, floor, orchestration.
- Spec files retired into `spec/21-retired-hidden.md`: 05, 06, 08, 09, 10, 12, 13, 15, 20. 114 cards retired; P0 count 221 to 107.
- Engine: the control tower window module and its capability file removed, plus the Markdown open queue.

## Checks

| Check | Result |
|---|---|
| Invoke contract (`pnpm check`) | green |
| Whole vitest suite | 10 stale failures found, all fixed (see below); affected files re-run 88/88 |
| Rust lint (clippy, warnings as errors) | clean |
| Full Rust test suite | first run: 3,175 passed, 1 failed (control tower test reading a deleted screen file); fixed by removing the tower engine. Final run: 3,414 passed, 0 failed, 9 ignored (648 s); the lifecycle tests re-run after the last fixes: 23/23 |
| Spec firewall | 25 known hits in 13 files, 0 new |
| Windows no-console spawns | 2/2 |
| Production build + bundle budget | first load 1,365,238 bytes in 42 chunks, under the 1,499,000 ceiling |
| Live smoke on the second screen | 4 of 4 required checks pass: opens with no leftover panes; growing the grid from 3 to 6 keeps running shells; Claude status dot; all 5 session types take input; 12 chats in one folder survive a restart. The quit-and-relaunch check is report-only until kill-on-close lands. It has failed since 2026-11-13, before wave A; this time the relaunched window did not answer within 90 seconds. A solo rerun to find out why was stopped on request. |

## Stale tests fixed (none were real bugs)

1. Plan check counted P0 cards and boxes from retired spec files.
2. Plan check's passing list named retired cards.
3. The smoke script still had the editor-save and Explorer-delete flows.
4. The settings registry listed 8 removed settings.
5. A must-see sample used the removed Grok key.
6. The glass look's menu-backdrop count included deleted screens.
7. The outbound hosts list lacked the OpenRouter row.
8. A shortcut test used Ctrl+P, which belonged to the removed file picker.

## Reviews

Two independent read-only reviews, plus a quick third look at the last fixes.

**First review** (no P0):
- Fixed now: the Markdown open queue (files handed to Kolux had nowhere to open), the second launch not raising the window when the channel is unavailable, and two deleted tests for live behaviour (restored).
- Moved to wave B: the native menu, Appearance switches, Help tours and palette actions that still name removed screens; the skill-delete startup step; dead code and stale comments.

**Second review** of the fixes (no P0 or P1):
- Fixed now: a stale process id from a crashed run could raise an unrelated program (now skipped unless that process started before the startup file was written); a hung window could block the second launch (restore is now asynchronous); two stale spec tier counts; stale references to the tower window in two architecture docs and the glass stylesheet.
- Moved to wave B: the fallback raise cannot show a window hidden to the tray. It is not worse than before (that path only exited), and the fix belongs with the command-line tool's removal in wave B.
- Accepted: `kolux open help` prints the "no longer opens files" line. The command-line tool goes in wave B.

**Third look** at the last fixes (no P0-P2): one leftover, an architecture doc still describing removed screens; fixed. It confirmed the process-start check never rejects the real running copy and does reject a reused id.

## Left for wave B

- Engine removals: the command-line tool, Grok, extra-agent installers and hooks, provider and credential modules, automations, protected files and routing, the skills engine and skill delete.
- Native menu entries, the Tasks/Automations/Skills buttons, Help tours and palette actions for removed screens.
- Two live proof scripts that still open the tower window, and the Appearance card's pop-out box.
- The fallback second-launch raise for a window hidden to the tray.
- Re-check quit and relaunch: find out why the relaunched window did not answer in the last run, and whether the new single-copy check plays a part.
- The outbound hosts row for the Grok key; i18n strings for removed screens; dead code.

## Commits

- 53 commits on top of the saved classic version: 43 changes and 10 merges of the parallel build lanes, squashed into one commit on main through pull request 259 (2026-11-19).
- The merge landed before GitHub had finished its own checks: the repository does not have "merge when checks pass" switched on, so the merge command merged at once. Every local check above had passed first. GitHub's checks on the merged code are recorded below once they finish.

## GitHub checks after the merge

- Five of six GitHub checks passed on the merged code: the four test shards and the types, licences, plan and workflows check.
- The sixth (Rust tests, lint and dependency check) was still running when this was written. Its dependency step has failed on main since 2026-11-18, before this merge: a new notice says the chrono date library is no longer maintained. It is not a security hole, and no upgrade exists. It comes in only through the Recycle Bin library, which leaves in wave B.
- The follow-up commit adds that notice to the documented exceptions list, next to four earlier ones of the same kind. The dependency check passes locally with it.
