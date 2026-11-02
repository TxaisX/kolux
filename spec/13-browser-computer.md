# 13 · Browser pane & computer use

A browser tab is a full web page that lives in the same split layout as the terminals of a
worktree, so the user can watch a local dev server, read docs or sign in to a site without leaving
Kolux. Pages keep their state while hidden, recover by themselves from failed loads and crashes,
come back after a restart, and give memory back when their worktree has not been visited for a
while. A Preview button opens a workspace's running dev server in one click. The address bar
opens sites, runs web searches and suggests pages from history. A toolbar
menu holds session profiles with separate logins, cookie importing from installed browsers, and
phone, tablet and laptop viewport sizes. The user can pick an element on a page, mark it up or
annotate it, and hand the result to an AI agent with secrets scrubbed out. Agents can drive the
visible tab of their worktree through `kolux` commands (tabs, profiles, navigation, element
actions, cookies, storage, request interception, logs, emulation, dialogs, the clipboard and the
mouse), through a local endpoint that only Kolux's own tools can reach. Computer use (agents
driving other desktop apps) and the browser settings page are dropped by default.

Tier counts: P0 7 · P1 36 · P2 11 · H 0 · X 0 · D 13
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes ·
04 Agent status, hooks & notifications · 05 Views & navigation · 08 Orchestration · 10 Plan review &
protected actions · 11 Git, source control & review · 12 Editor & files · 16 Onboarding & guidance ·
17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations ·
20 The `kolux` CLI

## Cards

### BROW-001 · Open a browser tab next to the terminals
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: in a worktree, presses Mod+Shift+B or uses the new-tab control to add a browser tab.
User sees: a tab titled New Tab appears in whichever split currently has focus and is selected
  straight away; its address bar already holds the cursor with the contents selected, so the first
  keystroke starts a fresh address.
Rules: an empty tab shows the blank page (with the browser settings page gone, the home page is a
  fixed default); the tab goes into the focused split rather than the first split; a script on the
  page can never close the tab it lives in, the request is ignored and switching tabs still works;
  a tab opened from a link keeps the session profile of the page that opened it.
Acceptance:
  - [x] Press Mod+Shift+B → a New Tab is active and typed characters land in its address bar. (cards live; evidence/cards-BROW-001.txt)
  - [x] Load a page whose script asks to close its own window → the tab stays and the other tabs
        still switch normally. (cards live; evidence/cards-BROW-001.txt)
Compat: keyboard command for a new browser tab, default Mod+Shift+B on every platform (its command
  id is an allowlist candidate).
Source: D-13-001

### BROW-002 · Browser pages survive switching away and back
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: leaves a browser tab for a terminal, another browser tab or another worktree, then
  returns.
User sees: the page is untouched: same scroll position, partly typed form fields, sign-in and
  back/forward history, and no reload.
Rules: a page that is not on screen stays alive where it is, so coming back only repaints it; when
  hundreds of tabs come back after a restart they load as they are opened, not all during start-up;
  touring dozens of worktrees does not leave hidden pages alive forever, because the hidden-worktree
  memory budget (BROW-021) decides which ones unload.
Acceptance:
  - [x] Type into a form field, go to a terminal tab and return → the typed text is still there. (cards live; evidence/cards-BROW-002.txt)
  - [x] Go to another worktree and come back → the page has not reloaded. (cards live; evidence/cards-BROW-002.txt)
Compat: —
Source: D-13-002

### BROW-003 · Address bar goes to a site or searches the web
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: types or pastes into the address bar and presses Enter, or presses Mod+L to jump there.
User sees: text shaped like a domain opens that site over HTTPS; words and phrases become a web
  search; local development addresses open over plain HTTP; a pasted absolute path to a file on
  disk shows that file.
Rules: searches go to the chosen engine, one of Google, Duck Duck Go, Bing or Kagi; Kagi may use a
  private session link, which is rejected when malformed, never displayed in the bar, and kept out
  of everything the window can read (the window only learns whether one is set); queries with
  Unicode, emoji or reserved characters are escaped correctly for each engine; any scheme other
  than web, file or the blank page is refused with an invalid-address notice and the current page
  stays; Enter on an empty bar shows the blank page instead of an error; a local file may be shown
  in the pane but is never handed to the operating system to open; pasted paths containing spaces
  or reserved characters are turned into valid file addresses; Mod+L reaches the bar even while
  focus is inside the page, and only in the focused split.
  (Kolux RS, T-012-b-fix: inside the page a script of ours takes the chord and hands it to the
  app as a cancelled `kolux-chord:` navigation; the split the page sits in becomes the focused
  one as the chord arrives.)
  (Kolux RS: a pasted file path is shown through the preview chip, BROW-039; tabs never load file: because they carry the IPC script.)
Acceptance:
  - [x] Type rust ownership and press Enter → results from the configured search engine. (cards; evidence/cards-BROW-003.txt)
  - [x] Type example.com → the HTTPS site loads; type localhost:3000 → it loads over HTTP. (cards; evidence/cards-BROW-003.txt)
  - [x] Type an address with the javascript: scheme → invalid-address notice, page unchanged. (cards; evidence/cards-BROW-003.txt)
Compat: keyboard command for focusing the address bar, default Mod+L (command id is an allowlist
  candidate); engine choices Google, Duck Duck Go, Bing and Kagi. With the browser settings page
  cut, which engine is the fixed default and whether the Kagi link keeps a home is an owner
  decision.
Source: D-13-003

### BROW-005 · Back, forward, reload and stop
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: uses the toolbar arrows and the reload button, or their shortcuts.
User sees: back and forward are dimmed when there is no history in that direction; while a page
  loads the reload button turns into Stop with a spinner, and it turns back into Reload once the
  load ends.
Rules: only the toolbar button halts a load in progress, while the shortcut and the menu item reload
  instead; on a page that failed, every reload trigger tries the load again, whereas a crashed page
  goes through crash recovery (BROW-009); during an automatic retry of a failed page the button
  offers Stop rather than Retry; the button's label always names what a press will do; hard reload skips the
  cache.
  (Kolux RS, T-012-b-fix: Alt+Left / Alt+Right, Mod+R and the mouse's back and forward buttons
  pressed inside the page are taken from the web view and run by the toolbar, so its history
  never drifts from the page's; a page's own back or forward to a neighbouring entry moves the
  toolbar's cursor too.)
Acceptance:
  - [x] Open a slow page → Stop with a spinner; press it → loading halts; after a normal load the
        button reads Reload. (cards live; evidence/cards-BROW-005.txt)
  - [x] In a fresh tab → back and forward are both disabled. (cards; evidence/cards-BROW-005.txt)
Compat: keyboard commands browser.back (Mac Mod+[, other platforms Alt+Left), browser.forward (Mac
  Mod+], other platforms Alt+Right), browser.reload (Mod+R), and hard reload (Mod+Shift+R; its
  command id is an allowlist candidate).
Source: D-13-005

### BROW-051 · The agent page-control endpoint answers only Kolux's own tools
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: nothing; agents use the address that Kolux gives them.
User sees: no website and no other machine can reach the local endpoint that agents use to drive
  browser tabs.
Rules: the endpoint responds only under a secret path, and the bare host and port are refused; a
  request that names any host other than this computer is refused, which defeats DNS rebinding; a
  request carrying a web origin (anything sent by a web page) is refused even when it knows the
  secret path; the endpoint's self-description is likewise hidden behind that secret path.
  (Kolux RS, T-063: agents reach page control through the `kolux` CLI, so the endpoints fenced are
  the CLI line port and the hooks HTTP endpoint, both loopback-only; the per-start random token in
  a header or the request line stands in for the secret path (DT-C24); a request with a web page's
  headers, a foreign Host or no token gets 404 and an empty body, an HTTP line on the CLI port gets
  nothing back.)
Acceptance:
  - [x] From a page in any browser, try to reach the endpoint → refused. (cards; evidence/cards-BROW-051.txt)
  - [x] Connect to the bare port → refused; connect with the address Kolux handed the agent →
        works. (cards; evidence/cards-BROW-051.txt)
Compat: —
Source: D-13-051

### BROW-008 · Pages that fail to load get a recovery overlay
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens an address that cannot load (server down, bad certificate, unknown host).
User sees: an overlay on the pane that explains the problem in plain language and offers Retry,
  plus a switch to HTTPS or Open Externally when those make sense.
Rules: the switch to HTTPS is offered only for a qualifying failed http address and changes nothing
  but the scheme; certificate problems get their own wording while checking stays strict; advice
  about starting a local server appears only for failures on this computer's addresses, never for
  public sites; Open Externally is hidden when no outside handler exists or the address cannot be
  reached from this computer; while any overlay action runs all its buttons are disabled together,
  and the connecting indicator waits a moment so quick retries do not flicker; the browser engine's
  own error page is detected (checked about four times a second, paused while hidden) and covered by
  the overlay; failures that come out of crash recovery leave out the network troubleshooting text.
Acceptance:
  - [x] Open http://localhost:<free port> with nothing listening → overlay with local-server advice
        and Retry; start a server and press Retry → the page loads. (Reworded per Txais 2026-10-28
        decisions file, A2: port 9 is on Chromium's blocked-port list.)
        (live, free port 55726; evidence/cards-BROW-008.txt)
  - [x] Open a public site with a broken certificate → certificate wording and no local-server
        advice. (live, 0.1.4 + BROW-008 fix, local build; evidence/live-installed-b7.txt)
Compat: —
Source: D-13-008

### BROW-009 · Crashed pages recover by themselves
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: carries on working while the process behind a page crashes or disappears.
User sees: the tab reloads in place, or is rebuilt when a reload cannot work; if recovery fails, an
  error stays on screen until the user retries from the toolbar.
Rules: the number of recovery attempts is limited; a rebuild that hangs is retried directly; a page
  that is still connecting is waited for rather than replaced; minimised or hidden pages keep their
  last picture instead of going blank; only the page that belongs to a tab may attach to it, and a
  mismatched page is turned away.
Acceptance:
  - [x] Kill the process behind a tab → the tab returns to its page with no action from the user. (cards live; evidence/cards-BROW-009.txt)
  - [x] Force recovery to fail → an error shows; retry from the toolbar → the page is back. (cards; evidence/cards-BROW-009.txt)
Compat: —
Source: D-13-009

### BROW-015 · Popups open in a small window that shows only the origin
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: uses a site that opens a popup, such as a sign-in through another service or a payment
  window.
User sees: a separate small window with a strip across its top giving only the site's origin; the
  window's title is the page title.
Rules: the strip shows the origin alone, never a path or query; long origins are trimmed from the
  left so the real domain stays readable; plain http to a remote host is marked not secure, while
  http to this computer counts as secure; the strip follows the popup as it navigates; the popup
  stays linked to the tab that opened it so a sign-in can finish there; unsafe popup addresses are
  blocked, and before a page has finished registering, safe popups go to the system browser
  instead; popups inherit the opening page's security policies, and closing one side closes the
  other.
Acceptance:
  - [ ] Start a sign-in with GitHub from a site → the small window shows the GitHub origin,
        finishes, closes, and the tab is signed in.
  - [ ] Let a popup move to a page with a long path and query → the strip still shows the origin
        only.
Compat: —
Source: D-13-015

### BROW-024 · Trust a self-signed certificate on a local dev server
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: opens a local development server that uses a self-signed HTTPS certificate and approves
  it from the failure overlay.
User sees: once approved, that exact local address loads; every other address keeps strict
  certificate checks.
Rules: approval is offered only for this computer's own addresses, never public hosts; it covers
  that host and port alone, so other ports and other tabs stay untrusted; it is offered only while a
  matching certificate challenge is pending, so an error restored after a restart cannot be
  approved; only Kolux itself can send the approval, never the page; if an approved address later
  shows a different bad certificate, it is refused again until approved again.
Acceptance:
  - [ ] Approve https://localhost:8443 → it loads; https://localhost:9443 still shows the
        certificate failure.
  - [ ] Quit and relaunch while the failure overlay is showing → no approve option until the page
        is retried and the certificate challenge returns.
Compat: —
Source: D-13-024

### BROW-029 · Importing cookies never brings Google sign-ins
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: imports cookies from a browser that is signed in to Google.
User sees: a line at the bottom of the Import Cookies menu says Google cookies are left out;
  afterwards other sites are signed in, while Google has to be signed in to directly in the pane.
Rules: every host in the google.com family is skipped, lookalike hosts are not, and YouTube still
  comes across; Google cookies already in the pane are never deleted by an import; no decryption
  key is requested just for Google rows; the result toast gives Google-specific advice only when
  Google rows really were skipped.
Acceptance:
  - [ ] Bring cookies from a browser signed in to Google and GitHub → GitHub is signed in, Google
        is not, and a Google sign-in already in the pane is untouched.
  - [ ] Bring cookies from a browser with no Google cookies → the toast has no Google advice.
Compat: —
Source: D-13-029

### BROW-031 · Passkey account chooser
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: signs in with a passkey on a site where more than one account is available.
User sees: a Kolux dialog listing the accounts by name, to pick one.
Rules: only the page that asked can answer, and only with one of the offered accounts; the request
  is cancelled when the tab closes, the page dies or time runs out; internal credential identifiers
  are never displayed; deleting one profile leaves another profile's open request alone.
Acceptance:
  - [ ] Passkey sign-in with two accounts → the dialog shows both names; pick one → signed in.
  - [ ] Close the tab while the dialog is open → the request is cancelled cleanly.
Compat: —
Source: D-13-031

### BROW-036 · Grabbed page details are scrubbed of secrets
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: grabs or annotates an element on a page that holds tokens or keys.
User sees: what goes to the AI has secret-looking values masked, query strings stripped from
  addresses and unsafe link schemes removed.
Rules: only a chosen safe set of attributes, plus accessibility attributes, is kept; a fixed set of
  16 computed style properties is included; secret detection is precise, so everyday words are not
  masked; captures with a broken structure are thrown away.
Acceptance:
  - [ ] Grab an input whose attributes hold a token and whose link carries a key in its query →
        the result shows a mask marker and the address without its query.
  - [ ] Grab a paragraph of plain prose → no words are masked.
Compat: —
Source: D-13-036

### BROW-040 · Document previews are fenced to their folder
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: previews a document that refers to nearby files, links outward or tries to download.
User sees: the preview reads only its own file until the user grants its folder; outbound links ask
  for confirmation and show the exact destination; downloads are refused with a notice; problems
  such as a file that is too large or a blocked asset are explained.
Rules: folder access never leaves the workspace, and parent-folder steps, absolute escapes,
  backslash tricks and null-character tricks are refused; navigation outside the granted folder,
  file addresses, popups and script-opened windows are all blocked, and only a genuine click on an
  outside link is offered, once; embedded frames may load only assets inside the folder; the
  download notice appears once per burst for each preview; every permission request from a preview
  is denied; agent tools may drive a preview only after it has rendered and never under another
  page's identity.
Acceptance:
  - [ ] Preview an HTML document that pulls a stylesheet from elsewhere in the workspace → it shows
        unstyled until folder access is allowed.
  - [ ] Click an outside link → a confirmation shows the full address; cancel → nothing opens.
Compat: —
Source: D-13-040

### BROW-020 · Browser tabs come back after a restart
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits Kolux with browser tabs open, then starts it again.
User sees: the browser tabs return with their addresses and back/forward history; only the selected
  page loads at once.
Rules: the saved history for each page has a ceiling; if the saved active tab is missing, the first
  valid browser tab is chosen; tabs that belonged to deleted worktrees are dropped, and state left
  by older builds is tidied away; browser tabs inside floating workspaces come back as well.
Acceptance:
  - [ ] Open three tabs, navigate twice in one, quit and relaunch → three tabs return; Back in that
        tab goes to its earlier page.
  - [ ] Delete a worktree that had a browser tab, then relaunch → no tab for it comes back.
Compat: —
Source: D-13-020

### BROW-021 · Hidden worktrees give back browser memory
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: works across many worktrees that each have browser pages open.
User sees: past a budget, pages in the least recently visited hidden worktrees are unloaded;
  returning to one reloads only its selected page.
Rules: the active worktree is never unloaded or counted; only worktrees that really hold live pages
  count toward the budget; pages under agent control and pages with a download in progress are
  spared; visiting a worktree moves it to the front of the order; document previews count toward
  the same budget; the budget is on by default.
Acceptance:
  - [ ] Open pages in ten worktrees and visit each in turn → the oldest hidden ones unload; go back
        to one → its selected page reloads.
  - [ ] An agent-driven page in a hidden worktree → never unloaded.
Compat: on by default with no settings page; the old setting that switched it is not carried over.
Source: D-13-021

### BROW-037 · Annotate page elements and send the notes to an agent
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: clicks Annotate page element, picks elements, writes a comment and an intent for each,
  then sends them from the send menu.
User sees: a tray of waiting notes that can be edited or removed; the send menu lists the same
  agent sessions that diff review notes go to; the agent gets a single Markdown message that gives,
  for each note, the element's selector, hints about where it lives in the source, its place in the
  component tree, its styles and the comment.
Rules: saving trims the comment, and Cancel or Escape goes back to the read view with nothing
  changed; the number of notes per page is capped, and notes are cleared when the page address
  changes; page text cannot break the Markdown: code fences are lengthened, line breaks are folded
  and long text is cut without splitting a character; with no notes, nothing is sent; Escape inside
  a note being edited ends only that edit, and element picking stays on.
Acceptance:
  - [ ] Annotate two elements and send them to a running session → it receives one Markdown block
        listing both with their comments.
  - [ ] Navigate the page to a new address → the tray empties.
Compat: —
Source: D-13-037

### BROW-042 · Agents drive the worktree's visible browser tab
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: lets an agent in a worktree run `kolux` browser commands.
User sees: the agent's clicks, typing and navigation happen in the worktree's active browser tab,
  where the user can watch; a page being driven keeps painting even while hidden.
Rules: commands go to the worktree's active browser tab, and switching tabs moves the target; with
  no browser tab the command fails with a clear message; an outdated helper session can never take
  commands away from the real tab; waits and commands have time limits, and repeated time-outs
  restart the helper session; taking a screenshot does not pull focus away from the user; device
  emulation set by the agent stays in force across commands; a raw pass-through runs any helper
  command against the tab; when the page behind the tab is replaced, the helper session is rebuilt
  against the new page before the next command runs.
Acceptance:
  - [ ] In a worktree with a browser tab run `kolux goto --url https://example.com` → the visible
        tab navigates.
  - [ ] Run the same command in a worktree with no browser tab → a clear error and nothing opens.
Compat: `kolux exec --command "<helper command>"`; every browser command accepts `--worktree`,
  `--page` and `--json`. The pass-through follows the command language of the third-party
  automation helper the old app wrapped, so the rebuild must choose its own helper or pin one
  (owner decision). The `--pairing-code` and `--environment` flags these commands carried leave
  with area 18.
Source: D-13-042

### BROW-046 · CLI: navigate, wait, snapshot and capture pages
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux goto`, `kolux back`, `kolux forward`, `kolux reload`, `kolux wait`,
  `kolux eval`, `kolux scroll`, `kolux snapshot`, `kolux screenshot`, `kolux full-screenshot` or
  `kolux pdf`.
User sees: the active tab navigates or waits for a condition; a snapshot returns the page's
  accessibility tree with element references that later commands can use; screenshots and PDFs are
  saved.
Rules: a wait can be for a selector, text, an address pattern, a load state, a script condition or
  a visibility state, with a time limit; a load cut short by a download resolves with the page
  unchanged instead of failing; screenshots take an image format, and the full-page variant
  captures the whole page; eval runs a script expression in the page and returns its value; pdf
  saves the page as a PDF.
Acceptance:
  - [ ] `kolux snapshot` → output contains references such as e12; `kolux click --element e12`
        clicks that element.
  - [ ] `kolux wait --text Done --timeout 2000` on a page that never shows that text → fails after
        about two seconds.
Compat: `kolux goto --url <url>`; `kolux back`; `kolux forward`; `kolux reload`;
  `kolux wait [--selector <sel>] [--timeout <ms>] [--text <text>] [--url <pattern>] [--load <state>] [--fn <script>] [--state hidden|visible]`;
  `kolux eval --expression <script>`; `kolux scroll --direction up|down [--amount <pixels>]`;
  `kolux snapshot`; `kolux screenshot [--format png|jpeg]`; `kolux full-screenshot [--format png|jpeg]`;
  `kolux pdf`.
Source: D-13-046

### BROW-047 · CLI: act on page elements
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs element commands such as `kolux click`, `kolux fill`, `kolux type`,
  `kolux select`, `kolux hover`, `kolux drag`, `kolux upload`, `kolux find`, `kolux get`,
  `kolux is` or `kolux mouse`.
User sees: the command acts on the referenced element in the visible tab and reports the outcome as
  text, or as JSON when asked.
Rules: inserting text first focuses the right field, including inside embedded frames; find
  locates an element by meaning (role, text or label) and performs an action on what it found; get
  returns one property of an element or the page (its text, markup, value, address, title, match
  count or bounding box), and is answers whether an element is visible, enabled or ticked;
  upload attaches local files to a file input, download clicks a target and saves the result to a
  path, and highlight outlines an element; reference-based commands are click, dblclick, fill, type,
  select, check, uncheck, focus, clear, select-all, hover, drag, scrollintoview and keypress; mouse
  move, down, up and wheel act at coordinates; long inserted text is delivered in bounded pieces,
  in order.
Acceptance:
  - [ ] `kolux fill --element e5 --value hello` then `kolux get --what value --element e5` →
        returns hello.
  - [ ] `kolux is --what visible --element e5` on a hidden element → reports false.
Compat: `kolux click|dblclick|check|uncheck|focus|clear|select-all|hover|scrollintoview --element <ref>`;
  `kolux fill --element <ref> --value <text>`; `kolux type --input <text>`;
  `kolux inserttext --text <text>`; `kolux select --element <ref> --value <value>`;
  `kolux keypress --key <name>`; `kolux drag --from <ref> --to <ref>`;
  `kolux upload --element <ref> --files <path,...>`; `kolux download --selector <ref> --path <path>`;
  `kolux highlight --selector <ref>`;
  `kolux find --locator <type> --value <text> --action <action> [--text <text>]`;
  `kolux get --what text|html|value|url|title|count|box [--element <ref>]`;
  `kolux is --what visible|enabled|checked --element <ref>`;
  `kolux mouse move --x <n> --y <n>`; `kolux mouse down|up [--button left|right|middle]`;
  `kolux mouse wheel --dy <n> [--dx <n>]`.
Source: D-13-047

### BROW-004 · Address bar suggests pages from history
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: begins typing in the address bar.
User sees: a drop-down list; for plain text a search entry comes first, then visited pages and
  previewed documents, strongest match on top.
Rules: a hit at the start of the site name outranks a hit inside the site name, which outranks a
  hit in the page title, which outranks a hit elsewhere in the address; pages visited often and
  lately rank higher, the visit bonus has a ceiling, and an old visit never lowers a score; Escape,
  leaving the bar or clicking into the page closes the list and keeps the typed text; a closed list
  stays closed, and typed text survives the page underneath being replaced; matching stays quick on
  a large history.
Acceptance:
  - [ ] After several visits to github.com, type git → github.com sits right under the search
        entry.
  - [ ] Press Escape → the list closes and the typed text stays.
Compat: —
Source: D-13-004

### BROW-007 · Find in page
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Mod+F in a browser tab, types, then presses Enter or Shift+Enter.
User sees: a find bar, matches highlighted in the page; Enter jumps to the next match and
  Shift+Enter to the previous one.
Rules: changing the text starts a new search, and Enter pressed before typing settles searches the
  new text; with two browser splits the find bar opens only on the focused split's page, even after
  the splits are reordered; Mod+F pressed while focus is inside the page still opens Kolux's find
  bar; the bar keeps working if the page behind the same tab is replaced; if the record of which
  split has focus is missing or out of date, the find bar opens on the page that received the
  shortcut.
Acceptance:
  - [ ] Two browser splits, focus the right one, press Mod+F → the find bar appears only on the
        right.
  - [ ] Type a word that occurs three times, press Enter twice, then Shift+Enter → the highlight
        moves forward twice and back once.
Compat: keyboard command browser.find (Mod+F).
Source: D-13-007

### BROW-012 · Each browser tab keeps its own zoom
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the zoom shortcuts, or Ctrl plus the scroll wheel (Cmd plus the wheel on Mac) over a
  page, and Mod+0 to reset.
User sees: the page zooms in the usual browser zoom steps, the percentage appears briefly while
  zooming, and Mod+0 returns to 100%.
Rules: a tab keeps its level through reload, hard reload and navigation to another site; tabs are
  independent, so reloading one never picks up another tab's zoom; Cmd with the wheel zooms only on
  Mac; zoom shortcuts work while focus is inside the page and follow customised bindings; levels
  snap to the supported steps and stop at the limits; new tabs start at the default level (fixed
  once the settings page is gone); Ctrl with the wheel zooms on every platform, but Ctrl with Alt
  or Shift scrolls normally; a tab unloaded by the memory budget comes back at its own level, and
  only a real close forgets it.
Acceptance:
  - [ ] Zoom tab A to 150% and reload → still 150%; tab B is still 100%.
  - [ ] Press Mod+0 → back to 100%.
Compat: keyboard commands zoom.in (Mod+=), zoom.out (Mod+-), zoom.reset (Mod+0); default level 100%.
Source: D-13-012

### BROW-013 · Downloads land in the Downloads folder without overwriting
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks a download link on a page.
User sees: the file saves into the system Downloads folder with progress, followed by a notice that
  it has finished.
Rules: file names are made safe, and empty or unsafe names fall back to a generic name; an existing
  file is never overwritten, a numbered suffix is added the way ordinary browsers do it; two
  downloads that start together under one name each end up with a distinct name; Windows reserved
  device names are rewritten on Windows only, and name clashes ignore letter case on Windows and Mac; after
  a bounded number of clashes the download fails rather than looping; closing the tab cancels its
  running downloads; progress shows bytes received and the total when both are known; a page still
  writing a download is never unloaded by the memory budget.
Acceptance:
  - [ ] Download the same file twice → the second copy gets a numbered suffix and the first is
        intact.
  - [ ] Close the tab mid-download → the download is cancelled.
Compat: —
Source: D-13-013

### BROW-014 · New-window links open as Kolux browser tabs
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks a link that asks for a new window, middle-clicks a link, or clicks it with Mod
  held.
User sees: the link opens as another Kolux browser tab; middle click and Mod-click open it behind
  the current tab, while Shift with middle click or Mod+Shift with click bring it to the front, as
  Chrome does.
Rules: ordinary links stay in the current tab, and Shift-click and Alt-click keep the page's normal
  behaviour; download links and links with no address are left alone; the same routing works inside
  embedded frames; clicks synthesised by page scripts are ignored, and a page that cancels its own
  click is respected; the modifier key follows this computer's platform even while a phone is being
  emulated; new tabs inherit the opener's session profile.
Acceptance:
  - [ ] Mod-click a link → a new tab opens behind the current one.
  - [ ] Shift with middle click on a link → a new tab opens in front.
Compat: —
Source: D-13-014

### BROW-017 · Right-click menu inside pages
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: right-clicks inside a page, on selected text or on a link.
User sees: Kolux's own menu with back and forward, Copy when text is selected, and for a link Open
  Link In Kolux Browser, Open Link In Default Browser and Copy Link Address; for the page itself,
  Open Page In Default Browser.
Rules: the menu opens at the pointer and flips so it stays inside the pane near its edges; a left or
  middle click elsewhere closes it, a right click does not.
Acceptance:
  - [ ] Right-click a link near the bottom-right corner → the menu opens flipped inside the pane
        with the link entries.
  - [ ] Left-click elsewhere → the menu closes; right-click elsewhere → it stays.
Compat: —
Source: D-13-017

### BROW-018 · App shortcuts still work while focus is inside a page
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Kolux shortcuts while typing or clicking inside a web page.
User sees: tab switching (Ctrl+Tab included), zoom, back and forward, find, close tab, double-tap
  shortcuts and worktree delete all keep working; the page does not swallow them.
Rules: shortcuts act on the split that owns the page; customised bindings are honoured, and a
  held-down delete chord is taken once, not repeated; pages inside a floating window send close and
  tab-number chords to that window; double-tap detection starts over when the page loses focus.
Acceptance:
  - [ ] Click into a page's text field and press Ctrl+Tab → Kolux switches to the previously used
        tab.
  - [ ] With focus in the page press Mod+F → Kolux's find bar opens.
Compat: keyboard command for switching to the previously used tab, default Ctrl+Tab (command id is
  an allowlist candidate).
Source: D-13-018

### BROW-019 · Close and reopen browser tabs
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Mod+W on a browser tab, then Mod+Shift+T.
User sees: the active browser page closes, and reopening brings the same page back.
Rules: when one browser tab holds several pages, only the requested page closes; closing the last
  tab shows the landing view and the worktree stays selected; only real closes are remembered for
  reopening, internal clean-ups are not; an unknown page id is refused instead of being reported as
  closed; close pressed while focus is inside a page closes that page's own tab, and if the page no
  longer belongs to any tab nothing closes, never whichever tab is merely active.
Acceptance:
  - [ ] Close a browser tab with Mod+W, press Mod+Shift+T → it returns at the same address.
  - [ ] Close the last remaining tab of a worktree → the landing view shows and the worktree stays
        selected.
Compat: keyboard commands tab.close (Mod+W) and reopen closed tab (Mod+Shift+T; command id is an
  allowlist candidate).
Source: D-13-019

### BROW-022 · The jump palette finds open browser pages
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the jump palette and types part of a page title or site name.
User sees: open browser pages listed with their site icon and the address minus its scheme; picking
  one switches to that worktree, split and tab.
Rules: page titles are searched before worktree details; a query of several words must match every
  word across title and site; with an empty query the order is stable and begins with the current
  context; a page that has closed in the meantime is reported as gone instead of opening something
  else; the split that owns the chosen page receives focus.
Acceptance:
  - [ ] Two worktrees each with a docs page, type docs rust → only the page matching both words;
        Enter → that worktree and split get focus.
  - [ ] Close a page while the palette lists it, then choose it → a gone notice, nothing else
        opens.
Compat: —
Source: D-13-022

### BROW-025 · Google sign-in works inside the pane
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: signs in to Google, or uses a site's sign-in-with-Google button, inside a browser tab.
User sees: the sign-in goes through instead of being blocked as an embedded browser.
Rules: only on the Google and YouTube sign-in hosts does the pane identify itself as desktop Firefox
  for this platform, with no client hints; Google app subdomains and lookalike hosts keep the
  normal identity; the identity switch survives redirects, and an active viewport preset stays in
  force afterwards; a profile can opt out (native mode), the option explains what that costs, and
  popups follow the mode of their profile.
Acceptance:
  - [ ] Sign in to Google in a tab → it succeeds without an unsupported-browser block.
  - [ ] Put the profile in native mode → the stock identity is used on the sign-in host.
Compat: `--no-ua-spoof` on `kolux tab profile create` sets native mode.
Source: D-13-025

### BROW-027 · Browser session profiles keep logins apart
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the toolbar menu and picks a profile, or chooses New Profile….
User sees: each profile has its own cookies and storage; a check mark shows the tab's profile;
  imported profiles show the name of the browser they came from; choosing a profile moves the tab
  to it.
Rules: a default profile always exists and cannot be deleted; each new profile gets its own
  isolated store, and a failed creation is rolled back; a new profile is not handed out until any
  proxy has been applied to it; deleting a profile keeps security rules in force for pages still
  open in it; tabs opened from links inherit the opener's profile.
Acceptance:
  - [ ] Create a profile named Work and sign in to a site; move the tab to the default profile →
        signed out; move it back → signed in.
  - [ ] Try to delete the default profile → refused.
Compat: two kinds of profile, isolated and imported; each remembers its name and, when imported,
  the source browser.
Source: D-13-027

### BROW-028 · Bring cookies over from installed browsers or a file
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: toolbar menu → Import Cookies → From a named browser (choosing that browser's profile
  when it has several) or From File….
User sees: logins from that browser land in the tab's current profile; a toast reports success,
  skipped cookies or warnings.
Rules: installed browsers are looked for only when the menu opens; sources are Chrome, Edge, Brave,
  Chromium, Helium and Firefox on every platform, Comet on Mac and Windows, Arc and Safari on Mac
  only; a file must hold a JSON list of cookies, files that are not JSON, not a list or empty are
  refused, bad entries are skipped, and a file where every entry was skipped is reported; for each
  site brought in, that site's existing cookies are replaced and unrelated sites are left alone; any
  failure rolls back so no existing cookie is lost; cookies locked by Windows app-bound encryption
  are reported as unreadable, not as an empty success; when the store is busy, the cookies are
  staged and applied at the next start; the menu entry is disabled while cookies are being brought
  into this profile; a chosen source profile must sit inside that browser's own data folder, and a
  choice pointing anywhere else is refused.
Acceptance:
  - [ ] Bring cookies from Chrome → a toast with a count; a site signed in there opens signed in.
  - [ ] Load a file with one malformed entry → the rest arrive and the toast mentions skipped
        cookies.
Compat: the file is a JSON list of cookie records, each with a name, value and domain, and
  optionally a path, the secure flag, the HTTP-only flag, a same-site mode and an expiry; the exact
  field spelling to accept should match the common browser-extension export format (to confirm).
Source: D-13-028

### BROW-033 · Browser traffic follows the configured HTTP proxy
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: sets an HTTP proxy address and, optionally, a list of hosts that bypass it.
User sees: every profile's traffic goes through the proxy, bypassed hosts go direct, and proxy
  credentials are never displayed.
Rules: the proxy applies to every profile, including ones created later; if applying it fails for a
  profile, that profile stays blocked rather than going direct; changes reach all profiles at once,
  and a newer value always wins over one still being applied.
Acceptance:
  - [ ] Set a proxy and open a site → the request shows in the proxy's log; a bypassed host does
        not.
  - [ ] Create a new profile after setting the proxy → its traffic also goes through the proxy.
Compat: proxy address and bypass list, both empty by default, which means the system's own proxy.
  With the browser settings page cut they lose their only screen and become fixed defaults (OD-18 in
  DECISIONS.md, which also says what a flip brings).
Source: D-13-033

### BROW-034 · Viewport presets for phone, tablet and laptop
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: toolbar menu → Viewport Size → picks a preset, or Default.
User sees: the page renders at that device size, with a phone identity and touch input for phone
  and tablet sizes; Default returns to the pane's own size.
Rules: presets are Mobile S 320×568, Mobile M 375×667, Mobile L 425×812, Tablet 768×1024, Laptop
  1024×768, Laptop L 1440×900 and Desktop 1920×1080; phone and tablet presets use double pixel
  density; the preset holds through navigation and redirects, including trips through sign-in hosts;
  presets larger than the pane can be panned with the scroll wheel; a preset that only partly
  applied is reported.
Acceptance:
  - [ ] Pick Mobile M → the page reflows to 375 wide with its mobile layout; navigate elsewhere →
        still mobile.
  - [ ] Pick Default → the page fills the pane width again.
Compat: preset names and sizes as listed under Rules.
Source: D-13-034

### BROW-035 · Grab a page element to hand to the AI
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks Grab page element (or presses Mod+C with nothing selected), moves over the page
  and clicks an element.
User sees: elements light up under the pointer; clicking captures one and opens a sheet with a
  cropped screenshot, the element's details and its surroundings, with Copy Screenshot and Attach
  to AI.
Rules: Mod+C starts a grab only when the page is not copying selected text; Escape, navigating away
  or closing the tab cancels the grab; a screenshot over the size budget is left out instead of
  failing the grab; only the tab's own page can be grabbed.
Acceptance:
  - [ ] Start a grab and click a button → the sheet shows its screenshot and text; Attach to AI
        puts it into the agent's input.
  - [ ] Press Escape mid-grab → the highlight layer disappears.
Compat: keyboard command for grabbing an element, default Mod+C (command id is an allowlist
  candidate).
Source: D-13-035

### BROW-038 · Draw on a page screenshot
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks Draw on screenshot and marks up the page with Pen, Highlighter, Arrow,
  Rectangle, Ellipse or Text, choosing colour, line thickness and font size.
User sees: shapes drawn over a frozen copy of the page, with undo and redo; the result becomes one
  screenshot to attach or copy.
Rules: rectangles and ellipses can be dragged in any direction; the final image stays inside a pixel
  budget, with scale held between 1 and 4; a one-time hint shows the first time drawing is
  available, closes if the pane is hidden and never returns once dismissed; when the combined image
  is over budget it is tried again at smaller sizes, largest first, and stays a PNG.
Acceptance:
  - [ ] Draw an arrow and a text label, undo → the label goes; redo → it is back; finish → one
        image with the page, the arrow and the label.
  - [ ] Dismiss the drawing hint, restart Kolux → the hint does not return.
Compat: —
Source: D-13-038

### BROW-039 · Preview a worktree's HTML documents in a browser tab
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens an HTML document from the worktree as a preview.
User sees: the rendered document in a browser tab named after the document's title (or its file
  name), with a chip showing its folder and file name where the address would be.
Rules: the internal preview address is never shown; the chip can copy the full path in the form
  the host system uses, open the source as an editor tab with the right language, or hand the file to
  the system's default app; back and forward start disabled and then follow navigation inside the
  document; previews count toward the hidden-worktree budget and load only when shown; mouse clicks
  pass through to Kolux while a drag is under way.
Acceptance:
  - [ ] Preview an HTML document that sets a page title → the tab carries that title and the chip
        shows its folder and file name.
  - [ ] Use the chip's open-source action → an editor tab opens with HTML highlighting.
Compat: —
Source: D-13-039

### BROW-044 · CLI: list, switch, create and close browser tabs
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs `kolux tab` commands from a terminal.
User sees: the worktree's browser tabs listed (optionally with their profiles), one tab shown by
  page id, the current tab, a switch by index or page id (optionally focusing it), a new tab at an
  address and profile, or a tab closed by index.
Rules: a new tab is reported only once it has registered; list and current accept a worktree
  selector or all worktrees.
Acceptance:
  - [ ] `kolux tab create --url https://example.com --json` → returns a page id; `kolux tab list`
        shows it.
  - [ ] `kolux tab close --index 0` → that tab is gone from `kolux tab list`.
Compat: `kolux tab list [--worktree <selector|all>] [--show-profile] [--json]`;
  `kolux tab show --page <id>`; `kolux tab current [--worktree <selector|all>]`;
  `kolux tab switch (--index <n> | --page <id>) [--focus]`;
  `kolux tab create [--url <url>] [--profile <id>]`; `kolux tab close [--index <n>]`.
Source: D-13-044

### BROW-045 · CLI: manage browser session profiles
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs `kolux tab profile` commands.
User sees: profiles listed; a profile created with a label, a kind and optionally native identity;
  one deleted; a tab moved to a profile or back to the default, or cloned into another profile; a
  tab's profile shown.
Rules: delete is flagged as destructive, and the default profile cannot be deleted.
Acceptance:
  - [ ] `kolux tab profile create --label Work` → it appears in `kolux tab profile list`.
  - [ ] Delete the default profile → refused.
Compat: `kolux tab profile list`;
  `kolux tab profile create --label <name> [--scope isolated|imported] [--no-ua-spoof]`;
  `kolux tab profile delete --profile <id>`;
  `kolux tab profile set (--page <id> | --worktree <selector>) --profile <id>`;
  `kolux tab profile show --page <id>`; `kolux tab profile use-default --page <id>`;
  `kolux tab profile clone --profile <id> [--page <id>]`.
Source: D-13-045

### BROW-048 · CLI: read and change cookies and web storage
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs `kolux cookie` or `kolux storage` commands.
User sees: cookies for the tab read, set or deleted; the tab's local or session storage read, set
  or cleared.
Rules: deleting cookies and clearing storage are flagged as destructive.
Acceptance:
  - [ ] Set a cookie with `kolux cookie set`, then `kolux cookie get` → it is listed.
  - [ ] `kolux storage local clear` → `kolux storage local get` for any key returns nothing.
Compat: `kolux cookie get [--url <url>]`;
  `kolux cookie set --name <n> --value <v> [--domain <d>] [--path <p>] [--secure] [--httpOnly] [--sameSite <s>] [--expires <epoch>]`;
  `kolux cookie delete --name <n> [--domain <d>] [--url <u>]`;
  `kolux storage local|session get --key <key>`; `kolux storage local|session set --key <key> --value <value>`;
  `kolux storage local|session clear`.
Source: D-13-048

### BROW-049 · CLI: intercept requests and read console and network logs
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs `kolux intercept`, `kolux capture`, `kolux console` or `kolux network`.
User sees: requests matching the given patterns are held; recorded console messages and network
  requests are listed, up to a limit.
Rules: interception set-up is cleared when a replaced tab closes; capture records only between
  start and stop.
Acceptance:
  - [ ] `kolux capture start`, load a page, `kolux network` → its requests are listed.
  - [ ] `kolux capture stop`, load another page → no new requests are recorded.
Compat: `kolux intercept enable [--patterns <glob,...>]`; `kolux intercept disable`;
  `kolux intercept list`; `kolux capture start`; `kolux capture stop`; `kolux console [--limit <n>]`;
  `kolux network [--limit <n>]`.
Source: D-13-049

### BROW-050 · CLI: emulate devices, answer dialogs, use the clipboard
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs `kolux viewport`, `kolux geolocation`, `kolux set`, `kolux clipboard` or
  `kolux dialog`.
User sees: the tab's viewport, device, location, offline state, extra headers, HTTP credentials,
  colour-scheme or reduced-motion preference change; page dialogs are accepted (with text) or
  dismissed; the clipboard is read or written.
Rules: an oversized clipboard write is refused before anything runs; mobile viewport emulation
  stays in force across later commands; extra headers and credentials go only to the one site
  they were set for (the open page's, or `--origin`), from a page on that site (T-656, DT-C92).
Acceptance:
  - [ ] `kolux set offline --state on`, then `kolux goto` a site → an offline failure.
  - [ ] `kolux dialog accept --text hi` while a prompt is open → the prompt receives hi.
Compat: `kolux viewport --width <w> --height <h> [--scale <n>] [--mobile]`;
  `kolux geolocation --latitude <lat> --longitude <lon> [--accuracy <n>]`;
  `kolux set device --name <device>`; `kolux set offline [--state on|off]`;
  `kolux set headers --headers <json> [--origin <url>]`;
  `kolux set credentials --user <user> --pass <pass> [--origin <url>]`;
  `kolux set media [--color-scheme dark|light] [--reduced-motion reduce|no-preference]`;
  `kolux clipboard read`; `kolux clipboard write --text <text>`;
  `kolux dialog accept [--text <text>]`; `kolux dialog dismiss`.
Source: D-13-050

### BROW-053 · Keep the computer awake while agents run
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: picks On, Off or Auto for keeping the computer awake (in Agents settings).
User sees: Auto prevents sleep while agents are running, On keeps the computer awake all the time,
  Off never interferes; a status-bar item shows when it is in force.
Rules: an older on/off switch that was on becomes Auto; an explicit choice is kept unless an older
  build changed the old switch afterwards; saving also writes a value older builds understand, so
  they roughly agree.
Acceptance:
  - [ ] Choose Auto, start an agent and leave the computer idle past its sleep time → it stays
        awake; once the agents finish → normal sleep returns.
  - [ ] Choose Off with an agent running → the computer sleeps on its usual schedule.
Compat: three values, On, Off and Auto. The same behaviour is carded in areas 03, 05 and 19; area
  03 owns it, so build it once.
Source: D-13-053

### BROW-067 · Preview a workspace's running dev server in a browser tab
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: starts a dev server from a workspace terminal, then clicks the globe-shaped Preview
  button in the focused split's toolbar, or picks another address from the small arrow menu beside
  it.
User sees: the server's page opens as a browser tab in that same split, named Preview followed by
  the server's host and port; if a browser tab of this workspace already shows that origin, that
  tab comes to the front and nothing new opens.
Rules: the button appears only in the toolbar of the split that holds focus, beside the new-tab
  control, never once per split; while no listening port belongs to the workspace it is greyed out
  and its tooltip explains that no server was found; only ports owned by this workspace are
  candidates, never another workspace's ports, container ports or outside processes; ranking puts a
  port whose address the server printed in a terminal first, next a port speaking a recognised web
  protocol, and the smallest port number breaks any tie; the printed address is used when there is
  one; the arrow menu
  shows only when two or more candidates exist and lists the others by host and port; when friendly
  local addresses (area 01) are on, the tab opens at the friendly address and falls back to the
  plain one if that fails; Kolux adds no file watching of its own, refreshing is left to the dev
  server's live reload; a failure to open shows an error toast with the reason. On Windows the
  system port scan carries no working folder, so a port also counts as the workspace's when a
  terminal bound to that workspace printed an address for it; that link survives later rescans while
  the port keeps listening, evidence from the process itself wins when both exist, and the ports
  list (area 05) marks such ports as found through a printed address.
Acceptance:
  - [ ] No server running in the workspace → the button is greyed out and its tooltip says no server
        was found.
  - [ ] Start a dev server that prints http://localhost:5173 in the workspace terminal, click Preview
        → a browser tab for it opens in the focused split; click again → the same tab is focused and
        the tab count is unchanged.
  - [ ] Run two servers in one workspace → the arrow menu lists the second; picking it opens that one.
  - [ ] On Windows, start a local web server that prints its address in a workspace terminal → the
        button enables after the next port scan and one click opens the page.
Compat: —
Source: D-13-067

### BROW-016 · Runaway pages cannot flood the user with tabs
Tier: P2 · Pushed: 5 · State at 0.15.0: live-unverified
User does: clicks something on a page that tries to open windows in a loop.
User sees: only a handful of tabs open, and ordinary link opening still works afterwards.
Rules: the allowance is a sliding window shared by the whole family of popups, so a slow, steady
  stream cannot get past it either; the allowance fills up again once the window has passed.
Acceptance:
  - [ ] A page opens 100 windows from one click → a few tabs open and the rest are absorbed.
  - [ ] A minute later → links open normally again.
Compat: —
Source: D-13-016

### BROW-032 · Site permission requests in the pane
Tier: P2 · Pushed: 5 · State at 0.15.0: live-unverified
User does: uses a site that asks for pointer lock, storage access, the camera or the microphone.
User sees: pointer lock and storage access are granted without asking; on Mac, camera and microphone
  go through the system privacy prompt; a refused request brings a notice that names the permission
  in plain words.
Rules: an unknown permission is named by its raw name in the notice; permission and download
  requests that arrive before the page has registered are queued, not lost.
Acceptance:
  - [ ] A site asks for the camera and is refused → a notice says camera access was denied.
  - [ ] A site asks for pointer lock → it is granted with no prompt.
Compat: —
Source: D-13-032

### BROW-006 · Address bar folds up in a narrow pane
Tier: P2 · Pushed: 7 · State at 0.15.0: live-unverified
User does: narrows a browser pane until the toolbar no longer fits.
User sees: the address bar shrinks to a compact control; clicking it spreads it across the toolbar
  while it has focus, and it shrinks again when focus leaves.
Rules: the expanded bar floats over the toolbar, and the navigation buttons underneath do not move.
Acceptance:
  - [ ] Narrow the pane below the toolbar's minimum → the address bar is compact.
  - [ ] Click it → a full-width overlay; click away → compact again.
Compat: —
Source: D-13-006

### BROW-011 · Loading pages match the app theme
Tier: P2 · Pushed: 7 · State at 0.15.0: live-unverified
User does: opens a page while a dark theme is active.
User sees: while the page loads the pane shows a surface in the theme's colour, not a white flash.
Rules: the loading surface follows the current app theme.
Acceptance:
  - [ ] Dark theme, open a slow site → no white flash before the content appears.
  - [ ] Light theme, open a slow site → the loading surface is light.
Compat: —
Source: D-13-011

### BROW-010 · Pages are checked again after the computer wakes
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: puts the computer to sleep with browser tabs open, then wakes it.
User sees: the tabs work again; a page lost during sleep is rebuilt rather than left blank.
Rules: one wake signal is shared by every page; one page failing does not stop the others being
  checked.
Acceptance:
  - [ ] Sleep with three tabs open, wake → all three show content within a few seconds.
  - [ ] Wake with one page that cannot recover → the other two still come back.
Compat: —
Source: D-13-010

### BROW-043 · Leftover browser helper processes are cleaned up
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits Kolux, or it crashes, after agents have been driving browser tabs.
User sees: orphaned automation helpers do not pile up; helpers left from an earlier run are closed
  at start, and all of them are stopped at quit.
Rules: only helpers carrying Kolux's own naming are touched, and ones this run owns are left alone
  at start; a listing that hangs or fails never holds up start-up, and one failed close does not
  stop the rest; helper idle time-outs are longer than command time-outs, so commands are never cut
  short; an environment variable can switch the start-up sweep off, and only an explicit on-value
  does so, anything else still sweeps.
Acceptance:
  - [ ] Kill Kolux while an agent drives a tab, relaunch → no stale helper process remains.
  - [ ] Quit Kolux normally → no helper process is left running.
Compat: —
Source: D-13-043

### BROW-023 · Tabs show the site icon and page title
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: browses from page to page and site to site.
User sees: the tab carries the site's icon and the page title, with a spinner while loading; blank
  tabs are called New Tab.
Rules: the icon stays while navigating within one site and changes when the site changes; an icon
  that failed to load is tried again after a reload on the same site.
Acceptance:
  - [ ] Navigate within one site → the icon stays.
  - [ ] Go to another site → the icon changes.
Compat: —
Source: D-13-023

### BROW-026 · Sites fall back to popup sign-in when FedCM is off
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: signs in on a site that would otherwise use the browser's built-in identity prompt.
User sees: the site's ordinary popup or redirect sign-in instead of a prompt that cannot work in the
  pane.
Rules: the built-in identity prompt (FedCM) is switched off for browser pages.
Acceptance:
  - [ ] Visit a site that offers the built-in prompt → its popup sign-in appears and works.
  - [ ] No built-in identity prompt ever appears inside a browser tab.
Compat: —
Source: D-13-026

### BROW-030 · A hint in the toolbar offers to bring logins over
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a browser tab before ever bringing cookies over.
User sees: a small hint button suggests importing logins and names the browsers it found; dismissing
  it hides it for good.
Rules: the hint waits until saved preferences have loaded so it never flashes; long browser lists
  are shortened with a trailing count, and before detection finishes it lists the supported
  sources.
Acceptance:
  - [ ] Fresh install, open a browser tab → the hint is visible.
  - [ ] Dismiss it and restart → it does not return.
Compat: —
Source: D-13-030

### BROW-041 · Turn a document preview into a web page and back
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks the document chip, types a web address and presses Enter; later presses Back.
User sees: the same tab becomes an ordinary web page at that address; Back returns to the document
  preview.
Rules: Escape returns to the chip without converting; one level of return is remembered; pointing a
  preview at a different document swaps it, while the same document does nothing; after Back
  returns to the preview, Forward goes to the web page again.
Acceptance:
  - [ ] Change the chip to example.com and press Enter → the web page loads in that tab; Back → the
        preview returns.
  - [ ] Press Escape while editing the chip → the chip is restored and nothing converts.
Compat: —
Source: D-13-041

### BROW-052 · Drags pass across browser pages
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: drags a tab, a split or a file across a browser pane.
User sees: the drag keeps going over the page; drop targets appear and the drop lands, instead of
  the page swallowing it.
Rules: a page that appears in the middle of a drag also lets the drag through.
Acceptance:
  - [ ] Drag a terminal tab over a browser pane to split → the drop target shows and the split is
        made.
  - [ ] Drag a file from the explorer across a browser pane to a terminal → the drop lands in the
        terminal.
Compat: —
Source: D-13-052

### BROW-054 · Browser settings page
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opened Settings → Browser, or Browser Settings… from the toolbar menu.
User sees: a page for the home page, the search engine and Kagi link, the default zoom, link routing
  and session cookies, plus a section for remote browsing.
Rules: the features stay with fixed defaults (blank new tabs, one search engine, 100% default
  zoom); cookie importing and profiles stay in the toolbar menu.
Acceptance:
  - [ ] Settings has no Browser page, and the toolbar menu has no Browser Settings entry.
  - [ ] Profiles and Import Cookies are still reachable from the toolbar menu.
Compat: —
Decision: default cut: table 1b removes the browser settings page; the features keep fixed defaults
  and toolbar-menu controls. Revive via DECISIONS.md.
Source: D-13-054

### BROW-055 · Browser pages hosted on a paired desktop client
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opened browser tabs in a worktree that ran on a paired remote runtime.
User sees: the page ran on the user's desktop while the worktree lived on the server; it survived
  host restarts and quits, could be reopened on the server, and mixed app versions placed pages
  safely; a tooltip tour introduced it.
Rules: remote and paired runtimes leave with area 18.
Acceptance:
  - [ ] Browser tabs open only for worktrees on this computer.
  - [ ] No tour about client-hosted pages appears.
Compat: —
Decision: default cut: paired remote runtimes (area 18) are dropped. Revive via DECISIONS.md.
Source: D-13-055

### BROW-056 · Browser pages streamed to web and phone clients
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: watched or drove a desktop browser tab from the web client or a phone.
User sees: a live video of the page with remote keyboard, address bar and navigation, plus an
  overlay on the desktop while a phone was in control.
Rules: the web client and mobile leave with area 18.
Acceptance:
  - [ ] No browser tab can be streamed off this computer.
  - [ ] No remote-control overlay appears on a browser pane.
Compat: —
Decision: default cut: web client and mobile pairing (area 18) are dropped. Revive via
  DECISIONS.md.
Source: D-13-056

### BROW-057 · Browser traffic routed through SSH, WSL and remote hosts
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: browsed from a worktree that lived on an SSH machine, inside WSL or on a remote runtime.
User sees: pages loaded as though from that host through a tunnel, with an indicator naming where
  the traffic left from; cookie importing could target those routes.
Rules: SSH hosts, WSL and remote runtimes leave with area 18.
Acceptance:
  - [ ] Browser traffic always leaves from this computer, and no route indicator is shown.
  - [ ] Import Cookies targets only local profiles.
Compat: —
Decision: default cut: SSH, WSL and remote network routing (area 18) are dropped. Revive via
  DECISIONS.md.
Source: D-13-057

### BROW-058 · Browser tabs inside web-runtime sessions
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opened browser tabs in a headless-served session from the web client.
User sees: tabs were staged, placed in splits and kept in step between the server and the web
  client, backed by off-screen pages on the server.
Rules: headless serve and the web client leave with area 18.
Acceptance:
  - [ ] Browser tabs exist only in the desktop window.
  - [ ] No off-screen server pages are created.
Compat: —
Decision: default cut: headless serve and web client (area 18) are dropped. Revive via
  DECISIONS.md.
Source: D-13-058

### BROW-059 · Remote runtime folder browser with Windows drives
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: browsed folders on a remote runtime, Windows drive letters included.
User sees: a folder picker listing the server's drives and folders.
Rules: remote runtimes leave with area 18.
Acceptance:
  - [ ] Folder pickers show only this computer's folders.
  - [ ] No remote drive list is offered.
Compat: —
Decision: default cut: remote runtimes (area 18) are dropped. Revive via DECISIONS.md.
Source: D-13-059

### BROW-060 · Open an address on the paired client from the CLI
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: ran `kolux open-url --url <url>` in a remote terminal.
User sees: the address opened on the desktop client hosting that terminal.
Rules: paired clients leave with area 18, and so do the `--pairing-code` and `--environment` flags
  every browser command carried.
Acceptance:
  - [ ] `kolux --help` does not list an open-url command.
  - [ ] Browser commands accept no pairing-code or environment flags.
Compat: the old command was `kolux open-url --url <url> [--worktree <selector>] [--json]`.
Decision: default cut: paired client hosting (area 18) is dropped. Revive via DECISIONS.md.
Source: D-13-060

### BROW-061 · Custom network address for runtime pairing
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: typed a custom address while generating a runtime pairing.
User sees: a dialog to enter the network address the pairing should advertise.
Rules: pairing leaves with area 18.
Acceptance:
  - [ ] No pairing flow exists, so no address dialog is offered.
  - [ ] Nothing in the browser area advertises a network address.
Compat: —
Decision: default cut: runtime pairing (area 18) is dropped. Revive via DECISIONS.md.
Source: D-13-061

### BROW-062 · Computer use: agents control desktop apps
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: let an agent run `kolux computer` commands.
User sees: the agent listed apps and windows, read an app's state, and clicked, scrolled, dragged,
  typed, pressed keys and set values in any desktop app.
Rules: actions the platform could not confirm were flagged as unverified.
Acceptance:
  - [ ] `kolux --help` lists no computer group.
  - [ ] Agents have no way to act on other desktop apps through Kolux.
Compat: the old group offered capabilities, list-apps, permissions, list-windows, get-app-state,
  click, perform-secondary-action, scroll, drag, type-text, press-key, hotkey, paste-text and
  set-value under `kolux computer`.
Decision: default cut: table 1b removes computer use and its settings section. Revive via
  DECISIONS.md.
Source: D-13-062

### BROW-063 · Computer Use settings section
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opened Settings → Computer Use.
User sees: a page to let agents control any app on the computer and to check the permissions it
  needs.
Rules: the section goes with the feature.
Acceptance:
  - [ ] Settings has no Computer Use section.
  - [ ] No permission check for desktop control runs anywhere in Settings.
Compat: —
Decision: default cut: table 1b removes the computer-use settings section. Revive via DECISIONS.md.
Source: D-13-063

### BROW-064 · Mac permission setup for computer use
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: granted Accessibility and Screen Recording to Kolux's helper app on a Mac.
User sees: a helper app stepped through each missing permission, reported the status and reset
  stale grants; other platforms did nothing.
Rules: a missing helper, or a helper that never closed, was reported instead of hanging.
Acceptance:
  - [ ] Kolux never asks for Accessibility or Screen Recording on Mac.
  - [ ] No desktop-control helper app is bundled.
Compat: —
Decision: default cut: table 1b removes computer use. Revive via DECISIONS.md.
Source: D-13-064

### BROW-065 · Desktop control helpers for Mac, Windows and Linux
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: used computer use on any platform.
User sees: a native helper on Mac and a script-based helper on Windows and Linux carried out the
  actions; blocked script policies on Windows were detected and explained.
Rules: large pastes were checked before the helper started; unsupported platforms said so plainly.
Acceptance:
  - [ ] No desktop-control helper is installed or launched on any platform.
  - [ ] No script-policy check for desktop control runs on Windows.
Compat: —
Decision: default cut: table 1b removes computer use. Revive via DECISIONS.md.
Source: D-13-065

### BROW-066 · Computer-use recovery guidance and key-chord checks
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: hit a computer-use error, or sent a key chord.
User sees: every error came with concrete next steps (set up permissions, list the windows and try
  once more, check the state after focus was lost); malformed key chords were refused.
Rules: a hotkey needed modifiers plus exactly one key, and a single key press refused modifier
  chords.
Acceptance:
  - [ ] No computer-use errors or guidance exist in the app.
  - [ ] No key-chord command for desktop control is offered.
Compat: —
Decision: default cut: table 1b removes computer use. Revive via DECISIONS.md.
Source: D-13-066

## Dropped by default (tier D)

- BROW-054 · Browser settings page — table 1b removes it; features keep fixed defaults and the
  toolbar menu.
- BROW-055 · Browser pages hosted on a paired desktop client — area 18 (remote and paired runtimes)
  is dropped.
- BROW-056 · Browser pages streamed to web and phone clients — area 18 (web client, mobile) is
  dropped.
- BROW-057 · Browser traffic routed through SSH, WSL and remote hosts — area 18 is dropped.
- BROW-058 · Browser tabs inside web-runtime sessions — area 18 (headless serve, web client) is
  dropped.
- BROW-059 · Remote runtime folder browser with Windows drives — area 18 is dropped.
- BROW-060 · Open an address on the paired client from the CLI — area 18 (paired clients) is
  dropped.
- BROW-061 · Custom network address for runtime pairing — area 18 (pairing) is dropped.
- BROW-062 · Computer use: agents control desktop apps — table 1b cuts computer use.
- BROW-063 · Computer Use settings section — table 1b cuts the section with the feature.
- BROW-064 · Mac permission setup for computer use — goes with computer use (table 1b).
- BROW-065 · Desktop control helpers for Mac, Windows and Linux — goes with computer use (table 1b).
- BROW-066 · Computer-use recovery guidance and key-chord checks — goes with computer use
  (table 1b).

## Hidden or retired (tier H)

None: no card in this area is tier H.
