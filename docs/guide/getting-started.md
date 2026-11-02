# Getting started

Use this page to finish first-run setup, find your way around the window, add a project and start your first agent.

## First launch

On a fresh install Kolux opens a four-step dialog, "Get started with Kolux". Each step has a main button on the right. Ctrl+Enter presses it. A Back button appears from step 2 on. Closing the dialog asks "Skip setup?".

| Step | What you do | Main button |
|---|---|---|
| 1. Welcome | Read the idea: several AIs can work on your files at the same time | Get started |
| 2. Connect an AI | Link at least one AI. The main button stays off until one is connected | Continue (or "I'll do this later") |
| 3. Your work | Pick the folder your AIs will work in (a "Pick a folder" button) | Continue |
| 4. Open a session | Start with an AI or a plain terminal in your folder. A switch, "Tell me whenever an AI finishes", turns on notifications | Open a session |

Earlier builds had a "Choose a kit" fourth step and starter kits; they were removed on 2026-10-28.

You can reopen the dialog later: click the "?" (Help) button at the bottom of the sidebar, then Onboarding.

## The Getting Started guide

Click the Help button and choose "Getting Started with Kolux". It is a checklist dialog, separate from the first-run dialog above. The "x" closes it, and so does Escape.

- **Left side:** a progress ring with "N of 6 done", then the steps in two groups. Under "Setup": Turn on notifications, Choose a default agent, Enable Kolux CLI, Use Kolux's browser (optional) and Connect integrations (optional). Under "Parallel work": Multi-task, Automate workspace setup and Start work in multiple repos. The six steps that are not optional fill the ring. Click a step to read what it is for. The small eye-off button removes the checklist from the sidebar.
- **Right side:** the step's name and a line about why it matters.

Only the Enable Kolux CLI step ticks by itself today. The other steps are explained but stay unticked.

The Enable Kolux CLI step lists three things and marks each "Ready" or "Not set up": "Kolux CLI" (the `kolux` command in terminals outside Kolux), "Kolux CLI skill" and "Orchestration skill". A "Re-check" button reads the state again. The check for the `kolux` command looks through your `PATH` (the list of folders Windows searches for commands) without holding up the window: a folder that does not answer within a second, such as one on an offline drive, is passed over, and a folder on another computer is never looked up (see [Other computers and network shares](safety.md#other-computers-and-network-shares)). The step says Kolux cannot run this setup for you yet; it arrives with the installer in a coming build. See [Command line](command-line.md) for what the command does.

The Help menu has more entries:

| Entry | What it opens |
|---|---|
| Explore Kolux | A short walk through five workflows: Workspaces, Tasks, Agents, Workbench and Review. Continue (or Ctrl+Enter) moves on; the last stop says Done. A workflow shows "Completed" once you have seen its required stops |
| Milestones | The same guide, with its ring. It shows only while a required step is open |
| Tours | One entry per tour: Tasks, Automations and Agents in parallel. See below |

### Tips

At most one tip appears per launch, as a small dialog marked "Tip". It never appears in a launch that showed the first-run dialog, and each tip appears only once. The first is "Let your agents drive Kolux", with the buttons "Not now" and "Install CLI & Skills" (which opens the Enable Kolux CLI step). It is skipped if the command is already set up. If the command is installed but terminals outside Kolux cannot find it, the tip adds "Needs attention". The second is "Jump to any workspace with" the workspace-switcher key, with a "Got it" button.

### Tours

A tour is a small callout beside a part of the window. It shows a title, a sentence, and these buttons: Skip, Back (from the second callout on), and Next (Done on the last one). Several-step tours show a count such as "2 of 3". Escape also skips.

| Tour | Points at |
|---|---|
| Tasks | A row, the Preset picker and the search box on the Tasks page |
| Automations | The create button and the button for every run's results on the Automations page |
| Agents in parallel | The Split button on the focused terminal pane, then the New workspace button |

A tour starts by itself once, the first time its screen is showing, and only on a profile where the first-run dialog showed. An older profile never gets automatic tours. Only one tour starts by itself per launch. Skip or Done marks it seen. Under Tours in the Help menu you can replay any tour, seen or not. The replay waits until its screen is showing. The Agents in parallel tour does not start by itself if you have already split a pane. Its first callout has a "Split terminal" button in place of Next.

## The Skills page

A skill is a folder with a `SKILL.md` file that teaches an AI how to do a job. The Skills page lists every skill the AIs on your computer can see. Turn on the sidebar button first: Settings, Appearance, Window & Sidebar, "Show Skills button in the sidebar" (off by default). Click the "Skills" button in the sidebar to open the page. Click it again, press Escape, or use the x to go back to the screen you were on. Right-click the button and choose "Hide Skills button" to remove it.

| Part | What it does |
|---|---|
| Heading | "Skills" and a count, such as "12 skills" |
| Search skills | Every word you type must appear in a skill's name, description or path. Up to 200 characters |
| Filter by agent | All agents, Claude Code, Codex, Grok, Hermes or Shared skills folder |
| Source chips | Home, Workspace, Bundled and Plugin, each with a count. Press one to show only that source |
| Clear filters | Appears when a search, agent or chip is set |
| Skill folders | Lists each folder Kolux scanned and what it found, such as "3 skills" or "Not found" |
| Refresh | Scans every folder again |

Each row shows the skill's name, where it came from (a plugin shows "Plugin: name"), its last-changed date, its description and its path. Skills built into Kolux say "Built into Kolux". The "Delete skills" item in the "..." menu is greyed out for now. If a folder cannot be read the page says "Scan failed" with a Retry button, rather than showing a shorter list. Skills inside WSL (Linux on Windows) folders are not scanned yet; the Skill folders list says "Not scanned: WSL folders are not scanned yet". Kolux also never scans through a network share: a workspace on `\\server\share` gets no workspace skills scan, a mapped drive letter does, and a link inside a skills folder that leads to another computer is not followed. See [Other computers and network shares](safety.md#other-computers-and-network-shares).

When you have never picked a view, Kolux opens on Terminals. After that it opens on the view you were on when you quit.

A fresh start has no terminal pane yet. The Terminals view says "No terminal open here" and offers two buttons: Open a shell, and Choose what to run.

## The top bar

The bar across the top is 36 pixels tall and replaces the Windows title bar. Drag any empty part of it to move the window. Left to right:

| Control | What it does |
|---|---|
| Kolux mark | Opens the Kolux menu (File, Edit, View, Window, Help). See the next section |
| Menu (dots) | Opens a "View" menu with Zoom In, Zoom Out and Reset Size. They act on the focused terminal |
| Sidebar button | Hides or shows the project sidebar (Ctrl+B) |
| Back / Forward | Return to the last workspace or page you were on, and go forward again (Ctrl+Alt+Left, Ctrl+Alt+Right) |
| Screen switcher | Four buttons: Agents, Board, Terminals, Tower. See the next section |
| Right-panel button | Shows or hides the right panel, which holds Source Control. Hidden while a full page is open |
| Search box | Jump to a worktree, tab, project or setting (Ctrl+Shift+J) |
| Bell | Opens the Inbox. Press it again to return to Terminals |
| Usage pill | Shows how much of your weekly AI allowance is left, for example "Claude 80% left". Click it to open Settings at Accounts & keys. Hover for the reset time |
| Minimize, Maximize, Close | The usual window controls |

The usage pill turns to a warning tint at 70% used and a danger tint above 90%. A Codex pill shows only when Codex is installed and you have added at least one Codex account. It reads "Codex N% left", or "Codex · sign in again" when its sign-in has lapsed. A pill shows only for an AI program that is installed and reports a weekly figure.

In the Classic look (Settings, Appearance) the screen switcher is absent and the window stays on Terminals.

Press Escape to leave a full page such as the Inbox.

### The Kolux menu

Click the Kolux mark at the left end of the top bar (its tooltip says "Kolux menu"). A menu opens under it with the usual menu names. The window has no menu bar across the top, so this is where they live. Where a command has a keyboard shortcut, the menu shows it as a hint, and it follows any shortcut you change on the Shortcuts page.

| Menu | What is in it |
|---|---|
| File | **Settings...** opens Settings (Ctrl+, by default). **Exit** closes the window the way its close button does, which stops every terminal |
| Edit | Undo, Redo, Cut, Copy, Paste, Select All. In a text box they act on the text. In a terminal pane only **Copy** (the selected text; nothing is copied when nothing is selected) and **Select All** work; Undo, Redo and Cut do nothing there. **Paste** does nothing yet from this menu: use Ctrl+V |
| View | **Workspace View** has Agents, Board and Terminals with the current screen ticked (absent in the Classic look). **Appearance** has Toggle Left Sidebar, Toggle Right Sidebar and four ticks: Show Status Bar, Show Tasks Button, Show Automations Button and Show Titlebar App Name. Each tick matches its switch in [Settings](settings.md) and changes it. Then come Reload, Force Reload (Ctrl+Shift+R), Toggle Developer Tools (does nothing in the released app), Actual Size, Zoom In, Zoom Out and Toggle Full Screen |
| Window | Minimize, and Zoom (which maximizes the window) |
| Help | **About Kolux** shows the version. The other Help items (Report Crash, Explore Kolux, Getting Started, Check for Updates) are not in the menu yet |

The menu's Zoom In, Zoom Out and Actual Size change the whole interface size, the same one as "Zoom: Interface size" in Settings, Appearance. The dots menu described above, in contrast, acts on the focused terminal.

## The views

Use the screen switcher in the middle of the top bar.

| View | Use it to |
|---|---|
| Agents | See one list of sessions grouped by agent, with the picked session beside it. See [Board, Agents and Inbox](board-agents-inbox.md) |
| Board | See every session as a card in a lane: Needs you, Working, Done, Stopped, Idle. Approve or deny from the card |
| Terminals | Work in the pane grid. The project sidebar shows only here (and on the Artifacts page). See [Terminals](terminals.md) |
| Tower | See every agent at a glance on one full-width screen, the ones that need you first, with usage per AI provider across the top. One click opens a pane. See [Board, Agents and Inbox](board-agents-inbox.md) |

The Board, Agents and Tower views list sessions from every workspace at once. The Terminals view shows the panes of one workspace.

## Add a project

A project is a Git repository (a folder whose history Git tracks). In the sidebar, click the folder-plus button in the "Projects" header: "Add project". A dialog offers three choices. Arrow keys move between them, Enter takes one, Escape closes.

| Choice | What happens |
|---|---|
| Copy from a web address | Clones a repository. Type the web address (for example `https://github.com/owner/project.git`). The Folder field fills itself; change it if you like. Press Copy. A Cancel button stops a copy in progress |
| Open a folder… | Opens a folder picker for a project already on disk |
| New project | Type a Name and a "Goes in" folder, then press Create |

More detail is in [Projects and worktrees](projects-and-worktrees.md).

## Start your first agent

1. In the sidebar, press "New session" at the bottom. It starts an agent in a new pane, inside a fresh workspace (a branch in its own folder).
2. A menu lists the AI programs Kolux found on your computer. Claude Code, Codex and Grok lead; others sit behind "Show more agents". Pick one.
3. The pane opens and the agent starts. Type your request in the pane.
4. Watch its status word in the pane header (Working, Needs you, Done). Press the bell to see every session that needs you.

Other ways in: press Ctrl+T for a plain shell, or use "New tab" and "Choose agent…" to pick the AI, model and number of sessions before anything starts.

<!-- verified against: src/onboarding/Wizard.tsx, src/chrome/TopBar.tsx, src/usage/meter.ts, src/usage/ClaudePill.tsx, src/usage/CodexPill.tsx, src/settings/general.ts, src/projects/AddProject.tsx, src/projects/ProjectsPanel.tsx, src/launch/PlusMenu.tsx, src/keys/actions.ts, src/onboarding/Guides.tsx, src/onboarding/HelpMenu.tsx, src/onboarding/Tours.tsx, src/onboarding/guide.ts, src/onboarding/tour.ts, src-tauri/src/onboarding.rs, src/skills/SkillsPage.tsx, src/skills/skills.ts, src/skills/nav.ts, src/projects/SkillsRow.tsx, src/projects/HideableRow.tsx, src/chrome/chromeItems.ts, src-tauri/src/skills.rs, src-tauri/src/menu.rs, src/chrome/useChrome.ts at 73f5e38 -->
