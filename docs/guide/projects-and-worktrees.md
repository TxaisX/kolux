# Projects and folders

Use the sidebar to add projects, start agents in a project's folder, and review and commit changes. Kolux does not remember folders between runs; each start asks what to open.

## The sidebar

The project sidebar shows on the Terminals view. Toggle it with Ctrl+B. The header "Folders" has three buttons.

| Button | What it does |
|---|---|
| Group and sort | Opens the grouping and sorting form (below) |
| Add project | Clone, open a folder or start a new project. See [Getting started](getting-started.md) |
| New group | Sort projects into folders of their own. Works only when grouped by Project |

Each project block is one folder row: its name, state dot, current branch, running count, a gear for project settings and Remove. Clicking the row shows every session pane opened in that folder, together in the same terminal grid. With Own folder for each agent on (the default, below), the sidebar lists each agent's folder as a workspace under the project; with it off, Kolux works in one folder per project and the new-workspace button and the old worktree rows stay hidden; project settings still offers Clean up workspaces for folders made before this change.

The bottom of the sidebar holds "New session" (start an agent in a new pane; with Own folder for each agent on it gets a folder of its own), Model routing, Help and "Check for updates" (when the sidebar is dragged to its narrowest, that button shows its icon alone; hovering it still says what it does). A gear there lets you add a project by typing its path, or change the folder where old workspaces live. An empty sidebar reads "No projects yet." Projects must be Git repositories; one without Git can start Git from the sidebar.

## The right sidebar

On the Terminals view, the right sidebar holds Explorer, Insights, Checks, Attached, PR Checks and History. Ctrl+L hides or shows it, dragging its edge resizes it, and it remembers the last tab you used. When it is too narrow for every tab, the ones that do not fit go into a **More** menu; picking one there brings it onto the strip.

If a panel breaks, it is replaced by "This panel stopped working and was closed; the rest of Kolux keeps running." with **Try again**, which draws it afresh. Switching tabs also starts it afresh.

## One folder per project

Kolux shows one folder per project: the sidebar lists project folders only, and each project has one grid. With **Own folder for each agent** off, every agent, shell and browser tab you start in a project uses that folder, and Kolux makes no extra copies of your repository. Two agents in the same project can then edit the same files, so give each a different task, or launch them one at a time. The launch chooser warns when several AIs would edit the same files.

Agents are kept apart by **Own folder for each agent** in Settings, Git. It is on by default, so agents do not overwrite each other's files. With it on, in a Git project each agent you launch gets a folder of its own: a Git worktree on its own branch, made on this computer (nothing goes to GitHub until you push). The launch chooser then offers **Own folder for each AI**, which it picks for two or more seats, or **Same folder for all**; an agent started on its own from the sidebar gets a fresh folder too. The sidebar still lists only your project folders. Each pane's header shows the worktree it works in, as a coloured label. An agent working beside others is told to stay inside its own folder. Outside a Git project there is nothing to copy, so every AI still works in the one folder.

While Own folder for each agent is off, the sidebar does not offer extra working folders and there is no new-workspace button. Folders made while it was on, or by earlier versions of Kolux, stay on disk and stay hidden in the sidebar. To tidy them, open the project's gear and choose **Clean up workspaces**. **Remove project** (the x on the project row) takes the project out of Kolux after asking; its terminals and editor tabs close, and the folder and its files stay on disk.

## Switching and keys

Click a project's row to show every session pane opened in its folder. Enter does the same on the focused row. Ctrl+Shift+J opens the **Switch workspace** picker: type to filter, press Enter to go there. Ctrl+1 to Ctrl+9 and Ctrl+Shift+Up and Ctrl+Shift+Down move between the rows the sidebar lists. Ctrl+J jumps to the next session that needs you; the sidebar shows "Next that needs you" with its key.

## Grouping and sorting

Press the sliders button.

| Choice | Options |
|---|---|
| Group by | Project, None (one flat list), Status, Pull request |
| Sort | Smart (what needs you first), Name, Recent (latest activity first) |
| Checkboxes | Hide workspaces made by automations; pinned rows also show in their usual place; show sleeping workspaces |

Group headers fold. Pinned rows gather in a "Pinned" section. A project group has its own gear to rename it, move it or delete it. Deleting a group offers an "also remove the projects" checkbox.

## Reviewing changes

When an agent finishes, open the Board and press **Review changes** on its Done card, or open the Inbox (the bell in the top bar), pick the finished row and press **Review changes**. Both open the **All Changes** tab, which lists every changed file of the project in one scroll. You do not need a finished agent to get there: right-click the project (or a workspace) in the left sidebar and choose **Review changes**, or run "Open All Changes" from Go to / Run a command. The right panel (Explorer, Insights, Checks, Attached, PR Checks, History) has no changes list, and Ctrl+Shift+G renames the current tab.

Inside All Changes:

| Part | What it does |
|---|---|
| Compare | **Working tree** (what you have not committed yet) or **Branch vs** its base |
| Inline / Side by side | How each diff is drawn. Wrap long lines and Show whitespace changes sit beside them |
| File tree | Shows or hides the list of files beside the diffs |
| Each file | A Viewed checkbox, Stage or Unstage and Discard (in the Working tree view), and a button that opens the file as a diff tab. Discard asks first and says exactly what will be lost; an untracked file is deleted from disk. A staged delete reads "Deleted, staged" and a staged rename "Renamed, staged"; a copied file shows as a new staged file. When Discard leaves a row as it is (a link, a folder standing where a file was, a file standing where a deleted one would come back), a yellow line under "Kolux left this as it is:" says why and what to do next; a real failure is red under "Could not discard" |
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

Kolux does not remember your folders or tabs between runs. Terminals do not keep running while Kolux is closed: quitting ends every pane and whatever runs in it. When you reopen, the Folders list is empty, no tabs are open and the Start form asks what to open (see [Getting started](getting-started.md)). Earlier output is not shown again.

Taking the folders out of the list at start never touches their files or their Git worktrees; add a folder again and it is as you left it on disk. A folder you add again is a new project in Kolux, so what was tied to the old one does not follow it: an automation that named the folder is skipped ("its project is no longer in Kolux") until you edit it and pick the folder again, and a lineup or group saved for the folder starts fresh. A setup script you typed for the folder is kept.

What still comes back:

- whether the left sidebar was showing, and the right panel's tab;
- the screen you left: Agents, Board, Terminals, the Inbox or Artifacts;
- your settings, look and saved start shapes.

To get the older behaviour back (folders stay listed and tabs reopen as plain shells), add `"keepWorkspaces": true` to `settings.json`. There is no switch for it in Settings.

### Agent sessions after a restart

A restart does not bring an agent's conversation back by itself (see above). The resume form below is what Kolux uses when it does start an agent again for you: when a sleeping agent tab wakes (Agent sleep, in [Settings](settings.md)).

A woken agent tab starts the agent again with that agent's own "resume" form added to its start line, so it opens in its earlier conversation. This happens only on a wake, never on a new tab, and never twice. Kolux needs the agent's session ID for this; it learns it from the agent's status hooks (see [Board, Agents and Inbox](board-agents-inbox.md#status-words)). If Kolux holds no session ID, the agent starts at its prompt, and its pane wears the mark "restored without resume" instead of "restored". A session ID with odd characters in it is treated as no ID.

| Agents | What comes back |
|---|---|
| Claude Code, Codex | The session Kolux last saw |
| Kiro | The session Kolux last saw; with none, the last conversation in that folder |
| Aider | The last conversation in that folder (its chat history), with or without an ID |
| Copilot, Cursor, Gemini CLI, Devin, Droid, Mistral Vibe, Qwen Code, Hermes, Grok, Antigravity, Kimi, Pi, Goose, Amp, OpenClaw | The session Kolux last saw: the ID the agent printed in its own "resume" hint when it exited, or (Cursor, Gemini CLI, Hermes, Goose, Amp) the newest session the agent's own sessions list names for that folder. With no session ID the tab comes back at its prompt |

Your own extra start arguments, such as a model choice, stay in front of the resume form. The agents in the last row have no status hooks, so Kolux reads their session ID from the agent itself (T-066-d, T-066-e): from the "resume" command the agent prints when it exits, and, for an agent with a sessions command (Cursor `ls`, Gemini CLI `--list-sessions`, Hermes `sessions list`, Goose `session list`, Amp `threads list`), from that list, run in the tab's folder each time the layout is written down (at most once every 30 seconds per tab, with a 5-second limit on the whole ask, the reading of the command's output included). The newest session in the list that no other tab already holds is taken, so two tabs never resume the same session. A listed ID is only Kolux's best guess until the agent names its own: a tab is asked as soon as it is opened, before its agent has made a session, so the folder's previous session may be put on it first; the tab is asked again and the session its agent made since replaces that guess, and the ID the agent prints itself when it exits always wins. An ID the agent named itself is never replaced. These readers were built against the vendors' documented output shapes and are still to be checked against each installed agent (T-066-e), so expect "restored without resume" where an agent's output differs. Agents not in the table come back at their prompt.

Quitting with unsaved editor text asks "Quit with unsaved changes?" with "Quit without saving" or "Keep working".

<!-- verified against: src/projects/ProjectsPanel.tsx, src/projects/AddProject.tsx, src/projects/singleFolder.ts, src/projects/CleanupDialog.tsx, src/glossary.ts, src/scm/split.ts, src/scm/watch.ts, src-tauri/src/scm_watch.rs, src/scm/model.ts, src/chrome/RightSidebar.tsx, src/terminal/layout.ts, src/keys/actions.ts, src/App.tsx, src-tauri/src/scm.rs, src/tasks/TasksPage.tsx, src/tasks/model.ts, src-tauri/src/github.rs, src-tauri/src/agents.rs, src-tauri/src/terminal_session_id.rs, src-tauri/src/terminal.rs, src/main.tsx, src/shell/useWindowSave.ts, src/terminal/TerminalPane.tsx, src/launch/ChooserPane.tsx, src/settings/GitPage.tsx, src/shell/WorktreeChip.tsx, src/launch/launchActions.ts, src-tauri/src/git.rs, src/scm/changesActions.ts at 2a8711de -->
