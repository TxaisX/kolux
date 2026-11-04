# 05 · Views & navigation

This area is how the user gets around Kolux and what surrounds the terminals. In the new look a
full-width top bar carries a switch between three workspace screens: Agents (sessions grouped under
each saved agent, with a chat or terminal for the one picked), Board (every session as a card in a
status lane, with approve and deny buttons and the result of a finished run) and Terminals (the
classic grid). The same bar holds a search hint that opens the worktree palette, an Inbox bell and a
weekly usage pill. Agents and Board run full width with no worktree sidebar; Terminals keeps it.
Full pages open over the workspace: Tasks, Automations, Skills, the Artifacts library, Space, Inbox
and the Floor timeline. The worktree palette jumps anywhere by typing. The left sidebar lists
projects, worktrees and live sessions; the right sidebar holds the Explorer, file search, Source
Control, Checks, the history of past agent sessions with resume, and the per-workspace handoff note.
The status bar carries keep-awake, the Resource Manager with kill, listening ports and skill or app
update progress. The Agent Dashboard drawer, the pet and the Activity page sit behind experimental
switches that are off; the dashboard pop-out, the Swarm pane footer and the status-bar usage chips
were retired. Views of remote machines left with area 18.

Tier counts: P0 24 · P1 58 · P2 15 · H 10 · X 1 · D 10
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes ·
04 Agent status, hooks & notifications · 06 Usage & limits · 07 Accounts, sign-in & keys ·
08 Orchestration · 09 Automations · 10 Plan review & protected actions ·
11 Git, source control & review · 12 Editor & files · 13 Browser pane & computer use ·
14 Native chat · 15 Skills, plugins & starter kits · 16 Onboarding & guidance ·
17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations ·
21 H — retired, hidden, removed, dev-only

## Cards

### VIEW-026 · Open a session's live terminal inside its Board card
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: expands a card to see its terminal, then closes it.
User sees: the live terminal moves into the card; on close it returns to its exact place in the
  grid.
Rules: the process and scrollback are kept; only the view moves.
Acceptance:
  - [x] Expand a card, type a command, collapse → the grid pane shows the same output in the same
        position. (cards live; evidence/cards-VIEW-026.txt)
  - [x] Close the expanded card → the terminal is back in its grid slot and its process is still
        running. (cards live; evidence/cards-VIEW-026.txt)
Compat: —
Source: D-05-026

### VIEW-037 · Worktree palette: jump anywhere
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: presses Mod+J (Mac) or Mod+Shift+J (Windows, Linux) and types.
User sees: one list with sections for open tabs, worktrees, projects and project groups, settings
  pages, quick actions and pull requests or issues; Enter goes there.
Rules: the View menu shows the chord as a label only; the window itself handles the key press;
  archived worktrees are left out; a pasted query over the size limit is refused.
Acceptance:
  - [x] Type part of a branch name → that worktree is in the list; Enter switches to it. (cards; evidence/cards-VIEW-037.txt)
  - [x] Type a settings page name → a row that opens that page. (cards; evidence/cards-VIEW-037.txt)
  - [x] Type Show → a row for every screen, Agents, Board and Terminals included; a row for a command with keys shows
        those keys (New terminal tab Ctrl+T, Search open tabs Ctrl+Shift+K). (unit; evidence/T-708.txt)
  - [x] Every element with role dialog or alertdialog closes on Escape, or is listed with the reason it does not (a chat
        card, a two-answer fallback, a panel whose parent closes it first); Escape never throws away typed text. (unit;
        evidence/T-708.txt)
  - [x] Every aria-modal dialog keeps Tab and Shift+Tab inside it, wrapping at both ends; Escape stays the dialog's own.
        (unit; evidence/T-714.txt)
Compat: keybinding id worktree.palette
Source: D-05-037

### VIEW-016 · One line per session says what the agent is doing
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: scans the Agents rail.
User sees: under each session a short line: what an approval is asking for, the current step while
  working, idle with how long, or a fresh Done with how recently.
Rules: when several signals compete the most urgent wins: approval, then working, then done, then
  idle; with no evidence the line stays empty rather than guessing.
Acceptance:
  - [x] Agent waiting on a file-edit approval → line names that approval. (cards; evidence/cards-VIEW-016.txt)
  - [x] Agent idle 12 minutes → line says idle with the duration. (cards; evidence/cards-VIEW-016.txt)
Compat: —
  (Kolux RS, T-028-a: built as the chip line of the Board card, `src/board/chip.ts`; the Agents
  screen reuses it when T-050 lands.)
Source: D-05-016

### VIEW-017 · Fixed status words on the Agents screen
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: reads a session's status label.
User sees: one of a frozen set of words: working, needs you, done, stopped, idle, starting, not
  started, or that the host can't be reached.
Rules: a stale working reading is never shown as working; an unreachable host shows a can't-reach
  word instead of the last known state; a pane with no process yet shows starting; a preset that was
  never launched shows not started.
  (Kolux RS, T-028-b: the rail row's word is the status vocabulary's word for the same signal the
  Board chip reads, so a stale working reading shows the vocabulary's stale word and a queued turn
  its queued word, alongside the set above; a process that ends without a done signal reads stopped
  at once; the cannot-reach word has no remote host to show yet, DT-C21.)
Acceptance:
  - [x] Kill the agent's process without a done signal → label leaves working within the staleness
        window. (cards live; evidence/cards-VIEW-017.txt)
  - [x] A preset that was never launched → its label reads not started. (cards; evidence/cards-VIEW-017.txt)
Compat: —
Source: D-05-017

### VIEW-023 · Board columns and card status chips
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: opens Board.
User sees: every session as a card in a lane by status, each with a chip: Working with how long and
  the current step, Needs you naming the approval, Stopped, Done with the opening line of the
  agent's last message and a link to the most recent file it wrote, Can't reach, Starting, or Setup
  needed.
Rules: a stale working signal never shows Working; a plain shell terminal gets no chip; a stop
  caused by a limit or sign-in reads Stopped, never Done; when several files were written, the
  newest one wins and the link carries its full path; a working card shows how long it has been
  working and its current step in plain words.
Acceptance:
  - [x] Agent stopped by usage limit → card in a stopped state, chip says Stopped. (cards; evidence/cards-VIEW-023.txt)
  - [x] Agent finished → chip shows first line of its last message. (cards; evidence/cards-VIEW-023.txt)
  - [x] Agent writes file A, then file B, then finishes → the card links to file B. (cards; evidence/cards-VIEW-023.txt)
Compat: —
  (Kolux RS, T-028-a: built; Setup needed and Can't reach wait for the chooser and remote work;
  the file link is the file's name with the full path as tooltip until an editor exists.)
Source: D-05-023

### VIEW-025 · Approve or deny from a Board card
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: clicks approve or deny on a card that needs permission.
User sees: the answer goes to that agent and the card moves out of needs-you.
Rules: the approve and deny buttons on Board cards stayed when the footer under terminal panes was
  removed.
Acceptance:
  - [x] Agent asks to run a command → card shows both buttons; approve → agent proceeds. (cards live; evidence/cards-VIEW-025.txt)
  - [x] Deny on a card → the agent receives the refusal and the card leaves needs-you. (cards live; evidence/cards-VIEW-025.txt)
Compat: —
  (Kolux RS, T-028-a: built through `agent_answer`, which types the agent's own keys into its
  terminal: Enter / Esc for Claude Code, y / n for Codex.)
Source: D-05-025

### VIEW-040 · Palette rows show live agent state and age
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens the palette while agents run.
User sees: a spinner for working, a radio mark for monitoring, a permission mark, an unread dot, a
  check for freshly done, and an age like 4m, 3h or 2d.
Rules: permission beats unread, unread beats freshly done; ages switch from hours to days at two
  days; no status work happens while the palette is closed; ages read in minutes until a full hour
  has passed.
Acceptance:
  - [x] Agent waiting on approval with unread output → row shows the permission mark. (cards; evidence/cards-VIEW-040.txt)
  - [x] Agent finished 50 minutes ago → age reads 50m; one finished three days ago → 3d. (cards; evidence/cards-VIEW-040.txt)
Compat: —
  (Kolux RS, T-029 deferred: waits for the palette, T-098.)
Source: D-05-040

### VIEW-047 · Jump to the next session that needs you
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: presses Mod+Shift+J (Mac) or Mod+J (Windows, Linux).
User sees: focus moves to the next pane waiting on the user.
Rules: its default chord is the palette's chord swapped per platform.
Acceptance:
  - [x] Two panes waiting → pressing twice visits both. (cards; evidence/cards-VIEW-047.txt)
  - [x] No pane is waiting → focus stays where it is. (cards; evidence/cards-VIEW-047.txt)
Compat: a keybinding command; its exact command id is held back pending the allowlist (area 04
  carries the same command).
Source: D-05-047

### VIEW-008 · Weekly usage pill in the top right
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: glances at the top-right corner.
User sees: one small pill per provider showing how much of the weekly allowance is left, tinted by
  how full it is.
Rules: only the weekly window counts; the 5-hour window is ignored; providers that report only a
  5-hour window get no pill; with no usage data the pill is not drawn at all; this replaced the
  status-bar usage chips on 2026-10-05; pills exist only for Claude and Codex; no other provider
  ever gets one; a provider shows only while its usage item is ticked in the status-bar item list
  and its agent CLI is installed; hovering a pill shows a countdown to the weekly reset, or says the
  reset time is unknown.
  (Kolux RS, T-041-a: `src/chrome/TopBar.tsx` hides the pill's container when no provider has a
  part to show; the installed list comes from the agent scan; the status-bar item list is T-148.)
Acceptance:
  - [x] Signed-in Claude with weekly data → a pill with a remaining percentage. (T-041-a, by a posted report)
  - [x] No provider data → no pill and no empty placeholder. (T-041-a)
Compat: —
Source: D-05-008

### VIEW-018 · Usage line on the Agents screen
Tier: P0 · Pushed: 4 · State at 0.15.0: live
User does: looks at the selected session's usage line.
User sees: a rounded percentage of the plan's 5-hour window and the local time it resets.
Rules: follows the user's used-or-remaining display preference; never prints a not-a-number value;
  stays blank for a provider without a 5-hour window.
  (Kolux RS, T-040-b: the line is the Agents rail's footer, "Claude 38% used · resets today 15:00",
  in the reset words the Codex pill uses; a broken provider value reads 0.)
Acceptance:
  - [x] Claude at 37.6 % used, preference used → shows 38 % and a local reset time. (cards; evidence/cards-VIEW-018.txt)
  - [x] Provider with no 5-hour window → the usage line stays empty. (cards; evidence/cards-VIEW-018.txt)
Compat: —
Source: D-05-018

### VIEW-001 · Three workspace screens: Agents, Board and Terminals
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: clicks Agents, Board or Terminals in the screen switch in the top bar.
User sees: the workspace swaps between an agent-centred list with chat, a status board of every
  session, and the classic terminal grid; the same sessions keep running underneath.
Rules: the switch sits in the full-width top bar of the new look; the classic look has no switch and
  stays on the terminal grid; when no view was ever chosen the workspace opens on Board; switching
  screens never closes, restarts or rebuilds a running terminal.
Acceptance:
  - [x] New look on, click each of the three labels → each screen renders and the selected label is
        highlighted. (cards live; evidence/cards-VIEW-001.txt)
  - [x] Start an agent on Terminals, switch to Board and back → same pane, same scrollback, process
        still running. (cards live; evidence/cards-VIEW-001.txt)
Compat: —
Source: D-05-001

### VIEW-002 · Cycle the workspace screen from the keyboard
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: presses Mod+Alt+V, or picks a screen from View > Workspace View.
User sees: the workspace moves to the next screen in the order Agents, Board, Terminals, Tower; the
  menu lists Agents, Board and Terminals as radio items with the current one checked (none while on
  Tower).
Rules: the order follows the left-to-right order of the labels in the top-bar switch; in the classic
  look, which has no top bar, the chord does nothing; the chord can be rebound like any other
  shortcut; the View menu entry for the three screens exists only while the top bar is on; the menu
  is rebuilt whenever the screen or the top-bar setting changes, so its check mark is always
  current; the chord printed in the menu is only a label; the key press is handled inside the
  window, not by the menu.
  Since T-610 (DT-C68) the submenu lists Agents, Board, Terminals, Tower and Floor, each ticked while
  shown; since T-673 (DT-C109) it lists Space too, and in the classic look the chord shows a short note
  saying the classic layout has one view instead of doing nothing silently.
Acceptance:
  - [x] New look, on Agents, press the chord four times → Board, Terminals, Tower, Agents.
        (Reworded per Txais 2026-10-28 decisions file, A: Tower stays in the cycle.)
  - [x] Classic look, press the chord → the screen does not change (since T-673 a note says why). (cards live; evidence/cards-VIEW-002.txt)
  - [x] Switch to Board with the mouse, open the menu → Board is checked. (cards; evidence/cards-VIEW-002.txt)
  - [x] Turn the new look off → the submenu is gone. (cards; evidence/cards-VIEW-002.txt)
  - [x] View → Workspace View → Space opens the Space view and is ticked while shown. (T-673; evidence/T-673.txt)
Compat: the cycle command is a keybinding command with default Mod+Alt+V; its exact command id is
  held back pending the allowlist.
Source: D-05-002

### VIEW-003 · Full-width top bar with search hint and inbox bell
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: in the new look, glances up at the top bar and clicks its search hint or its bell.
User sees: a bar spanning the whole window above the sidebar row, carrying the window's left
  controls, the screen switch, a search hint, a bell and the usage pill. The search hint opens the
  worktree palette; the bell opens the Inbox.
Rules: classic chrome keeps a sidebar-width title header and no top bar; the top bar never overlaps
  the native window controls on Windows; the bell is named Inbox, and clicking it while the Inbox shows
  goes back to the screen shown before it (DT-C103).
Acceptance:
  - [x] Click the search hint → the worktree palette opens with focus in its input. (cards live; evidence/cards-VIEW-003.txt)
  - [x] Click the bell → the Inbox page opens. (cards; evidence/cards-VIEW-003.txt)
  - [x] Open the Inbox from Projects, click the bell again → back on Projects, not Terminals. (unit; evidence/T-667.txt)
Compat: —
Source: D-05-003

### VIEW-004 · No worktree sidebar on Agents and Board
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: switches between the three screens in the new look.
User sees: Agents and Board take the full width with no classic worktree sidebar; Terminals keeps
  the sidebar.
Rules: the hide rule applies only in the new look; the classic look keeps the sidebar everywhere;
  hiding the sidebar leaves the terminal workbench behind it running.
Acceptance:
  - [x] New look: Agents and Board show no worktree list; Terminals shows it. (cards live; evidence/cards-VIEW-004.txt)
  - [x] Classic look: the sidebar is visible on every screen. (cards live; evidence/cards-VIEW-004.txt)
Compat: —
Source: D-05-004

### VIEW-015 · Agents screen lists sessions by saved agent
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: opens the Agents screen.
User sees: a rail of sessions grouped under each saved agent, with AI sessions that match no saved
  agent under an Other sessions group; selecting one shows it on the right.
Rules: plain shell terminals are never listed; on first open the first agent with sessions is
  chosen, on its newest session; afterwards the last selection is remembered; in the new look the
  rail is a 268px rounded card; otherwise a flat 240px rail; a session started by the orchestrator
  is labelled with its task's display name or title, failing that with the task text taken from the
  dispatch prompt, and only as a last resort with the raw prompt; the dispatch boilerplate never
  shows.
  (Kolux RS, T-050: the rail stands where the worktree sidebar does; the saved agents are the
  switched-on, installed ones from Settings > Agents, in that order; a row reads the task title the
  launcher gave the session, else its folder's name; the task-text and raw-prompt fallbacks for an
  orchestrator session without a title come with T-050-b.)
Acceptance:
  - [x] One saved agent with two sessions plus one unmatched Codex session → two groups; the
        unmatched one sits under Other sessions. (cards; evidence/cards-VIEW-015.txt)
  - [x] Select a session, switch screens and back → same session selected. (cards; evidence/cards-VIEW-015.txt)
Compat: —
Source: D-05-015

### VIEW-019 · Chat, terminal and composer for the selected session
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: selects a session on the Agents screen, types in its composer, or flips the Show terminal
  switch.
User sees: supported agents show as a chat thread with a composer that sends to that agent; plain
  terminals and unsupported agents show their terminal; the switch forces the terminal.
Rules: chat shows for supported agents even when the global chat experiment is off; a session that
  has not started yet shows an agent chooser instead; Claude chat runs through a bridge with the
  terminal one switch away; this composer is the one typing surface outside the terminal; the
  terminal-grid message bar was removed on 2026-10-05; a live agent detected in the pane decides
  chat or terminal, over what the session was launched as; plain shells and unsupported agents get
  the terminal.
  (Kolux RS, T-050: the terminal body and the chooser for a not-started session are built; the chat
  thread, the composer and the Show terminal switch wait for the transcript and chat tasks, T-050-b,
  so every session shows its terminal until then.)
Acceptance:
  - [x] Select a Claude session → chat body; flip Show terminal → raw terminal. (cards; evidence/cards-VIEW-019.txt)
  - [x] Select a plain shell → terminal body, no switch. (cards; evidence/cards-VIEW-019.txt)
  - [x] Send a line from the composer → it appears as the agent's next input. (cards; evidence/cards-VIEW-019.txt)
Compat: —
Source: D-05-019

### VIEW-021 · Add a session from the Agents screen
Tier: P0 · Pushed: 7 · State at 0.15.0: live-unverified
User does: clicks + on an agent group, or sees the empty state on a fresh profile.
User sees: a new not-yet-started session preset appears under that agent; with no agents an empty
  state invites building one.
Rules: the preset waits for the user to pick and start it.
  (Kolux RS, T-050: + adds a chooser pane with that agent already in its seat; the user picks the
  model and presses Start; the empty state's button opens Settings > Agents.)
Acceptance:
  - [x] Click + under an agent → a not-started row appears and is selected. (cards; evidence/cards-VIEW-021.txt)
  - [x] Fresh profile with no saved agents → an empty state shows instead of a blank rail. (cards; evidence/cards-VIEW-021.txt)
Compat: —
Source: D-05-021

### VIEW-024 · Board shows every terminal session in order
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: opens Board with several tabs and splits.
User sees: one card per terminal pane in tab-group order; panes that were never started appear as
  chooser cards; cards use the saved agent's name.
Rules: editor and browser tabs never become cards; a background tab's pane is not borrowed into
  another card.
  (Kolux RS, T-050: the Board's lanes and empty state count terminal panes only; pane headers, on
  the Board and in the grid, show the saved agent's name in place of the program word.)
Acceptance:
  - [x] Two tabs, one split into two panes → three cards in tab order. (cards; evidence/cards-VIEW-024.txt)
  - [x] Open an editor tab and a browser tab → neither gets a card. (cards; evidence/cards-VIEW-024.txt)
Compat: —
Source: D-05-024

### VIEW-050 · Left sidebar: show, hide, resize and focus
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: presses Mod+B, drags the sidebar edge, or presses Mod+Shift+0.
User sees: the sidebar toggles, resizes within limits, or takes keyboard focus on its list.
Rules: saved widths are clamped into range; invalid saved widths fall back to the current width; a
  closed sidebar takes no width; with the sidebar closed the first tab stays visible and the toggle
  never overlaps the back button.
Acceptance:
  - [x] Close with Mod+B → first tab still fully visible. (cards live; evidence/cards-VIEW-050.txt)
  - [x] Drag past the maximum → width stops at the limit. (cards; evidence/cards-VIEW-050.txt)
Compat: keybinding id sidebar.left.toggle; the focus-the-list command is a keybinding command whose
  exact id is held back pending the allowlist.
Source: D-05-050

### VIEW-051 · Sidebar card lists projects and their sessions
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: looks at the left sidebar in the new look and clicks a row.
User sees: a rounded card listing projects with their worktrees and live sessions, each with the
  right agent's identity; clicking activates it.
Rules: live session counts ignore dead tabs; worktrees with none show no count; clicking activates
  without scrolling the list; a sleeping worktree switches immediately; it does not wait for
  terminals to wake; every live pane keeps its row with its own agent identity, also after a sleep
  and reconnect; in a split tab each pane's row carries that pane's own conversation name; clicking
  one pane never renames its sibling, and a pane with no live title borrows none.
Acceptance:
  - [x] A Cursor pane and a Gemini pane → both listed, neither labelled Claude. (cards; evidence/cards-VIEW-051.txt)
  - [x] Close a tab → its worktree's count drops. (cards; evidence/cards-VIEW-051.txt)
Compat: —
  Amended 2026-11-02 (DT-C83, wave UI A.2): the sidebar lists projects, workspaces and groups with their live counts; terminals are tabs in the main area and no longer rows here.
Source: D-05-051

### VIEW-005 · The app reopens on the screen and page you left
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: leaves Kolux on a screen or a full page (for example Tasks), quits and restarts.
User sees: Kolux comes back on that same screen or page.
Rules: quick successive switches are saved as one write; the final choice is written out before the
  window finishes closing; an unknown or missing saved page falls back to the terminal workspace; a
  page whose titlebar button is hidden still restores if it was the last one open; a corrupt
  preference file is ignored, not fatal; older saved values migrate; nothing is saved until startup
  has read the saved state back, and a later sync from another window never moves the user off the
  page in front of them.
Acceptance:
  - [x] Open Tasks, quit, relaunch → Tasks is shown. (cards live; evidence/cards-VIEW-005.txt)
  - [x] Corrupt the saved preference file, relaunch → no error dialog: with no good copy the app
        opens on the terminal workspace; with the usual backup present it opens from that copy and
        says once, on the page, that it used the last good copy. (Reworded per Txais 2026-10-28
        decisions file, A: works as now.) (cards; evidence/cards-VIEW-005.txt)
Compat: —
Source: D-05-005

### VIEW-107 · Saving the workspace when Kolux quits
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits Kolux with work open.
User sees: on relaunch every workspace and tab returns; unsaved editor changes block a silent quit.
Rules: a failed save is retried, then falls back to a durable-only save; restored workspaces rebuild
  their tab layouts in session order in one pass.
Acceptance:
  - [x] Quit with three tabs → relaunch shows the three tabs. (cards; evidence/cards-VIEW-107.txt)
  - [x] Quit with an unsaved editor buffer → prompt, no silent loss. (cards live; evidence/cards-VIEW-107.txt)
Compat: —
Source: D-05-107

### VIEW-020 · Hand one agent's result to another agent
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: from a finished session, chooses to send its result to another session.
User sees: a short list of other chat-capable agents' sessions, the last viewed first; picking one
  drops the result into that session's composer.
Rules: the target list is capped; whatever the user already typed in the target composer is kept;
  file paths with spaces are quoted.
  the list closes on a pick, on Escape (focus back on its button) and on a click outside it; that
  Escape never reaches the agent or a terminal.
Acceptance:
  - [x] Two other chat sessions exist, one viewed last → it is listed first. (cards; evidence/cards-VIEW-020.txt)
  - [x] Result path contains a space → it arrives quoted. (cards; evidence/cards-VIEW-020.txt)
  - [ ] Open the list, click elsewhere → it closes. (evidence/T-678.txt)
Compat: —
Source: D-05-020

### VIEW-012 · Artifacts library
Tier: P0 · Pushed: — · State at 0.15.0: live
User does: opens the Artifacts page, adds a file with Add artifact, types in the search box, selects
  an item, or removes one.
User sees: a list of saved artifacts, newest first, each with its title, size and source; selecting
  one shows a preview beside the list; a remove button asks "Remove <title>?" and, once confirmed,
  takes it out of the library.
Rules: Search matches titles only and requires every typed word to appear; an empty library and a
  search with no matches show different messages; sizes read in B, KB or MB with one decimal; each
  preview gets a stable page identity so reopening the same artifact reuses it; the remove button
  never deletes on its own: it asks first, names the artifact and says the original file is not
  touched, and Cancel or Escape leaves everything as it was with focus back on the button; the list
  is one list per project with a select button and a Remove button per row, moved by Up/Down/Home/End,
  and after a removal focus goes to the next row, else the previous, else the search box.
Acceptance:
  - [x] Add two files → newest is on top. (cards; evidence/cards-VIEW-012.txt)
  - [x] Search two words where only one matches a title → that item is hidden. (cards; evidence/cards-VIEW-012.txt)
  - [x] Remove the selected item → a confirm names it; nothing is removed until Remove is pressed, then it leaves the list and the preview closes. (cards; evidence/T-685.txt)
  - [x] Cancel or Escape on the confirm → the item stays and focus is back on its Remove button; after Remove focus is on the next row. (cards; evidence/T-685.txt)
Compat: —
Source: D-05-012

### VIEW-036 · Add or remove sessions by shortcut
Tier: P1 · Pushed: 1 · State at 0.15.0: live
User does: binds and presses the add-session or remove-session command.
User sees: a session pane is added, or after a confirmation one is removed.
Rules: the title-bar minus and plus stepper was retired on 2026-10-05; the two commands remain;
  neither command has a default key; remove always asks for confirmation first.
Acceptance:
  - [ ] Bind remove, press it → a confirmation appears before any pane closes.
  - [ ] Bind add, press it → a new session pane appears.
Compat: keybinding ids sessions.add, sessions.remove
Source: D-05-036

### VIEW-097 · Keep the computer awake while agents run
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: uses the keep-awake item in the status bar.
User sees: the current keep-awake mode and whether agents are active.
Rules: off by default; not shown on a paired web client.
Acceptance:
  - [ ] Turn it on and start an agent → item shows awake with agent activity.
  - [ ] Fresh profile → keep-awake is off.
Compat: a keep-awake setting, off by default.
Source: D-05-097

### VIEW-108 · Terminals keep their scroll position across view switches
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: switches worktree or screen while an agent streams output, then comes back.
User sees: the terminal is where it was: pinned to the bottom if it was, or at the same scrolled
  spot.
Rules: hidden terminals are parked to save memory and come back intact; full-screen programs still
  get mouse-wheel events after a switch.
Acceptance:
  - [ ] Scroll up during a stream, switch away and back → same scroll spot.
  - [ ] Run a full-screen program, switch away and back → the mouse wheel still reaches it.
Compat: a setting that parks hidden terminals to save memory.
Source: D-05-108

### VIEW-014 · Space view: disk use per worktree and bulk delete
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: opens the Space page (Mod+Alt+S, T-746), sorts or searches the table, ticks rows and deletes.
User sees: a treemap of the biggest items plus a sortable, searchable table of worktrees with size,
  file count and age; only the deletable selected worktrees are removed.
Rules: the treemap keeps a fixed square layout and folds the tail into one omitted-items block;
  sizes, counts and relative ages are formatted for reading, not raw numbers; rows mark worktrees in
  active use: open browsers or running agents; git status refreshes the active worktree first, then
  the visible ones, then the rest; a deletable-only filter narrows the table; worktrees in active
  use are never deletable from here.
Acceptance:
  - [ ] Sort the table by size → biggest first.
  - [ ] Search a branch name → only matching rows remain.
  - [ ] Select one deletable and one active worktree, delete → only the deletable one goes.
  - [x] Tick two rows, search so one is hidden, Delete → the dialog lists only the one still shown and says
        branches stay; only that one is sent, asking to keep its branch; a worktree that cannot be deleted has
        its box off, with the reason on hover. (T-675; evidence/T-675.txt)
Compat: —
Source: D-05-014

### VIEW-038 · Palette ranking
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: types a query in the palette.
User sees: exact intent first, then prefix matches, then fuzzy matches; ties go to the most recently
  active item.
Rules: Open tabs lead on a tie; unmatched rows sort after matched ones; filler words like go or open
  are ignored; a candidate covering only a minority of the query words is dropped; accents and CJK
  text fold so non-Latin words still match; every typed word must land on the row; adding a word
  that matches nothing removes results rather than widening them; words containing digits, such as
  PR or issue numbers, match exactly (with or without #), never fuzzily; small typos are forgiven
  only in long words made of letters; a single Latin letter matches only the start of a word or a
  whole word; matches on a row's own fields rank ahead of matches found only on its parent project;
  matching stays inside a fixed time budget on very large lists; a command is also found by its
  keywords (cron finds Open Automations), which rank after matches on the row's own words and are
  not shown.
Acceptance:
  - [ ] Two worktrees match equally, one used a minute ago → it is first.
  - [ ] Type a PR number with or without # → only that exact number matches.
  - [x] Type cron → Open Automations is listed; a row with cron in its own name lists ahead of it. (unit;
    evidence/T-728.txt)
Compat: —
Source: D-05-038

### VIEW-041 · Filter the palette by repository
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: adds filter chips in the palette.
User sees: only rows from the chosen repositories remain; chip options show workspace counts.
Rules: several values in one field mean any of them; different fields must all match; chips start
  from the sidebar's current scope; repositories sort by workspace count; archived worktrees do not
  count.
Acceptance:
  - [ ] Pick two repositories → rows from either remain.
  - [x] Pick a repository, then a kind, from the pickers → each adds its chip, the picker goes back
        to its prompt and no longer offers the picked entry; the chip's button removes it.
        (unit; evidence/T-696.txt)
  - [ ] Open the palette while the sidebar is scoped to one repository → the chips start with that
        repository.
Compat: —
Source: D-05-041

### VIEW-042 · Create a worktree and run quick actions from the palette
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: types a name with no match and picks the create row, or types an action word.
User sees: a new worktree starts from that name; commands that apply right now are listed, each
  enabled only when its context allows.
Rules: creation actions are lifted out so the palette can close immediately; actions that need a
  worktree or a repo are hidden or disabled without one.
Acceptance:
  - [ ] Type an unused name → a create row; Enter → worktree created and opened.
  - [ ] No worktree open → worktree-only actions are not runnable.
Compat: —
Source: D-05-042

### VIEW-046 · Move between worktrees by keyboard
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: presses Mod+Alt+Left or Right, Mod+Shift+Up or Down, or Mod+1 to Mod+9.
User sees: back and forward step through visited worktrees, pages and task details; up and down move
  to the neighbouring worktree; a number jumps to that position in the list.
Rules: deleted worktrees are skipped; repeated visits to the same place are stored once; order
  follows the sidebar list.
Acceptance:
  - [ ] Visit A, B, Tasks; press back twice → on A.
  - [ ] Press Mod+2 → second worktree in the list is active.
Compat: keybinding ids worktree.history.back and worktree.history.forward; the neighbour-up,
  neighbour-down and jump-by-number commands are keybinding commands whose exact ids are held back
  pending the allowlist.
Source: D-05-046

### VIEW-048 · Delete-workspace and rename-tab shortcuts
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: presses Mod+Shift+Backspace or Mod+R.
User sees: the delete flow for the hovered or active workspace, or rename on the active chat or
  terminal tab.
Rules: the hovered row wins over the active one.
Acceptance:
  - [ ] Hover a non-active row, press → delete flow for the hovered workspace.
  - [ ] Terminal tab active, press → its title becomes editable.
Compat: keybinding ids workspace.delete, tab.rename
Source: D-05-048

### VIEW-053 · Show or hide sleeping workspaces
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: toggles sleeping workspaces in the sidebar or with a bound shortcut.
User sees: sleeping worktrees appear or disappear from the list.
Rules: shown by default; the default branch is exempt from sleeping by default; an explicit opt-out
  is kept; the shortcut ships unbound.
Acceptance:
  - [ ] Hide them → sleeping rows vanish; restart → still hidden.
  - [ ] Fresh profile → sleeping worktrees are listed.
Compat: the toggle is a keybinding command with no default key; its exact command id is held back
  pending the allowlist.
Source: D-05-053

### VIEW-068 · Branch summary against the base branch
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: looks at the top of Source Control.
User sees: the branch name, how far it is ahead or behind its base, and total lines added and
  removed.
Rules: line totals are fetched only when needed and refreshed on git status changes; the line total
  splits into source, tests and generated rows that add up to the total; without a test count the
  remainder is labelled non-generated; an empty generated row is left out; figures use grouped
  digits; the previous comparison stays on screen while the upstream status is still loading; screen
  readers hear the source, tests and generated split in the summary label even while it is
  collapsed; line counts show the full number, never an abbreviated form like 8.3k; an
  off-by-default setting measures the summary against the branch's upstream instead of the base
  branch; a base pinned for the worktree or the repository still wins while it is on; the comparison
  refreshes when git status sees a new head commit, and at least every 30 seconds as a fallback.
Acceptance:
  - [ ] Commit 10 added lines → the total shows +10.
  - [ ] A total above a thousand lines → shown in full with grouped digits.
Compat: —
Source: D-05-068

### VIEW-076 · Folder workspaces: attached worktrees and PR checks
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: opens a folder workspace that spans several repos.
User sees: an Attached worktrees tab listing its repos' worktrees, and a PR Checks tab rolling up
  checks across them.
Rules: rows refresh on their own and on demand; worktrees created from an attached worktree, at any
  depth, are listed under it; a pull request the host reports as unlinked is left out of the rollup.
Acceptance:
  - [ ] Folder workspace over two repos → both repos' worktrees listed.
  - [ ] A worktree created from an attached worktree, even two levels down → listed under it.
Compat: —
Source: D-05-076

### VIEW-112 · Import setup scripts from other tools' configs
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: adds a repo that already has a workspace setup config from another tool.
User sees: setup and teardown commands offered for import.
Rules: reads the setup sections of other worktree tools' project files and Codex environment files;
  oversized or malformed files are refused before parsing.
Acceptance:
  - [ ] Repo with a supported config → its setup command is offered.
  - [ ] A malformed or oversized config → refused, nothing offered.
Compat: reads third-party setup config files
Source: D-05-112

### VIEW-073 · Checks panel for the current pull request
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens the Checks tab.
User sees: the pull request's checks with expandable, resizable details, a review header, a merge
  conflict notice when relevant, and the PR's comments.
Rules: the panel follows the worktree of the focused terminal; when there is no PR it says so
  plainly rather than showing a stale one; Checks poll while running and can be refreshed by hand; a
  finished check that reports no outcome shows as unresolved, not pending; a PR the host reports as
  unlinked is hidden; an older cached PR never takes its place; a recent "no pull request" answer is
  reused for a short grace period instead of asking again; polling runs only while the panel is
  visible; a pull request the user unlinked stays hidden behind a plain notice naming it, with a
  button to link it again; no create action is offered meanwhile.
Acceptance:
  - [ ] Focus a terminal in worktree B → panel shows B's PR.
  - [ ] Branch without a PR → panel says there is no review.
Compat: —
Source: D-05-073

### VIEW-075 · PR comments as cards in the sidebar
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: reads pull request comments in the sidebar, reacts, resolves, or queues a thread for the
  agent.
User sees: cards grouped as open, conversation and resolved, or one chronological list; reactions;
  queued threads acknowledged once the agent starts.
Rules: pressing Enter while composing with an input method does not send; a batch of queued threads
  gets one combined reply; replies sit indented under the comment they answer; comment text keeps
  readable sizes, with headings a step above body text and code, tables and small print never shrunk
  below caption size; a thread the host cannot reply to is left out of the combined reply instead of
  failing the batch; an Add comment button sits in the comments header, after the display options,
  and opens a composer that posts a new comment on the pull request.
Acceptance:
  - [ ] Switch to chronological → comments ordered by time.
  - [ ] Queue an open thread → the agent receives it.
Compat: —
Source: D-05-075

### VIEW-084 · Session rows show prompt, latest turn, sub-agents and worktree
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: reads or expands a session row.
User sees: the agent, model when recorded, the first prompt, a preview of the latest turn, child
  runs with state dots, and a worktree line saying current, active or unavailable that jumps there.
Rules: when only a preview exists the prompt card says it is a recent prompt; choosing a menu action
  does not expand the row; text the agent harness injects into a user turn is not shown as the user
  prompt; previews are trimmed to a fixed length without ever splitting an emoji or other multi-part
  character.
Acceptance:
  - [ ] Expand a Claude session with sub-agents → each child listed with a state dot.
  - [ ] Session from a deleted worktree → unavailable badge and an explaining tooltip.
Compat: —
Source: D-05-084

### VIEW-088 · Find the live pane a past session is running in
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens a session that is still running.
User sees: Kolux focuses the existing pane instead of starting a duplicate.
Rules: matched by the provider's session id, else by an unambiguous first prompt; sleeping and
  retained panes count.
Acceptance:
  - [ ] Session still open in a pane → that pane is focused.
  - [ ] Session running in a sleeping pane → that pane is focused and no duplicate starts.
Compat: —
Source: D-05-088

### VIEW-093 · Tab titles follow session names
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs an agent whose session gets a title.
User sees: the terminal tab takes that title and updates when it changes.
Rules: a missing title is retried soon; titles are read in the background; a sleeping tab keeps its
  recovered title.
Acceptance:
  - [ ] Claude names a session → the tab shows that name.
  - [ ] Put the tab to sleep → it keeps its title.
Compat: —
Source: D-05-093

### VIEW-054 · Per-worktree skip-permissions override
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: sets or clears the skip-permissions mode for one worktree.
User sees: that worktree's agents follow the override; it survives restarts.
Rules: invalid saved entries are dropped on load.
Acceptance:
  - [ ] Set it on one worktree, restart → still set; others unaffected.
  - [ ] Damage one saved override entry → it is dropped on load and the others still apply.
Compat: —
Amended 2026-10-20 (DT-C44, DT-37): dropped. Txais took the recommended skip on 2026-10-13: the control may not exist in the old app, so it is not built.
Source: D-05-054

### VIEW-067 · Discard changes with confirmation
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: discards a file or all changes in a section.
User sees: a confirmation; after confirming, the changes are gone.
Rules: discard-all runs per section in a safe order; the confirmation says what will happen: delete
  for untracked or newly added files (warning that staged new files are deleted), restore for
  deleted tracked files, discard for modified ones, in singular or plural form.
Acceptance:
  - [ ] Discard all in a section → confirmation first; cancel keeps everything.
  - [ ] Discard an untracked file → the prompt says it will be deleted; confirm → it is gone.
Compat: —
Source: D-05-067

### VIEW-089 · Delete, reveal or open a past session's files
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: deletes a session from its row menu, opens its raw log, reveals the file or copies its
  path.
User sees: a deleted session leaves the list and its files go to the system trash; the log opens in
  a read-only tab; reveal opens the system file manager.
Rules: only local, real paths are deletable; symlinks are refused; a session folder takes its
  companion files but keeps file history; an already-missing file counts as deleted; blocked rows
  say in one plain sentence why, naming the agent; every cached list drops the row at once; only
  local sessions offer these; if the log is already open in an editable tab, that tab comes forward
  with a note that it is already editable instead of opening a second read-only copy.
  the Delete question names the session; Keep and Delete take keyboard focus as they replace each
  other.
Acceptance:
  - [ ] Delete a Claude folder session → companions trashed, file-history kept.
  - [ ] Open log → read-only tab with the transcript.
  - [ ] Choose Delete on a row → the question names that session. (evidence/T-678.txt)
Compat: —
Source: D-05-089

### VIEW-099 · Kill a terminal session from the Resource Manager
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: clicks kill on a session row, or uses Manage Sessions.
User sees: a confirmation, then the session ends and the count drops; Manage Sessions also ends
  sessions the daemon holds that no window owns.
Rules: the confirmation is left out only if Kolux has confirmed the session has already ended;
  agent-owned sessions are never offered for cleanup; until the window has finished loading its
  workspaces, no session is shown as attached to a pane.
Acceptance:
  - [ ] Kill a foreign daemon session → session count drops by one.
  - [ ] Kill a session that is already gone → no confirmation; the count updates.
Compat: —
Source: D-05-099

### VIEW-116 · Confirmation prompts: Enter, Escape and don't ask again
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: is asked to confirm an important or destructive action, such as deleting or discarding.
User sees: a small dialog with Cancel focused; Escape backs out; some prompts offer a
  don't-ask-again box.
Rules: Cancel holds focus when the dialog opens, so a stray Enter does not confirm; Enter confirms
  only on prompts that opt in, and only while the confirm button has focus; Escape always cancels;
  the don't-ask-again choice is saved only when the user confirms; backing out saves nothing, and
  the tick does not carry into the next prompt. Every plain confirm-or-cancel prompt is this one dialog: the
  Settings reset buttons, the notes' Clear, an account's Remove, the sidebar's sleep, delete, remove and delete
  group prompts, the picked-workspaces Remove, the Explorer's Delete and Confirm merge; none asks inline in its own
  style.
Acceptance:
  - [ ] Open a delete prompt and press Enter: nothing is deleted.
  - [ ] Tick don't ask again, press Escape: the next prompt still appears, unticked.
  - [ ] Tick don't ask again and confirm: that prompt no longer appears.
  - [x] A reset button, the notes' Clear and an account's Remove open the dialog; Keep backs out, the confirm acts
    once, Escape on the account Remove is Keep. (unit; evidence/T-729.txt)
  - [x] The sidebar's take out and delete workspace prompts are the dialog, found by its role; remove project and
    Confirm merge confirm by their button words; a pinned workspace shown twice opens one dialog. (unit;
    evidence/T-729.txt)
Compat: —
Source: D-05-116

### VIEW-006 · Each workspace screen can have its own theme
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: picks a theme override for one of the three screens.
User sees: that screen paints in its own theme; screens without an override follow the global theme.
Rules: a screen with no saved value counts as Terminals for theme purposes; the classic look ignores
  Board and Agents overrides.
Acceptance:
  - [ ] Give Board a dark override, keep global light → Board is dark, Terminals is light.
  - [ ] Turn the new look off → the Board override no longer applies.
Compat: —
Source: D-05-006

### VIEW-009 · Full-page views open over the workspace
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: opens Tasks, Automations, Skills, Artifacts, Space, Inbox, Floor or Settings; presses
  Mod+Shift+3 to leave.
User sees: the page fills the workspace area; Show Code closes it and returns to the terminal
  workspace, and the top bar's Terminals switch leaves Tasks or Automations too; the top-bar bell
  opens Inbox.
Rules: only one full page is open at a time; while a full page is showing, the right-sidebar
  controls are hidden; the set of pages is fixed; a request for an unknown page is refused; Floor
  and Inbox each have their own page shortcut command, shipped with no key; what lands in the Inbox
  and how it clears is specified in area 04; Escape first closes any open menu, popover or dialog;
  only when none is showing does it leave the full page, and overlays that are hidden do not count.
Acceptance:
  - [ ] Open Tasks then press Show Code → back on the workspace screen.
  - [ ] Open Settings → the right sidebar controls are hidden.
  - [ ] On Skills, press the chord → workspace screen shown.
  - [ ] Click the bell → Inbox page shown.
Compat: keybinding ids view.code (default Mod+Shift+3), view.inbox and view.floor (both with no
  default key).
Source: D-05-009

### VIEW-056 · Right sidebar: open, close, width and remembered tab
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: presses Mod+L, drags its edge, or switches tabs and restarts.
User sees: the right sidebar toggles, resizes, and comes back on the same tab and width.
Rules: Open by default; an unknown saved tab falls back to Explorer; a saved Search tab from older
  versions becomes the Explorer's search view; a saved width wider than the old 500px limit is
  honoured; a minimum width and a reserved area are enforced; on Windows its title strip leaves room
  for the native window buttons and can still drag the window; if the panel's code fails to load,
  the panel recovers and the window keeps running.
Acceptance:
  - [ ] Close it, restart → still closed.
  - [ ] Set a width of 640px, restart → 640px.
Compat: keybinding id sidebar.right.toggle; an open-by-default setting, on.
Source: D-05-056

### VIEW-057 · Right sidebar tab strip
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: clicks the tab icons at the top of the right sidebar, or presses a panel shortcut.
User sees: Explorer, Agents (session history), Source Control and Checks; folder workspaces get
  Attached worktrees and PR Checks instead of the git tabs.
Rules: when narrow, extra tabs overflow into a More menu but the active tab stays visible; if the
  remembered tab is not available here, the first visible tab is used; a folder workspace's
  remembered PR Checks wins; Mod+Shift+E, Mod+Shift+F and Mod+Shift+G open Explorer, Search and
  Source Control; Checks has an unbound command.
Acceptance:
  - [ ] Narrow the sidebar → overflow menu appears and the active tab is still shown.
  - [ ] Open a folder workspace → git tabs hidden, Attached worktrees shown.
Compat: keybinding ids sidebar.explorer.toggle, sidebar.search.toggle and sidebar.checks.toggle
  (Checks has no default key); the Source Control toggle is a keybinding command whose exact id is
  held back pending the allowlist.
Source: D-05-057

### VIEW-086 · Resume a past session as chat
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: chooses to resume a session in chat.
User sees: the session reopens as a chat.
Rules: Claude only in its own workspace; Codex anywhere; remote and WSL sessions are refused.
  a second press on Resume as chat while the first is still starting is ignored; when it is off,
  text under the row says why.
Acceptance:
  - [ ] Claude session from another workspace → chat resume not offered.
  - [ ] Codex session from any workspace → chat resume is offered.
  - [ ] Double-click Resume as chat → one chat opens. (evidence/T-678.txt)
Compat: —
Source: D-05-086

### VIEW-096 · Status bar: show, hide and choose items
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: toggles View > Appearance > Show Status Bar, or right-clicks the bar.
User sees: the bar appears or disappears; the right-click menu lists items to show or hide.
Rules: clicking inside an item's popover never opens the visibility menu; old saved item lists
  migrate; items for agent CLIs not on the PATH are hidden; status bar copy is translated.
Acceptance:
  - [ ] Right-click the bar, untick Resource Manager → it disappears and stays gone after restart.
  - [ ] An agent CLI that is not installed → its status-bar item is hidden.
Compat: —
Amended 2026-10-11 (DT-A5): no agent items exist on the bar to hide; copy stays English until language packs (SKILL-040).
Source: D-05-096

### VIEW-100 · Skill and app update progress in the status bar
Tier: P1 · Pushed: 8 · State at 0.15.0: live-unverified
User does: updates bundled skills, or lets Kolux download an app update.
User sees: nothing while idle; during a skill update a spinner with a count, then a green check that
  disappears or a failure that stays until clicked; an app update item while one is in progress or
  ready.
Rules: the separate update nudge was removed on 2026-10-05; the update card owns release notes.
Acceptance:
  - [ ] Run an update that fails → red item stays; click → dialog.
  - [ ] Update available → status bar item shows it.
Compat: —
Source: D-05-100

### VIEW-007 · Screen and sidebar preferences stay in step across windows
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: changes the workspace screen or the sleeping-workspaces toggle in one Kolux window.
User sees: other open windows pick up the same preference; the toggle survives a restart.
Rules: a sync from another window never yanks the current window off a page the user is on.
Acceptance:
  - [ ] Two windows open, hide sleeping workspaces in one → the other hides them too.
  - [ ] Window B is on the Tasks page when window A changes screen → B stays on Tasks.
Compat: —
Source: D-05-007

### VIEW-027 · Large workspace boards stay smooth
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens the sidebar's workspace board, which sorts worktrees into status lanes, with many
  lanes or cards.
User sees: scrolling stays smooth and no lane goes missing.
Rules: only lanes near the visible area are drawn; a workflow with 21 statuses keeps every lane.
Acceptance:
  - [ ] Board with hundreds of cards → scrolling stays responsive; marquee over a lane selects all
        its cards.
  - [ ] A workflow with 21 statuses → all 21 lanes are present.
Compat: —
Source: D-05-027

### VIEW-066 · Push failures explain themselves
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: pushes and the push fails.
User sees: a plain error and a recovery prompt; the push target names a fork when pushing to one.
Rules: remote action errors stay visible until dismissed; the push-target label names the fork
  remote whatever form its address takes; hiding Source Control AI actions also hides the agent
  fixes offered on a push failure.
Acceptance:
  - [ ] Push rejected as behind → recovery prompt offers to pull first.
  - [ ] Push to a fork → the push target names the fork.
Compat: —
Source: D-05-066

### VIEW-080 · Agents tab: past sessions for this workspace
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens the Agents tab in the right sidebar and chooses workspace, project or all.
User sees: past agent sessions in that scope.
Rules: workspace scope is the default; if the scope is unavailable it falls back automatically and
  returns later; a manual choice of all stays; sessions from a worktree's earlier paths, before a
  rename, are included; project scope also takes in the other worktrees of the same repository; once
  the user picks project or all by hand, the scope never switches back to workspace on its own;
  sessions in the chosen scope still appear when the general cap on recent sessions would have cut
  them.
Acceptance:
  - [ ] Rename a worktree folder → its older sessions still listed.
  - [ ] Choose all → stays on all after switching worktrees.
Compat: —
Source: D-05-080

### VIEW-081 · Search, filter and group past sessions
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: types in the session search, picks agents, or changes grouping.
User sees: matching sessions grouped by folder, agent or project, with short labels.
Rules: Search takes plain words, quoted phrases, and repo: and path: filters; empty sessions can be
  hidden, but sessions with recoverable content are kept; compact labels use the last two path
  parts; paths with accented or non-Latin characters group as one project however their characters
  are encoded; an oversized pasted search returns no results at once rather than scanning every
  session; a project with a blank setup path never matches every session.
Acceptance:
  - [ ] Search repo:kolux fix → only that repo's sessions mentioning fix.
  - [ ] Paste an oversized search → no results at once and no freeze.
Compat: —
Source: D-05-081

### VIEW-082 · Session list view options persist
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: changes sort, grouping, agents shown or history depth, or resets them.
User sees: choices stay after restart; a counter shows how many options differ from defaults.
Rules: empty sessions are shown by default; history depth can be set to Unlimited; the list draws 200
  rows at a time and Show more adds the next 200, with group headers counting every session (T-746).
Acceptance:
  - [ ] Change grouping, restart → same grouping; reset → counter clears.
  - [ ] Set history depth to Unlimited → every session in scope is listed.
  - [x] Unlimited with 250 sessions → 200 rows and Show more (50 not shown); headers say 150 and 100. (unit; evidence/T-746.txt)
Compat: —
Source: D-05-082

### VIEW-083 · Session list refreshes without stealing keystrokes
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: returns to the tab, presses refresh, or starts an agent in Kolux.
User sees: the list updates; the refresh button forces a full rescan; a new session appears soon
  after it starts.
Rules: refocus refreshes from cache; an agent start triggers a rescan, at most one per short
  interval; results publish only once terminal typing is quiet, at most one second late; reopening
  the tab reuses the last results.
Acceptance:
  - [ ] Type steadily in a terminal during a refresh → no visible lag.
  - [ ] Start Claude → its session shows in the list without manual refresh.
Compat: —
Source: D-05-083

### VIEW-085 · Resume a past session in a terminal
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: clicks resume, drags a session into a pane, or copies the resume command.
User sees: a terminal opens in the session's worktree (or the active one) and the agent resumes; the
  copied command fits the user's shell.
Rules: sessions with no turns cannot be resumed; copy stays available; the copied command matches
  PowerShell, cmd or a POSIX shell; Codex sessions resume against the right home folder and clear
  inherited ones; resume can open in a new split of a chosen tab group; agent default arguments from
  settings are applied; a past session can be dragged onto a terminal pane: dropping in the middle
  resumes it as a new tab in that pane's group, dropping on an edge resumes it in a split on that
  side; a chat session reopens its chat; a drop beside the panes says to drop on one, and a
  successful drop confirms the session is queued; the resume command is quoted for the shell the
  target tab really runs, even when the default shell setting names WSL but the workspace runs on
  the Windows host.
  a second press on Resume while the first is still starting is ignored, so one press (or one double
  click) opens one terminal; a Resume that is off says why in text under the row.
Acceptance:
  - [ ] Resume a Claude session from another worktree → terminal opens there and continues the
        conversation.
  - [ ] Copy the command with PowerShell as shell → it runs as pasted.
  - [ ] Double-click Resume → one terminal opens, not two. (evidence/T-678.txt)
Compat: —
Source: D-05-085

### VIEW-091 · Session history reads many agents' transcripts
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: uses several agent CLIs over time.
User sees: sessions from all of them in one list, with titles.
Rules: Claude: sub-agents pruned, working-folder drift handled, generated titles used; Codex: both
  session roots merged without duplicates; worker sessions excluded; its title index used; Kimi,
  Grok, Devin, Cline, Antigravity, OMP, Rovo, Cursor, Hermes, OpenClaw, Copilot and Pi are also
  read; an agent's own session-folder override is used exactly as given, ahead of the default agent
  folder; Claude Code keeps each project under a folder named after its path with every character
  that is not a letter or digit replaced by its own dash; the scan finds folders the same way.
Acceptance:
  - [ ] Run one Claude and one Codex session → both listed with titles.
  - [ ] Set an agent's own session-folder override → its sessions are read from that folder.
Compat: reads the on-disk session transcripts of the listed agent CLIs
Source: D-05-091

### VIEW-095 · Handoff note autosaves
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: writes in a workspace's handoff note.
User sees: a small state: unsaved, saving, saved, or an error; the text is never lost.
Rules: a failed save keeps the buffer and shows an error.
Acceptance:
  - [ ] Type, then wait → the state reads saved.
  - [ ] Make the save fail → an error shows and the text is still there.
Compat: —
Source: D-05-095

### VIEW-098 · Resource Manager: memory and CPU per worktree
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: clicks the resource item in the status bar, then a session row.
User sees: the terminal session count and a popover breaking memory and CPU down by repo and
  worktree, including browser tabs; picking a row closes the popover and focuses that pane.
Rules: memory figures carry plain caveats about what they measure; a warning appears when memory
  commit passes 60 % and again at 80 %; browser rows are read-only; nothing polls while the popover
  is closed; a Space scan result hands off as ready; Terminals left over from a layout whose tab is
  gone are not counted; sessions started in the background are counted without their pane being on
  screen; sessions that cannot be tied to a worktree are listed in their own unattributed group
  instead of being dropped.
Acceptance:
  - [ ] Open with three agents → each worktree shows memory and CPU.
  - [ ] Press Enter on a row → its pane has focus.
Compat: —
Source: D-05-098

### VIEW-011 · Automations and Skills pages
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: turns on the Automations or Skills title-bar button, or opens either page.
User sees: the Automations or Skills page; whichever was open at quit is restored after a restart.
Rules: the button is off by default; the page stays; its settings section is cut.
Acceptance:
  - [ ] Enable the button → it appears in the title bar and opens the page.
  - [ ] Open Skills, restart → Skills is shown.
Compat: each button is its own View > Appearance toggle; both are off by default.
Source: D-05-011

### VIEW-069 · Ask an agent to fix things from Source Control
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: chooses an agent action such as resolving conflicts.
User sees: a dialog to pick the agent and confirm the prompt; the agent starts in the worktree.
Rules: merge conflicts offer a resolve-conflicts prompt; when the saved launch choice already
  matches, the dialog is skipped and the agent starts once on its own; if the prompt cannot be
  handed to the started agent, the launch is reported as failed.
Acceptance:
  - [ ] Create a conflict → resolve-conflicts action available; running it starts an agent.
  - [ ] Saved launch choice already matches → no dialog; the agent starts exactly once.
Compat: —
Source: D-05-069

### VIEW-087 · Continue a session with another agent
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: chooses to continue a past session with the same or a different agent.
User sees: a new session that carries the transcript, where it stopped, and the original working
  folder.
Rules: works with the same agent or with a different one.
Acceptance:
  - [ ] Continue a Codex session in Claude → Claude starts with the prior transcript.
  - [ ] Continue a Claude session with Claude → a new session starts in the original working folder.
Compat: —
Source: D-05-087

### VIEW-010 · Tasks page button and shortcut
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks the Tasks button in the title bar, or a bound shortcut.
User sees: the Tasks page, listing GitHub issues and pull requests.
Rules: the title-bar button is on by default and can be hidden from View > Appearance; the default
  task source is GitHub and the default preset shows everything; the shortcut ships unbound; other
  task providers are cut; the page becomes GitHub-only.
Acceptance:
  - [ ] Fresh profile → a Tasks button is visible; clicking it opens the GitHub task list.
  - [ ] Hide the Tasks button from View > Appearance → it leaves the title bar.
Compat: keybinding id view.tasks, no default key; the Tasks button is a View > Appearance toggle, on
  by default.
Source: D-05-010
Amended 2026-10-12 (DT-O3): the Tasks button is the sidebar's Tasks row, hidden from Settings > Appearance.

### VIEW-043 · Find pull requests and checks from the palette
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: types a pull request number or title in the palette.
User sees: matching pull requests with their check state, from the same data the Checks panel uses.
Rules: when the host reports a PR as unlinked, the palette never falls back to an older cached PR
  result.
Acceptance:
  - [ ] Type a known PR number → that PR is listed with its check state.
  - [ ] A PR the host reports as unlinked → no older cached PR is listed in its place.
Compat: —
Source: D-05-043

### VIEW-059 · Explorer file tree
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: browses the worktree's files in the Explorer tab, or narrows them with the name filter.
User sees: a tree with the repo name in its toolbar, refresh, expand and collapse, and keyboard
  movement; a compact name filter keeps only matches and their folders; an empty Explorer offers an
  add-project row.
Rules: the tree updates on its own when files change on disk, including at a drive root; refresh
  shows a spinner and is disabled while running; hidden dotfiles can be shown per worktree; only
  opt-outs are saved; keystrokes in text inputs are never taken as explorer shortcuts; Checks for
  ignored paths wait until typing pauses; on Windows network shares, paths compare without case and
  only on whole folder boundaries, so a neighbouring share with a similar name is not treated as
  inside the tree; filtering the tree to a folder does not change which folders stay expanded
  afterwards; hiding and reopening the Explorer on the same worktree keeps its expanded folders;
  showing another worktree starts fresh; pressing Down with nothing focused selects the first row; in an empty Explorer, Add a project adds the chosen folder itself when the project list is not on screen (a Git project, else a plain folder project) and asks the window to show the list, so it never ends in a message sending the user elsewhere.
Acceptance:
  - [ ] Create a file in a terminal → it appears in the tree without manual refresh.
  - [ ] Arrow down through the list → selection moves row by row.
  - [ ] Type a file name → only it and its parents show.
  - [ ] No project → the Explorer offers an add-project row. (unit tests; evidence/T-683.txt)
  - [ ] Add a project from the empty Explorer with the project list hidden → the folder is added. (unit tests; evidence/T-683.txt)
Compat: —
Source: D-05-059

### VIEW-060 · Explorer file operations
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: renames inline, deletes, undoes, copies a path, or drags files.
User sees: rename commits when focus leaves and is discarded on Escape; delete removes the
  selection; undo and redo reverse file operations; paths copy to the clipboard; drags scroll at the
  edges.
Rules: deleting a folder and a file inside it deletes the folder once; Delete is the Delete key, or
  Mod+Backspace on Mac; undo Mod+Z; redo Mod+Shift+Z or Ctrl+Y; Copy path is Mod+Alt+C on Mac and
  Alt+Shift+C elsewhere; copy relative path is Mod+Alt+Shift+C; a slow operation never overwrites
  the result of a newer one; clicking the name of the selected row again starts rename; a click on a
  folder name waits out the double-click time before expanding, so starting a rename never also
  opens or closes the folder; on case-sensitive file systems, two selected files whose names differ
  only by case are both deleted; row menus offer only what fits the row: collapse for an expanded
  folder, find in folder and open in terminal for folders, view for files, and copy as a file to the
  system clipboard for a single file; a failed system copy shows an error toast; Escape on the delete question cancels it and returns focus to the tree; a drag the system cancels ends cleanly and moves nothing.
Acceptance:
  - [ ] Rename then press Escape → name unchanged on disk.
  - [ ] Select a folder and a file inside it, delete → one delete, no error.
  - [ ] Press Delete, then Escape at the question → nothing is deleted and the tree has focus. (unit tests; evidence/T-683.txt)
Compat: five Explorer keybinding commands (undo, redo, copy path, copy relative path, delete); their
  exact ids are held back pending the allowlist.
Source: D-05-060

### VIEW-061 · Search in files from the right sidebar
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Mod+Shift+F or flips the Explorer to its search view, types a query, clicks a
  result.
User sees: matches grouped by file; clicking opens the file at the match.
Rules: searching from a folder pre-fills the query and limits it to that folder; when a search
  fails, the panel explains the failure rather than showing nothing; a search that simply finds no
  matches shows no error; a result opens in the worktree the search ran in, even if the active
  worktree changed since; Escape in the search box closes the search and puts focus back on the tree.
Acceptance:
  - [ ] Search from a folder's menu → include pattern is that folder.
  - [ ] Break the search tool → an error message, not an empty list.
  - [ ] Press Escape in the search box → the search closes and the tree has focus. (unit tests; evidence/T-683.txt)
Compat: keybinding id sidebar.search.toggle
Source: D-05-061

### VIEW-062 · Source Control: changed files list
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens Source Control.
User sees: changed files in ordered sections, as a list or a tree, with status letters, a path
  filter, and the file open in the editor highlighted; status updates soon after edits and pushes.
Rules: list view is the default; submodules can be expanded in place; very large change sets show a
  banner instead of freezing; a huge-repo warning can be dismissed and stays dismissed; only the
  visible part of a long list is drawn; the active worktree refreshes first, then visible ones; slow
  refreshes back off; a push or an upstream ref change triggers a refresh; an older status result
  never overwrites a newer one; if a later automatic refresh fails, the last good result stays on
  screen; sections run Changes, Staged, Untracked by default; a setting offers staged-first or
  untracked-first, and unresolved merge conflicts are always pinned in their own section above the
  rest; tree view folds a chain of single-child folders into one row but never folds a folder that
  has more than one child; the highlight follows the kind of tab that is open: an editing tab marks
  the working-tree row first and the staged row only when there is no working-tree change; a
  branch-compare tab of the same file highlights none of the pending rows.
Acceptance:
  - [ ] Change 3 files, open the panel → 3 rows in the right sections.
  - [ ] Type part of a path in the filter → only matching rows.
  - [ ] Edit a file → its status updates within the polling interval.
Compat: a list-or-tree setting for Source Control, list by default.
Source: D-05-062

### VIEW-063 · Open a changed file's diff
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks a changed file, or modifier-clicks it, or right-clicks it.
User sees: a diff preview opens; Mod-, Shift- or Alt-click opens it in a split; the context menu
  offers stage, unstage, discard and open.
Rules: Mod is the Command key on a Mac and Control on other systems; a plain click never opens a
  split; row action icons that are unavailable still show their tooltip on hover but ignore clicks.
Acceptance:
  - [ ] Ctrl-click a file on Windows → diff opens in a new split.
  - [ ] Plain click on a file → the diff preview opens without a split.
Compat: —
Source: D-05-063

### VIEW-064 · Commit box with saved drafts and AI message
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: writes a commit message or asks for one to be generated, then commits.
User sees: a message box per worktree that keeps its draft; a generate button with a spinner; a
  clear summary and a recovery prompt when a commit fails.
Rules: each worktree has its own draft, kept across switching and the panel reopening; commit is
  enabled only when there is something to commit and a message; generation uses the user's chosen
  agent and defaults; when only submodule pointers changed, Stage All stays the main action in the
  commit area; a failed commit is summed up in one line; a details toggle appears only when the full
  error says more than the summary; failures from the lint step of commit hooks are summed up as a
  lint failure rather than a wall of tool output; while merge conflicts are unresolved or a git
  operation is in progress, the message box is disabled and the commit controls are hidden;
  generation settings can be saved as the default for this repository or for every repository; the
  save control hides once the current choice already is the saved default.
Acceptance:
  - [ ] Type a draft in worktree A, switch to B and back → draft still there.
  - [ ] Make a hook fail the commit → a summary and a recovery prompt appear.
Compat: —
Source: D-05-064

### VIEW-065 · One main git button that changes with the state
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks the main Source Control button or opens its dropdown.
User sees: the button offers the next sensible step (commit, push, publish, sync or create a pull
  request); the dropdown lists the alternatives.
Rules: after choosing create pull request, the flow carries through commit and push before opening
  the PR composer; labels change width without pushing the sidebar wider; a branch that differs from
  its remote only by equivalent patches is steered to Create PR, with Force Push still in the commit
  area; detached HEAD never offers Publish Branch, but still offers Create PR when a compare base is
  known; push choices stay available after the linked PR has merged; Create PR stays disabled while
  a newer readiness check is still loading; an older yes never enables it; when a push or sync
  picked from the dropdown is running while the main button reads Commit, the spinner shows on the
  dropdown arrow.
Acceptance:
  - [ ] Clean tree with unpushed commits → main button pushes.
  - [ ] Pushed branch with no PR → create pull request is offered.
Compat: —
Source: D-05-065

### VIEW-070 · Create or link a pull request from the sidebar
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: starts a pull request from Source Control, or links an existing one.
User sees: a composer with a generated title and body, a link to the created PR in the header, and a
  stack map when the PR sits in a stack.
Rules: creation is blocked with a reason when local state is not ready; a manual link to the host is
  offered as fallback; AI generation controls hide when source-control AI actions are hidden;
  clicking another PR in the stack map shows it but leaves the local checkout alone; when the push
  goes to a fork, the manual link for opening a pull request on GitHub names the fork owner with the
  branch so it targets the right repository.
Acceptance:
  - [ ] Create a PR → header shows its link.
  - [ ] Uncommitted changes → creation blocked with a reason.
Compat: —
Source: D-05-070

### VIEW-071 · Git history in the sidebar
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the git history list.
User sees: commit subject rows with managed tooltips.
Rules: a slow history load never replaces a newer one; after switching worktrees, the previous
  worktree history is never shown, even briefly.
Acceptance:
  - [ ] Make a commit → it appears at the top.
  - [ ] Switch worktrees → the previous worktree's commits never flash in the list.
Compat: —
Source: D-05-071

### VIEW-074 · Start a pull request from Checks
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: starts a review from the Checks panel; modifier-clicks the review link.
User sees: a create composer when the branch is ready; the review opens in Kolux or the system
  browser depending on the modifier, with a hint saying which.
Rules: the composer opens only when readiness is confirmed; a hard error clears once fixed; when a
  push is still needed and readiness is confirmed, the empty state offers one combined
  push-and-create action; a readiness answer is tied to the exact worktree, branch and git state and
  goes stale after about five minutes; a check for one worktree never clears an error shown for
  another.
Acceptance:
  - [ ] Branch pushed, no PR → create composer available.
  - [ ] Modifier-click the review link → it opens in the other browser and the hint names which one.
Compat: —
Source: D-05-074

### VIEW-078 · Ports in the status bar
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks the ports item in the status bar.
User sees: Ports the active workspace is listening on, with the URL a dev server printed, an Open
  button, and a stop button.
Rules: Ports are tied to a workspace by their process; URLs are picked up from terminal output and
  checked against the process; Open uses the Kolux browser; Shift+Ctrl-click opens the system
  browser; stopping a port that already exited counts as success; a failed scan names the problem
  and keeps the last good list; Open uses the address the dev server printed when known, otherwise
  plain http on the listening address; Ports held by processes outside the workspace are listed as
  external and can never be stopped from here; a port belongs to the deepest worktree containing its
  process's working folder, so nested worktrees keep their own ports; the popover closes on Escape
  (focus goes into it on open and back to the item on close), scrolls instead of running off the
  screen, names its buttons by port ("Open port N", "Stop port N"), shows Stop as "Stopping…" and
  not pressable twice while it runs, shows a failed stop as a red "Could not stop port N" note, and
  says "Showing the first 12 external ports; more may be listening." when the scan's cut of 12 external
  ports is reached.
Acceptance:
  - [ ] Start a dev server on 5173 → port listed with its URL; stop it → it disappears.
  - [ ] A port held by a process outside the workspace → listed as external with no stop button.
  - [x] Escape closes the popover and focus returns to the Ports item; Stop reads "Stopping…" while it runs and a failed Stop shows a red note; at 12 external ports the popover says the list is cut. (cards; evidence/T-685.txt)
Compat: —
Source: D-05-078

### VIEW-105 · Link popover: choose where a link opens
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks a link in Kolux.
User sees: a popover with the full destination, open in the system or Kolux browser, copy link, and
  a way to the link setting.
Rules: Copy keeps the popover open; a failed open shows a toast.
Acceptance:
  - [ ] Click a link → full URL shown; copy → popover stays.
  - [ ] Make the open fail → a toast says so.
Compat: —
Source: D-05-105

### VIEW-109 · Keyboard layouts, Option as Alt and key protocols
Tier: P2 · Pushed: 1 · State at 0.15.0: live-unverified
User does: types in terminals on a non-US layout, on a Mac with Option, in a full-screen program, or
  through an input method.
User sees: shortcuts match the printed keys; Option acts as Alt or types symbols as the layout
  suggests; extended keys like Shift+Enter reach programs; Enter that confirms an input-method
  composition never sends.
Rules: Kolux detects the layout and follows layout changes on Mac; left and right Option are tracked
  separately; off on the native Windows console unless the agent needs it; the protocol resets
  cleanly after the program exits; while an input method is composing, every key goes to it,
  shortcut chords such as the palette chord included; the same chord outside composition works as
  usual.
Acceptance:
  - [ ] German layout → shortcut labels use the layout's characters.
  - [ ] Run an agent that needs extended keys on Windows → Shift+Enter works.
  - [ ] Compose with an IME, press Enter → text confirmed, no submit.
Compat: —
Source: D-05-109

### VIEW-110 · Clipboard size limits and terminal copy
Tier: P2 · Pushed: 1 · State at 0.15.0: live-unverified
User does: copies large text or images, or lets a terminal program copy.
User sees: copies work up to set limits and show feedback; programs can copy to the clipboard by
  default.
Rules: program clipboard access is on by default and an older saved off value is overridden once.
Acceptance:
  - [ ] Copy over the limit → clear message, no crash.
  - [ ] A program in the terminal copies text → it lands on the system clipboard.
Compat: —
Source: D-05-110

### VIEW-013 · Floor timeline of agent activity
Tier: P2 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens the Floor page and picks a range of 15 minutes, 60 minutes or today.
User sees: one lane per agent session with coloured segments for working, needs-you and idle over
  time, and six time ticks along the axis.
Rules: blocked and waiting both show as needs-you; segments are clamped to the chosen range; today
  starts at local midnight; a lane with no live terminal evidence shows as unverifiable rather than
  idle; child sessions nest under their parent; the local machine's lanes come first; Floor left the
  sidebar on 2026-09-22; it is reachable by an unbound shortcut.
Acceptance:
  - [ ] Range today at 09:00 → axis starts at local midnight.
  - [ ] An agent blocked on approval for 5 minutes → a needs-you segment of that length.
  - [x] A re-read fails → the last lanes stay, dimmed, with a line saying so. (T-675; evidence/T-675.txt)
Compat: keybinding id view.floor
Source: D-05-013

### VIEW-111 · First-run notification permission
Tier: P2 · Pushed: 3 · State at 0.15.0: live-unverified
User does: starts Kolux for the first time on a Mac.
User sees: one welcome notification that asks for permission; never asked again once answered.
Rules: other platforms are reported unsupported and never probed; if the system does not answer in
  time, nothing is recorded and the question may come up again on a later start.
Acceptance:
  - [ ] Fresh Mac profile → one prompt; restart → none.
  - [ ] Windows or Linux → no permission prompt is ever shown.
Compat: —
Source: D-05-111

### VIEW-114 · Onboarding checklist and setup guide in the sidebar
Tier: P2 · Pushed: 6 · State at 0.15.0: live-unverified
User does: adds a first project, or skips onboarding and opens a folder.
User sees: the project checklist ticks; the setup guide panel appears without flashing.
Rules: tour events exist, but telemetry is compiled out, so nothing is sent.
Acceptance:
  - [ ] Add a project → checklist item done.
  - [ ] Skip onboarding and open a folder → the setup guide panel appears with no flash.
Compat: —
Source: D-05-114

### VIEW-052 · Left sidebar tint
Tier: P2 · Pushed: 7 · State at 0.15.0: live-unverified
User does: chooses a sidebar appearance mode, tint colour and opacity.
User sees: the left sidebar takes that tint.
Rules: default mode leaves the sidebar untinted.
Acceptance:
  - [ ] Pick a tint at 50 % → sidebar background changes accordingly.
  - [ ] Default mode → the sidebar carries no tint.
Compat: three appearance settings: sidebar appearance mode, tint colour and tint opacity.
Source: D-05-052

### VIEW-090 · Scan notices in the session list
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens the list when something blocked or limited the scan.
User sees: a short notice: why the list is empty, how many transcripts were skipped, that the scope
  was cut short, or that a database could not be read.
Rules: notices are de-duplicated and capped; a skipped transcript alone never turns an empty list
  into an error notice.
Acceptance:
  - [ ] Make one transcript unreadable → a skipped-count notice.
  - [ ] One unreadable transcript among readable ones → sessions listed, a skipped count shown, no
        error.
Compat: —
Source: D-05-090

### VIEW-092 · Session scans run in the background and survive restarts
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens the list on a machine with thousands of sessions.
User sees: the list fills without freezing the window, and is quick again after a restart.
Rules: scans run in a separate background process that restarts on failure; parsed results are
  cached on disk with a version stamp; overlapping scans merge; one window cancelling does not
  cancel another's; a stalled WSL disk never hangs the scan; only WSL distributions that are already
  running are searched; a stopped one is never started for a scan.
Acceptance:
  - [ ] Restart Kolux → the list appears faster than the first cold scan.
  - [ ] A WSL distribution is stopped → the scan skips it and never starts it.
Compat: —
Source: D-05-092

### VIEW-115 · The shell avoids needless redraws
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: works with many tabs and agents.
User sees: the window stays responsive.
Rules: changes to unrelated settings or other app state do not redraw the shell.
Acceptance:
  - [ ] Change an unrelated setting → no visible flicker of the workspace.
  - [ ] Many agents streaming at once → the sidebar and top bar do not flicker.
Compat: —
Source: D-05-115

### VIEW-039 · Palette list caps and focus return
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: searches something that matches many items, then closes the palette or picks a row.
User sees: each section shows up to 20 rows and a more count that adds 20 at a time; on close, focus
  returns to the previous element, else the terminal, else the editor.
Rules: duplicate keys never leave ghost rows.
Acceptance:
  - [ ] 50 matches in one section → 20 rows and a 30-more control.
  - [ ] Open from a terminal, Escape → typing goes to that terminal.
Compat: —
Source: D-05-039

### VIEW-072 · Send or clear review notes
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: sends the review notes written on diffs to the agent, or clears them.
User sees: notes go to the agent; clearing asks for confirmation.
Rules: the send command ships unbound.
Acceptance:
  - [ ] Clear notes → confirmation before they are removed.
  - [ ] Send notes → the agent receives them as its next input.
Compat: a keybinding command with no default key; its exact command id is held back pending the
  allowlist.
Source: D-05-072

### VIEW-106 · View, Help and Appearance menus
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the app menus, including View > Appearance.
User sees: reload, developer tools, zoom and full screen; toggles for both sidebars, the status bar,
  the Tasks and Automations buttons and the title-bar app name; Help with crash report, tour,
  getting started and update check; an About panel that reports GPU status.
Rules: the About panel puts Safe Graphics Mode ahead of the browser engine's GPU status and says
  unavailable until known; Tasks button and app name are on by default; Automations button is off.
Acceptance:
  - [ ] Open About with safe graphics on → it says so.
  - [ ] Untick the app name → the title bar no longer shows it.
Compat: a View > Appearance toggle for the app name, on by default.
Source: D-05-106

### VIEW-113 · Markdown view preferences
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a Markdown file and switches preview, contents panel or frontmatter.
User sees: the choice sticks for that file; the contents panel width is clamped.
Rules: choices are kept per file; the contents panel cannot be dragged past its width limits.
Acceptance:
  - [ ] Hide frontmatter, reopen → still hidden.
  - [ ] Drag the contents panel past its limit → it stops at the limit.
Compat: —
Source: D-05-113

### VIEW-117 · Hover-only buttons stay visible on touch screens
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: uses Kolux on a touch screen or pen, where nothing can hover.
User sees: row action buttons that a mouse user sees only on hover are shown all the time.
Rules: applies to every hover-revealed action: sidebar rows, the past-session list, checks, ports
  and status-bar popovers; with a mouse the buttons still stay hidden until hover.
Acceptance:
  - [ ] Touch-only device → row actions are visible without hovering.
  - [ ] With a mouse → they stay hidden until hover.
Compat: —
Source: D-05-117

### VIEW-118 · Select changed files and stage or unstage them together
Tier: P2 · Pushed: — · State at 0.15.0: half-done
User does: right-clicks a changed file in Source Control, or extends a selection of changed files,
  then uses the bar that appears under the list.
User sees: a bar along the bottom of the changed-files list with how many files are selected, a
  Stage button and an Unstage button that each carry how many of the selected files they apply to,
  and a clear button; the list leaves room so its last row stays visible.
Rules: right-clicking a row that is not selected makes it the selection, so the context menu and the
  bar act on it; Stage and Unstage show only when at least one selected file can take that action;
  while the action runs the buttons are disabled and a spinner replaces the count; Escape, the clear
  button, a click outside the list, or switching between list and tree view clears the selection; a
  selected file that vanishes from the visible list (filtered out, staged elsewhere, gone after a
  refresh) leaves the selection; when the row a range began from is out of view, Kolux forgets it
  and the next range click acts as a plain click; a range runs in visible order across sections;
  Mod-click toggles a single row; at 0.15.0 Mod-, Shift- and Alt-click open the file in a split
  before selection is considered, so building a multi-row selection with the mouse is shadowed; the
  owner decides which gesture wins.
Acceptance:
  - [ ] Right-click an unstaged changed file → the bar shows 1 selected and a Stage (1) button;
        press Escape → the bar disappears.
  - [ ] Select a file, then filter the list so the file is hidden → the selection empties and the
        bar hides.
  - [ ] With a selection showing, click outside the Source Control list → the selection clears.
  - [ ] Click Stage in the bar → the button disables with a spinner until staging finishes, then the
        files move to the staged section.
Compat: —
Source: D-05-118

### VIEW-034 · Agent Grid page (retired 2026-09-22)
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-09-22
User does: used to switch the sidebar to an agent grid.
User sees: up to six live terminal tiles per launched worktree, with the font stepping down from 14
  to 12 to 11 as the tile count grows.
Rules: removed together with the sidebar mode switch when the sidebar was simplified on 2026-09-22.
Acceptance:
  - [ ] The sidebar has no mode switch and no agent grid.
  - [ ] A launched worktree shows its terminals only in the terminal workspace.
Compat: —
Decision: H: default skip
Source: D-05-034

### VIEW-029 · Agent Dashboard drawer
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: with the experimental dashboard setting on, opens the drawer (also from a bound
  shortcut), and launches or types to agents from its cards.
User sees: Agents bucketed as working, idle, done or blocked; each row shows the agent label with
  its model, conversation name, buttons to send to it, a question glyph when waiting, red when
  blocked, tree lines for child agents and an orchestration task preview.
Rules: off by default, behind an experimental setting; an agent whose working signal has gone stale
  drops to idle; a completion the user has acknowledged moves to idle; finished agents stay listed
  after their tab is closed; Escape closes a terminal panel open inside the drawer before it closes
  the drawer; choosing a row reveals that row's worktree; nothing is computed while the drawer is
  closed, and it stays usable through a burst of 100 status updates; the drawer's own settings menu
  decides whether idle agents are listed; disabled agents are not offered for launch; the user's
  defaults are honoured; a card shows the linked GitHub pull request when one is known; its shortcut
  ships with no key; it does nothing while the experiment is off or while Settings is open; until
  the experiment is on, its row is missing from the shortcut list, which looks like a broken key;
  rows show the repository's icon; a finished agent's row never shows a tool as still running.
Acceptance:
  - [ ] With default settings, no menu, button or shortcut opens the drawer.
  - [ ] Turn the experiment on and bind the shortcut → the drawer opens with agents grouped as
        working, idle, done or blocked.
Compat: an experimental setting, off by default; keybinding id dashboard.toggle with no default key.
Decision: H: default skip (an improvement card asks for a single always-on overview of agents; owner
  to decide)
Source: D-05-029

### VIEW-031 · Separate dashboard window and the Agent Map (retired 2026-10-05)
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-10-05
User does: used to pop the dashboard into its own window or see agents on a map.
User sees: neither exists; only the drawer remains.
Rules: both were retired in the redesign; only the drawer was kept.
Acceptance:
  - [ ] No pop-out button or separate window exists for the dashboard.
  - [ ] No Agent Map view can be opened.
Compat: —
Decision: H: default skip
Source: D-05-031

### VIEW-033 · Activity page
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: turns on the Activity experiment and opens the page.
User sees: the Activity feed; if it was open at quit it is restored even when settings fail to load.
Rules: off by default.
Acceptance:
  - [ ] Default settings → no entry to the Activity page anywhere.
  - [ ] Turn the experiment on, open Activity, quit and relaunch → Activity is shown again.
Compat: an experimental setting, off by default.
Decision: H: default skip
Source: D-05-033

### VIEW-101 · Restart stale Codex sessions from the status bar (retired 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-10-05
User does: notices the Codex restart item after a Codex account change.
User sees: a count of stale Codex sessions, tabs and worktrees, offered for restart.
Rules: sessions already asked to restart are not offered again; the status-bar summary lived in the
  Codex account menu that went with the status-bar usage chips on 2026-10-05; the per-pane restart
  offer after an account switch stays (area 07).
Acceptance:
  - [ ] After a Codex account change the status bar shows no restart item.
  - [ ] The restart offer still appears on each affected pane (area 07).
Compat: —
Decision: H: default skip
Source: D-05-101

### VIEW-102 · Provider usage chips in the status bar (retired 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-10-05
User does: used to read Claude, Codex and other providers' usage in the status bar.
User sees: per-provider bars, a roster popover with reset times and run-out forecasts, sign-in
  prompts and a Codex account switcher.
Rules: usage moved to the weekly pill top right and the pane headers; a one-time callout that
  explained the switch between used and remaining percentages was anchored to these chips and is no
  longer shown; which providers had a chip depended on lasting sign-in signals (a managed account, a
  saved cookie or key, or for Antigravity a ticked item plus Gemini sign-in), so one failed fetch
  never hid a configured provider.
Acceptance:
  - [ ] The status bar carries no provider usage chips.
  - [ ] Weekly usage shows in the top-right pill and session usage in pane headers.
Compat: —
Decision: H: default skip
Source: D-05-102

### VIEW-028 · Swarm pane footer and terminal-grid message bar (retired 2026-10-05)
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-10-05
User does: used to answer, approve or deny, or type to an agent from a strip under each terminal
  pane.
User sees: no strip under terminal panes any more; typing goes to the terminal, approvals go through
  Board or the terminal.
Rules: it went in two steps on the same day: first the message bar, then the whole footer; Board
  cards still carry approve and deny, and the Agents screen still has its composer.
Acceptance:
  - [ ] No strip appears under any terminal pane.
  - [ ] A permission request can be answered from its Board card or in the terminal itself.
Compat: —
Decision: H: default skip
Source: D-05-028

### VIEW-030 · Read-only Runs view in the dashboard
Tier: H · Pushed: 11 · State at 0.15.0: hidden
User does: with the dashboard on, opens its Runs tab.
User sees: orchestration runs and their tasks, with refresh and paging; nothing can be dispatched
  from here.
Rules: creating or routing work stays in the coordinator terminal and the CLI.
Acceptance:
  - [ ] With default settings the Runs tab cannot be reached.
  - [ ] With the dashboard on, the Runs tab offers refresh and paging but no way to dispatch work.
Compat: —
Decision: H: default skip
Source: D-05-030

### VIEW-032 · Desktop pet that reacts to agents
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: turns on the pet experiment.
User sees: an animated pet over the window that idles, runs while agents work, waits when one is
  blocked, and celebrates a finished review; it jumps on hover, can be dragged, has a status-bar
  segment, and custom pet bundles can be imported.
Rules: off by default; dragging beyond a small dead zone sends it running in the drag direction; it
  is kept inside the window bounds; it appears only once saved state has loaded; frame sizes are
  measured from the image; a bundle in the Codex pet format gets matching defaults.
Acceptance:
  - [ ] Default settings → no pet appears and the status bar has no pet item.
  - [ ] Turn the experiment on → the pet idles, then runs while an agent works.
Compat: an experimental setting, off by default; pet bundles use the same format as Codex pets.
Decision: H: default skip
Source: D-05-032

### VIEW-049 · Switch a tab between chat and terminal
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: toggles a tab's mode.
User sees: the tab flips between a chat view and the raw terminal; split siblings are untouched.
Rules: new drafts for some agents open in chat when their transcript is stored locally.
Acceptance:
  - [ ] Default settings → tabs offer no chat or terminal mode toggle.
  - [ ] Turn the chat experiment on → the toggle flips one tab and leaves its split siblings alone.
Compat: —
Decision: H: default skip
Source: D-05-049

### VIEW-104 · Third-party provider logos in usage UI
Tier: X · Pushed: 10 · State at 0.15.0: live-unverified
User does: sees provider marks next to usage items.
User sees: official marks of other companies, such as the MiniMax logo.
Rules: replace with the owner's own neutral marks.
Acceptance:
  - [ ] No other company's logo ships in the app.
  - [ ] Each provider in usage views shows a mark drawn for Kolux.
Compat: —
Source: D-05-104

### VIEW-022 · Custom-agent builder from the Agents screen
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: clicks + beside the agents heading or the empty-state call to build an agent.
User sees: the custom-agent builder.
Rules: owner cut with its settings page; the department-agents plan wants a successor.
Acceptance:
  - [ ] The Agents screen offers no control that opens an agent builder.
  - [ ] DECISIONS.md lists the custom-agent builder under Dropped.
Compat: —
Decision: default cut: the custom-agent builder goes with its settings section; the
  department-agents plan wants a successor. Revive via DECISIONS.md.
Source: D-05-022

### VIEW-035 · Kolux Mobile page and title-bar button
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: turns on the Kolux Mobile button and opens the page.
User sees: the phone pairing page.
Rules: button off by default; the page restores even when its button is hidden.
Acceptance:
  - [ ] No Kolux Mobile button or page exists.
  - [ ] A saved last page that was the mobile page reopens on the terminal workspace.
Compat: a View > Appearance toggle for the button, off by default.
Decision: default cut: the mobile page and phone pairing go with area 18 (remote and hosts). Revive
  via DECISIONS.md.
Source: D-05-035

### VIEW-044 · Plugin actions in the palette
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: searches for an action a plugin added.
User sees: plugin-provided rows in the palette.
Rules: goes with the plugin runtime.
Acceptance:
  - [ ] The palette lists no rows contributed by plugins.
  - [ ] Kolux has no plugin runtime that could add palette actions.
Compat: —
Decision: default cut: plugin marketplace and runtime dropped. Revive via DECISIONS.md.
Source: D-05-044

### VIEW-045 · Host badges and host-qualified rows in the palette
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: uses the palette with more than one machine connected.
User sees: a host badge on rows and tabs named per host.
Rules: badges appear only when two or more hosts are connected.
Acceptance:
  - [ ] Palette rows carry no host badge.
  - [ ] Tab names are never qualified by a machine name.
Compat: —
Decision: default cut: workspaces spread over several machines go with area 18 (remote and hosts).
  Revive via DECISIONS.md.
Source: D-05-045

### VIEW-055 · Workspace host scope in the sidebar
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: chooses which machines' workspaces the sidebar shows and in what order.
User sees: workspaces filtered and ordered by host.
Rules: defaults to all hosts; invalid saved scopes fall back to all; uploads to a remote workspace
  that has not been placed are held back.
Acceptance:
  - [ ] The sidebar offers no host scope control.
  - [ ] Every listed workspace belongs to this computer.
Compat: —
Decision: default cut: choosing workspaces by machine goes with area 18 (remote and hosts). Revive
  via DECISIONS.md.
Source: D-05-055

### VIEW-058 · Plugin panels in the right sidebar
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens a tab a plugin added to the right sidebar.
User sees: the plugin's own panel, themed to match, with a watchdog for hung panels.
Rules: an uninstalled plugin's tab falls back to another tab; hidden panel errors are announced.
Acceptance:
  - [ ] The right sidebar has no tabs added by plugins.
  - [ ] Kolux has no plugin runtime.
Compat: —
Decision: default cut: plugin marketplace and runtime dropped. Revive via DECISIONS.md.
Source: D-05-058

### VIEW-077 · GitLab merge requests in the Checks panel
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens Checks on a GitLab branch.
User sees: the merge request's pipeline and merge state.
Rules: GitLab status is used when no GitHub PR exists.
Acceptance:
  - [ ] A GitLab branch with no GitHub pull request → Checks says there is no review.
  - [ ] No GitLab merge request data is fetched.
Compat: —
Decision: default cut: GitLab dropped; GitHub is the only kept provider. Revive via DECISIONS.md.
Source: D-05-077

### VIEW-079 · Ports tab for remote repositories
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens the Ports tab on an SSH repository.
User sees: forwarded ports of the remote machine.
Rules: the tab only appears for SSH repositories; its shortcut is Mac-only.
Acceptance:
  - [ ] The right sidebar has no Ports tab.
  - [ ] Listening ports stay available from the status bar.
Compat: keybinding id sidebar.ports.toggle (Mac only).
Decision: default cut: SSH hosts go with area 18 remote and hosts. Revive via DECISIONS.md.
Source: D-05-079

### VIEW-094 · Past sessions on remote machines
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: browses or resumes sessions stored on an SSH host, WSL or a paired runtime.
User sees: remote sessions merged into the list and resumable on that machine.
Rules: host scope defaults to the workspace's host.
Acceptance:
  - [ ] The session list shows sessions from this computer only.
  - [ ] No resume ever targets a remote machine.
Compat: —
Decision: default cut: remote hosts, WSL execution and pairing go with area 18. Revive via
  DECISIONS.md.
Source: D-05-094

### VIEW-103 · Remote host status in the status bar
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: looks at the Remote Hosts item.
User sees: connection state of SSH hosts and paired runtimes, and remote server updates.
Rules: everything it reported concerned machines other than this one.
Acceptance:
  - [ ] The status bar has no remote hosts item.
  - [ ] No remote server update is ever offered.
Compat: —
Decision: default cut: SSH hosts and remote servers go with area 18. Revive via DECISIONS.md.
Source: D-05-103

## Dropped by default (tier D)

- VIEW-022 · Custom-agent builder from the Agents screen — goes with its settings section (owner cut
  2026-10-05); the department-agents plan wants a successor.
- VIEW-035 · Kolux Mobile page and title-bar button — area 18 (remote and hosts) dropped by the
  owner on 2026-10-05.
- VIEW-044 · Plugin actions in the palette — plugin marketplace and runtime cut by the owner on
  2026-10-05.
- VIEW-045 · Host badges and host-qualified rows in the palette — area 18 dropped on 2026-10-05;
  workspaces live on this computer only.
- VIEW-055 · Workspace host scope in the sidebar — area 18 dropped on 2026-10-05; no host scope.
- VIEW-058 · Plugin panels in the right sidebar — plugin marketplace and runtime cut by the owner on
  2026-10-05.
- VIEW-077 · GitLab merge requests in the Checks panel — GitLab cut on 2026-10-05; GitHub is the
  only provider kept.
- VIEW-079 · Ports tab for remote repositories — area 18 dropped on 2026-10-05; local ports stay in
  the status bar.
- VIEW-094 · Past sessions on remote machines — area 18 dropped on 2026-10-05; history covers this
  computer only.
- VIEW-103 · Remote host status in the status bar — area 18 dropped on 2026-10-05; no remote servers
  to report.

## Hidden or retired (tier H)

- VIEW-034 · Agent Grid page — retired 2026-09-22; default skip.
- VIEW-029 · Agent Dashboard drawer — experimental switch, off by default; default skip, owner to
  decide.
- VIEW-031 · Separate dashboard window and the Agent Map — retired 2026-10-05; default skip.
- VIEW-033 · Activity page — experimental switch, off by default; default skip.
- VIEW-101 · Restart stale Codex sessions from the status bar — retired 2026-10-05 (pane-level
  restart stays in area 07); default skip.
- VIEW-102 · Provider usage chips in the status bar — retired 2026-10-05; default skip.
- VIEW-028 · Swarm pane footer and terminal-grid message bar — retired 2026-10-05; default skip.
- VIEW-030 · Read-only Runs view in the dashboard — lives inside the dashboard drawer, so off with
  it; default skip.
- VIEW-032 · Desktop pet that reacts to agents — experimental switch, off by default; default skip.
- VIEW-049 · Switch a tab between chat and terminal — chat experiment, off by default (area 14);
  default skip.
