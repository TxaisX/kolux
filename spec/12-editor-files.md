# 12 · Editor & files

How the user reads and changes files inside Kolux. Files open as tabs in the editor area: code with
language colouring, markdown in a rich document editor with source and preview views, and viewers
for pictures, PDFs, CSV tables, notebooks, HTML pages and growing logs. Diff tabs, the All Changes
view and CI check tabs live in the same area. Work in progress is guarded by a banner when a file
changes on disk, optional autosave, saves that either land whole or not at all, and drafts that come
back after a crash. The explorer in the right sidebar browses and reshapes the worktree's files,
Quick Open finds a file by name, and search looks through file contents. Open in Code and Answer in
Code jump from the Inbox to the exact pane where an agent is waiting. Every workspace keeps its own
handoff note, which can be passed to an agent as its first prompt. The `kolux file` commands open
files and diffs from a terminal. Since 2026-10-06, projects stored in WSL behave like local ones
again, and file access is fenced to the user's own projects. Editing files on remote hosts and the
simulator palette are dropped by default.

Tier counts: P0 12 · P1 29 · P2 14 · H 0 · X 0 · D 2
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04
Agent status, hooks & notifications · 05 Views & navigation · 10 Plan review & protected actions ·
11 Git, source control & review · 13 Browser pane & computer use · 17 Settings, appearance & input ·
18 Remote & hosts (dropped) · 19 App lifecycle & operations · 20 The `kolux` CLI

## Cards

### EDIT-041 · Open in Code and Answer in Code jump to the agent's pane
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: picks an item in the Inbox (or a lane on the Floor, or a needs-you entry in the sidebar)
  and clicks Open in Code, or presses Enter.
User sees: Kolux switches to the Code (terminals) view, selects that worktree, scrolls the sidebar
  to it, and focuses the exact tab and pane where the agent runs. When a question or permission
  cannot be answered on the spot, the button reads Answer in Code and takes the user to the pane to
  answer it there.
Rules: Enter on a selected Inbox item does the same as the button; questions and permission prompts
  are answered on the spot when the agent's terminal is alive and its prompt can be read; otherwise
  the item offers Answer in Code; opening an item marks it as visited.
Acceptance:
  - [x] Inbox item for a waiting agent → click Open in Code → Code view, correct worktree, correct
        pane focused. (cards live; evidence/cards-EDIT-041.txt)
  - [x] Permission item whose terminal has exited → Answer in Code shows instead of inline buttons. (cards; evidence/cards-EDIT-041.txt)
Compat: keybinding id view.code.
Source: D-12-041

### EDIT-044 · Projects stored in WSL open and save like local ones again
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: on Windows, opens a project that lives inside WSL (reached through the wsl$ or
  wsl.localhost network path) and edits, searches and watches its files.
User sees: the explorer, the editor, search and live refresh all work on the WSL project just as
  they do on a local disk.
Rules: WSL roots are treated as local paths, not as network shares; searching a WSL project runs
  ripgrep inside the chosen distribution and maps the paths back; if the WSL watcher runs out of
  capacity it tries again rather than going quiet; deletes on WSL are permanent, since there is no
  trash there; Windows long paths work when creating and removing folders; on Windows, a removal
  that fails for a passing reason, such as a file locked for a moment, is retried a few times; one
  file reached both through its WSL path and through its Windows drive alias counts as the same file
  for change detection, while names inside the Linux file system stay case-sensitive.
  (Kolux RS, T-062-a: a Windows removal that fails with a sharing or lock violation or access
  denied is retried five times, 60 ms apart, before it counts as failed; deletes on WSL are
  permanent and warned; the search, watcher and alias rules wait for T-062-b and a WSL
  distribution on the build machine.)
  (Kolux RS, T-062-b, 2026-11-02: the search of a WSL root runs ripgrep inside its distribution
  through wsl.exe with no shell in between, hits mapped back by their relative paths, a missing
  wsl.exe or ripgrep reported; a WSL worktree is read every 4 s from the start instead of watched,
  the read that never goes quiet (DT-C70); one file through its WSL path and its drive alias is one
  editor buffer, Linux names case-sensitive. Unit tests only: both boxes stay open until a WSL
  distribution is on the build machine, and the fence still refuses a WSL root as a share.)
Acceptance:
  - [ ] Add a project from an Ubuntu distribution's home folder through wsl.localhost → the explorer
        lists its files; edit and save one; search finds text in it.
  - [ ] Delete a file in that project → it is removed for good and does not show up in the Windows
        recycle bin.
Compat: —
Source: D-12-044

### EDIT-045 · File access stays inside your projects and refuses other computers' shares
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: opens, saves or follows links to files, including paths an agent printed in a terminal.
User sees: files inside the user's projects work as normal; reads and writes outside them, symlinks
  that lead out of a project, and paths on another computer's network share are refused before the
  disk is touched.
Rules: a path that leaves the project through a symlink is refused; terminal links aimed at a
  different network host are refused; a parent-folder step (..) anywhere in a network path is
  treated as a foreign host; permission granted for an outside path covers that exact path and
  nothing beneath it; macOS system path aliases count as the same place; a save or file action begun
  for a folder workspace is refused if that workspace's folder changes before it finishes, so
  nothing lands in the wrong place.
  (Kolux RS, T-062-a: the roots are the projects, each project's own workspaces folder and the
  shared one; a parent-folder step (two dots) is refused as text; the place a path really leads to is checked only
  for reading, writing, listing and as the folder written into, so the link itself can still be
  renamed, trashed or moved; a grant lasts the run; a workspace's folder never changes in Kolux RS,
  so the mid-save refusal has nothing to guard.)
Acceptance:
  - [x] Open a file through a symlink that points outside the worktree → refused. (cards; evidence/cards-EDIT-045.txt)
  - [x] Click a terminal link to a file on another computer's share → refused, with no network
        lookup made. (cards; evidence/cards-EDIT-045.txt)
Compat: —
Source: D-12-045

### EDIT-053 · Opening a file in its system app never runs a program
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: clicks a file link that Kolux passes to the operating system (from a terminal or a note),
  or opens a finished browser download.
User sees: ordinary documents open in their usual app. Programs, scripts, installers and shortcuts
  are never started; the file manager opens with the file highlighted instead.
Rules: launchable files are recognised by type on every platform (programs, scripts, installers,
  shortcuts and the like), regardless of letter case and of dots or spaces trailing the name; on
  macOS and Linux a file with its execute permission set counts as launchable even with no
  extension; relative paths, missing files, links that are not file links, and file links naming
  another computer are ignored; the same test runs everywhere Kolux hands a file to the system.
  (Kolux RS, T-062-a: the editor's refusal offers "Open this file anyway", which allows that one
  path for the run through a one-file grant; there are no browser downloads yet.)
Acceptance:
  - [x] Click a terminal link to a batch file, a PowerShell script, an executable or a Windows
        shortcut → the file manager opens with it highlighted, and nothing runs. (cards; evidence/cards-EDIT-053.txt)
  - [ ] On Linux, an extensionless file with the execute bit → revealed, not run; the same file
        without the bit → it opens in its default app.
  - [x] Click a link to a plain text file → it opens in the default text app. (cards; evidence/cards-EDIT-053.txt)
  - [x] Open a link to a file on another computer → nothing happens. (cards; evidence/cards-EDIT-053.txt)
Compat: —
Source: D-12-053

### EDIT-003 · Banner when a file you have open is changed on disk by an agent
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: has unsaved edits in a tab while an agent or some other program rewrites the same file.
User sees: a banner over the editor reporting that the disk copy changed, with Reload, Keep my edits
  and Compare. Reload brings in the disk copy and offers to undo that in a toast; Keep my edits
  hides the banner; Compare opens a two-column view with the disk copy on the left and the user's
  buffer on the right.
Rules: saves made by Kolux itself never raise the banner, because it remembers what it has just
  written; a tab without unsaved edits quietly takes the new disk content with no banner; after a
  restart, tabs restored with unsaved drafts are compared with disk and get the banner if the file
  moved on meanwhile; Reload is recorded in undo history, so it can be undone, and it always fetches
  the file fresh instead of reusing a read already under way; autosave is held back while the banner
  is up; when two reads overlap, an earlier read that finishes late is thrown away instead of
  replacing newer content; if the disk copy cannot be read, Compare shows the read failure rather
  than an empty side; the Compare window has its own reload and keep buttons, and pressing either
  one closes it; a tab in the background whose file changed reloads when it is next brought forward,
  not while hidden; a background tab holding unsaved edits is not touched.
Acceptance:
  - [x] Edit without saving, then change the file from a terminal → the banner shows within a couple
        of seconds. (cards; evidence/cards-EDIT-003.txt)
  - [x] Click Reload → the buffer matches disk and a toast offers undo; undo → the edits come back. (cards; evidence/cards-EDIT-003.txt)
  - [x] Click Compare → disk copy on the left, buffer on the right. (cards live; evidence/cards-EDIT-003.txt)
  - [x] Save from Kolux → no banner. (cards; evidence/cards-EDIT-003.txt)
Compat: —
Source: D-12-003

### EDIT-001 · Edit a file in a tab and save it
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a file (from the explorer, Quick Open, a link in a terminal, or the command line),
  types in it, and presses Mod+S.
User sees: the file appears as a tab in the editor area, coloured by its language; while changes are
  pending the tab carries an unsaved marker, and saving writes the file and removes the marker.
  After a trip to the terminal view and back, the tab is still in front with caret, selection and
  scroll unchanged.
Rules: Mod+S saves whichever editor is active; when a floating editor panel has focus, only that
  panel's file is written and the main editor is left alone; outside a workspace screen Mod+S does
  nothing, unless a floating editor is the active one; a buffer that differs from the disk copy only
  in trailing whitespace is not counted as unsaved; caret, selection and scroll survive the tab
  being rebuilt by a tab switch, a view switch or a move to another pane; a newly opened file takes
  keyboard focus at once, so typing goes straight into it; a file that will not load is retried a
  limited number of times; after that the tab shows the failure and a Retry button; if a save fails,
  a toast reports it, the marker stays, and anything that was waiting for that save is called off;
  when one file is shown in two split panes, both panes edit the same text: keystrokes appear in
  both, changes Kolux applies itself (a reload, for example) leave both clean, and a single save
  request writes the file once, from the pane that owns it.
Acceptance:
  - [x] Open a code file from the explorer and type one character → unsaved marker shows; press
        Mod+S → marker gone and the character is on disk. (cards; evidence/cards-EDIT-001.txt)
  - [x] Go to the terminal view and come back → same tab in front, caret and scroll where they were. (cards live; evidence/cards-EDIT-001.txt)
  - [x] With a floating editor active and another file in the main editor, press Mod+S → only the
        floating editor's file changes on disk. (cards; evidence/cards-EDIT-001.txt)
  - [x] Take away read permission on a file and open it → failure message with Retry; give
        permission back and click Retry → the text loads. (cards; evidence/cards-EDIT-001.txt)
Compat: keybinding id editor.save; stored data: the open editor tabs of each worktree.
  Amended 2026-10-09 (DT-R13): until the explorer exists, a File... item in the New tab menu opens a file through the Windows Open dialog; that dialog refuses an unreadable file itself, so the read-permission check runs from the explorer (T-094); a file that is not UTF-8 text shows its reason and Retry.
Source: D-12-001

### EDIT-012 · Markdown opens in a rich editor, with source and preview views
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a markdown file, switches between rich, source and preview, presses Mod+Shift+V, or
  starts a new note with Mod+Shift+M.
User sees: markdown edit tabs open in a rich, document-style editor; source shows the plain text;
  Mod+Shift+V opens a separate read-only preview tab that says it is a preview; Mod+Shift+O offers a
  pick from the worktree's markdown files.
Rules: edit tabs open in rich view, while markdown diffs open as source; files larger than about 600
  KB open in source with a banner, whose Open anyway button turns that one tab rich; an Open anyway
  choice belongs to that tab only and is forgotten when a preview tab is reused for another file;
  content the rich editor cannot represent drops back to source with a banner giving the reason; if
  the rich editor cannot start, an error panel with Retry takes its place; the markdown file list
  leaves out ignored and symlinked folders and is capped, so huge repositories stay quick; if
  listing the notes fails, opening the picker again makes a fresh attempt instead of repeating the
  old failure.
Acceptance:
  - [x] Open the repository's readme → rich view; switch to source → plain markdown; press
        Mod+Shift+V → a separate preview tab. (cards live; evidence/cards-EDIT-012.txt)
  - [x] Open a 1 MB markdown file → source view with a banner; click Open anyway → rich view. (cards live; evidence/cards-EDIT-012.txt)
Compat: the existing keybinding ids for markdown preview, new markdown note and open markdown keep
  working.
Source: D-12-012

### EDIT-027 · Single-file diff tab: inline or side by side, step through changes
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a changed file's diff from source control or with `kolux file diff`, and moves
  through the changes with F7 and Shift+F7.
User sees: a diff tab that starts inline and can switch to two columns; its actions menu toggles
  whitespace display and wrapping (it works from the keyboard: focus goes to its first item, arrows move, Escape closes it and focus returns to its button; the embedded Changes bar has the same menu); F7 jumps to the next change and Shift+F7 to the previous one.
Rules: inline view leaves out the original side's line numbers; showing whitespace changes and
  wrapping both start off; Shift plus the scroll wheel scrolls sideways in whichever side is under
  the pointer; staged and unstaged diffs open as separate tabs, and the header says which one it is;
  the diff updates whenever git status changes; unstaged diffs can be edited, and saving writes the
  working file; an open unstaged diff keeps its content when the file gets staged from somewhere
  else, rather than going empty, and keeps reloading while its own unstaged row is listed; the
  header's previous and next change buttons are greyed out while there are no changes and come alive
  as soon as there are.
Acceptance:
  - [x] Open a diff → inline; switch to two columns → side by side; press F7 → the caret lands on
        the next change. (cards live; evidence/cards-EDIT-027.txt)
  - [x] Change the file in a terminal → the diff updates without reopening. (cards live; evidence/cards-EDIT-027.txt)
  - [ ] Open the diff actions menu with the keyboard → the first item has focus; Down moves; Escape closes it and focus returns to the button. (unit tests; evidence/T-683.txt)
Compat: the existing keybinding ids for next change (F7) and previous change (Shift+F7) keep
  working.
Source: D-12-027

### EDIT-029 · All Changes: every changed file in one scrolling view
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: opens All Changes for a worktree to read every changed file in a single scroll.
User sees: one tab with a section for each changed file, an optional side tree for jumping,
  filtering and ticking files off as viewed, and a commit-message area (in both the working-tree
  and the branch-against-base views, T-676, so a file staged here can be committed here). The
  working-tree view has Stage and Unstage on each file, Stage all, Unstage all, Push, Pull and Sync,
  and a Retry when the changes fail to load; the layout is an Inline / Side by side switch, and
  Make default says whether it saved.
Rules: the side tree starts hidden, can be resized, and stays quick with thousands of files;
  sections load as they scroll into view; a section over a changed-line threshold waits for a click;
  images and binaries load separately; scroll position and view return when the tab is brought back;
  sections reload when git status changes; inline editors grow to fit their content, but each
  section has a height ceiling so a huge or line-heavy file cannot take over; sections reserve an
  estimated height before drawing so scrolling does not jump; image diffs use their natural height;
  a section reuses content fetched earlier only if that file's change is the same as before;
  otherwise it fetches again; a section still loading or still waiting for a click never counts as
  viewed; a file with both staged and unstaged changes gets two tree entries, each leading to its
  own section; a Viewed box that is greyed out because its diff has not loaded says so in its tooltip and description.
  The tree's resize handle can be focused and moved with the arrow keys, Home and End,
  and a drag that the system cancels ends cleanly. One git action runs at a time (GIT-002, GIT-004,
  GIT-007).
Acceptance:
  - [x] Change 30 files and open All Changes → sections appear while scrolling; show the tree,
        filter by name and jump to a file. (cards live; evidence/cards-EDIT-029.txt)
  - [x] Mark a file viewed, switch tabs and come back → the mark and the scroll position are kept. (cards live; evidence/cards-EDIT-029.txt)
  - [ ] Hover a greyed-out Viewed box → it says it waits for the diff to load. (unit tests; evidence/T-683.txt)
  - [x] In the working-tree view, Stage a file, then Unstage it → it moves between its staged and unstaged sections and the Commit button follows. (unit; evidence/T-676.txt)
Compat: —
Source: D-12-029

### EDIT-033 · Explorer tree with mouse and keyboard
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the explorer (Mod+Shift+E) and moves through the worktree's folders with mouse or
  keys.
User sees: a tree of the worktree; arrows, Home and End move the highlight; Right expands a folder
  or steps into it, Left folds it or climbs to its parent; Mod-click and Shift-click select several
  rows.
Rules: a symlink expands only after it is confirmed to point at a folder; otherwise it opens as a
  file; expanded folders and scroll position survive hiding and showing the explorer, and reset when
  the worktree changes; very large folders scroll smoothly because only the rows on screen are
  drawn. Mod+Shift+E shows the explorer and puts focus in it (in its content search box when the
  search is open); pressed again while focus is in the explorer, it hides it.
Acceptance:
  - [x] Press Mod+Shift+E → the explorer opens; Down, Right, Down, Enter → the first file of the
        second folder opens. (cards live; evidence/cards-EDIT-033.txt)
  - [ ] Press Mod+Shift+E twice → the explorer opens, then hides. (source check; evidence/T-696.txt)
  - [x] Shift-click two rows apart → three rows are selected. (cards; evidence/cards-EDIT-033.txt)
Compat: keybinding id sidebar.explorer.toggle; view id explorer.
Source: D-12-033

### EDIT-034 · Explorer file operations: create, rename, copy, delete, undo, drop in
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: creates, renames, copies, deletes or drags files in the explorer, drops files in from the
  desktop, and presses Mod+Z after a slip.
User sees: each change lands on disk and in the tree at once; deleted items go to the system trash;
  undo and redo reverse explorer actions; the path and the relative path can each be copied with a
  shortcut.
Rules: creating a file or folder never replaces something already there, and copies never overwrite;
  an inline rename is committed when focus leaves and cancelled by Escape; a rename that only
  changes letter case, or only the Unicode normalisation of the same name, is allowed; renaming onto
  a different existing name is refused; renaming a symlink renames the link itself, never what it
  points to; two renames racing for the same destination run in turn, so only one of them gets it;
  deleting several selected items asks once, and a failure on one item does not stop the rest;
  deletes on a WSL share are permanent, because that share has no trash; dragging a folder together
  with some of its own children moves only the folder, and the tree scrolls by itself near its edges
  during a drag; a drop from the desktop copies folders with everything inside them, gives clashing
  top-level items a new name, and refuses symlinks; undo is Mod+Z and redo is Mod+Shift+Z, with
  Ctrl+Y as well on Windows and Linux; Delete (and Mod+Backspace on macOS) removes the selection.
Acceptance:
  - [x] Create a file whose name is already taken → refused, and the original is untouched. (cards; evidence/cards-EDIT-034.txt)
  - [x] Delete two files → one confirmation, both in the trash; press Mod+Z → both come back. (cards; evidence/cards-EDIT-034.txt)
  - [x] Drop a desktop folder onto a folder that already holds one with the same name → the copy
        arrives under a new name. (cards; evidence/cards-EDIT-034.txt)
Compat: the existing keybinding ids for explorer undo, redo, copy path, copy relative path and
  delete keep working.
Source: D-12-034

### EDIT-036 · Quick Open a file by name with Mod+P
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Mod+P and types part of a file name.
User sees: a fuzzy-matched list of the worktree's files with the best name hits first; hovering a
  result shows its full path in a tooltip that follows the pointer and sets the file name apart from
  its folder; Enter opens the file.
Rules: hits in the file name outrank hits only in the folder path, and no more than 50 results show;
  an empty query lists files in natural order; nested worktrees and build-cache or editor-settings
  folders (such as those that the Next framework, VS Code and JetBrains IDEs create) are left out;
  the list comes from ripgrep; when ripgrep is missing the dialog explains how to install it and can
  try again, and it uses git's file list where it can; a one-off failure to start ripgrep is retried
  rather than reported as a missing install; it stays quick on worktrees of around 100,000 files;
  when the file list reaches its cap, the dialog says the list is incomplete rather than implying it
  covers everything; the new-tab menu's file search ranks results the same way and shows the full
  path on hover; the arrow keys scroll the active result into view, and a hover never scrolls.
Acceptance:
  - [x] Press Mod+P and type panel → files with panel in their name come before files that only sit
        in a panel folder. (cards; evidence/cards-EDIT-036.txt)
  - [x] Hover a result → the path tooltip appears and follows the pointer. (cards; evidence/cards-EDIT-036.txt)
  - [ ] Press Down past the last visible result → the list scrolls to keep the active one in view. (unit tests; evidence/T-683.txt)
Compat: the existing keybinding id for Quick Open keeps working.
Source: D-12-036

### EDIT-040 · Per-workspace handoff note that can be given to an agent
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: opens the Handoff section in the right sidebar, writes a note, and may click Hand to
  agent… to pass it on.
User sees: a foldable note area that belongs to this workspace alone, saves by itself and shows
  saving, saved, a save error, or how long since it last changed. Handing it over opens the chosen
  agent in a new tab with the note as its first prompt, and adds a dated line to the note recording
  who received it.
Rules: folded by default, and available on every kind of workspace; saves after a brief pause in
  typing and whenever focus leaves; each workspace (host plus folder path) has its own note, so a
  folder workspace and a worktree made from it never share one; a note holds at most 256 KB; the
  agent list shows only agents found on that machine and honours the default and disabled agents; a
  damaged stored note reads as empty instead of failing, and every write is all-or-nothing.
Acceptance:
  - [ ] Type a note and wait a second → Saved; restart Kolux → the note is still there.
  - [ ] Hand it to Claude → a new tab runs Claude with the note sent, and the note gains a handed-to
        line.
  - [ ] Open a different worktree → its note is empty.
Compat: stored data: one handoff note per workspace (its text and last-updated time).
Source: D-12-040

### EDIT-047 · Worktree switcher search in the Mod+J palette
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: opens the worktree palette and types.
User sees: recent worktrees while the box is empty; typing matches worktree name, branch, emoji
  shortcode, repository and worktree together, pull request or issue numbers and links, comments,
  and host and port numbers.
Rules: matches on the name rank first; a query naming repository and worktree together can match
  across both parts; every word of a multi-word query has to match somewhere in the entry; queries
  over a length limit are rejected before any search runs.
Acceptance:
  - [ ] Type a pull request number → the worktree tied to that pull request is first.
  - [ ] Type two words where only one fits a worktree → that worktree is not listed.
Compat: —
Source: D-12-047

### EDIT-007 · Copy a selection together with its path and line numbers
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: selects some lines and presses Mod+Alt+C, or copies a reference to a single line.
User sees: the clipboard receives the selected text headed by the file's path and the line range,
  ready to paste into an agent's prompt; a one-line reference is written as path:line.
Rules: a selection whose end sits in column one of a line leaves that line out; part of a single
  line is copied as bare text with no header, while a whole single line still gets the header; while
  a selection that can be copied this way exists, a small hint beside it shows the shortcut as
  currently bound; the hint goes away once that selection has been copied, and a brief confirmation
  shows near it; on Linux with middle-click paste enabled, selecting in the editor also fills the
  primary selection, up to a size limit.
Acceptance:
  - [ ] Select lines 10 to 14, press Mod+Alt+C and paste → the text is headed by the path and the
        range 10-14.
  - [ ] Copy a reference on line 7 → the clipboard holds the path, a colon and 7.
Compat: the existing keybinding id for copy-with-context keeps working; clipboard format path:line.
Source: D-12-007

### EDIT-020 · Review notes on a file, sent to an agent
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: selects text in a note or a code file, presses Mod+Shift+A, writes a comment, then uses
  the Send menu.
User sees: comments sit in a margin rail beside rich markdown, tied to the text they refer to. The
  Send menu lists the agents running in this worktree with how long since each one changed state,
  plus a way to start a new agent; choosing one delivers the notes to it.
Rules: the chosen agent is checked again at the moment of the click, and nothing is sent if it has
  gone; a failed delivery keeps the notes; review tools are on by default and can be switched off in
  settings; adding a note defaults to Mod+Shift+A and can be rebound; holding the keys adds just one
  note, and the keystroke passes through untouched when there is nothing to annotate; sending notes
  has a shortcut slot with no key assigned by default; notes attach to the right line whatever the
  file's line endings, and notes sharing one anchor are listed in the order of their source lines; in a diff the "+" beside a line is
  drawn only where a note can be saved (the embedded Changes view shows its note cards without it); deleting a note from its card
  shows "Review note deleted. Undo" for 8 seconds, and Undo saves it again;
  the clear-all button asks first ("Clear all N notes? This cannot be undone.", Keep them focused)
  and the question goes away with the notes; a failed copy says so and opens the Markdown for
  selecting, and a send or start that throws says why and keeps the notes; the Send menu works
  from the keyboard (arrows, Home and End, Escape returns focus to its button) and each rail card
  takes Tab, with Enter or Space showing the text it is about.
Acceptance:
  - [ ] Add two notes and send them to a running agent → both reach its prompt and the rail empties.
  - [ ] Kill the agent after opening the menu and before clicking it → the notes stay unsent.
  - [ ] Delete a note on a diff card → "Review note deleted. Undo" shows, and Undo brings it back. (unit tests; evidence/T-683.txt)
  - [x] Press the clear-all X with three notes → it asks first; Keep them leaves the notes, Clear all drops them; a failed copy says so; a send that throws keeps the notes and says why. (tests; evidence/T-684.txt)
Compat: the existing keybinding ids for adding a review note and for sending review notes keep
  working.
Source: D-12-020

### EDIT-002 · Autosave, off by default, writes edits after a short pause
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: switches autosave on in settings and carries on editing without pressing Mod+S.
User sees: shortly after typing stops the change is written to disk and the unsaved marker clears by
  itself.
Rules: a new install has autosave switched off; the user sets the pause length; it starts at one
  second, is held between a quarter of a second and ten seconds, and goes back to one second when
  the stored value cannot be read; it covers ordinary edit tabs and diff tabs showing a single
  unstaged file; it never covers staged diffs, the combined All Changes view, conflict views or
  read-only tabs; it stands down while the changed-on-disk banner is up for a file, so an edit made
  by another program is never overwritten.
Acceptance:
  - [ ] Fresh profile → the autosave setting is off.
  - [ ] Switch autosave on, edit a file and wait past the pause → the file is written without a
        keypress.
  - [ ] Edit a file outside Kolux while its tab holds unsaved edits → the banner appears and the
        outside edit is not overwritten.
Compat: —
Source: D-12-002

### EDIT-004 · Open tabs and unsaved drafts come back after a quit or crash
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits Kolux, or it crashes, with editor tabs open and some of them unsaved, then starts
  it again.
User sees: each worktree reopens with its editor tabs, the same tab in front, and the unsaved text
  still in place and still marked unsaved.
Rules: unsaved text is kept as a draft for each file in each worktree and is never written into the
  real file; repeated or corrupt entries in the saved session are tidied away on restore instead of
  opening twice; files whose worktree has since been removed are skipped; the language of each
  restored file is detected afresh instead of being taken from the saved session; removing a
  worktree discards its editor state and its drafts; read-only tabs return read-only and never carry
  a draft; a restored tab whose file really belongs to another project the user has open moves under
  that project with its unsaved text, caret and view mode, and from then on tracks outside edits,
  deletions and renames there.
Acceptance:
  - [ ] Edit two files without saving, quit, relaunch → both tabs come back with the edits and the
        unsaved marker.
  - [ ] Delete a worktree, relaunch → none of its tabs come back.
Compat: stored data: the editor session of each worktree (open tabs, which tab is in front, unsaved
  draft text).
Source: D-12-004

### EDIT-019 · Rich editing leaves the untouched parts of a note byte-for-byte
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: changes one paragraph of a note in rich view and saves.
User sees: only that paragraph differs on disk; front matter, line endings, raw HTML and collapsible
  blocks elsewhere stay exactly as they were.
Rules: front matter in YAML (between --- lines) or TOML (between +++ lines) is preserved and kept
  out of the body text; Windows line endings, soft breaks and inline HTML come through a round trip
  intact; opening and closing a note without changing it leaves it clean and identical on disk;
  leaving the rich editor commits the latest typing at once, so a save straight afterwards includes
  it; hard-wrapped prose shows as one flowing paragraph and keeps flowing after neighbouring blocks
  are removed; in preview, front matter appears as its own block above the note; the More actions
  menu hides or shows it for each note, shown at first and remembered across restarts.
Acceptance:
  - [ ] Open a note with Windows line endings and YAML front matter in rich view, change one word,
        save → git diff shows a single changed line.
  - [ ] Open a note and close it without typing → no unsaved marker, and the file on disk is
        unchanged.
Compat: file format: markdown with YAML or TOML front matter.
Source: D-12-019

### EDIT-028 · Very large diffs ask before they draw
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens the diff of a very big or heavily changed file.
User sees: instead of hanging, the tab asks whether to load the full diff; confirming draws it as
  usual.
Rules: once such a diff is loaded, saving from it works normally.
Acceptance:
  - [ ] Open the diff of a generated file of 50,000 lines → a load prompt; click load → the diff
        draws.
  - [ ] After loading, edit the working side and save → the file updates on disk.
Compat: —
Source: D-12-028

### EDIT-032 · Renaming or moving a file keeps its tab and unsaved edits
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: renames a file, or drags it to another folder in the explorer, while it is open with
  unsaved edits.
User sees: the tab moves with the file to its new name and still holds the edits.
Rules: if the move runs into a name that is already taken it is reversed, and the tab stays on the
  old path; typing done while a move is still finishing is not lost; after Kolux moves a file that
  has unsaved edits, autosave waits until the new location is confirmed on disk; if the
  changed-on-disk banner was already up on that tab, it stays up after the move; a jump to a line
  that was still pending follows the file to its new place.
Acceptance:
  - [ ] Open a file, type without saving, rename it → the tab shows the new name and the edit is
        still there.
  - [ ] Rename onto a name that is already taken → nothing moves and the tab keeps the old name.
Compat: —
Source: D-12-032

### EDIT-046 · Saves are all-or-nothing, and big or binary files are handled safely
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: saves files, or opens very large or binary ones.
User sees: a save either completes or leaves the previous file whole, even if the app dies part way
  through; large text files open; binary files other than images are not shown as garbled text.
Rules: a save writes a temporary copy, flushes it to disk and swaps it into place, leaving no
  temporary file behind; text reads have an upper bound, set above the old 5 MB limit; large files
  of unknown type are sampled before they are treated as text.
Acceptance:
  - [ ] Open a 20 MB log → it opens.
  - [ ] Open a zip archive → no text view is shown.
  - [ ] Save a file, then look in its folder → no leftover temporary file.
Compat: —
Source: D-12-046

### EDIT-005 · Find and replace inside a code file
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Mod+F in a code editor, or the replace shortcut (Mod+Alt+F on macOS, Mod+H on
  other systems).
User sees: a find bar over the editor that highlights every match; the replace form adds a second
  field.
Rules: the search box takes the selection only when the user has explicitly selected text, never the
  word at the caret; a find shortcut the user has rebound is respected, and holding the key down
  does not keep reopening the bar; the first Escape closes the find bar; only a second Escape
  reaches a dialog that contains the editor.
Acceptance:
  - [ ] Select a word and press Mod+F → the box holds that word; with nothing selected → the box
        keeps the previous search.
  - [ ] In an editor shown inside a dialog, with find open, press Escape → the find bar closes and
        the dialog stays.
Compat: keybinding ids editor.find and editor.replace.
Source: D-12-005

### EDIT-009 · Merge conflicts are coloured and can be stepped through
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a file that still holds conflict markers after a merge or a rebase.
User sees: each conflict's two sides are coloured differently, and next-conflict and
  previous-conflict commands move between them, wrapping around at either end.
Rules: stepping wraps in both directions; actions on a conflicted file act on the correct worktree
  when several are open.
Acceptance:
  - [ ] Open a file with two conflicts → both are coloured; next conflict twice → back on the first.
  - [ ] From the first conflict, previous conflict → the last conflict in the file.
Compat: —
Source: D-12-009

### EDIT-013 · Rich markdown editing: slash menu, tables, lists, code blocks, toggles
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: types a slash in the rich editor, builds a table, writes lists and code blocks.
User sees: the slash menu inserts headings, tables, diagrams, maths, emoji and collapsible sections,
  narrowing as the user keeps typing; tables, lists and code blocks behave the way they do in a word
  processor.
Rules: the slash menu also matches each entry's alternative names, not just its label; in tables,
  Tab and Shift+Tab hop between cells and Enter moves down; Enter on the last row or Tab in the last
  cell adds a row, and Backspace in an empty row takes it out; rows and columns are added or removed
  from hover controls and a context menu; a new column gets an equal share of the width and goes in
  as one undo step; removing rows or columns leaves a valid table with its header row, and removing
  the only column left removes the whole table; table hover controls never block a click into a
  cell, header cells included; in lists, Tab and Shift+Tab indent and outdent, Enter continues the
  list, Enter on an empty item leaves it, and task boxes can be ticked; code blocks carry a language
  label and colouring that is redone only for the part that changed; a caret inside a code block shows the language list too, so
  the keyboard reaches it; a language the editor does not
  know can be set to plain text from the language picker; collapsible sections open and close from
  the keyboard; nested ones come back as editable sections, and nesting the editor cannot represent
  is kept as raw text, untouched; cutting or deleting empty paragraphs removes the block cleanly;
  cut with nothing selected removes the whole block at the caret: a paragraph, a list item together
  with its sub-list, or only the current visual line of a hard-wrapped paragraph; spelling
  underlines are on by default and can be switched off in settings; a greyed row in the table menu
  carries a tooltip saying why it is unavailable.
Acceptance:
  - [ ] Type /table → a table appears; press Tab in its last cell → a new row is added.
  - [ ] In a bullet list press Enter twice → the list ends and the caret sits in a plain paragraph.
  - [ ] Put the caret inside a code block → its language list shows. (unit tests; evidence/T-683.txt)
  - [x] Hover a greyed row in the table menu → its tooltip says why. (tests; evidence/T-684.txt)
Compat: —
Source: D-12-013

### EDIT-014 · Links in notes: web links, [[note]] links and line anchors
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: Mod-clicks a link in a note, types [[ to link another note, or follows a link that points
  at a line in a file.
User sees: web links open in Kolux's built-in browser, and Mod+Shift-click sends them to the system
  browser instead; [[ brings up the worktree's notes to choose from; relative links to markdown
  files open as preview tabs; line anchors open the file scrolled to that line.
Rules: line anchors are accepted as #L10, #L10C5 or :10:5, and a Windows drive letter is never read
  as a line number; heading anchors follow GitHub's slug style, and [[note#heading]] jumps to that
  heading; a [[name]] that fits more than one file is flagged rather than guessed, and a [[link]]
  never spans a line break; hovering a link in the rich editor, or moving the caret into it, shows a small bubble to open, edit or
  copy it (Escape closes it), drawn above the side panels so the explorer never hides it; a shortcut adds a link;
  reference-style links and HTML superscript citation links work like ordinary links, and reference
  definitions are folded into their links instead of showing as stray text; backslashes and forward
  slashes in a link target mean the same thing; links into a network share keep the server name; a
  file link that names localhost counts as local; in source view, [[note]] links are underlined and
  clickable too; a link with a line anchor opens the note in source view at that line, and an anchor
  into the note already open moves within that tab; links to other kinds of file, or to notes
  outside the worktree, open as normal editor tabs (at the anchored line when there is one); a link
  to a missing file shows a toast.
Acceptance:
  - [ ] In preview, Mod-click a web link → it opens in a Kolux browser tab; Mod+Shift-click → it
        opens in the system browser.
  - [ ] Click a link to a code file with a line-10 anchor → the file opens with line 10 in view.
  - [ ] Type [[ → a list of notes appears; pick one → a link is inserted and can be clicked.
  - [ ] Move the caret into a link with the arrow keys → the link bubble shows. (unit tests; evidence/T-683.txt)
Compat: link anchor forms #L<line>, #L<line>C<column> and :<line>:<column>; [[note]] link syntax.
Source: D-12-014

### EDIT-015 · Images in notes: show local pictures, paste or insert new ones
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a note that points at local images, or pastes a screenshot into the rich editor.
User sees: local images display in place; a pasted or inserted picture is saved into the worktree
  and the note gains a link to it.
Rules: screenshot names that contain spaces still link correctly; images are fetched ahead of the
  scroll position, so no empty boxes flash past; a Windows path copied out of a terminal pastes as a
  working path; an image that cannot be inserted produces an error instead of silence; pictures
  embedded inline as data are size-checked, and oversized or broken ones are not displayed.
Acceptance:
  - [ ] Paste a screenshot into a note → the picture shows and the note gains a relative link to a
        new file in the worktree.
  - [ ] Scroll quickly through a long note full of images → no blank boxes flash.
Compat: —
Source: D-12-015

### EDIT-016 · Contents panel, diagrams and maths in notes
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the contents panel beside a long note, or writes a diagram block or maths.
User sees: a side panel lists the note's headings and jumps to one on click, with heading levels
  that fold; diagram blocks (the mermaid fence) draw as diagrams; inline and block maths render.
Rules: the contents panel is offered only when the note has headings; folded heading levels are
  remembered; diagrams render in a locked-down mode that never runs scripts, with a theme that reads
  well on dark backgrounds; contents entries show the plain heading words, without markdown marks.
Acceptance:
  - [ ] In a note with five headings, open the contents and click the fourth → the note scrolls
        there.
  - [ ] A heading written in bold → its contents entry shows the words without asterisks.
Compat: —
Source: D-12-016

### EDIT-017 · Find and replace in markdown preview and rich view
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Mod+F, or the replace shortcut, in a markdown preview or rich tab.
User sees: a search bar marks matches in the rendered note, with match-case and whole-word options;
  in rich view it can also replace.
Rules: Enter and Escape still reach the input method while it is composing characters; a note opened
  from the explorer answers Mod+F without a click into it first; malformed content never breaks the
  search; it just finds nothing; replace opens with Mod+Alt+F on macOS and Ctrl+H on other systems;
  whole-word matching treats letters of every script as word letters, including characters beyond
  the basic range.
Acceptance:
  - [ ] Open a note from the explorer and press Mod+F straight away → the bar opens and searches
        that note.
  - [ ] Search a word, then tick match case → only matches with the same capitals stay marked.
Compat: —
Source: D-12-017

### EDIT-021 · Image viewer with zoom
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens an image file (PNG, JPEG and similar) and zooms with Ctrl or Cmd plus the scroll
  wheel.
User sees: the image in a tab of its own; zoom centres on the pointer and stays between fixed
  limits; a picture that cannot load produces an error message, never an empty tab.
Rules: at 100% a small picture is shown at its real size, not stretched; SVG files also count as
  text, so their source can be diffed; trackpad pinch-zoom has the same limits as wheel zoom; the header's copy button reads "Copy path" and Retry is a small button like the others.
Acceptance:
  - [ ] Open an image and zoom in with the wheel → the zoom heads toward the pointer and stops at
        the maximum.
  - [ ] Open a small icon at 100% → it shows at its real size.
  - [ ] The header's copy button reads "Copy path"; a picture that fails shows a small Retry button. (unit tests; evidence/T-683.txt)
Compat: —
Source: D-12-021

### EDIT-022 · PDF viewer keeps its zoom and position
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a PDF, zooms and scrolls, switches to another tab and comes back.
User sees: the PDF first fills the width of the tab; when the user returns, zoom and position for
  that file are as they were.
Rules: stored positions are dropped when the tab closes; a stored page beyond the end of a document
  that has since become shorter opens at its last page; a stored position that cannot be read is
  ignored; the page number in the facts bar is a box: Enter jumps to the typed page (kept inside
  the document), Escape cancels the typing, and text that is not a page number does nothing.
Acceptance:
  - [ ] Scroll to page 5, switch tabs and back → still on page 5.
  - [ ] Close the tab and open the PDF again → it starts at the top, fitted to the width.
  - [x] Type 7 in the page box and press Enter → the view jumps to page 7; type a page beyond the end → it lands on the last page; type letters → nothing moves. (tests; evidence/T-684.txt)
Compat: —
Source: D-12-022

### EDIT-030 · CI check details tab with Fix with AI
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a CI check from a pull request's list of checks.
User sees: an editor tab listing the check's steps with their status and its annotations, a button
  that copies the whole card, and Fix with AI when the check failed.
Rules: Fix with AI needs an open pull request; clicking an annotation opens that file at that line,
  but only for files inside the worktree; the tab header shows the check's name and has no path to
  copy; each check gets one tab per worktree: opening it again returns to that tab, and two checks
  with the same name never share one. (Kolux RS, T-686: the card has Refresh, and Retry beside a
  read error; its close button is named "Close the <name> check tab"; its layout comes from classes,
  not inline styles.)
Acceptance:
  - [ ] Open a failing check → its steps are listed and Fix with AI is enabled; click an annotation
        → the file opens at that line.
  - [ ] Open a check whose read failed → Retry sits beside the error and reads it again. (unit;
        evidence/T-686.txt)
  - [ ] Open the same check a second time → the existing tab comes forward instead of a new one.
Compat: —
Source: D-12-030

### EDIT-031 · Editor tab header, closing tabs, and untitled files
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: reads or copies the path in a tab's header, opens the real file from a diff, and closes
  tabs one by one or all together with Mod+Alt+W.
User sees: the header shows the full path, which can be copied, with a diff or staged marker; a diff
  offers an action that opens the actual file; when the last editor tab closes, a browser tab or the
  landing page is left on screen.
Rules: the open-file action on a diff is greyed out when the file has been deleted; All Changes
  carries its own label, but copying from it gives the worktree path; closing a new untitled file
  that was never typed in deletes it, but only when Kolux can tell which worktree it belongs to;
  otherwise the file stays on disk; the unsaved-changes dialog keeps Tab among its own buttons and keeps focus while a save runs (Escape is ignored only then); a new file made from a template is kept on close; closing a tab
  releases its memory and cached view state, and only its own: another tab whose name merely begins
  the same way is unaffected.
Acceptance:
  - [ ] Open the diff of a deleted file → the open-file action is greyed out.
  - [ ] Press Mod+Alt+W → every editor tab closes.
  - [ ] Start a new note and close it without typing → the file is gone from disk.
  - [ ] Close a tab with unsaved changes and press Tab repeatedly → focus cycles among the dialog's buttons only. (unit tests; evidence/T-683.txt)
Compat: the existing keybinding id for closing all tabs keeps working.
Source: D-12-031

### EDIT-035 · Explorer toolbar, name filter, row menus and live refresh
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the explorer's toolbar and context menu, or types into its name filter.
User sees: refresh (with a spinner), collapse all, and an overflow menu that shows or hides
  git-ignored files and dotfiles and opens the folder in other apps; the filter narrows the rows by
  name; row menus offer find in folder, open in terminal, view file, add as project and copy. The
  tree keeps up with changes on disk by itself.
Rules: git-ignored files are visible by default; find in folder opens search limited to that folder;
  add as project shows only where the folder could become a project; a burst of disk events turns
  into one refresh, and if the watcher falls behind the whole tree reloads; a project reached
  through a symlink, a Windows junction or a path in different letter case still refreshes live;
  removing a worktree stops its file watching first, including a watcher that is still starting up;
  if the watching cannot be stopped, the removal reports a failure; the live refresh skips a folder whose last read is still out; Expand all marks folders it cannot read "not readable" and says when it stopped at its folder cap; the Open in menu is keyboard-reachable (see EDIT-043); Expand all and Collapse all are double chevrons and Open in uses the rocket icon.
Acceptance:
  - [ ] Create a file from a terminal → it shows in the tree without clicking refresh.
  - [ ] Type test into the filter → only matching rows remain; the clear button brings every row
        back.
  - [ ] Expand all on a tree with an unreadable folder → that row says "not readable" and a note names the count. (unit tests; evidence/T-683.txt)
Compat: —
Source: D-12-035

### EDIT-037 · Search file contents across a worktree with Mod+Shift+F
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens search, types some text, and sets options and include or exclude patterns.
User sees: results grouped by file with a count of hits and the matching line; clicking a hit opens
  the file at that spot; a search that fails gives its reason rather than an empty result list.
Rules: by default it searches plain text, ignores case, covers hidden files and skips the git
  folder; the options are match case, whole word and regular expression; include and exclude take
  patterns separated by commas; a bare pattern matches at any depth, and a backslash before a comma
  makes it literal; the number of results is capped and the panel says when results were cut; very
  long lines are trimmed around the hit; without ripgrep it falls back to git's own search; slow
  searches time out and overly long queries are rejected; the explorer view toggles between
  searching file names and searching contents; Escape in the search box closes the search and puts focus back on the tree, and closing it does not fill the box again.
Acceptance:
  - [ ] Search todo → hits in any capitalisation; tick match case → only exact-case hits.
  - [ ] Exclude a pattern that matches test files → no test files in the results.
  - [ ] Press Escape in the search box → the search closes and the tree has focus. (unit tests; evidence/T-683.txt)
Compat: keybinding id sidebar.search.toggle; include and exclude pattern syntax as described above.
Source: D-12-037

### EDIT-039 · Desktop drops land where they are dropped
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: drags files or folders from the operating system onto different parts of Kolux.
User sees: on the project list the folder becomes a project; on a terminal the path is typed in; on
  a composer or kit input the file is attached; on an explorer folder it is copied in; anywhere else
  it opens in the editor.
Rules: drops with too many files or too many bytes are refused; drags inside Kolux carry a limited
  list of paths with no repeats; only files coming from outside Kolux count as a desktop drop, so
  dragged text, web links and moves within Kolux's own explorer are not treated as one.
Acceptance:
  - [ ] Drop a text file on the editor area → it opens as a tab.
  - [ ] Drop a folder on the project list → a new project is added.
  - [ ] Drop a file on a terminal → its path is typed at the prompt.
Compat: —
Source: D-12-039

### EDIT-042 · `kolux file` opens a file, a diff, or every changed file
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs `kolux file open`, `kolux file diff` or `kolux file open-changed` in a terminal
  inside a worktree.
User sees: the file, its diff, or all changed files open in Kolux's editor for the right worktree;
  with `--json` the command prints output meant for programs.
Rules: paths may be relative to the worktree or absolute inside it; without `--worktree` the
  worktree is taken from the current directory; diff shows unstaged changes unless `--staged` is
  given; open-changed opens diffs by default; `kolux file open-changed --mode edit` opens the files
  themselves and skips deleted ones, and `kolux file open-changed --mode both` opens both; an
  absolute path opens in the innermost worktree that contains it, so a worktree nested inside
  another wins over its parent.
Acceptance:
  - [ ] Run `kolux file open app/main.rs` in a worktree → that file opens in this worktree's editor.
  - [ ] Run `kolux file open-changed --mode edit` with one deleted and two modified files → two edit
        tabs open.
Compat: `kolux file open <path> [--worktree <selector>] [--json]`;
  `kolux file diff <path> [--staged] [--worktree <selector>] [--json]`;
  `kolux file open-changed [--mode edit|diff|both] [--worktree <selector>] [--json]`; worktree
  selectors id:, name:, branch:, issue:, path:, active and current.
Source: D-12-042

### EDIT-043 · Open a worktree or folder in another editor or the file manager
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the Open in menu on a worktree, or the explorer's overflow menu.
User sees: the apps the user has set up (VS Code out of the box) plus the system file manager;
  choosing one opens the folder there.
Rules: every launcher is offered for local folders; the list is managed in General settings: the
  user adds a ready-made preset or a custom app (a label and a launch command), and edits or removes
  rows; rows lacking a label or a command are discarded, and the list has a maximum length; an app
  with an empty command falls back to VS Code; relative or missing paths are refused, and a launch
  that fails is reported rather than ignored; the explorer's Open in menu takes focus on its first item, moves with the arrow keys, closes on Escape or a click outside, returns focus to its button and stays inside the window.
Acceptance:
  - [ ] With VS Code installed, choose Open in → VS Code → it opens the worktree folder.
  - [ ] Add a custom app with a label but no command → that row is discarded.
  - [ ] Open the explorer's Open in menu → the first app has focus; Escape closes it and focus returns to the button. (unit tests; evidence/T-683.txt)
Compat: —
Source: D-12-043

### EDIT-054 · A new markdown note starts untitled and is named on its first save
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Mod+Shift+M (or chooses new markdown from the Mod+J palette or the floating
  panel), types, then saves.
User sees: a new tab, placed last in the tab row, holding an empty note created at the worktree root
  as a markdown file named untitled (then untitled-2, untitled-3 and onwards). The first save asks
  for a name, which may include folders that are created as needed; the tab follows the file to that
  name with its text.
Rules: a new note never overwrites an existing file; if a name is taken in the meantime the next
  number is tried, and after 100 taken names creation stops with a message; the naming prompt
  rejects a name that already exists, and accepting the suggested name simply saves; a new note
  opens as an edit tab, not a preview, and starts without an unsaved marker; when a split group is
  the chosen target, the note opens there and not in whichever group is active; closing a new note
  that was never typed in deletes it (see EDIT-031); in the naming prompt, Enter on the Cancel
  button presses Cancel, and keys pressed while an input method is composing are left to it.
Acceptance:
  - [ ] Press Mod+Shift+M twice in a fresh worktree → the untitled and untitled-2 notes exist, and
        two tabs are added after the existing ones.
  - [ ] Type in a new note and press Mod+S → a name prompt; enter a name inside a folder that does
        not exist yet → the folder is created, the file moves there and the tab follows with its
        text.
  - [ ] Enter a name that already exists → the prompt shows an error and nothing moves.
  - [x] In the name prompt press Tab to Cancel, then Enter → it cancels and nothing is saved. (tests; evidence/T-684.txt)
Compat: —
Source: D-12-054

### EDIT-056 · Every file tab has a view switch, including a Changes view of uncommitted edits
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a worktree file and flips the small view switch in the tab header, for instance to
  Changes while an agent is editing it.
User sees: code files offer Edit and Changes; markdown offers Source, Rich and Changes; diagram
  files and CSV or TSV files offer their source, a rendered view and Changes; notebooks offer only
  source and rendered cells. Changes sets the last commit beside the working copy, unsaved typing
  included, and the working side stays editable.
Rules: only one view shows at a time, and the switch replaces any separate source or preview control
  on that tab; Changes compares with the last commit (uncommitted work), not with the base branch,
  and its tooltip says so; edits made in Changes count like edits anywhere else: unsaved marker,
  autosave and close prompts all apply; with nothing uncommitted, a banner says so instead of an
  empty diff; after a commit, pull or rebase done elsewhere, the committed side refreshes while the
  working side keeps its undo history; a cached Changes view in a background tab refreshes after an
  outside edit; Changes is not offered for untitled files, files outside the worktree, binary files
  or notebooks, nor on diff or conflict tabs, which already show changes; the rendered CSV or TSV
  table is read-only and is not presented as editable; PDF export is unavailable while a note shows
  Changes, and very large diffs ask before drawing just as diff tabs do.
Acceptance:
  - [ ] Open a modified code file → the switch shows Edit and Changes; pick Changes → last commit on
        one side, working copy on the other; type on the working side → the tab shows unsaved.
  - [ ] Open an unmodified file in Changes → a banner saying there is nothing uncommitted, not a
        blank diff.
  - [ ] Open a notebook → no Changes option; open an untitled note → no Changes option.
  - [ ] Commit the file from a terminal while Changes is open → the committed side updates and undo
        still works on the working side.
Compat: —
Source: D-12-056

### EDIT-057 · Formatting toolbar above the rich markdown editor
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a note in rich view and clicks a toolbar button instead of typing markdown or using
  the slash menu.
User sees: a thin toolbar above every note in rich view with buttons for body text, headings 1 to 3,
  bold, italic, strikethrough, bullet list, numbered list, checklist, quote, link and image, each
  named in a tooltip on hover. A More blocks menu adds headings 4 and 5 and a collapsible section. A
  click applies to the current selection or block.
Rules: the toolbar is there whenever a note is in rich view, and absent in source and in the
  read-only preview; clicking a button never pulls focus out of the text, so caret and selection
  stay where they were; heading, list, checklist and quote buttons toggle: a second press on the
  same block turns it back into body text; Link uses the same link editing as the add-link shortcut,
  and Image the same picker as inserting an image; a list started from the toolbar behaves like any
  other list: Enter on its empty last item ends it and leaves a plain paragraph; for now the buttons
  do not light up to show formatting already active at the caret.
Acceptance:
  - [ ] Open a note in rich view → the toolbar sits above the text; switch the tab to source → the
        toolbar is gone.
  - [ ] Select a word and click Bold → the word turns bold, the selection is unchanged and typing
        carries on in the note.
  - [ ] Click Numbered list, type one item and press Enter twice → the list ends and the caret is in
        a plain paragraph.
  - [ ] Open More blocks → Heading 4, Heading 5 and a collapsible section are offered; choosing the
        section inserts a collapsible block.
Compat: —
Source: D-12-057

### EDIT-008 · Huge pastes keep the window responsive or are turned away
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: pastes a very large block into the code editor or the rich markdown editor, or uses Paste
  from the context menu.
User sees: large pastes arrive in chunks while the window keeps responding; anything past the hard
  limit is refused with a toast instead of freezing the app.
Rules: context-menu Paste acts like the keyboard paste, including whole-line pastes (text copied
  with no selection) and multi-cursor pastes when that editor option is on; read-only editors are
  never pasted into; the rich markdown editor applies the same size limit.
Acceptance:
  - [ ] Paste a few megabytes of text → the window keeps responding and the text lands.
  - [ ] Paste more than the limit → a toast explains the refusal and the buffer is unchanged.
Compat: —
Source: D-12-008

### EDIT-006 · Word wrap, editor font, zoom and minimap
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Alt+Z, picks an editor font, zooms, or turns on the minimap.
User sees: long lines either wrap or scroll sideways; the chosen font is used; editor text grows or
  shrinks; with the minimap on, a miniature of the file sits on the right.
Rules: wrapping is on by default and Alt+Z flips it; with no editor font chosen the editor borrows
  the terminal font, and with neither chosen it uses a monospace fallback; editor text size tracks
  zoom inside fixed limits, and diff editors draw slightly smaller than edit tabs; the minimap
  starts off; notebook cells use the editor font, then the terminal font, then the app's interface
  font.
Acceptance:
  - [ ] Fresh profile → long lines wrap; press Alt+Z → they scroll sideways instead.
  - [ ] Change the terminal font while no editor font is set → the editor font follows.
Compat: the existing keybinding id for toggling word wrap keeps working.
Source: D-12-006

### EDIT-010 · Colouring for Astro, Svelte, Vue, Nim and JSON Lines files
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens an Astro, Svelte, Vue, Nim or JSON Lines file.
User sees: the file is coloured as its own language, on top of the languages the editor knows out of
  the box.
Rules: script and style sections inside component files are coloured in their own languages; JSON
  Lines is read as one JSON value on each line.
Acceptance:
  - [ ] Open a Svelte component → script, markup and style are each coloured.
  - [ ] Open a JSON Lines file → every line is coloured as JSON.
Compat: file formats: Astro, Svelte, Vue, Nim, JSON Lines.
Source: D-12-010

### EDIT-011 · File-type icons and natural name order
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: browses files in the explorer, in tabs or in search results.
User sees: an icon that fits each file's type; folders above files; numbered names in the order a
  person expects (2 before 10).
Rules: a well-known whole file name, such as a lock file or a config file, decides the icon before
  the extension does, and multi-part extensions are recognised; anything still tied after natural
  ordering is settled the same way every time, never by the order on disk.
Acceptance:
  - [ ] A folder holding file1, file2, file10 and a subfolder → the subfolder first, then file1,
        file2, file10.
  - [ ] A package-manager lock file shows its own icon rather than the generic one for its
        extension.
Compat: —
Source: D-12-011

### EDIT-018 · Export a note to PDF
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: picks PDF export from a markdown tab's actions menu.
User sees: a PDF of the rendered note, pictures included.
Rules: pictures held only in memory are embedded so they appear in the PDF; a note with no title is
  exported under the name Untitled; Export cannot start a second time while one is running.
Acceptance:
  - [ ] Export a note holding a pasted picture → the PDF shows the text and the picture.
  - [ ] Export a note with no title → the PDF is named Untitled.
  - [ ] Press Export twice quickly → one PDF is made. (evidence/T-684.txt; code guard only, no unit test)
Compat: —
Source: D-12-018

### EDIT-023 · CSV and TSV files shown as a table
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a CSV or TSV file.
User sees: the rows and columns laid out as a grid.
Rules: the separator is worked out from the content; a byte-order mark at the start is ignored;
  quoted fields that hold commas or line breaks stay in one cell.
Acceptance:
  - [ ] Open a CSV file separated by semicolons → columns split on the semicolons.
  - [ ] A quoted field that contains a comma → it stays in a single cell.
Compat: file formats: CSV and TSV.
Source: D-12-023

### EDIT-024 · Jupyter notebooks: edit cells and run Python
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a notebook, edits, adds, deletes or reorders cells, and runs a Python cell.
User sees: cells as code and markdown blocks; running a cell first asks whether the notebook is
  trusted, saves it, then shows the output under the cell and stores it in the notebook.
Rules: a notebook that is not trusted never runs; multi-line cell source is kept exactly; very long
  cells, or cells with a great many lines, show a limited preview so the view never locks up; cells
  can be added, removed and switched between code and markdown, and notebook details the viewer does
  not display are kept when saving; removing a cell that has text or saved output asks first
  ("Remove cell N?") and removes nothing if the notebook changed under the question, while an
  empty cell goes at once.
Acceptance:
  - [ ] Open a notebook and run a cell that prints → trust prompt; accept → output shows and is
        saved into the file.
  - [ ] Decline the trust prompt → nothing runs and no output is written.
  - [x] Remove a cell holding code → a question asks first; Remove takes it out, Cancel keeps it; an empty cell goes with no question; if an agent rewrote the file meanwhile, nothing is removed and a note says so. (tests; evidence/T-684.txt)
Compat: file format: Jupyter notebook (cells, their source, their outputs).
Source: D-12-024

### EDIT-025 · Preview an HTML file in the built-in browser
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens an HTML file, or its diff against the working tree, and asks for a preview.
User sees: the page rendered in a Kolux browser tab beside the source.
Rules: offered on edit tabs, and on diffs only while the file still exists on disk.
Acceptance:
  - [ ] Open an HTML page and choose preview → a browser tab shows it rendered.
  - [ ] Open the diff of an HTML file that has been deleted → no preview is offered.
Compat: —
Source: D-12-025

### EDIT-026 · Follow a growing log file live
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks View Log on a session row in AI Vault.
User sees: a read-only tab that keeps adding lines as the log grows.
Rules: a partly written line is held back until it is complete; if the log is rotated or cut short,
  the view starts again from the top.
Acceptance:
  - [ ] Append lines to the log from a terminal → they show in the tab within a second.
  - [ ] Empty the log file → the view reloads from the start.
Compat: —
Source: D-12-026

### EDIT-038 · Search the worktree for what is selected in the editor
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: selects text, or rests the caret on a word, and starts a file search.
User sees: the search panel opens with the selection, or the word at the caret, already entered.
Rules: a selection spanning several lines is collapsed onto one line for the query.
Acceptance:
  - [ ] Caret on a function name, start a file search → the name is already in the box and results
        show.
  - [ ] Select three lines and start a search → the query is a single line.
Compat: —
Source: D-12-038

### EDIT-048 · Search in the repository and base-branch pickers
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: types into the repository picker or the base-branch picker.
User sees: a filtered list of repositories or branches, kept to a manageable length.
Rules: the number of results is limited, so large organisations and long branch lists stay
  responsive; Down from the box enters the suggestions, the arrows, Home and End walk them, and
  Escape or a click returns focus to the box.
Acceptance:
  - [ ] Type part of a branch name in the base picker → the matching branches are listed.
  - [ ] In a repository with thousands of branches → the filtered list appears without a noticeable
        pause.
  - [x] Type in the picker, press Down, then the arrows → the suggestions take focus and are walked in order; Escape goes back to the box. (tests; evidence/T-684.txt)
Compat: —
Source: D-12-048

### EDIT-049 · Settings search stays responsive
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Mod+F on the settings screen and types.
User sees: the settings narrow to matching entries while typing goes on, without lag.
Rules: filtering runs after a short pause in typing; while searching, only the active settings page
  is drawn; emptying the box shows every setting again at once, without waiting for the pause.
Acceptance:
  - [ ] Type fast into settings search → no keystrokes are lost and the results match.
  - [ ] Clear the box → all settings come back immediately.
Compat: keybinding id settings.search.
Source: D-12-049

### EDIT-050 · Project picture taken from an icon file in the repository
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: adds a project whose repository holds a favicon or logo image.
User sees: that image used as the project's icon.
Rules: only recognised icon file names and image formats are used.
Acceptance:
  - [ ] Add a repository that has a favicon → the project row shows it.
  - [ ] Add a repository whose only image has an unrelated name → no picture is taken from it.
Compat: —
Source: D-12-050

### EDIT-055 · New notes can start from the repository's own templates
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: keeps markdown templates in the repository's templates folder for Kolux, then creates a
  new note.
User sees: before the note is made, a picker lists Blank and each template by a readable name. A
  template fills the new note with its text, with placeholders for title, date, time, date and time,
  and file name filled in; cancelling makes nothing.
Rules: only markdown files count as templates; subfolders are searched, while symlinks and
  dependency folders are skipped; a template's display name comes from its file name, turned into
  words with a capital first letter; placeholders may have spaces inside the braces; dates are
  written year-month-day and times as 24-hour hours and minutes; placeholders Kolux does not know
  are left as typed; with no templates folder there is no picker, and a blank note is made; a note
  made from a template is kept on close even if it was never edited; if reading the templates
  folder takes more than a moment, the picker area says "Looking for note templates..." until the
  list is ready.
Acceptance:
  - [ ] Put two templates in the folder → Mod+Shift+M shows a picker with Blank and both names.
  - [ ] A template holding a date placeholder → the new note shows today's date as year-month-day.
  - [ ] Remove the folder → Mod+Shift+M makes a blank note with no picker.
  - [ ] Pick a template and close the note without typing → the file stays on disk.
  - [x] Open Mod+Shift+M on a slow folder read → after about 0.4 s a "Looking for note templates..." line shows, and not at all when the answer is instant. (tests; evidence/T-684.txt)
Compat: templates are read from a templates folder inside a hidden folder at the repository root
  that has the same name as the `~/.kolux` folder; reading the same place keeps existing templates
  working.
Source: D-12-055

### EDIT-051 · Editing, searching and downloading files on remote hosts
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opened, searched, watched and downloaded files in an SSH or remote-runtime worktree.
User sees: remote files behaving like local ones; a download asked where to save and copied the file
  down.
Rules: all remote file traffic went through a connection belonging to each host.
Acceptance:
  - [ ] A fresh build offers no way to open or download files on a remote host.
  - [ ] The item is listed under Dropped in DECISIONS.md with its date and reason.
Compat: —
Decision: default cut: area 18 remote hosts and runtimes are dropped. Revive via DECISIONS.md.
Source: D-12-051

### EDIT-052 · Simulator palette search
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: searched the list of iOS and Android simulators to open one in a pane.
User sees: simulators matching by name, platform or version.
Rules: none beyond those of the dropped emulator pane.
Acceptance:
  - [ ] A fresh build has no simulator palette.
  - [ ] The item is listed under Dropped in DECISIONS.md with its date and reason.
Compat: —
Decision: default cut: area 18 mobile emulator pane is dropped. Revive via DECISIONS.md.
Source: D-12-052

## Dropped by default (tier D)

- EDIT-051 · Editing, searching and downloading files on remote hosts — area 18 (remote hosts and runtimes) is dropped.
- EDIT-052 · Simulator palette search — area 18 (mobile emulator pane) is dropped.

## Hidden or retired (tier H)

None in this area: nothing here is behind a flag that is off by default, dev-only or retired.
There are no X cards either: the file-type icons and the Open in launchers use generic
pictures, not other products' logos.
