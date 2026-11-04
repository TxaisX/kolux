# 03 · Terminals & panes

This area covers the place where every agent session lives on screen: the grid of panes and how
it grows, shrinks, splits, evens out and rearranges; tabs and tab groups with their menus, pinning,
colours and shortcuts; the pane header with its status dot, agent mark, session name, usage
percentage, branch chip, the finished-while-away glow and the order in which a narrow header gives
up its items; expanding one pane to fill the space and putting it back; the clean look with rounded
session windows; the floating workspace panel; copying, pasting, pasted screenshots, dropped files
and the notices shown when the clipboard fails; keyboard handling, input methods, full-screen
programs, scrollback and clickable links in output; GPU drawing with its fallback and its cap of six
contexts; sessions that outlive a quit, a crash or a dead background host; keeping the computer
awake while agents work; importing themes from Warp and Ghostty; and the kolux terminal command
group. The standalone terminal window, the attention ring and agent hibernation are hidden; remote,
WSL and web-client terminals, phone control of desktop terminals and the quick commands menu are cut
by default.

Tier counts: P0 25 · P1 62 · P2 35 · H 8 · X 1 · D 6

Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 04 Agent status, hooks &
notifications · 05 Views & navigation · 06 Usage & limits · 08 Orchestration · 10 Plan review &
protected actions · 11 Git, source control & review · 12 Editor & files · 13 Browser pane &
computer use · 14 Native chat · 17 Settings, appearance & input · 18 Remote & hosts (dropped) ·
19 App lifecycle & operations · 20 The kolux CLI · 21 Hidden, retired, removed

## Cards

### TERM-001 · Session-per-pane grid sized by pane count
Tier: P0 · Pushed: 1 · State at 0.15.0: live
User does: asks for more or fewer sessions in a workspace.
User sees: the terminal grid grows or shrinks between 1 and 12 panes, each pane its own session.
Rules: pane count is clamped to 1..12; growing adds empty (unstarted) panes; it never starts
  programs on its own; shrinking removes unstarted panes first, newest first; when only started
  sessions remain, shrinking offers to remove one started session and asks first; groups holding
  several tabs or a non-terminal tab are skipped when choosing what to remove; each group keeps its
  own tab strip and active tab; creating or closing a tab in one group never changes another group's
  active tab, and closing a group's last tab removes the group and moves focus to a neighbouring
  group.
Acceptance:
  - [x] Going from 4 to 6 panes adds 2 empty panes and leaves the 4 running sessions untouched. (cards; evidence/cards-TERM-001.txt)
  - [x] Going from 6 to 4 with 2 unstarted panes removes those 2 without any prompt. (cards; evidence/cards-TERM-001.txt)
  - [x] Asking for 13 panes yields 12. (cards; evidence/cards-TERM-001.txt)
Compat: —
Source: D-03-001

### TERM-004 · Grid layout arrangement for each pane count
Tier: P0 · Pushed: 1 · State at 0.15.0: live
User does: picks a layout preset or lets the grid arrange itself.
User sees: panes are arranged in balanced rows for the chosen count (one, two, four, six, nine or
  twelve panes) with every pane kept in order.
Rules: every existing pane survives a re-arrangement, in its original order; row count is computed
  from the pane count so panes stay roughly even; applying a preset keeps each running session
  attached to its pane (no restart).
Acceptance:
  - [x] Applying the 4-pane preset to 4 running sessions keeps the same 4 sessions with the same
      output. (cards live; evidence/cards-TERM-004.txt)
  - [x] After any re-arrangement every pane is still present, in its original order. (cards; evidence/cards-TERM-004.txt)
Compat: —
Source: D-03-004

### TERM-006 · Split a pane right or down
Tier: P0 · Pushed: 1 · State at 0.15.0: live
User does: uses the split shortcut, the header split button, or the pane menu.
User sees: the pane divides and a new shell opens beside or below it.
Rules: split right: macOS uses Cmd+D, while Windows and Linux use Ctrl+Shift+D; split down: macOS
  uses Cmd+Shift+D, while Windows and Linux use Alt+Shift+D; on Windows/Linux a bare Ctrl+D reaches
  the shell as end-of-input; split needs Shift; the new pane starts in the same folder as the pane
  it was split from; the header split button splits side by side.
Acceptance:
  - [x] Splitting a pane in folder X opens a shell whose working folder is X. (cards live; evidence/cards-TERM-006.txt)
  - [x] Pressing Ctrl+D in a Linux shell pane sends end-of-input rather than splitting. (cards; evidence/cards-TERM-006.txt)
Compat: keybinding commands for split right and split down (exact ids held back until allowlisted).
Source: D-03-006

### TERM-014 · Close a pane
Tier: P0 · Pushed: 1 · State at 0.15.0: live
User does: presses Cmd/Ctrl+W in a pane, the header close button, or Close Pane in the menu.
User sees: that pane closes and its neighbours take the space; closing the last pane closes the tab.
Rules: close applies to the focused pane only, not its siblings; a pane running a process asks first
  (see running-process confirmation); the layout stays consistent after closing (no gaps or ghost
  panes); closing a pane ends its program, forcing it if it does not exit.
Acceptance:
  - [x] Closing the middle of three panes leaves two panes filling the area. (cards; evidence/cards-TERM-014.txt)
  - [x] Closing the only pane in a tab closes that tab. (cards; evidence/cards-TERM-014.txt)
  - [x] Cmd/Ctrl+W has one owner wherever it is live: the tab close, which closes the focused pane; the pane
        close ships unbound for a user's own chord. (unit; evidence/T-717.txt)
Compat: keybinding command for closing the focused pane (exact id held back until allowlisted).
Source: D-03-014

### TERM-040 · New terminal tab and tab create menu
Tier: P0 · Pushed: 1 · State at 0.15.0: live
User does: presses Cmd/Ctrl+T or uses the new tab menu.
User sees: a new terminal tab, or a chosen browser or markdown tab, opens in the workspace.
Rules: new terminal: Cmd/Ctrl+T; new browser: Cmd/Ctrl+Shift+B; new markdown: Cmd/Ctrl+Shift+M; open
  markdown: Cmd/Ctrl+Shift+O; the new tab is focused and ready to type; a new terminal starts in the
  workspace folder; a requested start folder may be relative to the workspace or an absolute folder
  outside it; if the requested start folder is missing, the terminal starts in the workspace folder;
  an existing folder outside the workspace is kept.
Acceptance:
  - [x] Cmd/Ctrl+T opens a shell in the workspace folder with the cursor ready. (cards live; evidence/cards-TERM-040.txt)
  - [x] Asking for a start folder that does not exist opens the terminal in the workspace folder. (cards; evidence/cards-TERM-040.txt)
Compat: keybinding commands for new terminal, new browser, new markdown and open markdown tabs
  (exact ids held back until allowlisted).
Source: D-03-040

### TERM-041 · New agent tab
Tier: P0 · Pushed: 1 · State at 0.15.0: live
User does: uses the new-agent shortcut or picks an agent from the new tab menu.
User sees: a tab opens with the chosen agent already launching.
Rules: new default agent: Cmd+Alt+T on macOS; each installed agent also gets its own new tab action,
  unbound by default.
Acceptance:
  - [x] Choosing Claude from the menu opens a tab whose header shows Claude starting. (cards live; evidence/cards-TERM-041.txt)
  - [x] Each installed agent has its own command for a new tab, with no key until the user assigns
      one. (cards; evidence/cards-TERM-041.txt)
Compat: keybinding command for a new tab with the default agent, plus one command per installed
  agent formed from that command and the agent's own id (exact ids held back until allowlisted).
Source: D-03-041

### TERM-068 · Paste into a terminal
Tier: P0 · Pushed: 1 · State at 0.15.0: live
User does: presses paste or uses Edit, Paste.
User sees: clipboard text is typed into the focused pane only.
Rules: Cmd+V on macOS; Ctrl+V, Ctrl+Shift+V and Shift+Insert on Windows/Linux; the Edit menu paste
  goes to whichever window and pane has focus; paste never lands in a different pane than the one
  focused (including splits and rename fields); if the target pane changes while the clipboard is
  still being read, the paste is cancelled rather than sent elsewhere; a paste made while an agent's
  starting prompt is still being typed waits for it, so the two never interleave; a brief loss of
  focus during the clipboard read, with focus returning to the same pane, does not cancel the paste.
Acceptance:
  - [x] Pasting with a split focused on pane B never types into pane A. (cards; evidence/cards-TERM-068.txt)
  - [x] Switching to another pane while the clipboard is still being read cancels the paste instead
      of typing into the new pane. (cards; evidence/cycle3-TERM-068.txt)
Compat: keybinding id terminal.paste.
  (Kolux RS, T-010-fix: the pane-only and wait-for-the-prompt rules are tested in
  `src/terminal/paste.test.ts` and proved live in `evidence/T-010-fix-paste.png`.)
Source: D-03-068

### TERM-020 · Pane header identity: agent, name, program, status
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: glances at a pane header.
User sees: a status dot, the agent mark, the session name, the program name and a status word.
Rules: the dot has an accessible label naming its state; a plain shell shows a generic terminal
  label and glyph; the session name falls back to the tab title, or to a generated title when that
  option is on.
Acceptance:
  - [x] A plain shell pane reads as a terminal with a neutral status. (cards; evidence/cards-TERM-020.txt)
  - [x] Screen readers announce the dot state. (cards; evidence/cards-TERM-020.txt)
Compat: —
Source: D-03-020

### TERM-021 · Status word colour reflects what the agent needs
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: watches the pane header while an agent runs.
User sees: the status word is tinted: working, needs you, done or neutral.
Rules: working or monitoring shows the working tone; waiting, permission or blocked shows the
  attention tone and marks the pane as needing the user; Done shows the done tone; anything else is
  neutral.
Acceptance:
  - [x] A permission prompt flips the word to the attention tone within one status update. (cards; evidence/cards-TERM-021.txt)
  - [x] A finished agent shows the done tone; an idle plain shell shows the neutral tone. (cards; evidence/cards-TERM-021.txt)
Compat: —
Source: D-03-021

### TERM-023 · Finished-while-away glow and age label
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: comes back to a grid where an agent finished while not looking.
User sees: that pane has a soft green glow and its status reads Done with how long ago.
Rules: the age reads just now in the first minute, then minutes ago; it refreshes every minute; the
  glow clears once the pane is focused; the glow is static (no animation) to avoid constant
  repaints; age uses the same finish time as the Board and sidebar.
Acceptance:
  - [x] A pane that finished 3 minutes ago, unseen, shows Done with 3m and a glow. (cards live; evidence/cards-TERM-023.txt)
  - [x] Clicking into it removes the glow. (cards; evidence/cards-TERM-023.txt)
Compat: —
Source: D-03-023

### TERM-030 · Jump to the next session that needs you
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: presses the shortcut for the next waiting session.
User sees: focus jumps to the next pane waiting on the user.
Rules: Cmd+Shift+J on macOS, Ctrl+J on Windows/Linux; repeated presses cycle through all waiting
  sessions.
Acceptance:
  - [x] With two waiting sessions, two presses visit both. (cards; evidence/cards-TERM-030.txt)
  - [ ] On Windows Ctrl+J, and on macOS Cmd+Shift+J, moves focus to the waiting session.
Compat: keybinding command for jumping to the next waiting session (exact id held back until
  allowlisted).
Source: D-03-030

### TERM-055 · Tab activity indicators
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: watches the tab strip while agents run.
User sees: each terminal tab shows a spinner while working and badges for permission, unread or
  done.
Rules: badge priority: working first, permission second, unread third, done last; a bell or a
  finished agent in a tab not being viewed marks it unread; the spinner sits beside the agent's
  icon; stale self-written question titles are not treated as a live question; Done shows a green
  check, waiting for permission shows a question mark, an unvisited completion keeps a bell, and an
  idle shell shows only its identity icon.
Acceptance:
  - [x] A background tab whose agent finishes shows an unread badge until viewed. (cards; evidence/cards-TERM-055.txt)
  - [x] An idle shell tab shows only its identity icon and no badge. (cards; evidence/cards-TERM-055.txt)
Compat: —
Source: D-03-055

### TERM-118 · Bell and finish notifications
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: has an agent finish or ring the bell while looking elsewhere.
User sees: a notification, plus unread marks on the tab, pane and worktree.
Rules: no unread mark for the pane being looked at; hidden tabs and hidden split panes are marked
  unread; with Kolux in the background, the selected worktree is marked unread; late or stale finish
  events are dropped; notification settings gate what is sent.
Acceptance:
  - [x] An agent finishing in a hidden tab sends one notification and marks the tab unread. (cards; evidence/cards-TERM-118.txt)
  - [x] An agent finishing in the focused pane that is on screen adds no unread mark. (cards; evidence/cards-TERM-118.txt)
Compat: —
Source: D-03-118

### TERM-045 · Confirm before closing a terminal with a live program
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: closes a tab or pane while a program is running in it.
User sees: a confirmation explains that the running process will stop; the close happens only after
  confirming.
Rules: Kolux checks for running child processes first; an idle shell closes without asking; if the
  check fails, Kolux asks anyway, worded as unsure (it could not tell whether a program runs; closing
  may stop one), so a program is never stopped unseen; a split tab asks once, not once per pane; keyboard and mouse close follow the same policy; a setting turns the confirmation
  off; the confirmation names the tab being closed, so closing a background tab is never ambiguous.
Acceptance:
  - [x] Closing a tab running a dev server asks; closing an idle shell does not; a failed check asks, worded as unsure. (cards; evidence/T-681.txt)
  - [x] Closing a split tab with two busy panes shows one confirmation, not two. (cards; evidence/T-681.txt)
Compat: —
Source: D-03-045

### TERM-013 · Expand one pane to fill, then restore
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: clicks the header expand button, the pane menu item, or Cmd/Ctrl+Shift+Enter.
User sees: the pane fills the space; pressing again restores the previous layout.
Rules: in a split tab, the pane fills its tab; a single-pane session window expands over the whole
  grid instead; only one expanded group per workspace; it is cleared when restored; expanding and
  collapsing does not restart or clear the terminal.
Acceptance:
  - [x] Expanding then restoring returns every pane to its prior size. (cards live; evidence/cards-TERM-013.txt)
  - [x] Scrollback in the expanded pane is unchanged after restore. (cards live; evidence/cards-TERM-013.txt)
Compat: keybinding command for expanding a pane and restoring it (exact id held back until
  allowlisted).
Source: D-03-013

### TERM-019 · Every pane shows a header with title and usage
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: looks at any pane.
User sees: a header row on every pane shows who is running, the session name and the session usage
  percentage.
Rules: shown on every pane, single or split, since 2026-10-05; the usage meter shows context use
  against the session cap; never drawn over hidden content.
Acceptance:
  - [x] A single-pane grid still shows the header. (cards; evidence/cards-TERM-019.txt)
  - [x] In a split tab each pane carries its own header with its own usage percentage. (cards; evidence/cards-TERM-019.txt)
Compat: —
Source: D-03-019

### TERM-022 · Branch chip in the pane header
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: works in a git worktree.
User sees: a small chip with the branch name; detached checkouts show a short commit id.
Rules: no chip for a plain folder workspace; hovering the chip shows the full branch name.
Acceptance:
  - [x] A pane in branch feature/x shows that branch; a folder outside git shows no chip. (cards; evidence/cards-TERM-022.txt)
  - [x] Hovering a truncated branch chip shows the whole branch name; a detached checkout shows a
      short commit id. (cards; evidence/cards-TERM-022.txt)
Compat: —
Source: D-03-022

### TERM-025 · Pane header buttons
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: uses the buttons at the right of a pane header.
User sees: more (opens the pane menu), expand, split, close, always in that order.
Rules: close is always shown; expand is disabled for a lone pane in the classic look; in the clean
  look it expands the session window; the split button stays transparent on hover (no flash);
  right-clicking the header opens the same pane menu.
Acceptance:
  - [x] The four buttons appear in the same order on every pane. (cards; evidence/cards-TERM-025.txt)
  - [x] Right-clicking the header opens the same menu as the more button. (cards; evidence/cards-TERM-025.txt)
Compat: —
Source: D-03-025

### TERM-028 · Clean look for the terminal grid
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: uses the clean grid look (default for new installs).
User sees: each session is a rounded window with gaps between them; the header carries its own
  controls.
Rules: rounded corners around 14 px with about 8 px gaps; a group with a single tab hides its tab
  strip; the full (classic) look keeps the older chrome; new installs land on the clean look;
  existing profiles keep what they had.
Acceptance:
  - [x] A new install shows rounded session windows with gaps. (cards; evidence/cards-TERM-028.txt)
  - [x] In the clean look, a session group holding one tab shows no tab strip. (cards live; evidence/cards-TERM-028.txt)
Compat: —
Source: D-03-028

### TERM-017 · Panes keep their identity across layout changes
Tier: P0 · Pushed: 9 · State at 0.15.0: live
User does: splits, rearranges, applies presets or restores the app.
User sees: each running program stays in its pane; nothing restarts or duplicates.
Rules: a split, move or preset never respawns an existing session; output from one session never
  shows up in another pane; duplicate replays into the same pane are suppressed.
  (Kolux RS, T-067: the app keys every cell by its group id and every pane by its pane key, so a split
  or move re-parents the existing terminal host instead of remounting it; nothing respawns.)
Acceptance:
  - [x] After 10 random splits and moves, each pane still shows its own session. (cards live; evidence/cards-TERM-017.txt)
  - [x] Text printed in one pane never shows up in any other pane after splits and moves. (cards; evidence/cards-TERM-017.txt)
Compat: —
Source: D-03-017

### TERM-065 · Copy terminal selection, never silently
Tier: P0 · Pushed: 9 · State at 0.15.0: live
User does: selects text and presses the copy shortcut or menu item.
User sees: the text is on the clipboard; if the copy fails a notice says so.
Rules: Copy: Cmd+C on macOS; Ctrl+Shift+C on Windows/Linux, and Ctrl+C when text is selected; on
  failure the selection is kept and one notice shows (repeated failures are throttled); an empty
  selection never reports success; focus returns to the pane after copying; on macOS the copy
  shortcut follows the letter the keyboard layout produces, not the physical key position.
  (Kolux RS, T-067: Ctrl+C with nothing selected is the interrupt and reaches the program; a refused
  clipboard shows one notice per 5 s in the pane header and keeps the selection; focus returns to the pane.)
Acceptance:
  - [x] With the clipboard locked by another app, copying shows a failure notice and the selection
      remains. (cards; evidence/cards-TERM-065.txt)
  - [x] Copying with nothing selected never shows a success notice. (cards; evidence/cards-TERM-065.txt)
Compat: keybinding command for copying the selection (exact id held back until allowlisted).
Source: D-03-065

### TERM-103 · GPU rendering with safe fallback
Tier: P0 · Pushed: 9 · State at 0.15.0: live
User does: runs many terminals.
User sees: fast rendering; if the GPU path fails, terminals keep working on the slower path.
Rules: Auto uses GPU rendering when supported, otherwise plain rendering; on/off can be forced; at
  most 6 GPU contexts at once, hidden tabs included; extra panes use the plain path; a single GPU
  failure does not make later terminals slow to open; glyph caches reset after paste bursts and
  system resume to clear garbled text; a program's synchronized frame is shown whole, including when
  a hidden pane is revealed.
  (Kolux RS, T-067: GPU drawing has one control, Settings > Terminal & sessions > GPU drawing
  (Automatic, On, Off; SET-022). T-725 removed the second switch Appearance had, see DT-C26, DT-C161. Synchronized frames are handled by the terminal renderer itself. The cap counts
  live WebGL contexts; a lost context frees its slot. Glyph atlas reset after a paste over 2 KB and after a
  heartbeat gap over 30 s. Shells that stall at process start are a terminal-start problem, carried into T-166.)
Acceptance:
  - [x] Opening 10 terminals never shows blank panes. (cards live; evidence/cards-TERM-103.txt)
  - [x] With more than 6 terminals visible, the panes beyond the cap draw on the plain path and
      still show text. (cards live; evidence/cards-TERM-103.txt)
Compat: —
Source: D-03-103

### TERM-105 · Terminals survive quitting and reopening Kolux
Tier: P0 · Pushed: 9 · State at 0.15.0: live
User does: quits Kolux and opens it again.
User sees: every tab, split and session is back with its scrollback; running programs kept running.
Rules: a background host keeps sessions alive while the app is closed; scrollback survives a clean
  quit and relaunch; restored panes accept input straight away; the focused pane and an expanded
  pane come back as they were; terminals created from the command line or by automation are restored
  too.
  (Kolux RS, DT-C27 as changed 2026-10-20: Txais chose that terminals keep running after quit. The
  background host is built (T-075-b); the window routing its panes through it is T-184-b.)
Acceptance:
  - [x] Quit with a build running; reopen; the build output continues in the same pane. (cards; evidence/cards-TERM-105.txt)
  - [x] Restored panes accept typing at once and the pane that had focus before quitting has it
      again. (cards live; evidence/cards-TERM-105.txt)
Compat: —
Source: D-03-105

### TERM-106 · Restore after the background host or computer died
Tier: P0 · Pushed: 9 · State at 0.15.0: live
User does: reopens Kolux after a crash, a killed host or a reboot.
User sees: each pane shows its saved output and a new shell started in that same folder.
Rules: saved history is written safely so a crash leaves a usable copy; large histories restore in
  pieces within memory limits; a corrupt tab record does not hide the other tabs; reopening a
  worktree does not create duplicate tabs; sessions closed on purpose are not brought back; older
  saved histories from very wide terminals still restore; a local agent that had already finished is
  not started again on restore; a pane whose agent was still working resumes the same agent
  conversation with the settings it was started with, even if settings changed since; if that is not
  possible the pane opens a new shell instead and shows the restored banner; saved output belonging
  to deleted worktrees is cleaned up in the background; anything whose owner is uncertain is kept,
  and nothing is pruned when the list of live worktrees is empty; after a dead background host is
  replaced, the rest of a partly typed line is discarded rather than run; the hold ends after a
  short idle gap or a fixed cap, so typing never stays blocked.
  (Kolux RS, T-068: there is no background host, so the partly typed line and the hold do not
  apply; the saved output is a transcript of the terminal's own stream, replayed at the pane's
  current size, so a pane reopened at a different size shows it approximately; large histories
  are kept to one piece, 256 KB on disk and the newest 128 KB replayed.)
Acceptance:
  - [x] After killing the host, reopened panes show their earlier output above a new prompt. (cards live; evidence/cards-TERM-106.txt)
  - [x] A tab the user closed on purpose before the crash does not come back. (cards; evidence/cards-TERM-106.txt)
Compat: —
Source: D-03-106

### TERM-125 · Terminal commands in the CLI
Tier: P0 · Pushed: 11 · State at 0.15.0: live
User does: runs kolux terminal commands from a shell or agent.
User sees: terminals can be listed, read, written to, created, split, renamed, focused and closed.
Rules: list shows terminals and can narrow to one worktree, cap how many are returned, include
  visual layouts or print JSON; show and read print a terminal's content, optionally with the cursor
  position, only the visible screen, or a line cap; send types text and can also press Enter, send
  an interrupt, hold until an agent has taken the prompt, and retry the request; wait blocks until
  the program exits or a full-screen program goes quiet, up to a time limit; create opens a terminal
  in a worktree with an optional title, start command and focus; split divides a terminal
  horizontally or vertically, optionally running a command; switch (also accepted as focus) brings a
  terminal forward; rename changes its title; close is destructive and shuts one terminal, one tab,
  or every terminal of a worktree; a terminal created from the command line without focus starts in
  the background, stays alive and is listed.
Acceptance:
  - [x] kolux terminal send --enter types text and submits it. (cards; evidence/cards-TERM-125.txt)
  - [x] kolux terminal close --worktree X --all closes every terminal there. (cards; evidence/cards-TERM-125.txt)
Compat: CLI group kolux terminal with the subcommands list, show, read, send, wait, create, switch
  (also focus), rename, split and close. Flags, alphabetically: --all, --command, --cursor,
  --direction (horizontal or vertical), --enter, --focus, --for (exit or tui-idle),
  --include-visual-layouts, --interrupt, --json, --limit, --retry-request, --screen, --tab,
  --terminal, --text, --timeout-ms, --title, --wait-submit, --worktree.
Source: D-03-125

### TERM-002 · Add and remove session shortcuts
Tier: P1 · Pushed: 1 · State at 0.15.0: live
User does: presses the add-session or remove-session shortcut.
User sees: one pane is added to or removed from the grid, following the pane-count rules.
Rules: both shortcuts exist but have no default key; the user assigns them; the on-screen minus/plus
  stepper was removed on 2026-10-05; only the shortcuts remain; remove follows the remove-session
  default (ask, stop or sleep) for a started session.
Acceptance:
  - [ ] With keys assigned, add then remove returns the grid to its previous pane count.
  - [ ] With no keys assigned, neither shortcut does anything and no minus or plus control appears
      on screen.
Compat: keybinding ids sessions.add, sessions.remove.
Source: D-03-002

### TERM-005 · Default pane count for a new workspace
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens a new workspace.
User sees: the grid starts with the configured number of empty panes (1, 2, 4, 6, 9 or 12).
Rules: seeding happens once per workspace; later setting changes or remounts do not re-seed; a
  restored or already-populated workspace is never changed; the pane already holding the default
  shell counts toward the total; unset or 1 means no extra panes; the classic look never seeds.
Acceptance:
  - [ ] A new workspace with a default of 4 shows 4 panes, one with a shell and three empty.
  - [ ] Reopening that workspace after adding a pane does not add more panes.
Compat: —
Source: D-03-005

### TERM-007 · Starting a session into a full grid makes room
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: launches a new session when no empty pane is free.
User sees: an existing pane is split to host the new session instead of hiding another one.
Rules: an empty pane is used first when one exists; otherwise one pane is split; the running
  sessions keep their output.
Acceptance:
  - [ ] Launching into a full 4-pane grid ends with 5 visible panes, all four originals still
      running.
  - [ ] Launching into a grid that still has one empty pane fills that pane and creates no new
      split.
Compat: —
Source: D-03-007

### TERM-009 · Equalize pane sizes
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: chooses Equalize from the pane menu or an assigned shortcut.
User sees: all split panes in the tab snap to equal sizes.
Rules: shown in the pane menu only when the tab is split; has no default key; the menu shows a key
  hint only once one is assigned; equalizing in one tab is broadcast so other views of the same tab
  follow.
Acceptance:
  - [ ] Three panes of 50/25/25 become one third each.
  - [ ] With a single unsplit pane, Equalize is absent from the pane menu.
Compat: keybinding command for equalizing pane sizes (exact id held back until allowlisted).
Source: D-03-009

### TERM-012 · Move focus between panes
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: presses next-pane or previous-pane.
User sees: keyboard focus moves to the neighbouring pane in order, wrapping around.
Rules: Cmd/Ctrl+] for next, Cmd/Ctrl+[ for previous.
Acceptance:
  - [ ] With 3 panes focused on the last, next goes to the first.
  - [ ] With 3 panes and the first one focused, previous moves to the last.
Compat: keybinding commands for next pane and previous pane (exact ids held back until allowlisted).
Source: D-03-012

### TERM-015 · Drag a pane to rearrange the split
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: grabs a pane header and drops it on another position.
User sees: the pane moves; its session keeps running.
Rules: the drag handle only appears when the tab has more than one pane; dropping onto a tab bar or
  edge can split or move it into another group.
Acceptance:
  - [ ] Dragging pane A to the right of pane B swaps their order with output intact.
  - [ ] A tab holding a single pane shows no drag handle in its header.
Compat: —
Source: D-03-015

### TERM-044 · Close tabs in bulk
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: uses Close tab, Close all, Close others, Close to the right or Close to the left.
User sees: those tabs close, each following the running-process and rules for pinned tabs.
Rules: close tab Cmd/Ctrl+W (closes the focused pane when the tab is split); close all
  Cmd/Ctrl+Alt+W; Close others and Close to the right are in the tab menu and disabled when nothing
  would close; Close to the right uses the visible tab order; closing the last terminal keeps the
  worktree open; Close to the left is also in the tab menu; closing the active tab returns to the
  tab used before it, otherwise to its right neighbour (left if it was last); when nothing is left
  open, the workspace shows its empty start view.
  (Kolux RS, T-102-a: the five close items live in the tab's right-click menu, a bulk close is one
  TERM-045 question for the whole set, and `tab.closeAll` on Ctrl+Alt+W closes the focused strip;
  pinned tabs do not exist yet, so nothing is spared until the pin task lands.)
Acceptance:
  - [ ] Close to the right on the last tab is disabled.
  - [ ] Closing the active tab returns to the tab that was used just before it.
Compat: keybinding id tab.close, plus a command for closing all tabs (exact id held back until
  allowlisted).
Source: D-03-044

### TERM-049 · Tab right-click menu
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: right-clicks a tab.
User sees: pin or unpin, Change Title, Tab Color, split, close, close others, close to the right and
  close to the left.
Rules: directional close items are disabled when there is nothing to close; split actions move the
  tab into a split view; middle-click closes an unpinned tab.
  (Kolux RS, T-102-a: the close items and middle-click are in; pin, title, colour and split items
  follow with the rest of the menu.)
  (Kolux RS, T-668: the tab strip and this menu work from the keyboard: arrows, Home and End move
  focus between tabs (Enter or Space brings one forward) and between menu items, Escape closes the
  menu before the terminal gets the key; the menu is kept inside the window; a disabled close item
  says why; the close question names how many tabs it closes.)
Acceptance:
  - [ ] The first tab has close-to-the-left (if present) disabled.
  - [ ] Middle-clicking an unpinned tab closes it.
  - [x] Arrow keys move along the tabs and the menu, Escape closes the menu first, the menu stays
      inside the window, a disabled close item carries its reason. (unit; evidence/T-668.txt)
  - [x] Click each item of the menu → Change Title, Pin, each colour, No color, both splits and the
      five close items each do what they say and close the menu; a close item with nothing to close
      does nothing. (unit; evidence/T-696.txt)
Compat: —
Source: D-03-049

### TERM-054 · Reorder tabs by dragging
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: drags a tab along the tab strip.
User sees: the tab moves to the drop point.
Rules: dropping on the right half of a tab places it after; left half before; dropping a tab on
  itself changes nothing; dragging a tab onto the outer edge band of a group opens a new group on
  that side; dropping in the centre or on a tab strip adds it to that group; hovering a strip never
  counts as a top-edge split; a drop that would recreate the current layout does nothing.
Acceptance:
  - [ ] Dragging tab 1 onto the right half of tab 3 makes it third.
  - [ ] Dropping a tab onto itself leaves the order unchanged.
Compat: —
Source: D-03-054

### TERM-027 · Name a pane
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: chooses Set Title in the pane menu (or an assigned shortcut) and types a name.
User sees: an inline field in the header; the name replaces the program-derived title.
Rules: Enter or Tab saves, Escape cancels, clicking away saves; an Enter that only confirms an IME
  candidate does not save; Clear Pane Title appears only when a custom title is set and returns to
  the automatic title; both actions have no default key; they work once assigned; the field stays
  open for typing the first time it opens from the menu.
Acceptance:
  - [ ] Typing a Korean name with an IME and confirming the candidate keeps the field open.
  - [ ] Clear Pane Title is missing from the menu until a custom title exists; choosing it brings
      the automatic title back.
Compat: keybinding commands for setting and clearing a pane title (exact ids held back until
  allowlisted).
Source: D-03-027

### TERM-029 · Needs you strip above the grid
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: has sessions waiting on a permission or a question.
User sees: a pinned row above the grid lists those sessions in order; clicking one jumps to it.
Rules: lists only this grid's sessions waiting on permission or a question; empty and out of the way
  when nothing waits; can be turned off (part of the folded Views & sessions settings).
Acceptance:
  - [ ] Two waiting sessions appear in the strip in grid order; resolving one removes it.
  - [ ] With no session waiting, the strip takes up no room above the grid.
Compat: —
Source: D-03-029

### TERM-048 · Rename a tab
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: double-clicks a tab, uses the tab menu, or presses Cmd+R on macOS.
User sees: an inline field to rename the tab.
Rules: Enter saves, Escape cancels; an IME candidate Enter does not save; pasting while renaming
  goes into the field, not the terminal.
Acceptance:
  - [ ] Pasting text while renaming changes only the tab name.
  - [ ] Confirming an IME candidate with Enter keeps the rename field open; Escape keeps the old
      name.
Compat: keybinding id tab.rename.
Source: D-03-048

### TERM-058 · Tab titles follow the running program
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs a program or agent that sets its window title.
User sees: the tab and pane titles update to match; the agent is recognised from the title.
Rules: agent identity found in titles is used for the status dot and icon; hook-reported status
  takes precedence over title guesses when both exist; an agent started by hand in a plain shell is
  recognised from the running program when a command starts and forgotten when the shell prompt
  returns; the shell end-of-command marker is seen even when it arrives split across output chunks,
  and replayed or restored output never counts as a command starting or finishing; in a split tab
  the agent icon comes only from the focused pane; when that pane runs a plain shell, no agent from
  a sibling pane is shown; what a running agent says about itself beats a saved record from a
  sleeping session.
Acceptance:
  - [ ] Starting Claude in a shell tab changes the tab title and icon to Claude.
  - [ ] Leaving Claude and returning to the shell prompt removes the Claude identity from the tab.
Compat: —
Source: D-03-058

### TERM-063 · Floating button shows pending activity
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: closes the floating panel while something in it is still active.
User sees: a small dot on the floating button signals pending activity.
Rules: the dot hides while the panel is open or when nothing is pending.
Acceptance:
  - [ ] An agent finishing in the closed panel shows the dot.
  - [ ] While the panel is open, the floating button shows no dot.
Compat: —
Source: D-03-063

### TERM-003 · Confirm before removing a started session
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: removes a pane whose session has already started.
User sees: a confirmation asks whether to stop the session, put it to sleep, or cancel.
Rules: the default reaction is configurable: ask, stop, or sleep; cancel has focus when the dialog
  opens, so Enter does not destroy work; unstarted panes are removed without a prompt; sessions are
  classified (unstarted, running agent, idle shell) before deciding whether to ask.
Acceptance:
  - [ ] Pressing Enter immediately on the dialog leaves the session running.
  - [ ] With the default set to stop, removing a started session stops it without a dialog.
Compat: —
Source: D-03-003

### TERM-031 · Answer an agent permission prompt from Kolux
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: approves, denies or answers a waiting agent from a Kolux control.
User sees: the answer is typed into the agent only if the prompt is still showing.
Rules: if the prompt has gone or changed, the answer is not sent; answers never land in a plain
  shell by mistake.
Acceptance:
  - [ ] Approving after the agent already moved on sends nothing.
  - [ ] Answering while the prompt is still on screen types the answer into that agent and into no
      other pane.
Compat: —
Source: D-03-031

### TERM-046 · Pin tabs; pinned tabs ask before closing
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: pins a tab from its menu, then closes it.
User sees: pinned tabs sit first with a pin icon; closing one asks first, while a bulk kill-all
  closes pinned terminals without a second prompt.
Rules: on by default; can be turned off; Close others and close all skip pinned tabs unless
  confirmed; Pin Tab and Unpin Tab are in the tab menu; pinned tabs show a pin icon and sit before
  unpinned tabs; close is disabled in the menu for a pinned tab, and middle-click does not close it;
  Close to the right and Close to the left also skip pinned tabs.
Acceptance:
  - [ ] Cmd/Ctrl+W on a pinned tab shows the confirmation.
  - [ ] Middle-clicking a pinned tab leaves it open, and Close others leaves pinned tabs open.
Compat: —
Source: D-03-046

### TERM-069 · Safe multi-line paste
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: pastes several lines into a shell or agent.
User sees: the lines arrive as one paste and do not run line by line.
Rules: bracketed paste is used when the program supports it; on Windows, multi-line text is forced
  onto the bracketed path; single-line text takes the ordinary fast path; clipboard content is never
  written to logs.
Acceptance:
  - [ ] Pasting three commands into PowerShell does not execute them one by one.
  - [ ] Pasted clipboard text never appears in Kolux logs.
Compat: —
Source: D-03-069

### TERM-010 · Resize panes by dragging dividers
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: drags the line between two panes.
User sees: the panes resize live; the divider is a thin coloured line.
Rules: divider thickness defaults to 3 px; divider colour has separate light and dark values
  (neutral grey tones by default); if the pointer is lost mid-drag (left the window, capture lost),
  the drag still finishes cleanly instead of sticking.
  (Kolux RS, T-144-a: the defaults follow DT-A7 in the Appearance chapter, 6 px and no colour, with
  the width and the light / dark colours still settable there; the grid's gap is the divider, the grid
  captures the pointer, a lost capture ends the drag where it was, a pane never goes under 120 px, and
  the program hears only the final size.)
Acceptance:
  - [ ] Releasing the mouse outside the window ends the drag at the last position.
  - [ ] Dividers are about 3 px thick by default and take a different colour in light and dark mode.
      (Kolux RS: 6 px and uncoloured by default per DT-A7; the colours apply once set.)
Compat: —
Source: D-03-010

### TERM-024 · Narrow panes drop header items in a set order
Tier: P1 · Pushed: 7 · State at 0.15.0: live
User does: shrinks a pane until the header runs out of room.
User sees: header items disappear one by one; the dot, agent mark and session name always stay.
Rules: first the branch chip goes (around 344 px); then the program name (around 264 px); then the
  action buttons (around 204 px); then the status word (around 134 px); the session name truncates
  rather than disappearing.
  (Kolux RS, T-144-a: CSS container queries on the pane at exactly those widths; under 134 px the
  whole right-hand group goes with the status word.)
Acceptance:
  - [ ] At 250 px wide the header shows dot, mark, name, status word and buttons but no branch or
      program name.
  - [ ] At about 130 px wide the header still shows the dot, the agent mark and a shortened session
      name.
Compat: —
Source: D-03-024

### TERM-035 · Pane right-click menu
Tier: P1 · Pushed: 7 · State at 0.15.0: live
User does: right-clicks inside a pane or presses the header More button.
User sees: a menu of copy, paste, agent, layout, title, ID and close actions.
Rules: order: Copy, Select All, Paste; agent actions; Split Right, Split Down; Equalize;
  Expand/Collapse; Set Title, Clear Title; copy IDs; Copy terminal diagnostics; Close Pane; Clear
  Screen; items appear only when they apply (equalize only when split, expand only when expandable,
  clear title only when set, close only when closable); Close Pane is styled as destructive; the
  menu dismisses on Escape or an outside click; on Windows with right-click-to-paste on, right-click
  pastes instead (see that card); the click that opened the menu does not immediately close it.
Acceptance:
  - [ ] In an unsplit pane the menu has no Equalize item.
  - [ ] The right-click that opened the menu does not close it; Escape does.
Compat: —
Source: D-03-035

### TERM-078 · Zoom the terminal font
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: uses zoom in, zoom out or reset (shortcut or View menu).
User sees: the terminal text gets bigger or smaller.
Rules: only the pane that owns keyboard focus reacts; View menu holds Zoom In, Zoom Out and Reset
  Size, and so does the top bar's dots menu, named Terminal zoom (DT-C103); from the menu they change the
  focused terminal's text size.
Acceptance:
  - [ ] Zooming in twice then reset returns to the configured font size.
  - [ ] Zoom In from the View menu enlarges only the focused terminal.
Compat: keybinding ids zoom.in, zoom.out, zoom.reset.
Source: D-03-078

### TERM-097 · Terminal font settings
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: changes the terminal font, size, weight or line height.
User sees: text re-renders with the new font.
Rules: defaults: size 13 (amended 2026-10-13 at the freeze, DT-C38: 13 is what the pane showed before the font settings reached it), line height 1, normal and bold weights; the editor follows the terminal
  font unless set separately; the saved font paints at startup with no flash.
Acceptance:
  - [ ] Changing size to 16 enlarges every pane.
  - [ ] Restarting Kolux shows the saved font from the first frame, with no flash of another font.
Compat: —
Source: D-03-097

### TERM-098 · Terminal colour themes
Tier: P1 · Pushed: 7 · State at 0.15.0: live
User does: picks a terminal theme for dark and light mode or matches the app theme.
User sees: terminal colours change; light mode can use a separate theme.
Rules: defaults: a Kolux dark theme and a Tango-style light theme, separate light theme on; Match
  app theme makes the terminal follow the app colour theme; custom themes can be added; programs
  asking the terminal for its colours get correct answers, with no leaked replies at startup; no
  flash of the wrong theme at startup; programs that subscribe to light/dark changes are told when
  the mode flips.
  (Kolux RS, T-145-b: on Windows the pane's replies are written to the console layer as
  win32-input-mode key events, since it drops them as plain bytes; the palette question and the
  light/dark question and subscription get through and are answered; the foreground/background
  questions, OSC 10 and 11 with "?", never leave the console layer, so they go unanswered until the
  pseudoconsole's pass-through flag is reachable, DT-C20 and T-145-c.)
Acceptance:
  - [ ] Switching the app to light mode switches terminals to the light theme.
  - [ ] A program asking for the terminal's colours gets the current theme's colours, and nothing
      stray is printed at startup.
Compat: —
Source: D-03-098

### TERM-047 · Reopen a closed tab
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: presses Cmd/Ctrl+Shift+T after closing a tab.
User sees: the last closed terminal tab comes back in its previous folder.
Rules: up to 10 closed tabs are remembered, newest first; the folder is remapped when the original
  path form no longer exists (Windows).
Acceptance:
  - [ ] Closing three tabs and pressing reopen three times brings all three back in reverse order.
  - [ ] After closing 11 tabs, reopen brings back at most the 10 most recent.
Compat: keybinding command for reopening the last closed tab (exact id held back until allowlisted).
Source: D-03-047

### TERM-071 · Large pastes stay responsive
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: pastes a very large block of text.
User sees: the app stays responsive while the text is fed to the terminal in chunks.
Rules: large pastes are chunked and yield between chunks; clipboard text over the size limit is
  rejected with a message.
Acceptance:
  - [ ] Pasting several megabytes leaves the rest of the app clickable during the paste.
  - [ ] Pasting text over the size limit shows a message and sends nothing to the program.
Compat: —
Source: D-03-071

### TERM-090 · Scroll position: follow output or stay put
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: scrolls up to read while output keeps coming.
User sees: the view holds the spot the user scrolled to; at the bottom it follows new output.
Rules: scrolling back to the bottom resumes following; switching tabs and back keeps the same scroll
  position; pending focus changes never flip a pinned view into following.
Acceptance:
  - [ ] Reading 200 lines up while a build prints keeps that spot until the user scrolls down.
  - [ ] Switching to another tab and back keeps the same scroll position.
Compat: —
Source: D-03-090

### TERM-107 · Restored-session banner
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens a pane that was restored from saved history.
User sees: a banner marks where restored output ends and live output begins.
Rules: shown only for restored sessions; disappears on the first key press or click in the pane;
  when the agent conversation could not be resumed and a fresh shell was opened instead, the pane is
  marked as restored without resume; otherwise it keeps its identity.
Acceptance:
  - [ ] Typing in a restored pane removes the banner.
  - [ ] A pane that could not resume its agent is marked as restored without resume.
Compat: —
Source: D-03-107

### TERM-108 · Background host updates without losing sessions
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: updates Kolux or restarts the terminal host.
User sees: live sessions keep running; an outdated host is replaced when safe.
Rules: a restart follows a fixed sequence that keeps live sessions; an idle host with no sessions
  shuts itself down; a host from an older version is retired after its sessions end; a slow health
  check is not treated as dead; on macOS, a host started by an app copy that no longer exists (after
  an update or a move) is replaced under the current app before the next new terminal, but only when
  it holds no live sessions; a host with live sessions is kept running.
Acceptance:
  - [ ] Updating with 3 running sessions keeps all 3.
  - [ ] With no sessions running, an outdated host is replaced before the next new terminal opens.
Compat: —
Source: D-03-108

### TERM-109 · Host crash containment
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: hits a case where the terminal host keeps crashing.
User sees: Kolux stops restarting it in a loop and stays usable in a degraded mode.
Rules: repeated deaths in a short window stop respawning; a preserved host is marked degraded rather
  than discarded; terminals being opened while the host connection drops are retried and still open.
Acceptance:
  - [ ] A host crashing 5 times quickly is not respawned a 6th time immediately.
  - [ ] Once respawning stops, the rest of Kolux stays usable and terminals are shown as degraded.
Compat: —
Source: D-03-109

### TERM-110 · Terminal error messages in plain words
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: hits a terminal error.
User sees: a notice explains what happened in plain language, with a restart-host button when that
  would help.
Rules: internal codes are replaced with readable explanations; Restart host is offered for
  stale-host install or folder failures; errors Kolux can explain hide the report-issue link;
  unexplained ones keep it; the notice never claims a remote shell is dead or alive when it cannot
  know; local errors include a short environment footer.
Acceptance:
  - [ ] A dead host error shows a readable message without an issue link.
  - [ ] An error Kolux cannot explain keeps the link for reporting an issue.
Compat: —
Source: D-03-110

### TERM-111 · Shell exit overlay with restart
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: sees a shell exit or fail to start.
User sees: an overlay with the exit code and a restart option.
Rules: a Git Bash process-limit failure is explained with recovery actions; restart retries the
  original start command, or opens a shell if there was none; after an agent exits, the pane is left
  with a clean, working shell; a normal exit (for example typing exit) closes that pane and its
  neighbours take the space; when the last pane exits the tab closes, also for tabs parked in the
  background. The overlay is only for a program that died or failed to start; a tab closed because
  its program exited by itself keeps its saved agent session, so it can still be resumed.
Acceptance:
  - [ ] After a shell crashes, restart gives a working prompt in the same pane.
  - [ ] Typing exit in one of two split panes closes that pane and the other pane fills the tab.
Compat: —
Source: D-03-111

### TERM-112 · Hidden terminals use less memory
Tier: P1 · Pushed: 9 · State at 0.15.0: live
User does: leaves many tabs and worktrees open in the background.
User sees: background terminals keep running and come back instantly, while memory stays bounded.
Rules: hidden views are parked after a short delay; hidden worktrees fall under a retention budget;
  the tab the user left on stays fully loaded; bells and exits in parked terminals are still
  noticed; switching back restores the exact screen; an agent finishing its task is still noticed
  while its terminal is parked; a pane whose program exited while parked drops out of the saved
  layout cleanly; hidden or restoring panes still answer a program's colour, cursor-position and
  device queries promptly, even when the saved backlog overflows.
Acceptance:
  - [ ] Switching back to a parked tab shows the same screen as before.
  - [ ] A bell in a parked terminal still marks its tab unread.
Compat: —
Source: D-03-112

### TERM-113 · Fast startup with many saved terminals
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens Kolux with many saved tabs.
User sees: the visible workspace comes up first; hidden tabs start when needed.
Rules: background worktrees load only the tabs that are needed; startup waits for saved state,
  unless running degraded.
Acceptance:
  - [ ] With 20 saved tabs, the visible tab is usable before the hidden ones are ready.
  - [ ] Startup does not show the workspace until saved state has loaded, unless running degraded.
Compat: —
Source: D-03-113

### TERM-114 · Recover after sleep, wake and window focus
Tier: P1 · Pushed: 9 · State at 0.15.0: live
User does: wakes the computer or returns to the window.
User sees: terminals redraw correctly at the right size and accept input.
Rules: glyph caches are reset when the computer wakes, while a plain window refocus leaves them
  alone; pane sizes are re-sent after the window settles; display scaling changes are repaired;
  slept terminals show their output and accept fresh input after wake; when the window regains
  focus, typing returns to the pane that had it, unless the user clicked somewhere else meanwhile.
  (Kolux RS, T-166: on resume from sleep and on a display-scale change the pane clears its glyph atlas
  and re-sends its size; a plain window focus only puts typing back in the pane that had it, and only
  when nothing else holds focus. Sleep itself was not exercised live; the wake path is unit-tested.)
Acceptance:
  - [ ] After sleep, a pane shows readable text and responds to typing.
  - [ ] Returning to the window puts typing back in the pane that had it, unless the user clicked
      elsewhere.
Compat: —
Source: D-03-114

### TERM-115 · Typing and output never get stuck
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: types and watches heavy output.
User sees: input stays responsive and output keeps flowing.
Rules: a stalled write pipeline recovers on its own; lost output deliveries are repaired from the
  saved buffer; keystrokes to a terminal not yet ready are held rather than lost; typing latency
  with agents like Codex stays low; output from many busy terminals is paced so the app stays
  responsive; keystrokes held for a terminal that is not yet connected are capped in size; when a
  stuck pipeline is recovered the user is told, even if part of the clean-up fails.
  (Kolux RS, T-166: keys typed before the shell starts are held in order and sent once, capped at
  16 KB with a notice naming the dropped count; spawn and write are async so a pipe that blocks never
  holds the window; a failed write shows "Typing could not reach the program"; the app clears the
  inherited "ignore Ctrl+C" flag before its first shell, so Ctrl+C interrupts a pane's program. Not
  built: self-recovery of a wedged pipeline and output pacing across many terminals; a named follow-up.)
Acceptance:
  - [ ] A pane whose writes wedge resumes rendering and input without reload.
  - [ ] Keys typed into a terminal that is still connecting arrive once it connects, with nothing
      lost.
Compat: —
Source: D-03-115

### TERM-116 · Copy terminal diagnostics
Tier: P1 · Pushed: 9 · State at 0.15.0: live
User does: chooses Copy terminal diagnostics in the pane menu.
User sees: a diagnostics snapshot is copied for bug reports.
Rules: secrets and personal paths are redacted; named in the 0.12.0 release; if the snapshot cannot
  be built or copied, a notice says so; it never fails silently.
  (Kolux RS, T-166: the pane menu's "Copy terminal diagnostics" sends the last 60 rows, soft-wrapped
  rows joined into whole lines, with the session's facts; the home folder becomes ~ and secrets are
  scrubbed before the text reaches the clipboard; "Diagnostics copied", "Diagnostics could not be
  built (...)", "Diagnostics could not be copied (...)" and "No session to describe yet" are the notices.)
Acceptance:
  - [ ] The copied text has no access tokens.
  - [ ] If the snapshot cannot be copied, a notice says so.
Compat: —
Source: D-03-116

### TERM-132 · Full-screen programs keep their own screen
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs a full-screen program such as vim, less or an agent's full-screen view in a pane,
  then quits it, switches away, or restarts Kolux while it runs.
User sees: the program owns the pane while it runs; once it quits, the shell output from before it
  is back exactly as it was and can be scrolled.
Rules: leaving a full-screen program restores the shell screen and its scrollback unchanged; scroll
  positions are kept per screen and never carried from the shell screen to the full-screen one or
  back; on reattach or tab return the program's screen comes back and redraws once; a repeat resize
  repaint at the same size never duplicates content; agent views that draw inline on the normal
  screen and ones that take over the whole screen are both restored cleanly; a cold restore keeps
  the output from before an unclosed full-screen session and cuts at the outermost unclosed one; if
  a full-screen program dies without handing the screen back, the shell prompt is reset to a usable
  state; while the pane belongs to a program that fills the screen or captures the mouse, the shell
  never counts as ready or idle.
  (Kolux RS, T-166: the session watches its own output for the alternate-screen and mouse modes and
  counts as busy while a program owns either; leaving the program shows the shell screen as the
  terminal kept it. Not built: the cold-restore cut at an unclosed full-screen session, the prompt
  reset when a full-screen child dies, and the reattach redraw; there is no background host and no
  scrollback replay yet, so restore opens fresh shells. A named follow-up.)
Acceptance:
  - [ ] Run vim, quit it: earlier shell output is visible and scrollable from where it was.
  - [ ] With an agent in full-screen view, quit Kolux and reopen: the pane shows one clean frame, no
      doubled content.
  - [ ] Kill the background host while vim is open, reopen: shell output from before vim plus a
      fresh prompt.
Compat: —
Source: D-03-132

### TERM-134 · Programs always see the pane's true size
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens, splits, resizes or reveals a pane, or resizes the window, while a program or agent
  runs in it.
User sees: full-screen programs and agents draw at the pane's real width and height; their output
  never comes out garbled, squeezed or one character per line.
Rules: the width and height the running program sees always end up equal to the visible pane's
  columns and rows, including when the pane first opens, when a tab first appears already divided
  into splits, after a split is reparented, and when the window changes size while the app is still
  starting; a pane resized while hidden catches up when it is shown again; hidden panes that cannot
  be measured are never resized to a tiny size; while a divider is being dragged only the final size
  is sent to the program; a cancelled drag sends no stale size; Kolux checks the size the terminal
  actually applied, not only the size it asked for, and re-sends when the two differ; if that check
  cannot be made, Kolux assumes the size it asked for and sends it one time rather than looping;
  when the size changes several times in quick succession the program settles on the latest size,
  never an older one.
  (Kolux RS, T-166: proven live with a shell printing its own width once a second: two window resizes
  while visible, two while the tab was hidden, a divider held then released, dragged back, and a
  cancelled drag all ended with the program at the pane's columns and no width in between.)
Acceptance:
  - [ ] Start a full-screen program in a split pane and resize the window during startup: the
      program's column count equals the pane's columns.
  - [ ] Hide a tab, resize the window twice, show the tab again: the program reports the pane's
      current columns within about a second.
  - [ ] Drag a divider back and forth and release: the program receives the final size and no
      earlier size after release.
Compat: —
Source: D-03-134

### TERM-126 · Send a prompt to an agent and confirm it was submitted
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: sends text to an agent terminal with submit and waits.
User sees: the prompt lands and the command reports whether the agent accepted it.
Rules: the wait-for-submit option waits up to the given number of seconds for the agent to take the
  prompt.
Acceptance:
  - [ ] Sending to a busy agent reports that it did not submit within the wait.
  - [ ] Sending to an idle agent with submit reports that the prompt was taken.
Compat: CLI: kolux terminal send --enter --wait-submit <seconds>.
Source: D-03-126

### TERM-037 · Fork or continue an agent session
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: chooses Continue in new session, Fork Agent Session, or Copy Context in the pane menu.
User sees: a new session continues the conversation, or a dialog sets up a fork, or the context is
  copied.
Rules: shown only for agent panes whose session can be continued; fork opens a dialog before
  anything starts; Copy Context copies a text summary of the session for pasting elsewhere; pressing
  create twice while it is working starts only one fork.
Acceptance:
  - [ ] Continue in new session on a Claude pane opens a second pane resuming that conversation.
  - [ ] Pressing create twice quickly in the fork dialog starts a single forked session.
Compat: —
Source: D-03-037

### TERM-042 · Type a URL or path in the new tab box
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: types into the new tab entry box.
User sees: matching actions: open a URL in the browser, open a file, search open tabs or history.
Rules: http/https, localhost-style dev URLs and private IPv4 addresses are treated as web addresses
  (bare IPs get http); local paths are recognised and open as files; results put the file name
  before its folder; recent entries are remembered and shown by recency; arrow keys move through
  results; Enter runs the highlighted one.
Acceptance:
  - [ ] Typing 192.168.1.10:3000 offers to open http://192.168.1.10:3000 in the browser.
  - [ ] Typing the path of an existing local file offers to open that file.
Compat: —
Source: D-03-042

### TERM-043 · Choose the Windows shell for a new terminal
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the shell menu on Windows.
User sees: choices of PowerShell, Command Prompt and Git Bash for the new terminal.
Rules: default shell is PowerShell; PowerShell Auto uses PowerShell 7 when installed, else Windows
  PowerShell; the menu shows only for a local Windows client; the WSL entries belong to area 18 and
  are dropped (see WSL card); a Windows tab keeps the icon of the shell it actually started with.
Acceptance:
  - [ ] With PowerShell 7 installed and Auto selected, the new tab runs PowerShell 7.
  - [ ] A tab started in Git Bash keeps the Git Bash icon.
Compat: —
Source: D-03-043

### TERM-050 · Switch to the recent tab with Ctrl+Tab
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: holds Ctrl and presses Tab.
User sees: a switcher of recent tabs; releasing Ctrl opens the highlighted one.
Rules: default order is most-recently-used; a setting switches it to left-to-right.
Acceptance:
  - [ ] Ctrl+Tab once from tab C returns to the previously used tab.
  - [ ] With left-to-right order chosen, Ctrl+Tab moves to the tab on the right.
Compat: keybinding command for the recent-tab switcher (exact id held back until allowlisted).
Source: D-03-050

### TERM-051 · Cycle tabs by type
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the next/previous tab shortcuts.
User sees: focus moves to the next tab of the same type, any type, or the next terminal.
Rules: same type: Cmd/Ctrl+Alt+] and [; all types: Cmd/Ctrl+Shift+] and [; terminals only:
  Ctrl+PageDown and Ctrl+PageUp; Tab cycling and go-to-number follow the strip's visible order,
  including after drag reordering; tabs whose content is gone are skipped.
Acceptance:
  - [ ] From a terminal, next-same-type skips browser tabs.
  - [ ] After tabs are dragged into a new order, cycling follows the new visible order.
Compat: keybinding commands for next and previous tab of the same type, of any type, and of
  terminals only (exact ids held back until allowlisted).
Source: D-03-051

### TERM-052 · Go to a tab by number
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Ctrl+1..9 on macOS or Alt+1..9 on Windows/Linux.
User sees: the tab at that position is selected.
Rules: a number beyond the tab count does nothing.
Acceptance:
  - [ ] With 3 tabs, the 2 shortcut selects the middle tab.
  - [ ] With 3 tabs, the 5 shortcut does nothing.
Compat: keybinding command for selecting a tab by its number (exact id held back until allowlisted).
Source: D-03-052

### TERM-059 · Floating workspace panel
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Cmd/Ctrl+Alt+A or the floating button.
User sees: a floating panel over the app with its own terminal, agent, browser and markdown tabs.
Rules: the trigger button sits at the bottom right by default; it can be moved and its place is
  remembered; the button position is kept inside the window when the window shrinks; the settings
  section for the floating panel is cut; the feature stays with fixed defaults; opening the panel
  puts typing focus in its active terminal straight away.
Acceptance:
  - [ ] Pressing Cmd/Ctrl+Alt+A twice opens then closes the panel.
  - [ ] After the floating button is moved, it is in the same place when Kolux opens again.
Compat: keybinding command for showing and hiding the floating panel (exact id held back until
  allowlisted).
Source: D-03-059

### TERM-060 · Move, resize and maximize the floating panel
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: drags the panel title bar or edges, or maximizes it.
User sees: the panel moves and resizes; its size and place are remembered.
Rules: saved size and place are restored next time; broken saved data falls back to defaults; the
  panel is kept inside the window; it can touch but not cover the macOS title bar; maximize keeps
  the normal size for when it is restored; maximize: Cmd+Alt+Shift+A on macOS; minimize has no
  default key; dragging from a tab icon does not move the panel.
Acceptance:
  - [ ] Resizing the panel, closing and reopening it shows the same size.
  - [ ] Corrupt saved panel geometry opens the panel at its default size and place.
Compat: keybinding commands for maximizing and minimizing the floating panel (exact ids held back
  until allowlisted).
Source: D-03-060

### TERM-061 · Floating panel tabs and close behaviour
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens and closes tabs inside the floating panel.
User sees: tabs can be added, reordered and closed; the panel stays open after closing a tab.
Rules: an empty panel shows an empty state with actions and can be minimized from there; Cmd/Ctrl+W
  on it minimizes; opening an empty panel does not auto-create a terminal; a new agent tab started
  from the panel is selected and focused; a program exiting is kept separate from the user closing
  the pane; unsaved markdown tabs ask before closing, one at a time; floating terminals start in the
  home folder by default; trusted folders are remembered.
Acceptance:
  - [ ] Closing the last tab leaves the panel open on its empty state.
  - [ ] Closing an unsaved markdown tab in the panel asks before it closes.
Compat: —
Source: D-03-061

### TERM-070 · Paste a screenshot as a file path
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: pastes when the clipboard holds an image.
User sees: the image is saved to a file and its path is pasted for the agent to read.
Rules: the path is bracket-pasted even when the program has not asked for bracketed paste; the image
  is still tried when reading clipboard text fails; text clipboards skip the image check entirely;
  failures to extract or paste the image are reported, not swallowed; pasting several images at once
  and Linux paths for WSL are not shipped.
Acceptance:
  - [ ] Pasting a screenshot into a Claude pane inserts a path to a saved image.
  - [ ] Pasting plain text skips the image step and types the text as usual.
Compat: —
Source: D-03-070

### TERM-074 · Drop files onto a terminal
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: drags files from the OS or the file tree onto a pane or its header.
User sees: their paths are typed in, quoted for the shell.
Rules: paths land in the pane the files were dropped on, even when another pane has focus; image
  files are recognised by extension; if the target terminal changed before the write, nothing is
  pasted; timeouts and rejected writes show an error without exposing the dropped paths; Windows
  paths are quoted for Windows shells; WSL and SSH conversions belong to area 18.
Acceptance:
  - [ ] Dropping a file with spaces in its name pastes a correctly quoted path.
  - [ ] If the target terminal changes before the write, nothing is pasted into any pane.
Compat: —
Source: D-03-074

### TERM-075 · Programs can copy to the clipboard (OSC 52)
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: copies inside tmux, Zellij, Neovim or similar.
User sees: the text reaches the system clipboard.
Rules: on by default; programs can never read the clipboard back; if blocked, a notice once per
  session links to the setting; if the write cannot be confirmed, a notice once per session says so;
  profiles migrated to default-on see a one-time notice; payload size is capped.
Acceptance:
  - [ ] Yanking in Neovim inside tmux makes the text pasteable in another app.
  - [ ] A program that asks to read the clipboard gets nothing back.
Compat: —
Source: D-03-075

### TERM-076 · Clear the screen
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Cmd/Ctrl+K or picks Clear Screen in the pane menu.
User sees: the visible terminal and its scrollback are cleared.
Rules: saved link ranges from before the clear are dropped.
Acceptance:
  - [ ] After clearing, scrolling up shows no old output.
  - [ ] After clearing, clicking where a link used to be does nothing.
Compat: keybinding id terminal.clear.
Source: D-03-076

### TERM-077 · Find text in a terminal
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Cmd/Ctrl+F in a pane.
User sees: a find bar highlights matches in the output and scrollback.
Rules: invalid search patterns do not crash the find bar; very long search text is capped.
  (Kolux RS, T-696: a search with nothing found says No matches, and Previous and Next are greyed
  out while there is nothing to step to.)
Acceptance:
  - [ ] Searching a word present 3 times lets the user step through all 3.
  - [ ] An invalid pattern in the find bar shows no matches and the bar keeps working.
  - [x] Search for text that is not there → the bar says No matches and Previous and Next are greyed
      out. (unit; evidence/T-696.txt)
Compat: keybinding id terminal.search.
Source: D-03-077

### TERM-079 · Kolux shortcuts versus shell keys
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses key combos inside a terminal.
User sees: Kolux keeps its own shortcuts while the shell keeps its editing keys.
Rules: policy defaults to Kolux-first; on macOS the shell's own Ctrl editing chords go to the shell;
  on macOS, Cmd+Left/Right jump to line start/end; Cmd+Up/Down jump to the top/bottom of scrollback;
  Alt/Option+Arrow moves by word on every platform; custom pane keybindings are honoured; on
  Windows, Ctrl+Arrow moves by word in the shell.
Acceptance:
  - [ ] Ctrl+R in a shell opens reverse history search, not a Kolux action.
  - [ ] On macOS, Cmd+Left jumps the shell cursor to column one of the current line.
Compat: —
Source: D-03-079

### TERM-080 · Shift+Enter makes a new line in agents
Tier: P1 · Pushed: — · State at 0.15.0: live
User does: presses Shift+Enter in an agent prompt.
User sees: a new line is inserted instead of sending.
Rules: uses the encoding the agent understands (enhanced keyboard mode or a Windows-compatible
  form); Ctrl+Enter goes only to programs known to accept it; plain shells keep normal Enter
  behaviour; Shift+Enter handling stays with the agent's pane after that pane is split.
Acceptance:
  - [ ] Shift+Enter in Codex on Windows adds a line without submitting.
  - [ ] Shift+Enter in a plain shell behaves like an ordinary Enter.
Compat: —
Source: D-03-080

### TERM-081 · Option key as Alt on macOS
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: uses Option combos in a macOS terminal.
User sees: Option either types special characters or acts as Alt for the shell.
Rules: Auto looks at the active keyboard layout, so people on layouts outside the US can still type
  @, € and brackets; left-only or right-only Option-as-Alt are available; Option+B/F/D map to word
  movement and delete; fresh installs default to Auto.
Acceptance:
  - [ ] On a German layout in Auto, Option+L types @.
  - [ ] With left-only Option-as-Alt, the right Option key still types special characters.
Compat: —
Source: D-03-081

### TERM-083 · Typing in Korean, Chinese and Japanese
Tier: P1 · Pushed: — · State at 0.15.0: live
User does: types with an input method (IME).
User sees: the composing text shows in place; Enter commits the composition without also running the
  command.
Rules: Korean syllables are flushed correctly before digits and on Enter; Chinese pinyin and
  Japanese composition are supported on macOS, Windows and Linux; cancelled compositions disappear
  cleanly; bytes sent to the program match what was typed exactly; the input method's candidate
  window stays anchored at the cursor while composing; sogou-style Chinese input and Vietnamese
  letter-replacing input methods work; modifier chords such as the IME on/off toggle are not
  mistaken for composition keys; on Windows, macOS and Linux a native Korean input method works,
  including at the end of a row.
Acceptance:
  - [ ] Typing a Korean word then Enter submits the word once.
  - [ ] Cancelling a composition leaves no stray characters at the prompt.
Compat: —
Source: D-03-083

### TERM-092 · Clickable web links in output
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: holds the modifier and clicks a URL in terminal output.
User sees: the link opens in the system browser or the Kolux browser.
Rules: Cmd on macOS, Ctrl elsewhere; a hover hint names where it will open; URLs wrapped across
  lines (soft or hard wrap) are joined; programs' own hyperlinks (OSC 8) are clickable, including
  after restore; Open-in-Kolux is off by default; the modifier can invert the destination; clicks
  meant as links are not forwarded to mouse-capturing programs; Shift plus the link modifier always
  opens the system browser; the link highlight and hover hint clear when the window loses focus;
  non-Latin letters (for example Chinese or Japanese) that belong to a URL path stay part of the
  link.
Acceptance:
  - [ ] A URL wrapped over two lines opens as one complete address.
  - [ ] Shift plus the link modifier opens the system browser even when opening links in Kolux is
      turned on.
Compat: —
Source: D-03-092

### TERM-093 · Clickable file paths in output
Tier: P1 · Pushed: — · State at 0.15.0: live
User does: clicks a file path or path:line in output.
User sees: the file opens in the editor at that line.
Rules: relative paths resolve against the pane's folder or the worktree root; file:// links and
  program hyperlinks to files are supported; network-share paths are not probed on hover; trailing
  punctuation after a bare file name is not part of the link.
Acceptance:
  - [ ] Clicking a printed relative path followed by a colon and 42 opens that file at line 42.
  - [ ] Clicking a file:// link opens the file in the editor.
Compat: —
Source: D-03-093

### TERM-120 · Windows terminals behave natively
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: uses terminals on Windows.
User sees: commands on PATH resolve, Unicode prints correctly and Git Bash works.
Rules: PATH comes from the user and system settings; UTF-8 output; the chosen shell setting wins
  over the default command prompt; PATH changes made in Windows settings reach new terminals without
  restarting Kolux; if the registry cannot be read, the last known good PATH is kept.
Acceptance:
  - [ ] A newly installed tool on PATH resolves in a fresh terminal.
  - [ ] Adding a folder to PATH in Windows settings makes its tools available in the next new
      terminal without restarting Kolux.
Compat: —
Source: D-03-120

### TERM-122 · Keep the computer awake while agents run
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: turns on keep-awake.
User sees: the computer does not sleep while agents work.
Rules: off by default; On keeps the computer awake even without working agents; Auto only while an
  agent is working; waiting, blocked, done or stale agents do not keep it awake in Auto; re-checked
  after resume from sleep; an older plain on/off setting that was on becomes Auto; an item in the
  status bar shows while the computer is being kept awake; on macOS and Linux the system's own sleep
  blocker is used, with a built-in fallback if it fails; agents already marked working at startup
  but not seen running do not keep it awake.
Acceptance:
  - [ ] In Auto, the computer can sleep once all agents are done.
  - [ ] In Auto with one agent working, the computer stays awake and the status bar shows the
      keep-awake item.
Compat: —
Source: D-03-122

### TERM-008 · Tidy the grid
Tier: P2 · Pushed: 1 · State at 0.15.0: live-unverified
User does: asks the grid to tidy itself after many splits and closes.
User sees: pane sizes and positions are rebalanced into an even arrangement.
Rules: tidying never closes or restarts a pane.
Acceptance:
  - [ ] After uneven splits, tidy gives panes in a row equal widths.
  - [ ] Tidying a grid of five running panes leaves five panes with the same sessions, none
      restarted.
Compat: —
Source: D-03-008

### TERM-016 · Move a pane out into its own tab
Tier: P2 · Pushed: 1 · State at 0.15.0: live-unverified
User does: detaches a split pane into a new tab.
User sees: the pane becomes its own tab with the same running session.
Rules: the source split shrinks back; nothing restarts; a finished agent's result stays recognised
  as the same run when its pane is moved out, even after several moves, so it is neither lost nor
  listed twice.
Acceptance:
  - [ ] After detaching, the new tab shows the same scrollback.
  - [ ] Moving a finished agent's pane out to its own tab leaves exactly one entry for that run, not
      zero and not two.
Compat: —
Source: D-03-016

### TERM-119 · Shell history per worktree
Tier: P2 · Pushed: 2 · State at 0.15.0: live-unverified
User does: uses the up arrow in a shell.
User sees: history shows commands from this worktree only.
Rules: on by default; scopes bash, zsh and fish history per worktree; Command Prompt and unknown
  shells are left alone; a history file the user already set is respected; history folders are
  private to the user; history for a deleted worktree is removed, and leftover fish histories are
  swept.
Acceptance:
  - [ ] A command run in worktree A does not appear in worktree B's history.
  - [ ] A shell whose history file the user set keeps using that file.
Compat: —
Source: D-03-119

### TERM-056 · Tab title tooltip and generated titles
Tier: P2 · Pushed: 3 · State at 0.15.0: live-unverified
User does: hovers a tab, or turns on generated tab titles.
User sees: a tooltip with the full title; with the option on, tabs get short generated names.
Rules: generated titles are off by default.
Acceptance:
  - [ ] Hovering a truncated tab shows its full title.
  - [ ] With generated titles off (the default), tabs keep the title the program set.
Compat: —
Source: D-03-056

### TERM-011 · Inactive panes dim
Tier: P2 · Pushed: 7 · State at 0.15.0: live-unverified
User does: clicks into one pane of a split.
User sees: other panes fade slightly; the focused pane is fully opaque.
Rules: active pane opacity 1; inactive opacity is a setting; the fade animates over about 140 ms.
Acceptance:
  - [ ] Focusing pane B fades pane A within a fraction of a second.
  - [ ] The focused pane stays fully opaque while every other pane of the split is dimmed.
Compat: —
Source: D-03-011

### TERM-026 · Pane header density
Tier: P2 · Pushed: 7 · State at 0.15.0: live-unverified
User does: chooses comfortable or compact headers.
User sees: compact makes the pane header shorter.
Rules: two values: comfortable (default) and compact; the Views & sessions settings section is
  folded by the owner; the knob may move to Terminal & sessions or become fixed.
Acceptance:
  - [ ] Compact headers are visibly shorter than comfortable.
  - [ ] Switching back to comfortable restores the taller header.
Compat: —
Source: D-03-026

### TERM-057 · Tab strip overflow scrollbar
Tier: P2 · Pushed: 7 · State at 0.15.0: live-unverified
User does: opens more tabs than fit.
User sees: a thin scroll bar under the tabs that thickens on hover and can be dragged or clicked.
Rules: hidden when nothing overflows; idle height 2 px, 3 px on hover; mouse wheel over it scrolls
  the tab strip.
Acceptance:
  - [ ] With 30 tabs, dragging the thumb scrolls the tabs.
  - [ ] With only a few tabs and nothing overflowing, no scroll bar shows.
Compat: —
Source: D-03-057

### TERM-102 · Minimum contrast and ligatures
Tier: P2 · Pushed: 7 · State at 0.15.0: live-unverified
User does: uses a theme with weak contrast or a ligature font.
User sees: low-contrast text is lifted to stay readable; ligatures show for known ligature fonts.
Rules: ligatures auto: on only for fonts known to have them.
Acceptance:
  - [ ] Selecting a ligature font shows joined arrows; a plain font does not.
  - [ ] Dim text on a weak theme is lifted to a readable contrast.
Compat: —
Source: D-03-102

### TERM-095 · Link detection never freezes on huge lines
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: prints extremely long lines.
User sees: the terminal stays responsive.
Rules: link scanning is capped for pathological lines.
Acceptance:
  - [ ] A 1 MB single line does not freeze the pane.
  - [ ] Typing in the pane stays responsive while the huge line is on screen.
Compat: —
Source: D-03-095

### TERM-137 · Shell hooks from different Kolux builds coexist
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: keeps two Kolux builds installed side by side, or moves between an older and a newer
  version, and opens terminals in each.
User sees: terminals in every build start normally, with the user's own shell configuration loaded.
Rules: Kolux hooks shell start-up (to know when the prompt is ready and to keep history per
  worktree) without replacing the user's own start-up files: those still load from the user's own
  config folder, including a custom zsh config folder the user had set; hook files live in Kolux's
  lasting data folder, not a temporary folder, and are written again if one goes missing while the
  background host runs; each build keeps its hook files where no other build writes (for example a
  folder named after the files' contents), so a shell never mixes halves from two builds; where a
  folder is shared, files another build left there are kept untouched and are never loaded in place
  of the user's own files, because removing them would make the older build rewrite its hooks over
  the newer ones and lose the user's config.
Acceptance:
  - [ ] With two builds installed, open a terminal in each, then a new one in the first again → all
      start, with the user's own aliases and prompt.
  - [ ] Leave an older build's hook files beside the current ones and let Kolux write its hooks
      again → the older files are still there unchanged, and a new zsh shell loads the user's
      config and none of the leftovers.
Compat: —
Source: D-03-137

### TERM-036 · Copy session, terminal and pane IDs
Tier: P2 · Pushed: 11 · State at 0.15.0: live-unverified
User does: chooses a copy-ID item in the pane menu.
User sees: the ID goes to the clipboard, with a success or failure notice.
Rules: Copy Session ID appears only when the agent's session identity is known; Copy Terminal ID and
  Copy Pane ID are always available; a failed clipboard write shows a failure notice and never a
  success one.
Acceptance:
  - [ ] Copy Session ID on a Claude pane puts that session's ID on the clipboard.
  - [ ] With the clipboard unavailable, Copy Terminal ID shows a failure notice, never a success
      notice.
Compat: —
Source: D-03-036

### TERM-096 · Links to other terminals and orchestration tasks
Tier: P2 · Pushed: 11 · State at 0.15.0: live-unverified
User does: clicks a terminal handle or task reference printed by the coordinator.
User sees: Kolux focuses that terminal or opens that task.
Rules: only recognised handle formats become links.
Acceptance:
  - [ ] Clicking a printed terminal handle focuses its pane.
  - [ ] Text that only looks like a handle but is not a recognised format is not a link.
Compat: —
Source: D-03-096

### TERM-018 · Focus follows mouse
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: turns on focus follows mouse.
User sees: hovering over a pane focuses it without a click.
Rules: off by default.
Acceptance:
  - [ ] With the setting on, moving the pointer into pane B lets typing go to B.
  - [ ] With the setting off (the default), hovering over a pane leaves focus where it was.
Compat: —
Source: D-03-018

### TERM-053 · Search open tabs
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: searches open tabs by name from the tab entry box.
User sees: matching open tabs appear and can be jumped to.
Rules: stale results are dropped as the query changes; matches tab names only; a query matching just
  the worktree name finds nothing; open browser pages are listed with the terminal tabs; closing the
  box gives the keyboard back to where it was (T-668).
Acceptance:
  - [ ] Typing part of a tab name lists that tab.
  - [ ] A query matching only the worktree name returns no tabs.
  - [x] The search lists browser pages as well as terminal tabs, and closing it puts focus back.
      (unit; evidence/T-668.txt)
Compat: —
Source: D-03-053

### TERM-062 · Shortcuts inside the floating panel
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: uses tab shortcuts while focus is in the floating panel.
User sees: new tab, open markdown, tab switching, rename and tab-by-number act on the floating
  panel, not the main window.
Rules: shortcuts past the visible tab count are swallowed without action; double-tap shortcuts reset
  when the window loses focus; key chords the panel has no action for pass through untouched.
Acceptance:
  - [ ] Cmd/Ctrl+T in the floating panel opens a floating tab.
  - [ ] A key chord the panel has no action for reaches the terminal unchanged.
Compat: —
Source: D-03-062

### TERM-066 · Copy on select
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: turns on copy on select.
User sees: selecting text copies it automatically.
Rules: off by default; failure notices are throttled so dragging does not spam them.
Acceptance:
  - [ ] With the option on, dragging over text puts it on the clipboard.
  - [ ] With the clipboard failing, one long drag-select shows a single failure notice, not one per
      movement.
Compat: —
Source: D-03-066

### TERM-067 · Select all in a terminal
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: presses the select all shortcut.
User sees: all terminal text is selected.
Rules: Cmd+A on macOS; Ctrl+Shift+A on Windows/Linux, leaving bare Ctrl+A to the shell.
Acceptance:
  - [ ] Ctrl+A in a Linux shell moves to the line start rather than selecting.
  - [ ] On macOS, Cmd+A selects all of the terminal text.
Compat: keybinding command for select all in a terminal (exact id held back until allowlisted).
Source: D-03-067

### TERM-072 · Right-click to paste
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: right-clicks in a pane.
User sees: on Windows it pastes; on macOS and Linux it opens the pane menu.
Rules: default follows the platform; the user can change it.
Acceptance:
  - [ ] On Windows, right-click with text on the clipboard pastes it.
  - [ ] On macOS, right-click opens the pane menu; after changing the setting it pastes instead.
Compat: —
Source: D-03-072

### TERM-073 · Middle-click paste of the selection
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: middle-clicks in a pane.
User sees: the last selected text is pasted (Linux primary selection style).
Rules: on by default on Linux; off elsewhere unless turned on.
Acceptance:
  - [ ] On Linux, selecting text then middle-clicking pastes it.
  - [ ] On macOS with the default left alone, middle-click does not paste.
Compat: —
Source: D-03-073

### TERM-082 · Enhanced keyboard protocol for modern TUIs
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: uses a program that asks for the enhanced (kitty) keyboard protocol.
User sees: modifier combos reach the program exactly.
Rules: only used while the program has asked for it; dead keys still start accented characters; Cmd
  or Ctrl combos are not intercepted.
Acceptance:
  - [ ] Option+digit in a kitty-mode program arrives as an encoded key, not a symbol.
  - [ ] A dead key followed by a letter still produces the accented character.
Compat: —
Source: D-03-082

### TERM-084 · Yen key types backslash (JIS keyboards)
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: turns on yen-to-backslash on a Japanese keyboard.
User sees: the yen key types a backslash.
Rules: off by default.
Acceptance:
  - [ ] With the option on, the yen key types a backslash in the shell.
  - [ ] With the option off (the default), the yen key types a yen sign.
Compat: —
Source: D-03-084

### TERM-085 · Switch input source shortcut
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: assigns and presses the switch-input-source shortcut.
User sees: the OS input source switches without the key reaching the terminal.
Rules: unbound by default; only works through an explicit assignment.
Acceptance:
  - [ ] An ordinary chord is not treated as input-source switching.
  - [ ] With the shortcut assigned, pressing it switches the OS input source and nothing reaches the
      terminal.
Compat: keybinding command for switching the input source (exact id held back until allowlisted).
Source: D-03-085

### TERM-086 · Control keys work on non-Latin keyboard layouts
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Ctrl+C or similar with a Cyrillic or other non-Latin layout active.
User sees: the control key acts as if on a Latin layout.
Rules: mapping uses the physical key; macOS system-wide key remaps are honoured.
Acceptance:
  - [ ] Ctrl+C on a Russian layout interrupts the running program.
  - [ ] Ctrl+D on a Greek layout ends input in a shell just as it does on a Latin layout.
Compat: —
Source: D-03-086

### TERM-087 · Hide the mouse pointer while typing
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: turns on hide-while-typing and types.
User sees: the pointer disappears until the mouse moves.
Rules: off by default.
Acceptance:
  - [ ] Typing hides the pointer; moving the mouse shows it.
  - [ ] With the option off (the default), the pointer stays visible while typing.
Compat: —
Source: D-03-087

### TERM-088 · Selecting text in mouse-capturing programs
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: tries to select text in a program that captures the mouse.
User sees: a hint explains holding Shift to select.
Rules: a program that died leaving mouse capture on does not keep capturing after reattach.
Acceptance:
  - [ ] Shift-drag in a mouse-capturing TUI selects text.
  - [ ] After a mouse-capturing program dies and the pane is reattached, a plain drag selects text
      again.
Compat: —
Source: D-03-088

### TERM-089 · Mouse wheel scroll speed
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: scrolls with the wheel or trackpad.
User sees: normal, fast (with modifier) and full-screen-app scrolling at tuned speeds.
Rules: normal 1.15, fast 5, inside full-screen apps 1; queued wheel events in a TUI drain instead of
  piling up; each notched wheel tick reaches a mouse-capturing program at once, and a scroll setting
  for full-screen programs scales those reports.
Acceptance:
  - [ ] Holding the fast modifier scrolls several times further per notch.
  - [ ] A fast burst of wheel ticks over a full-screen program stops scrolling soon after the wheel
      stops, with no backlog.
Compat: —
Source: D-03-089

### TERM-091 · Scrollback length
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: scrolls back through long output.
User sees: earlier output is kept up to the scrollback limit.
Rules: a default row limit applies; long tables restore their scroll position after a tab switch.
Acceptance:
  - [ ] Output beyond the limit is trimmed from the oldest end.
  - [ ] After a tab switch, a long table comes back at the same scroll position.
Compat: —
Source: D-03-091

### TERM-094 · Link action menu
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the link menu gesture on a link.
User sees: a small menu offers to open or copy the link.
Rules: on by default; can be turned off, which also removes it from the hover hint.
Acceptance:
  - [ ] With the menu off, the hover hint no longer mentions it.
  - [ ] With the menu on, the gesture offers to open or copy the link.
Compat: —
Source: D-03-094

### TERM-099 · Import settings from Ghostty
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: imports an existing Ghostty config.
User sees: matching Kolux terminal settings and themes are filled in; unsupported keys are listed.
Rules: maps font, cursor, colours and palette, padding, split divider colour, unfocused split
  opacity, scrollback, Option-as-Alt, bold colour, selection characters and hide-mouse-while-typing;
  theme references are resolved from Ghostty's theme folders; keys with no Kolux equivalent are
  reported, not silently dropped; focus follows mouse is imported; an invalid value is reported, not
  guessed; an oversized config file is skipped and reported while settings already imported are
  kept; middle-click paste behaviour (paste the selection) is imported too; a background blur
  setting maps to the app's window blur setting; zero means off and is not reported as dropped.
Acceptance:
  - [ ] Importing a config with an unknown key shows it in the unsupported list.
  - [ ] Importing a config with an invalid value reports that value instead of guessing.
Compat: file format: Ghostty config (key = value) and Ghostty theme files.
Source: D-03-099

### TERM-100 · Import Warp themes
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: imports a theme from Warp.
User sees: a preview of the found Warp themes, then the chosen one is added as a custom theme.
Rules: looks in Warp's theme folders; parsing is time-limited so a bad file cannot hang the app;
  theme files that are skipped are listed with a reason, and the reason never shows full folder
  paths; background images and gradients in a Warp theme are left out and reported as skipped.
Acceptance:
  - [ ] A malformed theme file fails with a message instead of hanging.
  - [ ] A theme with a background image is added without the image, and the image is reported as
      skipped.
Compat: file format: Warp theme YAML.
Source: D-03-100

### TERM-101 · Cursor style
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: chooses block, bar or underline, blink on or off.
User sees: the cursor takes that shape.
Rules: default block, blinking; a program that sets its own cursor shape wins until it hands control
  back; an unfocused pane shows a hollow cursor only for block style.
Acceptance:
  - [ ] Choosing bar persists across restart.
  - [ ] A program that asks for a bar cursor gets a bar until it hands control back; then the chosen
      style returns.
Compat: —
Source: D-03-101

### TERM-104 · Correct rendering of complex scripts and emoji
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: prints Arabic, CJK, Hangul or emoji tables.
User sees: text lines up correctly and the cursor sits in the right cell.
Rules: wide characters take two cells; the cursor matches; arabic shaping is shown correctly; tables
  with emoji and wide characters keep a clean right edge after restore and after scrolling.
Acceptance:
  - [ ] An emoji table renders with aligned columns.
  - [ ] Wide characters take two cells and the cursor lands right after them.
Compat: —
Source: D-03-104

### TERM-121 · Setup script runs in its own tab
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: creates a worktree whose repo has a setup script.
User sees: the setup script runs in a new terminal tab by default.
Rules: launch mode default: new tab.
Acceptance:
  - [ ] A new worktree opens a tab running its setup script.
  - [ ] Creating a worktree in a repo without a setup script opens no setup tab.
Compat: —
Source: D-03-121

### TERM-133 · Colour-code a tab
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: right-clicks a tab and picks a colour under Tab Color.
User sees: a small coloured dot shows on that tab; picking None removes it.
Rules: ten choices: none, blue, purple, pink, red, orange, yellow, green, teal and grey; the colour
  belongs to that tab only and does not change the terminal's own colours.
Acceptance:
  - [ ] Right-click a tab, Tab Color then Green: a green dot appears on that tab only.
  - [ ] Tab Color then None: the dot is gone.
Compat: —
Source: D-03-133

### TERM-135 · First web link click asks where links open
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: holds the link modifier and clicks a web address in terminal output for the first time.
User sees: before the link opens, a dialog shows the site it points to and asks whether terminal
  links should open in the Kolux browser or the system browser; the link then opens where the user
  chose.
Rules: asked once: the answer becomes the saved link destination and the dialog never comes back,
  including after a restart; if links are already set to open in the Kolux browser, the dialog
  offers keeping that or switching to the system browser instead; the Kolux browser choice has the
  keyboard focus; closing the dialog without picking (Escape or a click outside) opens the waiting
  links in the system browser this once, saves no answer and asks again on the next link (DT-C104,
  reverses "still counts as answered"); changing the link destination switch by hand also
  counts as answered, so the dialog never appears after that; clicks that already name a
  destination (Shift plus the link modifier, or a pick from the link action menu) open at once
  without the dialog; several link clicks made while the dialog is up share one question, and each
  waiting link opens with that one answer; guided tours hold off while the dialog is showing; the
  dialog reminds the user that Shift plus the link modifier opens the system browser for a single
  click, and says where the choice can be changed later; the old dialog pointed to a browser
  settings section that the rebuild cuts, so the rebuild puts the link destination switch on the
  Terminal & sessions page beside the other link options, and the dialog points there.
Acceptance:
  - [ ] Fresh profile: modifier-click a web address, pick the system browser → it opens there;
      modifier-click another address, also after restarting Kolux → it opens in the system browser
      with no dialog.
  - [ ] Fresh profile: press Escape on the dialog → the link opens in the system browser, and the
      next modifier-click asks again.
  - [x] Dismissing the question opens the waiting links in the system browser once, saves nothing and
      asks again next time. (unit; evidence/T-668.txt)
  - [ ] Fresh profile: turn on the link destination switch on the Terminal & sessions page, then
      modifier-click an address → it opens in the Kolux browser with no dialog.
Compat: —
Source: D-03-135

### TERM-033 · Session stepper (minus/plus) retired
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-10-05
User does: used to click minus/plus to change the pane count.
User sees: the stepper is gone; the add/remove shortcuts remain.
Rules: retired 2026-10-05 with the clean look.
Acceptance:
  - [ ] The default build shows no minus or plus pane stepper above the grid.
  - [ ] Assigned add-session and remove-session shortcuts still change the pane count.
Compat: —
Decision: H: default skip.
Source: D-03-033

### TERM-034 · Attention ring on panes
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: would see an attention ring on a pane needing the user.
User sees: off by default behind an experimental flag; the unread and done-glow paths are used
  instead.
Rules: when off, background attention falls back to marking the worktree unread.
Acceptance:
  - [ ] The default build draws no attention ring around any pane.
  - [ ] A session needing the user in a background worktree marks that worktree unread instead.
Compat: —
Decision: H: default skip.
Source: D-03-034

### TERM-032 · Pane footer and message bar retired
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-10-05
User does: used to see a strip under each pane and a message bar for typing to the agent.
User sees: both are gone; typing goes straight to the terminal.
Rules: retired on 2026-10-05; the Swarm footer keeps status plus Approve/Deny/Answer; the Agents
  view keeps its own composer.
Acceptance:
  - [ ] The default build shows no strip under the panes and no message bar.
  - [ ] Typing in a pane goes straight to its terminal.
Compat: —
Decision: H: default skip.
Source: D-03-032

### TERM-117 · Freeze report and render diagnostics
Tier: H · Pushed: 9 · State at 0.15.0: dev-only
User does: would open a freeze report in developer tools.
User sees: developer-facing traces of drawing and GPU events.
Rules: kept as internal breadcrumbs; the user-facing path is Copy terminal diagnostics.
Acceptance:
  - [ ] The default build offers users no freeze report.
  - [ ] Copy terminal diagnostics stays the user-facing way to report terminal trouble.
Compat: —
Decision: H: default skip.
Source: D-03-117

### TERM-127 · Deprecated terminal stop command
Tier: H · Pushed: 11 · State at 0.15.0: hidden
User does: would run kolux terminal stop for a worktree.
User sees: a hidden, deprecated command superseded by close.
Rules: not listed in help.
Acceptance:
  - [ ] kolux terminal --help does not list stop.
  - [ ] kolux terminal close covers everything stop used to do.
Compat: CLI: kolux terminal stop --worktree (hidden).
Decision: H: default skip.
Source: D-03-127

### TERM-039 · Switch a pane between chat and terminal view
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: toggles an agent pane into a chat view.
User sees: available only when native chat is enabled, which is off by default.
Rules: the menu item is hidden unless native chat is on.
Acceptance:
  - [ ] With native chat off (the default), the pane menu has no chat view item.
  - [ ] Agent panes show only the terminal view.
Compat: —
Decision: H: default skip.
Source: D-03-039

### TERM-123 · Agent hibernation
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: would see idle agents put to sleep after 30 minutes.
User sees: behind an experimental flag, off by default.
Rules: idle time default 30 minutes; sleeping sessions restore when opened; idle time counts from
  the agent's last state change, not its last update; a finished Claude turn makes the agent
  eligible for sleep.
Acceptance:
  - [ ] With the flag off (the default), finished idle agents are never put to sleep.
  - [ ] If the owner revives it: a session idle for 30 minutes since its last state change sleeps,
      and opening it restores it.
Compat: —
Decision: H: default skip.
Source: D-03-123

### TERM-124 · Standalone terminal window
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: would open a terminal in its own OS window.
User sees: present but unused; nothing in the grid as it stands today opens it.
Rules: nothing in the main UI opens it.
Acceptance:
  - [ ] Nothing in the default build opens a terminal in an OS window of its own.
  - [ ] Every terminal opens as a pane in the grid or in the floating panel.
Compat: —
Decision: H: default skip.
Source: D-03-124

### TERM-131 · Agent brand marks in pane headers and tabs
Tier: X · Pushed: 10 · State at 0.15.0: live
User does: sees agent logos in headers, tabs and the floating panel.
User sees: the logo of each agent vendor beside its session.
Rules: third-party brand marks; the rebuild must use owner-made or licensed marks.
Acceptance:
  - [ ] No third-party agent logo ships in the rebuild; each agent shows an owner-made or licensed
      mark.
  - [ ] Headers, tabs and the floating panel all show the same replacement mark for a given agent.
Compat: —
Source: D-03-131

### TERM-038 · Quick commands menu
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: picks a saved command from a quick commands menu or pane submenu.
User sees: the command is typed into the terminal.
Rules: quick commands lived in the tab bar, the pane menu submenu and an unbound shortcut.
Acceptance:
  - [ ] The default build has no quick commands menu in the tab bar or the pane menu.
  - [ ] The keybinding list has no command for quick commands.
Compat: —
Decision: default cut: quick commands menu is in the owner's table 1b cut list. Revive via
  DECISIONS.md.
Source: D-03-038

### TERM-064 · Mobile emulator tab in the floating workspace
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens an iOS/Android emulator tab.
User sees: a simulator tab alongside terminals.
Rules: part of the mobile emulator pane, area 18.
Acceptance:
  - [ ] The floating panel offers no emulator tab.
  - [ ] The new tab menu lists no iOS or Android simulator.
Compat: —
Decision: default cut: remote hosts, web runtime, WSL execution and mobile are area 18, dropped by
  the owner. Revive via DECISIONS.md.
Source: D-03-064

### TERM-128 · SSH and remote host terminals
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens a terminal on an SSH host or remote runtime.
User sees: a remote shell with reconnect banners and remote-path handling.
Rules: includes reconnect banner, remote error toasts and remote paste/drop path conversion.
Acceptance:
  - [ ] The default build offers no SSH or remote host terminal.
  - [ ] Local terminals never show a reconnect banner or convert paths for a remote host.
Compat: —
Decision: default cut: remote hosts, web runtime, WSL execution and mobile are area 18, dropped by
  the owner. Revive via DECISIONS.md.
Source: D-03-128

### TERM-129 · WSL shells and WSL path conversion
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens a WSL shell or drops, pastes or clicks paths in one.
User sees: Linux paths are used for WSL panes.
Rules: WSL distro choice in the shell menu, WSL path mapping for links and drops.
Acceptance:
  - [ ] The Windows shell menu lists no WSL distributions.
  - [ ] Dropped, pasted or clicked paths are never converted to Linux paths.
Compat: —
Decision: default cut: remote hosts, web runtime, WSL execution and mobile are area 18, dropped by
  the owner. Revive via DECISIONS.md.
Source: D-03-129

### TERM-130 · Web client and paired runtime terminals
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: uses terminals from the web client or a paired runtime.
User sees: terminals that live on another host and stream to the browser.
Rules: covers web clipboard fallback, runtime uploads and runtime routing.
Acceptance:
  - [ ] No terminal streams to a web client in the default build.
  - [ ] Every terminal runs on the local machine only.
Compat: —
Decision: default cut: remote hosts, web runtime, WSL execution and mobile are area 18, dropped by
  the owner. Revive via DECISIONS.md.
Source: D-03-130

### TERM-136 · Phone control of a desktop terminal
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens a desktop terminal from the paired phone app.
User sees: while the phone views it, the desktop pane is sized for the phone and an overlay offers to
  restore this pane or every pane to desktop size; the overlay collapses to a small chip, and
  restoring refits the panes, including ones in workspaces not on screen.
Rules: part of the mobile page and phone pairing, area 18; a Mobile settings section chose when
  panes went back to desktop size on their own.
Acceptance:
  - [ ] The default build never resizes a desktop pane for another device.
  - [ ] No pane shows a phone control overlay or chip, and no settings page offers an automatic
      restore after a phone.
Compat: —
Decision: default cut: remote hosts, web runtime, WSL execution and mobile are area 18, dropped by
  the owner. Revive via DECISIONS.md.
Source: D-03-136

## Dropped by default (tier D)

- TERM-038 · Quick commands menu · owner table 1b cut (the quick commands settings section goes, and the menu with it)
- TERM-064 · Mobile emulator tab in the floating workspace · area 18 (remote and hosts) dropped by the owner on 2026-10-05; mobile emulator pane
- TERM-128 · SSH and remote host terminals · area 18 (remote and hosts) dropped by the owner on 2026-10-05; SSH and remote runtimes
- TERM-129 · WSL shells and WSL path conversion · area 18 (remote and hosts) dropped by the owner on 2026-10-05; WSL execution
- TERM-130 · Web client and paired runtime terminals · area 18 (remote and hosts) dropped by the owner on 2026-10-05; web client and paired runtimes
- TERM-136 · Phone control of a desktop terminal · area 18 (remote and hosts) dropped by the owner on 2026-10-05; mobile page and phone pairing

## Hidden or retired (tier H)

- TERM-033 · Session stepper (minus/plus) retired · retired 2026-10-05 · H: default skip
- TERM-034 · Attention ring on panes · hidden behind an experimental flag, off by default · H: default skip
- TERM-032 · Pane footer and message bar retired · retired 2026-10-05 · H: default skip
- TERM-117 · Freeze report and render diagnostics · dev-only internal breadcrumbs · H: default skip
- TERM-127 · Deprecated terminal stop command · hidden and deprecated, not in help · H: default skip
- TERM-039 · Switch a pane between chat and terminal view · hidden behind the native chat flag, off by default · H: default skip
- TERM-123 · Agent hibernation · hidden behind an experimental flag, off by default · H: default skip
- TERM-124 · Standalone terminal window · hidden, nothing in the grid opens it · H: default skip
