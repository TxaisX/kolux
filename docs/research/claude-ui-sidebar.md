# Claude's left sidebar, seen as a user (design note)

Method: claude.ai in Chrome, observe/hover/open-menu only, 2026-11-02 (small viewport, about 1570x770, dark theme).
Public docs: support.claude.com and web search. No app files, bundles or sources were read.
Source tags: [web] = seen on claude.ai 2026-11-02. [docs] = public page. [report] = third-party user reports, unofficial.
Not observed: Claude Desktop itself (not installed in this session), narrow-width behavior, delete confirmation text.

## 1. What the sidebar holds and leaves out

- Top strip: app name, a collapse toggle, and two small mode buttons (chat / code). [web]
- One primary action, "New", then a short run of destination rows: Search, Projects, Artifacts, Scheduled, Design, Customize. Each is an icon plus a one-word label. [web]
- One content section, "Recents", with a small filter control at its right edge. Rows are plain titles; a few carry a tiny trailing glyph (an attachment/artifact hint). [web]
- Footer: one account button (avatar, first name, plan) and one small icon at the right. The account menu holds Settings, Usage, Language, Get help, plans, apps and extensions, a "Learn more" submenu, API keys, Log out. [web]
- Left out on purpose: no terminals or live-process list, no update button, no status or usage widgets in the pane (usage lives in the account menu; the usage nag sits in the main area, dismissible with an X), no per-row badges beyond one small glyph, no nested trees in Recents. [web]
- Settings and help are one hop away in the footer menu instead of being rows. [web]

## 2. Removing, hiding, archiving, renaming

- Rows look bare at rest. On hover, a three-dot button appears at the row's right edge and the row gets a subtle highlight. [web]
- Clicking the dots or right-clicking the row opens the same menu, so there is one menu for both gestures. [web]
- Menu items: Mark as unread, Pin, Rename, Add to project (submenu), Move to group (submenu), Archive, Delete. Each shows a single-letter shortcut on the right. Delete is red and last, separated from Archive. [web]
- Archive is the soft, reversible path and sits above the destructive Delete. Rename is in the menu, not an inline pencil. [web]
- Not observed: wording of the delete confirmation and whether an undo toast appears (I did not click Delete). Help-center pages describe archived chats being recoverable, unverified here. [web, gap]
- Escape closes the menu with no side effects. [web]

## 3. Narrow behavior

- The whole pane can be collapsed with the toggle at its top-left; the main area then fills the window and only the toggle (and a small icon at the far right) remain. Toggle again restores the same state. [web]
- Long row titles are cut with an ellipsis at the pane edge; the hover dots take space on the right instead of pushing text. [web]
- The list scrolls inside the pane (a thin scrollbar at its edge); the top destinations and the footer stay put, so the footer is always reachable. [web]
- The footer is compact: avatar, short name, plan label, with a menu that opens upward over the list. [web]
- Not observed: dragging the pane width, a min/max width, an icon-only rail, or tooltips on truncated titles. [web, gap]

## 4. How updates are announced

- claude.ai in the browser has no update concept (it is the web). [web]
- The official install article covers Linux only: the desktop app does not update itself there and updates come through the package manager (apt). It does not describe Windows/macOS notices. https://support.claude.com/en/articles/10065433-installing-claude-desktop [docs]
- Third-party reports describe a "Restart for update" style prompt/banner on the desktop app, and some Windows builds updating silently and relaunching. Several reports complain that a restart can interrupt running sessions. Treat as unofficial. [report]
- Takeaway: the notice is a prompt that appears when an update is staged, with the user's restart as the apply step. The official wording was not found. [docs gap]

## 5. Recommendations for the Kolux RS left pane (our own design)

1. Keep the pane to two kinds of rows, projects and their workspaces; everything else (terminals, settings, help, updates) moves to the footer menu or the main area.
2. Give every row one hover-only "more" button plus a right-click menu that opens the identical list, so removal works the same by mouse and by keyboard.
3. Put Remove last in the menu, in red, below a divider, and put a reversible Hide/Archive above it; follow removal with a short undo toast instead of a modal.
4. Show a single-letter shortcut beside each menu item so power users can act without opening the pane's menus twice.
5. Truncate names with an ellipsis, reserve the hover-button space so text never jumps, and show the full name in a tooltip after a short delay.
6. Let the pane collapse fully from a toggle at its top and restore to the previous width; clamp width to 220-480 px, and below 900 px window width collapse by default.
7. Make the list the only scrolling region; pin the footer (account/app menu) so it is never cut off at any window size.
8. Replace "Check for updates" with a small dismissible notice in the footer or main area when an update is ready, with "Restart to update" as the single action, and warn first if agents are running.
