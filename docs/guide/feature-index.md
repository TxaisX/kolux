# Feature index

This page lists every finished build task and, in plain words, what it gives you.
Each row links to the guide page that explains the feature; "internal" means behind-the-scenes work you never see.
Tasks not yet ticked off in the build plan are not listed.

## 0. Walking skeleton

| Task | Feature | Guide page |
|---|---|---|
| T-001 | The app opens one window and saves its state and settings on your computer. | [Getting started](getting-started.md) |
| T-001-fix | Project notes on current state were rewritten for accuracy. | internal |
| T-002 | Open a PowerShell terminal pane that takes typing and resizes. | [Terminals](terminals.md) |
| T-003 | Add a git folder as a project and give a branch its own workspace folder. | [Projects and worktrees](projects-and-worktrees.md) |
| T-003b | The window uses Kolux's own look: custom title bar, side bar and top bar. | [Getting started](getting-started.md) |
| T-003b-fix-a | The top bar keeps the view switcher centred and window buttons visible. | [Getting started](getting-started.md) |
| T-003b-fix-b | Design notes now record where the New tab and split buttons sit. | internal |
| T-004 | Start Claude Code in its own fresh worktree, named after a creature. | [Getting started](getting-started.md) |
| T-542 | A one-command smoke test checks the app's main flows end to end. | internal |
| T-005 | Keyboard shortcuts live in a file you own, with sensible default keys. | [Settings](settings.md) |

### P0 · theme 1 · Session-per-pane terminal grid (20 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-006 | Switching workspaces is instant and each keeps its own state. | [Projects and worktrees](projects-and-worktrees.md) |
| T-007-a | The plus menu lists only agents really installed and starts one in a new pane. | [Getting started](getting-started.md) |
| T-007-a-fix | Agent detection now also finds tools on your machine and user PATH. | [Getting started](getting-started.md) |
| T-007-b | An empty pane asks what to run; choose how many sessions to start. | [Terminals](terminals.md) |
| T-008-a | Each launch seat uses an AI and model you chose; nothing is guessed. | [Getting started](getting-started.md) |
| T-008-b | Each supported agent starts with its own program, options and opening prompt. | [Getting started](getting-started.md) |
| T-008-b-fix | An agent Kolux starts is credited for exactly as long as it runs. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-009 | Panes sit in a grid sized by pane count; split a pane right or down. | [Terminals](terminals.md) |
| T-009-fix-a | One pane split down becomes a stacked pair of rows. | [Terminals](terminals.md) |
| T-009-fix-b | When a full grid blocks a new pane, the message names the sessions in the way. | [Terminals](terminals.md) |
| T-010 | Open new terminal and agent tabs, and paste into a terminal. | [Terminals](terminals.md) |
| T-010-fix | A paste lands in the pane you pasted into, never another. | [Terminals](terminals.md) |
| T-011 | Open a session's live terminal inside its Board card. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-012-a | Open a browser tab next to your terminals; pages survive switching away. | [Files and browser](files-and-browser.md) |
| T-012-b | Browser tabs have an address bar that searches, plus back, forward, reload and stop. | [Files and browser](files-and-browser.md) |
| T-012-b-fix | Browser shortcuts such as Mod+L and Alt+Left work inside a web page. | [Files and browser](files-and-browser.md) |
| T-500 | Browser tabs open only web pages, and the app's page policy blocks other content. | [Safety](safety.md) |

### P0 · theme 2 · Isolation: one worktree per agent (20 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-013 | Add a project by choosing a folder; its checkout and worktrees appear. | [Projects and worktrees](projects-and-worktrees.md) |
| T-013-fix-a | New workspace opens the add-project form when you have no project yet. | [Projects and worktrees](projects-and-worktrees.md) |
| T-013-c | Creating workspaces cleans up half-made folders and branches if cancelled or overtaken. | [Projects and worktrees](projects-and-worktrees.md) |
| T-013-fix-b | Emoji workspace names are turned into readable words. | [Projects and worktrees](projects-and-worktrees.md) |
| T-014-a | Choose where workspace folders live and what a new workspace starts from. | [Projects and worktrees](projects-and-worktrees.md) |
| T-014-b | The kolux worktree command creates and removes worktrees. | [Command line](command-line.md) |
| T-014-b-fix | Creating a worktree with a prompt falls back to your default agent. | [Command line](command-line.md) |
| T-015 | Each agent gets its own copy of the project, or share one folder. | [Projects and worktrees](projects-and-worktrees.md) |
| T-016 | One command starts a worker agent in its own worktree. | [Command line](command-line.md) |
| T-017-a | New Claude worktrees are pre-trusted so the first prompt is not lost. | [Projects and worktrees](projects-and-worktrees.md) |
| T-017-b | New Codex worktrees are pre-trusted the same way. | [Projects and worktrees](projects-and-worktrees.md) |
| T-017-c | Decision recorded: Cursor and Copilot worktrees are not pre-trusted. | internal |
| T-018-a | Stage, unstage and commit changes from the Source Control panel. | [Projects and worktrees](projects-and-worktrees.md) |
| T-018-b | The main Source Control button always offers the next step, including remote actions. | [Projects and worktrees](projects-and-worktrees.md) |
| T-018-c | Source Control rows select with Ctrl and Shift clicks for bulk actions. | [Projects and worktrees](projects-and-worktrees.md) |
| T-019 | Worktrees are created, moved and removed through git safely. | [Projects and worktrees](projects-and-worktrees.md) |
| T-020 | Pick the folder new worktrees go into. | [Settings](settings.md) |
| T-021 | The kolux worktree create command can start an agent inside. | [Command line](command-line.md) |

### P0 · theme 3 · Knowing what each agent is doing (41 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-022 | Group and sort the workspace list; workspaces needing you come first. | [Projects and worktrees](projects-and-worktrees.md) |
| T-023 | Each pane header shows agent, name and a colour-coded status word. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-024 | Tabs show activity, and bells or finishes raise notifications. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-025-a | Claude Code reports its status through hooks Kolux installs and looks after. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-025-b | Codex status is reported too, with its hook trust handled for you. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-025-c | Subagents and teammates show under their lead session. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-026-a | A desktop notification arrives when an agent finishes, needs you or goes quiet. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-026-b | One status vocabulary is used for every dot, chip and label. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-026-c | The Inbox lists what needs you, what is running, what finished today and what stopped today. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-027 | Thought rows in the Agents chat start folded and open or fold from the keyboard; Expand all and Collapse all sit above the chat. | [Board, Agents and Inbox](board-agents-inbox.md#chat-on-the-agents-page) |
| T-028-a | Board cards show one line of activity, status chips, and approve or deny buttons. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-028-b | The Agents screen uses the same fixed status words. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-029 | Palette rows show each agent's live state and age. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-030 | An idle agent is told when mail arrives; workers report done and heartbeats. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-031 | Each automation keeps a numbered run history you can step through. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-032 | Review a plan in sections and comment before Claude approves it. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-033 | Source Control lists changes by section and opens a change for review. | [Projects and worktrees](projects-and-worktrees.md) |
| T-033-b | Source Control, diffs and All Changes update within about a second of a change, instead of polling. | [Projects and worktrees](projects-and-worktrees.md) |
| T-033-c | Choose which split a diff opens in; All Changes compares the branch with its base, keeps a default layout and has a commit box; files Git ignores no longer refresh the list. | [Files and browser](files-and-browser.md) |
| T-033-f | Source Control keeps updating for an ignored folder that still holds tracked files, and notices edits to `.git/info/exclude`. | [Projects and worktrees](projects-and-worktrees.md) |
| T-033-g | The All Changes tab is ready to commit as soon as it opens, and a branch with no history in common with its base says so instead of comparing silently. | [Files and browser](files-and-browser.md) |
| T-034 | Leave review notes on diff lines and send them to the agent. | [Files and browser](files-and-browser.md) |
| T-035 | Open in Code and Answer in Code jump to the agent's pane. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-036 | Settings page for choosing agents, the default agent and how they start. | [Settings](settings.md) |
| T-037 | Resource Manager shows memory per session and lets you end one. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-037-fix-look | The centred switcher no longer covers the search box on narrow windows. | [Getting started](getting-started.md) |

### P0 · theme 4 · Accounts, sign-in and usage limits (20 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-038 | Saved keys and sign-ins are sealed on disk. | [Safety](safety.md) |
| T-039-a | A Claude stop from a limit or sign-in problem shows its cause. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-039-b | Claude's usage figures are read and shown for each session. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-040-a | Board cards show context size and plan spending meters. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-040-b | The Agents view shows usage rings per session and a plan footer. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-041-a | A 200k context cap is on by default and can be switched off in Settings. | [Settings](settings.md) |
| T-041-b | A Claude pane stopped by a limit waits for its reset and resumes. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-042-a | Codex plan figures are read without opening a session. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-042-b | Decision recorded: no further Codex usage lookup is built. | internal |
| T-043-a | Connect Claude once with a key that lasts a year. | [Settings](settings.md) |
| T-043-b | Sign a Claude account in through the browser and keep it renewed. | [Settings](settings.md) |
| T-043-c | Connect Codex with a ChatGPT sign-in or device code. | [Settings](settings.md) |
| T-043-d | A switch leaves Claude sign-in upkeep to Claude Code itself. | [Settings](settings.md) |
| T-043-e | Mac keychain rules for sign-in records were added. | internal |
| T-044 | A lapsed sign-in is flagged outside Settings with a Sign in again button. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-045 | The Accounts and keys settings page flags sign-in trouble. | [Settings](settings.md) |

### P0 · theme 7 · Redesign and the new look (24 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-046 | The New session page fills the workspace instead of opening a dialog. | [Getting started](getting-started.md) |
| T-047 | Expand a pane to fill the grid; every pane has a header with title and usage. | [Terminals](terminals.md) |
| T-048 | The terminal grid has a clean, uncluttered look. | [Terminals](terminals.md) |
| T-049-a | Three workspace screens, Agents, Board and Terminals, switch from the keyboard. | [Getting started](getting-started.md) |
| T-049-b | The Kolux menu's View menu has a Workspace View choice for Agents, Board and Terminals, with the current screen ticked. It is absent in the Classic look. | [Getting started](getting-started.md) |
| T-050 | The Agents screen lists sessions by saved agent with chat, terminal and composer. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-051 | The left sidebar shows, hides and resizes, listing projects and their sessions. | [Projects and worktrees](projects-and-worktrees.md) |
| T-053 | Pick the app colour theme: Classic or one of 16 hues, with sliders. | [Settings](settings.md) |
| T-054 | Choose Light, Dark or System mode in the ten-page Settings. | [Settings](settings.md) |
| T-418 | First launch is dark with the new look. | [Getting started](getting-started.md) |
| T-419 | Notification settings code was tidied. | internal |

### P0 · theme 5 · Safety and trust (20 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-055 | Delete a workspace safely. | [Safety](safety.md) |
| T-057 | Closing a terminal with a live program asks first. | [Safety](safety.md) |
| T-058 | Claude stops and asks before running a protected shell command. | [Safety](safety.md) |
| T-059-a | Protected commands pause before a recursive delete reaching outside the workspace. | [Safety](safety.md) |
| T-060 | Paths on other computers are refused; links to programs are only revealed. The list of program types grew (remote-desktop files, disk images, installers), and a name holding a hidden control character is refused. | [Safety](safety.md) |
| T-061 | Discarding changes asks first and says exactly what will be lost. | [Safety](safety.md) |
| T-062-a | File access stays inside your projects and refuses other computers' shares. | [Safety](safety.md) |
| T-063 | The browser page-control endpoint answers only Kolux's own tools. | [Safety](safety.md) |
| T-064-a | Diagnostic logs stay on your computer and are scrubbed before sharing. | [Troubleshooting](troubleshooting.md) |
| T-064-b | Your work stays on the computer and the app sends no usage data. | [Safety](safety.md) |

### P0 · theme 9 · Reliability and no lost work (20 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-065 | Workspace tabs and layout are saved and restored. | [Projects and worktrees](projects-and-worktrees.md) |
| T-066 | Agent sessions resume after a quit or a crash. | [Projects and worktrees](projects-and-worktrees.md) |
| T-066-b | Resume forms are built in for 17 more agents, each used only when an agent tab is restored. | [Projects and worktrees](projects-and-worktrees.md#agent-sessions-after-a-restart) |
| T-066-c | A restored agent tab asks for its resume form and is marked "restored without resume" when it has none. Kiro and Aider resume their folder's last conversation; the other agents resume when Kolux knows their session ID. | [Projects and worktrees](projects-and-worktrees.md#agent-sessions-after-a-restart) |
| T-067 | Panes keep their identity across layout changes; copying never happens silently. | [Terminals](terminals.md) |
| T-068 | Terminal output is restored after the background host or computer died. | [Projects and worktrees](projects-and-worktrees.md) |
| T-069-a | The app reopens on the screen and page you left, saving on quit. | [Projects and worktrees](projects-and-worktrees.md) |
| T-069-b | A slow start never drops your saved tabs. | [Projects and worktrees](projects-and-worktrees.md) |
| T-071 | Task state changes keep tasks and workers in step; a worker can be stopped. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-072-a | Every automation run ends with a truthful status. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-072-b | A dispatched run completes only when its agent really finishes. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-073 | A banner tells you when an open file was changed on disk, with Reload (undoable), Keep my edits and Compare. | [Files and browser](files-and-browser.md) |
| T-073-a | Saving a file never overwrites an agent's edit you have not seen. | [Files and browser](files-and-browser.md) |
| T-073-c | Diff view saves also check for newer edits and offer Reload or Keep mine. | [Files and browser](files-and-browser.md) |
| T-073-e | Your own save no longer sets off the changed-on-disk banner, and the banner leaves once the file matches again. | [Files and browser](files-and-browser.md) |
| T-076 | `kolux status` says whether the app is running, not running, left behind (stale) or still loading. | [Command line](command-line.md) |
| T-076-b | kolux status answers within about 2.5 seconds and says busy while Kolux handles another request. | [Command line](command-line.md) |
| T-076-c | `kolux status` says what Kolux is busy with and for how long; a busy time of many minutes may mean it is stuck. Sending a prompt to a busy agent says "queued" and exits 0; `--wait-submit` takes 1 to 300. | [Command line](command-line.md) |

### P0 · theme 11 · Orchestration and automations (31 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-077 | Child workspaces nest under their parent. | [Projects and worktrees](projects-and-worktrees.md) |
| T-078 | Launch shapes Solo, Pair, Workbench and Swarm assign roles to agents. | [Getting started](getting-started.md) |
| T-079 | Terminal commands in the kolux command line list and control terminals. | [Command line](command-line.md) |
| T-079-b | Terminal show, read, send and wait in the command line, with time limits, warnings and safe retries. | [Command line](command-line.md) |
| T-081 | Pick model tiers per provider for worker agents. | [Settings](settings.md) |
| T-082 | A coordinator opens a Run and its terminal becomes the Run's home. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-083 | Answer a message, browse recent mail, and make tasks wait on each other. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-084 | A worker's brief tells it how to report, ask and stay in touch. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-085-a | Launch an agent with a saved prompt on a timetable. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-085-b | Automations can start on events such as a pull request opening or checks failing. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-086 | The Automations list sorts, filters and searches; run, pause, edit or delete. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-087 | Set model and effort per tier for orchestration workers. | [Settings](settings.md) |
| T-088 | The kolux command works in every Kolux terminal with no setup. | [Command line](command-line.md) |
| T-089-a | Command-line tasks and dispatch, and worker-start for launching workers. | [Command line](command-line.md) |
| T-089-b | The command line can ask a question and wait for the answer. | [Command line](command-line.md) |
| T-089-c | The command line can show one worker (worker-show) and release a settled one, saving its output before closing its terminal; worker-stop warns when it cannot end the process. | [Command line](command-line.md#worker-commands) |

### P0 · theme 8 · Release, update and CI pipeline (7 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-090 | Quiet update checks run at start and every half hour. | [Getting started](getting-started.md) |
| T-091 | One ship command commits, syncs and lands work on main. | internal |
| T-540 | A plan-check script computes the project status counters. | internal |
| T-541 | A firewall script scans specification notes for forbidden references. | internal |
| T-541-b | Spec notes flagged by the firewall scan were cleaned up. | internal |
| T-543 | A structural tidy of the app's code with no change in behaviour. | internal |
| T-543-b | Trial build: opens on Terminals with no pane, hides unfinished buttons, shows the real hooks state. | [Getting started](getting-started.md) |
| T-542-b | The smoke test covers quitting and coming back. | internal |
| T-540-b | Plan-check fails and names ids missing from the plan. | internal |
| T-545 | The smoke test waits longer for a pane to take focus. | internal |
| T-551 | Under Yolo, Codex runs without approval prompts but inside its sandbox, writing only in its workspace. | [Safety](safety.md) |

### P0 · theme 6 · Business-user frame (4 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-092-a | The AI connections page shows a Connect card for each agent. | [Settings](settings.md) |
| T-092-b | Connect cards walk from not installed to connected through clear states. | [Settings](settings.md) |

### P0 · theme none · No theme (13 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-093-a | Edit a file in a tab and save it. | [Files and browser](files-and-browser.md) |
| T-093-b | Markdown opens in a rich editor with source and preview views. | [Files and browser](files-and-browser.md) |
| T-093-c | A single-file diff tab shows inline or side by side changes. | [Files and browser](files-and-browser.md) |
| T-093-d | All Changes shows every changed file in one scrolling view. | [Files and browser](files-and-browser.md) |
| T-094-a | Browse files in an Explorer tree with mouse and keyboard. | [Files and browser](files-and-browser.md) |
| T-444 | The Explorer refreshes when the window regains focus. | [Files and browser](files-and-browser.md) |
| T-094-b | Create, rename and delete files and folders in the Explorer. | [Files and browser](files-and-browser.md) |
| T-094-b2 | Copy, paste and drag to move files in the Explorer. | [Files and browser](files-and-browser.md) |
| T-094-c | Quick Open finds a file by name with Mod+P. | [Files and browser](files-and-browser.md) |
| T-095-a | An Artifacts library page keeps pages and views them offline. | [Files and browser](files-and-browser.md) |
| T-095-b | Pages Claude publishes are kept in Kolux automatically. | [Files and browser](files-and-browser.md) |
| T-096-a | The Shortcuts page lists every command with its keys and flags clashes. | [Settings](settings.md) |
| T-096-b | Record, add, disable or reset any shortcut. | [Settings](settings.md) |
| T-097 | The kolux open command starts the app or brings it to the front. | [Command line](command-line.md) |

### P1 · theme 1 · Session-per-pane terminal grid (30 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-098 | Jump between workspaces from the keyboard or a worktree palette. | [Projects and worktrees](projects-and-worktrees.md) |
| T-099 | Refresh agents finds a fresh install; switch individual agents off. | [Settings](settings.md) |
| T-100-a | Shortcuts open a new agent tab, terminal or workspace composer. | [Terminals](terminals.md) |
| T-101-a | Set a default pane count; a full grid makes room for a new session. | [Terminals](terminals.md) |
| T-102-a | Drag panes to rearrange, close tabs in bulk and use the tab right-click menu. | [Terminals](terminals.md) |
| T-103-a | Terminals keep their scroll position when you switch views. | [Terminals](terminals.md) |
| T-104-a | Windows terminals pick the best shell and start with a clean environment. | [Terminals](terminals.md) |
| T-104-c | The default shell you chose is tried first, and the automatic shells wait behind it as fallbacks; a pane says in one dim line when the chosen shell did not start. | [Settings](settings.md#default-shell) |
| T-105 | The kolux terminal command lists, shows, creates, splits and renames terminals. | [Command line](command-line.md) |

### P1 · theme 2 · Isolation: one worktree per agent (36 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-106-a | Picking a linked worktree selects its main repository; branch names take a prefix. | [Projects and worktrees](projects-and-worktrees.md) |
| T-106-b | Check out an open pull request into a workspace. | [Projects and worktrees](projects-and-worktrees.md) |
| T-107-a | Worktrees made outside Kolux are noticed; show or hide individual ones. | [Projects and worktrees](projects-and-worktrees.md) |
| T-107-b | A project setup script runs when a workspace is created. | [Projects and worktrees](projects-and-worktrees.md) |
| T-107-c | Create a workspace straight from a GitHub issue or pull request. | [Projects and worktrees](projects-and-worktrees.md) |
| T-108-a | Kolux tells its own worktrees apart from external and scratch ones. | [Projects and worktrees](projects-and-worktrees.md) |
| T-108-b | Worktrees made by another tool are not shown by default, a documented gap. | [Projects and worktrees](projects-and-worktrees.md) |
| T-109-a | The new workspace composer picks the project and names from a branch or item. | [Projects and worktrees](projects-and-worktrees.md) |
| T-109-b | The composer suggests GitHub issues and pull requests. | [Projects and worktrees](projects-and-worktrees.md) |
| T-109-c | A failed worktree creation retries by policy; cancelling mid-way cleans up. | [Projects and worktrees](projects-and-worktrees.md) |
| T-110-a | Setup scripts get the workspace's folders as variables, .bat scripts run under Command Prompt, and a half-active conda environment is cleared. | [Projects and worktrees](projects-and-worktrees.md) |
| T-111-a | See a branch summary against its base branch. | [Projects and worktrees](projects-and-worktrees.md) |
| T-111-b | Shortcuts delete a workspace and rename a tab. | [Terminals](terminals.md) |
| T-111-c | The palette ranks results, filters by repository, creates worktrees and runs quick actions. | [Projects and worktrees](projects-and-worktrees.md) |
| T-112-a | Import setup scripts from other tools' configuration. | [Projects and worktrees](projects-and-worktrees.md) |
| T-113-a | A failed worktree scan never drops worktrees from the sidebar list. | [Projects and worktrees](projects-and-worktrees.md) |
| T-114 | Choose whether per-run worktrees run the project setup. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-115-a | Keep a per-workspace handoff note you can give to an agent. | [Projects and worktrees](projects-and-worktrees.md) |
| T-115-b | Search worktrees from the Mod+J palette. | [Projects and worktrees](projects-and-worktrees.md) |
| T-116-a | The Git and worktrees settings page sets branch names and source control defaults. | [Settings](settings.md) |
| T-116-c-a | Per-repository settings set the base branch and workspaces folder. | [Settings](settings.md) |
| T-117-a | Command-line selectors pick repos, worktrees and terminals, defaulting to the current folder. | [Command line](command-line.md) |
| T-117-b-a | kolux worktree set renames, links and comments on a worktree. | [Command line](command-line.md) |
| T-118 | kolux worktree changes and overlap show what a worktree touched and who else does. | [Command line](command-line.md) |

### P1 · theme 3 · Knowing what each agent is doing (57 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-119 | Name a pane or tab; a Needs you strip appears above the grid. | [Terminals](terminals.md) |
| T-119-b | Tab and pane titles follow the running program. | [Terminals](terminals.md) |
| T-120-a | Settings switch and kolux agent hooks commands control agent status hooks. | [Settings](settings.md) |
| T-120-b | Gemini CLI, Antigravity and Amp report their status through hooks Kolux installs, added to the same switch and to `kolux agent hooks status`. | [Settings](settings.md#hooks-for-gemini-cli-antigravity-and-amp) |
| T-123 | Status shows background work being watched, the question an agent is waiting on, and Interrupted for a stopped turn; /clear and compacting are not counted as finished work. | [Board, agents and inbox](board-agents-inbox.md) |
| T-123-c | Interrupted goes back to Working when the agent starts a new step after Esc or Ctrl+C. | [Board, agents and inbox](board-agents-inbox.md) |
| T-123-b | A Codex agent's reply text reaches its card from its finish report, as Claude Code's does. | [Board, agents and inbox](board-agents-inbox.md) |
| T-123-c-b | With Claude Code, a finish after Esc or Ctrl+C shows Done, not Interrupted. | [Board, agents and inbox](board-agents-inbox.md) |
| T-123-c-c | With Claude Code, Esc while a tool is finishing still settles Interrupted, not Working. | [Board, agents and inbox](board-agents-inbox.md) |
| T-124 | No recent update after 30 minutes without status; the terminal title stands in before hooks report; programs can report status in band. | [Board, agents and inbox](board-agents-inbox.md) |
| T-124-c | Approve and Deny on a card only for a permission the agent's hooks reported; "no status for" names how long since the last status. | [Board, agents and inbox](board-agents-inbox.md) |
| T-123-d | A waiting agent's card shows every question it asked, not only the first. | [Board, agents and inbox](board-agents-inbox.md) |
| T-127 | A Checks panel and pull request comments show in the sidebar. | [Projects and worktrees](projects-and-worktrees.md) |
| T-128-a | Kolux recognises which agent runs in each pane. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-129-a | kolux worktree ps sums up orchestration across worktrees. | [Command line](command-line.md) |
| T-129-b | List workers by state to see what can be cleaned up. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-129-c | Worker rows can read release_pending and release_unknown, and worker-show flags failure, interruption and stale. | [Command line](command-line.md#worker-commands) |
| T-130 | A Runs dashboard covers every automation. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-131 | Unsent plan-review comments are kept; very long plans are cut down. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-131-b | The plan sheet goes read-only once the plan is approved in the terminal. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-132 | Copy a selection with its path and line numbers; send review notes on a file. | [Files and browser](files-and-browser.md) |
| T-133 | The Notifications settings page picks which alerts and sounds. | [Settings](settings.md) |
| T-134-a | kolux terminal read and send read output and type into a terminal. | [Command line](command-line.md) |

### P1 · theme 4 · Accounts, sign-in and usage limits (21 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-135 | A warning appears before launching close to a usage limit. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-136-a | Alerts fire at 80% and 95% of a usage window. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-136-b | Usage analytics opens on a combined overview; token tracking is opt-in. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-136-c | The Stats and Usage page counts Kolux activity. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-136-d | Pull requests Kolux creates are counted in usage stats. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-137-a | Token panels for Claude and Codex show estimated cost from published prices. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-138 | The Claude accounts list manages the system default and other accounts safely. | [Settings](settings.md) |
| T-138-b | Label a personal and a business Codex workspace on one email. | [Settings](settings.md) |
| T-138-c | The Codex accounts list moves into Manage accounts beside Claude's. | [Settings](settings.md) |
| T-116-a-fix | Branch prefix and compare base settings moved into Settings. | [Settings](settings.md) |
| T-139-a | Choose a model per agent from built-in lists. | [Settings](settings.md) |
| T-139-b | A resumed session keeps its account; changing Codex account offers a restart. | [Settings](settings.md) |
| T-140 | A finished automation run keeps its last output, even when its terminal closes first, and shows its tokens and cost. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-141 | kolux account add and account list manage accounts from the command line. | [Command line](command-line.md) |

### P1 · theme 7 · Redesign and the new look (18 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-143 | The agent dropdown leads with three featured agents and searches the rest. | [Getting started](getting-started.md) |
| T-144-a | Resize panes by dragging dividers; narrow panes drop header items in order. | [Terminals](terminals.md) |
| T-144-b | Settings sets terminal font, size, line height and weights. | [Settings](settings.md) |
| T-144-e | Terminal text stays at 13 pt by default. | [Settings](settings.md) |
| T-144-d | Terminal font settings reach the terminal live. | [Settings](settings.md) |
| T-145-a | Terminals use Kolux dark colours by default and a light scheme in light mode. | [Settings](settings.md) |
| T-145-b | Terminal colour answers to programs are measured and match what programs ask. | [Terminals](terminals.md) |
| T-146-a | The right sidebar opens, closes, resizes and remembers its tab. | [Getting started](getting-started.md) |
| T-146-b | The right sidebar's Checks tab, a More menu for tabs that do not fit, and Try again when a panel breaks. | [Projects and worktrees](projects-and-worktrees.md) |
| T-146-c | Settings sets a different theme per screen under Appearance, Mode. | [Settings](settings.md) |
| T-146-f | Escape inside a text field never leaves a full page. | [Getting started](getting-started.md) |
| T-147 | The status bar can be shown, hidden and its items chosen. | [Settings](settings.md) |
| T-148-a | Pick terminal colour schemes for dark and light from a searchable catalogue. | [Settings](settings.md) |
| T-148-b | The Appearance page has three foldable sections plus app and editor fonts. | [Settings](settings.md) |
| T-148-c | Show or hide the title, toolbar buttons and status bar items. | [Settings](settings.md) |
| T-148-d | Set divider colour and width; panes out of focus can dim. | [Settings](settings.md) |

### P1 · theme 5 · Safety and trust (37 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-151 | Approve or Deny from the agent pane header; pin tabs; removing a running session asks; multi-line pastes wait for Enter. | [Terminals](terminals.md) |
| T-151-b | Approve and Deny hide once you have answered; pasting several lines into a program that runs each line as it arrives asks "Paste N lines?" first. | [Terminals](terminals.md) |
| T-152 | Hooks go only to agents that are installed and switched on, without damaging their config. | [Settings](settings.md) |
| T-152-b | The first real hook install was proven safe against the current settings. | [Safety](safety.md) |
| T-152-c | Hook installs keep a previous status line and detect later edits. | [Safety](safety.md) |
| T-152-gate | Hooks install only when the agent status hooks switch is on. | [Settings](settings.md) |
| T-153-a | Discard changes with confirmation; confirmation prompts take Enter and Escape. | [Safety](safety.md) |
| T-153-b | Delete, reveal or open a past session's files. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-154-a | A key that can no longer be unsealed is cleared with a reconnect hint. | [Safety](safety.md) |
| T-154-b | The app window can read only files it was given access to. | [Safety](safety.md) |
| T-154-c | Explorer and Source Control file changes stay within granted folders. | [Safety](safety.md) |
| T-155-a | Abandon a worker's dispatch without touching processes or files. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-157 | Stored secrets stay sealed by the system keyring, with no plain-text fallback. | [Safety](safety.md) |
| T-160 | Command typos are caught before the app is contacted, with safe suggestions. | [Command line](command-line.md) |

### P1 · theme 9 · Reliability and no lost work (93 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-164 | Reopen a closed tab; large pastes stay responsive; scroll position is kept. | [Terminals](terminals.md) |
| T-165 | A terminal host crash is contained; errors are in plain words. | [Troubleshooting](troubleshooting.md) |
| T-166 | Terminals recover after sleep, wake and window focus changes. | [Troubleshooting](troubleshooting.md) |
| T-167-a | Status hooks stay harmless outside Kolux and catch up after a restart. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-170 | Usage log scans count each Claude turn and Codex event once. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-170-b | Automation runs look up how much their own worktree's session used. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-171 | Connection status stays current without constant polling. | [Settings](settings.md) |
| T-171-b | Check again on a connection card re-reads the program path. | [Settings](settings.md) |
| T-339 | Accounts page cleanup: one confirm dialog and one switch per notification kind. | [Settings](settings.md) |
| T-172-a | Waiting mail outlives a restart without repeating keystrokes. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-172-b | Waiting mail survives restart without typing its pointer twice. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-172-c | Release leaves open a terminal that is not the worker's own, and a worker start that does not come up lists what is left over and how to clean up. | [Command line](command-line.md#worker-commands) |
| T-173-a | Retrying a command after a timeout never does the work twice. | [Command line](command-line.md) |
| T-173-b | The orchestration store is limited to your user and upgrades safely. | [Safety](safety.md) |
| T-174-a | The command line reaches the open app through a local channel. | [Command line](command-line.md) |
| T-175 | Runs missed while Kolux was away get a grace window; history keeps 100 runs. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-176-a | Pull request status stays current without flooding GitHub, and outages are visible. | [Projects and worktrees](projects-and-worktrees.md) |
| T-176-b | The shown workspace's pull request refreshes itself with backoff. | [Projects and worktrees](projects-and-worktrees.md) |
| T-176-c | Pull requests for background workspaces are polled per repository. | [Projects and worktrees](projects-and-worktrees.md) |
| T-184 | Closing a terminal or the app leaves no orphaned processes. | [Terminals](terminals.md) |
| T-185-a | On Windows the kolux command works through a shim and launcher. | [Command line](command-line.md) |
| T-185-b | kolux terminal close ends a terminal. | [Command line](command-line.md) |

### P1 · theme 11 · Orchestration and automations (47 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-186-a | Nest a new workspace under a parent and change a workspace's parent. | [Projects and worktrees](projects-and-worktrees.md) |
| T-187-a | Save a lineup of agents as a shape or team and reuse it. | [Getting started](getting-started.md) |
| T-189-a | Automations and Skills pages open; ask an agent to fix things from Source Control. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-190-a | Group addresses send one message to several agents; delivered mail reads clearly. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-190-b | Decision gates hold a task until a person resolves them. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-191-a | Reset orchestration state by scope; start Claude Agent Teams in a terminal. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-192-a | Automation schedules use a self-checking cron field and an AM/PM time picker. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-192-b | An optional precheck command runs ahead of timed and event runs. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-193-a | Automations list and detail work from the keyboard with a collapsible overview. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-194 | Worktree changes and overlap are available from the command line. | [Command line](command-line.md) |
| T-196 | Kolux nudges you when an installed skill falls behind and can update it. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-197-a | The command line gives JSON output, structured errors and exit codes. | [Command line](command-line.md) |
| T-197-b | Prechecks and skipped runs are settable from the command line. | [Command line](command-line.md) |
| T-198-a | Command-line decision gates and a machine-readable map of the CLI. | [Command line](command-line.md) |

### P1 · theme 6 · Business-user frame (33 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-200 | Add Project opens on cloning, with browse and create one step away. | [Getting started](getting-started.md) |
| T-201-a | Featured agent cards show what is missing and how to set it up. | [Getting started](getting-started.md) |
| T-201-b | Removed 2026-10-28 (T-568): the chooser no longer offers starter kits or an Advanced section. | [Getting started](getting-started.md) |
| T-201-c | Every supported agent has a checked documentation link. | [Getting started](getting-started.md) |
| T-202 | Disconnect removes only what Kolux made. | [Settings](settings.md) |
| T-203 | Turn a plain folder into a Git repository. | [Getting started](getting-started.md) |
| T-204 | Removed 2026-10-28 (T-568): the starter kits and their gallery are gone. | [Getting started](getting-started.md) |
| T-205 | Removed 2026-10-28 (T-568): kits no longer exist, so nothing starts one. | [Getting started](getting-started.md) |
| T-206 | Removed 2026-10-28 (T-568): kit roles and their result files are gone. | [Getting started](getting-started.md) |
| T-206-b | Removed 2026-10-28 (T-568): kit rows are gone; a usage limit or sign-in stop shows on the pane and the Board instead. | [Getting started](getting-started.md) |
| T-207 | A four-screen guided first run floats over the app. | [Getting started](getting-started.md) |
| T-207-b | The first AI connected during the wizard is recorded as a milestone. | [Getting started](getting-started.md) |
| T-207-c | The first-connection milestone is also recorded from the wizard's Connect cards. | [Getting started](getting-started.md) |
| T-208 | Leaving the wizard asks first and says how to return. | [Getting started](getting-started.md) |
| T-209-a | Newcomer screens use plain words, checked against jargon. | [Getting started](getting-started.md) |
| T-209-b | The wizard and folder-without-Git dialog follow the plain-words rules. | [Getting started](getting-started.md) |
| T-210-a | Choose the interface language, falling back to English. | [Settings](settings.md) |
| T-211 | The landing screen warns about missing or signed-out tools. | [Getting started](getting-started.md) |

### P1 · theme none · No theme (171 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-214-a | Clone a repository from a URL or start a new empty project. | [Getting started](getting-started.md) |
| T-215-a | kolux project list works; project groups organise projects. | [Command line](command-line.md) |
| T-216-a | Pin workspaces to a section; sort by recent activity. | [Projects and worktrees](projects-and-worktrees.md) |
| T-217-a | Put a workspace to sleep and rename it inline. | [Projects and worktrees](projects-and-worktrees.md) |
| T-224-a | A Tasks page button and shortcut; find pull requests and checks from the palette. | [Projects and worktrees](projects-and-worktrees.md) |
| T-227-a | Commit with push, sync or force push; hand a failed push to an agent. | [Projects and worktrees](projects-and-worktrees.md) |
| T-227-b | The branch row compares the workspace with its base branch. | [Projects and worktrees](projects-and-worktrees.md) |
| T-227-c | An AI writes the commit message from what is staged. | [Projects and worktrees](projects-and-worktrees.md) |
| T-228-a | Choose who writes commit messages and branch names. | [Settings](settings.md) |
| T-228-b | Pick the agent, model and effort that writes commit messages. | [Settings](settings.md) |
| T-228-c | Commit message writer settings extend to custom prompts or commands. | [Settings](settings.md) |
| T-229-a | An AI drafts the pull request title and description. | [Projects and worktrees](projects-and-worktrees.md) |
| T-229-b | Pull request links printed by an agent are recognised. | [Projects and worktrees](projects-and-worktrees.md) |
| T-229-c | A Checks panel shows CI results beside the drafted pull request. | [Projects and worktrees](projects-and-worktrees.md) |
| T-230-a | Send review comments to the agent; PR merge conflicts get an AI explanation. | [Projects and worktrees](projects-and-worktrees.md) |
| T-230-b | Review comments and merge conflict help work for background pull requests. | [Projects and worktrees](projects-and-worktrees.md) |
| T-230-c | Review comments are read from the pull request and sent to the agent. | [Projects and worktrees](projects-and-worktrees.md) |
| T-231-a | Review notes on Markdown documents; the Tasks page lists GitHub issues and PRs. | [Projects and worktrees](projects-and-worktrees.md) |
| T-231-b | The Tasks page offers presets, search and repository choice. | [Projects and worktrees](projects-and-worktrees.md) |
| T-232-a | Preview an issue or PR, open the full PR page, and review its files. | [Projects and worktrees](projects-and-worktrees.md) |
| T-232-b | Issue and PR preview and the full PR page are completed. | [Projects and worktrees](projects-and-worktrees.md) |
| T-233-a | The Git and worktrees settings page is available. | [Settings](settings.md) |
| T-233-b | Order the Source Control groups on the Git and worktrees page. | [Settings](settings.md) |
| T-233-c | The GitHub API budget is shown on the Git and worktrees page. | [Settings](settings.md) |
| T-221 | Drop files onto a terminal, let programs copy to the clipboard, clear the screen (Ctrl+K), find text in a pane (Ctrl+F) and keep shell keys such as Ctrl+R for the shell. | [Terminals](terminals.md) |
| T-222 | Shift+Enter makes a new line in Claude and Codex, typing in Korean, Chinese and Japanese is sent once finished, and web links and file paths in output open with Ctrl+click. | [Terminals](terminals.md) |
| T-243 | A Skills page lists every skill your AIs can see, from a sidebar button that is off until you turn it on in Settings. | [Getting started](getting-started.md) |
| T-243-c | The Skills scan never follows a link or junction to a network share, and a workspace on a share gets no skills scan (a mapped drive letter still does). | [Safety](safety.md#other-computers-and-network-shares) |
| T-244 | A Getting Started guide with a progress ring, an Enable Kolux CLI step, an Explore Kolux walk and startup tips. | [Getting started](getting-started.md) |
| T-244-c | The Enable Kolux CLI check no longer freezes the window: a PATH folder that does not answer within a second is passed over, and one on another computer is never looked up. | [Getting started](getting-started.md) |
| T-245 | Contextual tours: small callouts with Back, Next, Skip and Done that show once and can be replayed from the Help menu. | [Getting started](getting-started.md) |
| T-246 | Search every setting at once, open or reload the keybindings file, choose Kolux first or Terminal first for shortcuts, and zoom the whole interface. | [Settings](settings.md#search-all-settings) |
| T-247 | The Terminal settings cover text, cursor, scrolling, clipboard and the Windows default shell; a Confirmations card brings skipped questions back. | [Settings](settings.md#terminal-text-and-cursor) |
| T-248-a | A standard menu (File, Edit, View, Window, Help) opens from the Kolux mark in the top bar and shows your shortcuts as hints. | [Getting started](getting-started.md) |
| T-250-a | Help on every command level, plus a version flag, in the command line. | [Command line](command-line.md) |

### P2 · theme 3 · Knowing what each agent is doing (7 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-260 | The Floor shows each agent's working, waiting and idle time on a timeline; on a Mac, the first start asks for notification permission. | [Board, Agents and Inbox](board-agents-inbox.md) |

### P2 · theme 4 · Accounts, sign-in and usage limits (9 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-262 | Agents can ask Kolux for the list of open terminal tabs; the command line's own lists move onto it later. | internal |
| T-262-c | `kolux terminal show` and `list` now give a plain shell pane its start folder and program instead of nothing. | [Command line](command-line.md#panes) |
| T-263 | Share a usage card as a picture; reset times count down live. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-265 | An optional prompt-cache countdown shows once a Claude agent goes idle. | [Board, Agents and Inbox](board-agents-inbox.md) |

### P2 · theme 7 · Redesign and the new look (10 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-269 | A browser tab's address box folds up in a narrow pane, and a loading page shows the app's colour instead of a white flash. | [Files and browser](files-and-browser.md) |

### P2 · theme 5 · Safety and trust (3 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-287-c | `kolux diagnostics memory` shows a dash, and says how many could not be read, when a committed figure is incomplete. | [Command line](command-line.md) |

### P2 · theme 9 · Reliability and no lost work (30 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-273 | Kolux finds Claude's saved sessions for each workspace on Windows (no screen lists them yet). | internal |
| T-277 | Resource Manager lists terminals picked up after a reload. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-278 | Fast output never freezes a pane; memory caps scale with the machine. | [Troubleshooting](troubleshooting.md) |
| T-278-c | Big pastes arrive whole and in order without slowing other panes; Ctrl+C or Esc stops one. | [Terminals](terminals.md) |
| T-278-d | Control characters inside a paste are removed, so pasted text cannot run on its own. | [Terminals](terminals.md) |
| T-279 | A task that fails three times running is no longer handed to agents, and a terminal still busy with a task is not given another. | internal |
| T-279-c | A task that failed three times lists as held; a reset action exists in the app but no command or button reaches it yet. | [Command line](command-line.md#held-tasks) |
| T-280 | Saved settings come back valid after a restart. | [Settings](settings.md) |
| T-284 | An interrupted skill delete is undone or finished on restart. | [Troubleshooting](troubleshooting.md) |
| T-286 | Startup failures and stray background errors never silently kill the app. | [Troubleshooting](troubleshooting.md) |
| T-287 | `kolux diagnostics memory` shows resident and committed memory for Kolux, each session and the total. | [Command line](command-line.md) |
| T-287-b | The Resource Manager shows committed memory beside resident. | [Command line](command-line.md) |
| T-441 | Kolux settings cannot be wiped by a failed read. | [Safety](safety.md) |
| T-441-b | A settings change never starts from an empty set. | [Safety](safety.md) |
| T-441-c | Trust file writes keep what the caller read; further data-loss fixes. | [Safety](safety.md) |
| T-442 | Typing never waits behind git. | [Terminals](terminals.md) |
| T-442-b | Workspace creation and opening no longer block typing. | [Terminals](terminals.md) |
| T-442-c | File reads, writes and listings run off the window thread. | [Terminals](terminals.md) |
| T-443 | Only worktrees Kolux created are pre-trusted. | [Safety](safety.md) |

### P2 · theme 11 · Orchestration and automations (8 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-288 | A workspace made from a linked issue runs the project's issue command with the issue number filled in; a committed or linked override file never counts as your own. | [Projects and worktrees](projects-and-worktrees.md) |
| T-289 | Copy session, terminal and pane IDs; links point to other terminals and tasks. | [Terminals](terminals.md) |
| T-290 | Kolux checks whether each agent has the orchestration skill. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-291-a | An Automations row in the sidebar, off by default; hide automation worktrees. | [Projects and worktrees](projects-and-worktrees.md) |
| T-291-b | The View menu toggles the Automations row and hides automation worktrees. | [Projects and worktrees](projects-and-worktrees.md) |
| T-291-c | An Automation tag appears on workspace cards. | [Projects and worktrees](projects-and-worktrees.md) |
| T-292 | A skill freshness pill and status bar note show running skill updates. | [Board, Agents and Inbox](board-agents-inbox.md) |
| T-347 | Panes stop inheriting the old app's data-path setting. | [Safety](safety.md) |

### P2 · theme 6 · Business-user frame (6 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-298 | Reopen the wizard from the sidebar help menu; first successes are recorded locally. | [Getting started](getting-started.md) |

| T-546 | The Tower: every agent on one full-width screen, needs-you first, one click to its pane, usage per program across the top. | [Board, Agents and Inbox](board-agents-inbox.md) |

### P2 · theme none · No theme (110 cards)

| Task | Feature | Guide page |
|---|---|---|
| T-313 | Pull offers Merge, Rebase or Fast-forward only when Git has no pull policy; changed submodules show as single rows; filter the changes and right-click a file to copy its path, open it in its app or show it in the file manager (which never leaves the workspace). | [Projects and worktrees](projects-and-worktrees.md) |
| T-314-a | The Tasks page can open on a default preset, has pickers to filter by state, author, assignee, label and reviewer, and lets a fork list issues from its upstream project. | [Projects and worktrees](projects-and-worktrees.md) |
| T-238 | Find on a page (Ctrl+F), a separate zoom for each browser tab, and links a page opens in a new window become Kolux browser tabs (middle-click or Ctrl-click opens one behind). | [Files and browser](files-and-browser.md#find-zoom-and-the-site-icon) |
| T-272 | Pages cannot flood you with tabs: 5 new tabs per 10 seconds, the rest dropped quietly. | [Files and browser](files-and-browser.md#links-that-open-new-tabs) |
| Browser FIX-1 | One shared tab allowance for link opens and new windows; site-icon fetches are capped and every redirect is checked, so a public page cannot make Kolux fetch from your own machine or network. | [Safety](safety.md#browser-tabs-what-pages-may-do) |
| T-319 | A browser tab's toolbar shows the site's own icon in place of the globe (the tab strip does not yet). | [Files and browser](files-and-browser.md#find-zoom-and-the-site-icon) |
| T-323 | Bring in terminal colour schemes from Warp and Ghostty; Editor and diffs, Open in and Network proxy cards on the General page (saved, not yet used by the editor, menus or network); the mouse wheel scrolls long menus and pickers. | [Settings](settings.md#editor-and-diffs) |
| T-325 | The Agents page shows a Claude Code, OpenClaude or Codex session as a live chat with each message once and in order. | [Board, Agents and Inbox](board-agents-inbox.md#chat-on-the-agents-page) |
| T-326 | Chat folds the agent's work: Thought rows, steps, file edits as diff cards, a subagent row and busy timers. | [Board, Agents and Inbox](board-agents-inbox.md#chat-on-the-agents-page) |
| T-327 | A chat message box that types into the agent's terminal and follows the newest message; it holds a send while the agent is asking, and Request changes on a plan waits until the agent leaves its menu. | [Board, Agents and Inbox](board-agents-inbox.md#chat-on-the-agents-page) |
<!-- generated from PLAN.md at 950ba36 -->
