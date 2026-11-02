# Terminals

Use the Terminals view to run agents and shells in a grid of panes, split and resize them, group them in tabs, and paste into the one you are working in.

## The pane grid

Each workspace (a branch in its own folder) has its own grid. The grid holds up to 12 panes. It picks columns by count: 1 pane is one column, 2 panes two, up to 4 panes two columns, up to 9 panes three, and more than that four.

An empty workspace shows "No terminal open here." with two buttons: "Open a shell" and "Choose what to run".

### Layouts

The Layout strip has four buttons: 1, 2, 4 and 6. Press one to set the pane count.

| Action | Result |
|---|---|
| Grow (for example 2 to 4) | Empty panes are added |
| Shrink (for example 4 to 2) | Panes that were never started are removed |
| Shrink past a started session | Blocked. A toast says "<name> is a started session: close it to go smaller." |

At 3, 5 or more than 6 panes no layout button is pressed. New workspaces start with the pane count set in Settings.

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
| Status word | Working, Needs you, Done and so on. See [Board, Agents and Inbox](board-agents-inbox.md) |
| Approve / Deny | Shown in an agent pane while its agent asks permission to use a tool, and only when the agent's status hooks reported that request and named the tool. Approve answers yes in that agent, Deny answers no. Once you click one, or type a key into the pane that reaches the program, both buttons go away and come back for the agent's next request. If the request has already gone, nothing is sent and the header says "The prompt has gone; nothing was sent". Shell panes never show them |
| "restored" mark | The pane came back after a restart. A key press or click clears it |
| Crew label | For example "2 agents, 1 waiting", when an agent has helpers |
| Age | "just now", then "5m ago", after a turn finishes |

On the right sit the plan text (5-hour and weekly windows), a "Review plan" button when a plan is waiting, the "..." Pane menu, Expand, "Split right", "+" (start a new session in a new pane) and Close pane (Ctrl+W, which ends the program).

In a narrow pane the header drops the branch chip, program word, buttons and status word, in that order. The dot, mark and name stay.

### The Pane menu

Press "..." or right-click the header.

| Item | What it does |
|---|---|
| Expand pane / Restore pane | Same as the Expand control |
| Split right / Split down | Add a shell in the same folder |
| Close pane | Ends the program |
| Set Title… | Gives the pane your own title |
| Clear Pane Title | Appears only when you have set a title |
| Copy Session ID | Appears only when the session is known |
| Copy Terminal ID / Copy Pane ID | Puts the id on the clipboard |
| Clear Screen | Clears the pane's screen and its scrollback (Ctrl+K). See [Clear and find](#clear-and-find) |
| Find… | Opens the find bar over the pane (Ctrl+F) |
| Copy terminal diagnostics | Puts a scrubbed snapshot of the pane on the clipboard, for a bug report |

## Tabs

A cell with more than one pane shows a tab strip. Each tab has an icon, a status badge, a context ring (how full the AI's memory is), its name and an x to close it. An editor tab also shows a dot while it has unsaved text.

- Double-click a terminal or agent tab to rename it.
- Middle-click a tab to close it. A pinned tab stays open.
- Right-click a tab for the menu below. Items that would close nothing are greyed out.

| Item | What it does |
|---|---|
| Rename tab | Terminals and agents only |
| Pin tab / Unpin tab | Keeps the tab at the front of the strip (see below) |
| Close | Closes this tab (Ctrl+W). Greyed out for a pinned tab |
| Close others | Closes every other tab except pinned ones |
| Close to the right / Close to the left | Closes the tabs on that side except pinned ones |
| Close all | Closes every tab (Ctrl+Alt+W). Close all, from the menu or the shortcut, leaves pinned tabs open |

Closing the active tab returns you to the tab you used before it. If there is none, the one to its right, else the one to its left.

If a program is still running, Kolux asks first: "Close "<name>"?" with "A program is still running in it. Closing the tab stops it." Press "Close tab" to go on. This question is on by default and can be switched off in Settings. When a shell ends by itself, a dialog says "The shell ended with exit code N" and offers Close pane or Restart.

Pinned tabs sit before the others with a pin icon. Closing one with Ctrl+W, its x or the pane's close button asks first: "Close pinned tab "<name>"? This tab is pinned. Closing it stops anything still running in it." This question is on by default; switch it off in Settings, Terminal & sessions, "Ask before closing a pinned tab". Pins last until Kolux closes.

The "Remove a Session" shortcut (no key by default; set one in Settings) removes a session that has not started, or an idle shell, at once. For a running agent, or a shell with a program running, it asks first: "Stop "<name>"?". Cancel has the focus, so pressing Enter keeps the session running. Press "Stop" to go on. To stop without asking, set Settings, Terminal & sessions, "Removing a started session" to "Stop without asking".

### The New tab menu

The "New tab" button opens beside the focused pane.

| Item | What it opens |
|---|---|
| Terminal | A shell. One entry for each shell Kolux found; the first is Ctrl+T. On Windows the first is the default shell you chose in Settings, Terminal & sessions, else the automatic pick. If the first shell will not start, Kolux tries the others in turn and the new pane says so in one dim line: "<shell> did not start; opened <shell>" |
| Choose agent… | A pane that asks which AI, model or terminal to run. Nothing starts until you press Start |
| An installed agent | That agent directly |
| Browser | A web page tab (Ctrl+Shift+B) |
| New markdown file / Open markdown file… | Notes tabs (Ctrl+Shift+M, Ctrl+Shift+O) |

Files and diffs are covered in [Files and browser](files-and-browser.md).

## Choose what to run

The chooser pane, titled "Choose what to run", sets up one or many sessions before they start.

| Part | Use it to |
|---|---|
| Use last lineup | Repeat the last lineup for this project (appears when there is one) |
| Shape | Pick a built-in or saved arrangement. "Save as team" stores yours under a Team name |
| Sessions | Pick a quick count, or type any number, and press "Same for all" to copy one choice to every seat |
| Folders | "Separate copy for each AI" gives every session its own workspace. "Same folder for all" shares one |
| Task for every seat | Optional first request for all sessions |
| Per seat | Pick the AI and its model, and an optional job title |

If you share a folder between several AIs, Kolux warns "Several AIs would be editing the same files at once." and offers "Give each its own copy". Separate copies need a Git project.

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
- A file path, such as `src/app.ts:42` or `C:\work\notes.txt`, is read against the pane's folder and opened with the program Windows uses for that kind of file. It must be an existing file. A path on another computer is refused, and a program file is shown in its folder instead of being run (see [Safety](safety.md)). The `:42` is not used yet; the editor does not jump to a line from here.
- A link a program prints on purpose (PowerShell does this) is clickable too.

## New lines and other keyboards

In a Claude or Codex pane, **Shift+Enter** (or Ctrl+Enter) puts a new line in your prompt instead of sending it; plain Enter still sends. In a shell pane Enter stays Enter. A pane that began as an agent but fell back to a shell counts as a shell.

When you type Korean, Chinese or Japanese with an input method, the word is sent once when you finish composing it. Nothing is sent halfway through, and a word you cancel sends nothing.

## When an automation's pane ends

When an automation run's agent finishes and its pane closes or the program exits, Kolux keeps the pane's last text with the run before the terminal's log goes. You read it later as the run's **Saved output** (see [Automation runs](board-agents-inbox.md#automation-runs)).

## Keyboard shortcuts

On Windows, the main key is Ctrl. You can change every shortcut in Settings (see [Settings](settings.md)).

| Keys | What it does |
|---|---|
| Ctrl+, | Open Settings |
| Ctrl+B | Hide or show the left sidebar |
| Ctrl+L | Hide or show the right sidebar |
| Ctrl+Shift+E | Show Explorer in the right sidebar |
| Ctrl+Shift+G | Show Source Control in the right sidebar |
| Ctrl+Shift+J | Open the worktree switcher |
| Ctrl+Shift+Up / Ctrl+Shift+Down | Previous / next worktree |
| Ctrl+Shift+0 | Focus the worktree list |
| Ctrl+1 to Ctrl+9 | Select the workspace at that position |
| Ctrl+N or Ctrl+Shift+N | Create a workspace |
| Ctrl+Shift+Backspace | Delete the workspace (it asks first) |
| Ctrl+Alt+Left / Ctrl+Alt+Right | Back / forward through workspaces and pages |
| Ctrl+J | Jump to the next session that needs you |
| Ctrl+T | New shell tab |
| Ctrl+Shift+B | New browser tab |
| Ctrl+Shift+M / Ctrl+Shift+O | New / open markdown file |
| Ctrl+W | Close the tab, or the pane |
| Ctrl+Alt+W | Close all tabs |
| Ctrl+] / Ctrl+[ | Focus next / previous pane |
| Ctrl+Shift+D / Alt+Shift+D | Split right / split down |
| Ctrl+Shift+Enter | Expand or restore the pane |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset the focused terminal |
| Ctrl+V, Ctrl+Shift+V, Shift+Insert | Paste |
| Ctrl+Shift+C | Copy selection |
| Ctrl+Shift+A | Select all terminal text |
| Ctrl+F | Find text in the focused pane |
| Ctrl+K | Clear the focused pane's screen and scrollback |

### Who gets a key: Kolux or the terminal

A terminal program such as a text editor in the shell may want the same keys Kolux uses. Settings, Shortcuts, "Shortcuts in terminals" decides who wins while a terminal pane has focus.

| Choice | What happens |
|---|---|
| Kolux first (default) | Every Kolux shortcut keeps working while you type in a terminal |
| Terminal first | Only the commands marked safe for terminals fire. Every other key goes to the program in the terminal |

With "Terminal first", Kolux still keeps Ctrl+V, Ctrl+Tab, Ctrl+PageUp, Ctrl+PageDown and Alt+1 to Alt+9. It also keeps Ctrl+, (Settings), Ctrl+Alt+A (the floating terminal), the zoom keys, copying a selection, and the split keys. On the Shortcuts page, a command held back this way carries a "Goes to the terminal" badge. The choice covers every terminal pane, including the floating terminal.

Keys that no Kolux shortcut uses always reach the program. Ctrl+R opens the shell's history search, for example, and Ctrl+Arrow moves by word. Alt+Left and Alt+Right move by word too. Ctrl+C with nothing selected is the program's interrupt. Ctrl+K and Ctrl+F belong to Kolux (clear and find); with "Terminal first" they go to the program instead, because they are not marked safe for terminals. A key you press while composing text with an input method is never taken by a Kolux shortcut.

<!-- verified against: src/chrome/LayoutStrip.tsx, src/chrome/TopBar.tsx, src/App.tsx, src/terminal/TerminalPane.tsx, src/terminal/PaneMenu.tsx, src/terminal/paste.ts, src/terminal/permissionAnswer.ts, src/terminal/pin.ts, src/terminal/remove.ts, src/terminal/status.ts, src/terminal/layout.ts, src/launch/ChooserPane.tsx, src/keys/actions.ts, src/keys/terminalPolicy.ts, src/settings/ShortcutsPage.tsx, src/settings/TerminalPage.tsx, src/terminal/text.ts, src/terminal/drop.ts, src/terminal/osc52.ts, src/terminal/find.ts, src/terminal/FindBar.tsx, src/terminal/shellKeys.ts, src/terminal/links.ts, src-tauri/src/terminal.rs, src-tauri/src/automations.rs, PLAN.md (T-221, T-222, T-151-b, T-140-b), src-tauri/src/pty.rs at 73f5e38 -->
