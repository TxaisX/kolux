# Terminals

Use the Terminals screen to run agents and shells in a grid of panes, split and resize them, group them in tabs, and paste into the one you are working in.

## The pane grid

Each workspace (a folder) has its own grid. The grid holds one to twenty-four panes. It picks columns by count: 1 pane is one column, 2 panes two, up to 4 panes two columns, up to 9 panes three, and more than that four.

An empty workspace shows "Nothing running here yet." with the main button "Start agents" and the link "Open a terminal". "Start agents" opens the Start form (a chooser pane on the Classic look; see [Start agents](#start-agents)).

### Layouts

The Layout strip sets how many panes the workspace in front holds. The quick counts are 1, 2, 4, 6, 9 and 12; the field beside them takes any number from 1 to 24, so a workspace is never limited to the presets. Splits add panes wherever you want them.

The strip only sets how many panes the workspace in front holds. Token and estimated cost figures left the screen on 2026-11-21 and live in Settings > Usage, where token tracking is opt-in per provider. The figures come from the local Claude and Codex logs, which stay on this computer.

| Action | Result |
|---|---|
| Grow (for example 2 to 4) | The Start form opens, with How many set to the new cells plus any pane that was never started; Start fills those panes first. A never-started pane you typed a task, a name or a prompt into is left as it is and is not counted. Nothing starts until you press Start. No empty panes are added. This is the same on both looks |
| Shrink (for example 4 to 2) | Panes that were never started are removed |
| Shrink past a started session | Panes never started are removed; started sessions stay. A toast says "Close <name> first to use fewer panes." |

When a split or a close changes the count, no quick button is pressed and the field shows the real number.

### Split, resize, expand

| Do this | How |
|---|---|
| Split | Use "Split right" on the pane header (a shell in the same folder), or Ctrl+Shift+D (right) and Alt+Shift+D (down) |
| Resize | Drag the thin divider between two panes. It moves live. Letting go outside the window ends the drag where it was |
| Expand | Press Expand on the header, or Ctrl+Shift+Enter. The pane fills the workspace. Press the same control to restore |

Expanding hides the other panes; it does not restart them or lose their scrollback. If you add or close a pane meanwhile, the layout comes back when you restore. In the Classic look, a lone pane cannot expand.

## Pane headers

Every pane has a header. Left to right it shows:

| Item | Meaning |
|---|---|
| Agent mark and title | Hover for the folder |
| Branch chip | The Git branch, or the short commit when HEAD is detached. Plain folders show none |
| Program word | The program and its model |
| Status word | Working, Needs you, Done and so on. See [Status words](#status-words) |
| Approve / Deny | Shown in an agent pane while its agent asks permission to use a tool, and only when the agent's status hooks reported that request and named the tool. Approve answers yes in that agent, Deny answers no. Once you click one, or type a key into the pane that reaches the program, both buttons go away and come back for the agent's next request. If the request has already gone, nothing is sent and the header says "The prompt has gone; nothing was sent". Shell panes never show them |
| "restored" mark | The pane came back after a restart, with its agent in its last conversation. A key press or click clears the mark. With `"keepWorkspaces": false` no tab comes back at all (folders stay listed either way) |
| Crew label | For example "2 agents, 1 waiting", when an agent has helpers |
| Age | "just now", then "5m ago", after a turn finishes |

On the right sit a "Review plan" button when a plan is waiting, the "..." Pane menu, Expand, "Split right", "+" (start a new session in a new pane) and Close pane (Ctrl+W, which ends the program). Token and plan figures are no longer drawn here; see Settings > Usage.

In a narrow pane the header drops the branch chip, program word, buttons and status word, in that order. The dot, mark and name stay.

### The Pane menu

Press "..." or right-click the header.

| Item | What it does |
|---|---|
| Expand pane / Restore pane | Same as the Expand control |
| Split right / Split down | Add a shell in the same folder |
| Close pane | Ends the program |
| Set title… | Gives the pane your own title |
| Clear title | Appears only when you have set a title |
| Copy session ID | Appears only when the session is known |
| Copy terminal ID / Copy pane ID | Puts the id on the clipboard |
| Clear screen | Clears the pane's screen and its scrollback (Ctrl+K). See [Clear and find](#clear-and-find) |
| Find… | Opens the find bar over the pane (Ctrl+F) |
| Copy terminal diagnostics | Puts a scrubbed snapshot of the pane on the clipboard, for a bug report |

## Tabs

A cell with more than one pane shows a tab strip. Each tab has an icon, a status badge, a context ring (how full the AI's memory is), its name and an x to close it.

- Double-click a terminal or agent tab to rename it.
- Middle-click a tab to close it. A pinned tab stays open.
- Right-click a tab for the menu below. Items that would close nothing are greyed out.

| Item | What it does |
|---|---|
| Change title | Renames the tab. Terminals and agents only |
| Pin tab / Unpin tab | Keeps the tab at the front of the strip (see below) |
| Close | Closes this tab (Ctrl+W). Greyed out for a pinned tab |
| Close others | Closes every other tab except pinned ones |
| Close to the right / Close to the left | Closes the tabs on that side except pinned ones |
| Close all | Closes every tab in the strip. It leaves pinned tabs open |

Closing the active tab returns you to the tab you used before it. If there is none, the one to its right, else the one to its left.

If a program is still running, Kolux asks first: "Close "<name>"?" with "A program is still running in it. Closing the tab stops it." Press "Close tab" to go on. This question is on by default and can be switched off in Settings. When a terminal ends by itself, a dialog says "This terminal stopped", says why with the exit code, and offers Close pane or Restart.

Pinned tabs sit before the others with a pin icon. Closing one with Ctrl+W, its x or the pane's close button asks first: "Close pinned tab "<name>"? This tab is pinned. Closing it stops anything still running in it." This question is on by default; switch it off in Settings, Terminal & sessions, "Ask before closing a pinned tab". Pins last until Kolux closes.

The "Remove a Session" shortcut (no key by default; set one in Settings) removes a session that has not started, or an idle shell, at once. For a running agent, or a shell with a program running, it asks first: "Stop "<name>"?". Cancel has the focus, so pressing Enter keeps the session running. Press "Stop" to go on. To stop without asking, set Settings, Terminal & sessions, "Removing a started session" to "Stop without asking".

### Adding panes and tabs

The layout strip's New tab and Preview buttons are gone (owner change 2026-11-06). A pane is added where you want it:

| Do this | How |
|---|---|
| Add a shell beside this pane | "Split right" on the pane header, or Ctrl+Shift+D; "Split down" with Alt+Shift+D |
| Start a new session in a new pane | The pane header's plus, or the sidebar's "New session": pick an agent to start it in a new pane, or "Start agents…" (on the Classic look, "Choose what to run…") to set up one or many first |
| A shell tab in this pane's cell | Ctrl+T |
| The default agent in a new tab | Ctrl+Alt+T; each installed agent also has its own command in the command palette |

## Start agents

"Start agents" (on an empty grid) and "Start agents…" in the plus menu ("Choose what to run…" on the Classic look) set up one or many sessions before they start. On the New look they open the Start form, a page titled "Start" with the project's name and folder. On the Classic look they open a chooser pane instead, headed "Session N" and "Choose what to run", with the same parts.

| Part | Use it to |
|---|---|
| Use last lineup | Repeat the last lineup for this project (appears when there is one) |
| Shape | Pick a built-in or saved arrangement. "Save as team" stores yours under a Team name |
| Folders | Start form only: tick the project folders to start in, or "Add folder" |
| How many | Pick a quick count or type any number, and press "Same for all" to copy one choice to every seat. Start opens every seat as its own pane |
| Folder or Folders | With **Own folder for each agent** on (Settings, Git) in a Git project: "Own folder for each AI", picked for two or more seats, gives each seat its own worktree; "Same folder for all" shares the project folder. With it off, every seat works in the project folder and Kolux makes no extra copies |
| Task for all of them | Optional first request for all sessions |
| Per seat | Pick the AI and its model, and an optional job title |

Several AIs will edit the same files. Give each a separate task, or launch them one at a time.

The Start button reads "Start", or "Start N" for several, and "Starting…" while it works. It stays off until every seat has an AI and model (or Terminal).

## Paste and copy

| Do this | Keys |
|---|---|
| Paste into the focused pane | Ctrl+V, Ctrl+Shift+V or Shift+Insert |
| Copy the selection | Ctrl+Shift+C, or Ctrl+C when text is selected |
| Interrupt the program | Ctrl+C with nothing selected |
| Select all terminal text | Ctrl+Shift+A |

Two switches in Settings, Terminal & sessions add mouse shortcuts: "Copy on select" copies text as soon as you select it, and "Right-click pastes (or copies the selection)" does what it says. See [Settings](settings.md).

A paste goes only to the focused pane. Large pastes are sent in pieces, one after another, so the window and your other panes stay responsive; the program still receives it as one paste. Press Ctrl+C or Esc during a long paste to stop the rest of it. A paste over 8 MB is refused: the header says "Paste of X MB is over the 8.0 MB limit; nothing was sent". If the opening request is still being delivered, your paste waits and goes in after it.

Several lines pasted at once arrive as one paste, so they wait for your Enter instead of running line by line. Git Bash, PowerShell 7, Claude and Codex all work this way. Windows PowerShell 5.1 (the shell new panes open when PowerShell 7 is not installed) cannot: each pasted line would run as it arrives. So when you paste two or more lines into a program that cannot hold them, the pane asks "Paste N lines?" and says "Each line runs as you paste it: this program takes pasted lines one by one." **Cancel** is selected, so a stray Enter pastes nothing; **Paste** sends all the lines, and Esc cancels. A one-line paste, or a paste into a program that holds the lines, never asks. A single line that ends with a line break is typed without the break, so it never runs by itself. Control characters inside a paste are removed, so pasted text cannot end the paste early and run on its own. A paste from the right-click setting goes through the same checks (the size limit, the question and the control-character clean-up).

## Drop files onto a terminal

Drag one or more files from File Explorer and drop them on a pane. Their paths are typed into the pane you dropped on, which need not be the one with the keyboard, with a space between them and no Enter, so you finish the command yourself. While you drag, the pane under the pointer is the target. A dropped image is typed the same way, as a path.

Each path is wrapped in quotes the way that pane's program reads them: single quotes for PowerShell and Git Bash (Git Bash gets the path with forward slashes), double quotes for Command Prompt and for an agent's prompt. The header then says how many were typed, for example "2 paths dropped", and mentions images, but never shows the paths themselves. A path that could be misread is not typed: one holding a hidden control character, or, in Command Prompt and agent prompts, a `$`, backtick, `%`, `!` or curly quote. The header says how many were left out. Dropping on a pane with nothing running in it says "Nothing is running in this pane to drop into".

## Programs that copy to the clipboard

A program running in a pane, such as tmux, Neovim or Zellij, can put text on your Windows clipboard by itself (the "OSC 52" way of copying), so a yank inside it can be pasted anywhere. This is always on. A program can never read your clipboard back: if it asks, Kolux answers with nothing. A single copy bigger than about 75 KB of text is dropped, and the pane's header says so once; it also says once if Windows would not confirm a copy. A pane you cannot see (another tab) never touches the clipboard.

## Clear and find

**Clear Screen** (Ctrl+K, or the Pane menu) clears the pane's screen and its scrollback. If the find bar is open it searches again. The transcript Kolux keeps for the session is left as it is.

**Find** (Ctrl+F, or Find… in the Pane menu) opens a find bar at the top right of the pane. It searches everything the pane still holds, scrollback included.

| Control | What it does |
|---|---|
| Find box | Type to search as you go. Matches are marked in the pane and the current one is selected |
| Count | "3 of 12", or "No matches". With more than a thousand matches it reads, for example, "3 of 1000+" |
| Enter or ↓ / Shift+Enter or ↑ | Next / previous match. F3 and Shift+F3 do the same while you are in the bar |
| Aa | Match case |
| .* | Treat the text as a regular expression. A pattern that is not valid says "Invalid pattern", and one that takes too long is stopped and says "Pattern took too long" |
| Close (or Esc) | Closes the bar and removes the marks |

## Links in output

Web addresses, `file://` links and file paths printed in a pane are links. A plain click still selects text; **Ctrl+click** opens the link. Hover over one and a hint under the pane says what Ctrl+click will do.

- A web address opens in your default browser, even when the address wraps over two lines.
- A file path, such as `src/app.ts:42` or `C:\work\notes.txt`, is read against the pane's folder and opened with the program Windows uses for that kind of file. It must be an existing file. A path on another computer is refused, and a program file is shown in its folder instead of being run (see [Safety](safety.md)). The `:42` is not used: Kolux has no editor of its own to jump to a line.
- A link a program prints on purpose (PowerShell does this) is clickable too.

## New lines and other keyboards

In a Claude or Codex pane, **Shift+Enter** (or Ctrl+Enter) puts a new line in your prompt instead of sending it; plain Enter still sends. In a shell pane Enter stays Enter. A pane that began as an agent but fell back to a shell counts as a shell.

When you type Korean, Chinese or Japanese with an input method, the word is sent once when you finish composing it. Nothing is sent halfway through, and a word you cancel sends nothing.

## Status words

The same words appear in pane headers, tabs and the sidebar.

| Word | Meaning |
|---|---|
| Working | The agent is working on its turn |
| Working (background) | The turn is over, but Kolux is watching the agent's background tasks. Shown as "Working" |
| Needs you | It asked a question, or needs permission for a tool. Every question it asked shows with it; for a plan, its first line |
| Blocked | It cannot go on: a limit, a sign-in or an error. Open the pane to see why |
| Interrupted | The turn was stopped before it finished: you pressed Esc or Ctrl+C and no finish arrived within about 3 seconds. If the agent then starts a new step, it goes back to Working, so a Ctrl+C that only cleared what you were typing does not leave it Interrupted. The tool that was running when you pressed the key finishing up does not count as a new step. With Claude Code, a finish that arrives after the key press, even a late one, shows Done instead, because Claude Code sends no finish for a turn it really stopped. Otherwise it stays until your next prompt |
| Failed | The program could not start |
| Done | The agent finished its turn. Clearing a session (/clear) or compacting it by hand also shows Done, without a notification |
| Idle | Nothing is running here |
| Queued | Waiting for its turn to start |
| Quiet for a while | No status has arrived from this agent for a while: it printed nothing for some minutes, or, while working, sent no status for 30 minutes. It clears with the next status |
| Starting | The program is starting up |
| Lost contact | Kolux cannot talk to this agent |
| Stopped | The program has stopped. A session held by a limit or a sign-in reads Stopped too, with the cause on its line |

A plain shell reads "Ready" while it runs and "Ended (code)" after it exits.

Claude Code and Codex report their state through status hooks (the switch "Show what each agent is doing" in Settings, Agents). For every other agent, and for Claude Code and Codex until their hooks report, Kolux reads the state from the title the program gives its terminal and from what its screen shows (a permission or question menu reads Needs you). A spinner or a word such as "thinking" reads Working, "ready" or "idle" reads Done, and "permission", "waiting" or "action required" reads Needs you. Gemini CLI's own title icons count too: ✦ reads Working, ✋ reads Needs you and ◇ reads Done, whatever words follow them. A title it does not recognise, such as a folder path, changes nothing. The first real status replaces the guess.

A program can also report its own status by printing a hidden code (OSC 9999, with the state working, done, permission, waiting or idle). Kolux reads it and never shows it on screen. Any program running in the pane can print it, so this status is the program's own word, not proof.

## Notifications

Kolux tells you when:

- an agent finishes ("<tab> finished") or a helper agent's turn ends,
- an agent needs permission,
- a turn is interrupted,
- an agent stops: limit reached, sign in again, or the AI hit an error (with a "Resets at …" time when known),
- a session goes quiet: "<tab> has gone quiet for N min", "No terminal output since then. It may be stuck."

When several repositories have agents running, the title includes the repository name. You get a desktop notification only when the pane is out of view or the window is not in front. A toast appears in the app, and an unread mark sits on the tab and workspace until you view it. The switches are in [Settings](settings.md#notifications).

## Keyboard shortcuts

On Windows, the main key is Ctrl. The keys live in a file you own, `keybindings.json` in a `.kolux` folder in your user folder; change a key there and Kolux reads the file again. Settings has no page for them any more.

| Keys | What it does |
|---|---|
| Ctrl+, | Open Settings |
| Ctrl+B | Hide or show the left sidebar |
| Ctrl+L | Hide or show the right sidebar |
| Ctrl+Shift+P or Ctrl+Shift+J | Open Go to / Run a command |
| Ctrl+Shift+Up / Ctrl+Shift+Down | Previous / next row in the sidebar list |
| Ctrl+Shift+0 | Focus the project list |
| Ctrl+1 to Ctrl+9 | Select the sidebar row at that position |
| Ctrl+N or Ctrl+Shift+N | Create a workspace. Kolux now works in one folder per project, so the sidebar shows no form for it |
| Ctrl+Shift+Backspace | Delete the worktree the focused pane works in (it asks first). A project's own folder is never deleted. While Own folder for each agent is off, it only says worktrees are off |
| Ctrl+Alt+Left / Ctrl+Alt+Right | Back / forward through workspaces |
| Ctrl+F6 | Move the keyboard out of a terminal to the top bar |
| Ctrl+J | Jump to the next session that needs you |
| Ctrl+T | New shell tab |
| Ctrl+Alt+T | New tab with the default agent |
| Ctrl+Shift+T | Reopen the tab you closed last |
| Ctrl+Shift+K | Search open tabs |
| Ctrl+Shift+G | Rename the active tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Previous / next tab in the order you used them |
| Alt+1 to Alt+9 | Select the tab at that position |
| Ctrl+W | Close the tab, or the pane |
| Ctrl+] / Ctrl+[ | Focus next / previous pane |
| Ctrl+Shift+D / Alt+Shift+D | Split right / split down |
| Ctrl+Shift+Enter | Expand or restore the pane |
| Ctrl+V, Ctrl+Shift+V, Shift+Insert | Paste |
| Ctrl+Shift+C | Copy selection |
| Ctrl+Shift+A | Select all terminal text |
| Ctrl+F | Find text in the focused pane |
| Ctrl+K | Clear the focused pane's screen and scrollback |
| Ctrl+Alt+= / Ctrl+Alt+- / Ctrl+Alt+0 | Zoom the whole interface in, out, or back to 100 % |

### Who gets a key: Kolux or the terminal

A terminal program such as a text editor in the shell may want the same keys Kolux uses. The `terminalShortcuts` setting in `settings.json` decides who wins while a terminal pane has focus: `"kolux"` (the default) or `"terminal"`. Settings has no switch for it any more.

| Choice | What happens |
|---|---|
| Kolux first (default) | Every Kolux shortcut keeps working while you type in a terminal |
| Terminal first | Only the commands marked safe for terminals fire. Every other key goes to the program in the terminal |

With "Terminal first", Kolux still keeps Ctrl+V, Ctrl+Tab, Ctrl+PageUp, Ctrl+PageDown and Alt+1 to Alt+9. It also keeps Ctrl+, (Settings), the interface zoom keys, copying a selection, and the split keys. The choice covers every terminal pane.

Keys that no Kolux shortcut uses always reach the program. Ctrl+R opens the shell's history search, for example, and Ctrl+Arrow moves by word. Alt+Left and Alt+Right move by word too. Ctrl+C with nothing selected is the program's interrupt. Ctrl+K and Ctrl+F belong to Kolux (clear and find); with "Terminal first" they go to the program instead, because they are not marked safe for terminals. A key you press while composing text with an input method is never taken by a Kolux shortcut.

<!-- verified against: src/chrome/LayoutStrip.tsx, src/usage/WorkspaceSpend.tsx, src/usage/workspaceRibbon.ts, src/chrome/TopBar.tsx, src/App.tsx, src/terminal/TerminalPane.tsx, src/terminal/PaneMenu.tsx, src/terminal/paste.ts, src/terminal/permissionAnswer.ts, src/terminal/pin.ts, src/terminal/remove.ts, src/terminal/status.ts, src/terminal/layout.ts, src/launch/ChooserPane.tsx, src/keys/actions.ts, src/keys/terminalPolicy.ts, src/settings/TerminalPage.tsx, src/terminal/text.ts, src/terminal/drop.ts, src/terminal/osc52.ts, src/terminal/find.ts, src/terminal/FindBar.tsx, src/terminal/shellKeys.ts, src/terminal/links.ts, src-tauri/src/terminal.rs, src-tauri/src/pty.rs, PLAN.md, src/launch/PlusMenu.tsx, src/shell/window/Grid.tsx, src/terminal/paneActions.ts, src/launch/startForm.ts, src/shell/window/Content.tsx, src/keys/useWindowKeys.ts, src/projects/deleting.ts, src/projects/ProjectsPanel.tsx, src/projects/singleFolder.ts, src/terminal/grid.ts, src/launch/launchActions.ts at bf88bbb3 -->
