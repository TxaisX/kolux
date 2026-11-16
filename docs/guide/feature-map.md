# Feature map: every button, menu item, shortcut and setting

Goal 0, item 6 (Txais, 2026-11-12): one map of every control in Kolux, what it should do, what it does now,
pass/fail, and the proof. Lane `o2-tests` owns this file and drives the app to fill it in.

**Round 4 (2026-11-12): the app ran.** This lane built the dev app and drove it live for the first time, so the rows
below are no longer all guesses: **7 controls were really clicked in a running app** (they are marked `live-pass` with the
run that did it), and the three goal-0 latency numbers are measured and recorded in section 4. The other rows stay
`code`/`check-exists` until a check drives them; nothing here claims a pass that was not run.

Round 3 (2026-11-12) mapped the first three screens — sidebar, new-session chooser, pane header — by reading the source.

## How to read a row

| Verdict | Means |
|---|---|
| `live-pass` / `live-fail` | a check drove the running app; `live-fail` has a bug file |
| `check-exists` | a live check drives it but has not been qualified on a running app yet |
| `code` | read in the source this round: the control, its label and its handler exist and are wired; never clicked |
| `pending <lane>` | the owning lane is mid-change on it (Goal 0 or a known bug) |
| `gap` | nothing tests it; listed under "Next" for a check |

Proof is either a check name (`scripts/prove/live-*.mjs`, `scripts/evidence/smoke.mjs` flow) or `file:line`.

## 1. Sidebar

The list shows project **folders** only: one folder row per project, and no session rows in any "Group and sort"
setting (the default list since 0.1.16, the other groupings since the wave of 2026-11-15). A worktree has no row of its
own (Goal 0, item 4); its old row shows only while a question or form of its own is open. Rows are reached with the
mouse and the keyboard; every row has a right-click menu.

| Control | Where | What it should do | What it does now | Verdict | Proof |
|---|---|---|---|---|---|
| Add project button | `src/projects/ProjectsPanel.tsx:2568` (`data-testid="sidebar-add-project"`) | open the add menu: clone, open a folder, start a new one | opens the add form (`adding` state) | `live-pass` | `live-latency` (round 4): `startPlain()` clicks it in every live run and the add form opened |
| Add by path → folder field | `ProjectsPanel.tsx:2625` (`data-testid="add-project-folder-input"`) | take a path, Enter adds it as a project | `addPath(pathDraft)` on Enter | `live-pass` | `live-latency` (round 4): typed a repo path, Enter, and the workspace opened with a pane |
| Folder row | `ProjectsPanel.tsx:2318-2322` (`div.proj.folder`, `data-testid="sidebar-folder"`) | select the workspace; its sessions show in the grid | selects it: the row carries `sel` and its grid is on screen | `live-pass` | `live-controls` (round 5): a real mouse press at the row's centre, then `button.branch.sel` is the row and its title reads `Show <path>`, with the workspace's pane on screen (`pressed at [151,279]; selected row "Show G:\Temp\…\CTRL"`) |
| Session row | none: `ProjectsPanel.tsx` no longer has the `sessionRows` code | none in any "Group and sort" setting: the sidebar lists project folders only | no session rows in any grouping. In the other groupings the list holds one card per project folder (`ProjectsPanel.tsx:2748-2767`, main checkouts only) | `code` | grouped by project: `scripts/evidence/smoke.mjs` flow 7 (2026-11-15) fails when a `sidebar-session` row shows: six sessions in one workspace → one folder row, no session rows, no `.pane-row`, clicking the folder shows all six panes, and a restart kept all six. Every grouping: `src/projects/__cards__/VIEW-051.test.ts` finds no session row in the drawn list |
| Folder row menu | `src/projects/menu.ts:54-59` | Review changes (git folders), Project settings, Remove project… | the three items, Review disabled when the folder is not a repo. New workspace is not listed: the panel calls `projectMenu(true, …)` (`ProjectsPanel.tsx:2333`) | `code` | `menu.ts:54-59`; `live-GIT-038`/`live-EDIT-029` open All Changes through "Review changes" |
| Row menu (a folder's card) | `menu.ts:68-98` (`rowMenu`) | on a folder's card (a pinned folder, or the list in another grouping): Move to status, Details…, Review changes, Open in (Explorer/editors/Terminal), Developer (Alt), Remove project…, and New workspace while worktrees are on | those items for a folder's card. The worktree-only items (Delete, Sleep/Wake, Set parent…, Move up/down, Hide from the sidebar) are still in the code for a worktree's old row, which shows only while a question or form of its own is open | `code` | `menu.ts:68-98`, `ProjectsPanel.tsx:1389` |
| Status submenu | `menu.ts:74` | list the workspace's statuses plus Edit statuses… | lists them; edit opens the editor (`ProjectsPanel.tsx:1475`) | `code` | `menu.ts:74`, `ProjectsPanel.tsx:1475` |
| Open in submenu | `menu.ts:79-90` | Explorer / each found editor / Terminal | runs the chosen door; Terminal shows the row (`ProjectsPanel.tsx:1483`) | `code` | `menu.ts:79-90` |
| **Worktrees in the sidebar** | `ProjectsPanel.tsx:1924-1927` (`row`), `:1780-1781` | Goal 0 item 4: worktree rows never appear in the sidebar | a worktree has no row: the default list draws its old row only while a question or form of its own is open (Delete, Sleep, Details, Move, Status), and Pinned and the other groupings hold main checkouts only. The menu code still lists the worktree-only items for that old row | `code` | `ProjectsPanel.tsx:1924-1927`, `:1780-1781`, `menu.ts:68-98` |
| Keyboard in a menu | `menu.ts:7-14` (`menuMove`) | Arrow/Home/End move focus and wrap | implemented; Esc closes (`ProjectsPanel.tsx:233-240`) | `code` | `menu.ts:7-14` |

## 2. New session chooser

The pane a new workspace opens, and what the header's + and the sidebar's chooser action reuse.

| Control | Where | What it should do | What it does now | Verdict | Proof |
|---|---|---|---|---|---|
| Chooser pane | `src/launch/ChooserPane.tsx:445` (`data-testid="chooser-pane"`) | ask what to run, in which shape | draws seats and the agent grid | `live-pass` | `live-latency` (round 4): a new workspace opened the chooser, every seat got Terminal, Start ran |
| Close | `ChooserPane.tsx:455` (`aria-label="Close the Start form"`), `:465` (the chooser inside a pane, "Close this chooser") | close the chooser; blocked while starting | `onClose`, disabled while `busy` | `code` | `ChooserPane.tsx:455`, `:465` |
| Seat count | `ChooserPane.tsx:496` (`aria-label="How many sessions"`) + `:509` (any number) | 1..N sessions for this launch | sets the seat count | `code` | `ChooserPane.tsx:496-509` |
| Launch shape | `ChooserPane.tsx:592` (`aria-label="Launch shape"`) | own folder vs one grid | sets the shape | `code` | `ChooserPane.tsx:592` |
| Where the AIs work | `ChooserPane.tsx:663` (`aria-label="Where the AIs work"`, radiogroup) | each in its own worktree vs one folder | sets it | `code` | `ChooserPane.tsx:663` |
| Task for all of them | `ChooserPane.tsx:767` | one prompt applied to every seat | stores it on the launch | `code` | `ChooserPane.tsx:767` |
| Folders (Start form, T-824) | `ChooserPane.tsx:482` (`aria-label="Folders"`) | tick the known projects to start in, most recent first; Add folder opens the add-project dialog | ticks are kept on the sheet; Start runs once per ticked folder | `code` | `src/launch/__cards__/START-FORM.test.ts` |
| Which AI for all (Start form, T-824) | `ChooserPane.tsx:544` (`aria-label="Which AI"`) | one AI, model and effort for every seat; Mixed when seats differ | sets every seat at once | `code` | `src/launch/startForm.test.ts`, `START-FORM.test.ts` |
| Make each one different (Start form, T-824) | `ChooserPane.tsx:583` (`details.chooser-each`) | the per-seat rows, shape, saved teams and Use last lineup, closed by default | native disclosure | `code` | `START-FORM.test.ts` |
| Keep what was open (Start form, T-824) | `ChooserPane.tsx:793` | at app open, close the form and change nothing | same as Cancel, other words | `code` | `START-FORM.test.ts` |
| Ask what to open when Kolux starts (T-824) | `src/settings/GeneralPage.tsx:53` | Settings switch, on by default | saves `askWhatToOpen` | `code` | `src/launch/startForm.test.ts` |
| Seat job title / opening prompt | `ChooserPane.tsx:703`, `:754` | optional per-seat name and opening line | stored per seat | `code` | `ChooserPane.tsx:703,754` |
| Which AI | `ChooserPane.tsx:711` (`seat-<n>-agents`), tiles `seat-agent-<id>`, `seat-agent-terminal` | one tile per agent plus a plain terminal | `aria-pressed` marks the pick; a missing agent's tile offers install | `live-pass` (Terminal tile) | `live-latency` (round 4): the Terminal tile was pressed for the seat and the shell started; the four agent tiles are still smoke flow 6 only |
| Model / effort / fast mode | `ChooserPane.tsx:716`, `:731`, `:743` | per-seat model pick, effort, fast mode | inputs per seat | `code` | `ChooserPane.tsx:716-743` |
| Agent docs link | `ChooserPane.tsx:38` (`aria-label="<agent> docs"`) | open that agent's own docs in the browser | opens the install/docs URL | `code` | `ChooserPane.tsx:38` |
| Other AI programs | `ChooserPane.tsx:56` (`aria-label="Other AI programs"`) | the long tail of runnable programs | dialog | `code` | `ChooserPane.tsx:56` |
| Start | `ChooserPane.tsx:802` (`data-testid="chooser-start"`) | start every seat; disabled until each seat has an AI or Terminal | starts; tooltip says what is missing | `live-pass` | `live-latency` (round 4): `chooser-start:not(:disabled)` clicked, a shell pane appeared and took input |
| Save as team / saved shapes | `ChooserPane.tsx:610`, `:599-604` | name and reuse a launch shape | name field (`:614`), rename menu (`:604`, `:625-628`) | `code` | `ChooserPane.tsx:599-628` |
| **Goal 0 item 5: a chosen agent opens a terminal** | `src/terminal/paneActions.ts` (start path) | the seat opens a new terminal running the user's shell, then the agent starts inside it | c2-agents' round-2 bug: Claude Code and Grok did not start from "Start new session" | `pending c2-agents` | `smoke.mjs` flow 6 covers all five seat types; unqualified live |

## 3. Pane header

One header per terminal pane, drawn by `src/terminal/TerminalPane.tsx`.

| Control | Where | What it should do | What it does now | Verdict | Proof |
|---|---|---|---|---|---|
| Status dot | `TerminalPane.tsx:1715` (`pane-status-dot`) | colour + word + tip for idle/working/done | `role="img"` with a status word | `code` | `TerminalPane.tsx:1715` |
| Usage readout | `TerminalPane.tsx:1815` (`HeaderUsage`) | context/token use when the agent reports it | shown when a usage readout exists | `code` | `TerminalPane.tsx:1815` |
| **Context used ring** | gone: `src/` has no `ContextGauge` any more | Goal 0: this ring is removed | removed: a pane with no usage readout draws nothing in that place (`TerminalPane.tsx:1815`) | `code` | `TerminalPane.tsx:1815` |
| Pane menu (⋯) | `TerminalPane.tsx:1816-1818` (`title="Pane menu"`) | open the pane's menu at the button | opens `PaneMenu` at the button's corner | `live-pass` | `live-latency` (round 4): three real mouse presses (CDP `Input.dispatchMouseEvent`, not `element.click()`) each opened a `[role=menu]`, and each was timed for the click target |
| Expand / restore | `TerminalPane.tsx:1830-1834` (`title^="Expand:"` / `title^="Restore:"`) | fill the grid with this pane; restore the others | toggles `expanded`; the tip says "the only pane already fills the grid" and the press is a no-op when the pane is alone | `live-pass` | `live-controls` (round 5): split first, then a real press on Expand took the grid from **2 panes to 1** and the button became `Restore: the other panes come back (Ctrl+Shift+Enter)`; a press on Restore brought **2** back |
| Split right | `TerminalPane.tsx:1839` (`data-testid="pane-split-right"`) | split the pane, new pane on the right | `onSplit("right")`; the new shell prints its prompt | `live-pass` | `live-controls` (round 5): a real press took the grid 1 → 2 panes, and the new pane's last buffer line was `PS G:\Temp\…\CTRL> ` |
| New session (+) | `TerminalPane.tsx:1843-1855` (`pane-new-session`) | menu of agents to start in a new pane | opens the menu under the button | `live-pass` | `live-latency` (round 4): opened the menu and started a pane from it; the new pane is also the 300 ms latency target |
| **"Blank terminal" item in the + menu** | `src/launch/PlusMenu.tsx:210-217` (`.name` = "Blank terminal") | start a plain shell, no agent | opens a new pane running the user's shell | `live-pass` | `live-latency` (round 4). Note for the map: the item is labelled **"Blank terminal"**, not "Terminal"; a separate "Terminal…" submenu (`PlusMenu.tsx:218-237`) appears only when more than one shell is installed |
| Close | `TerminalPane.tsx:1856` | close the pane, asking first when a program runs | `close()`; the tip names the rule | `code` | `TerminalPane.tsx:1856` |
| Link menu | `TerminalPane.tsx:1865` | Ctrl+click a link: open in browser / editor / copy | `linkMenuItems` per link | `code` | `TerminalPane.tsx:1865` |

## 4. Latency (Goal 0, item 7)

Txais's targets: keystroke → character on screen under **16 ms** (one frame), click or shortcut → visible response
under **50 ms**, a new terminal session → ready shell prompt under **300 ms**. `scripts/prove/live-latency.mjs` measures
all three in the running app; rerun with
`node scripts/stress/run-all.mjs --instances 1 --only latency --timeout 20 --out G:/Temp/o2-latency`.

Every sample is taken in the page with `performance.now()`, from the real DOM event to the thing the user sees, so the
harness's own CDP transport is outside both ends of the window. The run prints every sample, not just the median.

| What | Target | Measured (2026-11-12, dev build, 5 other lanes running) | Verdict | Proof |
|---|---|---|---|---|
| Keystroke → character in the terminal | < 16 ms | **3.2-4.8 ms** median across four runs; max 8.3 ms once warm (the very first key after launch is 42-79 ms: cold first paint) | `live-pass` | `live-latency`: 12 samples per run, timed from the browser's `keydown` to xterm's `onRender` |
| Click → visible response | < 50 ms | **6.6-10.1 ms** median, max 11.1 ms | `live-pass` | `live-latency`: 3 real mouse presses on the pane header's Pane menu, timed to the first DOM mutation; the check also asserts the menu really opened each time |
| New session → ready shell prompt | < 300 ms | **612-1645 ms** across four runs. Split: Kolux's own part (press → the new pane drawn) **156-375 ms**; the shell's own start (pane drawn → first prompt line) **647-1270 ms** | `live-fail` | `live-latency`; bug filed to `c2-agents`: `_shared/bugs/c2-agents/20261112-1155-new-session-latency-1050ms.md` |

The load matters: this PC was shared with five other lanes, so rerun these on a quiet machine before believing a
regression. The number to hold the wave to is the median. The new-session row is the one that misses: even Kolux's own
part of it (156-375 ms) can exceed the whole 300 ms budget before the shell has drawn anything.

## 5. What has no row yet (round 5+)

Top bar and its screens (Settings, Board, Agents, Tasks, Inbox, Tower, Floor), the App/File/Edit/View menus, the command
palette, the terminal's own find / clear / copy keys, each Settings page, All Changes, Explorer, the Board and Inbox
actions, and every shortcut in `src/keys/`. Each gets the same five columns. `tests/coverage.md` says which of them any
test names today.

## 6. Counts

| Screen | Controls mapped | `live-pass` | `live-fail` | `check-exists` | `code` | `pending` | Bug filed |
|---|---:|---:|---:|---:|---:|---:|---:|
| Sidebar | 10 | 3 | 0 | 0 | 7 | 0 | 0 |
| New session chooser | 19 | 3 | 0 | 0 | 15 | 1 | 0 |
| Pane header | 10 | 5 | 0 | 0 | 5 | 0 | 0 |
| Latency targets (section 4) | 3 | 2 | 1 | 0 | 0 | 0 | 1 |
| **Total** | **42** | **13** | **1** | **0** | **27** | **1** | **1** |

Round 4 moved 7 controls from `code`/`check-exists` to `live-pass` by really driving them (the latency run adds a pane
header row: the "Blank terminal" menu item), and added the three latency targets, one of which fails.

Round 5 adds `scripts/prove/live-controls.mjs` (`run-all --only controls`), three more controls moved to `live-pass` by a
real mouse press each: the sidebar folder row, Expand/Restore, and Split right. It also caught what a menu-driven test
cannot: pressing Expand on a solo pane does nothing by design, so the check splits first and asserts 2 panes → 1 → 2.

Round 6 re-ran the two smoke flows that were unproven: **flow 6** now starts all four agent types (Claude Code, Codex,
Grok, OpenCode) plus a blank terminal, each proving it took a typed line, and **flow 7** now proves six sessions in one
workspace, one folder row, six session rows, no `.pane-row`, and a restart that keeps all six. The smoke's own setup
also closes the first-run dialog the way a user would (corner close → Skip). The new `rightclick` helper in
`scripts/evidence/cdp.mjs` is ready for the sidebar's row menus; the first real right-click on the folder row did not
open the menu under the harness's off-screen pointer, so that row stays `code` until a later run drives it.

2026-11-15: two smoke flows were brought in line with the app. **Flow 7** now asserts the 0.1.16 rule (one folder row,
no session rows in the list grouped by project), so the Session row moved from `live-pass` to `code`. **Flow 1** grows
the grid through the Start form: a bigger number on the layout strip opens the form with one seat per cell to add,
nothing starts before Start, and the shells that were running keep their processes.

2026-11-16 (the wave of 2026-11-15 merged): the session rows are gone from every grouping, so the Session row no longer
names a test id, and the "Session row menu" row became "Row menu (a folder's card)". The sidebar's worktree rows and the
pane header's Context-used ring are done in the code and now read `code`. The line numbers in sections 1 to 3 were read
again against the merged code. The counts were counted again from the rows: the chooser has 19 rows since the Start form
rows came in, not 14.

One control is still `pending` on its owner lane, not on this lane: the chooser's agent-must-start-a-terminal path
(Goal 0 item 5, `c2-agents`).
<!-- verified against: src/App.tsx, src/projects/ProjectsPanel.tsx, src/terminal/TerminalPane.tsx, src/launch/ChooserPane.tsx, src/keys/actions.ts at ade25b4c -->
