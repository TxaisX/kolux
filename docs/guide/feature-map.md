# Feature map: every button, menu item, shortcut and setting

Goal 0, item 6 (Txais, 2026-11-12): one map of every control in Kolux, what it should do, what it does now,
pass/fail, and the proof. Lane `o2-tests` owns this file and drives the app to fill it in.

**Round 3 (2026-11-12): the first three screens — sidebar, new-session chooser, pane header.** Every row below was
checked against the source this round (file:line quoted). **No row is marked `live` yet**: this lane could not launch
the app this round (no Rust build in this worktree, 8.7 GB free on a machine running five other lanes), so no control
has been clicked in a running app and nothing here claims a live pass. Round 4 runs the app and upgrades these rows.

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

Two kinds of row: a workspace **folder** row, and the UI **session** rows under it (Goal 0, item 4 — worktrees never
appear in the sidebar). Rows are reached with the mouse and the keyboard; every row has a right-click menu.

| Control | Where | What it should do | What it does now | Verdict | Proof |
|---|---|---|---|---|---|
| Add project button | `src/projects/ProjectsPanel.tsx:2520` (`data-testid="sidebar-add-project"`) | open the add menu: clone, open a folder, start a new one | opens the add form (`adding` state) | `code` | testid exists; `live-common.mjs:379` waits for it |
| Add by path → folder field | `ProjectsPanel.tsx:2582` (`data-testid="add-project-folder-input"`) | take a path, Enter adds it as a project | `addPath(pathDraft)` on Enter | `code` | `smoke.mjs` flow 2 types here; `focusField()` in `app-launch.mjs` |
| Folder row | `ProjectsPanel.tsx:2315` (`.sb-main`) | select the workspace; its sessions show in the grid | selects (`onSelect`) | `code` | `ProjectsPanel.tsx:243` reads `button.branch` / `.sess[role=button]` |
| Session row | `ProjectsPanel.tsx:243` (`.sess[role=button]`) | click selects that session's pane; one row per session | selects the pane | `check-exists` | `scripts/evidence/smoke.mjs` flow 7 (six sessions → one folder row, no `.pane-row`) |
| Folder row menu | `src/projects/menu.ts:54-59` | New workspace, Review changes (git folders), Project settings, Remove project… | the four items, Review disabled when the folder is not a repo | `code` | `menu.ts:54-59`; `live-GIT-038`/`live-EDIT-029` open All Changes through "Review changes" |
| Session row menu | `menu.ts:68-98` | Delete, Sleep/Wake, Move to status, Set parent…, Details…, Review changes, Open in (Explorer/editors/Terminal), Move up/down, Hide from the sidebar, Developer (Alt) | all of the above, with the main checkout limited to New workspace + Remove project | `code` | `menu.ts:68-98` |
| Status submenu | `menu.ts:74` | list the workspace's statuses plus Edit statuses… | lists them; edit opens the editor (`ProjectsPanel.tsx:1420`) | `code` | `menu.ts:74`, `ProjectsPanel.tsx:1420` |
| Open in submenu | `menu.ts:79-90` | Explorer / each found editor / Terminal | runs the chosen door; Terminal shows the row (`ProjectsPanel.tsx:1443`) | `code` | `menu.ts:79-90` |
| **Worktrees in the sidebar** | `menu.ts:68-98` still lists worktree-only items (Delete, Sleep, Set parent, Hide, Move up/down) | Goal 0 item 4: worktree rows never appear in the sidebar | the menu code is still worktree-shaped; whether rows are drawn is the panel's choice (`hideAuto`, team worktrees, `ProjectsPanel.tsx:259-266`) | `pending c2-agents` | `menu.ts:68-98`, `ProjectsPanel.tsx:259-266` |
| Keyboard in a menu | `menu.ts:7-14` (`menuMove`) | Arrow/Home/End move focus and wrap | implemented; Esc closes (`ProjectsPanel.tsx:227-234`) | `code` | `menu.ts:7-14` |

## 2. New session chooser

The pane a new workspace opens, and what the header's + and the sidebar's chooser action reuse.

| Control | Where | What it should do | What it does now | Verdict | Proof |
|---|---|---|---|---|---|
| Chooser pane | `src/launch/ChooserPane.tsx:311` (`data-testid="chooser-pane"`) | ask what to run, in which shape | draws seats and the agent grid | `check-exists` | `live-common.mjs:387` waits for it after adding a project |
| Close | `ChooserPane.tsx:321` (`aria-label="Close New session"`) | close the chooser; blocked while starting | `onClose`, disabled while `busy` | `code` | `ChooserPane.tsx:321` |
| Seat count | `ChooserPane.tsx:412` (`aria-label="How many sessions"`) + `:425` (any number) | 1..N sessions for this launch | sets the seat count | `code` | `ChooserPane.tsx:412-425` |
| Launch shape | `ChooserPane.tsx:353` (`aria-label="Launch shape"`) | own folder vs one grid | sets the shape | `code` | `ChooserPane.tsx:353` |
| Where the AIs work | `ChooserPane.tsx:469` (`aria-label="Where the AIs work"`, radiogroup) | each in its own worktree vs one folder | sets it | `code` | `ChooserPane.tsx:469` |
| Task for every seat | `ChooserPane.tsx:499` | one prompt applied to every seat | stores it on the launch | `code` | `ChooserPane.tsx:499` |
| Seat job title / opening prompt | `ChooserPane.tsx:517`, `:639` | optional per-seat name and opening line | stored per seat | `code` | `ChooserPane.tsx:517,639` |
| Which AI | `ChooserPane.tsx:534` (`seat-<n>-agents`), tiles `seat-agent-<id>`, `seat-agent-terminal` | one tile per agent plus a plain terminal | `aria-pressed` marks the pick; a missing agent's tile offers install | `check-exists` | smoke flow 6 (Claude Code, Codex, Grok, OpenCode, Terminal each start and take input) |
| Model / effort / fast mode | `ChooserPane.tsx:601`, `:616`, `:628` | per-seat model pick, effort, fast mode | inputs per seat | `code` | `ChooserPane.tsx:601-628` |
| Agent docs link | `ChooserPane.tsx:37` (`aria-label="<agent> docs"`) | open that agent's own docs in the browser | opens the install/docs URL | `code` | `ChooserPane.tsx:37` |
| Other AI programs | `ChooserPane.tsx:55` (`aria-label="Other AI programs"`) | the long tail of runnable programs | dialog | `code` | `ChooserPane.tsx:55` |
| Start | `ChooserPane.tsx:673` (`data-testid="chooser-start"`) | start every seat; disabled until each seat has an AI or Terminal | starts; tooltip says what is missing | `check-exists` | `live-common.mjs:393` clicks `chooser-start:not(:disabled)` |
| Save as team / saved shapes | `ChooserPane.tsx:375`, `:386` | name and reuse a launch shape | name field, rename menu | `code` | `ChooserPane.tsx:375-387` |
| **Goal 0 item 5: a chosen agent opens a terminal** | `src/terminal/paneActions.ts` (start path) | the seat opens a new terminal running the user's shell, then the agent starts inside it | c2-agents' round-2 bug: Claude Code and Grok did not start from "Start new session" | `pending c2-agents` | `smoke.mjs` flow 6 covers all five seat types; unqualified live |

## 3. Pane header

One header per terminal pane, drawn by `src/terminal/TerminalPane.tsx`.

| Control | Where | What it should do | What it does now | Verdict | Proof |
|---|---|---|---|---|---|
| Status dot | `TerminalPane.tsx:1759` (`pane-status-dot`) | colour + word + tip for idle/working/done | `role="img"` with a status word | `code` | `TerminalPane.tsx:1759` |
| Usage readout | `TerminalPane.tsx:1857` (`HeaderUsage`) | context/token use when the agent reports it | shown when a usage readout exists | `code` | `TerminalPane.tsx:1857` |
| **Context used ring** | `TerminalPane.tsx:1857` (`ContextGauge`, the fallback when there is no readout) | Goal 0: this ring is being removed | still drawn for every pane with no usage readout | `pending c3-terminal` | `TerminalPane.tsx:1857` |
| Pane menu (⋯) | `TerminalPane.tsx:1858-1869` (`title="Pane menu"`) | open the pane's menu at the button | opens `PaneMenu` at the button's corner | `code` | `TerminalPane.tsx:1858` |
| Expand / restore | `TerminalPane.tsx:1870-1879` | fill the grid with this pane; restore the others | toggles `expanded`; disabled when the pane is alone | `code` | `TerminalPane.tsx:1870-1879` |
| Split right | `TerminalPane.tsx:1881` (`data-testid="pane-split-right"`) | split the pane, new pane on the right | `onSplit("right")` | `code` | `TerminalPane.tsx:1881` |
| New session (+) | `TerminalPane.tsx:1885-1897` (`pane-new-session`) | menu of agents to start in a new pane | opens the menu under the button | `check-exists` | `live-common.mjs:178-180` clicks it and picks Claude Code |
| Close | `TerminalPane.tsx:1898` | close the pane, asking first when a program runs | `close()`; the tip names the rule | `code` | `TerminalPane.tsx:1898` |
| Link menu | `TerminalPane.tsx:1903-1920` | Ctrl+click a link: open in browser / editor / copy | `linkMenuItems` per link | `code` | `TerminalPane.tsx:1903-1920` |

## 4. What has no row yet (round 4+)

Top bar and its screens (Settings, Board, Agents, Tasks, Inbox, Tower, Floor), the App/File/Edit/View menus, the command
palette, the terminal's own find / clear / copy keys, each Settings page, All Changes, Explorer, the Board and Inbox
actions, and every shortcut in `src/keys/`. Each gets the same five columns. `tests/coverage.md` says which of them any
test names today.

## 5. Counts

| Screen | Controls mapped | `live-pass` | `check-exists` | `code` | `pending` | Bug filed |
|---|---:|---:|---:|---:|---:|---:|
| Sidebar | 10 | 0 | 1 | 8 | 1 | 0 |
| New session chooser | 14 | 0 | 3 | 10 | 1 | 0 |
| Pane header | 9 | 0 | 1 | 7 | 1 | 0 |
| **Total** | **33** | **0** | **5** | **25** | **3** | **0** |

Three controls are `pending` on their owner lane, not on this lane: the sidebar's worktree rows (Goal 0 item 4,
`c2-agents`), the chooser's agent-must-start-a-terminal path (Goal 0 item 5, `c2-agents`), and the pane header's
Context-used ring (Goal 0, `c3-terminal`).
