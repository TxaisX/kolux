# Files and browser

Open, edit and review a workspace's files without leaving Kolux, and keep a web page in a tab beside your terminals. Each of these is a tab in the same grid as your terminals; open them from the New tab menu in the layout strip (see [Terminals](terminals.md)).

## Open a file

| To do this | Use |
|---|---|
| Find a file in this workspace by name | Ctrl+P ("Go to File") |
| Pick any single file on your computer | New tab menu, "File..." |
| Pick from the workspace's Markdown files | Ctrl+Shift+O, or "Open markdown file..." |
| Start a new Markdown note in the workspace | Ctrl+Shift+M, or "New markdown file" |
| Browse the workspace as a tree | Ctrl+Shift+E (the Explorer) |

The pickers filter as you type. Arrow keys move, Enter opens, Esc closes. If the workspace has none, you see "This worktree has no files." These menu items need an open workspace; otherwise Kolux says "Open a workspace to pick one of its changed files" and similar.

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
- **Review notes:** select text and press Ctrl+Shift+A to leave a note for an agent. The switch is in Settings, General, Review notes. Notes can be sent to the agent from Source Control. See [Projects and worktrees](projects-and-worktrees.md).

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

A project that lives inside a WSL distribution (its path starts with `\\wsl.localhost\<distribution>\` or `\\wsl$\<distribution>\`) follows three rules of its own. Searching its text runs ripgrep inside that distribution, so ripgrep has to be installed there (`sudo apt install ripgrep` in Ubuntu); if WSL or ripgrep is missing, the search says so instead of finding nothing. A file opened through its WSL path and through its Windows drive alias (`\\wsl.localhost\Ubuntu\mnt\c\work\a.ts` and `C:\work\a.ts`, or the `wsl$` and `wsl.localhost` spellings of one path) is one file: the two tabs share one text and one unsaved marker, while names inside the Linux file system stay case-sensitive, so `notes.md` and `Notes.md` are two files there. Source Control reads such a project's changes every 4 seconds instead of watching its folder, so a change never goes unnoticed when the distribution cannot hold a watch. For now Kolux still refuses to open files under a `\\wsl.localhost` or `\\wsl$` path, the way it refuses any path on another computer, so these rules take effect only once that refusal is lifted; they have not yet been tried against a real distribution.

## See what changed

Two tabs show a workspace's uncommitted changes:

- **Diff** (New tab menu, "Changed file diff...") shows one file's changes. Choose **Inline** or **Side by side**. F7 and Shift+F7 jump to the next and previous change. The "Diff actions" menu has "Show whitespace changes" and "Wrap lines". A tag shows whether you are looking at Staged or Unstaged changes.
- **All Changes** shows every changed file in one scrolling view, with a file list beside it. Filter that list by name. "Viewed" marks a file you have read. It says "This worktree has no changes." when there is nothing. Each file shows its Before and After text.

In All Changes, **Compare** picks what the changes are measured against: **Working tree** (what you have not committed yet) or **Branch vs** its base, for example "Branch vs main" (everything this branch changed since it left that branch, committed or not). Side by side, Wrap, Whitespace and the file tree button change the view, and **Make default** makes new All Changes tabs start with that layout. Each file has a button that opens it as a diff tab, in the split Source Control's "Open diffs in" names.

While Compare is set to the branch, a commit box shows under the header. It commits only what is staged (the button says, for example, "Commit 3 staged"); stage files in Source Control. If a Git hook refuses the commit, it says "Commit blocked by a hook" with the hook's output. The tab reads the staged files once when it opens, so the Commit button knows its count at once instead of after the next update.

When Compare is set to the branch and the branch shares no history with its base (an unrelated branch, or a shallow copy cut before the two split), a hint line at the top says "vs <base> tip: no common ancestor found", and the changes are measured against the base's latest commit. If the branch has no commits yet, or the base no longer exists, the tab says so instead of showing a comparison. Keeping the branch view up to date no longer runs a second Git status each time, so a busy workspace costs less.

Diff lines also take review notes ("What should change here?"). A note needs some text; to remove one, use the bin on its card. Staging, committing and discarding are in [Projects and worktrees](projects-and-worktrees.md).

## Browser tabs

Open a web page beside your terminals, for example your app running locally. New tab menu, "Browser", or Ctrl+Shift+B.

| To do this | Do this |
|---|---|
| Go to a site | Type in the **Address** box and press Enter |
| Focus the address box | Ctrl+L |
| Back, forward | Alt+Left, Alt+Right (or the buttons) |
| Reload, stop | Ctrl+R; the Stop button while a page is loading |
| Close the tab | Ctrl+W |

What the address box understands:

| You type | Kolux does |
|---|---|
| `https://...` or `http://...` | Opens it |
| `localhost:3000` or `127.0.0.1:5173` | Opens it over http |
| `example.com` (looks like a domain, no spaces) | Opens it over https |
| Anything else | Searches the web with Google |
| A file path, `file:`, or another kind of link such as `mailto:` | Refuses: "a browser tab opens web pages only (http or https)" |

A browser tab never opens local files, so a page cannot reach the app's own tools. Pages stay loaded when you switch to another tab and back. There is no choice of search engine; the setting was removed.

In a narrow browser pane (under about 360 pixels wide) the Address box folds up into a small box so the buttons keep their room. Click it (or press Ctrl+L) and it opens across the whole toolbar while you type; the buttons stay where they were, hidden under it. Click away and it folds up again.

While a page is loading, the tab shows your app's colour (dark in a dark theme, light in a light theme) instead of a white flash. If you change the theme, the next page you load follows the new colour.

### Find, zoom and the site icon

| To do this | Do this |
|---|---|
| Find text on the page | Ctrl+F. A find bar opens under the toolbar. Enter goes to the next match, Shift+Enter to the previous one (the two arrow buttons do the same), Escape closes it |
| Zoom in, out | Ctrl+= and Ctrl+-, or Ctrl with the mouse wheel (one step per wheel burst) |
| Back to 100% | Ctrl+0 |

Each browser tab keeps its own zoom. A small badge in the toolbar shows the level for a moment after each change. The steps run from 25% up to 500% (25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500). The level stays when the page reloads or moves to another site. In a browser tab these keys zoom the page, not the app. Find uses the page's own find, so a page could in principle see what you search for.

The globe in a browser tab's toolbar becomes the site's own icon once Kolux has fetched it. The icon stays while you move within one site and goes when you move to another. It shows in the toolbar only; the tab strip keeps its usual mark.

### Links that open new tabs

A link a page opens in a new window (a `_blank` link or a script) becomes another Kolux browser tab. You can also open a link as a tab yourself:

| To do this | Do this |
|---|---|
| Open a link in a new tab behind this one | Middle-click it, or Ctrl-click it |
| Open it in front | Shift with either of the above |

A tab opened by a page comes to the front only if the page's own tab is on screen. Only web addresses (http or https) open this way. A download link, or a link the page itself handled, is left to the page.

**A limit on pages opening tabs.** To stop a page from filling your window with tabs, all browser pages share one allowance: 5 new tabs in any 10 seconds, whether they come from new-window requests or from link opens. Extra ones are quietly dropped, with no message, and the allowance fills up again as the 10 seconds pass. Because it is shared, a page that is spamming can use it up and your own real clicks in other tabs may be dropped for those seconds. An address Kolux refuses (see above) takes nothing from the allowance. A per-tab allowance and a "popups blocked" note are planned.

### Site icons and the local network

Kolux itself fetches a page's icon, so it keeps this narrow. An icon is accepted only if it is an image of modest size (up to 256 KB), and a fetch takes at most 5 redirects and 8 seconds. A redirect is refused if it goes from https down to http, or to somewhere the tab itself may not go. A page on the public web cannot point its icon at your own machine or home network: addresses such as `localhost`, `127.0.0.1`, `192.168...`, `10...`, names ending `.local` or `.lan`, or a plain name with no dot are refused for icons unless the page is on that same host. A page you open on `localhost` can still show its own icon. Your tab can still go to `localhost`; the rule only guards what Kolux fetches for a page.

## Not available

"Grab page element" and hard reload have keys listed on the Shortcuts page, but they do nothing yet in this version. Use Ctrl+R to reload.

<!-- verified against: src/editor/EditorPane.tsx, src/editor/DiskBanner.tsx, src/editor/diskChange.ts, src/editor/DiffPane.tsx, src/editor/AllChangesPane.tsx, src/scm/split.ts, src/editor/Explorer.tsx, src/editor/FilePicker.tsx, src/editor/PreviewPane.tsx, src/editor/markdown.ts, src/browser/BrowserPane.tsx, src/browser/address.ts, src/chrome/LayoutStrip.tsx, src/keys/actions.ts, src/App.tsx, src/browser/colour.ts, src/browser/browser.css, src/browser/zoom.ts, src/browser/site.ts, src-tauri/src/browser.rs, src-tauri/src/scm.rs at 5f3b287 -->
