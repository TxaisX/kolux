# Projects and worktrees

Use the sidebar to add projects, give each task its own branch in its own folder, review and commit changes, and come back after a restart with everything where you left it.

## The sidebar

The project sidebar shows on the Terminals view. Toggle it with Ctrl+B. The header "Projects" has four buttons.

| Button | What it does |
|---|---|
| Group and sort | Opens the grouping and sorting form (below) |
| Add project | Clone, open a folder or start a new project. See [Getting started](getting-started.md) |
| New group | Sort projects into folders of their own. Works only when grouped by Project |

Each project block is one folder row: its name, state dot, current branch, running count, a gear for project settings and Remove. Clicking the row shows every session pane opened in that folder, together in the same terminal grid. Kolux works in one folder per project, so the new-workspace button and the old worktree rows stay hidden; project settings still offers Clean up workspaces for folders made before this change.

The bottom of the sidebar holds "New session" (start an agent in a new pane in the project folder), Model routing, Help and "Check for updates" (when the sidebar is dragged to its narrowest, that button shows its icon alone; hovering it still says what it does). A gear there lets you add a project by typing its path, or change the folder where old workspaces live. An empty sidebar reads "No projects yet." Projects must be Git repositories; one without Git can start Git from the sidebar.

When someone makes a worktree outside Kolux, a notice says "N new workspace(s)" with Show, Hide and Done.

## The right sidebar

On the Terminals view, the right sidebar holds Explorer, Insights, Checks, Attached, PR Checks and History. Ctrl+L hides or shows it, dragging its edge resizes it, and it remembers the last tab you used. When it is too narrow for every tab, the ones that do not fit go into a **More** menu; picking one there brings it onto the strip.

If a panel breaks, it is replaced by "This panel stopped working and was closed; the rest of Kolux keeps running." with **Try again**, which draws it afresh. Switching tabs also starts it afresh.

## What a worktree is

A worktree is an extra working folder for the same Git repository, on its own branch. Kolux calls it a workspace. Each AI can then edit its own files, and nobody collides. The original folder stays as the main checkout.

## Create a workspace

Press the plus, or Ctrl+N (also Ctrl+Shift+N). The form asks for:

| Field | Meaning |
|---|---|
| Project | Which repository |
| Name, or an existing branch | A sentence under the field previews what will happen |
| Parent | Which workspace it branches from |
| Agent | What to start. The default is "No agent: a terminal" |
| Note | An optional first request for the agent |

"Advanced…" adds a branch name, reuse of an existing branch, opening a pull request, a setup script (run it, or skip it, in a tab, a split right or a split below, and optionally wait for it) and the base to start from. Press "Create workspace" or Cancel. Tick "Create more" to keep the form open for another.

## Setup scripts and the issue command

The setup script is `scripts: setup:` in the new workspace's `kolux.yaml` (a settings file in the repository). It runs inside the workspace with three variables set: `KOLUX_ROOT_PATH` (the main folder), `KOLUX_WORKTREE_PATH` (the workspace's folder) and `KOLUX_WORKSPACE_NAME` (that folder's name). A `.bat` or `.cmd` script runs through Command Prompt even when your shell is Git Bash. If Kolux was started from a half-active conda environment, those conda variables are cleared first.

A workspace made from a linked GitHub issue also runs the project's issue command, in its own tab. It is your own `.kolux/issue-command` file in the project's main folder when there is one, otherwise `issueCommand:` in `kolux.yaml`. The file counts as yours only if it is a private file of your own. Kolux ignores it, and uses the `kolux.yaml` command instead, when Git tracks a file by that name (in any capitals, so a committed `.KOLUX/Issue-Command` counts as tracked), when the `.kolux` folder or the file is a link (a symbolic link or junction), when the copy is inside a workspace instead of the main folder, or when Git cannot tell. Anyone can commit such a file, so none of these is ever treated as your own. `{{issue}}` becomes the issue number and `{{issueUrl}}` its address; a command with neither gets the number added at the end. The issue's title is never put in, because anyone can write it. A linked pull request runs nothing, and skipping the setup script skips the issue command too.

Kolux does not yet ask before running a repository's `kolux.yaml` commands, so only create workspaces in repositories you trust.

While Git works, a stand-in row shows "creating…" with a cancel x.

## Workspace rows

With one folder per project, the workspace rows are hidden; they remain for folders made before the change and stay reachable through Clean up workspaces and the command line. A workspace's own row, when one is shown, works as follows.

Click the folder row to show its session panes. Enter does the same. F2 or a double-click on a name still renames a workspace when one is shown.

Each row shows a coloured dot for its state, the name, and hints such as "sleeping" or "external". Its buttons:

| Button | What it does |
|---|---|
| Pin | Keeps the row at the top of the list |
| Mark read / Mark unread | Toggles the unread mark |
| Change parent | Moves it under another workspace |
| Sleep | Closes its tabs and terminals. Show it again to wake it |
| Hide this worktree | Takes it off the list |
| Remove (x) | Deletes it. Off for the main folder |

Ctrl+1 to Ctrl+9 jump to a workspace by position. Ctrl+Shift+Up and Ctrl+Shift+Down step through them. Ctrl+Shift+J opens a switcher. Ctrl+J jumps to the next session that needs you; the sidebar shows "Next that needs you" with its key.

## Remove a workspace

Press x on a row, or Ctrl+Shift+Backspace. Kolux checks first, then asks "Remove <branch> and its folder?" It deletes the branch too, unless the workspace was opened on a branch that already existed. If there are uncommitted changes, it lists them and offers a "Delete my changes too" checkbox. Press Remove to go on or Keep to stop. Removing a workspace ends its shells and everything they started. Kolux can refuse and tell you why, for example when a program stays running.

## Grouping and sorting

Press the sliders button.

| Choice | Options |
|---|---|
| Group by | Project, None (one flat list), Status, Pull request |
| Sort | Smart (what needs you first), Name, Recent (latest activity first) |
| Checkboxes | Hide workspaces made by automations; pinned rows also show in their usual place; show sleeping workspaces |

Group headers fold. Pinned rows gather in a "Pinned" section. A project group has its own gear to rename it, move it or delete it. Deleting a group offers an "also remove the projects" checkbox.

## Reviewing changes

When an agent finishes, open the Board and press **Review changes** on its Done card, or open the Inbox (the bell in the top bar), pick the finished row and press **Review changes**. Both open the **All Changes** tab, which lists every changed file of the project in one scroll. Nothing else opens it today: the right panel (Explorer, Insights, Checks, Attached, PR Checks, History) has no changes list, and Ctrl+Shift+G renames the current tab.

Inside All Changes:

| Part | What it does |
|---|---|
| Compare | **Working tree** (what you have not committed yet) or **Branch vs** its base |
| Inline / Side by side | How each diff is drawn. Wrap long lines and Show whitespace changes sit beside them |
| File tree | Shows or hides the list of files beside the diffs |
| Each file | A Viewed checkbox, Stage or Unstage (in the Working tree view), and a button that opens the file as a diff tab |
| Stage all, Unstage all | Move every changed file in or out of the next commit |
| Push, Pull, Sync | Offered when Git allows them; each says why when it is greyed out |
| Commit box | Type a message and press Ctrl+Enter, or press **Commit**. It commits only what is staged |

If a merge, rebase or similar is half done, a notice says so and offers to stop it and go back to where it began, after asking. The list refreshes within about a second of any change to the project's files or Git state. Changes to files Git ignores do not trigger it, unless the ignored folder still holds files Git tracks. While files keep changing the status is read at most once every 4 seconds; if Kolux cannot watch the folder, it checks every 4 seconds instead.

See [Files and browser](files-and-browser.md) for the diff tab and the Compare options in detail.

## The Tasks page

The Tasks page lists the GitHub issues and pull requests of the current project. It uses the GitHub command-line tool (`gh`), so you need to be signed in to it. A **Preset** picker chooses the list: All open, Created by me, Assigned to me, Needs my review, Mentions me or Recently closed. The search box takes GitHub search words, such as `is:pr label:bug`. The page remembers your preset, search and place in the list while Kolux is open.

**Default view.** Tasks opens on All open the first time. Pick another preset and press **Make default**, and Tasks opens on it from then on. The button reads "Default view" (and is greyed out) while the preset you are looking at is already the default.

**Filter pickers.** For a GitHub project, a row of six pickers sits under the toolbar: State (Any, Open, Closed, Merged), Author, Assignee, Label, Review requested and Reviewed by. Pick or type a value, then press Enter or click away. Each picker changes only its own word in the search, so your other search words stay. The x beside a picker clears just that one. Author, Assignee and the two review pickers suggest "@me" and the people who can be assigned in the project. Label suggests the project's labels. Review requested, Reviewed by and the Merged state only apply to pull requests, so choosing one narrows the list to pull requests. A State you pick replaces the preset's own open or closed word.

**Forks.** If the project is a fork (a copy of another GitHub project), an **Issues from** picker appears. "this fork" lists issues from the fork itself. "upstream" lists issues from the project it was copied from; pull requests still come from the fork, and a small note says so ("issues ... · pull requests ..."). Your choice is kept for each project. If the upstream project has gone, or is no longer the fork's parent, Kolux says so and lists the fork's own issues instead.

## Quitting and reopening

Terminals do not keep running while Kolux is closed. When you reopen, Kolux restores:

- your tabs, pane layout, active workspace and tab, and which pane had focus;
- the earlier output of each terminal, shown above a new shell with the note "── restored after a restart · the shell below is new ──" (it keeps the last 256 KB per pane);
- the screen you left: Agents, Board, Terminals, the Inbox or Artifacts.

Agent tabs try to resume their conversation (see below). Browser tabs reopen fresh. A tab whose folder is gone is dropped, and a damaged saved entry is dropped on its own without losing the rest. A tab you closed on purpose does not come back. A slow start never drops saved tabs.

### Agent sessions after a restart

A restored agent tab starts the agent again with that agent's own "resume" form added to its start line, so it opens in its earlier conversation. This happens only on a restore, never on a new tab, and never twice. Kolux needs the agent's session ID for this; it learns it from the agent's status hooks (see [Board, Agents and Inbox](board-agents-inbox.md#status-words)). If Kolux holds no session ID, the agent starts at its prompt, and its pane wears the mark "restored without resume" instead of "restored". A session ID with odd characters in it is treated as no ID.

| Agents | What comes back |
|---|---|
| Claude Code, Codex | The session Kolux last saw |
| Kiro | The session Kolux last saw; with none, the last conversation in that folder |
| Aider | The last conversation in that folder (its chat history), with or without an ID |
| Copilot, Cursor, Gemini CLI, Devin, Droid, Mistral Vibe, Qwen Code, Hermes, Grok, Antigravity, Kimi, Pi, Goose, Amp, OpenClaw | The session Kolux last saw: the ID the agent printed in its own "resume" hint when it exited, or (Cursor, Gemini CLI, Hermes, Goose, Amp) the newest session the agent's own sessions list names for that folder. With no session ID the tab comes back at its prompt |

Your own extra start arguments, such as a model choice, stay in front of the resume form. The agents in the last row have no status hooks, so Kolux reads their session ID from the agent itself (T-066-d, T-066-e): from the "resume" command the agent prints when it exits, and, for an agent with a sessions command (Cursor `ls`, Gemini CLI `--list-sessions`, Hermes `sessions list`, Goose `session list`, Amp `threads list`), from that list, run in the tab's folder each time the layout is written down (at most once every 30 seconds per tab, with a 5-second limit on the whole ask, the reading of the command's output included). The newest session in the list that no other tab already holds is taken, so two tabs never resume the same session. A listed ID is only Kolux's best guess until the agent names its own: a tab is asked as soon as it is opened, before its agent has made a session, so the folder's previous session may be put on it first; the tab is asked again and the session its agent made since replaces that guess, and the ID the agent prints itself when it exits always wins. An ID the agent named itself is never replaced. These readers were built against the vendors' documented output shapes and are still to be checked against each installed agent (T-066-e), so expect "restored without resume" where an agent's output differs. Agents not in the table come back at their prompt.

Quitting with unsaved editor text asks "Quit with unsaved changes?" with "Quit without saving" or "Keep working".

<!-- verified against: src/projects/ProjectsPanel.tsx, src/projects/AddProject.tsx, src/glossary.ts, src/scm/SourceControlPanel.tsx, src/scm/split.ts, src/scm/watch.ts, src-tauri/src/scm_watch.rs, src/scm/model.ts, src/chrome/RightSidebar.tsx, src/terminal/layout.ts, src/keys/actions.ts, src/App.tsx, src-tauri/src/setup.rs, src/setup/IssueCommand.tsx, src-tauri/src/scm.rs, src/tasks/TasksPage.tsx, src/tasks/model.ts, src-tauri/src/github.rs at 2c8b9d8; agent sessions section (src-tauri/src/agents.rs, src-tauri/src/terminal_session_id.rs, src-tauri/src/terminal.rs, src/main.tsx, src/terminal/layout.ts, src/shell/useWindowSave.ts, src/terminal/TerminalPane.tsx, T-066-b, T-066-c, T-066-d, T-066-e) at 714f44cf -->
