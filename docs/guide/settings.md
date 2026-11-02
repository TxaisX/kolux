# Settings

Change how Kolux looks, which agents it offers, when it notifies you, and which keys do what. Open Settings with Ctrl+, , or from the Settings buttons on the Agents screen and the project rows. It opens as a full-page overlay and remembers the last page you used. Press Esc or the x to close it.

Changes save as you make them. They live in `settings.json` in Kolux's data folder, `%APPDATA%\com.txaisxiong.kolux-rs`. The right-hand column of each table shows the name a setting has in that file, which helps if someone asks you to check it.

## The pages

| Page | What it controls |
|---|---|
| General | Which look Kolux uses, which screen it opens on, confirmations, diagnostics, privacy |
| Appearance | Colours, interface zoom, fonts, terminal text, the sidebar buttons, status bar |
| Accounts & keys | Signing in to Claude, Codex and Grok |
| Agents | Which agents are on, how they start, whether they ask permission |
| Terminal & sessions | How many panes a new workspace has, terminal text and cursor, scrolling, the clipboard, the default shell, close warnings, pinned tabs, removing a running session |
| Git & worktrees | Branch names, Source Control, commit messages |
| Safety | A short note on protected commands (see [Safety](safety.md)) |
| Notifications | What alerts you, and how |
| Shortcuts | Every command and its keys |
| Usage | Activity counts and token use |

Below those, a Repositories group lists one small page for each project you have added.

## Search all settings

The box at the top of the page list says "Search settings". Press Ctrl+F to jump to it. Type a word and the page list shrinks to the pages with a match. The right side then shows each matching page with only its matching sections, and Appearance sections that hold a match open by themselves. Everyday words work: "dark" finds Mode, and "bigger" finds Zoom. A language also matches its own name, such as Français. A search over 100 characters is refused with "That search is too long: 100 characters at most." When nothing matches, the page says "No setting matches." Esc in the box clears the search. Opening Settings again, from a link or a shortcut, also clears an old search.

The search knows the Editor and diffs, Open in and Network proxy cards by everyday words too ("autosave", "minimap", "vscode", "firewall", "corporate"). The Terminal colours section turns up for "warp" and "ghostty".

## General

| Setting | Choices | Saved as |
|---|---|---|
| Look | Classic or New. A fresh profile starts on New; an older profile that never chose stays on Classic | `uiLook` |
| Opens first | Agents, Board or Terminals. Default is Terminals. Under Classic only Terminals is offered | `firstScreen` |
| Review notes | On by default. Select text in a file and press Ctrl+Shift+A to leave a note for an agent | `markdownReviewNotes` |
| Needs you strip | On by default. Shows the strip of agents waiting for you above the panes | `needsStrip` |

### Confirmations

This card has one switch, "Ask before deleting an automation". Some questions offer a "don't ask again" choice. The card lists the ones you have skipped, for example "Not asking before closing a terminal that is running a program.", or says "Every confirmation is asked." when none are skipped. "Ask again for all" turns every skipped question back on. It is greyed out when none are skipped.

### Editor and diffs

Preferences for the built-in editor and the diff views.

| Setting | Choices | Saved as |
|---|---|---|
| Save files by themselves after typing stops | Off. When on, a "Wait before saving (ms)" box appears: 200 to 10,000, default 1,000 | `editorAutoSave`, `editorAutoSaveDelay` |
| Minimap beside the editor | Off | `editorMinimap` |
| Word wrap in the editor | On | `editorWordWrap` |
| Spellcheck in rich markdown | On | `markdownSpellcheck` |
| Diffs open | Inline (default) or Side by side | `diffView` |
| Word wrap in diffs | Off. Separate from the editor's word wrap | `diffWordWrap` |
| Show changes made only of whitespace | Off, so a line that only moved spaces or tabs is hidden | `diffShowWhitespace` |
| File tree beside the combined diff | Off | `diffFileTree` |

**Not wired up yet.** This build saves these choices, but the editor and the diff views do not read them yet, so changing one has no visible effect for now. The editor's font is a different setting and does work: see Editor font under [Interface](#interface).

### Open in

The apps that every "Open in" menu is meant to list (for a workspace, a file, and the shortcuts file). The card shows your list in order, each with its command, and Up, Down and Remove buttons. Until you change it the list is File Explorer and Visual Studio Code.

- **Add an app** picks from the presets: File Explorer, Visual Studio Code, Cursor, Windsurf, Zed, Sublime Text, IntelliJ IDEA and Windows Terminal. Presets already in the list are not offered again.
- **Add custom app** takes a name (60 characters at most) and a command (300 at most), for example `gvim --remote`. The button stays off until both boxes are filled in.

Saved as `openInApps`.

**Not wired up yet.** The list saves, but the Open in menus do not read it yet.

### Network proxy

For a network that makes you go through a proxy. The card is folded shut when no proxy is set.

| Part | What it does |
|---|---|
| Proxy address | `host:port` or `http://host:port`. Schemes allowed: http, https, socks5 and socks5h. A path after the port is refused |
| Do not use the proxy for | Hosts that go direct, separated by commas, spaces or new lines: names such as `localhost`, wildcards such as `*.corp.example`, addresses and ranges such as `10.0.0.0/8`, `<local>`, or `*`. Saved as `httpProxyBypass` |
| HTTP/1 only | Off. Helps on networks that break newer protocols. Saved as `httpProxyHttp1` |
| Apply, Clear proxy | Apply checks everything first and shows every mistake at once. Clear proxy is on only when a proxy is set |

The address is sealed in the system keyring (see [Secrets](safety.md#secrets)); it is not saved in the clear in `settings.json` and is never shown back. Once one is set the card says so. To change the other two parts and keep the address, leave the address box empty and press Apply; type a new address to replace it.

**Not wired up yet.** The card says "Kolux's own traffic goes through it", but this build only stores the proxy: update checks and downloads do not use it yet.

### Diagnostics

Three buttons gather a report for troubleshooting. Keys, passwords and tokens are replaced with `[masked]`. Nothing is sent anywhere; you copy the report yourself. See [Troubleshooting](troubleshooting.md).

### Privacy

This card lists every outside connection Kolux can make:

- GitHub Releases, to check for updates.
- Your Git remotes and the GitHub account you set up.
- The AI providers you connected.
- Sites you open in a browser tab.
- Script libraries from public hosts (cdnjs, jsdelivr, unpkg, tailwindcss, jquery), only when you save a web page for offline use.
- Microsoft, through the WebView2 browser engine Windows provides. It runs startup checks that Kolux cannot switch off.

Kolux sends no usage data, and no server exists to receive it. "Send feedback" opens a new-issue page on GitHub in your browser; the app submits nothing itself.

## Appearance

The page has three sections, all open at first: Interface, Terminal, and Window & Sidebar. A section you fold shut shows a one-line summary after its title. The Terminal one names the terminal font (the built-in font until you pick another), its size and the colour scheme.

### Interface

| Setting | Choices | Saved as |
|---|---|---|
| Mode | System, Light or Dark. New profiles start on Dark | `appearanceMode` |
| Mode per screen | Agents, Board and Terminals can each use "Same as app", System, Light or Dark | `screenThemes` |
| Language | System, English, 简体中文, 한국어, 日本語, Español, Français. Only dates and sorting follow it; Kolux's own words stay in English | `language` |
| Zoom: Interface size | Buttons for smaller (−), larger (+) and Reset, with the current percentage between them. It runs from 58 % to 249 %; the default is 100 % | `uiZoom` |
| Colour theme | Classic, or one of 16 colours: ember, copper, sand, moss, fern, jade, teal, lagoon, sky, cobalt, indigo, iris, violet, orchid, rose, graphite | `appTheme` |
| Tint | -180 to 180 degrees, default 0. Not available on Classic | |
| Saturation | 0 to 160 percent, default 100. Not available on Classic | |
| Depth | -3 to 6, default 0. Not available on Classic | |
| App font | Any installed font; default is the built-in font | `appFont` |
| Editor font | Same as the terminal font, or any installed font | `editorFont` |

### Terminal

| Setting | Choices | Saved as |
|---|---|---|
| Terminal font | Any installed font | `terminalFont` |
| Size | 8 to 32 points, default 13 | |
| Line height | 1 to 2, default 1 | |
| Weight, Bold weight | Normal, bold, or 100 to 900. Defaults: normal and bold | |
| Terminal colours | A searchable list of schemes, one for dark mode and one for light. "Match app theme" picks one for you. "Add scheme" takes a Windows Terminal colour scheme pasted as JSON | |
| Light scheme in light mode | On by default | `terminalLightScheme` |
| Divider width | 2 to 12 pixels, default 6 | `dividerWidth` |
| Divider colour | One for dark mode, one for light; empty by default | |
| Panes not in focus | 30 to 100 percent, default 100 (no dimming) | |

#### Bring in colours from Warp or Ghostty

Under Terminal colours, "Bring in from Warp or Ghostty" lets you reuse colour schemes from those two terminals. Choose one or more files: Warp theme files (`.yaml`) or your Ghostty configuration file. Nothing changes yet. Each file is read and previewed as a row with a tick box, a small colour sample and a note saying either "Joins your custom schemes." or "Replaces your scheme <name>." (a scheme of the same name is swapped). With more than one usable file a "Select all" box appears. Tick the ones you want and press "Bring in" (it shows the count). "Cancel" drops the preview.

- A Warp theme needs a background, a foreground and its terminal colours (normal and bright). The scheme takes the theme's own name, or the file name when it has none. The theme's accent becomes the cursor colour.
- From a Ghostty configuration Kolux reads the background, foreground, cursor, selection and the first 16 palette colours. A configuration that only names one of Ghostty's built-in themes sets no colours of its own, so it is refused with a note saying so.
- A file that cannot be read says why next to its name, and a file whose colours already match your current terminal colours is listed as nothing to apply.
- You can keep up to 40 custom schemes. When the list is full a new one is "Not added" with a note to remove one first; replacing a scheme with the same name still works.

The View menu zooms text with Ctrl+= , Ctrl+- and Ctrl+0. Zoom affects only the focused terminal.

The Zoom control under Interface is the only way to change the size of the whole window. Text and controls grow or shrink together. The choice is saved and applied again at the next start. The Ctrl+= keys do not change it.

### Window & Sidebar

| Setting | Default | Saved as |
|---|---|---|
| Show app name in the title bar | Off | |
| Show Tasks button | On | |
| Show Automations row in the sidebar | On | |
| Show Skills button in the sidebar | Off | `skillsButton` |
| Draw terminals with the GPU (up to six at a time; applies to new terminals) | On | `terminalGpu` |
| Show status bar | On | `statusBarVisible` |
| Status bar items: Agent status, Resource Manager, Terminals running, Agents running (tick the ones you want) | All shown | `statusBarHidden` |
| Usage percentages: Used or Remaining (changes only the Agents screen footer) | Used | `usagePercentages` |

## Accounts & keys

Kolux charges nothing and ships no models or keys. You bring your own sign-in. The page shows one card for each of Claude, Codex and Grok.

- A card for a program you have not installed says "Not installed" and offers Install (through WinGet, Windows' package installer) or "Open install page".
- **Claude:** Connect, Renew, Cancel or Disconnect. Disconnect asks first. "Use my Claude account instead" signs you in through the browser. The switch "Carry on by itself once a usage limit resets" is off by default (`claudeResumeAfterLimit`).
- **Codex:** "Add account", or "Sign in with a code" if the browser route does not suit you.
- **Grok:** "Sign in with a code", or "Use an xAI API key (advanced, pay-per-use)". The key is stored sealed and never shown again.
- **Manage accounts (advanced):** lists your Claude and Codex accounts, so you can name them, for example Personal and Work.

Saved keys and sign-ins are sealed by the system keyring (Windows' secret store). See [Safety](safety.md).

## Agents

| Setting | Choices | Saved as |
|---|---|---|
| Default agent | "Auto: the first agent available", or one installed agent | |
| Agent Permissions | **Yolo** or Manual. Default is **Yolo** | `agentPermissions` |
| Installed agents | A list with a Refresh button. Each has an on/off switch, a "default" mark, and a "How it starts" fold with Command, Default arguments and Environment | `agentOptions` |
| Agent status hooks | On by default, once you have seen the line. The first-run dialog's Connect step (or, on a profile that never answered, a one-time card) shows "Kolux will add its status hooks to each AI's settings, so it can show you which one needs you." beside a switch that starts on; moving on records your answer. Turn it off here or there | `agentStatusHooks` |
| Hold Claude and Codex to a 200k context window | On | |
| Prompt-cache timer | Off. When on, "Cache length" is 5 minutes (default) or 1 hour | |

**Agent Permissions matters.** Under Yolo, Claude Code starts in its automatic mode, where its own safety check approves routine actions and still stops risky ones. Codex starts with no approval prompts but inside its sandbox (the walled-off area it works in): it can change files only in the workspace's own folder. By default the sandbox also keeps its commands off the internet and away from Git's own records, so Codex can edit files but cannot commit, install packages or push. Such a command fails and Codex is told why; it does not ask you. Choose Manual if you want each agent to ask before it acts.

**Agent status hooks** are small scripts Kolux puts in an agent's settings so the agent can tell Kolux what it is doing. The switch starts on, but nothing is written before you have seen the line above (on the Connect step or the one-time card); switching it off takes Kolux's entries out again. While the switch is off, the Board and Agents pages cannot show live status. The hooks badge in the status bar shows whether this switch is On or Off. The switch also shows the path of Claude Code's settings file and any problem found.

### Hooks for Gemini CLI, Antigravity and Amp

Besides Claude Code and Codex, Kolux can install status hooks for Gemini CLI, Antigravity and Amp. A status hook is a small script the agent program runs at each event (a turn starting, a tool running, a turn ending); it tells Kolux whether the agent is working, waiting or done, and that drives the status dot. All five agents follow the same rules:

- **One master switch.** "Agent status hooks" starts on, and your answer to the consent line is what turns it on or off for real. While it is off, Kolux removes its entries from every agent and installs none.
- **One switch per agent.** Each agent in the "Installed agents" list has its own on/off switch. An agent switched off there has Kolux's entries taken out, even while the master switch is on.
- **Only agents Kolux finds.** Hooks go to an agent that is installed on this computer (or that you pointed the Agents page at). An agent Kolux cannot find is left exactly as it is.
- **The command line does the same.** `kolux agent hooks on`, `off` and `status` cover all five agents and work with Kolux closed. See [Command line](command-line.md).

| Agent | What Kolux changes (inside your user folder) | Kolux's entry |
|---|---|---|
| Gemini CLI | `.gemini\settings.json` | A Kolux hook added under four events: `BeforeAgent`, `AfterAgent`, `BeforeTool` and `AfterTool`. Your own hooks stay |
| Antigravity | `.gemini\config\hooks.json` | A bundle (a named set of hooks) called `kolux-rs`, with entries for `PreInvocation`, `PreToolUse`, `PostToolUse`, `PostInvocation` and `Stop` |
| Amp | `.config\amp\plugins\kolux-rs.js` | A plugin file (a small add-on Amp loads), written whole by Kolux. Its first line says it was written by Kolux RS |

Details that matter when you look at these files:

- **Gemini CLI** runs its hook command through PowerShell on Windows, and Kolux writes the command for that. This is proven on Windows PowerShell 5.1. It is not yet tried on PowerShell 7 or against a real Gemini CLI run; that check is still to come.
- **Antigravity** does not put the event name in what it sends, so Kolux passes the name on the command line. The command is written for the Windows command prompt; which shell Antigravity really uses has not yet been checked against a live run. If you set `"enabled": false` on the `kolux-rs` bundle yourself, Kolux keeps your choice, and `kolux agent hooks status` reports Antigravity as "disabled".
- **Amp** gets a plugin instead of a settings entry. If a file named `kolux-rs.js` is already there and Kolux did not write it, Kolux leaves it alone and reports an error. Edits you make to Kolux's own plugin file are overwritten at the next install.
- **Antigravity's reply text** (the card showing its last answer) is not built yet.

`kolux agent hooks status` lists each of the three with a state: installed, partial, not installed, error, or (Antigravity only) disabled. What the hooks show on the dot is under [Status words](board-agents-inbox.md#status-words); what they send, and how Kolux protects your settings files, is under [Agent status hooks](safety.md#agent-status-hooks) in Safety.

## Terminal & sessions

The first table covers panes and closing. The cards after it cover the terminal's text, scrolling, clipboard and shell.

| Setting | Choices | Saved as |
|---|---|---|
| New workspaces start with | 1, 2, 4, 6, 9 or 12 panes. Default 1. Classic always uses 1 | `defaultPaneCount` |
| Ask Before Closing Running Terminals | On. A tab with only an idle shell always closes at once | `confirmCloseRunning` |
| Ask before closing a pinned tab | On. Pinned tabs sit first in the strip and stay out of Close others, Close all and middle-click | `pinnedTabsAsk` |
| Removing a started session | "Ask first" (default) or "Stop without asking". Applies to Remove session on a running agent or a busy shell. A pane that has not started, or an idle shell, is removed straight away | `removeStartedSession` |

### Terminal text and cursor

A sample terminal at the top of the card shows each change as you make it. Open terminals follow changes at once.

| Setting | Choices | Saved as |
|---|---|---|
| Font size | 10 to 24, default 14. Type a number or use the minus and plus buttons | `terminalFontSize` |
| Font | Any installed font. Empty shows "Default (Cascadia Mono)" | `terminalFont` |
| Weight, Bold weight | Normal, bold, or 100 to 900. Defaults: normal and bold | `terminalFontWeight`, `terminalFontWeightBold` |
| Line height | 1 to 2 in steps of 0.05, default 1 | `terminalLineHeight` |
| Cursor | Block (default), Bar or Underline | `terminalCursorStyle` |
| Blinking cursor | On | `terminalCursorBlink` |
| Minimum contrast: keep text readable on any colour scheme | Off. When on, text keeps at least a 4.5 to 1 contrast against its background | `terminalMinimumContrast` |

A number you type is corrected to the nearest allowed value when you press Enter or leave the box.

### History and scrolling

| Setting | Choices | Saved as |
|---|---|---|
| Scrollback rows | 0 to 100,000, default 1,000 | `terminalScrollback` |
| Scroll sensitivity | 0.1 to 5, default 1 | `terminalScrollSensitivity` |
| Fast scroll (with Alt) | 1 to 20, default 5 | `terminalFastScroll` |

### Clipboard

| Setting | Default | Saved as |
|---|---|---|
| Copy on select | Off | `terminalCopyOnSelect` |
| Right-click pastes (or copies the selection) | Off | `terminalRightClickPaste` |

A right-click paste gets the same checks as a Ctrl+V paste: the size limit, the safe way of pasting several lines and the "Paste N lines?" question (see [Terminals](terminals.md#paste-and-copy)).

### Default shell

This card shows on Windows only. "New terminals open in" lists "Automatic (PowerShell 7 when installed)" and each shell Kolux found on the computer: PowerShell 7, Windows PowerShell, Command Prompt, Git Bash and WSL. Pick one and a new plain terminal, including the one Ctrl+T opens, starts in it. Terminals that are already open keep the shell they started with. Saved as `defaultShell`.

The shell you pick is tried first. If it will not start (it was uninstalled, or Windows refuses it), Kolux goes on to the automatic shells behind it instead of giving up, and the new terminal opens with one dim line such as "<chosen shell> did not start; opened <shell>" so you can see what happened. A choice that is no longer installed leaves the automatic order as it was.

## Git & worktrees

| Setting | Choices | Saved as |
|---|---|---|
| Branch prefix | Your Git user name (or GitHub login), custom text, or none. Default is your Git user name | `branchPrefix`, `branchPrefixCustom` |
| Default compare base | The repository default, or the branch's upstream | `scmSummaryUpstream` |
| Refresh the base first | Off. When on, it fast-forwards the base branch only | `refreshBaseFirst` |
| Source Control group order | Staged first (default) or Changes first. Conflicts always come first | |
| Commit messages written by | Claude Code (default), a custom command with a `{prompt}` placeholder, or Off. An instructions box takes up to 2000 characters | |
| GitHub API budget | Shows how much of GitHub's hourly allowance is left; "Check again" re-reads it | |
| Ask before deleting a workspace | On. A workspace with changes, a lock or a nested workspace always asks | |

A worktree is a separate working copy of a project on its own branch; Kolux calls it a workspace. See [Projects and worktrees](projects-and-worktrees.md).

## Notifications

| Setting | Default | Saved as |
|---|---|---|
| An agent finishes its task or needs permission | On | `notifyOnFinish` |
| A terminal rings its bell | Off | `notifyBell` |
| An agent halts on a usage limit, a lapsed sign-in or a provider error | On | `notifyOnStopped` |
| Stay quiet about the workspace you are looking at | On | `notifySuppressFocused` |
| Sound: System default, Chime, Ping or Pulse | System default | `notificationSound` |
| Volume, 0 to 100 | 100 | `notificationVolume` |
| Usage alerts at 80% and 95% | On | `usageAlerts` |
| Quiet alert minutes: warn when a working terminal goes silent this long. 0 turns it off; the most is 600 | 10 | `quietMinutes` |

Two buttons help you check: "Send a test notification" and "System notification settings" (Windows' own page). See [Board, Agents and Inbox](board-agents-inbox.md) for what each alert looks like.

## Shortcuts

Every command in Kolux has a row here. Your changes are kept in `keybindings.json` in a `.kolux` folder in your user folder. The "Shortcuts file" card at the top shows that path and any error in the file. Three buttons work on the file:

| Button | What it does |
|---|---|
| Open file | Opens the file in the program Windows uses for it. A missing file is written first, with its starting contents |
| Show in folder | Opens the folder with the file selected |
| Reload from Disk | Reads the file again after you edit it by hand |

The "Shortcuts in terminals" card decides who gets a key while you type in a terminal. Pick "Kolux first" or "Terminal first". It is saved as `terminalShortcuts`. See [Terminals](terminals.md) for what each does. With "Terminal first", a row for a command that is held back shows a "Goes to the terminal" badge.

- Filters: All, Modified, Unassigned, Conflicting. The search box matches names and keys.
- Commands are grouped: General, Tabs, Terminal, Browser, Editor, File explorer, Settings.
- Click a key to record a new one. Esc keeps the old one.
- Buttons: Add (a second key for the same command), Disable, Reset. The x removes one key.
- Badges: Modified, Unassigned, Disabled and Conflicts (two commands on one key in the same area).

## Usage

- **Activity:** Agents started, time agents spent working, and pull requests created in Kolux.
- **Token analytics:** tabs for Overview, Claude and Codex; ranges Last 7 days, 30 days, 90 days and All time; and a scope of "Kolux worktrees" or "Every local use". It reads only your agents' own log files on this computer. Token tracking is off until you press Enable Claude or Enable Codex. It also lists tokens By model and Recent sessions.

## Repository pages

Each project has two settings: "New workspaces start from" (blank means the default branch) and "Workspaces folder" (blank means the global folder). The page notes that setup scripts, the display name and the icon come later.

## Scrolling long menus and pickers

The mouse wheel scrolls long menus, pickers and sheets, including the lists inside dialogs. Over such a surface the wheel moves the nearest part, working outward from the pointer, that can still scroll that way. When nothing in the menu can move, the wheel does nothing, so the page behind it does not jump. Ctrl+wheel (zoom) and sideways scrolling are left alone, and a list that sits inline on a page still scrolls its page.

<!-- verified against: src/settings/pages.ts, src/settings/GeneralPage.tsx, src/settings/AppearancePage.tsx, src/settings/AgentsPage.tsx, src-tauri/src/agents.rs, src/settings/GitPage.tsx, src/settings/NotificationsPage.tsx, src/settings/privacy.ts, src/settings/RepoPage.tsx, src/keys/actions.ts, src/terminal/pin.ts, src/terminal/remove.ts, src/terminal/closing.ts, src/terminal/text.ts, src/settings/SettingsPage.tsx, src/settings/TerminalPage.tsx, src/settings/ShortcutsPage.tsx, src/settings/search.ts, src/settings/zoom.ts, src/keys/terminalPolicy.ts, src/chrome/chromeItems.ts, src-tauri/src/keybindings.rs, src-tauri/src/pty.rs, src/terminal/TerminalPane.tsx, src/terminal/paste.ts, src-tauri/src/agent_hooks/mod.rs, src-tauri/src/agent_hooks/vendors.rs, src/settings/editorPrefs.ts, src/settings/openIn.ts, src/settings/proxy.ts, src/settings/importSchemes.ts, src/settings/menuWheel.ts, src/main.tsx at 73f5e38 -->
