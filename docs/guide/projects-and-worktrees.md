# Projects and folders

Use the sidebar to add projects and start agents in a project's folder, or in folders of their own. Kolux keeps your folders between runs but not your tabs; each start asks what to open.

## The sidebar

The project sidebar shows on the Terminals screen. Toggle it with Ctrl+B. The header "Folders" has three buttons.

| Button | What it does |
|---|---|
| Group and sort | Opens the grouping and sorting form (below) |
| Add project | Clone, open a folder or start a new project. See [Getting started](getting-started.md) |
| New group | Sort projects into folders of their own. Works only when grouped by Project |

Each project block is one folder row: its name, state dot, current branch, running count, a gear for project settings and Remove. Clicking the row shows every session pane opened in that folder, together in the same terminal grid. With Own folder for each agent on (the default, below), the sidebar lists each agent's folder as a workspace under the project; with it off, Kolux works in one folder per project and the new-workspace button and the old worktree rows stay hidden; project settings still offers Clean up workspaces for folders made before this change.

The bottom of the sidebar holds "New session" (start an agent in a new pane; with Own folder for each agent on it gets a folder of its own), then a gear that opens Settings and the Help button. An empty sidebar reads "No projects yet." Projects must be Git repositories; one without Git can start Git from the sidebar.

## The right sidebar

On the Terminals screen, the right sidebar holds Checks, Attached, PR Checks and History. Ctrl+L hides or shows it, dragging its edge resizes it, and it remembers the last tab you used. When it is too narrow for every tab, the ones that do not fit go into a **More** menu; picking one there brings it onto the strip.

If a panel breaks, it is replaced by "This panel stopped working and was closed; the rest of Kolux keeps running." with **Try again**, which draws it afresh. Switching tabs also starts it afresh.

## One folder per project

Kolux shows one folder per project: the sidebar lists project folders only, and each project has one grid. With **Own folder for each agent** off, every agent and shell you start in a project uses that folder, and Kolux makes no extra copies of your repository. Two agents in the same project can then edit the same files, so give each a different task, or launch them one at a time. The launch chooser warns when several AIs would edit the same files.

Agents are kept apart by **Own folder for each agent** in Settings, Git. It is on by default, so agents do not overwrite each other's files. With it on, in a Git project every agent you launch gets a folder of its own: a Git worktree on its own branch, made on this computer (nothing goes to GitHub until you push). That holds for one agent alone as well as a team, and whether you start from the main project folder, an existing worktree, the sidebar's **New session** menu, or the Start form. The launch chooser offers **Own folder for each AI**, already picked, or **Same folder for all** for that one launch. The sidebar still lists only your project folders. Each pane's header shows the worktree it works in, as a coloured label. An agent working beside others is told to stay inside its own folder. Outside a Git project there is nothing to copy, so every AI still works in the one folder.

While Own folder for each agent is off, the sidebar does not offer extra working folders and there is no new-workspace button. Folders made while it was on, or by earlier versions of Kolux, stay on disk and stay hidden in the sidebar. To tidy them, open the project's gear and choose **Clean up workspaces**. **Remove project** (the x on the project row) takes the project out of Kolux after asking; its terminals close, and the folder and its files stay on disk.

## Switching and keys

Click a project's row to show every session pane opened in its folder. Enter does the same on the focused row. Ctrl+Shift+J opens the **Switch workspace** picker: type to filter, press Enter to go there. Ctrl+1 to Ctrl+9 and Ctrl+Shift+Up and Ctrl+Shift+Down move between the rows the sidebar lists. Ctrl+J jumps to the next session that needs you; the sidebar shows "Next that needs you" with its key.

## Grouping and sorting

Press the sliders button.

| Choice | Options |
|---|---|
| Group by | Project, None (one flat list), Status, Pull request |
| Sort | Smart (what needs you first), Name, Recent (latest activity first) |
| Checkboxes | Pinned rows also show in their usual place; show sleeping workspaces |

Group headers fold. Pinned rows gather in a "Pinned" section. A project group has its own gear to rename it, move it or delete it. Deleting a group offers an "also remove the projects" checkbox.

## Reviewing changes

Kolux has no changes view of its own any more: the All Changes tab, the diff tabs and the Tasks page went on 2026-11-19. Review and commit an agent's work in your own editor or with Git; right-click the project row and use **Open in** to get there (see [Files and web pages](files-and-browser.md)). The right panel's Checks tab still follows the pull request's checks.

## Quitting and reopening

Kolux does not reopen your tabs between runs, but your folders stay listed. Terminals do not keep running while Kolux is closed: quitting ends every pane and whatever runs in it. When you reopen, the Folders list is as you left it, no tabs are open and the Start form asks what to open (see [Getting started](getting-started.md)). Earlier output is not shown again.

Quitting never touches a folder's files or its Git worktrees. Closing Kolux still saves each workspace's uncommitted work as a commit and merges its branch into main, but the workspace folder stays exactly where it was. A folder you removed yourself is a different matter: it is a new project if you add it again, so what was tied to the old one does not follow it, and a lineup or group saved for the folder starts fresh.

### A workspace that sits unused

A workspace stays open until you close it. The one thing that removes one on its own is idleness: a workspace you have not opened in 14 days is saved, merged into main and removed while Kolux is running. Its branch always stays, so the workspace can be opened again from it. A workspace you opened within the last 14 days is never touched. One Kolux has no record of opening (a workspace made before this existed) starts its clock on the first check, so nothing is removed on the day the rule arrives.

Two settings change this, both in `settings.json`:

- `"workspaceKeepDays": <days>` sets how long a workspace may sit unopened; `0` turns the sweep off.
- `"workspacesRemoveOnQuit": true` brings back the older behaviour, removing every workspace that merges cleanly as Kolux closes.

The sweep writes what it did to the app's log, `logs/kolux.log` in the profile folder. A workspace it leaves says why: a lock, an unfinished merge, a folder holding your own local files, or a terminal still running in it.

### Handoff notes

Every agent Kolux starts gets a handoff note before it begins, and every workspace Kolux creates makes one for itself at the moment the worktree is made: a Markdown file at `.kolux/handoffs/<name>.md` inside the project, named after the workspace the agent works in (or after the folder and its seat number when several agents share one folder). The agent is told to keep it current — the files it added, updated and removed, and what is left to do. The folder ignores itself, so notes never ride into your commits.

The notes are what make clearing early cheap. Each time a session's context crosses its clear point (see [Settings](settings.md)) it is cleared with the agent's own new-conversation command - `/clear` in Claude Code, `/new` in Codex, OpenCode and Grok - and the next turn starts sharp with the state on paper rather than in a conversation the model was already losing track of. A long day relays as many times as it fills.

A chat pane makes a note of its own in its own folder, named after that folder (for a chat in a worktree this is not the note a terminal pane there keeps), and hands off without typing anything: once its turn ends past the line, and after any message you sent meanwhile has been answered, the chat says so and the next message starts a fresh conversation with the note on hand.

What still comes back:

- your folders;
- whether the left sidebar was showing, and the right panel's tab;
- your settings, look and saved start shapes.

Your tabs come back by default, and an agent tab carries on in its last conversation. To start with no tabs instead (the Start form asks what to open), add `"keepWorkspaces": false` to `settings.json`. There is no switch for it in Settings.

### Agent sessions after a restart

A restart brings an agent's conversation back by itself: every agent tab that comes back resumes the session Kolux last saw for it, using that agent's own "resume" form added to its standing start line. The same form is used when a sleeping agent tab wakes (Agent sleep, in [Settings](settings.md)).

This happens on a restart and on a wake, never on a new tab, and never twice. Kolux needs the agent's session ID for this; it learns it from the agent's status hooks (see [Status words](terminals.md#status-words)). If Kolux holds no session ID, the agent starts at its prompt, and its pane wears the mark "restored without resume" instead of "restored". A session ID with odd characters in it is treated as no ID.

| Agents | What comes back |
|---|---|
| Claude Code, Codex | The session Kolux last saw |
| Kiro | The session Kolux last saw; with none, the last conversation in that folder |
| Aider | The last conversation in that folder (its chat history), with or without an ID |
| Copilot, Cursor, Gemini CLI, Devin, Droid, Mistral Vibe, Qwen Code, Hermes, Grok, Antigravity, Kimi, Pi, Goose, Amp, OpenClaw | The session Kolux last saw: the ID the agent printed in its own "resume" hint when it exited, or (Cursor, Gemini CLI, Hermes, Goose, Amp) the newest session the agent's own sessions list names for that folder. With no session ID the tab comes back at its prompt |

Your own extra start arguments, such as a model choice, stay in front of the resume form. The agents in the last row have no status hooks, so Kolux reads their session ID from the agent itself (T-066-d, T-066-e): from the "resume" command the agent prints when it exits, and, for an agent with a sessions command (Cursor `ls`, Gemini CLI `--list-sessions`, Hermes `sessions list`, Goose `session list`, Amp `threads list`), from that list, run in the tab's folder each time the layout is written down (at most once every 30 seconds per tab, with a 5-second limit on the whole ask, the reading of the command's output included). The newest session in the list that no other tab already holds is taken, so two tabs never resume the same session. A listed ID is only Kolux's best guess until the agent names its own: a tab is asked as soon as it is opened, before its agent has made a session, so the folder's previous session may be put on it first; the tab is asked again and the session its agent made since replaces that guess, and the ID the agent prints itself when it exits always wins. An ID the agent named itself is never replaced. These readers were built against the vendors' documented output shapes and are still to be checked against each installed agent (T-066-e), so expect "restored without resume" where an agent's output differs. Agents not in the table come back at their prompt.

<!-- verified against: src/projects/ProjectsPanel.tsx, src/projects/AddProject.tsx, src/projects/singleFolder.ts, src/projects/CleanupDialog.tsx, src/glossary.ts, src/scm/watch.ts, src-tauri/src/scm_watch.rs, src/scm/model.ts, src/chrome/RightSidebar.tsx, src/terminal/layout.ts, src/keys/actions.ts, src/App.tsx, src-tauri/src/scm.rs, src-tauri/src/github.rs, src-tauri/src/agents.rs, src-tauri/src/terminal_session_id.rs, src-tauri/src/terminal.rs, src/main.tsx, src/shell/useWindowSave.ts, src/terminal/TerminalPane.tsx, src/launch/ChooserPane.tsx, src/settings/GitPage.tsx, src/shell/WorktreeChip.tsx, src/launch/launchActions.ts, src-tauri/src/git.rs at 571a94f9 -->
