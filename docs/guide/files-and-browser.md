# Files and web pages

Open, edit and review a workspace's files without leaving Kolux; web pages open in your own browser. Each file is a tab in the same grid as your terminals; open a note with Ctrl+Shift+M or Ctrl+Shift+O, and a file from disk with the file finder (see [Terminals](terminals.md)).

## Open a file

| To do this | Use |
|---|---|
| Find a file in this workspace by name | Ctrl+P ("Go to File") |
| Pick any single file on your computer | The file finder, "File..." |
| Pick from the workspace's Markdown files | Ctrl+Shift+O, or "Open markdown tab" |
| Start a new Markdown note in the workspace | Ctrl+Shift+M, or "New markdown tab" |
| Browse the workspace as a tree | Ctrl+Shift+E (the Explorer) |

The pickers filter as you type. Arrow keys move, Enter opens, Esc closes. If the workspace has none, you see "This workspace has no files." (or "markdown files", or "changed files", for those pickers). These items need an open workspace; otherwise Kolux says, for example, "Open a workspace to find a file in it." or "Open a workspace to pick one of its changed files."

A file you pick with "File..." is the only thing Kolux grants access to. See [Safety](safety.md).

## Edit and save

Each file opens in its own tab, coloured by language. Ctrl+S saves. The same file open in two panes shares one text, so edits show in both.

- A small dot on the tab means "Unsaved changes". It means the text differs from the file on disk by more than trailing spaces.
- Ctrl+W closes the tab. Closing the whole window with unsaved text asks first: Keep working, or Quit without saving.
- Ctrl+F finds text in the editor. Your editor font follows Settings, Appearance, "Editor font".
- A file that will not open is tried three times, then the tab says "<name> did not open: <error>" with a **Retry** button. If the reason is that the file is outside your projects, an **Open this file anyway** button grants that one file for this session.
- A failed save shows "<name> was not saved: <error>" and keeps the unsaved dot.

### If the file changed under you

While a file is in front of you, Kolux checks every two seconds (and whenever you come back to the window) whether an agent or another program changed it.

- **No unsaved edits in the tab:** the tab quietly takes the new copy from disk.
- **Unsaved edits in the tab:** a banner says "<name> changed on disk. Your unsaved edits are still here." Nothing is lost until you choose.

| Button | What it does |
|---|---|
| Reload | Takes the disk copy. A note "Reloaded <name> from disk." offers **Undo**, and Ctrl+Z also brings your edits back |
| Keep my edits | Hides the banner until the file changes again. Your next save is still checked (below) |
| Compare | Shows the disk copy on the left and your text on the right, with Reload, Keep my edits and Close |

A tab in the background is checked when you bring it forward. Your own save never sets off the banner, because Kolux does not check a file while it is saving it. Once the file matches your text again, or you reload, the banner goes away by itself.

The save itself is the real safety check. If the file changed after you opened it, the save is refused and the tab says "<name> changed on disk since you opened it, so it was not saved."

| Button | What it does |
|---|---|
| Reload | Shows the disk copy and drops your unsaved edits |
| Keep mine | Saves your text over the disk copy |

If reloading fails, the tab says "<name> did not reload: <error>".

### Markdown

Markdown files open in a **Rich** view that shows headings, lists and links as formatted text. Switch to **Source** to see the raw text. A file over 600 KB opens in Source with a banner and an **Open anyway** button. A file the rich view cannot show faithfully (for example one with underlined headings or horizontal rules) opens in Source too, with the reason. A "Markdown preview" tab (Ctrl+Shift+V) shows a read-only rendering beside the editor.

### Copy with context and review notes

- **Copy Context** (Ctrl+Alt+C) copies your selection with its file path and line range, ready to paste into an agent. The editor says "Copied with path and lines".
- **Review notes:** select text and press Ctrl+Shift+A to leave a note for an agent. The switch is in Settings, General, Review notes. See [Reviewing changes](projects-and-worktrees.md#reviewing-changes).

## The Explorer

A tree of the workspace's files in a panel on the right. Ctrl+Shift+E shows or hides it. It re-reads the folders when the window regains focus, so files made outside Kolux show up without a button.

| To do this | Do this |
|---|---|
| Move the highlight | Arrow keys, Home, End |
| Open a folder or step into it | Right arrow |
| Fold a folder or climb to its parent | Left arrow |
| Open a file | Enter or click |
| Select several rows | Ctrl-click or Shift-click |
| New file, new folder | The two buttons in the Explorer's header |
| Rename in place | F2, then Enter to keep the name or Esc to cancel |
| Delete | Delete key. Moves to the trash after one question (on a WSL share it deletes for good and says so) |
| Undo, redo a file operation | Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y |
| Copy the path | Alt+Shift+C; with Ctrl+Alt+Shift+C you get the relative path |
| Copy files | Ctrl+C then Ctrl+V into a folder. A taken name gets " copy" |
| Move files | Drag rows onto a folder |
| Add files from your desktop | Drop them on a folder; they are copied |

If a folder cannot be read, the panel says "The folder did not load: <error>" with a Retry button.

### Projects stored in WSL

A project that lives inside a WSL distribution (its path starts with `\\wsl.localhost\<distribution>\` or `\\wsl$\<distribution>\`) follows three rules of its own. Searching its text runs ripgrep inside that distribution, so ripgrep has to be installed there (`sudo apt install ripgrep` in Ubuntu); if WSL or ripgrep is missing, the search says so instead of finding nothing. A file opened through its WSL path and through its Windows drive alias (`\\wsl.localhost\Ubuntu\mnt\c\work\a.ts` and `C:\work\a.ts`, or the `wsl$` and `wsl.localhost` spellings of one path) is one file: the two tabs share one text and one unsaved marker, while names inside the Linux file system stay case-sensitive, so `notes.md` and `Notes.md` are two files there. All Changes reads such a project's changes every 4 seconds instead of watching its folder, so a change never goes unnoticed when the distribution cannot hold a watch. For now Kolux still refuses to open files under a `\\wsl.localhost` or `\\wsl$` path, the way it refuses any path on another computer, so these rules take effect only once that refusal is lifted; they have not yet been tried against a real distribution.

## See what changed

Two tabs show a workspace's uncommitted changes:

- **Diff** (a file opened as a diff tab from All Changes) shows one file's changes. Choose **Inline** or **Side by side**. F7 and Shift+F7 jump to the next and previous change. The "Diff actions" menu has "Show whitespace changes" and "Wrap lines". A tag shows whether you are looking at Staged or Unstaged changes.
- **All Changes** shows every changed file in one scrolling view, with a file list beside it. Filter that list by name. "Viewed" marks a file you have read. It says "This workspace has no changes." when there is nothing. Each file shows its Before and After text.

In All Changes, **Compare** picks what the changes are measured against: **Working tree** (what you have not committed yet) or **Branch vs** its base, for example "Branch vs main" (everything this branch changed since it left that branch, committed or not). Side by side, Wrap, Whitespace and the file tree button change the view, and **Make default** makes new All Changes tabs start with that layout. Each file has a button that opens it as a diff tab.

A commit box shows under the header. It commits only what is staged (the button says, for example, "Commit 3 staged"); use Stage all or a file's Stage button first. If a Git hook refuses the commit, it says "A project check stopped this save. See why below." with the check's output. The tab reads the staged files once when it opens, so the Commit button knows its count at once instead of after the next update.

When Compare is set to the branch and the branch shares no history with its base (an unrelated branch, or a shallow copy cut before the two split), a hint line at the top says "vs <base> tip: no common ancestor found", and the changes are measured against the base's latest commit. If the branch has no commits yet, or the base no longer exists, the tab says so instead of showing a comparison. Keeping the branch view up to date no longer runs a second Git status each time, so a busy workspace costs less.

Diff lines also take review notes ("What should change here?"). A note needs some text; to remove one, use the bin on its card. Staging, committing and discarding are in [Projects and folders](projects-and-worktrees.md).

## Web pages

Kolux no longer shows web pages inside its own window (Txais, 2026-11-12: this frees memory so the PC can run more agents). A web address opens in your own browser, Chrome or whatever Windows uses by default: a link in a terminal, a port in the Ports list, a review link in Checks, an HTML preview and a link in a chat all go there. Agents use that browser for the web too.

## Artifacts

The Artifacts library holds only what its viewer can show in the app: **HTML pages, images and videos**. A text or markdown file, a CSV or JSON file, a Word or Excel document, a PDF and an audio file are not artifacts. The `artifacts/` folder of an open workspace is imported automatically (and watched every 3 seconds) for those three kinds only, and **Add artifact** refuses anything else with a sentence naming the file. A page counts as one entry with the files it points to beside it, so it still loads its own pictures, fonts, audio or data offline.

**A link in a page asks first.** A page runs its own script, so a click that leaves the page never opens your browser by itself: Kolux shows a strip above the viewer, `Open example.com?`, naming the address's host (for a mail address, the address without any `?body=`), and the browser opens only when you click **Open** there, once, for exactly that address. Open is disabled for the first second, so a click meant for the page cannot land on it; **Cancel** closes the question, and after three Cancels in a row that page stops asking until you pick it again.

<!-- verified against: src/scm/split.ts, src/chrome/LayoutStrip.tsx, src/keys/actions.ts, src/App.tsx, src/open/openExternal.ts, src-tauri/src/scm.rs at 6f0c159a -->
