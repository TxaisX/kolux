# Changelog

## Unreleased

- **Starting two or more agents opens their panes again.** When Kolux could not make a separate Git folder for the first agent (the folder is not a Git project, or it has no commit yet), nothing opened. The agents now open together in the folder you chose, and a line says why. If a later folder fails after earlier ones were made, the Start still stops and lists them, as before.
- **Kolux no longer remembers folders or tabs between runs.** Each start opens with an empty Folders list and no tabs, and the Start form asks what to open. Files and Git worktrees on disk are not touched. A folder you add again is a new project, so an automation that named it is skipped until you edit it and pick the folder again. "Keep what was open" reads "Not now" when nothing is open, and with the Start form switched off Kolux starts with an empty window. Add `"keepWorkspaces": true` to settings.json for the older behaviour.

## 0.1.17

- **Kolux asks what to open.** When Kolux starts, one Start form asks which folders, how many agents, and which AI and model for each. The same form opens for a new pane and for the first folder you add after setup. The sessions it starts take an empty "pick an agent" pane first, so none is left beside them; an empty pane you already typed a task into is left as it is. Settings › General has "Ask what to open when Kolux starts"; off opens what was open last time.
- **Discard is much more careful.** Discard in All Changes never deletes a folder that took a file's place, never writes or deletes through a folder link, never discards a whole folder at once, and never writes a deleted file back over a newer file of the same name, also when the two names differ only in letter case or by a look-alike letter. Discarding a copied file no longer undoes your changes to the file it was copied from (this could happen when Git is set to detect copies). When it leaves something alone, a yellow line under "Kolux left this as it is:" says why and what to do next. A real failure is red under "Could not discard".
- **Taking a project out of Kolux ends only that project's terminals.** A project inside it that stays keeps its terminals, and so does a worktree another project on the same repository also lists. The question counts only what will close.
- Closing shortcuts such as Ctrl+W wait while you type in a text field, on every keyboard layout and on the number pad.
- The delete shortcut always asks first.
- Resource Manager has one "End all" button. "Restart terminals" is gone.
- A folder's dot in the sidebar turns yellow when one of its agents needs you and green when one has finished and none is still working. A folder where an agent finished while you were elsewhere shows its name in bold.
- When an AI no longer offers a model you picked, the Start form says so and asks you to pick another. A search for agents that takes longer than 10 seconds no longer holds the form up: it shows the last list Kolux found and says so.
- The agent status switch is named "Show what each agent is doing" and says what goes dark when it is off. "Delete Workspace" is now "Delete worktree".
- A commit that fails says "Commit failed:" in red.
- Adding a worktree that fails or is cancelled names the folder it left behind, and clears a folder only when that add made it.
- The leftover code and styles of the old Source Control panel are gone. Its Settings switch now reads "Show the AI actions for Git".
- Under the hood: an agent typed into a plain shell pane shows in `kolux terminal list`; one scheduled automation that cannot start no longer stops the others due at the same time; tokens are compared in constant time.

## 0.1.16

- **One grid per project, with every worktree in it.** Sessions in a project's worktrees open side by side in the project's grid, each cell labeled with a colored chip naming its worktree and branch. The sidebar lists only your project folders. Click a chip for that worktree's menu. The file tree, checks, "open beside" and review notes follow the cell you are working in, and `kolux file open` from an agent in a worktree opens there.
- **The grid remembers which worktree belongs to which project**, so worktree sessions stay in their project's grid after a restart, even with the sidebar closed.

## 0.1.15

- **A team of agents works in one screen.** Start two or more AIs with "Own folder for each AI" and they all open side by side in one grid on the project, each still in its own folder on its own branch. Their folders are not listed in the sidebar. They show up again once no agent is using them, so you can clean them up. After a restart the team comes back in the same grid.
- **Web pages open in your own browser.** Kolux no longer draws web pages itself, which uses far less memory and leaves room to run more agents at once. Links in terminals, ports, review links and HTML previews open in Chrome or your default browser.
- **Terminal text stays readable.** Fixed a bug where open terminals could suddenly show the wrong letters after another terminal opened, took a big paste, or the PC woke from sleep. Every open terminal now redraws its letters right away.
- **The memory number is about Kolux itself.** The figure in the status bar now counts only Kolux's own window and the browser engine inside it, not the agents or shells running in your panes, so it shows what Kolux itself costs.
- **Third-party notices in About.** About Kolux has a "Third-party notices" button that lists the licences of the open-source code Kolux is built with.
- The last "Kolux RS" names are gone: Kolux's settings names (`KOLUX_…`; the old `KOLUX_RS_…` names still work), the hook files it adds for each AI and its log lines all say Kolux now. An upgrade removes the old-named hook file, so hooks do not run twice.
- Experimental: Settings › Terminal has a switch (Windows only, off by default) that draws panes with the Windows Terminal engine. Those panes now use your Kolux colour theme, font, font size and screen scaling, and change when you change them. Menus and dialogs show over them.
- Sidebar rows are easier to read: the white "1 working" count no longer sits on top of the green status, and the second line says just "Working" or "Needs you" instead of "1 agent · Working".
- The sidebar lists each workspace folder with its sessions under it; the folders Kolux makes for each agent no longer appear there. Clicking a session row brings its pane forward.
- New sessions start the agent inside your own shell, the way you would type `claude` yourself, and a start that fails is written to Kolux's log with the program it tried to run.
- The pane header no longer shows the "Context used" ring and percentage.
- A saved language other than English is in place from the first frame, instead of switching after start-up.
- Right-click › Copy works on text you selected outside a text field.
- The Ports list keeps its entries and count when its popover opens or closes, and the Checks tab follows the worktree you are in.
- Typing in a long note no longer redraws its preview on every key, and the Explorer stays quicker in big folders.
- A new terminal shows up faster: Kolux draws it first and switches on the faster graphics right after, so Kolux's own share of opening one fell from about 340 ms to about 70 ms. Most of the wait that remains is Windows PowerShell starting.
- Starting an agent is faster: Kolux looks up the agent's program once instead of up to three times (67 ms down to 18 ms on the test PC).
- The Floor page and the Tower window stop working in the background while Kolux is hidden, and catch up as soon as it is shown.
- Searching Settings no longer reads every page it finds: the Claude setup scan, the GitHub budget, the shell list and the sample terminal, each project's workspace list and the usage log scan now wait until you open the page.
- The shortcut list in Settings filters once per change instead of once per group on every redraw.
- For trying changes: `pnpm local` builds and starts Kolux in a few minutes beside the installed app, with no installer.
- The `kolux` command line drops its web page commands (go to a page, list tabs, set cookies and the like) along with the web pane; saving a page as PDF, HTML previews and the Tower window keep working.
- Under the hood: Kolux has started moving its controls to Base UI 1.9.0, a library that handles keyboard use and screen readers for menus, lists and dialogs. The first ones moved are the right sidebar's tabs, the sidebar's hide menu, the Git page's author picker and the About window. They look and work the same.
- Under the hood: library updates. Math in previews uses KaTeX 0.19.0 (its makers flagged 0.18.11 as a bad release); Markdown reader marked 18.2.0, build tools Vite 8.3.8 and its React plugin 6.3.0, diagram layout cytoscape 3.35.0; on the Rust side the window library wry 0.57.2, notifications plugin 2.8.1, zip 9.5.1 and small fixes in crc32fast, errno, jiff, rustls-pki-types and sqlite-wasm-rs. The rich editor moves to Lexical 0.53; notes still save exactly what you typed.

## 0.1.14

- **New session: pick each seat's AI from a grid of tiles.** Claude Code, Codex, OpenCode, Grok, Terminal and Other sit in a 3-wide grid, each with a large logo and its name underneath.
- OpenCode and Grok now show their own logos (from each company's official brand kit), and the Codex logo is drawn as large as the others.

## 0.1.13

Agents no longer trip over each other:
- **Own folder for each agent, on by default.** In a Git project, each agent you launch works in its own copy of the project on its own branch, made on this computer, so two agents never overwrite each other's files. Turn it off in Settings › Git & worktrees to have every agent share the project's folder. If you turned it off before, it stays off.

A glassy look:
- **Glass is now the look Kolux opens with.** The bars and panels are see-through over still, soft light in a colour you choose (Sapphire to start with), edges catch the light, and the pane you are working in is lit. Terminals and editors keep their solid ground, and text stays as readable as before. Menus and small dialogs are frosted.
- Change the colour and strength, or go back to Flat, in Settings › Appearance › Finish.
- Go to / Run a command, tab search and the file pickers open as fast under Glass as under Flat (24 ms on the test build; they used to blur the whole area behind them, which took up to twice as long).
- On Linux, Glass no longer takes about twice as long to draw as Flat: its edge lines and soft shadows are drawn a cheaper way. The focused pane now has a crisp ring of your colour in place of a soft glow, and in light mode panes no longer throw a soft shadow.
- The glass costs less to draw: its background light is worked out once instead of on every redraw, so switching screens under Glass is close to Flat. Measured on a test build that draws without a graphics card: opening the Inbox under Glass took 96 ms and now takes 32 ms; Flat takes 24 ms.
- "Blur the window background" (Windows' own material behind the window) now does something when you turn it on; it stays off unless you choose it.
- Narrow panes keep their name and their Close button, the command box in the top bar stays on one line, and the Explorer's file list no longer starts halfway down its panel.

Quicker to answer (measured on a Linux test build; Windows figures will follow):
- **Typing.** A key's echo is drawn about one frame sooner (about 18 ms instead of 33 ms on the test build), and an echo is no longer held back while other terminals print.
- **Clicks.** A click redraws only what it concerns. With 16 terminals open, focusing another one used to redraw all of them three times; it now redraws two.
- **Switching.** Moving between Terminals, Board, Agents and the Inbox, and between the tabs of the right panel, is two to three times quicker (on the test build, the Board paints in about 50 ms where it took about 150). Kolux used to re-apply its whole look each time, and again after every saved setting.
- **Opening a file or clicking another pane** under Glass is quicker: the focused pane's ring is now drawn just inside its edge, which the window can redraw on its own.
- **Opening Go to / Run a command** no longer makes the rest of the window work out what to draw again; it opens and closes a few milliseconds sooner.
- **Typing in Go to / Run a command and in tab search.** Only the rows that change are redrawn as you type; every row used to be rebuilt on each letter.
- **Screens.** Kolux reads its screens a little at a time after the window shows instead of all at once, and pointing at a button reads what it opens before you click. Settings and each of its pages open at once, the first time too, once the window has been up a moment.
- **Starting.** The checks that ran before the window could load now run beside it, the backup of Kolux's own state waits ten seconds, and the script read at start is 4 % smaller. Every start writes a timing line to the diagnostics log.
- **Opening things.** Settings, menus and files no longer wait on an opening animation, opening a file asks the backend once instead of three times, and a dialog or screen opened for the first time appears as soon as its code is read instead of about a third of a second later.
- **Menus.** Opening or closing a menu, a picker or Go to / Run a command no longer makes the window lay out and redraw the pane or panel it opened from. On the test build the pane menu now opens in about 57 ms instead of 94 under Glass (61 instead of 76 under Flat), tab search a little sooner too, and every other menu saves the same work each time it opens and closes. Nothing looks different.

New:
- **Discard** is back in All Changes, behind a question that says exactly what will be lost. Deleted and renamed files say so.
- **Review changes** in a project's right-click menu, and "Open All Changes" in Go to / Run a command: you no longer need a finished agent to reach your changes.

Fixed:
- The top bar no longer shows Ctrl+K while a terminal has focus, where Ctrl+K clears the pane; it shows Ctrl+Shift+P there.
- Unread marks that never cleared: an agent that exited out of view, a bell in a hidden tab, a second note on a turn you had already seen.
- An agent whose program exited reads Stopped everywhere; its header used to say Done.
- Discarding an untracked file whose name starts with a space could delete a different file.
- Ports and Preview were empty on a Windows set to a language other than English.
- A lineup's handoff notes no longer show up as untracked files in your repository.
- Several sessions failing to start at once left a dead pane; dragging a divider in a very small window could collapse the grid; a tab opened after a slow start could share a terminal with a restored tab.
- First run: choosing "Plain terminal" no longer starts your default AI agent in the folder you add next.
- A browser tab opens an IP address or a `*.localhost` name over http, as it already did for `localhost`.
- xAI keys are masked in feedback and crash reports.
- The left sidebar stays hidden after a restart.

## 0.1.12

Much lighter on your machine:
- **Agent sleep, on by default.** An agent tab (such as Claude Code) that finished its turn and sat untouched for 30 minutes, out of sight, is put to sleep: its session is saved and its program ends, which frees about 0.7 to 0.9 GB each. Wake brings the same conversation back. A tab that is working, waiting on you, holds unsent text or is the one you are looking at never sleeps. Change the delay or turn it off in Settings › General › Experimental.
- Six terminals printing output use about 26 % of a CPU core instead of 59 %.
- Kolux minimised keeps about 300 MB less in memory, and with browser tabs hidden about 350 MB less.
- Large output floods no longer leave gigabytes of memory held afterwards, and typing stays instant (0.1 s instead of 2.7 s) while other terminals flood.

Smoother:
- Moving a pane to another tab or cell, or splitting it, no longer restarts the agent or program inside it.

## 0.1.11

**Kolux RS is now Kolux.** The app has a new name. Your settings, projects and shortcuts move over by themselves on the first start after the update.

Safer in folders you downloaded:
- Kolux no longer pushes into local repositories, or runs programs named in a folder's own git config, when the folder is not one you trust.
- Kolux no longer marks a workspace as trusted in your Claude or Codex settings unless its code is on your own `origin` branches. A stranger's fork or pull request now always gets the agent's own trust question.

Lighter on your machine:
- The window, hidden browser tabs and idle animations use far less CPU and GPU while you are not looking at them.

Things you may notice once:
- Pinned items are not carried over by the rename; pin them again.
- If the update fails, Kolux stops cleanly and asks you to click once to try again.
- The first agent start in a worktree with commits you have not pushed shows Claude's trust question once.
- A repository with no remote named `origin` is no longer pre-trusted; the agent asks instead.

Also: KaTeX (maths rendering) updated to 0.18.11 for a low-severity security fix.
