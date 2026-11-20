# Getting started

Use this page to finish first-run setup, find your way around the window, add a project and start your first agent.

## First launch

On a fresh install Kolux opens a four-step dialog, "Get started with Kolux". Each step has a main button on the right. Ctrl+Enter presses it. A Back button appears from step 2 on. Closing the dialog asks "Skip setup?".

| Step | What you do | Main button |
|---|---|---|
| 1. Welcome | Read the idea: several AIs can work on your files at the same time | Get started |
| 2. Connect an AI | Link at least one AI. The main button stays off until one is connected. Under the AI cards is one line, "Kolux will add its status hooks to each AI's settings, so it can show you which one needs you.", beside a switch that is on. Continue records the switch as your answer; Back does not. "I'll do this later" moves on without answering it, so nothing is installed and the line comes back later (in setup or as the one-time card) | Continue (or "I'll do this later") |
| 3. Your work | Pick a folder: Add Project opens, and setup comes back on its last step once the folder is added. Adding the folder starts nothing by itself, whether you chose a default agent or Default agent is Auto; the last step chooses what opens. Continue stays off until a project folder exists ("Pick a folder to continue, or skip this for now."). "Skip for now" leaves setup; Help > Onboarding brings it back | Continue |
| 4. Start your agents | A switch, "Tell me whenever an AI finishes", turns on notifications. There is one main button, "Choose folders and agents". It finishes setup and opens the Start form, the one question Kolux asks: which folders, how many agents, and which AI, model and effort. The folder in front is already ticked. With no AI installed the screen says so, and the form offers a plain terminal | Choose folders and agents |

You can reopen the dialog later: click the "?" (Help) button at the bottom of the sidebar, then Onboarding.

## The Getting Started guide

Click the Help button and choose "Getting Started with Kolux". It is a checklist dialog, separate from the first-run dialog above. The "x" closes it, and so does Escape.

- **Left side:** a progress ring with "N of 4 done", then the steps in two groups. Under "Setup": Turn on notifications and Choose a default agent. Under "Parallel work": Multi-task and Start work in multiple repos. Click a step to read what it is for. The checklist removes itself from the sidebar as soon as its item is done; the small eye-off button hides it sooner.
- **Right side:** the step's name and a line about why it matters.

Every step ticks by itself from what Kolux can see, so you never tick one by hand. Turn on notifications ticks when notifications are on. Choose a default agent ticks when the default is an AI agent (a plain terminal does not count). Multi-task ticks once an agent works in a folder of its own beside the project folder (Own folder for each agent, on by default, gives each agent you launch one). Start work in multiple repos ticks when two Git projects have been added. A profile that finished the older setup, or hid the sidebar checklist, shows every step done.

The Help button's menu lists Settings, then Getting Started with Kolux, Explore Kolux, Docs, Changelog, GitHub, Milestones (only while a step is open), Onboarding, Send Feedback, Report Crash, Copy terminal diagnostics, Check for Updates and Restart Kolux, followed by a Tours group. Docs, Changelog and GitHub open in your browser. Onboarding reopens the first-run dialog. Three of the entries open something described below:

| Entry | What it opens |
|---|---|
| Explore Kolux | A short walk through four workflows: Projects, Agents, Workbench and Review. Continue (or Ctrl+Enter) moves on; the last stop says Done. A stop is complete once you have visited it, and a workflow shows "Completed" once you have seen its required stops |
| Milestones | The same guide, with its ring. It shows only while a step is open |
| Tours | The Agents in parallel tour. See below |

### Tips

At most one tip appears per launch, as a small dialog marked "Tip". It never appears in a launch that showed the first-run dialog, and each tip appears only once. The tip is "Jump to any workspace with" the workspace-switcher key, with a "Got it" button. A launch that shows the one-time status-hooks card (the line from step 2, for a profile that never answered it) shows no tip. The card's Done button records the switch, Turn off records no, and Not now closes it without answering, so it asks again at the next launch. Escape closes a tip from wherever the keyboard is, even a terminal pane; the press still reaches that pane's program (in Claude Code it also interrupts Claude), and while a dialog is open Escape belongs to the dialog instead.

### Tours

A tour is a small callout beside a part of the window. It shows a title, a sentence, and these buttons: Skip, Back (from the second callout on), and Next (Done on the last one). Several-step tours show a count such as "2 of 2". Escape also skips.

| Tour | Points at |
|---|---|
| Agents in parallel | The Split button on the focused terminal pane, then the folder's status dot in the sidebar (one dot per folder; each agent's own state is on its pane's top bar) |

The tour starts by itself once, the first time a project's terminal is in front, and only on a profile where the first-run dialog showed. An older profile never gets it by itself, and it does not start by itself if you have already split a pane. Skip or Done marks it seen. Under Tours in the Help menu you can replay it, seen or not; the replay waits until a terminal pane is showing. Its first callout has a "Split terminal" button in place of Next.

## When Kolux starts

Kolux opens on the Terminals screen, its one screen.

A fresh start has no terminal pane yet. The Terminals screen says "Nothing running here yet." and offers two buttons: Start agents, which opens the Start form, and Open a terminal, which opens a plain shell in the project folder.

Each time Kolux starts, its first window opens the Start form once. Kolux does not reopen tabs between runs, but the Folders list keeps your folders, and the form asks which folders to open, how many agents and which AI. "Not now" or Escape closes it and leaves the window empty. The switch "Ask what to open when Kolux starts" in Settings, General turns the form off; Kolux then starts with an empty window.

Claude Code starts on Opus at medium effort. A model and effort saved as your default in Settings replace that; a seat you change in the Start form changes only that start.

## The top bar

The bar across the top is 36 pixels tall and replaces the Windows title bar. Drag any empty part of it to move the window. Left to right:

| Control | What it does |
|---|---|
| Kolux mark | Opens the Kolux menu (File, Edit, View, Window, Help). See the next section |
| Sidebar button | Hides or shows the project sidebar (Ctrl+B) |
| Back / Forward | Return to the last workspace you were on, and go forward again (Ctrl+Alt+Left, Ctrl+Alt+Right) |
| Screen switcher | One button, Terminals, the screen Kolux has today |
| Right-panel button | Shows or hides the right panel, which holds Checks, Attached, PR Checks and History. Hidden while Settings is open |
| Go to / Run a command | Jump to a workspace, tab, project or setting, or run a command. It opens on Ctrl+Shift+P or Ctrl+Shift+J anywhere, and on Ctrl+K except in a terminal (where Ctrl+K clears the pane). The box shows the key that works from where you are |
| Account switcher | Names the Claude and Codex accounts new panes use. Click it to pick another account for new panes; panes already running keep theirs. With no account added yet it leads to Settings, Accounts & keys |
| Usage pill | Shows how much of your weekly AI allowance is left, for example "Claude 80% left". Click it to open Settings at Accounts & keys. Hover for the reset time |
| Minimize, Maximize, Close | The usual window controls |

The usage pill turns to a warning tint at 70% used and a danger tint above 90%. A Codex pill shows only when Codex is installed and you have added at least one Codex account. It reads "Codex N% left", or "Codex · sign in again" when its sign-in has lapsed. A pill shows only for an AI program that is installed and reports a weekly figure.

In the Classic look (Settings, Appearance) the screen switcher is absent.

### The Kolux menu

Click the Kolux mark at the left end of the top bar (its tooltip says "Kolux menu"). A menu opens under it with the usual menu names. The window has no menu bar across the top, so this is where they live. Where a command has a keyboard shortcut, the menu shows it as a hint, and it follows any key you change in your shortcuts file.

| Menu | What is in it |
|---|---|
| File | **Settings...** opens Settings (Ctrl+, by default). **Exit** closes the window the way its close button does, which stops every terminal |
| Edit | Undo, Redo, Cut, Copy, Paste, Select All. In a text box they act on the text. In a terminal pane only **Copy** (the selected text; nothing is copied when nothing is selected) and **Select All** work; Undo, Redo and Cut do nothing there. **Paste** does nothing yet from this menu: use Ctrl+V |
| View | **Workspace View** has Terminals, ticked (absent in the Classic look). **Appearance** has Toggle Left Sidebar, Toggle Right Sidebar and two ticks: Show Status Bar and Show Titlebar App Name. Each tick matches its switch in [Settings](settings.md) and changes it. Then come Force Reload (Ctrl+Shift+R), Reset Interface Zoom, Zoom Interface In, Zoom Interface Out and Toggle Full Screen |
| Window | Minimize, and Zoom (which maximizes the window) |
| Help | Explore Kolux, Getting Started and Report Crash, then **About Kolux** (the version, Safe Graphics Mode and GPU status) and Check for Updates |

The menu's Zoom Interface In, Zoom Interface Out and Reset Interface Zoom (Ctrl+Alt+=, Ctrl+Alt+-, Ctrl+Alt+0) change the whole interface size, the same one as "Zoom: Interface size" in Settings, Appearance. Terminal text has one size for every terminal; set it under Settings > Terminal & sessions.

## Add a project

A project is a Git repository (a folder whose history Git tracks). In the sidebar, click the folder-plus button in the "Folders" header: "Add project". A dialog offers three choices. Arrow keys move between them, Enter takes one, Escape closes.

| Choice | What happens |
|---|---|
| Copy from a web address | Clones a repository. Type the web address (for example `https://github.com/owner/project.git`). The Folder field fills itself; change it if you like. Press Copy. A Cancel button stops a copy in progress |
| Open a folder… | Opens a folder picker for a project already on disk |
| New project | Type a Name and a "Goes in" folder, then press Create |

More detail is in [Projects and folders](projects-and-worktrees.md).

## Start your first agent

1. In the sidebar, press "New session" at the bottom. A menu opens with one row for each AI program Kolux found, then "Blank terminal", "Terminal…" and "Start agents…" (in the Classic look this row reads "Choose what to run…"). Picking an AI row starts that one agent in a new pane.
2. To choose more, pick "Start agents…". The Start form opens. Under "Folders" tick the project folders to start in. Under "How many" pick how many agents open in each folder. Under "Which AI" pick the AI, its model and its effort; that one choice goes to every agent. "Make each one different" opens a row for each agent. Press Start (Ctrl+Enter also starts). In the Classic look this row opens a pane that asks the same questions.
3. A pane opens for each agent and the agent starts. Type your request in the pane.
4. Watch its status word in the pane header (Working, Needs you, Done). Ctrl+J jumps to the next session that needs you. See [Status words](terminals.md#status-words).

Other ways in: press Ctrl+T for a plain shell, or the pane header's plus for a menu of the AI programs Kolux found (Claude Code, Codex and Grok lead; the others sit behind "Show more agents").

<!-- verified against: src/onboarding/Wizard.tsx, src/chrome/TopBar.tsx, src/usage/meter.ts, src/usage/ClaudePill.tsx, src/usage/CodexPill.tsx, src/settings/general.ts, src/projects/AddProject.tsx, src/projects/ProjectsPanel.tsx, src/launch/PlusMenu.tsx, src/keys/actions.ts, src/onboarding/Guides.tsx, src/onboarding/HelpMenu.tsx, src/onboarding/Tours.tsx, src/onboarding/guide.ts, src/onboarding/tour.ts, src-tauri/src/onboarding.rs, src/chrome/chromeItems.ts, src-tauri/src/skills.rs, src-tauri/src/menu.rs, src/chrome/useChrome.ts, src/launch/ChooserPane.tsx, src/launch/startForm.ts, src/shell/useStartAsk.ts, src/shell/window/Grid.tsx, src/shell/window/SeatChooser.tsx, src/terminal/paneActions.ts, src/settings/GeneralPage.tsx at bf88bbb3 -->
