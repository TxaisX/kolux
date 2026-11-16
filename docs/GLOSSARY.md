# Glossary

Kolux uses a few words in a specific way. This page is the short version. The user guide has the full behaviour behind each one. Each entry uses the word as the app shows it, in a button, a tab, a heading or a menu.

## Work and folders

**Project**
A folder you add to Kolux, usually a Git repository. Projects appear in the left sidebar under **Folders**. In a Git project, an agent picked from the **New session** menu, or each of two or more agents started together, works in a **Worktree** of its own. That is the default; turn off "Own folder for each agent" in Settings, Git, to have every agent work in the project's own folder. A folder that is not a Git project gets no copies.

**Folders**
The heading of the project list in the left sidebar. Each row is a project; a **Group** can gather several of them.

**Group**
A named set of projects in the sidebar. Make one with **New group**, and put a project in it from the project's own settings, in the **Group** field. Groups fold and unfold.

**Workspace**
A project's folder together with its sessions and layout. Each project has one. While "Own folder for each agent" (Settings, Git) is off, every agent shares it: give each agent a different task, or launch them one at a time; the launch chooser warns when several AIs would edit the same files.

**Worktree**
A second copy of a project's folder on its own branch, made by Git on this computer, so two agents can change files without getting in each other's way. Nothing goes to GitHub until you push. In a Git project Kolux makes one for an agent picked from the **New session** menu, and one for each agent when you start two or more together. It does this while "Own folder for each agent" (Settings, Git) is on, and it is on unless you turn it off. Each pane shows the worktree its session works in as a label in its header. The sidebar lists project folders only, never worktrees.

**Sleeping**
A workspace row Kolux has put to rest. It stays in the list marked "sleeping". The **Group and sort** form in the sidebar has a checkbox to show or hide sleeping workspaces.

**Go to / Run a command**
The box in the top bar and the picker it opens (Ctrl+Shift+J or Ctrl+Shift+P on Windows; Ctrl+K too, outside a terminal) to jump to a workspace or run a command. Type to filter, press Enter. It was called Switch workspace before.

**Branch**
The Git branch the project folder is on.

**Space**
A full page that shows how much disk space your project folders take. A scan refreshes the sizes, a map shows the biggest folders, and a table lets you tick rows and delete them after the same safety checks as a single delete.

## Running agents

**Agent**
An AI coding CLI that Kolux can run in a pane, such as Claude Code, Codex, Gemini CLI, or one of the other supported tools. Kolux can install some agents itself; others you install first. **Agents** is also the name of a screen in the top bar: a chat view of your agents.

**Terminals**
The main screen, in the top bar's Agents, Board, Terminals and Tower switcher. It holds the grid of tabs and panes where agents and shells run, with the right panel beside it.

**New session**
The button at the bottom of the left sidebar. It starts an agent in a new pane in the project folder.

**Next that needs you**
A button in the left sidebar that jumps to the next agent waiting for you, such as one asking for approval.

**Session**
One agent or shell running in a pane, plus the record Kolux keeps so it can be restored after a quit. A session has a state, a workspace, and a terminal.

**Fork**
Starts a second pane beside this one that continues the same agent session. Kolux asks for a name first; leave it empty to keep the pane's title.

**Pane**
One cell in the terminal grid. Each pane holds one session. Panes can be split, resized, expanded, and closed.

**Tab**
A container for one or more panes in the grid. Tabs can be split right or down, and a tab's menu can close it or its neighbours.

**Layout**
The saved arrangement of panes and tabs in a workspace. Kolux restores it at the next launch.

**Seat**
One agent slot in a launch lineup. A seat has an agent, a model, and an optional role.

**Shape**
A preset lineup: **Solo** (one seat), **Pair** (builder and reviewer), **Workbench** (scout, builder, reviewer), **Swarm** (five seats), or **Custom**.

**Custom**
A lineup you build seat by seat instead of picking a ready-made Shape.

**Model routing**
A page, opened from the button at the bottom of the left sidebar, that sets the model and the effort for each tier of helper agent. When one agent starts another to do part of a job, the helper runs on its tier's model and effort. Choose "Provider default" to leave the choice to the provider.

## Watching and steering

**Board**
A lane view of every session: Needs you, Working, Done, Stopped, and Idle. Each card can show the live terminal, approve or deny a request, and open the workspace's changes.

**Show Workspace Statuses**
A command, with no button, that opens the workspace statuses view: a lane for each status, with a card for each workspace. It is separate from the Board in the top bar.

**Inbox**
A list of what needs you, what is running, and what finished today. It is the bell in the top bar.

**Tower**
A screen that shows every agent at once, with one row per pane and a summary of each state.

**Floor**
A timeline of when each agent worked, waited, or sat idle, over the last 15 minutes, 60 minutes, or today.

**Workspace View**
A submenu of the View menu that lists the full-page screens so you can switch between them. The Classic look does not have it.

**Status**
What an agent is doing. The main states are **Working**, **Needs you**, **Done**, **Stopped**, and **Idle**. The full list, including Blocked and Interrupted, is in [Board, Agents and Inbox](guide/board-agents-inbox.md#status-words).

- **Ready**: a plain terminal, with no agent in it, waiting for you to type.
- **Ended (code)**: a plain terminal whose program has ended. The number, when shown, is its exit code.

**Hook**
A small script Kolux installs in an agent's own settings. The agent runs it on events such as a prompt, a tool call, a permission request, or a finished turn. The hook posts to Kolux's loopback listener.

**Usage**
Token and cost figures, plus plan limits where the provider reports them. Usage comes from local agent records, not from a Kolux service.

**Notifications**
The alerts Kolux raises when an agent needs you or finishes. Turn them on in Getting Started, and tune them under Settings, Notifications.

## The right panel

The panel on the right of the Terminals screen. Ctrl+L shows or hides it. Its tabs are Explorer, Insights, Checks, Attached, PR Checks and History.

**Explorer**
A tree of the project's files. Open, create, rename, copy and delete from it.

**Insights**
Every session's tokens, estimated cost and what each one is doing, across all your projects.

**Checks**
The CI status for a pull request, with the check's steps and annotations.

**Attached**
The other working folders that Git has linked to the project, if any, with their branches. A project made fresh in Kolux has none.

**PR Checks**
The pull-request results of the attached folders rolled into one list.

**History**
Past agent sessions. Search them, resume one, or copy its details.

## Work items

**Task**
A work item on the Tasks page. A task can be started as a session, and an agent can be launched from a GitHub issue or pull request.

**Automation**
A saved prompt and agent that runs on a timetable or when something happens in a project, such as a pull request opening or an agent finishing. **Automations** is the page that lists them.

**Run**
One execution of an automation. Each run has a numbered history entry, saved output, and token and cost figures when they can be matched.

**Artifact**
A file an agent creates that Kolux can list and open in its own viewer. **Artifacts** is the page that lists them.

**Skill**
A folder with a `SKILL.md` file that teaches an agent how to do a job. Kolux can list, inspect, and remove skills from the folders its agents read. **Skills** is the page that lists them.

## Reviewing and safety

**Review changes**
The button on a finished agent's Board card or Inbox row. It opens All Changes for that workspace.

**All Changes**
A tab that lists every changed file of a project in one scroll. It stages, unstages, commits, pushes, and pulls.

**Review notes**
Comments you leave on lines of a diff. They collect in a tray beside the diff.

**Protected action**
A risky shell command, such as a force-push to main or a production deploy, that Claude must ask about before it runs. The rules are a warning, not a sandbox.

**Yolo and Manual**
The agent permission modes in Settings, Agents. **Yolo** lets Claude Code use its automatic mode and Codex run in its sandbox without approval prompts. **Manual** asks before each action.

## Settings and help

**Settings**
The page for everything you can change. Ctrl+, opens it. Its pages include Accounts & keys, Terminal & sessions, Notifications, Shortcuts and Git.

**Accounts & keys**
The Settings page where you connect Claude, Codex and Grok and keep saved keys. The usage pill in the top bar opens it.

**Terminal & sessions**
The Settings page for how terminals draw and take input, and for what happens when you close a terminal that still has a program running.

**Git**
The Settings page for Git behaviour, such as renaming a folder when work starts and which agent writes commit messages. Kolux works in one folder per project.

**Shortcuts**
The Settings page that lists every keyboard shortcut and lets you change it.

**Resource Manager**
Opens from the memory item in the status bar. It shows what Kolux and each terminal session use, and offers to clean up sessions. The same figures print with `kolux diagnostics memory`.

**Classic**
The plain look, chosen in Settings. It has no Agents, Board, Terminals and Tower switcher, and the window stays on Terminals. It is also the name of the default app icon.

**Getting Started**
"Getting Started with Kolux", the checklist dialog in the Help menu. It shows a ring such as "N of 6 done" and walks through notifications, a default agent, the CLI and more.

**Milestones**
A Help menu entry with the same checklist and its progress ring. It shows only while a required step is still open.

**Onboarding**
The Help menu entry that reopens the first-run dialog.

**Explore Kolux**
The Help menu entry that opens a guided look at what Kolux can do, one stop at a time.
