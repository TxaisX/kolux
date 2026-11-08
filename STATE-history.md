# STATE history

Append-only. Moved out of STATE.md on 2026-10-19 so a session start does not pay to read it. Never read at startup; grep only.
Builders append their pass and decision lines here (prefixed `[<lane>]`); the coordinator keeps STATE.md's "Last 10 passes" trimmed at merge.

## Task-by-task record (was below "What works today")

The sidebar lists projects (Git repositories, added by typing or browsing; nothing else is pulled
in) with their main checkout and workspaces (worktrees), grouped by project, status or pull
request and smart-sorted; each row carries the strongest live agent state. Mod+N or the plus
opens the name field with a live preview of the branch and folder; Create makes the worktree and
opens it with a shell (a stand-in row and tab show while Git works; a newer create cancels one still
running and removes what it had made); Remove asks first and deletes folder and branch. Clicking a row switches
workspaces instantly, each keeping its panes as they were. The plus menu lists only agents that
are really installed and starts one in a fresh pre-trusted worktree or as a tab; empty panes ask
what to run, and on the New look a new session is chosen on a full-page New session sheet over the
workspace (count and folders from the project's last launch, Ctrl+Enter starts a complete lineup,
Escape closes). Where workspaces live, how a new one starts (nested or flat, base branch) and the
shortcuts (`~\.kolux\keybindings.json`, 127 command ids) are the user's own and remembered. A
Source Control panel stages, commits, pushes and pulls. `kolux-dev worktree create / rm` and
`kolux-dev orchestration worker-start` (flag checking only) drive it from a terminal. Settings has
AI connections: Claude keys and managed accounts, Codex sign-in, sealed secrets, lapsed sign-ins
flagged in the main window. A 24 px status bar shows On, memory use, shell and plug counts. Starter kits
run three AIs on one job: the strip above the sessions previews or opens each role's files,
collects them into one dated folder with a README and a Results page, and restarts or moves a
stopped role; the kit gallery lists the recent runs. A brand-new profile opens a four-screen
first-run card (welcome, connect an AI, your work, choose a kit) that can start a kit on sample
data.

What works today: the window has no Windows title bar; Kolux draws its own 36 px top bar with the
six-spoke mark, a sidebar toggle, the centred Agents / Board / Terminals switcher (Terminals is the
screen with content; the other two show their name and "nothing here yet"), a search box with the
Ctrl+Shift+J chips, a bell, a usage pill with the Claude and Codex marks, and its own minimize,
maximize and close. The sidebar is a floating rounded card; the pane sits in a rounded card with
the header composition from the design (status icon, agent mark, folder name, `main` branch chip,
"PowerShell", status word, gauge, menu, expand, split, close); a Layout 1/2/4/6 strip sits above
it (only 1 works) and a 24 px status bar below shows On, the app's memory use (from a Tauri
command), the shell count and the plug count. Colours, sizes and type come from design/DESIGN.md
through CSS custom properties in src/theme.ts; evidence/T-003b-compare.png (removed 2026-10-30 at Txais's request; the measurements above stay) was the pixel
comparison with the reference. The window opens with one terminal pane running Windows PowerShell. Typing
reaches the shell, output comes back, the pane follows the window size, the status icon's tooltip
says whether the GPU (WebGL) or the plain renderer is drawing, and Close ends the shell and shows "Ended".
Closing the window kills every shell it started.

A sidebar on the left lists projects. Add one by typing or browsing to a folder that holds a Git
repository (anything else is refused with a plain message; the same repository is never added
twice; picking a linked worktree of a repository already added selects that project, and otherwise
adds the worktree folder itself). Each project lists its main checkout and its workspaces (Git
worktrees). Type a name such as "Fix login" and the sidebar shows the branch and folder it will get
(`txais-xiong/fix-login` by default: the branch begins with the Git user name, or custom text, or
nothing, picked in the sidebar gear's Git & worktrees part, which shows the next branch name as you
type and says when Git refuses the prefix or it is only slashes, so new branches get none, T-116-a;
there too Default compare base picks the repository default or the branch upstream for the branch
summary; the folder is `fix-login` under the workspaces folder, inside a
folder named after the project); Create makes the branch and folder and copies the ignored files
`.worktreeinclude` lists, within about 2 GB and 50,000 entries, naming what it left out. The new
workspace composer picks the project from a search list (Recent first, matching letters marked, a
path hint for projects sharing a name, Add project at the end), suggests the project's branches in the
name field (a name that is an existing branch opens that branch), turns shortcodes such as `:bug:` into
emoji, and calls a name with nothing usable `workspace`; it has a parent picker (No parent by default),
an Advanced part (branch name, reuse an existing branch, start from, open a pull request: pick one of
the project's open pull requests and it is checked out at its latest commit, named after its title and
linked to it; setup: run the project's kolux.yaml setup script or skip it, in a new tab or a split to
the right or below, the agent waiting for it in a tab when asked) and Create more, which keeps it
open for the next one with the linked item dropped. Typing in the name field also suggests the open
issues and pull requests of the chosen project's own GitHub repository, and a pasted issue or pull
request link to it resolves to that item; either fills in the name and links the new workspace to it
(a pull request is checked out, an issue gets a new branch); a lookup over 256 characters is refused
and switching project drops the link. A create that Git finds locked by another Git process is retried twice before it fails, a failed one leaves nothing behind, and the "creating..." row in the sidebar has an x that cancels it. Pasting a GitHub pull request or issue address (`.../pull/N`, `.../issues/N`) into
the worktree palette preselects Create workspace from it: Enter makes the workspace in the project
that has that repository as a remote, named after the item's title and linked to it (a pull request
is checked out at its head; an issue gets a new branch), and runs the setup script; a repository's
home page is not a work item. `worktree create --issue <n>` without `--name` is named after the
issue's title. Shell restarts the terminal pane
inside that folder. Remove asks first, then deletes the folder and the branch (a branch that existed
before stays), closing any pane still sitting in that folder. Worktrees made outside Kolux (plain
`git worktree add`, another tool, the CLI) show up within about 5 seconds as one count line, for
example "3 new worktrees", which opens a review to hide or show each; any worktree row has a hide
button, and the project gear lists the hidden ones (10 a page, paths relative to the project) to show
again. A scan that fails (git missing, slow or the repository broken) removes nothing: the
worktrees already known stay listed under a yellow "Could not list the worktrees of <project>, so the
last known list stays" line (T-113-a). Worktrees Kolux made count as its own wherever they sit; the rest carry an "external" tag and
follow a show/hide choice per source (made by Claude Code, made by GSD, elsewhere on disk, up to 32 extra folders
the user lists): a global default in the sidebar gear (hidden for new projects) and a per-project
choice in the project gear that names the global value and resets to it. Projects added before this
keep showing them. The workspaces folder can be changed and
is remembered; projects are remembered across restarts.

T-004 adds the first agent launch: "+ New session" in the sidebar and the "+" in any pane header open
a menu listing Claude Code and Codex; an agent whose program is not on the PATH is greyed "not
installed". Picking Claude Code makes a fresh worktree off main with a creature name (adjective +
sea creature, e.g. `jade-seahorse`, unique across every project's folders and branches) and opens a
pane running `claude --permission-mode auto` in it; the header shows the Claude mark, the creature
name, a branch chip, "Claude" and "Running"; the sidebar lists the worktree with a live dot; closing
the pane ends the Claude process. Panes sit side by side (1, 2 or 3 columns) until the real grid in T-009.

T-005 makes shortcuts the user's own: Kolux reads `~\.kolux\keybindings.json` at start (creating it
empty when missing, through a temporary file), knows all 127 carried command ids with their
built-in chords per platform, applies the file's all-platforms section and then its win32 section
(a chord, a list of chords, or null / false for unbound), warns about and ignores ids it does not
know, keeps the default for any entry with a bad chord, drops a custom chord that clashes with
another in the same place, and shows a red notice when the file will not parse while leaving the
file alone. The search box chips and "Next that needs you" read their keys from that map (an
override shows at once at the next start; unbound shows "Unassigned"). Ctrl+B hides and shows the
sidebar (closed, it takes no width and the first tab stays in view), its right edge drags between
220 and 480 px and the width is kept (a bad saved width falls back), Ctrl+Shift+0 opens it and puts
focus on its list, and each workspace lists its running sessions as rows with their own agent mark
and name plus a count that skips ended ones; a click on a row shows that pane (T-051), and Ctrl+Alt+V cycles Agents / Board / Terminals through the keymap. The app icon and the
top-left mark are now Txais's own (design/icon/).

T-006 makes the sidebar rows a switch: a click on a workspace row (main checkout or worktree)
shows that workspace's panes on the same click and highlights the row; every other workspace's
panes stay mounted but hidden, so switching back finds each terminal exactly as it was (same
output, same program, no resize). A workspace with no pane yet gets a plain shell on first click;
a workspace whose last pane was closed shows "No terminal open here" with an "Open a shell"
button. A launch from the plus menu switches to the new worktree. Removing a workspace from the
sidebar closes every pane inside it wherever it was, and the view falls back to the start-up
PowerShell pane if the removed one was in front.

T-007-a fills the agent catalogue: all 34 visible agents of SESS-001 in its order, each with its
program name(s) from SESS-051 and its fixed start arguments (Kiro `chat --tui`, Command Code
`--trust`, Hermes `--tui`). Detection walks the PATH and then the usual install folders (npm's
global bin, nvm's current or newest version, `~\.local\bin`, cargo, bun, volta, WinGet links,
scoop shims, `%LOCALAPPDATA%\Programs\*`) without spawning anything; only a runnable file with a
PATHEXT ending counts, never a folder or a plain file. The plus menu now lists only the agents that
were found (on this PC: Claude Code and Codex), the default agent first with the "new agent tab"
shortcut beside it when one is bound, and every other row has a "default" button; the choice is
saved as `defaultAgent` in `settings.json` and the bound shortcut (`tab.newAgent`) starts the
default agent. An npm-installed agent whose entry is a `.cmd` shim (Codex) now starts through
`cmd.exe /d /c`, as the command line would.

T-007-b adds the chooser pane (SESS-007): the plus menu (sidebar "New session" and a pane's "+")
has a "Choose what to run…" item, and an empty workspace offers a "Choose what to run" button;
either opens a pane titled "Session N · Choose what to run" in which nothing runs yet. Each seat is
a radio group of the installed agents plus Terminal, and once an AI is picked a second radio group
asks for the model (Claude Opus/Sonnet/Haiku, Codex GPT-5 Codex/GPT-5, Gemini, Cursor, Grok lists,
plus "Program default" for every agent, which adds no flag); Start stays disabled until every seat
has both picks, Terminal counts as ready at once. A count row (SESS-013) offers 1, 2, 3, 4, 6, 8
and a free number field (applied on Enter, blur or the spinner, so typing "15" never passes
through a one-seat moment): new seats arrive empty, shrinking drops seats from the bottom and keeps
the rest untouched, 15 gives fifteen seat blocks in a scrolling body. Start replaces the chooser
with one pane per seat in the same grid position: agent seats run in the chooser's workspace (or in
one fresh worktree when the chooser sits outside any workspace) with `--model <id>` appended to
the start line, terminal seats open a shell in the same folder. The chooser's close button is
absent when it is the only pane shown.

T-008-a finishes the seat rules (SESS-015) and the landing (SESS-024). The chooser opens on the
caption "Every seat starts blank. Kolux never picks an AI or a model for you."; a "Same for all"
button, greyed until a seat is finished (and with one seat), copies the first finished seat's AI
and model into every seat while job titles stay per seat; a pick whose agent is no longer detected
is cleared, never swapped. Each seat has a "Job title (optional)" field. Start shows a passing
toast ("Starting 3 sessions"), the panes land one per seat and the grid re-tiles; a seat's job
title names its pane (the workspace chip still shows the worktree), a pane without one keeps the
workspace name, and a pane outside any workspace reads "Terminal N". A pane whose session fails
to start is dropped instead of left blank, with the reason in a toast, and "Nothing started: …"
when the whole lineup is gone. Without a project the error toast explains that an agent needs a
repository.

T-008-b gives every catalogue agent its start line and opening-prompt route (SESS-051). An AI seat
in the chooser has an "Opening prompt (optional)" box; the back end builds the line from the
catalogue: the prompt goes last for Claude Code, OpenClaude, Codex, Pi, OMP, Command Code, Cursor
and Droid, behind `--` for Trae, Prime Agent and Grok (a prompt beginning with a dash stays the
task), behind `--prompt` for MiMo, `--prompt-interactive` for Gemini CLI and Antigravity, `-i` for
GitHub Copilot, and through `chat --query <prompt> --tui` for Hermes (the user's own `--query` /
`--tui` arguments give way; a line past 24,000 characters is refused and Start reports it); the
other agents start bare and the prompt is typed in once the program has drawn its screen and gone
quiet. A blank prompt adds nothing. A foreground matcher credits a running program to its agent
(case, folder and `.exe`/`.cmd` endings ignored, `kimi-code` → Kimi, `mistral-vibe` → Mistral
Vibe, `codex-…`/`grok-…` builds, and interpreter runs such as `node …/claude-code/cli.js`); nothing
polls it yet.

T-009 turns the pane area into a real grid (TERM-001, TERM-004, TERM-006, TERM-014). A workspace
holds 1 to 12 panes tiled in balanced rows (1, 2, 2x2, 3x2, 3x3, 4x3; `src/terminal/grid.ts`).
The layout strip's 1 / 2 / 4 / 6 buttons set the count of the workspace in front and the pressed
button is the current count (none at 3, 5 or above 6): growing adds empty chooser panes, nothing
starts on its own; shrinking removes unstarted panes newest first and never a started session (a
toast says to close one instead). Every pane header has a split button that opens a shell beside
it in the same folder; Ctrl+Shift+D (split right), Alt+Shift+D (split down: the cell below; from a
single pane the pair is stacked, one column of two rows, until a split right makes it side by
side again, T-009-fix-a) and Ctrl+W (close the focused pane) go through the shortcuts file. Closing a pane ends its program and
the neighbours take the space; closing the last one leaves the workspace's empty placeholder.

T-010 gives every grid cell tabs (TERM-040, TERM-041, TERM-068). The strip's "New tab" menu (and
Ctrl+T) opens a shell as a tab beside the focused pane, started in the workspace folder and ready
to type; the menu also lists every installed agent, each with its own `tab.newAgent.<id>` command
(unbound unless the shortcuts file says otherwise) that opens a tab with that agent starting in the
workspace folder; outside any workspace an agent still gets a fresh worktree. On the New look a cell with one tab
shows no tab strip and sessions are 14 px rounded windows with gaps (T-048); Classic keeps square panes edge to edge and always shows the strip; with two or more, the strip sits above the pane and each tab
closes from its own x, the next tab taking over. A requested start folder for a new terminal may
be relative to the workspace or absolute, and a missing one falls back to the workspace folder.
Paste (Ctrl+V, Ctrl+Shift+V, Shift+Insert) goes through the focused pane's own text area, so it
can never land in another pane, and a paste made while an opening prompt is still owed waits for
it.

T-011 gives the Board its first life (VIEW-026). The Board lists every pane of every workspace as
a card (the pane header: status, name, program, the header buttons), in cell and tab order; a
card's expand button shows that session's live terminal inside the card and the same button
collapses it again. The panes never move in the page: the grid and the Board are the same cells
drawn two ways, so the program, its scrollback and the pane's place in the grid are untouched
by expanding, collapsing or switching screens (a command typed in the card shows in the grid
pane afterwards, and the other way round). Switching to Agents or Board no longer unmounts the
terminals (it did before T-011).

T-012-a adds browser tabs (BROW-001, BROW-002). The New tab menu's "Browser" item (Ctrl+Shift+B)
opens a "New Tab" beside the focused pane: a pane whose header is a globe, the page title and an
address bar that takes the cursor at once, over a blank page. The page is a real child web view
of the window (Tauri `Window::add_child`, feature `unstable`), laid over the pane body and moved
with it, so sites render exactly as in Edge, without the iframe limits. Away means hidden, never
torn down: switching to another tab, to the Board or to Agents keeps the page's scroll, form
fields and history, and a page's `window.close()` does nothing to the tab. The tab is named after
the page's title. The bar takes a full address only until T-012-b (typed words, back / forward,
reload / stop).

T-012-b makes the bar and the toolbar work (BROW-003, BROW-005). Enter reads the bar: a full
web or file address is taken as is, `localhost:3000` opens over HTTP, `example.com` over HTTPS,
an absolute path on disk as a file address, and anything else is a Google search; `javascript:`,
`mailto:` and every other scheme are refused with a red notice and the page stays. Ctrl+L
puts the cursor in the bar with its text selected. Back and forward sit before the bar and dim
when there is nothing that way; reload turns into Stop inside a spinner while a page loads.
History is the tab's own record of its loads (a redirect replaces its entry), since the web
view does not say whether it can go back. The harness now drives the app through WebView2's
own debugging port (`scripts/evidence/cdp.mjs`), so chords and typing land even while another
window holds the foreground.

T-013 finishes the project and workspace flow (PROJ-001, PROJ-007, PROJ-020, PROJ-021). Adding a
project, whichever worktree was picked, registers its main checkout, opens that checkout with a
shell and lists its worktrees, minus a coding tool's scratch worktrees (any worktree under a
dot-folder inside the checkout, such as Claude Code's `.claude/worktrees/`). Mod+N or the
header's plus opens the name field for the project in front; the preview shows the branch and
folder the name becomes, a name with no usable letters becomes `workspace` (T-109-a), and a taken
branch or folder name gets `-2`, `-3`, counting local and remote branches. Create shows a
stand-in row at once; the new workspace then opens with its own shell unless the user moved to
another workspace meanwhile. The row shows the name as typed (emoji included), the branch and
folder carry the cleaned form; typed names live in the state store under `workspaceNames`.

T-014-a decides where a workspace goes and what it starts from (PROJ-025, PROJ-028, PROJ-038).
The footer gear's form sets the global workspaces folder and the layout: nested (a folder per
project, the project's folder name minus `.git`) or flat (every workspace side by side). The
project row's gear sets that project's own folder (absolute, or relative to the project root)
and base ref; folders used before are offered from a list. Create starts the branch from the
typed ref, else the project's saved base, else the default branch (origin/HEAD, then
main/master, then the current branch). A remote-tracking base is fetched first; a saved base
that no longer exists falls back to the default branch and says so in the sidebar note; a full
commit id is used as is. The create form also takes an agent and a first prompt: with an agent
chosen the workspace opens with that agent running as its first tab and no shell.

T-014-b is the first command line (PROJ-077). The app listens on a loopback port and writes the
port and a token to `cli.json` in its data folder; `kolux-dev` (`src-tauri/src/bin/kolux-dev.rs`,
all logic in `src-tauri/src/cli.rs`) sends one request per call. `kolux-dev worktree create
--name <name>` makes a workspace in the project the shell is standing in (or `--repo`
id:/name:/path:), from `--base-branch` or the project's base; `--agent` with `--prompt` starts
that agent in the new workspace's first tab, in the background unless `--activate` (or the older
`--run-hooks`) shows it. `worktree rm` (also remove, delete) takes `--worktree` current, name:,
branch:, path: or id:, refuses a checkout with uncommitted changes unless `--force`, closes its
panes and removes it (with `--force` the branch stays; T-160). `--json` prints the envelope (request id, success, result or error with
code, message and data, runtime id); exit 0 worked, 1 any error; help works with the app closed,
and a closed app answers "Kolux is not running; start it first".
T-117-a adds the lookups (CLI-009, CLI-015..017): `repo list`, `repo add --path` (relative to the
shell's folder; the sidebar shows it at once), `repo show`, `repo set-base-ref --ref` (checked
against Git first; new worktrees then start there), `repo search-refs [--query] [--limit]`
(branches, remotes and tags, case-insensitive), `project list` (the sidebar's projects in its
order), and `worktree list | ps | show | current`: each row carries its selector
`id:<repo-id>::<path>`, repo, branch, parent and children, lists say which hosts they covered
(local; none left out) and whether `--limit` cut them short, and `ps` shows only worktrees with an
open terminal, with each terminal's handle and program. Selectors: `--repo id:|name:|path:`;
`--worktree active|current` (the innermost worktree around the shell's folder; outside one it
says how to name one), `id:` or `identity:` `<repo-id>::<path>`, `name:`, `branch:`, `issue:`
(the issue it was made for) or `path:`; a bare value such as `42` is refused with the accepted
forms, two matches are refused as ambiguous, and `folder:` says folder workspaces are not built.
T-118 adds `worktree changes` and `worktree overlap` (CLI-021), both read-only and for the
worktree of the shell's folder unless `--worktree` names one. changes lists every file that
differs from the base (the repo's saved base, else its default branch; nothing is fetched),
committed and uncommitted together, untracked files as U. overlap names each sibling worktree of
the same repo, hidden ones included, that touches the same files, and predicts from the
committed tips whether they would conflict (and in which files); when Git cannot check the
merge (unrelated histories, an old Git) it says unverifiable, never clean. A sibling whose
changes cannot be read (its folder is gone) is listed apart, and the text then says the scan was
incomplete instead of claiming no overlap.
T-129-a makes `worktree ps` an orchestration summary (ORCH-040): one row per worktree that has an
open terminal or an unfinished worker, each worker with its dispatch, task, status and terminal,
and a scope line (repos, worktrees scanned, how many have work, this computer only). When a repo
cannot be scanned (its .git moved, git failing) or the scan takes over 3 seconds, its last known
worktrees are still listed, marked `[last known]`, and the scope line says why; a scan result,
failed or empty included, is reused for 1.5 seconds so polling does not start git each time. A
terminal polling with `--json` gets the whole snapshot once, then `{"unchanged": true}` while
nothing changes; text output is always the full list.

[core] T-134-a adds `kolux-dev terminal read | send | wait` (CLI-024, CLI-025). The reader thread keeps an `OutputLog` per session in `terminal.rs` (last 2000 lines, each numbered with a cursor, escapes stripped, a split UTF-8 character joined across chunks, a redrawn progress line kept in its last state); `read --cursor n --limit k` pages forward and warns when kept lines were dropped or more follow; `--screen` asks the window for the pane's xterm rows (`terminal-screen-request` event, `terminal_screen_reply` command, 1.5 s wait) and falls back to the stream with a warning. The stream is output with escapes removed, not a rendering: a line editor's redraws can leave traces in it. `send` writes `--text` (bracketed paste into an agent pane), `--enter`, `--interrupt` (Ctrl-C and the status cancel); a prompt (text + Enter to an agent) is watched for `--wait-submit` seconds through the status hooks' history and answers `turn_began`, `queued` or `unknown`; `--retry-request` replays a receipt kept in memory. `wait --for exit|tui-idle --timeout-ms` polls from the CLI side; a pane without hook reports counts as idle after 3 s without output, with a warning; permission, waiting and blocked end the wait non-zero. On this PC a pane's PowerShell start sets CLAUDE_CONFIG_DIR back to the user's real folder whatever the app was started with, so the Claude hook proof used a hand-posted report; a real pane's hooks firing is T-025-d's.

[core] T-139-b ties a Codex pane to the account it started on (ACCT-023, ACCT-064). `terminal_spawn` takes `account` (null for Codex's own sign-in, absent for a fresh pane) and answers the id it used; a pane restarted with its account waits up to 2 s for that account's home (`codex_accounts::wait_home`) and refuses with a try-again message when the account is no longer listed. `src/terminal/accountChange.ts` decides the prompt: only a running pane whose program is credited as Codex and that knows its account is asked; an active account other than the pane's shows the centred keep/restart prompt (`PaneNotice` in TerminalPane, `.pane-ask` overlay, primary button focused only when the pane is focused and visible); keeping remembers that account for that pane, a further change asks again, going back to the pane's own account clears the prompt; an account that was removed shows the needs-a-new-account prompt with Restart (or Open Settings when no account is active). Restart remounts the pane with a new key on the active account. Not built: the setup-change version of the prompt, re-asking after a Kolux restart (no pane restore yet), pane-output scanning for Codex sign-in errors (T-139-d); a failed restart is a failed launch (DT-C19).

[core] T-145-b makes a program's colour and light/dark questions work through the Windows console layer (TERM-098). Measured in `pty.rs` tests: the palette question (OSC 4 "?"), the light/dark question (CSI ? 996 n) and the subscription (CSI ? 2031 h) reach the pane; the foreground/background questions (OSC 10/11 "?") never leave the console layer (DT-C20, T-145-c). What was lost was the reply: written as plain bytes the console drops it, so `PtySession::write` sends a reply (anything starting with OSC, or CSI ? 997 ;) as win32-input-mode key events, a key-down and a key-up per character (down only makes the console coalesce repeated characters: `dddd` read back as `ddddd`). Live: a PowerShell pane asking `CSI ? 996 n` and `OSC 4;1;?` got `CSI ? 997 ; 2 n` (light mode) and the Tango red back. The output event now carries the pane key, and the pane matches output by key until the spawn call has answered with its terminal id, so the program's first frame and its cursor question are no longer dropped; a fresh tab shows only the prompt.

[core] T-050 builds the Agents screen (VIEW-015, VIEW-021) and squares the Board with VIEW-024. `src/agents/rail.ts` is the pure part: `railGroups` puts every pane that is an AI session (a program started as a saved agent, remembered on the pane as `agentId`) or a not-started preset under its saved agent, in Settings > Agents order, with AI sessions that match no switched-on installed agent under Other sessions; plain shells, agentless choosers and editor / browser tabs are never listed. `pickSession` keeps the remembered pick while it exists, else takes the first agent with sessions on its newest one. `AgentsRail.tsx` draws it where the worktree sidebar sits (a 268px card; 240px flat under Classic, which never reaches the screen), rows reuse the sidebar row look, + on a group adds a chooser pane with that agent in its seat and selects it, and with no agent switched on the rail is an empty state with an Open Settings button. The body is the picked session's own pane: the grid and the Board are already the same cells drawn two ways, and Agents is the third drawing (one cell shown, its tab strip hidden, the picked pane as the cell's active tab), so the terminal is never remounted. A preset started from the chooser keeps the selection on the session it became. The chat thread, composer and Show terminal switch of VIEW-019 need the transcript and chat tasks and are T-050-b; until then every session shows its terminal. For VIEW-024 the Board's lanes and empty state now count only terminal panes (`cardPanes`), so an editor or browser tab alone no longer raises an Idle lane, and pane headers show the saved agent's name (Claude Code, Codex) in place of the program word. Live: two Claude Code panes, a Codex pane, a shell and a browser tab gave the rail Claude Code [2, 3*] and Codex [4]; the pick survived Board and Terminals; + under Claude Code added a selected New session whose chooser had Claude Code in seat 1; switching Codex off moved its session to Other sessions; Start turned the preset into session 7, still selected; the Board showed five cards in tab order and none for the browser tab.

[core] T-028-b puts the fixed status word on every Agents rail row (VIEW-017). `rowStatus` in `src/agents/rail.ts` is the whole rule: a not-started preset reads Not started; a session reads the word the Board's chip already gives the same signal (`chipOf`, so Starting with no process yet, Stopped once the process ended without a done signal, No recent update for a stale working reading and never Working then, Needs you / Done / Idle / Queued from the hook state), and a session with no signal reads Idle. The word's tone and tip come from the status vocabulary (`VOCAB`), so the rail, the sidebar dots and the pane headers never disagree on a word. The rail takes a `statusOf` callback and App hands it `chipFor`, the same call the Board makes. The cannot-reach word exists in the vocabulary but nothing can show it yet: there are no remote hosts in this build (DT-C21). Live: a fresh Claude Code pane read Working and the preset Not started; killing claude.exe from outside with no done signal turned the row to Stopped within 1.5 s and it stayed there.

[core] T-040-b finishes the usage figures on the Agents screen (USAGE-004, VIEW-018). A rail row with a context reading carries the same ring as its tab (`ringOf` in App is the tab ring's expression; rows without a reading have none). The rail's footer is `usageLine` in `src/usage/meter.ts`: the picked session's provider, its 5-hour window as used or left, and the local reset time in the words the Codex pill already uses (`resetWords`); a broken value reads 0, never NaN; a provider with no 5-hour window, a failed read, a plain shell or no pick leaves it empty. Used or left follows the `usageReads` settings key (`left`, anything else means used; USAGE-025's Appearance control is T-263, which now only has to write the key). On the Agents screen the pane header shows the agent's 5-hour and weekly figures beside the context gauge, which is the compact meter in the detail header. Live: after a status-line report for the Claude pane (84k of 200k, 5-hour 12%, weekly 37%) its row grew a 42% ring while the Codex row and the preset had none; the footer read Claude 12% used · resets today 11:00 PM, Codex 0% used · resets today 05:04 PM on the Codex row, and Claude 88% left once the key was set.

[core] T-144-a makes the pane grid's dividers draggable and the pane header shrink in order (TERM-010, TERM-024). The grid's gap is the divider, 6 px and uncoloured by default per DT-A7 (Appearance's `dividerWidth` and the two colours still apply), so there is no divider element: a left-button press on the grid itself finds the gap under the pointer from the visible cells' edges (`tracks`, `gapAt` in `src/terminal/dividers.ts`), the grid captures the pointer, and every move rewrites that folder's column or row weights (`dragWeights`: weight moves between the two tracks the divider sits between, the sum holds, neither track goes under 120 px) into `grid-template-columns` / `-rows` as `minmax(0, Nfr)` tracks. Weights are keyed by folder, axis and track count, so changing the layout starts even again; they live in App state only (not saved, which is the layout-restore task's job). While a drag runs the root carries `data-divider`, the whole window shows the resize cursor with selection off, and each pane refits xterm but skips `terminal_resize`; pointer up, cancel or a lost capture ends the drag and fires one `kolux-divider-done` event, on which every pane sends its program the final size once. The pane is a CSS size container: under 344 px the branch chip hides, under 264 the program word, under 204 the header buttons, under 134 the status word and the whole right group, and the title truncates. Live (two-pane layout, 1087 px grid): hovering the gap gave the col-resize cursor; a 200 px drag went from 540.5 / 540.5 to 340.5 / 740.5; a drag held mid-way set `data-divider=col`, a release at x=-80 (outside the window) cleared it and kept the last position; a drag past the right edge stopped at 961 / 120; at 130 px the header showed only dot, mark and a truncated name, at 250 px dot, mark, name, Ready and the buttons but no program word. Font settings and zoom are T-144-b, the right-click menu T-144-c.

[core] T-102-a adds the tab strip's close menu and closing tabs in bulk (TERM-044, TERM-049, and the leftover of TERM-045's task). Right-clicking a tab opens a menu at the pointer with Close, Close others, Close to the right, Close to the left and Close all; `closeSet` in `src/terminal/tabClose.ts` names the tabs each item takes from the strip's visible order, and an item with nothing to take is disabled, so the first tab's Close to the left and the last tab's Close to the right are grey. The menu goes on Escape, a click outside or a second right-click outside; the right-click that opened it never closes it (the tab handler stops the event). Middle-click closes the tab. Ctrl+Alt+W (`tab.closeAll`, the keymap's existing id) closes every tab of the focused pane's strip. Every bulk close is one `closeTab` call with all the keys, so TERM-045 asks one question for the set and `dropPanes` removes them together. Focus after a close follows `returnTab`: the surviving tab used most recently (App keeps the focus order newest first), else the active tab's right neighbour, else the one on its left, never a tab that is closing; an empty strip falls back to the old `focusIn`. Live: four shell tabs; the menu on tab 1 had Close to the left disabled, on tab 4 Close to the right disabled, Escape dismissed it; after using tab 3 then tab 2, Close on tab 2 returned to tab 3; middle-click closed tab 1 with focus staying on 3; Close to the right on tab 3 closed tab 4; Ctrl+Alt+W closed the last tab. Not yet: pin or unpin (so middle-click and bulk close spare nothing yet), Change Title, Tab Color and the split items (T-102-c), pane drag and tab reorder (T-102-b).

[core] T-174-a proves the command line's local channel and makes worktree removal stop its processes first (ORCH-054, ORCH-058). The channel is the loopback TCP port and token file T-014-b built (DT-C22 records that a loopback socket is the card's local socket): `run-current` from inside a pane answered in 17-30 ms; a waiting check or ask is a half-second re-poll with a keepalive line on stderr every 15 s, not one held connection, so nothing times out server-side. Live: an ask from a pane tied to a Run, posted 17:45:31 with a five-minute limit, printed 19 keepalive lines and returned the answer from the coordinator pane at 17:50:11, the moment the reply was sent. A pane Kolux opens now also sets `KOLUX_USER_DATA_PATH` to this app's own data folder next to `KOLUX_APP_DIR`: Kolux started from a shell that carried an older build's override handed it to every pane, where it beat the pane's own folder and the command line looked for `cli.json` in the wrong place (COMPAT 7 still holds outside Kolux panes). `kill_under` now ends each shell together with everything it started (`procs::kill_tree`: `taskkill /T /F` on Windows, the process group elsewhere), then waits up to three seconds until every pid is shown gone (`procs::wait_gone`, a snapshot walk on Windows, `kill -0` elsewhere) and returns `Stopped { ended, stuck }`; a record with no process behind it is swept and never counts as stuck. `worktree rm` refuses with code `stuck` naming the pids unless `--force` waives it (the result carries `stopped` and `stuck`), and the Projects panel's delete refuses the same way unless its force box is ticked. Live: a shell pane started in a worktree ran `node -e setTimeout(600000)`; `worktree rm` took 570 ms, answered stopped 1 / stuck [], the folder was gone, no node with that command line was left, and the pane's handle no longer existed. Tests: the pure wait classifies gone / live / unknowable pids, `kill_tree` ends a cmd shell and the ping it started, and `kill_under` on a real PowerShell session frees its folder for deletion and sweeps a stale record. Not yet: prompts landing exactly once (T-174-b); closing chat-style sessions on removal (there is no chat view to close yet).

[core] T-058 builds the built-in protected rules (SAFE-009, SAFE-010, SAFE-011, SAFE-012). The Claude hook script now prints Kolux's answer (Codex's and the status line's still discard it), and `hooks::reply_body` answers a PreToolUse for Claude's Bash or PowerShell tool with the ask block (`hookSpecificOutput`: event PreToolUse, decision ask, reason `Kolux protected action: <rule>. The command waits for you; allow it once to run it, or refuse to leave it unrun.`, the rule name cut to 120 characters) when `protected::check` finds a rule; anything else, a body that cannot be read included, gets `{}`, so Kolux never blocks on its own. `src-tauri/src/protected.rs` holds the six rules with ids `force-push`, `discard`, `db-drop`, `stripe`, `infra`, `prod-deploy` (the recursive-delete rule is T-059): git's global options before the subcommand are skipped, force is any force flag (lease, mirror, a bundled short flag) or a plus refspec, deletion is the flag or an empty-source refspec, and the target asks when it is main, master, HEAD, @, a substitution or missing; a hard reset or a forced clean that is not a dry run; a database client (psql, mysql, sqlite3, sqlcmd, mongosh, supabase, prisma, wrangler, bq, duckdb and the like) with a drop of a table, database, schema, view, index, user or role, a truncate or a shell `.drop(` anywhere on the line, and `dropdb` always; a live Stripe key outside a text search, or the Stripe CLI with `--live` or a changing verb in its first words; terraform/tofu/terragrunt apply or destroy, pulumi up/update/destroy, cdk deploy/destroy; a production marker together with a deploy CLI or the word deploy. A command is split on `;`, `&`, `|` and newlines outside quotes and leading assignments, sudo/env/npx/pnpm/timeout and the like are stepped over; substitutions, nested shells and encoded PowerShell are SAFE-014 (T-059). Settings `protectedAsk` (master, on unless false) and `protectedOff` (ids) are read from settings.json on every hook, so a switch applies to the next command. Live: from a pane, the installed script answered the force-push body with the ask in 40-100 ms, `git status`, a Write tool, a garbled body and a Stop with `{}`; with `protectedOff: [force-push]` the force-push answered `{}` while `git reset --hard` still asked; with `protectedAsk: false` both answered `{}`; restored, both asked again. Not proven: the ask seen inside a signed-in Claude (T-058-b, needs Txais's account). Found: every Kolux RS build on the machine shares `~/.kolux-rs/agent-hooks/`, and another lane's app rewrote the script with its older template mid-proof; harmless after the lanes merge.

[core] T-059-a adds the recursive-delete rule and the full command reading (SAFE-013, SAFE-014). `protected::segments` now reads a command as a chain: split on `;`, `&`, `|`, newlines and grouping marks outside quotes; `$( )` and backtick substitutions are pulled out and read as commands of their own (four levels deep, the outer text keeps a `$sub` placeholder so the path reads as unknown); wrappers (sudo, doas, nohup, time, nice, env, xargs, timeout, npx, bunx, pnpm/yarn/npm/bun exec, exec, command, builtin, start, wsl) are dropped together with the options of theirs that take a value, attached or not, and timeout's length; what sh/bash/zsh -c, cmd /c, /k and //c, PowerShell -Command (any shortening; value switches such as -ExecutionPolicy, -ep, -WindowStyle, -of and -wd skipped; -File carries nothing), an encoded command (-e, -ec, -enc, -EncodedCommand; base64 of UTF-16LE), eval and iex are given to run is read in their place. The seventh rule `delete` (Deleting folders outside the workspace) walks the segments in order: cd, chdir, Set-Location, sl and pushd move the base (bare cd to home, bare pushd, popd, `cd -` or a variable to unknown); rm with -r in any bundle or --recursive, rd/rmdir/del/erase with /s (also run together, `/s/q`), Remove-Item/ri with -Recurse under any shortening, with -Path/-LiteralPath values and comma lists read as targets, ask when a target is unknown (variable, `~user`, drive-relative, relative with no base), outside the workspace, the workspace itself, its `.git`, or when no target is named (names from a pipe); a wildcard is judged by its folder; TMPDIR/TEMP/TMP, /tmp and /var/tmp run; paths are compared as text with backslashes, Git Bash drives and `..` folded, case ignored on Windows. `Base` carries workspace, cwd, home and temp roots; `hooks::reply_body` builds it from Claude's hook `cwd` (DT-C23). Live: from a pane at G:\Dev\kolux-rs-lanes\core, every SAFE-013 and SAFE-014 acceptance command answered as the cards say (`.git`, `~/Documents`, a bare cd, piped names, `bash -c`, `$( )`, `cmd //c`, sudo/nice/env/timeout, `Remove-Item -Recurse -Force ~`, `-ep bypass -WindowStyle Hidden -Command`, an encoded command: ask; node_modules, `cd src && rm -rf build`, a temp folder, `rd /s/q build`, `echo "rm -rf /"`, `sudo -u root ls build`, `-Command "Write-Host hi"`: no opinion). The Safety page section and secret masking are T-059-b.

[core] T-060 builds the host-path refusal and the program reveal (SAFE-021, SAFE-022) in `src-tauri/src/links.rs`. `host_path(text, roots)` reads the path as text only: a `file:` URL is unwrapped (a host other than localhost, wsl$ or wsl.localhost refuses; the path part is percent-decoded), slashes become backslashes, and a path with two leading backslashes is a host unless it is a WSL root, a long-path drive (`\\?\C:`), or lies under a registered project root or the workspaces folder that is itself a share; any such path with a `..` segment is a host whatever its root, and `\\?\UNC`, `\\.\UNC`, `\\.\pipe` and other device names are hosts. `refuse_host` returns the "on another computer" error and now guards `file_read`, `file_write` and `dir_list`; `path_kind` answers "remote" (the explorer treats it as a file and the read then refuses). `open_path(path)` is the one command for handing a file to the system: a host path or a relative path is refused, `launchable` (the `program_like` type list of about 140 entries, with the Windows disguises stripped: an alternate-data-stream suffix, trailing dots and spaces, and the 8.3 short-name shape of a stem up to eight characters holding `~` and a digit with an extension up to three; plus the execute bit on POSIX) sends it to `reveal` (explorer /select, open -R, xdg-open of the folder) and answers "revealed", anything else goes to `artifacts::system_open` (factored out of `open_external`) and answers "opened". Live through the WebView's debugging port: every host form refused in 2-3 ms, a local folder, a long-path file and a WSL root looked up as before, a batch file revealed in File Explorer with itself selected and its marker never written, a text note opened in the default app. Terminal and note links do not exist yet; they will call `open_path`. No grant flow exists; the exact-file grant rule waits with the project fence (T-062).

[core] T-061 builds discard (GIT-003). `scm::discard(worktree, paths)` in `src-tauri/src/scm.rs` reads the status once and sorts each path: an untracked path, a staged addition or the new name of a rename is removed for good; everything else is put back as HEAD has it. Staged paths are unstaged first (`git reset`), tracked paths come back through `git checkout HEAD` with the paths handed on stdin NUL-separated and literal (`with_paths`, which `stage` now shares), and a tracked path that is currently a link is removed before git rewrites it, so git never writes through a link; a removed path is a file, a link or a folder removed as itself (`remove_dir_all` does not follow links), so no link's target is ever touched, inside or outside the repository. The panel (`src/scm/SourceControlPanel.tsx`) has a discard arrow on every row, a discard-all on every section and a Discard N button on the selection bar; each opens the shared CloseAsk dialog (now taking its button label and a child list) with the question from `discardPlan` in `src/scm/model.ts`: one new file asks Delete ("removed for good"), one deleted file asks Restore ("comes back as it was in the last commit"), one modified or renamed file asks Discard ("its edits since the last commit are lost"), several rows get the counts of each kind, and every version ends with "There is no undo."; the rows are listed in a `.ask-list` that scrolls past 240px while the buttons stay below it. The confirm button is focused on open, Escape or Cancel keeps everything. Live on the brisk-puffin worktree: an untracked file deleted, a link aimed at a file outside every repository removed with its target untouched, a deleted README restored, a 40-file Untracked section deleted after a question with the list scrolling and the buttons in view, a modified README discarded. The panel is a flat list, so a folder is discarded through its rows (select them) or its section; the explorer does not yet notice files removed by Source Control (it refreshes on its own schedule).

[core] T-062-a builds the file fence (EDIT-045, the rest of EDIT-053, the Windows removal retry of EDIT-044). `links::fence(path, roots, grants, follow)` in `src-tauri/src/links.rs` is the one check every file command runs first: the path must be on this machine (`refuse_host`), a full path, free of `..`, and inside a root as text (a project, its own workspaces folder or the shared one; a sibling folder whose name merely starts with a root's is outside); then the place it really leads to is resolved (`canonicalize` of the deepest existing ancestor, the rest re-appended, the long-path prefix stripped) and must still be inside a resolved root, so a link out of a project is refused for reading, writing and listing (`follow`), while renaming, trashing or moving the link itself only needs its folder inside. `Grants` (managed state) holds paths allowed for this run by exact key (`fence_key`: Windows folds case and slashes); `file_grant` adds one, the host and full-path rules still apply, and nothing beneath a granted path is covered. `files.rs` (`file_read`, `file_write`, `dir_list`; `path_kind` answers "outside" for a fenced path and "remote" for a host) and `fsops.rs` (`fs_create`, `fs_rename`, `fs_trash`, `fs_restore`, `fs_copy`, `fs_move`; the async ones now return a Result and take the roots and grants snapshot before their blocking work) all go through it. The editor's refusal notice (`src/editor/EditorPane.tsx`) offers "Open this file anyway" when the message is the fence's; it grants that one path and retries. `fsops::remove_retrying` retries a Windows removal up to five times (60 ms apart) on a sharing or lock violation or access denied. Live on the brisk-puffin workspace: reads, writes, lists, trash, rename, copy and move outside the projects refused with their own messages, a `..` step refused as text, a link aimed at an outside file refused through the explorer, then opened through the grant button with the target's text shown, the target's own path still refused, a granted folder's child refused, a share path and a relative path refused by `file_grant`. Not built: the WSL-only rules (T-062-b); a workspace's folder never changes mid-save in Kolux RS, so that refusal has nothing to guard.

[core] T-063 fences the agent endpoints (BROW-051). Kolux RS has two local endpoints that agents' tools use, both bound to 127.0.0.1 on a port chosen at start with a random token: the hooks HTTP endpoint (`src-tauri/src/hooks.rs`, `agent-hooks-endpoint.txt`, called by the generated hook scripts with curl) and the CLI line port (`src-tauri/src/cli.rs`, `cli.json`, one JSON line per request from `kolux-dev`); browser page control (T-195) goes through the CLI, so these are the endpoints the card fences. `hooks::gate` runs before any route: a request carrying an Origin, Referer or Sec-Fetch header (every browser adds them, no tool does), a Host naming anything but 127.0.0.1, localhost or [::1] (DNS rebinding aims a name at 127.0.0.1), or no or a wrong token gets 404 with an empty body, so the bare host and port, the routes and the hook answer stay hidden. The CLI line port drops an HTTP-shaped request line (anything a web page can send) without a byte back and runs nothing. Live: curl with the token works and every variant with a web header, a foreign Host or no token gets 404 and 0 bytes; the LAN address refuses the connection on both ports; a raw HTTP post to the CLI port closes with nothing back while the cli.json token lists the projects; from the app's own page every fetch fails or comes back opaque. The token in a header (or in the request line) stands in for the card's secret path (DT-C24): a secret in the URL would show in logs and histories.

[core] T-064-a builds the diagnostics log (APP-041). `src-tauri/src/diag.rs` is the app's own record: `write` appends one line to `<profile>/logs/kolux.log` (seconds since the epoch, then the text) and never fails the action it records; past 512 KB the file moves aside as `kolux.<millis>.log` and the oldest files go until the ones aside fit in 2 MB. `secrets::log` now delegates to it, so the sealing pass and the resume timer land in the same file; lib.rs writes `app start <n>, Kolux RS <version>` and `app exit`, terminal.rs writes `terminal <id> started (<program or shell>)` and `terminal <id> exited (<code>)` (never the arguments: they may carry secrets; pane output is not recorded at all, so a key a program prints never reaches this log). The logs folder inherits the user-only permission the sealing pass puts on the profile folder (ACCT-009; icacls shows the one user). `scrub` masks, word by word and idempotently with one mask string: credentials in an address (`scheme://user:pass@host`), `name=value` / `name:value` / `"name": "value"` where the name carries key, token, secret, passw, pwd, credential, auth, cookie, bearer or signature, any `UPPER_SNAKE=value` line, `--token x` / `-p` style flags and `Bearer x`, and token shapes by themselves (sk-, ghp_, github_pat_, xox*-, AKIA, AIza, glpat-, npm_); a bare `name:` with the value in the next word counts only for a quoted JSON name or an exact secret word, so a log prefix like `secrets:` keeps its line. `bundle` is a header (version, time, OS, arch) and every log file oldest first, scrubbed. Commands: `diag_bundle` (the page copies it with `clip_write`), `diag_review` (writes `<profile>/diagnostics-review.txt` and opens it with the system handler), `diag_review_discard`. Settings > General got a Diagnostics section (`DiagnosticsCard` in GeneralPage.tsx) with the three buttons and a note line. Live: a session ran a command with a fake key, a line with a key and an address password was planted in the log, Copy diagnostics put the bundle on the clipboard with both masked and the fake key absent, the review copy on disk had them masked and was gone after Throw away.

[core] T-064-b states the privacy promise (APP-070). `src/settings/privacy.ts` holds `OUTBOUND`, the whole list of connections the app itself makes: GitHub Releases (the updater), the user's git remotes and GitHub account (through git on the computer), the AI providers (each agent's own CLI with the user's account; the app neither relays nor records that traffic), the sites opened in the browser pane, the script CDNs when an artifact is saved for offline use, and Microsoft from the WebView2 runtime (the Edge engine's own startup checks, which the app cannot switch off: `--disable-background-networking` was tried and changed nothing). `feedbackUrl(version, platform, text)` builds GitHub's new-issue address for TxaisX/kolux (APP-037 Compat) with a `[Feedback]` title from the first line (80 characters at most) and a body of the text plus `Kolux RS <version> on <platform>`, trimmed with a note when the address would pass 8000 characters. `PrivacyCard` in GeneralPage.tsx shows the statement, the list and a Send feedback button that calls `app_info` then `open_external`; the note says the app sent nothing (the message box itself is T-249). `scripts/privacy-audit.test.mjs` walks src, src-tauri/src and scripts (not the evidence drivers) and fails on fetch-to-URL, XMLHttpRequest, sendBeacon, WebSocket, reqwest, ureq, hyper, TcpStream::connect or the updater anywhere but artifacts.rs, update.rs, lib.rs and the loopback CLI client, so a new connection cannot land without the list changing. Live: Get-NetTCPConnection snapshots of the app and its WebView2 children while a marker was typed in a terminal and the editor and while Send feedback opened Chrome's New issue page showed no connection from the app at all; the only rows ever seen were two WebView2 connections to a Microsoft address in the first minute after start.

[core] T-065 brings the tabs and layout back after a restart (PROJ-067). `src/terminal/layout.ts`: `layoutOf` strips the open panes to what a restart can rebuild (key, folder, branch, agent, program, args, account, title, group, kind, path, staged; an agent tab keeps no arguments, a chooser never started is left out) together with the active tab of each cell, the focus, the active workspace and the stacked cells; App.tsx writes it to the `savedLayout` setting whenever one of them changes. At start main.tsx runs `restoreLayout` over the saved value: each entry is checked field by field and dropped on its own when it cannot be read (wrong agent, missing kind, bad key, repeated key), the active-tab and stacked maps are filtered the same way, then `stillThere` asks `path_kind` for each folder and drops the tabs whose folder is gone; `tidy` moves the focus to the active workspace's first tab when the focused one is gone. Tests: `layout.test.ts`. Live: two workspaces with a shell each and an editor tab on README.md, quit with brisk-puffin active, the brisk-tuna entry damaged in settings.json by hand, relaunch: brisk-puffin's two tabs back and active, the damaged tab gone, the rest kept (`evidence/T-065-restored.txt`, `.png`). Not here: the agent session itself (an agent tab comes back at its prompt; SESS-030 is T-066), the browser pane's address (BROW cards, T-195), divider weights.

[core] T-066 resumes agent sessions after a quit or a crash (SESS-030). `hooks.rs` puts each event's `session_id` on the pane's status (`Change.session`), App.tsx keeps the newest on the pane, and `layout.ts` writes it into `savedLayout`. At start main.tsx asks `agent_start_line` for each agent tab with the agent's resume command as extra arguments (`resumeArgs`: `claude --resume <id>`, `codex resume <id>`; nothing without an id, so Claude Code's pick-a-session screen is never opened by accident), so the tab starts again on its standing line (permission mode, the user's own arguments and environment) plus the resume. The arguments reach the process as a list through portable-pty, so a path with spaces needs no quoting here. `TerminalPane` gives a starting program the keyboard only when it is the focused pane, so a resume never pulls focus. Tests: `layout.test.ts` (sess030), `hooks.rs` (the id on Claude and Codex events). Live: no real Claude Code can run in the lane's proof, so a stand-in script in a folder with a space stood in for `claude` and reported its session through the shared hook script from inside the pane; quit and reopen twice and a hard kill: each start carried `--permission-mode auto --resume <the last saved id>` in the same folder, focus stayed in the saved pane (`evidence/T-066-resumed.txt`, `.png`). Not here: the other catalogue agents (T-066-b).
[core] T-067 caps GPU terminals at six and copies without silence (TERM-017, TERM-065, TERM-103). `src/terminal/renderer.ts` keeps a pool of six live WebGL contexts, hands a freed slot to the next terminal, counts a failed attach as nothing and clears the glyph atlas after a paste burst or a late heartbeat; `src/terminal/copy.ts` copies the selection on Ctrl+Shift+C or on Ctrl+C with text selected, says nothing for an empty selection and shows one throttled notice with the selection kept when the clipboard refuses; cells are keyed by group and panes by key so splits never remount a terminal; Settings > Appearance has the "Draw terminals with the GPU" switch. Terminals surviving a quit (the fourth card) is not built: layout and session resume cover it until Txais decides on a background host. Known hole: shells sometimes stall at process start (1 thread, 0 CPU) and their pane stays blank; carried into T-166.
[core] T-166 keeps typing and output moving and proves pane sizes (TERM-114, TERM-115, TERM-116, TERM-132, TERM-134). `src/terminal/recover.ts` puts typing back in the pane that had it when the window comes back (unless something else holds focus), re-arms a display-scale watcher per ratio and holds keys typed before the shell starts (16 KB cap, dropped count told); `terminal.rs` tracks which program owns a pane's screen or mouse (busy while owned), builds the masked diagnostics snapshot behind the pane menu's "Copy terminal diagnostics" (home as ~, secrets scrubbed, soft-wrapped rows joined first, success and failure notices), runs spawn and write async, and clears the inherited "ignore Ctrl+C" flag before the first shell: before this, Ctrl+C never interrupted a pane's program. Sizes proven live: hidden tab, two window resizes, held, released and cancelled divider drags all end with the program at the pane's columns. The T-067 shell stall did not reproduce in twelve shells after the async change. Not built: self-recovery of a wedged write pipeline, output pacing across many terminals, the cold-restore cut at an unclosed full-screen session, prompt reset when a full-screen child dies.
[core] T-068 brings a pane's output back after a crash or a quit (TERM-106). `terminal.rs` appends every pane's pty output to `history/<pane key>.log` under the app's data folder (opened per chunk, so a kill at any moment leaves a usable copy; past 256 KB rewritten to the newest 128 KB through a temp file and a rename); `src/terminal/history.ts` replays it at the next start with the terminal's answer-provoking sequences stripped, writes a "restored after a restart" note under the last text and parks the cursor at the top so the new shell's prompt lands under the note, and the restore itself goes into the file so the next replay stays a faithful transcript. A tab closed on purpose forgets its file at once; files of panes no longer in the layout are pruned in the background. Proven live: hard kill then relaunch shows the earlier output, the note and the new prompt in view, the closed tab stays gone; quit then relaunch replays the transcript. Not built: nothing of the background host (there is none), a pane reopened at a different size shows the old screen approximately.
[core] T-184 makes a pane close or an app quit end every process it started (APP-053, APP-062, STAT-054, ACCT-051; council C2, DT-C27). `procs.rs` is the only file that touches Win32 Job Objects: `Job::new` makes a kill-on-close job, `app_job_start()` (one line at the top of setup in `lib.rs`) puts the app process itself in an app-wide job so everything it starts from then on (PTY shells, conhost, WebView2, git) dies with it however it exits (quit, crash, taskkill), and `pane_job(child)` gives each PTY shell its own job that `PtySession::kill` closes after the PTY master (`pty.rs`); no breakaway, nested jobs. Unit tests: closing one job ends its shell and the ping it started in under 250 ms while another job's pair keeps running; a child spawned after `app_job_start` is in the app job without being assigned. Live (evidence/T-184.txt): closing a pane by its header button ended that pane's Start-Sleep powershell and shell 0.7 s after the confirm while the other pane's ping kept running; CloseMainWindow (no taskkill) ended all 14 pids of the app's descendant tree within 0.9 s; the same profile relaunched with both shell panes back on fresh pids (T-068); a second quit left nothing from either run and nothing listening on 1424/9222. T-184-b (a pane that outlives quit, TERM 105) waits until the old app retires.

T-015 gives the chooser a "Folders" row (SESS-014): "Separate copy for each AI" or "Same folder
for all". With two or more seats in a Git project the separate copy is picked for you; one seat,
or no Git project, picks the shared folder (and the separate choice is disabled with "Not a Git
project: there is nothing to copy"). Choosing the shared folder with several seats shows a
warn-coloured note, "Several AIs would be editing the same files at once", with a one-click
"Give each its own copy". On Start every agent seat with separate copies gets a fresh
creature-named worktree of its own (SESS-023), made one after another so no two seats ever take
the same name; a terminal seat stays in the chooser's folder. Every creature name ever handed
out is kept under `creatureNamesUsed` in the store, so a removed worktree's name never comes
back.

T-016 adds `kolux-dev orchestration worker-start` (ORCH-016): `--spec <text>` makes a task
(`task-N`, title from `--task-title` or the brief's first line) or `--task <id>` takes an
existing one; `--agent <id>` names who runs it, or `--tier major|deep|build|light` picks the
model and effort from the shipped routing (Claude: fable/high, opus/high, sonnet/medium,
haiku; Codex since T-081: gpt-6-sol at high, high, medium, low; see Model routing below).
`--worktree` defaults to `new-top-level`: a fresh creature-named worktree (or `--name`/
`--base-branch`/`--display-name` for a shaped one); `current` or a selector reuses one. The app
opens the worker as a background tab named after the task, with the brief as the first prompt,
and the command waits (default 60 s, `--timeout-ms`) until the agent has written and is still
there a second later, then prints a receipt (dispatch id, task id, worktree, terminal id, model,
effort, `setup: not_configured`); a timeout answers `timeout` with the same receipt in `data`.
Every flag mix the spec refuses is refused before the app is asked; `--terminal` answers
`unsupported` until terminal handles exist. Tasks and dispatches live under
`orchestration.tasks` / `orchestration.dispatches` in the store.

T-017-a pre-trusts every folder a Claude launch will use (SAFE-023 / SAFE-024): before any
Claude process starts, the worktree and its main repository are marked
`hasTrustDialogAccepted` in Claude's own `.claude.json` (under `CLAUDE_CONFIG_DIR`, else the
home folder), keyed by the real path on disk with forward slashes. One write covers a whole
launch (every seat of a chooser Start, a new tab, a sidebar launch, or a `worker-start` from
the command line); an already-trusted folder changes nothing; a file that is not valid JSON is
left alone; at most 12 folders per launch. The step is best effort: a failure is logged and
the launch goes on. Claude therefore goes straight to the first prompt in a fresh worktree
instead of halting on its "Quick safety check" menu.

T-017-b does the same for Codex: before a Codex worker starts, the worktree and its main
repository are written to Codex's own `config.toml` (under `CODEX_HOME`, else `~/.codex`) as
`[projects."<real path, lower-cased on Windows>"] trust_level = "trusted"`, the key form Codex
itself writes. The file is edited with `toml_edit`, so every other line, comment and the key
order stay byte for byte; an already-trusted folder changes nothing; a file that is not valid
TOML is left alone. Same batch rules and the same one lock as Claude (`checked_keys`,
`write_whole` shared by both). Cursor and Copilot get nothing (DT-C17, T-017-c, [core]):
neither documents where its trust decision lives, so their own prompt stays with the user.

T-130 (orchestration lane) adds the Runs dashboard (AUTO-015): Runs in the Automations toolbar
opens one table of every automation's runs, newest first (automation, run number, how it started,
when, status), with a search box, a status filter (in progress, successful, failed, skipped),
tiles counting successes and failures over the last 24 hours and 7 days (runs dated in the future
count in neither) and Refresh. Rows arrive 100 at a time as the table is scrolled to its end and
only the rows on screen are drawn; an event-started run names its event on hover; with no runs
the table says so. Clicking a run opens it as a full page (automation, status, how and when it
started, workspace, detail) under a breadcrumb: Runs goes back to the dashboard as it was,
Automations to the list. Leaving to Automations and coming back starts at the newest runs. A
failed Refresh keeps the rows shown and says it failed. Saved output and usage are T-140.

T-086 (orchestration lane) adds the Automations page (AUTO-016, AUTO-019): the clock
button in the sidebar footer opens it over the content column (the pane grid stays alive
underneath; picking a workspace closes the page). A toolbar holds a search box (focused on open;
it looks at name, project, worktree, agent and the first 2,048 characters of the prompt, ignores
case and extra spaces, keeps its text across Refresh, refuses more than 200 characters), filters
(on / paused, last run's result, several agents at once), Refresh, Runs (the dashboard below,
T-130) and New Automation. The table keeps its header and first column in view,
sorts names the way people count ("Report 2" before "Report 10") and by last run with never-run
ones last; the first row is selected on open and the detail shows the on/off switch, Run now,
the prompt and the numbered runs. Each row's menu (Run now, Pause/Resume, Edit greyed until
T-085, Delete) acts without changing the selection. Delete asks first in an inline bar with
"Don't ask again" (setting `confirmAutomationDelete`, on out of the box); deleting removes the
automation's runs too. There are three different empty states: nothing created, nothing matches,
and a load failure with Retry. Run now works on a paused automation as well: `automations.rs`
records a manual run with its own number (numbers only go up), places it in the automation's
worktree or a fresh one, trusts the folder, and opens a background tab named after the
automation that runs the prompt. If the project is gone the run is marked skipped, and if the agent is
missing it is marked failed. Automations live under `automations` / `automations.runs` in the store; the clock that
starts them on time is T-085.

T-087 (orchestration lane) adds Model routing (SET-028): the sliders button in the sidebar
footer opens a page with one tab per provider that can route by tier (Claude Code, Codex) and a
row per tier (Major, Deep, Build, Light), each with a model picker ("Provider default" first) and
an effort picker. A model with no effort levels (Claude Haiku) hides the effort picker, and a new
model keeps the effort while it still offers that level, otherwise the effort goes back to
Default. Picks are saved in settings under `modelRouting`; a tier nothing was saved for uses the
shipped ladder (`src-tauri/src/routing.rs`, the same table ORCH-018 used). `kolux-dev
orchestration worker-start --tier <t>` now reads those picks, so the worker starts with the
picked model. Every agent pane started with `--model` (a seat's pick or a worker's tier) names the
model in its header ("Claude · haiku"). The reset button and the "not on this computer" mark are
still to come in T-081.

T-081 (orchestration lane) completes Model routing for ACCT-034: each provider tab carries a
"Not detected" mark when this computer lacks that program, and stays selectable. "Reset <provider>"
(greyed when nothing was changed) puts back that provider's shipped ladder and leaves the other
provider alone. Codex's ladder now follows DT-12: the newest Codex model, gpt-6-sol, at high for
Major and Deep, medium for Build and low for Light. Its model list (GPT-6 Sol / Astra / Luna,
GPT-5.6 Sol / Terra / Luna, GPT-5.5) and each model's effort levels come from Codex's own models
cache on this PC. Claude's levels come from `claude --help` (low to max). A 0.15.0 profile's
routing table is carried over by the settings importer (T-181).

T-077 (orchestration lane) nests child workspaces under their parent (PROJ-047). A worker started
with `orchestration worker-start --worktree new-child` from inside a workspace gets a new
workspace listed indented under the one it was called from, to any depth (child, grandchild...).
A row with children has a chevron that folds them away and back. When a parent is removed, its
children move to the top level. The footer gear has a checkbox, "Nest child workspaces under their
parent"; unticked, every workspace sits at one level. The parent is remembered in the app's store
(`workspaceParents`) and forgotten when the workspace is removed.

T-085-a (orchestration lane) makes automations on a timetable (AUTO-001, AUTO-005). New
Automation and a row's Edit open one dialog: a name, a large prompt editor (Ctrl+F opens a find bar;
Escape shuts the find bar first, then the dialog), the agent, the project, an existing worktree (the
main one preselected) or a new worktree for every run cut from a base branch (empty means the
project's default), and a timetable: every hour, every day, Monday to Friday, once a week, or a
custom cron line or RRULE, in a time zone that starts as the computer's. Under the timetable a live
preview reads it back in words with the next run ("Monday to Friday at 09:00 (America/Los_Angeles),
Next run: Monday 09:00"); a line that cannot work (minute 61, 30 February) shows why and Save stays
off. The list shows that sentence and "Monday 09:00 · in 3 days". A clock in the app checks every
30 seconds and starts what is due, works out the next time after every run, never starts a paused
automation, and moves on a due time more than two minutes old instead of running it late.

T-078 (orchestration lane) gives a lineup of sessions a shape (SESS-012, SESS-025). The chooser
has a Shape row (Solo, Pair, Workbench, Swarm, Custom) and one "Task for every seat" box. Swarm
makes five seats marked scout, builder, builder, tester, reviewer; more seats than roles start the
roles again; dropping below the shape's count turns it into Custom, which has no roles. Each AI
seat starts with its role's short brief, then the task, then its own opening prompt, and its tab
is named after the role unless it has a job title. With two or more AI seats, every agent also gets
a short rules block (others are working alongside, stay in your worktree, keep your handoff note
current, check libraries against current docs), and Kolux makes each one's handoff note first, in
the project's `.kolux/handoffs/<worktree>.md`, never overwriting one. The start line Kolux shows
on hover leaves the rules block out. A single seat gets no rules block.

T-082 (orchestration lane) gives agents a mailbox. Every Kolux terminal now carries
KOLUX_TERMINAL_HANDLE (term-<n>) and a secret KOLUX_PANE_KEY, so `kolux-dev orchestration` knows which
pane is calling. From a Kolux terminal, run-create opens a Run and ties that terminal to it;
run-current, run-list (newest first, pages with a cursor), run-show and run-use (switch) follow.
send stores typed mail for a Run (run:<id>), a worker (dispatch:<id>) or another terminal, with
kind, priority and the report extras; check hands out the oldest unacknowledged batch under one
delivery id and repeats it until --ack, with --peek, --unread, --all and --types; check --wait
blocks until mail comes or the timeout passes, writing a keepalive line every 15 seconds. A shell
Kolux did not start is turned away instead of being tied to a guess, and a retry request id makes
create, use and send safe to repeat.

T-083 (orchestration lane) lets a coordinator hand out tasks and talk back and forth with its
agents (ORCH-006, ORCH-010, ORCH-011, ORCH-013). `kolux orchestration task-create` adds a task to the
Run; a task that waits on others (`--deps '["task-1"]'`) stays pending until they finish, and a
task that names an unknown task, has bad JSON or is bigger than 4 MiB is refused with nothing made.
`task-list` shows the Run's tasks, `--ready` only the ones that can start, `--brief` a short form,
and a task held by an agent shows that agent's pane until the pane closes. `dispatch --task <id> --to
<pane>` hands a ready task to the agent running in another pane; `--inject` types the brief straight
into it as one paste (Claude Code received a multi-line brief whole), `--dry-run` shows the plan and
changes nothing, and fixed refusals cover a waiting or taken task, the coordinator's own pane, a pane
with no agent and a busy agent. `dispatch-show` gives the task's latest hand-off. Every delivered
message now carries the command that answers it: `reply --id <msg>` sends the answer back to the
sender on the same thread, and `inbox` shows the newest mail, bodies cut to 120 characters unless
`--full`.

T-084 (orchestration lane) gives every worker a real brief and picks its model by tier from
the coordinator's own agent (ORCH-014, ORCH-018). Whether a worker is started with `worker-start` or
handed a task with `dispatch`, it now reads, ahead of its task: the exact one-line commands to report
done (succeeded or failed), to send a heartbeat about every five minutes, and to ask the coordinator
a question, each carrying its task, dispatch and Run; to look for mail between steps; and to wait
at its prompt after reporting. When its worktree is behind its base, a "Base drift" line says by
how many commits. The task text always comes last, under a divider. `dispatch-show --preamble`
prints that brief. `worker-start --tier light` from a Claude coordinator's pane starts a Claude
worker on Haiku with no effort setting; naming a different agent with a tier, or a tier with a
model, is turned away. The commands say `kolux-dev` in development builds and `kolux` in releases.

T-088 (orchestration lane) makes the command line work in every terminal Kolux opens, with no
setup (CLI-007). Each new pane, shell or agent, has Kolux's own program folder first on its search
path, so typing `kolux-dev` (or `kolux` in a release) runs the copy that ships with this app even
when an older one is installed system-wide, and the pane is told which running app to talk to, so a
development or side-by-side build answers its own panes. Sends are now checked before anything else:
a heartbeat or done report addressed to a group (`@all`, `@worktree:`) is turned away, and so is a
message that gives its details both as flags (`--task-id` and the like) and as `--payload` JSON
(CLI-031). Runs, sends, replies, check and inbox (CLI-030, CLI-032) were already in place from T-082
and T-083.

T-089-a (orchestration lane) lets a coordinator hand a task to an agent tab that is already open
(CLI-035): `worker-start --task <id> --terminal <handle> --worktree current` types the worker brief
into that tab, provided it runs in the named worktree and runs the coordinator's own agent, and the
receipt says it reused the tab. A fresh worker's receipt now says which way it was launched and where
to find its background tab in the sidebar. `dispatch --task <id> --dry-run` needs no recipient and
prints the opening text without handing anything on (CLI-034). Task dependency lists still arrive
when PowerShell strips their quotes, `task-create` from outside any Kolux terminal is turned away
and every task records the terminal that made it, and a terminal whose handle has gone stale is
recognised again from its pane key. The reply hint on delivered mail names this build's own command.

[orchestration] T-155-a keeps workers and Runs in bounds (ORCH-023, ORCH-032, ORCH-033).
`kolux-dev orchestration worker-abandon --dispatch <id>` fences a dispatch off: from then on its
worker's done report and heartbeat are turned away ("dispatch-1 was abandoned: Kolux takes no more
reports on it"), its task is ready to hand on again, and its terminal keeps running with the pane
open; this works the same for a low-level `dispatch`. A worker that runs `worker-start` (or hands a
task to another tab) is turned away and told to do the task itself, unless the coordinator gave
more room: `--max-depth 2` on worker-start or dispatch (or `orchestrationMaxDepth` in settings.json)
lets its workers start one more level, and the level after that is turned away. A worker can never
raise its own cap, and its brief mentions sub-workers only while it has a level left. Two
coordinators on one machine each see only their own Run: the other Run's tasks, dispatches,
messages and terminals read as not found, exactly like ids that do not exist; `task-list --run
<other>` still shows the other Run's list, but changing it or reading its mail needs the
terminal to be in that Run. A worker acts in its coordinator's Run without being tied to it.

[orchestration] T-160 catches typos and settles who is calling (CLI-003, CLI-020, CLI-039).
A wrong command word or flag is named with the nearest valid one, before the app is looked for:
`kolux-dev worktre list` asks "did you mean worktree list?", `worktree rmm` offers rm but
`worktree lst` offers list (rm, remove and delete are offered only from one edit away), and
`worktree show --worktre` offers `--worktree` and lists the flags that command takes. A typo
ahead of the command words (`--jso worktree --json list`) is reported against worktree list;
on `orchestration check`, `--from` points to `--terminal`. With `--json` the error data carries
the unknown word, the command, suggestions, a ready next-step command line and the flags; exit 1.
`worktree rm --force` removes a checkout with uncommitted changes and keeps its branch; a plain rm
(or remove, or delete) still takes the branch it made. `--from` may now only name the calling
terminal itself: naming another terminal is refused ("this command runs in term-1, so it cannot
act as term-2"), and so is any `--from` from a shell Kolux did not start. A done report or
heartbeat on a dispatch counts only from that dispatch's worker terminal; from another pane it is
mail only (T-030), so another pane can never report someone else's task finished.

[orchestration] T-186-a changes a workspace's parent from the sidebar (PROJ-040, PROJ-048). Each
workspace row other than main has a Change parent button (an arrow) that opens a "Move under"
list under the row. The list never offers the workspace itself, its current parent, anything
nested under it or the main checkout; "No parent" (top level) is offered when it has one.
Picking one moves the row and everything under it there. The list closes first, so when a move
is refused (the chosen parent was removed meanwhile) the reason shows below the list in yellow.
The new-workspace composer checks its picked parent when it creates: a parent removed while the
composer was open is dropped, the new workspace sits at the top level, and the yellow note says
why. Board-card drops and `worktree set` wait on T-186-b.

[orchestration] T-187-a saves a lineup to use again (SESS-020). The chooser's Shape row has a
"Save as team" button, greyed until every seat has its AI and model (or Terminal). It opens a name
field; Save adds the team after the built-in shapes, keeping each seat's AI, model, role, job title
and opening prompt, the Folders choice and the shared task. Picking it fills the seats back in; a
seat whose AI is no longer installed comes back blank. A name already used (any letter case) gets
a number ("Review crew 2"). The dots button beside a team renames it (a blank name changes
nothing) or deletes it, and a delete leaves "Deleted Review crew. Undo" for eight seconds. Limits:
40 teams, 60-character names, 12 seats, 4000-character prompts. Teams are kept in settings.json
under `savedShapes`. Carrying a conversation to another agent and starting an agent from failing
checks or an issue wait on T-187-b.

[look] T-069-a: Kolux reopens on the screen left at quit (Agents, Board, Terminals, Artifacts or
Inbox; Agents and Board only under New) with the page that was open, Tasks included; picking a
first screen in General sets the next start's screen. A run of quick switches is written once, and
a pending one before the window closes; an unreadable settings file opens on Board with no
error. With no screen ever chosen a New profile opens on Board (T-049-a). Closing the window with unsaved editor text asks first (Keep working / Quit without
saving). A slow start no longer drops the saved tabs (T-069-b): until settings.json has really been
read, a change to the panes writes no layout, so the fallback shell shown while get_settings
hangs never replaces the saved tabs; the next normal start shows them all. A layout write that
fails is tried once more, then only the tabs and the workspace in front are written (focus,
active tabs and stacking dropped). Rebuilding restored workspaces in session order in one pass
is T-069-c.

[orchestration] T-189-a adds the Automations title-bar button and asks an agent to resolve
merge conflicts (VIEW-011, VIEW-069). Settings > Appearance has a Title bar card whose
"Automations button" switch is off by default; turned on, a clock button sits left of the Source
Control toggle and opens or closes the Automations page (from Agents or Board it switches to
Terminals first). Whichever page was open at quit (Automations or model routing) is shown again
at the next start (`openPage` in settings.json). When the workspace in front has merge conflicts,
Source Control shows "Resolve conflicts with an agent…", which opens a small dialog in the panel:
the agent (installed ones only), the prompt naming every conflicted file (editable), and "Start
this agent without asking next time". Start opens the agent in a new tab in that workspace with the
prompt. With a remembered agent the button reads "Resolve conflicts with <agent>" and starts it at
once, once per click even when clicked twice; "Ask each time" forgets the choice (`scmAgent`). A
start that cannot be set up shows why in the panel; a program that cannot be run, or one that ends
before a typed-in opening prompt was handed over, is reported as a session that did not start. The
Skills button and continuing a session with another agent wait on T-189-b.

[orchestration] T-190-a adds group mail, the mail banner and worker models by name (ORCH-004,
ORCH-009, ORCH-019). `send --to` takes @all, @idle, @worktree:<id> (the worktree list id or its
folder), @claude, @codex, @cursor and @droid: one copy goes to each matching agent terminal, all
on one thread (the given `--thread-id` or a new one), and the receipt lists only the messages made.
The sender never gets its own copy; shells and agents of unknown kind are left out; the agent is
the program Kolux started, never the pane title. @idle means an agent that has written nothing for
3 seconds. An unknown group, a group that matches nobody, or a question to a group is an error and
nothing is sent. `check` and `inbox` print each message as a banner: a HIGH or URGENT tag, the kind
and id, the sender's agent and handle, subject, body, payload, the reply command, then a divider.
`worker-start --model <name>` alone is enough to start a worker: with no tier it runs on the
coordinator's own agent (or `--agent`, or the default agent), and a model Kolux knows belongs to
another provider is turned away before anything starts ("sonnet is a Claude Code model, not a
Codex one"); `--effort` still needs `--model`.

[orchestration] T-190-b adds decision gates and the ask command (ORCH-028, ORCH-029).
`gate-create --task <id> --question <text> [--options <json list>]` turns a pending or ready task of
the caller's Run blocked; choices written as a plain comma list are turned away as not a JSON list,
a task with a supervised worker still at work or one that has finished cannot be held, and a refused
gate leaves nothing behind. `gate-resolve --id <gate> --resolution <text>` settles it and the task
goes back to ready once no open gate holds it; resolving twice, or a gate of another Run, is refused
(the other Run's gate reads as not found). `gate-list [--task] [--status pending|resolved|timeout]
[--run]` reads the caller's Run or a named one. `ask --question <text> [--options a,b] [--to <who>]`
puts one question to one recipient (the caller's Run unless `--to` names another; a group address is
turned away and nothing is made) and waits for the first reply, five minutes by default or
`--timeout-ms`; when the time is up the question stays open and the command prints the `ask --resume
<message>` line that waits on it again; mixing `--question` and `--resume` is refused. No gate times
out yet, since gate-create takes no deadline.

[orchestration] T-191-a adds reset by scope, JSON on every orchestration command and the
claude-teams command (ORCH-031, ORCH-065, ORCH-041). `orchestration reset` takes exactly one of
`--tasks` (clears tasks, workers and gates; Runs and mail are kept), `--messages` (clears the mail;
Runs, tasks and delivery positions are kept, so nothing is handed out again) or `--all`; none or two
are refused. Every orchestration command has its line in `kolux-dev --help` and, with `--json`,
prints one envelope: the result, or an error with a code and a message. `kolux-dev claude-teams
[claude arguments]` refuses on Windows ("not supported on Windows yet", exit 1) and outside a Kolux
terminal; elsewhere it starts Claude Code with Agent Teams turned on and teammates in-process,
passing every argument through. The picker entry, the Agent Teams mode preference and the new-tab
keybinding command wait on T-191-b.

[orchestration] T-192-a adds the automation dialog's clock boxes, a Custom line that checks itself
and starter templates (AUTO-003, AUTO-002, AUTO-006). The time is an hour box, a minute box and AM
or PM, kept as 24-hour time (1:30 PM saves as 13:30); a new automation starts at 09:00, a box that
loses focus snaps into range (75 minutes becomes 59) and an empty one takes its smallest value, the
Up and Down arrows nudge it, and Every hour keeps only the minute box. Choosing Custom fills the line
with the cron line of the timetable chosen before (weekly, Tuesday, 10:30 gives `30 10 * * 2`), and
going to a preset and back brings back what was typed; five chips name the fields and a status line
reads Valid with the line in words or Invalid with the reason, and Save stays off while it is
invalid. The chips, the weekday names and the line's day and month names follow the window's
language. With no automations yet the page shows four templates (weekday repo audit, weekly release
check, daily review, hourly upkeep) and a blank choice, and the dialog's Templates button shows them
again; a template only fills the form. The templates' grace windows, the precheck command and session
reuse wait on T-192-b.

[orchestration] T-193-a adds keyboard control and the Overview tab to the Automations page
(AUTO-017, AUTO-018). Up and Down move the selection from the search box or a focused row, Enter (or
Space on a row, or a double click) opens the automation as its own page under an "Automations ›
name" breadcrumb, Left and Right switch Overview and Runs, and Escape goes back to the list and,
from the list, closes the page; an open dialog, menu or confirm keeps Escape for itself. Deleting
the selected row moves the selection and focus to the row now in its place. Overview lists the
timetable or trigger, upcoming run, worktree, agent, run count and usage ("Not recorded yet"), and a
long prompt is folded behind "Show the whole prompt". When the run history cannot be read, the
automations still load and the run count reads "unknown" with a warning. The command group and
Hermes and OpenClaw jobs wait on T-193-b.

[orchestration] T-194 finishes GIT-068 on top of T-118's `worktree changes` and `worktree overlap`:
the clash forecast reads clean, "would conflict in <paths>", or unverifiable, and with a Git older
than 2.38 (the version read once at startup) it is unverifiable with that reason and the merge
check is never tried, so an unsupported Git is not probed again.

[orchestration] T-197-a adds `kolux automations list | show | runs | create | edit | remove | run`
on the command line. They read and change the same store as the Automations page, so a row made
from a terminal shows on the page at once. Bad flags are refused before the app is asked (time as
HH:MM, day 0 to 6, workspace mode, not-both pairs, and a trigger with any timetable edit); every row
carries its project and host, `--json` gives the full rows, and `run` logs a manual run.

[orchestration] T-198-a: `kolux agent-context` describes every command (schema 1, a count, one
entry each with aliases, flags, usage and whether its arguments are passed through raw), and
`kolux skills list` and `skills get <topic>` print the four bundled guides (kolux-cli,
orchestration, koluxsecurity, koluxward) short, with `--full`, or one `--reference`. All three
answer with the app closed. `orchestration gate-create` with no Run attached now fails and
creates nothing.

[orchestration] T-175: an automation can say how late a run missed while Kolux was away may
still start (none, 30 minutes, or 1, 3, 12, 24 or 48 hours), in the dialog or with
`--missed-run-grace-minutes`. Inside the window the run starts late; past it, history gains one
skipped entry saying Kolux was away and the timetable carries on. Each automation keeps its newest
100 runs (one in progress is never dropped, numbers keep climbing, and an oversized saved history
is cut down as Kolux loads it). An automation whose project or worktree is gone, or whose agent
account needs signing in again, shows why on the page, Run now is blocked with that reason and
makes no run, and its timed runs are logged as skipped.

[orchestration] T-192-b: an automation can carry a precheck command with a 1, 2, 5 or 10 minute
limit, set in the dialog and shown on its overview. A timed run runs it first in the run's folder,
with no window on screen; anything but exit code 0 skips the run, and past the limit it is stopped
with everything it started. The history says Skipped (precheck failed) or (precheck timed out),
the exit code, and the end of what it printed. Run now never runs it. Picking a template also
fills in its missed-run grace window.

[orchestration] T-197-b: `automations create` and `edit` take `--precheck` and `--precheck-timeout`
(60, 120, 300 or 600 seconds; anything else is refused before the app is asked), and an edit that
leaves them out keeps them. `automations runs` lists a run the precheck stopped as skipped with its
exit code and output. When Kolux cannot be reached, a command without `--json` adds "run kolux-dev
open to start it, then try again", unless its error already says how to recover.

[orchestration] T-172-a: when a worker's own agent terminal ends by itself before the worker has
reported done, its coordinator gets one high-priority escalation in the Run mailbox, its subject
naming the task by title (or by id when it has none) and its body the exit code and the
`worker-start --retry-of <dispatch> --task <id>` command to try again. A terminal Kolux closes
itself (a closed tab, a removed worktree, the app quitting) sends nothing, and neither does a
worker that already reported done or one from an earlier start of Kolux.

[orchestration] T-173-a: `orchestration request-show --request <id>` says what became of a change
sent with `--retry-request <id>` from the same terminal: completed (with the result a retry
would get back), pending (marked as cut short when an earlier start of Kolux left it), or absent.
It changes nothing. Receipts are kept for seven days, a change that was turned away leaves none,
and once 32 requests are unfinished new changes are turned away. `worker-start` now honours
`--retry-request`: a repeat with the same id, even one sent at the same moment, waits for the
first and returns its receipt (or its timeout) rather than starting a second worker.

[orchestration] T-176-a: an agent pane, and an automation's precheck, runs with git's password
prompts turned off, so a pull from a remote that wants a password fails within a second instead
of waiting on a prompt no one sees; a plain shell still asks. Each workspace row in the sidebar
reads synced, N unpushed, unpublished with N commits, or cannot be checked when the count cannot
be read; pushing clears it within the five-second refresh. The badge reads local refs only.

[orchestration] T-227-a: Source Control's main button has a "Commit and" menu beside it: commit
then push, sync, force push (with lease) or pull then push, each greyed with its reason (nothing
staged, no message, conflicts, unpublished, or behind the remote for plain push). A commit that a
hook blocks says nothing was pushed. A failed push or sync names its cause: protected branch,
sign-in, network, submodule, behind the remote, or a hook; only a hook failure (or one it cannot
sort) offers Fix with AI, which hands the agent the hook's output and the files in the push.
Colour codes from hooks are stripped from the notice.

[orchestration] T-228-a: once a workspace's branch is published and is not the base branch, Source
Control asks gh whether it has a pull request. The main button's last step reads Create pull
request, or Open pull request #N when one is open; the Remote menu has the same item, greyed with
its reason (commit first, push N commits first, sync first, move to a feature branch, no base,
checking, signed out, host not supported, already merged). Create opens a composer with title,
description, base and draft; creating checks the branch again, pushes unpushed work, links an open
pull request instead of making a second, and on failure keeps what was typed beside gh's error.

[orchestration] T-229-a: Source Control shows the workspace's pull request under the main button:
its number (which opens it), state (Open, Draft, Merged, Closed) and title. Link... takes a pull
request link, checks it through gh and keeps it for that workspace across restarts; a link for a
different branch is flagged in yellow rather than replaced, and Unlink goes back to the branch's
own pull request.

[orchestration] T-230-a: Source Control has a History section under the changes. It draws the
commit graph in coloured lanes (a merged branch joins back in its own colour), marks commits not
pushed yet with an up arrow and commits only on the remote with a down arrow, and labels each
commit with its branches and tags (this branch blue, its remote purple, the base cyan, tags
amber). Hovering a row shows the full message; clicking one lists the files it changed (renames
shown as old to new). Right-click offers Copy hash, Copy message and Explain changes, which asks
an agent about that commit. The list is resizable and refreshes when HEAD moves.

[orchestration] T-231-a: in a Markdown file (rich view, source editor or preview), select text and
press Ctrl+Shift+A (Add Review Note): a popover quotes the selection with its file and line and
takes a note. A tray in the corner keeps the notes; Copy as Markdown copies them as one block
for an agent, grouped per file and ordered by line then time, each quoting its selection. With
nothing selected the shortcut does nothing. Settings > General has a switch that turns the
Markdown review tools off. The preview's text can now be selected.

[orchestration] T-232-a: a GitHub repository is recognised from any remote form: HTTPS, ssh://,
git@host:owner/repo, git://, and SSH aliases resolved through ~/.ssh/config (Host / HostName).
A GitHub Enterprise host keeps its own address. Every gh call now names the repository from
origin, so a branch whose remote uses an SSH alias still finds its pull request in Source Control.

[orchestration] T-233-a: Settings > Git & worktrees holds the branch prefix (git user name, then the
gh login; custom text; or none, with the next-branch sample), the default compare base, and a
Refresh the base first switch. With it on, a new workspace brings its local base up to the remote
first (fast-forward only; a base with its own commits or uncommitted changes is left alone, with a
note). With it off, Kolux says when the base is behind. Settings saves no longer drop each other.

[orchestration] T-250-a: kolux-dev help <path> and <path> --help (or -h) print the help for a group
or a command, with the global options, and an alias shows its command; a typo such as
worktree craete prints the closest help, proposes worktree create and exits 1. --version or -v
prints the version only when typed alone. A lone -- before the command is ignored.

[orchestration] T-290: kolux-dev skills coverage lists each installed agent as covered or not by an
install of the orchestration skill for the whole computer, and where it was found; an install
inside a repo never counts. Works with the app closed.

[orchestration] T-291-a: Automations is a row in the sidebar nav under Artifacts and opens the Automations page;
right-click it to hide it, and Settings > Appearance turns it back on.

[orchestration] T-176-b: the pull request in Source Control refreshes itself every minute while the window is in
view, waits longer after each failure, refreshes at once when the window comes back with an old answer,
and has a Refresh button; when a refresh fails the last pull request stays, with the reason. A gh call that
hangs is stopped after 30 seconds.

[orchestration] T-071: `kolux-dev orchestration task-update --id <task> --status <state>` moves a task and
settles its worker in the same change; `kolux-dev orchestration worker-stop --dispatch <id>` ends a worker's
agent terminal, keeps its worktree and sends its task back to ready.

[orchestration] T-072-a: an automation refused for the same reason again and again (worktree or project gone,
sign-in needed) shows one entry with a count, like "Skipped (unavailable) · 4 times", first and last time; a run
that an earlier start of Kolux left queued is closed as failed when Kolux starts.

[orchestration] T-233-b: Settings > Git & worktrees has a Source Control card where the change groups can read
Staged first (the default) or Changes first; conflicts always stay at the top.

[orchestration] T-227-b: the branch row at the top of Source Control also says how many files the branch changed
against its base and lists them under "Committed on this branch"; Change Base Ref picks another base to compare
with (saved for the project) and Refresh branch compare measures again. During a merge, rebase, cherry-pick or revert
each conflicted file is a card saying what clashed (changed on both sides, added on both sides, deleted on one side)
and whether it is already fixed here, with an Abort button named for the operation.

[orchestration] T-228-b: a branch that tracks a remote other than origin (a fork) cannot create a pull request, and
the Remote menu and the main button say so: "Fork head not supported: the branch tracks fork/...; push it to origin first".

[orchestration] T-229-b: a pull request link printed in any terminal pane (an agent's, a hidden
one, or a plain shell) becomes that workspace's linked pull request, the same as a link added by
hand, so Source Control shows its number, title and state; a link split across two chunks of
output is still found, and the same link printed again is handled once.

[orchestration] T-230-b: with a pull request shown in Source Control, Merge... opens a merge box
that names what holds it back (checking, checks pending or failed, blocked, behind, conflicts, in
merge queue, changes requested, approval required, draft, closed, merged) and offers only what is
possible now: the repository's own merge methods, merge when ready (auto-merge), turning it off,
add to merge queue, mark ready for review, close or reopen. A merge asks once more in place.

[orchestration] T-233-c: Settings > Git & worktrees shows the GitHub API budget left for REST,
search and GraphQL, each with when it resets; a budget under a tenth reads in amber, and Check
again reads it afresh. Reading it uses none of the budget.

[orchestration] T-224-a: the sidebar's Tasks row (and the view.tasks shortcut, unbound by default)
opens the Tasks page: every open GitHub issue and pull request of the workspace on screen (else the
first project), newest first, drafts marked, with Refresh. Settings > Appearance > Show Tasks button
hides the row. The page comes back at start if it was open at quit.

[orchestration] T-231-b: Tasks has presets (All open, Mine, Assigned to me, Review requested,
Mentioned, Closed) and a GitHub search box that takes GitHub's own words (is:pr label:bug). The list
shows 25 a page with numbered page buttons, each row's labels in their GitHub colours, assignees and
a checks pill for pull requests (passing, failing, running, unresolved); open, merged and closed read
in muted colours. A label above says which host, account and repository the list comes from. Past
GitHub's 1000-result window a note says those results cannot be reached. Leaving Tasks and coming
back keeps the preset, search, page and scroll place.

[orchestration] T-232-b: clicking an item in Tasks opens its preview: the description, a timeline
in words (labels added, people assigned, comments, renames, closed and reopened), its labels and
assignees, and Open on GitHub. Labels can be added from the repository's own list and removed with
the x; the list behind updates too. Edit turns the description into a text box whose draft stays
put while GitHub changes underneath; Save sends it. While not editing, the description follows
GitHub's latest version (read again every 15 seconds while the dialog is open).

[orchestration] T-229-c / T-176-c: every workspace in the sidebar learns its pull request in the
background, the one on screen first, with one GitHub call per project every 3 minutes while the
window is shown (slower after failures, paused until the reset when GitHub's rate limit is hit, and
again on focus when older than a minute). Grouping the sidebar by pull request uses it: a branch
whose PR merges moves to Done on the next round.

[orchestration] T-230-c: right-clicking a commit in History offers Open in browser when the
project is on GitHub; it opens the commit's GitHub page in a new built-in browser tab beside the
focused one.

[orchestration] T-227-c: once something is staged, a spark button in the commit box asks Claude
Code to write the message from the staged changes; it turns into a stop button while it works.
The answer fills the box of the workspace that asked, even after switching to another one, and
stopping leaves the box as it was. Failures show the end of the agent's error output with Claude
keys masked.

[orchestration] T-228-c: Settings > Git & worktrees > Commit messages picks who writes commit
messages: Claude Code, a custom command of your own (it gets the prompt where `{prompt}` sits,
or on standard input), or off, which hides the spark button. Custom instructions there are added
to every request.

[orchestration] T-291-b: the sidebar's Group and sort panel has a Hide workspaces made by
automations switch. Workspaces an automation run made for itself drop out of the list while it is
on; moving to one anyway, for example from the worktree palette, turns the switch off so it shows.

[orchestration] T-347: a pull request link printed in a terminal stays linked even if the window
saves a setting from an older copy of the settings at the same moment: the window now saves only
the settings it changed. Panes never see another Kolux copy's KOLUX_USER_DATA_PATH.

[orchestration] T-196: `kolux skills list` names Kolux's four own skills (kolux-cli,
orchestration, koluxsecurity, koluxward) with a line each, and `skills get` prints each one's short
guide, full guide and reference pages, always the ones that came with this copy of Kolux.

[orchestration] T-079: from any Kolux terminal, `kolux terminal create --worktree name:<x>` opens
terminals in the background that stay listed, and list, rename, split, switch and
`close --worktree <x> --all` work on them. Reading, sending to and waiting on a terminal come with T-134.

[orchestration] T-085-b: an automation can start "When a pull request opens" instead of on a
timetable. When Kolux's pull request check sees a new pull request (drafts too) from one of the
project's worktrees, it starts one run with a line about the pull request on the end of the prompt;
the run shows "by an event" with that line. Pull requests already open when Kolux starts never
set one off, and after a run the automation rests five minutes. Checks failed and agent finished
come later (T-085-c).

[orchestration] T-089-b: `kolux-dev orchestration worker-list` lists a Run's workers with what is left of
each one's terminal (active, reclaimable, retained, released), apart from its task status, and the exact
command to run next; it covers the terminal's own Run unless `--run` names another, every Run when the
terminal is tied to none, and says which. `--terminal-state` filters, `--limit` takes 1 to 100 and
`--cursor` pages. `kolux-dev orchestration worker-retain --dispatch <id>` keeps a settled worker's
terminal, and the mark lasts across restarts. Show, read and release come later (T-089-c).

[orchestration] T-029: the palette (the Search box in the top bar) marks each open tab and worktree row
with the same working, needs-permission, unread or done mark the tab strip uses, followed by how long ago
it changed: now, 4m, 3h, 2d. A worktree that needs permission shows that mark even when it also has
unread output. The monitoring mark comes later (T-029-b).

[orchestration] T-030: a worker's `orchestration send --type worker_done --outcome succeeded|failed
--dispatch-id <id>` from its own terminal now marks its task completed or failed and frees the tasks
waiting on it; `--type heartbeat` records when Kolux heard from it (`lastBeatAt` in `worker-list --json`).
The same report sent from any other terminal still arrives as mail but changes no task, and the answer
says why. `check` shows a done report's outcome, files and report path. Reports on a settled worker are
turned away.

[orchestration] T-031: an automation's Runs tab is a numbered list (newest first) that Up, Down and Enter
step through. A run whose terminal is still open offers View run, which opens that terminal; once it is
closed it offers Resume workspace; a run whose worktree folder is gone offers Saved output, a snapshot of
what the run saved. A failed run offers Rerun, which reads "Rerun pending" for a moment. History that cannot
be read says so with Try again, never "No runs yet".

[orchestration] T-032: when Claude asks to leave plan mode, its pane header shows Review plan. It opens a
sheet on the right with the plan as formatted text in sections; each section takes comments and there is a
box for overall feedback. Approve answers Claude's question with yes. Request changes answers no and then
types one message into the pane with each comment beside its line numbers, then the overall note. Closing
the sheet keeps the comments for that plan. A permission ask for anything else shows no Review plan.

[orchestration] T-033: Source Control shows how many lines each change adds and removes (green and
red). The header can switch the list to a folder tree, and the choice is remembered; a folder row folds and
has its own stage or unstage button for everything inside it. Clicking a file opens its diff in a preview tab
that the next click reuses. The header also opens All Changes, and Review changes starts an agent asked to
review the branch against its base; on a branch with nothing to review it says so and starts nothing.

[orchestration] T-034: In a diff, hovering a line shows a plus; clicking it (or selecting lines and pressing
Ctrl+Shift+A) adds a review note, shown as a card under that line in both layouts, with Edit and a bin.
Source Control lists every note of the workspace by file; a note opens the diff at its line, and Send to
agent pastes them all into the workspace's agent as one message and marks them sent. Clear sent keeps any
note that was edited while a send was running.

[orchestration] T-035: In the Inbox, an agent that asks a question or a permission offers Answer in Code; the
rest offer Open in Code. The button, Enter, or Ctrl+J goes to the Code view, the agent's workspace (its
sidebar row scrolled into sight) and its pane, with that tab brought on top.

[orchestration] T-127: The right sidebar has a Checks tab for the focused workspace's pull request: its title
and state, a merge conflict notice, and each check with a coloured dot (passed, running, failed, unresolved,
skipped or cancelled) that opens to its times, description and a link. Running checks refresh every 15 s
while the tab is in view; a branch with no pull request says there is no review.

[orchestration] T-131: Plan review keeps unsent comments for each pane and exact plan, so closing and
reopening the sheet loses nothing and a revised plan starts empty. A very long plan is cut to fit and the
sheet says the whole plan is in the terminal. If the pane stops waiting on the plan the sheet shows, or a
different plan arrives, the sheet says the prompt closed and Approve and Request changes go grey.

[orchestration] T-132: In a code file, Ctrl+Alt+C copies the selection with its path and line numbers
(for example src/sample.ts:10-14 and the lines); a small hint near the selection shows the key, then says
Copied. Review notes now work on any code file, and Send... lists the agents running in that worktree
with how long ago each changed; a send to an agent that has gone keeps the notes and says why.

[orchestration] T-119: A pane's menu (the dots in its header) has Set Title, and Clear Pane Title once it has
a name; double-clicking a tab renames it the same way. Enter, Tab or clicking away saves, Escape cancels, and
an Enter that finishes Korean or Japanese input does not. When sessions wait on a permission or a question,
a strip above the grid lists them in grid order; clicking one jumps to it, and Settings > General turns it off.

[orchestration] T-289: The pane menu copies the terminal's handle (term-N) and the pane's number, and the agent's
session id once its hooks have named it; a notice says whether the copy worked. When a terminal prints the
handle of another open terminal, like term-3, it is a link that brings that pane to the front.

[orchestration] T-291-c: With Hide workspaces made by automations on, View run on a run whose worktree is hidden
opens that run and turns the switch off, so the workspace you are in is never one the sidebar hides.

[orchestration] T-292: While an app update is on its way, the status bar shows it: "Downloading 9.9.9 · 53%",
then "Restart to update" with a green dot, or a red "Update failed" if the download goes wrong. Clicking the
item brings the update card back, even after you collapsed or dismissed it. When nothing is happening the
item is not there.

[orchestration] T-131-b: When you approve a plan in the terminal itself, an open Plan review sheet notices at
once: it says the prompt has closed and greys out Approve and Request changes. Another tool finishing in the
meantime does not close it.

[orchestration] T-119-b: Right-click any tab for a small menu: Rename tab (terminal and agent tabs) opens
the name field in place, and Close tab closes that tab.

**Source Control (T-018-a, GIT-002 / GIT-004).** Mod+Shift+G, Mod+L or the top bar's right panel
button opens a 320 px card right of the content with the workspace in front's changes under
Conflicts, Staged, Changes and Untracked, each with its count and a stage-all / unstage-all
control, plus or minus on every row (renames show `from → to`; names such as `docs/c d.md` and
`a[1].txt` stay whole), and a commit box. Commit, and Ctrl+Enter anywhere in the card, is live
only with staged work, a non-blank message and no conflict; it commits the message exactly as
typed, shows `Committed <short id>` and refreshes. A failed commit shows `Commit failed`, or
`Commit blocked by a hook` when a pre-commit / prepare-commit-msg / commit-msg /
pre-merge-commit hook exists, with git's and the hook's own output behind a disclosure and a
`Fix with AI` button that starts the default agent in that workspace with the output as its
prompt. The draft message is kept per worktree for the window's life, through closing the card
and switching workspaces. Back end `scm.rs`: `scm_status` (porcelain v2, `--untracked-files=all`,
NUL-separated), `scm_stage` (one `git add` / `git restore --staged` fed NUL-separated paths on
stdin with `--literal-pathspecs`, paths checked to stay inside the worktree, 2 000 files in one
call), `scm_commit` (`-F -`). The list refreshes after each action and every 4 s while the card
is open; the watcher is GIT-001's (T-033) and folder rows are T-033's tree view. Rows select on
click (Ctrl adds, Shift spans, Esc clears) and a bulk bar above the list reads N selected · Stage k
· Unstage m, each button feeding the whole selection to one `scm_stage` call ([core], T-018-c).
A branch summary sits on top (T-111-a, VIEW-068): the branch, commits ahead and
behind the base, and the lines its commits added and removed since they parted from it, in full
with grouped digits (+11,012); opened, it splits them into Source, Tests and Generated rows that add
up (Non-generated when no test file changed; no Generated row when there is none), and a screen
reader hears the split even while it is closed. It is measured again when HEAD moves and every 30 s,
the last one staying up meanwhile. "Compare with the upstream" (off by default, the settings key
`scmSummaryUpstream`) measures against the branch's upstream instead; a base pinned for the project
still wins. A folded Handoff note sits at the foot of the card (T-115-a, EDIT-040): one note per
workspace folder, saved 0.7 s after typing stops and when focus leaves, its state shown as Saving…,
Saved, Not saved: <why> (over 256 KB) or Changed N min ago; it survives a restart, a damaged one
reads as empty, and removing the workspace forgets it. Hand to agent… starts the chosen installed
agent (the default first) in a new pane of that workspace with the note as its first prompt and adds
"— Handed to <agent> on <date time>" to the note.

**Main button and remote menu (T-018-b, GIT-006 / GIT-007).** The large button under the commit
box always names the next step: Stage all while edits wait with nothing staged; Commit once
something is staged (held with "Write a message first" or "Resolve the conflicts first"); Publish
branch for a branch with no upstream (held with "HEAD is detached"); Force push with lease when
the upstream holds only patches the branch already has, as after a rebase; Sync ↓behind ↑ahead,
Pull n or Push n by the counts; Create pull request on a clean, pushed branch (the composer is
GIT-021, T-228, and the button says so). The Remote menu lists push, pull, sync, fetch,
fast-forward, force push with lease, publish branch and rebase from base, labels carrying counts
("Push 2 commits", "Sync ↓1 ↑2", "Rebase from origin/main"), every disabled item showing its
reason (no branch checked out, branch unpublished, nothing to push / pull, already current, local
commits are in the way, already published, this is the base branch). Actions run against the
branch's own remote only (publish pushes to origin and sets it as upstream; force always carries a
lease; rebase fetches first); a failure shows git's words with Fix with AI. Status never touches
the network: ahead / behind come from the refs git has, so an unpublished branch is never checked
against the remote; only an explicit menu action does. Back end: `scm_remote` in `scm.rs`,
`Status.rewritten` (`git cherry HEAD @{upstream}` all `-`) and `Status.base`.

**Worktree create, move and remove on the Git side (T-019, GIT-067).** A new workspace brings
along what the repository says: git-ignored files named in `.worktreeinclude` at the repo root
(one literal path per line, `#` comments; wildcard and negation lines are skipped with a warning)
are copied from the main checkout, and git-ignored folders under `worktree.sharedDirectories` in
`kolux.yaml` are linked (a junction on Windows, so no privilege is needed and git sees a folder),
so every workspace shares one `node_modules`. Entries are tidied before anything on disk changes:
absolute paths, paths with `..`, paths into `.git`, duplicates and trailing slashes; a folder that
is not ignored, a file missing from the main checkout or a link that could not be made comes back
as a warning in the sidebar's "created …" note, never as a failed create. A tracked file is never
copied over. Creations in one repository take turns (a failed one hands the turn on). Removing a
workspace with uncommitted work (submodule work included) is refused; the sidebar form then asks
again with "Discard and remove", and nothing is lost until that click. The shared-folder links are
taken out first, so removal never touches the folders behind them. The branch is deleted only
when no other worktree has it checked out; otherwise the commit it stood at is recorded so
`Git::delete_branch_if_at` can delete it later only while unmoved (the form's keep-branch choice
is T-218). `Git::worktree_move` goes through `git worktree move`. A base ref that could read as a
git option or range (leading dash, blanks, `..`) is refused before any git command runs. Back end:
`include.rs` (new), `git.rs`, `projects.rs`; `workspace_remove` takes `force`.

**The workspaces folder (T-020, SET-032, PROJ-026).** The sidebar's Workspaces-folder field saves
on Enter, puts the saved folder back on Escape, and does nothing while an input method is still
composing; leaving the field sends the typed folder again whenever it differs from the saved one,
so a save that failed is retried by moving on. An absolute folder is made at save time, and one
that cannot be made (a path under a file, say) is a failed save that keeps the typed text in the
field. Browse… picks the folder with the native dialog and saves it at once. Folders used before
are offered from the field's list. `KOLUX_WORKSPACES_DIR` (trimmed, blank counts as unset)
replaces the default folder without opening Settings; a saved folder still wins over it, and the
field's label says "(from KOLUX_WORKSPACES_DIR)" while the variable is what supplies the folder.
Back end: `projects::resolve_workspaces_dir`, `PlaceInfo.fromEnv`, `set_place`.

**Worktree create from the command line, with lineage (T-021, CLI-018).** On top of T-014-b,
`kolux-dev worktree create` records how the workspace came to be: made by the CLI, the folder the
call was made in, the parent worktree (the one the call was made from, the main checkout
included; `--parent-worktree <selector>` names another in the same project, `--no-parent` records
none, and a call from outside every worktree has none), `--issue <number>` and `--comment
<text>`. The record lives in the store under `workspaceOrigins` (`projects::set_origin` /
`origin`), is echoed in the result and goes when the worktree is removed from either the CLI or
the sidebar. Refused before the app is asked: `--parent-workspace` (retired; the message names
`--parent-worktree`), a parent flag with no or an empty value, `--issue` that is not a positive
whole number, and the earlier refusals (prompt without agent, empty agent/prompt/setup,
disagreeing parent flags, `--run-hooks` with `--setup skip`). A parent selector that matches
nothing fails before anything is created. The sidebar does not draw lineage yet (PROJ-047,
T-077).

T-022 (PROJ-045, PROJ-050, PROJ-063): each sidebar row shows the strongest live state among the
panes open in its folder as a coloured dot (amber for what needs you, green working, teal done,
grey idle; a permission request outranks everything), and the main checkout's row gets the same
dot. A state change in a workspace that is not in front marks its row unread (bold name and an
amber mark); showing it clears the mark, and the bell button on any row, the shown one included,
flips the mark by hand. The shown row carries a thin accent bar. The Sliders button in the
Projects header opens Group by (Project, None, Status, Pull request) and Sort (Smart, Name); both
are settings keys (`workspaceGroupBy`, `workspaceSort`) remembered across launches, and an old
"recent" sort is moved to Smart once. Smart puts what needs you first, then done, then working,
then idle, newest change first inside each class; an interrupted agent is never among the done.
Status and Pull request grouping draw folding headers with counts; None is one flat list with
the project name at the right of each row. A branch switched inside a workspace folder shows on
its row within five seconds (a poll while the window is visible; watching is PROJ-041, T-107).
Today the only live states are working, done and idle, read from whether an agent's program is
up; the hook-fed states and the pull-request feed are named on T-025 and T-229.

T-023 (TERM-020, TERM-021, TERM-023, TERM-030; STAT-051, VIEW-047): the pane header's status
word is tinted by `status.ts`: an agent reads Starting then Working (cyan), Done (green) once
its program ends well, "Ended (code)" neutral when it stopped otherwise, Failed (amber) when it
could not start; a plain shell reads Starting, Ready and Ended in the neutral tone; the status
dot keeps its spoken label. A Done agent shows its age next to the word ("just now", then "1m
ago", refreshed each minute), and a pane whose agent finished while another pane was focused
carries a static green glow until it is focused. Ctrl+J (Cmd+Shift+J on macOS;
`terminals.focusNextNeedsYou`) cycles through the panes waiting on the user in grid order
across workspaces and leaves focus alone when none waits; today no pane waits, since what an
agent needs arrives with the status hooks (T-025), so the two-waiting cycle is proved in tests.

T-024 (TERM-055, TERM-118): a cell with two or more tabs shows one badge beside each tab's agent
icon: a spinner while the agent works, a question mark while it waits on the user (fed by the
status hooks, T-025), a bell for a finish or a terminal bell not yet looked at, a green check for
a finish that was; an idle shell tab shows only its icon. An agent that finishes, or any program
that rings the bell, while its pane is not in view (a hidden tab, a hidden split pane, another
workspace in front, or the window in the background) marks the tab, the pane (green glow) and
the workspace row unread and shows a passing note in the window ("Claude finished", "Terminal 3
rang the bell"); looking at the pane in a focused window clears all three. A finish in the pane
being looked at adds no mark. A late event for a pane that is gone or already marked is dropped.
The desktop notification itself is T-026; the choices it will follow are on Settings >
Notifications (T-133, below).

[orchestration] Settings > Notifications is built (T-133, SET-034): switches for which alerts to
send (a task finished: on, a terminal bell: off, an agent stopped: on, usage nearing its limit:
on), "Stay quiet about the worktree you are looking at" (on), the sound (System default, or one
of Kolux's own tones Chime, Ping, Pulse) and a volume slider, with 0 shown as Silent. "Send a
test notification" shows a real Windows notification with the chosen sound, and only that one
sound (a Kolux tone plays with a silent notification); at volume 0 it appears in silence. When
Windows has app notifications switched off the page says so instead of sending, and a link
opens the system's own notification settings. Nothing sends notifications on these choices yet:
that is T-026.

[core] T-025-a (STAT-001, STAT-007): agents report their own state through hooks. At start Kolux
opens a loopback listener (port and token in `agent-hooks-endpoint.txt` in the profile folder,
removed at exit), writes `~/.kolux-rs/agent-hooks/claude.cmd` and puts one Kolux RS entry under
each of Claude Code's twelve hook events in the user's Claude settings file (`settings.json`
beside `.claude.json`, `CLAUDE_CONFIG_DIR` honoured; every other entry stays, a file that is
not JSON is left alone, the file keeps its indent). Every pane's programs see
`KOLUX_AGENT_HOOK_PORT`, `KOLUX_AGENT_HOOK_TOKEN`, `KOLUX_PANE_KEY`, `KOLUX_TERMINAL_HANDLE`,
`KOLUX_HOOK_ENDPOINT` and `KOLUX_HOOK_IDENTITY`. The script guards on those, reads the endpoint
file, posts the event with the system curl inside 1.5 s and always exits 0. The listener maps
Claude's events (SessionStart from startup, resume or clear and a manual PostCompact: done with
a boundary; UserPromptSubmit and PostToolUse: working; PreToolUse: working with the tool, or
waiting for AskUserQuestion and ExitPlanMode; PermissionRequest: permission; Stop: done;
StopFailure: blocked; a sub-agent's events are ignored) and raises `agent-status` to the
window. The pane header shows Needs you, Blocked, Interrupted or Done (with its age) while the
program still runs, the tab badge shows the check when the turn is over, the workspace row's
dot takes the hook state over the guess, Ctrl+J visits every pane the hooks say is waiting, and
a turn ending out of view is noticed like an exit. The hooks are always on (the switch is
T-120); Codex and the sub-agent roster are T-025-b and T-025-c. Proved with events sent
through the real script; a real Claude Code session is T-025-d.

[core] T-025-b (STAT-008): Codex reports through the same listener. Kolux writes
`~/.kolux-rs/agent-hooks/codex.cmd` (the Claude script posting to Codex's path) and, at start,
puts one Kolux RS group under each of Codex's eight hook events in the user's `hooks.json`
(`CODEX_HOME` or `~/.codex`), after the user's own groups, replacing a stale one where it
stands; a file that is not JSON is left alone. The trust entries come from Codex itself (DT-C3):
Kolux starts `codex app-server` hidden on that home, asks `hooks/list`, and writes each of its
own entries' key and hash to `[hooks.state."<key>"] trusted_hash` in that home's `config.toml`;
the user's own entries are never marked. An unchanged file whose entries are all in the table
costs nothing on later launches; when Codex is missing or does not answer, `hooks.json` goes
back exactly as it was (or away, when Kolux created it) and stderr says so. A managed Codex
account's home gets the same install when its pane spawns. Events: SessionStart working with a
boundary, UserPromptSubmit working with the prompt, PreToolUse working with the tool (waiting
for `request_user_input`), PermissionRequest permission (no decision returned), PostToolUse
working, Stop done; a sub-agent's events are ignored until the roster (T-025-c). Proved with
Codex 0.156.1's own listing on a scratch home (`evidence/T-025-b-trust.txt`: Kolux's eight
entries trusted, the user's own Stop hook left untrusted) and events sent through the real
script to a Codex pane (`T-025-b-needs.png`, `-done.png`). Open: Codex's source clears the
hook's environment on Windows before running it; whether the pane's variables survive is
unverified, and if they do not the script exits silently (a real Codex session is T-025-e). The
Devin-variable skip is not built (DT-C4).

[core] T-025-c (STAT-026 and the rest of the stored status): `src-tauri/src/status.rs` keeps a
session per pane between hook events: the lead's own state, the tool it waits on a permission
for, the roster of sub-agents and teammates (id, role, model, state, start time; 32 at most), whether
Claude's background tasks were still in flight at the last Stop, the interrupted flag, the last
reply and the last twenty states with their prompt and start time (`agent_history` command). The
state the window sees is resolved from all of it: a child waiting on Txais comes first (needs you
on the lead), then the lead's own needs, then working while the lead, any child or background
work is busy, else the lead's last state. Sub-agent events (an `agent_id` on them, or
SubagentStart/SubagentStop/TeammateIdle) move the child only; a child's permission clears when
that same tool resumes in the child, when the teammate goes idle or when it stops, never on the
lead's unrelated progress; a child already gone never comes back; a child's Stop carries its own
reply and name so it can be announced on its own. The lead's permission clears only when the same
tool carries on, a new prompt arrives or the turn ends. Ctrl+C or Escape typed into the pane while
the lead itself works (no child or background work live) marks the coming Stop interrupted, and
late tool events cannot bring the turn back to working until the next prompt. The prompt Claude
re-submits after an automatic compact is not a turn. The pane header shows "N agents, M waiting"
beside the status word with the roster as hover text. Proved with events through the real script
on a Claude pane: lead Stop with a child live stays Working with "1 agent", a child's permission
reads Needs you "1 agent, 1 waiting" and survives the lead's unrelated tool step, the teammate
going idle clears it, Escape then Stop reads Interrupted and a late PostToolUse leaves it there
(`evidence/T-025-c-lead-working.png`, `-child-needs.png`, `-done.png`, `-interrupted.png`). Not
built: the queued state (not a hook state, DT-C5), the partial mark on a cut-short background list
(DT-C6), and the interrupted conclusion when the agent sends no Stop at all (a timer; the rest of
that card).

[core] T-026-a (STAT-041 desktop notification, STAT-045 quiet alert): the window's finish-and-bell
note (`noticed` in `App.tsx`) now also raises a Windows notification through `tauri-plugin-
notification` (a `notify` command) whenever the pane is out of view or the window is not focused,
unless the 'Agent Task Complete' switch is off; the unread mark and the in-window toast keep
T-024's one-mark-until-viewed rule, the desktop notification does not (every finish, permission
request, block, interrupt and sub-agent turn is one of its own). `src/terminal/notify.ts` words
the note: "Claude finished" with a one-line preview of the reply, "needs permission", "is
blocked", "was interrupted", "code-reviewer finished" for a sub-agent's turn (the roster now
announces the child's role, not its id), and "repo · Claude finished" when more than one
repository has agents running; session boundaries and replayed events say nothing. The quiet
alert is judged in Rust by the terminal's own output (`Terminals::silence`, from the output marks
programs already carry), every 15 s, against the `quietMinutes` setting (10 by default, 0 off):
a working pane past the threshold fires one `agent-quiet` event per silent spell
(`Session::quiet`, re-armed by fresh output or by leaving the working state); the window shows
the toast and a desktop notification for it regardless of view or switch, since the minutes are
its own switch. Settings gained a Notifications page (the switch and the minutes, saved over a
fresh read). Proved on the lane app with events through the real script: a permission request,
a finish with its reply preview and the one-minute quiet alert each raised a Windows toast
(`evidence/T-026-a-permission-toast.png`, `-finished-toast.png`, `-quiet-toast.png`), the quiet
alert also as the in-window toast (`-quiet-window.png`), and the alert fired once in eight
minutes of further silence; the settings page in `-settings.png`. In a dev build Windows names
the sender "Windows PowerShell" (the plugin's debug app id); an installed build carries Kolux's
own identifier. Not built: the "quiet 12m" tag on agent-dashboard drawer rows (the drawer is a
later view; `Terminals::silence` is what it will read), and nothing is sent for Cursor Agent
shell steps or Grok prompts because neither agent is wired yet. The status vocabulary and the
Inbox are split off as T-026-b and T-026-c.

[core] T-026-b (STAT-052 one status vocabulary): `VOCAB` in `src/terminal/status.ts` is the one
table every status surface reads: a word, a glyph, a tone and a hover explanation for working,
background, blocked, waiting, permission, interrupted, failed, done, idle, no recent update
(`stale`), plus the Agents view's starting, cannot-reach (`unreachable`) and stopped
(`stoppedLabel(cause)` says what caused it) and Kolux's queued. Blocked and waiting borrow the
permission look (the question-mark glyph TERM-055 already gave the tab badge, amber). The pane
header (`headerOf` now returns the vocabulary entry plus `state`), the tab badge (`TabBadge`) and
the sidebar dot (`ProjectsPanel`) all draw from it; `StatusGlyph` in `icons.tsx` is the glyph set
(spinner, spinner with a centre dot for background, question mark, circle with a bar for
interrupted, circle with a cross for failed, check, hollow circle for idle, dotted circle for no
recent update). A shell keeps its neutral words (Ready, Ended (code)) over the idle and stopped
entries (TERM-020). Every `Spinner` turns 12 frames a second (`.spin`, `steps(12)`) and joins the
document's clock at time zero on mount, so all spinners on screen step together; under
`prefers-reduced-motion: reduce` the stylesheet stops it and the glyph still reads as working.
`src/chrome/Tip.tsx` is one tooltip for the window: any element with `data-tip` explains itself
about 200 ms after the pointer settles, kept inside the window edge; the status glyph, the status
word, the tab badge and the sidebar dot carry it. Proved on the lane app with hook events through
the real script: the header glyph, the tab badge and the sidebar dot each showed their explanation
on hover (`evidence/T-026-b-working.png`, `-tab-badge.png`, `-sidebar-dot.png`); the pane moved
working → needs you → done with the glyph and text changing each time (`-needs-you.png`,
`-done.png`); both spinners on screen reported `startTime 0`, `steps(12)`, `1s`; with reduced
motion emulated over the debugging port the animation read `none` and the word stayed Working
(`-reduced-motion.png`). Not lit yet: the `background` entry (the hooks fold background work into
working until T-123 reports it), `stale` (needs a surface that knows the last update time: the
Inbox, T-026-c, or the Agents view) and the Agents view's own labels (that view is later; it reads
the same table).

[core] T-026-c (STAT-050 Inbox): the bell in the top bar (labelled Notifications) and the
`view.inbox` shortcut (unbound, as COMPAT says) open the Inbox, a top-level screen of its own
beside the Agents / Board / Terminals switcher. `src/inbox/inbox.ts` builds it from the panes the
window already tracks (each pane's hook state, whether its program is up, and a stamp of when its
state last moved, now kept in `App.tsx`): needs you holds permissions ("Permission"), questions
("Question", a waiting state) and blocked agents, newest first; waiting on agent holds running
sessions; done today holds finishes of the last 30 minutes, newest first, 20 at most, never an
interrupted turn. Up and Down walk the three groups in order (nothing selected: Down picks the
first row, Up the last; both ends stop; a vanished selection falls back to the first row), Enter
or the detail's button opens the pane in Terminals with its workspace selected; the all-clear
line shows when nothing needs you. The detail shows the agent, branch, workspace, the worktree's
changed-file count (through `scm_status`) and the turn's prompt (through `agent_history`).
Proved on the lane app: three Claude panes with no events gave the all-clear line over three
Running rows (`evidence/T-026-c-all-clear.png`); a permission request, an AskUserQuestion and a
finished turn through the real hook script gave two needs-you rows and one done-today row
(`-groups.png`); Down selected the first row and showed its detail (`-detail.png`); Up at the
top stayed, five Downs stopped at the last row, and Enter left the Inbox with that pane focused
(`-opened.png`). The 40-minute, 20-row and interrupted rules are unit-tested (`inbox.test.ts`).
Not built: line counts in the detail (no numstat command yet; the change count stands in), the
host line (every session is local today), stale rows under waiting on agent (no last-update time
yet, see T-026-b), and the Code view the card's buttons name (DT-C8: Open / Answer go to the
terminal pane until that view exists).

[core] T-027 (STAT-053 Thought rows): deferred, not built. The rows live in a transcript on the
Agents screen; the repo has no transcript reader (T-325), no chat rendering of reasoning
(T-326, whose card says its folded reasoning rows are these Thought rows) and no Agents screen
(T-050). Building the fold on its own would be a component nothing renders, so the rules moved
onto the T-326 line and T-027 stays unticked with a note.

[core] T-028-a (VIEW-016 one line per session, VIEW-023 Board lanes and chips, VIEW-025 approve
or deny from a card): `src/board/chip.ts` is the pure model: from a pane's hook state, whether
its program is up, the STAT-045 quiet flag, the last turn's tool / detail / reply / newest file
written and the stamp of when the state last moved, it gives a lane, a word and one line (a
permission reads Needs you with "Tool: detail" and offers the answer; a question reads Needs
you; working reads Working with how long and the step; a quiet working pane reads No recent
update, never Working; a limit or sign-in stop reads Stopped with the cause, never Done; a finish
reads Done with the first line of the last message and the newest file written; an ended
program reads Stopped / Exited; no process yet reads Starting; a plain shell has no chip; with no
evidence the line is empty). The Board is now a CSS grid whose columns are the lanes that have a
card (Needs you, Working, Done, Stopped, Idle, in that order), each card carries a chip row under
its header, and the file link shows the file's name with the full path as its tooltip. Approve
and Deny call the new `agent_answer` command, which types the agent's own answer keys into its
terminal (Claude: Enter for the highlighted Yes, Esc for No; Codex: y / n from its public keymap)
and clears the pending permission, so the card leaves needs you at once. `PostToolUse` for
Claude's Write / Edit / MultiEdit / NotebookEdit now carries the file path (`Change.wrote`).
Proved on the lane app with the real hook script: a permission ask, two edits plus a finish, and
a failed stop gave four lanes with "Needs you · Write: C:/x/hello.txt · Approve Deny", "Done ·
All three tests pass. · b.ts" (full path in the tooltip) and "Stopped · rate limit reached"
(`evidence/T-028-a-board.png`); Approve moved the first card to Working with no buttons
(`-approved.png`); a Bash ask on the done pane came back as Needs you (`-deny-ask.png`) and Deny
moved it to Working (`-denied.png`); after the one-minute scratch quiet window the approved pane
read "No recent update · 2m without output". Unit tests in `chip.test.ts` cover the word and lane
rules, `status.rs` the answer keys and the cleared permission, `hooks.rs` the written file.
Not built: the Setup needed (chooser) and Can't reach (remote) chips, a real file opener (text
with the full path until the editor lands), Codex write-tool names for the file link (only
Claude's are known), and the Agents-screen words of T-028-b. The Claude answer keys are not yet
proved against a live prompt (no Claude prompt is typed in a build pass); the real-session proof
is for Txais, like the hook installs.

[core] T-029 (VIEW-040 palette row marks and ages) and T-030 (ORCH-007 mail pointer, ORCH-015
done reports and heartbeats, ORCH-020 worker-show, ORCH-021 worker-read): deferred, not built.
The palette (T-098) does not exist, and the orchestration store (Runs, mail, dispatches: T-082,
T-083, T-089 on the orchestration lane) and the transcript reader (T-325) do not exist in this
checkout; `cli.rs` only checks worker-start's flags. Both lines stay unticked with a note on
what they wait for.

[accounts] Secrets are sealed on disk (T-038): the Claude 1-year key and the xAI key live in
settings.json only as Windows-sealed values (DPAPI, this user only), the window never receives
them and cannot overwrite them, and a vault folder in the profile holds one sealed file per
managed sign-in. About two seconds after the first window, a one-off pass seals anything still in
the clear from an older profile (it never delays the launch, leaves a value as it was if sealing
fails, and moves an unopenable sealed file aside instead of deleting it) and limits the profile
folder to the current user; it writes to `logs\kolux.log` in the profile. No screen sets a key
yet; the Connect cards come with T-043.

[accounts] The Codex half of the top-bar usage pill is real (T-042-a): shortly after the window
opens, and every 10 minutes, Kolux checks for a Codex sign-in (the account's own Codex home, then
`CODEX_HOME`, then `~\.codex`), starts nothing when there is none, and otherwise asks Codex's
background app server, in a hidden process that only reads and is closed afterwards, for the
plan figures. The pill reads "Codex 100% left" (weekly figure); hovering lists the 5-hour and
weekly figures each with its own reset time, the limit-reset credits and the plan. A sign-in
Codex no longer accepts turns it into a yellow "Codex · sign in again" with no figures. The
Claude half reads "Claude N% left" from Claude Code's own status-line reports once a Claude
pane has produced one (T-039-b, [core]); until then it reads "unknown". Board cards carry a
compact meter (context bar in tokens plus the agent's 5-hour and weekly plan percentages), agent
tabs a tiny context ring, and the pane header's gauge fills and turns yellow at 70% and red past
90% (T-040-a, [core]). Claude and Codex panes start held to a 200k context window unless
Settings > Agents switches the cap off, and the top-right pill is a read-only weekly figure per
provider, tinted by use, hidden until a weekly figure is known (T-041-a, [core]). With the
Claude card's resume switch on, a Claude pane stopped on a usage limit gets a continue prompt
typed in a minute after the limit resets (T-041-b, [core]). Codex's figures come from the
background app-server read only; the usage service and the hidden `/status` screen are not
built (DT-C15, T-042-b, [core]).

[accounts] Settings exists with its first page, AI connections (T-043-a): click the usage pill in
the top bar or press Ctrl+Comma; Esc or the × closes it, and the panes underneath stay as they
were. The Claude card connects on a key that lasts a year: Connect runs Claude Code's own
long-lived-key setup out of sight (no console window, never through the command prompt), shows
"Finish in the browser" with Cancel while Claude's page is open, picks the key out of the
setup's output, keeps it sealed with the date it was made, and turns the card to "Connected ·
1-year key, Renew in <month year>". From 30 days before the year is up the card warns with the
days left and offers Renew; past it, it reads "ran out". A second Connect while one is running is
turned down, the setup gives up after 10 minutes, and a launcher Kolux cannot start directly puts
the card in needs attention. Every new Claude pane is handed the key through
CLAUDE_CODE_OAUTH_TOKEN while key mode is on (its /status reads "Auth token:
CLAUDE_CODE_OAUTH_TOKEN"). Disconnect forgets the key. Managed Claude accounts and the Codex
sign-ins come with T-043-b / T-043-c.

[accounts] Settings > AI connections lists managed Claude accounts (T-043-b): Add Account, or "Use
my Claude account instead" on the Claude card, runs Claude Code's own browser sign-in out of sight
into a private Claude folder for that account and shows "Finish signing in in the browser." with
Cancel. When the sign-in is done the account is listed with its email and organisation (read from
Claude Code's own status), and its sign-in is kept sealed in the vault as well. Cancel, or a
sign-in that quits early, keeps nothing partial; "Sign in again" that fails puts the earlier
sign-in back and says why in yellow. Make active picks the account new Claude panes run on (they
get that folder as CLAUDE_CONFIG_DIR); while the 1-year key is connected the key still wins, and
the section says so. Kolux does not renew these sign-ins itself: Claude Code keeps them fresh in
its own panes (the ACCT-006 default under OD-01). The section's "Leave sign-in upkeep to Claude
Code" switch (T-043-d, [core]) is on by default; off, Kolux asks Claude Code at once whether the
active account is still signed in and flags a lapsed one with a Needs sign-in chip and the
main-window notice, on hides both. Kolux never renews a sign-in itself (DT-C16); the macOS
keychain rules are T-043-e.

[accounts] The Codex card on Settings > AI connections connects Codex (T-043-c): Connect runs
Codex's own browser sign-in out of sight, and "Sign in with a code" shows a link and a one-time
code to enter on this or any other device (the view waits until it has both). Each account Kolux
adds lives in a private Codex home of its own (\codex-accounts\<id> in the profile), so the
user's own \.codex folder is never touched (checked file by file). The newest account becomes the
active one; others can be made active, and new Codex panes and the top-bar Codex figures run on
the active account. With no managed account the card reports Codex's own login as it is: a ChatGPT
sign-in, an API key, an API key with a custom provider, or not connected. Cancel or a failed
sign-in adds nothing and removes the half-made home, but never a home that already holds a
working sign-in; the reason shows with links and codes removed.

[accounts] A lapsed sign-in now shows in the main window, not only in Settings (T-044): a bar
across the top says "Claude account sam@example.com is no longer signed in." (or the Codex
account) with Sign in again, which runs the same hidden sign-in as Settings and clears the bar
when it works. Kolux asks Claude Code once at start whether the active account is still signed
in, but only while Kolux, not Claude Code, looks after sign-ins; under the default (Claude Code
looks after them) the Claude half never shows. A Codex account is flagged when its usage read
says to sign in again. Every needs-attention card in Settings now names one reason and offers
the one fix that fits: Try again (browser blocked, sign-in refused), Check again (plan not
covered, Claude not found), Open install page (Windows blocked it, no installer here), Renew
(key running out or expired), Try installing again (install failed), and no button for a usage
limit, which says when it can be used again. Nothing yet produces the install-failed and
SmartScreen reasons; the install flows will.

[accounts] Settings > AI connections now says whether each sign-in is ready (T-045). With no
1-year key and no managed Claude account, the Claude card reports Claude Code's own sign-in on
this PC ("New Claude panes use Claude Code's own sign-in on this PC (email)"), and warns in
yellow when Claude Code is signed out, so a sign-out from Claude's own command line shows the
next time Settings opens. Managed Claude accounts that lapsed and Codex accounts with a sign-in
error say "Needs sign-in"; a Codex account whose settings file was changed away from what Kolux
wrote says "Settings changed" with Sign in again, which puts Kolux's settings back. A Codex that
refuses the command Kolux starts it with is reported as such ("update Codex"), never as a sign-in
problem. The Claude card has a "Carry on by itself once a usage limit resets" switch: off unless
turned on, kept across restarts; it only stores the choice until the resume itself (T-041) lands.

[accounts] Settings has an Appearance page (T-053): Classic plus 16 coloured themes, with tint,
saturation and depth sliders (greyed out on Classic) and a small preview, and a Terminal colours
picker with "Match app theme". Every change shows on the whole window at once and is kept. The
window now starts hidden and appears only once it already wears the saved theme, so the white
flash before the interface loads is gone too.

[accounts] Settings now has its ten pages (General, Appearance, Accounts & keys, Agents, Terminal &
sessions, Git & worktrees, Safety, Notifications, Shortcuts, Usage) plus one small page per
repository, and opens on the page used last (T-054). Appearance has a Mode switch: System
(follows Windows while the app runs), Light or Dark; a profile that never chose starts on Dark
(T-418), and terminals turn light with the
app unless that is switched off. General has the Classic or New look and the screen that opens
first; under Classic the Agents / Board / Terminals switcher is gone and the window stays on
Terminals. Pages with nothing built yet say so.

[accounts] Closing a tab whose program is still running now asks first (T-057): "Close
“Terminal 1”? A program is still running in it.", with Cancel and Close tab. An idle shell closes
at once. The tab's x, the pane's close button and Ctrl+W all ask the same way, and Settings >
Terminal & sessions has a switch to turn the question off.

[accounts] Deleting a workspace now looks first (T-055): the question lists the uncommitted and
untracked files that would be lost, and Remove refuses unless "Delete my changes too" is ticked.
A locked workspace, or one holding another workspace's folder, cannot be deleted from Kolux at all,
and if the workspace changed while the question was open the delete is refused and the question
shows it as it is now. Ctrl+Shift+Backspace asks to delete the workspace row under the pointer, else the workspace shown. Settings > Git &
worktrees can switch the question off for clean workspaces. After a delete the window moves to
the workspace in the same project used last, and the list keeps its scroll position.

[accounts] Settings > Agents is built (T-036). It lists the agents found on this PC, each with an
on/off switch; switched-off agents leave the New tab and New session menus. The default agent
can be set to Auto (the first one available); switching the default off leaves Auto, and a
saved default that is not installed right now keeps its name with "(saved, not found right now)".
Agent Permissions picks Yolo (agents skip their permission prompts where they have a switch for
it: Claude Code in its automatic mode, Codex without approvals) or Manual. Under "How it starts"
each agent shows the exact line it starts with and takes its own command, default arguments and
environment variables; Refresh looks for agents again.

[accounts] The Resource Manager is built (T-037). Clicking the memory figure in the status bar
opens it: the computer's free memory, Kolux itself (the app and its WebView), and every terminal
session with its memory and CPU, grouped under the workspace it runs in, with terminals outside
any workspace under "No worktree" and a session no pane shows named as such. End asks in the row
first and stops only that session. Figures refresh every two seconds while it is open.

T-090 brings updates (APP-024..027). An installed copy checks the TxaisX/kolux-rs-releases
feed quietly at start-up (only if the last check is over 30 minutes old, else it waits out the
rest) and every 30 minutes after, merges focus checks, retries a failed check after an hour
doubling to six, stays silent offline and checks 5 s after the connection returns, checks after
the PC wakes, and drops a check that stalls. A found update downloads by itself and must carry a
valid signature; a small "Kolux RS <version> is ready" pop-up with Restart to update then shows
bottom-left once per version per launch, and if ignored the update installs when the app quits.
The sidebar footer's "Check for updates" opens the update card: checking, up to date (fades),
available, downloading with a progress bar, ready, or a plain-worded error with a next step;
Escape collapses it, Enter runs its main action, a dismissed version stays away, the release
notes (from the manifest, headings removed, six lines at most) stay through every phase, and a
first-time tip says terminal sessions keep running. Dev copies only update with the two
`KOLUX_RS_UPDATE_*` variables set; a real release needs T-091's signing key in RELEASE_PUBKEY.

T-091 brings shipping and releases (APP-058..060). `pnpm ship` commits a worktree's changes with a
one-line message written by `claude -p` (haiku unless `--model` says otherwise, or the user's own
`--message`), merges the remote in (never a rebase; a conflict undoes the merge and stops with
nothing pushed), pushes, and with `--main` lands the branch on main and starts the release job in
the background, printing its log path; `--no-release`, `--merge <branch>` and `--dry-run` work.
`pnpm release` builds in its own checkout (`~/.kolux-rs/release-checkout`), one build at a time with
one queued rebuild from the newest main, version one patch above the project or the newest
release, signed NSIS installer + `.sig` + `latest.json` + notes (30 subjects and a hidden source
marker, so a released main is skipped), smoke-tested so installer, manifest and
`kolux-dev --version` agree. CI (`.github/workflows/ci.yml`) runs four shards and one result job;
`release.yml` waits up to 30 minutes for green CI on that commit and writes any refusal to the
job summary; `node scripts/workflow-check.mjs` validates both. Nothing is published until Txais
makes the real signing key and the TxaisX/kolux-rs-releases repository (see Decisions below).

T-093-a brings the editor (EDIT-001). New tab > File... picks a file and opens it as a tab beside the
focused pane, in CodeMirror 6 with its language's colours; typing puts an unsaved dot on the tab and
header, Mod+S writes it (atomically, keeping the file's own line ends) while the terminals screen is
up, and a failed save says why in a toast. Two cells showing one file edit one text. T-093-b..d
(markdown, diff tab, All Changes) are still open.

T-093-b brings markdown (EDIT-012). A .md file opens in a rich, document-style view with a Rich | Source
switch; typing in either view edits one text, so Mod+S and the unsaved dot work the same. Mod+Shift+V
opens a read-only Preview tab, Mod+Shift+O picks one of the worktree's markdown files, and
Mod+Shift+M starts untitled.md. Big files (over 600 KB) and files with tables, images or HTML open in
source with a banner that says why.

T-093-c brings the diff tab (EDIT-027). New tab > Changed file diff... lists the worktree's changed
files; picking one opens its diff inline, with a switch to side by side, F7 / Shift+F7 to step
through changes, and a ... menu for whitespace changes and wrapping. An unstaged diff can be edited
and saved; the diff follows edits made in a terminal within two seconds.

T-093-d brings All Changes (EDIT-029). New tab > All Changes shows every changed file of the
workspace in one scroll, loading each as it comes into view. The Files button opens a side list to
filter, jump and tick files off as viewed; large files wait for a click, images show before and after.

T-094-a brings the explorer (EDIT-033). Ctrl+Shift+E, or the right-panel button in the top bar,
opens the worktree's files on the right; walk it with the arrow keys or the mouse and open a file with
Enter or a click. Creating, renaming and deleting files from it come next (T-094-b).
Files made outside the app (an agent, a terminal) show up when the Kolux window gets the focus back,
when the explorer is shown again, or on a workspace switch (T-444): the tree and its open folders are
read again in place. There is no watcher yet, so a file made while you look at the window waits for one
of those.

T-094-b adds file operations to the explorer (EDIT-034, part 1). The + and folder buttons in its header
make a file or folder, F2 renames, Delete moves the selection to the Recycle Bin after one question, and
Ctrl+Z / Ctrl+Y undo and redo those steps. Alt+Shift+C copies a file's path. Copy, drag to move and
dropping files in from the desktop come next (T-094-b2).

T-094-b2 finishes the explorer's file operations (EDIT-034). Ctrl+C then Ctrl+V copies files into the
highlighted folder without overwriting anything, dragging rows moves them into another folder (the tree
scrolls when you hold near its top or bottom), and files or folders dragged in from the desktop are copied
where you let go. Ctrl+Z undoes each of these.

T-094-c adds Quick Open (EDIT-036). Ctrl+P lists the worktree's files, best name matches first; hovering a
result shows its full path beside the pointer, and Enter opens it. It needs ripgrep (winget install
BurntSushi.ripgrep.MSVC); without it the dialog says so and falls back to git's file list.

T-095-a adds the Artifacts page (SKILL-036, VIEW-012). The sidebar's Artifacts button opens a searchable list of
saved web pages beside a viewer. Add artifact copies a page and its pictures into Kolux so it opens offline;
links inside a page open in the system browser. Automatic capture of pages Claude publishes is T-095-b.

T-095-b fills the Artifacts page by itself (SKILL-035). Every page a Claude Code session publishes with
the Artifact tool lands there within a couple of seconds, labelled with its project and session, and opens
offline, scripts from the usual CDNs included. Publishing the same page again updates its one entry.

T-097 adds `kolux-dev open` (CLI-011, APP-056): it starts Kolux, or brings its window to the front if it is
already open or minimised, and returns once the app takes commands, so scripts can run `open` and then
any other command. If the app never answers it gives up after 60 s with an error.
[accounts] Two look bugs are fixed (T-037-fix-look). The top bar's Agents / Board / Terminals
switcher no longer covers the search box at the default window size: it stays centred while
both sides fit and moves aside when the right-hand group is wider; below 1100 px the search box
keeps only its icon so the window controls stay on screen down to the 900 px minimum. In a
small pane (the 4- and 6-pane layouts) a chooser's Start button now sits in a footer below the
scrolling choices, so after picking Terminal the button is in view; before, it was below the
pane's edge and the pick looked like it did nothing.

[accounts] The launch screen warns before starting on a nearly spent account (T-135). When a
provider the chosen seats use has used 80 % or more of its usage window, a line above Start says
so: "Claude has used 85% of its 5-hour window, resets today 9:05 PM. These 3 Claude sessions
may stop early." One line per provider, the agent named for one seat and a count for several;
Start stays usable. Codex figures come from the top-bar pill's own reading; Claude has none
until T-041 reads them, so no Claude line shows yet.

[accounts] Usage alerts (T-136-a). When an account reaches 80 % of a usage window, and again at
95 %, Windows shows a notification: "Codex · usage alert. Codex has used 82% of its 5-hour
window (the 80% alert), resets today 11:03 PM." Each alert comes once per window and again only
after that window resets, and a restart does not repeat it. Settings > Notifications has the
switch (on by default). Codex figures drive it today; Claude's arrive with T-041.

[accounts] Accounts lists (T-138). Settings > Accounts & keys shows a System default row first in both the Claude accounts and the Codex lists, then each managed account with its email (and organisation for Claude) and when it last signed in. Clicking a row makes it the account new panes use; panes already running keep theirs. Stale rows say Needs re-auth; a Codex account whose sign-in file has been gone for 30 seconds says Needs sign-in. Remove asks first in the row itself, deletes the account's own folder (retrying while Windows holds it) and hands back to the system default when it was the active one. Adding a Claude account that is already listed (same email in any letter case and the same organisation) adds nothing and says so; one email in two organisations is two rows. Adding a ChatGPT Codex account is refused while the user's own Codex settings name a custom model provider. The Codex System default row says Signed in with ChatGPT / Running on an API key / ... with a custom provider / Signed out, re-read whenever Kolux gets focus.

[accounts] Model step (T-139-a). The session chooser offers a model list only for Claude, Codex, Grok, Gemini and Cursor (each with Program default as an explicit pick); any other agent, like Aider, skips the model step and its seat is ready as soon as the AI is chosen.

[accounts] Account commands (T-141). `kolux-dev account add` runs Claude Code's own login (or, with `--agent codex`, Codex's device-code login) right in the terminal and the account then shows in Settings > Accounts; `kolux-dev account list` prints the Claude and Codex accounts with the one new panes use marked (`--json` for both). Nothing starts when Kolux is not running; Ctrl+C part-way through leaves no credentials behind.

[accounts] Terminals now use a proper light colour scheme in light mode (T-145-a): the Tango
palette on white, while dark mode keeps Kolux's own dark colours, and Match app theme still
follows the app. The terminal pane also knows how to answer programs that ask for its colours
or for light/dark mode, and tells subscribed programs when the mode flips, but on Windows those
questions are swallowed before they reach the pane, so that part is not live yet (T-145-b).

[accounts] The status bar can be trimmed (T-147): right-click it to tick or untick Agent status,
Resource Manager, Terminals running and Agents running, or to hide the whole bar; the choice is kept
across restarts, and Settings > Appearance > Show status bar brings a hidden bar back. A right-click
inside the Resource Manager popover stays with the popover.

[accounts] Terminal colour schemes (T-148-a): Settings > Appearance > Terminal colours now has a
search box and two scheme lists, one for dark mode and one for light mode, each row showing the
scheme's ground and four colours. Eleven well-known schemes ship (Tango, Campbell, Solarized,
Dracula, Nord, Gruvbox, One Half), and a scheme copied out of Windows Terminal can be pasted in;
a bad paste says why. Removing a scheme that is in use falls back to the default.

[accounts] Appearance in three foldable sections, with font pickers (T-148-b): Settings > Appearance
now has Interface, Terminal and Window & Sidebar, all open at first; a folded one shows a one-line
summary (for Terminal: the font and the dark / light schemes). A link to a setting in a folded section
opens just that section. Interface gains App font and Editor font fields that suggest the fonts
installed on this PC as you type; a font that is not installed still draws text in the default.

[accounts] Window & Sidebar switches (T-148-c): Settings > Appearance > Window & Sidebar can show the
app name beside the mark, and hide the sidebar's Tasks row, its Automations button, the status bar,
or single status bar items. Changes show at once; the status bar's right-click menu and the
Settings ticks always agree. The app name starts off and Automations starts on (DT-A6).

[accounts] Pane dividers and dim (T-148-d): Settings > Appearance > Terminal > Panes sets the gap
between panes (2 to 12 px), a divider colour for dark mode and one for light mode, and how far panes
not in focus fade. Moving focus fades the pane left behind over about 140 ms. Defaults keep the
measured look: 6 px, no colour, no dim (DT-A7).

[accounts] Agent dropdown (T-143): the New session menu, from the sidebar or a pane's plus, leads
with Claude Code, Codex and Grok; other installed agents fold behind "Show more agents", folded
again each time it opens. A search box reaches any installed agent (aid finds Aider), typing shell
or terminal offers a blank terminal, Enter takes the top row, and "Manage agents" opens Settings > Agents.

[accounts] Settings > Shortcuts now lists all 127 commands grouped by area (General, Tabs, Terminal,
Browser, Editor, File explorer, Settings) with their keys and Modified, Unassigned, Disabled and
Conflicts badges (T-096-a). Filters for all, modified, unassigned and conflicting sit beside a search
box that finds titles, areas, ids, extra words (cls finds Clear active pane) and keys however they
are written (Mod+K, Ctrl + K, Cmd+K). When two commands share a chord, both rows say so and name the
other command; switched-off agents' new-tab commands never count. Recording keys is T-096-b.

[accounts] Shortcuts can now be changed from Settings > Shortcuts (T-096-b): click a command's keys
and press new ones, Add a second shortcut, remove one with x, Disable or Reset. Esc stops recording
and keeps what was there; Shift alone or a bare key is refused with a note. Each change is written
straight into the Windows section of ~/.kolux/keybindings.json, leaving the rest of the file as it
was, and every open window picks it up. A shortcut that clashes shows Conflicts on both rows with a
Reset button on the one that caused it. Double-tapping a modifier and the app menu refresh are later (T-246, T-248).

T-092-a turns Settings > Accounts & keys into a grid of three Connect cards (Claude, Codex, Grok), each with a
one-line tagline and a loading placeholder until Kolux has looked. An agent that is not on the PC gets Install:
Kolux installs it through the Windows package manager with a progress bar and Cancel, stops it after 15
minutes, explains failures in plain words, and once it is in the card moves on to sign-in with no restart.
Managed Claude accounts sit under "Manage accounts (advanced)".

T-092-b gives every Connect card one state at a time (not connected, connecting, connected, needs attention)
with an "Other ways to connect" menu, a Cancel that also clears a leftover problem note, and buttons that
come back after 30 s if nothing answers. Grok connects by its own CLI login in the browser, by a device code,
or by pasting an xAI API key (advanced, pay-per-use) once into a small dialog; the key is sealed, never shown
again and handed to new Grok panes. A Grok sign-in already on the PC shows as connected. To try Codex's
connect live Txais needs Codex's native build (this PC has the npm script wrapper) and his own ChatGPT sign-in.

T-099 makes the agent menus honest: Refresh agents finds a newly installed agent without a restart, agents
switched off in Settings drop out of every menu, and a fresh install starts with no default agent until you
pick one with "Set as default". The New tab menu now lists each shell installed here (Windows PowerShell,
Command Prompt, Git Bash; WSL once a Linux distribution is set up), an empty agent chooser, and new or
existing markdown files.

T-185-a gets the command line ready to ship: an installed copy will carry `kolux` and a `kolux.cmd` shim in
its own folder, and its terminals find them first. If Kolux is closed the command says to run `kolux open`;
if it is open but slow, or the answer gets lost, it says so instead, and for a lost change it prints the
exact command that finishes it without doing it twice. `request-show` and `reset` let an agent check and
clear orchestration state. Putting that folder on the system PATH comes with T-250.

T-202 makes Disconnect safe: each one asks first and only ever deletes what Kolux itself created, a
saved key or an account Kolux added. When Codex or Grok is connected through a login you made yourself,
Disconnect deletes nothing and tells you the one command that signs out in that tool. Connected Codex and
Grok cards now have Manage next to Disconnect, and quitting Kolux stops any sign-in or install still running.

T-203 lets you add a folder that has no Git yet. Kolux shows the files its first commit would hold, with
anything that looks like a password or key file (.env, .pem and the like) unticked, then starts Git and
commits only what you left ticked.

T-204 adds Starter kits to the sidebar: six ready-made jobs for three AIs. Pick one, point it at your
CSV or notes (or press Try with sample data) and Kolux remembers what you entered for that project.
Pressing Start kit does not run the AIs yet; that is the next task.

T-205 makes Start kit run: one session per role, titled like "Analyst · Claude". A strip above the
sessions counts the roles that are done, opens the results folder, and says per role whether its AI
is working, waiting on another role, needs you, or stopped. The checker waits for the analyst and
gets its instructions by itself when the analyst finishes. Your last run's results are kept in a
dated copy. Also fixed: a new session could sit blank forever when several started at once.

T-098 adds keyboard travel. Ctrl+Shift+Up and Down step through the sidebar's workspaces and wrap
at the ends, Ctrl+1 to Ctrl+9 jump to a position, and Ctrl+Alt+Left and Right (or the two arrows
in the top bar) go back and forward like a browser. Ctrl+Shift+J, or clicking Search, opens a
palette: type a few words to jump to a tab, workspace, project or Settings page, or to start a new
workspace with that name.
T-111-c makes the palette smarter. The best match comes first (an exact name, then whole words,
then word starts, then partial matches and small typos), and on a tie the workspace you used last
wins. An issue or pull request number finds only that exact number, with or without #. Filter chips
under the search box keep only chosen repositories or kinds of row. Enter on Create workspace makes
and opens it at once, and actions that need an open workspace are greyed out without one.
T-112-a: adding a project that already has another tool's setup file (Conductor's conductor.json or
the Codex app's local environment) offers its setup and teardown commands for import into
kolux.yaml; a file that is too large or malformed is named in a warning and nothing is offered.
T-114: an automation that makes a new worktree for every run can choose to run the project's setup
in each new worktree; the option only shows when the project has a setup, and is off by default.
T-115-b: the worktree palette (Ctrl+J) also finds a worktree by its pull request or issue number or
link, an emoji shortcode, or the comment it was made with, and an empty box lists the one used last first.
T-116-c-a: Settings > a repository edits its base branch and its workspaces folder; empty fields show
the inherited value, and nothing is written unless a field is changed.
T-117-b-a: `kolux-dev worktree set` gives a worktree a new display name, issue link (or none with
--issue null), comment or parent, and the sidebar and the palette show the change at once.
T-214-a: Add project > Copy from a web address clones a Git project into a folder filled in for
you, shows Git's progress and its own words on failure, can be cancelled, and opens the copy;
New project makes an empty project with one first commit from a name, in the home folder unless changed.
T-215-a: the Projects header has a New group button; groups fold, nest inside each other, hold
projects (chosen in a project's settings), last across restarts even when empty, and delete with
or without taking their projects out of Kolux (folders stay on disk).
T-216-a: a pin on each workspace row puts it (with the workspaces made from it) in a Pinned
section at the top, optionally also in its usual place; Sort > Recent lists by latest activity,
with a newly added project or workspace on top; both last across restarts.

T-217-a: a moon on each workspace row puts it (and the workspaces made from it) to sleep: its
tabs and terminals close and the sidebar marks it sleeping; showing it wakes it. Group and sort can
hide sleeping rows (kept across restarts). Double-click a name (or F2) to rename it in place.

T-100-a adds per-seat options to the launch screen. A Claude Opus or Sonnet seat gets an effort
picker, and Opus a fast-mode box (fast mode bills usage credits). After a launch, the launch screen
in that project offers "Use last lineup", which puts back the shape, the folders choice and each
seat's AI and model. A Claude tab opened from the plus menu now starts on Opus at high effort,
unless your own Claude arguments on the Agents page already name a model or effort.

T-101-a: Settings > Terminal & sessions has "New workspaces start with" (1, 2, 4, 6, 9 or 12
panes). A workspace made from the sidebar then opens its terminal plus empty panes that ask what to
run; the classic look and reopened workspaces stay at one. A session started into a workspace, for
example by a starter kit, takes an empty pane before it adds a new one. Ctrl+] and Ctrl+[ move
between panes and wrap around, and typing follows. Two things wait in T-101-b: checking the
add/remove-session shortcuts with keys assigned, and Equalize, which needs resizable panes.

T-103-a: terminals keep their place when you switch workspaces or screens. One scrolled up stays
on the same line, one at the bottom keeps following new output, and a full-screen program still
gets the mouse wheel. T-103-b waits on checking the add/remove-session shortcuts with keys
assigned, and on settling whether removing an empty pane should ask first.

T-104-a: a new terminal picks the best shell that will actually start. PowerShell 7 if you have
it, otherwise Windows PowerShell, otherwise the command prompt set up for Unicode text, and the
pane header says which one you got. Terminals no longer carry Kolux's own behind-the-scenes
variables or a half-started Python environment. A project folder that was moved, or sits on a
drive that is unplugged, now says so instead of opening somewhere else, and an agent will not
start by itself at the top of a drive. T-104-b waits on the shell-ready signal and on the macOS
and Linux fallback.

T-105: the kolux-dev command line can now list the open terminals (by project, pane and tab),
open a new one, split one, rename one, bring one into view, and close one, a pane's tabs, or a
whole project's terminals. A new terminal opens quietly in the background unless you ask for it
to come forward, and closing checks that each program really stopped. The old terminal stop
still works and tells you to use close.

[accounts] The branch prefix, the "Next branch" sample and the Default compare base moved from
the sidebar's add-project form to Settings > Git & worktrees (T-116-a-fix). The form keeps one
link that opens that page.

[accounts] Codex accounts can now be named (T-138-b). Each Codex row in Settings > Accounts & keys
has a Name button; type Personal or Work and press Enter, and the row reads "Work · you@...".
When two Codex accounts share one email and have no names yet, both rows say so, so a personal
and a business workspace can be told apart. Kolux does not guess which is which: OpenAI does not
publish where a sign-in says personal or business.

[accounts] The right side of the Terminals screen is now one sidebar with two tabs, Explorer and
Source Control (T-146-a). Ctrl+L or the top-bar panel button shows and hides it, Ctrl+Shift+E and
Ctrl+Shift+G jump to a tab, and dragging its left edge makes it wider or narrower. After a
restart it comes back open or closed, on the same tab and at the same width. It is open on
Explorer the first time. Agents, Checks and Search tabs come with T-146-b.

[accounts] Source Control can now throw changes away (T-153-a): each row and each section but
Conflicts has a discard button, and a prompt first says what will happen, file by file or as
counts (deleted, restored, or losing its changes). Every confirmation prompt is now one dialog:
Cancel has focus when it opens, Escape backs out, and the don't-ask-again box only counts when
you confirm. VIEW-054 waits for Txais's click-through (T-153-c).

[accounts] If Windows can no longer open a stored key (a new Windows profile, a restored
backup), Kolux now clears just that key at start, the Claude card shows Not connected, and a
note at the top of the window says which key it was and offers Open Accounts & keys or
Dismiss (T-154-a). Every other setting stays as it was. The app's log now masks any Claude key.

[accounts] Stored keys stay sealed even when Windows' secret store stops answering (T-157):
a save then fails with a plain message and writes nothing, the key saved earlier stays as it
was and is never treated as lost, and clearing a key still works and stays cleared once the
store is back. The proxy address and browser search link are on the sealed list for when
their settings arrive.

[accounts] The folder button in the sidebar header, and Add project… in the new-workspace
composer, now open an Add project dialog (T-200): Clone from a URL is the big first choice,
with Open a folder… and New project beside it; arrow keys and Enter move between them and
Escape closes. Open a folder works as before; cloning and new projects arrive with T-214, and
until then their steps say so and offer Back or Open a folder.

[accounts] In the Choose what to run pane each seat now lists Claude Code, Codex and Grok first
(T-201-a); a featured agent that is not installed is greyed out with Not installed and a Set up
link that opens Settings › Accounts & keys, Claude Code and Codex carry a Docs link, the other
installed agents fold under More agents (n), and while the app is still looking for AI programs
the seat says so instead of calling anything not installed.

[accounts] Newcomer screens use everyday words (T-209-a): Add project offers Copy from a web
address instead of Clone, the sidebar says workspaces rather than worktrees and a terminal
rather than a shell, and toasts say project folder rather than repository; hovering the plain
label shows the exact Git term. A test reads every in-scope screen and fails the build when one
of repo, clone, checkout, worktree, shell, CLI or PTY shows on it.

[accounts] Interface language (T-210-a): Settings › Appearance › Interface has a Language
choice (System, English, 简体中文, 한국어, 日本語, Español, Français). System follows Windows and
falls back to English for anything else, Traditional Chinese included. Dates, relative times,
weekday names and sorted lists follow the pick at once and on the next start; Kolux's own words
stay in English until the language packs arrive (T-210-b).

[accounts] Missing-tool notices (T-211): the main screen now opens with a notice when Git is
missing (the app used to refuse to start without it), when GitHub's gh program is missing or
signed out once a GitHub project is registered, when GitLab's glab does not start once a GitLab
project is registered, and when no AI program is installed. Each has Check again and Dismiss; a
dismissed notice stays hidden across restarts until the set of GitHub projects changes.

[accounts] Token analytics (T-136-b): Settings › Usage now has an Overview / Claude / Codex
picker. Tracking starts off for each agent; turn it on and Kolux reads the logs Claude Code and
Codex already keep on this PC (nothing is sent anywhere). The overview shows total tokens, days
with use, the share read from cache, a 26-week green day grid with the best day ringed, and the
token mix. The cost reads n/a, marked partial, until the price table lands (T-137-a).

[accounts] Token panels and cost (T-137-a): the Claude and Codex panels on Settings › Usage now
have a range (last 7, 30 or 90 days, or all time; 30 by default) and a scope (Kolux worktrees, the
default, or every local use), a green bar per day, a list by model and the 10 most recent
sessions. Costs are worked out from Anthropic's and OpenAI's public price pages (read 2026-10-12);
a model with no known price shows n/a and the total is marked partial, a guessed one says inferred.

[accounts] T-206 finishes the kit strip. Each done role lists its files with Preview and Open:
Preview shows a Markdown file read-only, or a web page in a browser tab, beside the role's
session in one split that the next preview reuses; Open hands the file to Windows. Collect
results copies every role's files into one dated folder under kit-results with a README (who made
what, what was missing, a SHA-256 hash per file) and a Results page that shows the Markdown as
text with any script or javascript: link taken out. A stopped role can be restarted or moved to
another connected AI. The kit gallery lists the last 50 runs across projects with Open results
and Open project. Kits now refuse a folder that is not a project or under the samples folder.

[accounts] T-207 adds the first-run wizard. A brand-new profile opens a card over the dimmed,
blurred app: Kolux mark, four progress bars with tooltips, one of four, a heading, a scrolling
body and a footer whose main button carries a Ctrl+Enter chip (the chord fires it, never from a
text field or mid-composition, never while it is off). Welcome shows Claude, Codex and Grok tiles
with pulsing dots (still under reduced motion). Connect an AI reuses the Settings Connect cards and
keeps Continue locked until one reports connected; I'll do this later moves on. Your work offers
Pick a folder (closes as completed and opens Add project) or the six samples, spreadsheet first;
Try with sample data opens the sample as the workspace with one plain tab and pre-selects its kit.
Choose a kit shows the kit cards with their roles, the app-wide finish switch, Start kit (straight
launch in the kit's own sample folder with an AI ready, else the setup dialog, behind which the
wizard hides) and Just open a session. Progress is kept in the store (kv onboarding, version 7).

[accounts] T-208 finishes the wizard's ways out. Escape, a left click on the dimmed app around the
card or the corner close asks "Skip setup?", pointing to Onboarding in the sidebar help menu, with
Skip and No, keep going (right clicks and clicks on the card do nothing). The close is stored
before the wizard goes: a failed store keeps it open with a toast, and the next click tries the
same close again. A record from an older version is raised to version 7 on start, keeping its other
fields. After Pick a folder, or Skip while no project exists, the next project added starts the
saved default agent in it, once.

[accounts] T-201-b gives the chooser pane the older launch dialog's kit row: the six starter kits
and See all kits (the gallery). Choosing a kit folds Advanced (shape, count, folders), lists the
kit's roles with the AI each gets, and turns Start into Set up kit, which opens that kit's setup;
a kit started from there closes the chooser. Choosing it again clears it and puts the seats back.
The footer counts the sessions and names the first seat (or role) still lacking an AI or a model.

[accounts] T-153-b: End in the Resource Manager reads the sessions again before it asks; a
session that has already ended drops from the list with no question, and a failed read still
asks, so nothing is ended unasked. The past-session files (VIEW-089) wait for the Agents tab
(T-153-d) and Manage Sessions waits for the background host (T-153-e).

[accounts] T-154-b: the app window now reads, saves and lists files only inside your projects
and their worktrees. Open a file shows Kolux's own picker, and the one file you pick opens even
outside a project, but nothing else in its folder does. Network shares, a whole drive and links
that point out of a project are turned down with a plain message.

[accounts] T-171: the AI connection cards now notice by themselves when an agent is installed
or removed outside Kolux (every 5 seconds while the window is visible, and at once when it gets
focus back). New Claude panes no longer pick up a 1-year key Kolux itself was started with
unless key mode is on; with a managed Claude account, a pane whose own settings set an Anthropic
key or token is not started and says which override to remove. A new Codex pane waits about two
seconds for the chosen account's sign-in, then starts on the system login instead of hanging.

[accounts] T-170: Usage no longer counts a forked or copied Claude or Codex session twice. The
turns a fork copied stay credited to the original session; if the original file is deleted they
move to the copy that is left, so the total stays the same. Rescans skip files that did not change,
nested folders are read, Codex accounts whose folder points outside Kolux's own storage are not
followed, and results saved by the older scan are rebuilt once.

[accounts] T-136-c: the Usage page now opens with three cards counting Kolux's own activity:
agents started, time agents spent working and pull requests created, with the date counting began.
Before any agent has run it invites you to start the first one. The counts come from the agents'
own status reports, so reloading the window never adds a turn, and they survive quitting Kolux
while an agent is busy.

[accounts] T-339 (cleanup): the Automations button now has one switch, Show Automations button in
Settings > Appearance, which governs the title-bar and sidebar buttons together (the separate Title
bar card is gone). The Notifications page lists each kind once. The launch screen now warns about
Claude's usage as well as Codex's. kolux-dev orchestration reset says what each scope cleared and kept.

[accounts] T-171-b: "Check again" on a connection card now looks for the agent afresh and clears
the old warning; it no longer starts a sign-in. The Claude, Codex and Grok cards re-read their
status whenever Kolux gets focus back. Before a managed Codex account starts, your own Codex
settings are copied into it (project trust Codex wrote there is kept); a missing, empty, locked
or broken settings file shows a warning and never stops the launch. On quit, sign-ins the agents
renewed are saved again, Codex first, then Claude, each step limited to two seconds.

[accounts] T-170-b: an automation run (or anyone in a terminal) can now ask Kolux what the
sessions in its own worktree used: `kolux worktree current --usage` rescans the tracked providers
and adds input, output, cache and session counts for that worktree, its subfolders included and
worktrees nested inside it left out. Token scans also remember what each log file held across
restarts, so the first scan after starting Kolux again reads only the files that changed.

[accounts] T-154-c: the Explorer can now create, rename, delete, restore, copy and move only inside
your projects and worktrees, Source Control stages and discards only there, and the kit result check
ignores other folders. Files you drag in from the desktop can still be copied into a project. A file
you picked with Open a file stays readable after Kolux restarts, so a reopened tab for it will load.

[accounts] T-136-d: Pull requests created on the Usage page now goes up by one each time Kolux makes a pull request from Source Control. Linking a pull request the branch already has, or a create that fails, does not count. The count is kept with the other activity numbers across restarts.

[accounts] T-138-c: the list of Codex accounts now sits under Manage accounts (advanced), below the Claude accounts list, with its own Add Account button. The Codex card above just says whether Codex is connected and offers Manage and Disconnect. Switching or renaming an account in the list shows on the card straight away.

[accounts] T-201-c: every AI in the session chooser that has its own documentation now shows a Docs link beside its name, including the ones folded under More agents (Aider, Goose, Gemini and the rest). Each address was checked against that agent's own site. Trae is the only one without a link, because no official page for its command-line tool could be found yet.

[accounts] T-206-b: when an AI working on a starter-kit role stops because it hit its usage limit or needs signing in again, its row in the kit strip now says so in plain words. A usage-limit row offers to move the role to another connected AI (no button when there is none); a sign-in row has a Sign in button that opens the AI connections page.

[accounts] T-207-b: starter kits only count and hand roles to the AIs you have switched on. With Codex switched off on the Agents page, every kit role goes to Claude; switch Codex back on and it gets its share again. (It already worked this way; it is now written down and tested.) The first-run milestone and the grid tour wait for their own tasks.

[accounts] T-209-b: the automatic plain-words check now also reads the first-run wizard and the dialog that offers to start Git in a plain folder. It found one technical word: that dialog said a folder 'is not a Git repository yet'. It now says 'is not a Git project yet', and hovering 'Git project' shows the technical term.

[accounts] T-043-e: on a Mac, Claude Code keeps its sign-in in the system keychain rather than a file. Kolux RS now has the rules for that written down and tested against a pretend keychain: the new account keeps an entry of its own, your own Claude sign-in is put back after the browser step (and the add stops if it cannot be), unchanged or repeated credentials are never taken, and the newer copy wins when the keychain and the file disagree. Nothing calls them yet: that needs a Mac to learn the entry names and to try it for real (T-043-f).

[accounts] T-263: the reset times on the usage pills now count down by themselves (for example 'resets in 4h 5m', then 'resets in under 1m', then 'resets now') without waiting for the next usage report. Settings > Appearance > Status bar has a new 'Usage percentages' choice, Used or Remaining, for the Agents screen's usage footer; the top bar keeps showing what is left. The live check caught the last minute reading 'resets in now', which is fixed. Sharing a usage card and the quota of Gemini, Antigravity, Kimi and MiniMax are still to come (T-263-b, T-263-c).

[accounts] T-265: Settings > Agents has a new Prompt-cache timer, off unless you switch it on, with a length of 5 minutes or 1 hour. While it is on, a worktree's card in the sidebar counts down from the moment a Claude agent there goes idle: minutes and seconds, yellow in the last minute, and at zero a red clock whose tooltip says the next message sends the whole conversation again without the cache. With two Claude tabs in one worktree the card shows the one closer to running out. The switch was tried live; the countdown itself has not been seen with a real Claude agent yet (T-265-b).

[hooks] T-152 (STAT 005 acceptance, six lines): installing hooks never damages the user's own settings. (1) A test, dev or evidence build writes agent settings only inside the temp folder, so his real CLAUDE_CONFIG_DIR is unreachable from them; (2) before the first write Kolux copies settings.json to settings.json.bak-kolux, refuses the install when the copy fails, and records both sha256 values in ~/.kolux-rs/agent-hooks/claude-settings.sha256; (3) only entries whose command contains .kolux-rs/agent-hooks change (an install that would change anything else is refused, a file that is not JSON is refused before any copy); (4) his status line is kept in claude-status-prev.json/.sh, still runs after Kolux's, and comes back exactly; (5) every write goes to a temp file in the same folder, is synced, and is renamed only if the file is unchanged since it was read; (6) switching off gives back the pre-install bytes (proven on a synthetic file shaped like his: 12 events, a status line chain, 12 skill overrides, 2-space indent; sha 12c0c758 before, as backup and after off), and nothing is written into CODEX_HOME until T-025-e. Second pass (council gates audit): the status line slot is saved before the settings file is touched, the install writes against the bytes read at the start, a {"hooks":{}} Codex file comes back byte for byte, and on then off on the coordinator's stripped copy of his real settings file (13066 bytes, 12 old-app hook entries) leaves those entries untouched and gives the copy back byte for byte (sha c0aa884f before and after). The run on his real file itself waits for his yes (T-025-d). evidence/T-152.txt.

## Decisions made for Txais (before 2026-10-12)

- 2026-10-09 · [release] T-090 · Updates use Kolux RS's own feed (OD-20) with Tauri's signed JSON manifest; release notes ride in the manifest; the updater uses the system TLS stack (native-tls) because the default rustls build pulls a CDLA-Permissive-2.0 certificate bundle cargo-deny rejects; card and pop-up sit bottom-left above "Next that needs you"; timings and the dismissed-version rule as DECISIONS.md DT-R01..DT-R06.
- 2026-10-09 · [release] T-091 · Releases carry installer, .sig and latest.json (no block map); ship messages come from claude -p with haiku by default; the version is set only in the release checkout, never committed; --main lands by a fast-forward push of HEAD to main; the GitHub publish runs only for a GitHub origin or inside Actions, rehearsals publish to a folder; CI shard split as DECISIONS.md DT-R07..DT-R12. For Txais, once, before the first real release: run pnpm tauri signer generate -w ~/.kolux-rs/release-signing/kolux-rs.key and back the key up, create the public TxaisX/kolux-rs-releases repository, and add the secrets KOLUX_RELEASE_KEY, KOLUX_RELEASE_PUBKEY, KOLUX_RELEASE_KEY_PASSWORD and KOLUX_RELEASES_TOKEN to the main repository.
- 2026-10-09 · [release] T-093-a · Until the explorer (T-094) exists, files open from a File... item in the New tab menu through Windows' Open dialog; the editor is CodeMirror 6 (MIT), not Monaco, because it is small and its packages are MIT; a file that is not UTF-8 text does not open (the reason and Retry show) rather than being guessed at; the read-permission acceptance check moves to T-094 because Windows' dialog refuses an unreadable file itself (DT-R13).
- 2026-10-09 · [release] T-093-b · The rich markdown view is Lexical (MIT) using its own markdown import and export, not ProseMirror with markdown-it (markdown-it needs argparse, whose Python-2.0 licence the build brief does not allow); the first edit in rich view rewrites the file in Lexical's markdown spelling (for example a blank line between a bullet list and a task list) while every word is kept; files with tables, images, HTML, front matter, reference links, footnotes, horizontal rules or underlined headings stay in source with the reason, because Lexical's markdown support has no place for them; the preview is rendered with marked and cleaned with DOMPurify, and its links do nothing when clicked; Mod+Shift+M already creates the untitled notes, while naming a note on its first save stays with T-237 (DT-R14).
- 2026-10-09 · [release] T-093-c · In a diff tab, Show whitespace changes off (the default) hides changes made only of spaces, tabs or line breaks rather than drawing space marks; the diff refreshes by reading git every 2 s while its tab is in front, since there is no git status watcher yet; until Source Control and kolux file diff exist, diffs open from a Changed file diff... item in the New tab menu (DT-R15).
- 2026-10-09 · [release] T-093-d · In All Changes a section over 2000 changed lines waits for a click, text sections stop at 560 px, changes are read every 2 s while the tab is in front, and a viewed tick clears when that file changes again; the tab opens from New tab > All Changes until Source Control and kolux file exist (DT-R16).
- 2026-10-09 · [release] T-094-a · The explorer is a 280 px card on the right of the Terminals screen, closed at start, folders first then plain alphabetical order; Ctrl+Shift+E opens it into the tree and pressed in the tree hides it (DT-R17).
- 2026-10-09 · [release] T-094-b · New file and New folder sit in the explorer header, F2 renames inline, Delete asks once inside the explorer; undo of a create sends it to the trash; undo history lives only while the app runs; copy path writes the clipboard from the app side (DT-R18).
- 2026-10-09 · [release] T-094-b2 · Mod+C / Mod+V copy into the highlighted folder, with no cut; a taken name becomes "name copy"; drags and desktop drops land in the folder under the pointer, a file row meaning its folder and empty space the root; drags use pointer events (DT-R19).
- 2026-10-09 · [release] T-094-c · Quick Open ranks name-prefix, name, letters-in-name, folder, letters-in-path; 50 results, list capped at 200,000; the markdown and changed-file pickers rank and show paths the same way (DT-R20).
- 2026-10-09 · [release] T-095-a · Artifacts are stored per page path under the app data folder with capped assets from the page's own folder; the viewer is a sandboxed frame on a kolux-artifact scheme limited to the entry's files; outside links go to the system browser (DT-R21).
- 2026-10-09 · [release] T-095-b · Claude publishes are read from session transcripts only, from each file's end at start, with publishes over 60 s older than start ignored as replay; one entry per URL, newest wins; CDN scripts from Claude's own allow-list are stored offline; paths this machine cannot read are remote (DT-R22).
- 2026-10-09 · [release] T-097 · kolux open asks a running app to come forward first and starts the app beside the command only when none answers, then waits up to 60 s; KOLUX_USER_DATA_PATH and KOLUX_APP_EXECUTABLE override where it looks and what it starts (DT-R23).
- 2026-10-11 · [release] T-099 · A fresh install has no default agent (the spec forbids Kolux picking one), Refresh agents blanks a seat whose agent left instead of swapping it, WSL shows only with a distribution, and Remove session never closes the last empty chooser (DT-R26).
- 2026-10-11 · [release] T-092-b · Grok connects through its own CLI login against the user's own Grok home (no private home, unlike Codex); Kolux checks only that its auth.json exists, a CLI sign-in outranks a saved xAI key, and the key reaches Grok panes as XAI_API_KEY; Manage and Disconnect on Codex and Grok wait for T-202 (DT-R25).
- 2026-10-11 · [release] T-092-a · Connect cards install missing agents through WinGet (Anthropic.ClaudeCode, OpenAI.Codex, xAI.GrokBuild), read the PATH again from the registry afterwards and treat a finished install whose program is still missing as a failure; Grok shows no vendor mark until a public xAI kit file is found (DT-R24).
- 2026-10-07 · Task size: tasks group neighbouring cards of one tier, theme and area, at most 4 P0
  cards, 5 P1, 6 P2 or 5 H cards per task. That gives 338 tasks; at 6 passes a day the plan runs
  about 57 days if every task takes one pass. A task that proves too big is split in place.
- 2026-10-07 · Duplicate cards not covered by DT-39, built once with the owner named first by
  SPEC.md section 4: the jump-to-next-session command is built to TERM-030 (STAT-051 and VIEW-047
  pass against it); keep-awake is built to TERM-122 (VIEW-097, BROW-053 and APP-018 pass against it).
- 2026-10-07 · Two moves under the build-order rules: the shortcuts file and default chords
  (SET-011, SET-013) come right after the walking skeleton, because every later keybinding is
  pressed through that file; sealed secrets (ACCT-009) open the theme 4 block, because rule 10 says
  secrets are never stored in plain text first.
- 2026-10-07 · The walking skeleton launches Claude Code as its one agent: it is installed on this
  PC and is the agent the old app was pushed hardest on.
- 2026-10-07 · The firewall script is a gate for the spec files, not for loop artifacts. Run on
  PLAN.md it reports 18 hits, all of them the stack names LOOP.md fixes (Vite, React, xterm) and
  backticked commands; none is an old-code identifier. Recorded here rather than weakening the script.
- 2026-10-07 · No new source was used in this pass (spec files in this repo only), so PROVENANCE.md
  section 5 gets no line.
- 2026-10-07 · T-001: the app identifier is `com.txaisxiong.kolux-rs`, so the profile folder is
  `%APPDATA%\com.txaisxiong.kolux-rs` and never collides with the old app's `%APPDATA%\kolux`.
  State store = `state.db` (SQLite, WAL) plus `settings.json` written atomically; both open at
  startup. Our own crate carries `license-file` and `publish = false`; cargo-deny ignores private
  crates, the allow-list applies to dependencies only. Window evidence is captured with
  PrintWindow (renders the window itself), because a screen grab caught the game Txais was
  playing instead; that image was deleted before anything was committed.
- 2026-10-08 · T-002: the pane runs Windows PowerShell 5.1 (`powershell.exe -NoLogo`, the one every
  Windows install has) starting in the user's home folder; PowerShell 7 (`pwsh`) is not on this PC's
  path, so picking between them waits for the shell-choice card. Shell output crosses to the
  page base64-encoded so a character split across two chunks is never garbled. The renderer choice
  is GPU first, plain on any failure (TERM-103's "Auto"); the on/off override and the six-context cap
  come with the grid task (T-009), when there is more than one pane. Closing a pane ends its shell
  at once; the "ask first when a program is running" rule from TERM-014 is built with the pane
  header and the close keybinding, not here. The Close button shows the exit code when it is not
  zero (a killed shell reports 1), so a crash is never mistaken for a clean exit.
- 2026-10-08 · Proof routine for typing into the window: keystrokes are posted straight to the
  app's own web view window, never through the shared keyboard, so a check never types into
  whatever Txais has in front of him. (One early attempt used the shared keyboard route; the
  window was not in front, so the text "echo kolux-rs-ok" may have landed in another program.)

- 2026-10-08 · T-003: the default workspaces folder is `%USERPROFILE%\kolux-rs\workspaces`
  (PROJ-025 says "a workspaces folder inside a kolux folder in the home folder"; the `-rs` keeps it
  apart from anything the old app made). New workspaces use the nested layout
  (`<root>\<project>\<name>`); the flat layout and the per-project folder wait for the settings page.
  Every Git action runs the `git` program found on the path (checked once at startup; the sidebar
  shows its version); there is no bundled Git. A new workspace branches from the current HEAD of
  the main checkout; the base-ref chooser is T-013. Name cleaning: lower-case, spaces and
  punctuation become hyphens, repeated dots shrink, accented and non-Latin letters stay, fourteen
  common emoji become words (fire, rocket, bug, sparkles, star, heart, bulb, wrench, tada, check,
  zap, test-tube, memo, lock); other emoji are dropped rather than carrying a full emoji table.
  Removing a workspace first ends any terminal pane started in that folder, because Windows will
  not delete a folder a running shell sits in (seen live: the first removal attempt failed with
  "Permission denied" until this was added). A project can be added with the system folder picker
  (Browse, several folders at once) or by typing a path; the picker is the Tauri dialog plugin.
  Removing a project from the list is PROJ-008, not built yet; the pass's test project was cleared
  by deleting the fresh `state.db` (it held only the start counter and that one entry).
- 2026-10-08 · Evidence harness: `scripts\evidence\shot.ps1` and `type.ps1` are now in the repo
  with a README. Characters are posted to the web view one every 120 ms; faster loses keystrokes
  while the page re-renders (seen live twice).

- 2026-10-08 · Txais: the look is pulled forward. After seeing evidence/T-002.png he asked that the
  app "look exactly like what we have running these sessions right now", so T-003b (the visual
  shell) was inserted after T-003 ahead of theme 7, built from design/DESIGN.md, a pixel-measured
  description of the running 0.15.0 window written by a designer who only photographed it (no old
  code read). Later theme-7 tasks finish each card properly; T-003b only sets the look.
- 2026-10-08 · Txais: vendor marks are used as model indicators (nominative use), sourced from
  public brand kits, never from the old app; X cards SESS-044/TERM-131/VIEW-104/SET-048/HID-040 are
  reinterpreted accordingly (coordinator will reword PLAN.md T-335 after this pass).
- 2026-10-08 · Kolux's own mark stays the six-spoke asterisk (vertical plus two diagonals, `#c5c5c5`)
  drawn inline in src/chrome/icons.tsx; app-icon.svg is untouched.
- 2026-10-08 · No bundled font files: Inter, JetBrains Mono and Cascadia Code are SIL OFL 1.1, which
  LOOP.md's licence list does not name, so the app uses system stacks (LOOK-1 above). Measured
  text therefore differs by a pixel or two from the reference where the installed font differs.
- 2026-10-09 · T-024: the notification is an in-window note until T-026 brings the desktop one
  and the settings that gate it. A plain shell's exit does not mark anything (only an agent's
  finish and any terminal bell do). The workspace row's unread mark now lives in the window
  (`App.tsx`) with the pane marks, so viewing the marked pane clears the row too; the sidebar's
  own state-change rule and the hand toggle (T-022) feed the same set. "In view" means the tab
  on top of a cell in the workspace in front (every pane on the Board); a visible split pane that
  is not focused counts as viewed, so it only glows (T-023) and is not marked.
- 2026-10-09 · T-023: a stopped agent ("Ended (code)", non-zero exit) is not Done and does not
  glow; only a clean exit reads Done with its age. The pane's finish time is its own clock read
  at the exit event (the sidebar's `changed` is read at the same event in the window; the two
  differ by milliseconds), so no shared store is kept until the Board needs one. A failed start
  counts as "needs you" in `status.ts`, but the window already drops a failed pane with a
  toast, so the next-that-needs-you cycle has nothing to visit until the hooks feed it.
- 2026-10-09 · T-022: with no status hooks yet (STAT-001, T-025) a row's state is read from
  the pane's program: a shell is idle, an agent is working until its program ends, then done;
  permission, blocked, waiting, interrupted and queued are typed and ranked now so the hooks only
  have to fill them in. The pull-request state is typed (`pr` on each row, null today) and the
  grouping is proved in tests only until GIT-025 (T-229) feeds it. The "Recent" sort is not kept
  as a choice: an old `workspaceSort: "recent"` is saved back as "smart" on first load, as the
  card asks. Unread marks live in the window only (not saved); a restart clears them.
- 2026-10-09 · T-021: the parent is recorded as the worktree's path (the store key the names use),
  not an id, since worktrees have no id of their own yet; the main checkout counts as a parent
  when the call is made from it (the card says "the worktree the command was called from" and
  the sidebar already groups the rest under main), and a call from outside every worktree (a
  plain shell with `--repo`) records no parent rather than failing. `--parent-worktree` must be
  in the same project; another project's worktree is refused. The calling terminal is recorded
  as its folder for now: the terminal handle and pane key the CLI will read from its environment
  are CLI-007's (T-088, in the orchestration lane; its line now names the hand-off), and the
  folder-workspace parent is PROJ-086's (T-218). `--issue` is validated as a number only; the
  lookup is PROJ-037's (T-107). `--setup` values are still only echoed (PROJ-033, T-107).
- 2026-10-09 · T-020: the saved folder wins over `KOLUX_WORKSPACES_DIR`, which only moves the
  default (PROJ-026's acceptance says "no folder setting"); so with a folder saved the variable
  does nothing, and the field says where its value comes from only while the variable supplies it.
  A save makes the folder right away (`create_dir_all`) so that a bad folder is a failure the user
  can retry rather than a later failed create; a relative folder is only saved, since it counts
  from each project root. The blur retry is "differs from the saved folder", which is the same as
  "equals the last failed attempt" because a successful save puts the saved value in the field.
  Save and Browse… keep the field's focus on mousedown, so a click never saves twice. Hidden
  worktrees by origin (made by Claude Code, GSD, elsewhere, extra roots) are not built here: they
  are PROJ-042/PROJ-044's rules and go with T-108, whose line now names them.
- 2026-10-09 · T-019: shared folders are junctions on Windows, not symlinks: a symlink needs a
  privilege most accounts lack and git treats it as a file, so a `node_modules/` ignore line
  would not match it and the new worktree would start dirty (seen in the test); a junction
  needs nothing and git sees a folder. `git worktree remove --force` leaves a junction (and so
  the folder) in place, so the links are removed first, which also keeps the shared folders
  safe. A folder-only ignore pattern is checked with a trailing slash so it matches before the
  folder exists in the main checkout. "Ignored" is `git check-ignore`, so a tracked file named
  in the include file is skipped rather than copied over. The kolux.yaml shared list is read by
  a small line scanner (block list or inline list under `worktree:`), not a YAML parser; the
  rest of the file is PROJ-034 (T-149). The pre-rename twin of kolux.yaml (COMPAT.md 5.6, HID-037)
  is not read: its name is not in the clean-room sources and HID-037 is retired, default skip;
  Txais names the file if he wants it read. The include-file copy budget and interrupted-copy
  warning are PROJ-032's (T-106). The dirty check is the removal's own refusal, so the sidebar
  form asks twice only when there is something to lose; the CLI keeps its `--force` flow and
  passes force on. The one-at-a-time rule is a per-repository mutex keyed by the main checkout's
  path; a poisoned lock is taken over, so a panic in one create never blocks the next.
- 2026-10-09 · T-018-b: "differs from its remote only by commits with identical patches" is read
  as `git cherry HEAD @{upstream}` marking every upstream-only commit `-`, checked only when the
  branch is behind, so the common path costs no extra git call. The base branch is
  `Git::default_branch` (origin's HEAD, else main / master, else the current branch); a repo
  whose origin was added by hand has no `origin/HEAD`, so its base reads as the local `main`
  until `git remote set-head origin -a`. Push, pull and sync use git's plain forms so the user's
  own pull policy applies; a diverged pull with no policy shows git's refusal (GIT-008, T-313).
  No push target is ever taken from the UI, so "a target that differs from the configured remote
  is rejected" holds by construction, as does "git only reaches remotes the user set up". The
  ten-minute "no repeating remote checks" acceptance holds by construction (status is local) and
  is proven in the Rust test with origin pointing nowhere: three status calls in well under a
  second, only an explicit fetch reports the trouble. The sync label shows the ↓ ↑ pair even when
  one side is 0. Create pull request, the wait while the PR check loads and the "PR already
  merged" reason go to T-228 (named in PLAN.md). Fix with AI's prompt now covers any failed
  action, not only a commit (GIT-009's push hand-off proper stays on T-227).
- 2026-10-09 · T-018-a: the stage card's batching rule is met by one git process fed
  NUL-separated paths on stdin (`--pathspec-from-file=- --pathspec-file-nul`, any count) rather
  than several argv batches; `--literal-pathspecs` so `[`, `*` and `?` in names match only
  themselves; untracked files are listed one by one (`--untracked-files=all`) so a new folder's
  files each get a row. "Blocked" means the commit failed while a pre-commit, prepare-commit-msg,
  commit-msg or pre-merge-commit hook file exists in the repo's hooks dir; anything else reads
  "failed". The right sidebar is a bare 320 px card holding only Source Control until
  VIEW-056/057 (T-146); Mod+L toggles it too. Ctrl+Enter also accepts Cmd. Section letters:
  U untracked, X unmerged. The multi-row bulk bar is built (T-018-c, [core]); the folder rows
  (stage everything beneath) went to T-033's tree view, named in PLAN.md. Status is polled every 4 s
  while the card is open until GIT-001's watcher. The draft lives in the window per worktree,
  not on disk. Evidence note: another lane's dev app was open during this pass, so `keys.ps1`
  (first window titled "Kolux RS") captured the wrong app once; the shots were retaken with a
  copy bound to this app's window handle. A `SendKeys` experiment typed "Add the docs folder"
  into whatever window was in front (Txais's Chrome, a YouTube tab) because `AppActivate` did
  not bring the app forward: never use `SendKeys`; `cdp.mjs type` / `key <name> <mods>` are the
  only typing paths.
- 2026-10-09 · T-017-b: Codex's key is the real path, lower-cased on Windows, exactly as the
  public Codex source resolves and writes it; both the worktree and the project root are
  trusted because Codex looks a linked worktree's trust up on the main checkout. `CODEX_HOME` is
  honoured when set, otherwise `~/.codex`; the rebuild has no managed Codex home of its own
  (Txais's shell currently points `CODEX_HOME` at the old app's managed home, which this pass
  neither read nor wrote: the live proof ran the dev app and the CLI with the variable unset,
  so his real `~/.codex/config.toml` gained the two entries). `toml_edit` (already in the
  dependency tree) edits the file in place so nothing else moves. T-017-c (Cursor, Copilot) is
  split off and left unticked: neither tool's trusted-folders storage is documented anywhere
  public, Cursor is not installed on this PC and Copilot's `config.json` carries only a
  first-launch stamp here, so there is nothing to copy the shape from. Options for Txais: install
  Cursor / trust a folder in Copilot once by hand and read back what each wrote, or drop the two
  from the card. Live note: Codex printed "Hook failed · hook exited with code 1" twice in the
  throwaway repo before answering; those are hooks from his own Codex profile, not Kolux's, and
  not part of this task.
- 2026-10-09 · T-017-a: T-017 is split in place: T-017-a is Claude (the agent this app launches
  today) plus the one-write batch; T-017-b is Codex, Cursor and Copilot, each with its own file
  format. The batch is the real list of folders the launch is about to use, not a list of
  names: the front end makes the worktrees first, then trusts them all in one `trust_folders_cmd`
  call before any pane mounts, so the "pre-trust 13 names → refused" rule became "more than 12
  folders in one call → refused before any path is resolved". The main repository is trusted
  through the project's registered path (Kolux's own record), never by following the worktree's
  `.git` file, so tampered Git metadata cannot extend trust elsewhere. The quarter-second merge
  window is not built: all writes go through one lock and happen before the processes start,
  and Claude's own rewrites keep our key because we write the flag before Claude reads its file.
  `serde_json` gained `preserve_order` so Claude's file keeps its key order on our rewrite.
  Live note: Claude itself adds `lastGracefulShutdown`/`lastVersionBase` to the main
  repository's entry when a worker runs in a linked worktree, so the config file's bytes change
  between two launches even though our entry does not. The throwaway repo's two entries stay in
  Txais's `.claude.json` (the feature's normal trace; harmless). A worker launched from the dev
  app inherits the launching session's environment (the pane showed Claude's "inherited
  CLAUDE_CODE_CHILD_SESSION" note): a test artefact of starting the dev app from inside a Claude
  session, not a product path.
- 2026-10-09 · T-016: tasks and dispatches are JSON lists under two store keys (no tables
  yet); the Board (STAT/ORCH cards) reads them later. Readiness = the worker's terminal has
  written something and is still running one second after; the spec's idle detector comes with
  the status cards. `new-child` is placed like `new-top-level` for now (lineage waits for parent
  cards). `--setup` is accepted but always answers `not_configured` (no setup hooks built).
  Tier routing is the shipped table in `cli.rs::route`; the per-provider routing page in
  Settings (ORCH-018) is not built, so `--tier` with an agent other than Claude or Codex answers
  `no_route`. A worker started from the command line stays a background tab: the view does not
  jump to it. The `kolux-dev` CLI binary is not rebuilt by `pnpm tauri dev`; after a Rust change
  run `cargo build --bin kolux-dev` before a live CLI proof. Seen again live: Claude's "Quick
  safety check … trust this folder?" prompt in the new worktree, which T-017 (SAFE-023) removes.
- 2026-10-09 · T-015: the copies choice lives on the chooser pane and defaults from the seat
  count and the Git state (separate for 2+ seats in Git, shared otherwise). Separate copies are
  made sequentially under the store lock (`workspace_create_fresh`), so parallel seats cannot
  collide on a name. The shared folder outside any workspace still means one fresh worktree for
  all seats (as before T-015); terminal seats always open in the chooser's folder. After Start
  the view shows the first pane's workspace and the other agents sit in their own rows, because
  a workspace is the view model. Retired creature names are kept forever under
  `creatureNamesUsed` (case-insensitive match). "Outside Git" is true only with no workspace
  and no project, because folder projects (PROJ-005) are not built yet. Found, not fixed (outside
  SESS scope): when two Claude seats start in the same instant one `claude.exe` launcher can sit
  at 0 CPU with one thread and its pane stays blank (the other seat and a single launch render
  fine); belongs with the terminal spawn work, worth a look when TERM tasks come up.
- 2026-10-09 · T-014-b: the CLI talks to the app over a loopback TCP port, one JSON line each
  way, with a per-start token in `<data folder>/cli.json` (removed at exit); the dev program is
  `kolux-dev` (COMPAT.md 2.1), the release `kolux` binary and the PATH / kolux.cmd shim are T-185
  and T-250. `--setup`, `--issue`, `--comment`, `--parent-worktree`, `--no-parent` and
  `--run-hooks` are parsed and checked (a prompt needs an agent; empty agent, prompt or setup
  refused; setup only run/skip/inherit; run-hooks clashes with setup skip; parent flags cannot
  disagree) but nothing runs on them yet: setup scripts, issues, comments and lineage are later
  cards; `--run-hooks` only activates. `worktree rm` removes the branch with the checkout, the
  same as the sidebar's Remove (T-013); CLI-020's "the branch stays under --force" comes with
  T-160, when the sidebar gets the same choice. `--worktree active` and identity:/issue:
  selectors are refused with a clear message until the app tracks them. Requests are answered
  one at a time. The CLI's not-running advice says "start it first" because `kolux open` is
  T-097.
- 2026-10-09 · T-014-a: the per-project workspaces folder and base ref live in the project
  record, edited behind the project row's gear, until a per-repository settings page exists. A
  relative folder resolves from the project root. Nested layout strips `.git` from the project
  folder name; flat puts every workspace straight in the folder. Folders used before are kept
  under `workspacesDirsUsed` (ten, newest first). A saved base that is gone falls back to the
  default branch with a warn-coloured note in the sidebar, no dialog queue. A base that tracks a
  remote is fetched on every create and a fetch that fails offline is ignored; a 40-hex commit id
  is never fetched; refs are passed to Git untouched. A prompt with no agent chosen picks the
  default agent, else the first installed one; the agent's tab is the first tab and no shell is
  opened beside it. T-014-b (PROJ-077, `kolux worktree` create / remove) is split off: no CLI
  binary or transport to the running app exists yet, and that foundation (transport, JSON
  envelope, exit codes: T-076, T-097, T-185, T-197, T-250) has to come first. The throwaway
  "repo" project from the live proof stays registered in the dev profile's store.
- 2026-10-09 · T-013: a project's folder is its main checkout whichever worktree the user
  picked (PROJ-007 "chosen on purpose"). A worktree under a dot-folder inside the main checkout
  (Claude Code's `.claude/worktrees/*`) is a tool's scratch worktree and is not listed; nothing
  else is filtered. A taken branch or folder name (local branch, any remote's branch, or an
  existing folder) gets `-2`, `-3` instead of an error (PROJ-021). Typed names are stored in the
  state store under `workspaceNames`, keyed by the lower-cased folder path, and forgotten on
  remove; Git never sees them. Until a settings page exists the sidebar header's plus is New
  workspace and the footer gear opens the add-by-path / workspaces-folder form. One create at a
  time: the field is closed while Git works and a second Mod+N waits; cancelling an overtaken
  create (and removing its half-made checkout) and the stand-in *tab* are not built, only the
  stand-in sidebar row. Folder projects without Git are PROJ-005, not built. There is no
  project-remove command yet, so the throwaway "repo" project from the live proof stays
  registered in the dev profile's store (its folder under the scratchpad may vanish; the row
  will then show an error until a remove exists).
- 2026-10-09 · T-012-b: the default search engine is Google (OD-18 said "a fixed standard web
  search"; DuckDuckGo, Bing and Kagi addresses are in `src/browser/address.ts` for the day a
  setting chooses one; the Kagi session link is not built). Back / forward availability is
  tracked by the tab from its own actions and the loads it sees, because wry exposes no
  can-go-back: a page's own `history.back()` or `pushState` can drift the dimming, not the
  navigation itself. A load that starts before the previous one finished counts as a redirect
  and replaces the entry (Google's `&sei=` hop proved this live). Ctrl+L / Alt+Left / Ctrl+R
  reach the tab only while the keyboard is in the app's own web view, not when the cursor is
  inside the page (the child web view has no IPC); a page click then a chord does nothing
  until the bar or a tab is clicked. Hard reload (Ctrl+Shift+R) is the same as reload. The
  evidence harness gained `scripts/evidence/cdp.mjs`: the dev app is started with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and the script sends
  keys and reads the DOM over that port, never through the shared keyboard; the earlier
  posted-message typing stopped landing while a full-screen game held the foreground.
- 2026-10-09 · T-012-a: a browser tab is a native child web view (WebView2) of the main window,
  not an iframe: iframes are refused by most sites' frame headers and give no history or
  title. Consequences to live with until a card asks otherwise: the page sits above every
  HTML overlay of the app (a menu or toast over a browser tab is covered; the page hides
  while its tab is away so the Board and Agents are unaffected); browser tabs are not Board
  cards (VIEW-023 / VIEW-024 own hiding editor / browser tabs); pages get no Tauri
  capability (`capabilities/default.json` names the `main` web view only). Opening a page
  moves the keyboard to it, so `browser_open` hands the keyboard back to the app's web view
  and the address bar re-focuses itself. The Ctrl+Shift+B chord itself was not pressed by
  the harness (it posts characters, not chords); the menu item and the key id are wired the
  same way. Harness: `scripts/evidence/type.ps1` targets the first web view child; with a
  browser tab open there are two, so T-012-a's proof used a scratch variant choosing the
  largest (app) or smallest (page) child, to fold into type.ps1 when the next browser task
  needs it.
- 2026-10-09 · T-011: the Board card and the grid pane are one DOM element styled two ways
  (`.board` on the cells container, `card` / `expanded` on the pane), not a terminal moved
  between two homes: React cannot reparent a mounted xterm without remounting it, and the
  spec's rule is that only the view moves. One card expands at a time (`toggleCard` in
  grid.ts) at a fixed 420 px height; a taller or resizable card can come with the Board
  polish (VIEW-023 / VIEW-024, T-028 / T-050), which also owns lanes, chips, chooser cards and
  hiding editor / browser tabs. The header's expand button is the Board toggle; on the
  Terminals screen it still reads "not built yet" (pane zoom is its own card).
- 2026-10-09 · T-010: a "tab" is a pane sharing a grid cell with others (`group` on the pane,
  `cellsOf` in grid.ts); the split tree of the old app (tabs holding split panes) is not rebuilt,
  so a split is a new cell and a tab is a sibling in the same cell. The tab create menu lives in
  the layout strip ("New tab"); browser and markdown entries join it with their own tasks (T-012,
  BROW / MD cards). `tab.close` and `terminal.closePane` both carry Ctrl+W and both close the
  focused pane, so the clash is harmless. Paste uses the browser's own paste event on the pane's
  text area instead of an asynchronous clipboard read: the clipboard is handed over in the same
  tick, so TERM-068's "cancel when the target changes while reading" has no window to guard; the
  paste chords are taken away from xterm (which would otherwise send ^V to the program). Neither
  the paste chords nor Ctrl+T could be proven live from the harness (posted keys carry no modifier
  state and no context menu opens from a posted right-click), so Txais should press Ctrl+V in a
  pane and Ctrl+T once by hand; the menu route and the tab strip were proven live.
- 2026-10-09 · T-009: the strip keeps DESIGN.md's 1 / 2 / 4 / 6 presets; 3, 5 and 7..12 panes are
  reached by splitting (the limit is 12, TERM-001), and the strip then shows no pressed button.
  Shrinking never removes a started session: TERM-003's "ask first" is T-151 (the one owner,
  named in `grid.ts` and `App.tsx`), so for now a toast names the newest started session in the
  way (T-009-fix-b). Closing a pane whose program is still running ends it without asking; the
  confirmation is TERM-045 (T-057). Closing the last pane leaves the empty placeholder, since tabs
  arrive with T-010. "Split down" is an index jump in the uniform grid (`ponytail:` in grid.ts), not
  a nested split tree, so a pane split down from the bottom row lands at the end. The three chords
  (Ctrl+W, Ctrl+Shift+D, Alt+Shift+D) are matched by the keymap unit tests and wired to the pane
  actions, but no chord could be proven live from the harness: the proof routine posts keys to the
  web view window and a posted key carries no modifier state, while the shared-keyboard route is
  forbidden (and, tried once, reached neither the new chords nor the older Ctrl+B). Txais should
  press Ctrl+W and Ctrl+Shift+D by hand once; if they do nothing, the keymap listener is the place
  to look (`src/App.tsx` onKey, `src/keys/keymap.ts` chordMatches).
- 2026-10-09 · T-008-b: the opening prompt lives on the seat (SESS-051) until PROJ-038 / TERM-126 /
  CHAT-029 add their own fields. The typed route (Aider, Goose, Kiro, Kimi, …) sends the prompt
  after the first 1.5 s of silence following output, a stand-in for SESS-032's readiness rule
  (P1), which replaces the timer; it is unit-tested but not proven live (none of those agents is
  installed here). Codex's "start line sent once the pane's shell is ready" is moot: the rebuild
  runs the program directly in the PTY, not through a shell, so Codex takes the plain trailing
  argument. The foreground matcher (`credited_agent`) is built and tested, but nothing polls the
  foreground yet: that belongs to the status cards (04-agent-status-hooks), so a pane is credited
  to the agent it was started as. The Hermes 24,000-character limit is enforced by the builder
  (SESS-005's reporting is the Start toast). Claude Agent Teams stays skipped (DECISIONS.md).
- 2026-10-09 · T-008-a: T-008 was split in place (SESS-015 + SESS-024 as T-008-a, SESS-051 as
  T-008-b); PLAN.md now has 341 tasks. "Same for all" copies the AI and model only; job titles
  stay per seat (one title on three panes would hide which is which). A pane without a job title
  keeps the workspace (creature) name from T-007-a rather than "Terminal N", which is used only
  outside any workspace; SESS-024's "a seat's title wins over any title the agent sets later"
  holds trivially, since panes do not yet take titles from the program (a later terminal card).
  Kit launches (the "reuse one untouched idle tab" rule) wait for the kits area; "the lineup is
  remembered only if an agent seat started" waits for the New session page (T-046), which is the
  first thing that would read it, so nothing is saved yet. The failure path (a pane whose
  session fails to start is removed, "Nothing started" when the whole lineup failed) is covered
  by unit tests only: every offered agent is installed, so no seat could be made to fail live.
- 2026-10-09 · T-007-b: the model lists are built in (`src/launch/seats.ts`) until SESS-029 (P1)
  asks each installed program for its live list; "Program default" is the explicit no-flag pick so
  SESS-015's "nothing is guessed" still holds. The quick counts settled on 1 · 2 · 3 · 4 · 6 · 8 plus
  the free field. The chooser's entry points are the plus-menu item and the empty-workspace button;
  the New session page (SESS-018) is T-046. One chooser's seats share a workspace: the chooser's
  own, or one fresh worktree for all of them when it was opened outside a workspace (a worktree per
  seat would scatter one Start across the sidebar; SESS-024 in T-008 decides the final rule).
  `--model <id>` is passed to every agent that has a list; agents without one only offer the
  program default. The free field applies on Enter/blur/spinner, not per keystroke (typing "15"
  from 2 would otherwise shrink to 1 and lose seat 2's picks).
- 2026-10-09 · T-007-a: T-007 was split in place (SESS-001 + SESS-004 as T-007-a, SESS-007 +
  SESS-013 as T-007-b); PLAN.md now has 340 tasks. SESS-004's "one item opens agent settings"
  waits for the Settings page (area 17); in its place each non-default row carries a "default"
  button, so the acceptance "make Codex the default" can be done from the menu itself. "Detected
  and switched on": there is no per-agent on/off switch yet (it belongs to the agent settings), so
  every detected agent is on. The shortcut chip beside the default agent shows only when
  `tab.newAgent` is bound (the built-in Windows default is unbound, as in COMPAT.md); Txais's own
  keybindings bind it to Ctrl+Shift+K, which the evidence shows. SESS-001's "reads the search path
  the user's shell would use" is covered on Windows by the usual-folder list (Explorer-launched
  apps already see the registry PATH); the macOS login-shell PATH read is left for the macOS
  pass. The missing-agent case keeps the agents out of sight (SESS-001 allows either), with one
  hint line naming what was looked for when nothing at all was found.
- 2026-10-09 · T-006: a row click now selects (shows) the workspace; it no longer restarts an
  ended shell there as T-003 had it (that was the only way to get a shell before there was a
  selection; an ended pane keeps showing "Ended" until its own restart card). Panes of the other
  workspaces are kept mounted and hidden (`hidden` on the pane section) rather than unmounted and
  rebuilt, because xterm's buffer is the state PROJ-066 wants kept; a hidden pane skips its fit /
  resize so the program never sees a 0x0 terminal. The start-up PowerShell pane belongs to a "no
  workspace" group with no sidebar row; it is shown at start and again when the shown workspace is
  removed. The "last pane is never removed" rule from T-004 still counts panes across all
  workspaces, so a workspace can become empty (it then shows the "Open a shell" placeholder).
  Live checks: `pnpm tauri dev` failed once with Windows error 1450 (insufficient system resources)
  in the Vite step and worked on the retry; nothing in the repo caused it.
- 2026-10-08 · T-005: a missing keybindings file is created "empty" as the shape Txais's own file has
  (version 1, empty keybindings map, empty darwin / linux / win32 sections); the defaults stay
  built in and are never written out, so a fresh file is a true "no overrides" file. The file is
  read once at start; reload is explicit (COMPAT.md 4.1 found no watcher), and the Settings
  reload / open / reveal buttons come with SET-012 (T-246). Linux takes the Windows column of
  COMPAT.md 4.3 (Mod = Ctrl on both). Only global-scope actions that exist today are wired to the
  keyboard (sidebar toggle, screen cycle); every other id resolves, shows its label, and waits for
  its own card. Chords are matched on the physical key (KeyJ) with the typed character as the
  fallback; the layout rules of SET-015 come later. Warnings (unknown ids such as the old app's
  `voice.dictation` and the cut `tab.openQuickCommandsMenu`, both in Txais's file) are kept in the
  keymap but not shown; only errors reach the notice. The live checks edited Txais's real file
  (backed up first, restored byte for byte, SHA-256 compared) because the file lives in the home
  folder by contract and the app has no test override for that path.
- 2026-10-08 · T-005: the Tauri icon generator also writes Android and iOS icon sets; they were
  deleted from src-tauri/icons (LOOP.md: Windows first; those targets are not built).
- 2026-10-08 · Default screen is Terminals, although VIEW-001 says Board when none was chosen;
  Terminals is the only screen with content until the Board task, and VIEW-001's own task will
  flip the default. Layout 2/4/6 buttons draw but do nothing until T-009.
- 2026-10-08 · The renderer note ("GPU renderer" / "plain renderer") moved from header text to the
  tooltip of the pane's status icon so the header matches the design's composition.
- 2026-10-08 · Usage pill reads "Claude · unknown  Codex · unknown" with each vendor's mark until
  accounts and usage reading are built; its tooltip says so.
- 2026-10-08 · Memory in the status bar is this process's working set (K32GetProcessMemoryInfo),
  formatted by src/status/memory.ts ("717.9 MB", "1.50 GB"); the old app's exact source for that
  number is unknown and was not looked up.
- 2026-10-08 · Pane and sidebar corners are 12 px as DESIGN.md says; the reference's curve runs one
  pixel longer (about 13 px). Left as is, within the 2 px tolerance.
- 2026-10-08 · T-003b follow-up (a second pass on the same task, run in parallel by mistake; it
  committed only its own files and left the T-004 work in progress untouched): the hand-redrawn
  OpenAI knot is out, because Txais's rule is "vendor logos only from public brand kits" and a
  redrawing is not a kit file; Codex gets Kolux's own neutral spark glyph until a kit file is
  obtained (LOOK-2). A render test (src/chrome/shell.test.ts) now fails if the top bar, its
  switcher, search hint, usage pill or window controls, the Layout 1/2/4/6 strip, or the status bar
  disappear; proven by dropping the "6" button (test failed) and restoring it. `cargo-deny` was
  not on this PC (no `cargo-deny.exe` anywhere under the cargo bin, AppData or the build folder),
  so `cargo install cargo-deny --locked` put 0.20.2 in `%USERPROFILE%\.cargo\bin`; the licence
  gate now really runs ("licenses ok"). How the earlier "cargo-deny green" lines were produced
  is UNKNOWN.

- 2026-10-08 · T-004 · Claude Code is launched as `claude --permission-mode auto` (the value SESS-027
  Compat names; `claude --help` on this PC lists `auto` among the accepted modes); Codex as
  `codex --dangerously-bypass-approvals-and-sandbox`. Agent detection is a PATH + PATHEXT lookup of
  the program name, done in Rust at start (`src-tauri/src/agents.rs`), so the menu shows what Kolux
  really found. Creature names come from 26 adjectives x 26 sea creatures written into
  `src-tauri/src/creatures.rs`, seeded from the clock, with `-2`, `-3` suffixes once a round is used
  up; a name is refused if any project already has a folder or branch of that name (case-insensitive).
  A launch from the sidebar goes to the only project when there is one, else the project that owns
  the focused pane's folder, else the first project; a launch from a pane header always uses that
  pane's project. The last pane is never removed (it shows "Ended"). Panes split evenly
  (`columnsFor`: 1 / 2 up to four / 3) until T-009 builds the grid. The live check pre-seeded the
  throwaway project straight into state.db (kv `projects`) and removed it after; during the first
  run extra launches appeared with no scripted input (a "Shell" row click, two more "Claude Code"
  picks), then the window was closed from outside: a click-recording rerun showed exactly one trusted
  click per scripted action and one launch, 50 s idle produced nothing more, so the extras are read
  as someone using the mouse while the app was in front, not a code path. The evidence harness
  note was extended: `type.ps1` needs the window activated first.

- [orchestration] T-086: the Automations page (DT-17) is reached from a clock button in the sidebar footer until AUTO-023's optional sidebar row (T-291) and the command palette exist.
- [orchestration] T-086: the "ask before deleting an automation" switch is the setting `confirmAutomationDelete` (on by default); the confirm bar's "Don't ask again" turns it off.
- [orchestration] T-086: Runs, New Automation and row Edit are shown but greyed until T-130 (runs page) and T-085 (create/edit dialog) build them.
- [orchestration] T-086: a search longer than 200 characters is refused (the box says so) instead of being run.

- [orchestration] T-087: Model routing is a page of its own, opened from a sliders button in the sidebar footer, until Settings > Agents exists (T-036 / T-054); it should move there then.
- [orchestration] T-087: the per-tier picks are saved in settings as `modelRouting.<provider>.<tier> = { model, effort }`; an empty model means the provider's own default (no `--model`, no effort).
- [orchestration] T-087: when a new model does not offer the current effort, the effort goes back to "Default" (no effort flag) rather than to some other level.
- [orchestration] T-087: effort levels offered are low / medium / high / xhigh / max for Claude Fable, Opus and Sonnet, none for Haiku, and low / medium / high / xhigh for the Codex models.

- [orchestration] T-081: Codex's default ladder is gpt-6-sol at high / high / medium / low (DT-12: "newest Codex model"; Codex's own models cache on this PC lists gpt-6-sol, gpt-6-astra and gpt-6-luna as the newest, and `~/.codex/config.toml` uses gpt-6-sol). This replaces T-016's gpt-5.6-sol / terra / terra / luna ladder.
- [orchestration] T-081: the Reset button is greyed while the chosen provider has no pick of its own.
- [orchestration] T-081 for the coordinator: the importer task T-181 (SET-035) should bring a 0.15.0 profile's routing table into `modelRouting` (COMPAT 5.7, ACCT-034 row). It was not added to T-181's line because that line is outside this lane's section of PLAN.md.

- [orchestration] T-077: `worker-start --worktree new-child` called from outside one of the project's workspaces makes a top-level workspace (no parent) instead of refusing; called from the main checkout it is top level too, since main is never a parent row.
- [orchestration] T-077: the nesting switch is a checkbox in the footer gear form (setting `workspaceNesting`, on unless false) until a Settings page holds workspace options. Folded rows are not saved; they reset when the window closes. A loop of parents (should one ever be written) is listed flat rather than hidden.

- [orchestration] T-085: split in place. T-085-a is the timetable and the dialog (AUTO-001, AUTO-005); T-085-b keeps event triggers and background runs (AUTO-004, AUTO-011), which need T-025's hooks and T-176's PR polling, plus RRULE lines with INTERVAL other than 1, COUNT, UNTIL, BYSETPOS, DTSTART or numbered weekdays, which are refused with a message until then.
- [orchestration] T-085-a: a timetable that is not one of the presets is described as "Custom: <line> (zone)" rather than turned into a sentence; an RRULE that leaves out BYHOUR / BYMINUTE runs at minute 0 / hour 0; a due time more than 2 minutes old (Kolux was closed or asleep) is skipped to the next one, and the grace window for those is T-175 (AUTO-007); the clock checks every 30 seconds. `jiff` (already in the lock tree through another crate, MIT/Unlicense) is now a direct dependency for time zones. Editing an automation that waits for an event turns it into a timed one until T-085-b adds events to the dialog.

- [orchestration] T-078: a new chooser starts on Custom, so nothing changes for someone who never picks a shape; the role briefs are Kolux's own one-sentence wording (the card names the roles, not their text). Handoff notes live in the main checkout's `.kolux/handoffs/` (or the chooser's folder outside any project); when the seats share one folder each note is named `<folder>-seat-<n>`, so no two agents share a note. The rules block names the note's full path as the one file outside the worktree the agent may write. Kolux cannot hide the prompt inside the agent's own screen (Claude Code echoes it in full); what Kolux itself shows, the start line on hover, has the block cut. Multi-line opening prompts reach a typed-route agent or a .cmd shim only up to the first line break until T-163 (SESS-032).

- [orchestration] T-082: terminal handles are `term-<n>` (the pane number); the pane key is a 128-bit secret made at spawn and forgotten when the pane closes. `--from <handle>` is accepted for any open Kolux terminal (the CLI token already limits callers to this machine and user); per-Run authority over another pane or Run (`check --terminal`, `--run`) is ORCH-033 (T-155). A terminal handle is its own mailbox (term:<handle>), read by that pane on check next to its Run and its active dispatch, so a handle can never be ambiguous between Runs. check --wait polls the app every half second from the command line (the app answers one request at a time) and defaults to 5 minutes without --timeout-ms; a timed-out wait is a success with `timedOut: true` (exit 0). `check --ack <id>` acknowledges and then returns the next batch. Group addresses (@all and the rest, ORCH-004) are refused as unsupported until T-190 (done reports and heartbeats are refused for groups outright, as the card says); the pointer typed into an idle pane is ORCH-007 (T-030). worker-start now stamps the calling Run on its dispatch so a worker that names no recipient writes to its Run; tasks scoped to a Run (task-list per Run, ORCH-011) come with T-083.

- [orchestration] T-083: dispatch refusals use fixed codes (not_found, task_waiting, task_taken, task_not_ready, own_pane, not_an_agent, busy) so scripts can match them. Kolux counts a pane as an agent only when Kolux started that agent program there and it has written output and then been quiet for 1 s; an agent typed into a plain shell is not counted. `--inject` types the brief as one bracketed paste followed by Enter. `inbox` is newest first, 20 by default, 200 at most, bodies cut at 120 characters. `--deps` must name tasks that already exist. Task text is capped at 4 MiB. Each hand-off is stamped with the running app's process so a pane number reused after a restart is not mistaken for the old worker. Handing a task to the coordinator's own pane inside the nesting budget waits for T-155 (ORCH-032). Marking a task finished from a live agent waits for task-update (ORCH-012, T-071); promotion of waiting tasks is covered by unit tests.

- [orchestration] T-084: brief commands carry no `--from`; the worker's own pane variables tie them to it. Without a Run, reports go to the coordinator's pane. Questions go out as `send --type question` plus `check --wait` until the ask command lands (ORCH-029, T-190); the dispatch pass joins the commands with ORCH-067 (T-155); the sub-worker section waits for the nesting budget (ORCH-032, T-155); the bare-shell "exit after reporting" line waits for terminal reuse in worker-start (T-089), since no worker today can be a bare shell. WSL workers do not exist yet, so the command is never a WSL path. Base drift is counted against the project's saved base, else its default branch, with no fetch. With a tier and no `--agent`, the worker runs on the agent Kolux started in the coordinator's pane, else the default agent; `--agent` with a tier is refused only when it differs from a known coordinator agent (a call from outside any agent pane may still name one). Seen live: a worker in a dev build ran the installed `kolux` because `kolux-dev` is not on PATH inside Kolux terminals; that is CLI-007 (T-088), and until it lands workers' reports from dev builds go nowhere useful.

- [orchestration] T-088: every terminal gets `KOLUX_APP_DIR` (a new name, next to the kept `KOLUX_TERMINAL_HANDLE` and `KOLUX_PANE_KEY`) naming the data folder of the app that opened it; the CLI prefers it over the installed app's folder, which is what lets a dev or lane build's workers reach their own app (the T-084 finding is fixed). The folder put first on PATH is the running app's own executable folder; in a development build that folder holds `kolux-dev.exe`, and the release launcher (`kolux.cmd`/`kolux.exe`, CLI-006) and the Linux `kolux` launcher folder come with T-185. `kolux status` (CLI-012, T-076) and `--version` (CLI-001, T-250) do not exist yet, so the live proof used `Get-Command kolux-dev` and `run-create`/`run-current` instead. Group addresses still wait for ORCH-004 (T-190) and `--dispatch-capability` for ORCH-067 (T-155); multi-line bodies on Windows need the native launcher (CLI-006, T-185).

- [orchestration] T-089 split: T-089-a (CLI-034, CLI-035) done; T-089-b (CLI-033 ask, CLI-036 worker list/show/read/stop/abandon/release/retain) waits for the ask flow (T-190), live worker state and transcripts (T-030), stop (T-071) and abandon (T-155). `task-update` waits for the task-state guards (ORCH-012, T-071). A reused terminal must already run an agent Kolux recognises, in the worktree named with `--worktree` (new worktrees are refused with `--terminal`); if the caller's pane runs a different agent, or `--agent` names one, it is refused. When `--spec` made a task and the hand-off then fails, the error names the task and the dispatch command that finishes it. Because a reused terminal must run the coordinator's agent and dispatch turns shells away, no worker can be a bare shell, so ORCH-014's "exit after reporting" line is not written anywhere. The pane key alone now identifies the caller (the handle in the environment is only a label). Structured chat sessions and older app versions (CLI-035's refusal and quiet-drop rules) do not exist in this build.

- [orchestration] T-106-a: new branches begin with the Git user name by default (`txais-xiong/fix-login`), as PROJ-022 says; earlier passes made the bare name. Setting fields `branchPrefix` ("user" when absent, "custom", "none") and `branchPrefixCustom`. A custom prefix Git refuses is a warning on create and the bare name is used (DT-O1, PROJ-022 amended). The control sits in the sidebar gear form until T-116 builds the Git & worktrees page.

- [orchestration] T-106-a: a workspace opened on an existing branch is marked `existingBranch` in its origin record and keeps that branch when removed, from the app and from `kolux worktree rm`; the remove confirmation now says the branch goes unless it already existed. The copy budget counts every file and folder under a listed path; over-budget entries are skipped whole.

- [orchestration] T-107-a: new worktrees are found by the sidebar's 5 s poll of Git's worktree list (DT-O2, PROJ-041 amended), not a folder watcher. The first look at a project takes everything already there as seen, so adding a project never shows a notice; a worktree removed and made again counts as new. Hidden worktrees are remembered per folder in the setting `worktreesHidden`; T-108-a adds the per-source defaults.

- [orchestration] T-108-a: "existing projects keep their earlier behaviour" (PROJ-042) is read as: the first time the visibility choices are used, every project already in Kolux gets its own choice "elsewhere on disk: shown" (what it showed before), and projects added afterwards follow the global default, which starts hidden for every source. Changing a global default then never touches a project that has its own choice; Reset puts a project back on the global one. Claude Code's `.claude/worktrees` folder is a source of its own (hidden by default, as before); other dot-folders inside the main checkout stay unlisted scratch, unless the workspaces folder the user chose is there.

- [orchestration] T-108-a: a worktree counts as Kolux's own when Kolux has a record of making it (app, CLI or open-existing-branch); workspaces made by earlier builds before this record existed show as external. Its only visible effect today is the "external" tag and the visibility rules; the global defaults sit in the sidebar gear form until T-116 builds the Git & worktrees page. The failed-to-save error ("could not save the visibility choice: ...") was not forced live.

- [orchestration] T-108-b for Txais: GSD's worktree folder is not in any public doc I could find, so worktrees GSD makes count as "elsewhere on disk" until someone names the folder.

- [orchestration] T-109-a: "Recent" in the composer's project list is read as the projects the composer last made a workspace in (up to 5, this computer only); before any, every project is under Projects in the sidebar's order. A name typed in the name field that equals one of the project's branches opens that branch as it is (the preview says so) instead of making a numbered new one. The optional note is the agent's first prompt. The Advanced branch name replaces the name the branch is made from but still gets the branch prefix. The main checkout cannot be a parent. With Create more ticked the new workspace does not take the front (an agent with a prompt still starts there), so the next name can be typed at once.

- [orchestration] T-111-a: the branch summary counts what the branch's commits changed since they parted from the base (`base...HEAD`), not uncommitted edits, so "commit 10 lines, +10" holds and the base's own new commits show only as behind. "Without a test count" is read as no test file changed: the one row is then Non-generated. Tests are files under a test / tests / __tests__ / spec / specs folder or named *.test.*, *.spec.*, *_test.*, test_*; generated are lock files, minified files, source maps, snapshots and anything under a generated folder (not yet .gitattributes). The upstream setting is a checkbox inside the opened summary until the Settings pages (T-116) can hold it. "A base pinned for the worktree" has nothing to read yet; the project's saved base is the pinned one.
- [orchestration] T-115-a: the Handoff note is the last section of the Source Control card, the right sidebar's only card so far. No setting disables an agent yet, so the agent list is every agent found on this computer with the default first; hosts are local only, so the note is keyed by folder path alone (a folder workspace and a worktree have different folders, so they never share one). "A new tab" is read as a new pane in the workspace's grid, the way New tab adds one. Removing a workspace forgets its note.
- [orchestration] T-116-a: the Git & worktrees settings are a titled part of the sidebar gear form until the Settings page (T-054) exists, as the gear already held the prefix. The sample uses the global Git user name (a repository can set its own; its branches then follow that one). The custom prefix is saved when the field loses focus or Enter is pressed, the sample follows each keystroke. Default compare base and the summary's checkbox are one setting, so either changes both.
- [orchestration] T-117-a: worktrees carry no identity record of their own yet, so `identity:` takes the same `<repo-id>::<path>` form as `id:`; `active` means the same as `current` (the command line has no focused-worktree notion); `folder:` is refused until folder workspaces exist (PROJ-086, T-218). `project list` is the registered repos in sidebar order (a project is a repo today). The row's board status is left for CLI-019 (T-117-b). Hosts are local only, so every list says covered: local, left out: none. `worktree ps` counts a terminal under the innermost worktree its starting folder is in.
- [orchestration] T-118: the base for changes and overlap is the repo's saved base while it exists, else its default branch, with no fetch (both commands only read); `repo show` now reports the same base without fetching. Untracked files count as changes. A sibling with no history in common with the base counts its changes from the base itself, so it can still be compared; its merge check then reports unverifiable. Only siblings that share a file are listed; their clash check uses the committed tips, as the card says, so shared uncommitted edits can show next to a clean prediction. The "plain folder workspace is not supported" rule has nothing to act on until folder workspaces exist (PROJ-086, T-218); `folder:` selectors are already refused.
- [orchestration] T-111-b: the pointer is read when the shortcut fires, so a row that has just gone away never counts; the main checkout row has no delete, so hovering it does not count. The Mod+R half of VIEW-048 waits for the tab-rename field (TERM-048, T-119); on Windows `tab.rename` keeps no default key until then, since Ctrl+R is the shell's history search.
- [orchestration] T-129-a: `worktree ps` keeps CLI-017's rule of listing worktrees with something running, now counting an unfinished worker dispatch as something running; the scope line counts every worktree scanned. "Repeated polls get tiny no-change answers" is per terminal (its pane key) and only for `--json`, since a person reading text wants the list each time; a call from outside a Kolux terminal always gets the whole snapshot. A scan is reused for 1.5 s and counted slow after 3 s (the card names no numbers). Remote host columns stay with area 18; the scope says this computer only.
- [orchestration] T-130: the runs already reach the page in one list (automations_list, at most 100 kept per automation by AUTO-021), so the batches of 100 are drawn from that list as the table is scrolled to its end rather than fetched page by page; nothing is fetched to load more, so it cannot fail part-way, and a failed Refresh keeps the rows shown with a note. Changing the search or the filter starts again at the first 100. Back from a run's page via Runs keeps the dashboard as it was (search, filter, rows loaded); only leaving to Automations resets it. Tiles count completed runs as successes and failed-to-start runs as failures; skipped and in-progress runs count in neither.
- [orchestration] T-133: the alert kinds and their defaults follow STAT-042 (task finished on, bell off, agent stopped on, usage on); its master switch, quiet minutes and confirmation stay with T-124. The sounds are three tones Kolux plays itself (Chime, Ping, Pulse) plus the system default; STAT-043's nine tones and a custom sound file stay with T-309. The system default sound plays at the system's own volume (Windows gives an app no volume for it); the slider sets Kolux's tones and 0 silences both. "Notifications are blocked" is read from Windows' ToastEnabled switch (Get notifications from apps); the per-app switch is not read yet; in a dev build the toasts arrive under the PowerShell app id, as for any unpackaged Tauri app. The notification plugin is called from Rust only, so no JS package or capability was added.
- [orchestration] T-155-a: the nesting cap's config value is `orchestrationMaxDepth` in settings.json (whole numbers of 1 or more; no Settings page, per SET-055); `--max-depth` on worker-start and dispatch sets it for that coordinator's workers, and a worker can only lower what it was given. A context-only dispatch to the caller's own pane is allowed while it has a level left (ORCH-013's own_pane refusal stays for injection and at the cap). Run scoping covers the commands built so far; sending mail to another Run is still allowed, since posting is neither seeing nor changing it. A worker acts in the Run of its dispatch without being tied to it, so its tasks and sub-workers land in its coordinator's Run. The sender label `--from` is still accepted as identity; refusing it is CLI-039 on T-160. Abandon frees the task (back to ready) so it can be handed on, as the card's 'fenced' implies; worker-list's 'abandoned' filter waits for T-089-b.
- [orchestration] T-160: `--from` now names only the calling terminal itself (it was any open terminal under T-082): another handle is refused as `caller_mismatch` and any `--from` from a shell Kolux did not start fails closed as `unbound_caller`, since the card has no place where acting as another pane is permitted. A done report or heartbeat naming a dispatch must come from that dispatch's worker terminal (`not_your_dispatch`), and one from a terminal of an earlier Kolux start is refused as unprovable; that is how 'a worker-done from a different pane does not complete the task' holds before T-030 builds completion. CLI-039's structured-chat and older-protocol rules belong to ORCH-049 and ORCH-048, both skipped in DECISIONS.md, so nothing is built for them; reporting an unsettled dispatch as an unknown outcome belongs to the settle step on T-030 (a report on a finished dispatch already fails). The renamed caller flag is check's `--terminal`. `--force` on worktree rm keeps the branch (CLI-020); the sidebar's Remove is unchanged. Typo suggestions name one nearest word (the first on a tie) and a flag typo lists the command's flags plus `--json`.
- [orchestration] T-186-a: PROJ-040's "dropped because it was archived" is read as "removed", since no archive card exists; the warning names the reason and the workspace sits at the top level. Falling back to the active folder workspace waits for folder workspaces (T-218), so T-186-b keeps it. The change-parent picker lives on the sidebar row (an arrow button), as the Board-card drop needs the Board (T-025..T-030); the main checkout is never a parent or a child. The CLI's `worktree create --parent-worktree` path is unchanged: it already resolves the parent before creating.
- [orchestration] T-187-a: SESS-020's "each seat has an AI" is read as the chooser's own readiness, so a Terminal seat counts as picked and can be saved. A team also keeps each seat's job title and opening prompt and the shared task (the card's optional prompt); the per-seat "options" the card names do not exist in the chooser yet, so there is nothing more to keep. Picking a team sets the Shape row to Custom with the saved roles on the seats, so the team button itself is not shown as pressed. The rename and delete menu is an inline row under the Shape row, and the undo offer is a note in the chooser rather than a window toast, because the app's toast carries no button. A blank name on save keeps Save greyed. Teams live in settings.json (`savedShapes`); the importer half of the compat note waits for the importer.
- [orchestration] T-189-a: VIEW-011's "View > Appearance" toggle lives in Settings > Appearance (a Title bar card), since the app has no View menu yet. The restored page is whichever page was open (Automations or model routing), as pages only show on Terminals. VIEW-069's dialog is a small form inside the Source Control panel rather than a window-wide dialog, and "the saved launch choice" is read as a remembered agent for Source Control's agent actions (`scmAgent`), set from the dialog's "without asking next time" switch and cleared by "Ask each time"; a remembered agent that is no longer installed brings the dialog back. "The prompt cannot be handed over" is read as: the start line or trust cannot be set up (shown in the panel), the program cannot be run, or it ends before a typed-in prompt was typed (both reported as a session that did not start, and the pane is dropped as SESS-024 does). Only resolve-conflicts is offered; other agent actions come with their surfaces.
- [orchestration] T-190-a: "idle" for @idle is read as an agent that has written nothing for 3 seconds, until the status cards' idle detector lands. @worktree:<id> takes the worktree list id (<project id>::<path>) or the bare folder, compared as text (slashes, a trailing slash and letter case aside). ORCH-009's read-only tag for an older install's mail has nothing to mark, since older installs' Runs are a skip (ORCH-048 in DECISIONS.md). ORCH-019's "the provider never changes" is read as: with no tier the worker runs on the coordinator's own agent unless `--agent` names one, and a model name Kolux knows for another provider is refused; a name it does not know is left to the agent, and Cursor takes any name. The coordinator's agent is now read from the program its pane was started with, without waiting for the pane to go quiet, since the coordinator is busy running the command (this also fixes a tier from a busy coordinator falling back to the default agent).
- [orchestration] T-190-b: a gate holds pending and ready tasks; one that is dispatched, completed or failed is refused, and a supervised worker still at work on the task is named in the refusal. Gates can stack on one task, and the task goes back to pending (then ready once its dependencies are done) only when the last open gate on it is resolved. No gate times out, since gate-create takes no deadline; `--status timeout` is accepted and lists nothing until one does. ORCH-029's question goes to the caller's Run by default (`--to` may name a terminal, run:<id> or dispatch:<id>), its choices ride in the payload as {"options": [...]}, and its answer is the first reply to it. The default wait is five minutes, the same as `check --wait`. CLI-033 (T-089-b) is now mostly built with it; T-089-b keeps only the packaged build's exit-status-75 hand-back.
- [orchestration] T-191-a: reset is not limited to the caller's Run; it clears the whole install's orchestration state, as the card describes. The tasks scope also clears decision gates, since they belong to tasks. Ids keep counting up after any reset, so a cleared message, task or gate is never named again. ORCH-031's "archived worker output" has nothing to clear yet, since no worker output is archived in this build. claude-teams always starts teammates in-process (`--teammate-mode in-process` with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, from Claude Code's public docs) until Kolux can answer Agent Teams' tmux calls (ORCH-042); WSL is not refused, since the card only keeps teammates in-process there.
- [orchestration] T-192-a: Kolux has no interface language setting yet, so "the interface language" is the window's own language (navigator.language, which follows the system); the chips' field names and the weekday and month names come from Intl in that language, while Kolux's own words (Valid, at, on) stay English until there are translations. The line in words covers five-field cron lines; an RRULE keeps the back end's sentence. The hour box runs 1 to 12, so an emptied hour box becomes 1, and the arrows stop at the ends rather than wrapping. The template prompts are Kolux's own wording. The grace window each template names (12 hours, 24 hours, 3 hours, 30 minutes) is kept with the template but not shown or saved until T-175 adds the field.
- [orchestration] T-193-a: usage reads "Not recorded yet" until usage is measured per run (T-140). The run count is the number of runs held in the history. Escape on the list closes the Automations page and returns to the terminals. The keys act only when focus is on the page or nowhere, so a terminal or the sidebar keeps its own arrows.
- [orchestration] T-194: "an unsupported Git is remembered" is met by the Git version Kolux reads once at startup: below 2.38 the merge check is skipped for the life of the app, with no probe. A version string that cannot be read is tried, and merge-tree's own failure then reads unverifiable.
- [orchestration] T-197: every automation row reads host "local" and never orphaned until remote hosts exist; `--workspace` alone means the existing-worktree mode, otherwise each run gets a new worktree; a timetable without --time runs at 09:00 and without --day on Monday, in the machine's time zone unless --timezone is given; the CLI request id is the create request id; `automations run` logs a manual run and exits 0 even when the agent fails to start, since the failed run is the recorded result.
- [orchestration] T-198: `agent-context --json` and the skills commands answer in the same envelope as every other command, with the document as its result; aliases are listed by their full words (worktree remove, worktree delete); the four bundled guides are new clean-room text written for this build, short guide = the skill file without its header, full = the guide followed by every reference; topic aliases are cli and kolux, orch, security, ward and injection; gate-create's no-Run refusal applies to gate-create only, and an explicit --from is never checked for being alive, though under ORCH-001 it still has to match the terminal the command runs in.
- [orchestration] T-175: until T-072 marks runs completed, a dispatched run counts as in progress, so the 100-run cap drops only skipped, failed and completed runs; the not-ready reasons are the project, the worktree and the active managed account's sign-in, with no setup-out-of-date check because Kolux RS keeps no setup version yet; with no grace, a due time up to two minutes old still runs, since the clock only looks every 30 seconds.
- [orchestration] T-192-b: the precheck runs in PowerShell on Windows and `sh` elsewhere; for a new-worktree-per-run automation it runs in the project folder, since the run's worktree is not cut until the precheck passes; a precheck that cannot start skips the run like a failing one; the last 4,000 characters of its output are kept, where the error usually is; the clock runs due automations one after another, so a slow precheck holds up the next due one by up to its limit.
- [orchestration] T-197-b: `--precheck-timeout` is in seconds and takes only the dialog's four limits (60, 120, 300, 600), so the page always shows the chosen one; `--source-context` is not built, since AUTO-028 in DECISIONS.md cuts it (CLI-029 still lists it); a precheck cannot be cleared from the command line yet, because every flag refuses an empty value; no precheck is skipped for out-of-date setup, as Kolux RS keeps no setup version yet.
- [orchestration] T-172-a: only a terminal that ends by itself escalates, so a tab the user closes, a removed worktree or Kolux quitting never does; until T-030 settles dispatches, a worker counts as done once it has sent its worker_done report; a worker started with no Run has no Run mailbox, so its death sends nothing; the escalation is addressed from the dead worker's own handle.
- [orchestration] T-173-a: receipts last seven days and the ledger holds at most 32 unfinished requests (neither number is given by the card); only worker-start can be seen pending, because every other change writes its result and its receipt in the same save; request-show answers only for the terminal that sent the request, since the ledger keys each id by its sender; a worker start that timed out keeps its timeout as the receipt, so a retry reports the same unknown outcome instead of starting another worker; a start left pending by an earlier run of Kolux runs fresh, since its terminals closed with that run.
- [orchestration] T-176-a: git's prompts are turned off with GIT_TERMINAL_PROMPT=0 and GCM_INTERACTIVE=never only (no SSH BatchMode, which would override a user's own ssh command), set before the user's own agent variables so they can turn prompts back on; automations are covered because their runs start agent panes the same way, and their prechecks get the same variables; a new branch with no commits of its own and no upstream shows no badge rather than "unpublished · 0"; a detached HEAD shows none; the badge sits where the row's hover buttons appear and hides while they show, so it never squeezes the workspace name.
- [orchestration] T-227-a: "commit then pull and push" pulls with --rebase; only hook failures and unsorted ones offer Fix with AI (protected, sign-in, network, submodule and behind-the-remote get a plain notice, since an agent cannot fix them in code); a protected-branch message wins over the hook-declined line that comes with it; the live Fix-with-AI click was skipped under the no-real-agent rule, the hand-off text is covered by a cargo test
- [orchestration] T-228-a: pull requests go through the gh CLI (its sign-in, GitHub Enterprise Server included) with prompts off and the description on standard input; the lookup runs only once the branch is published and off the base, and again when the branch or upstream changes, not on the 4-second refresh; an open pull request is linked instead of a second, a merged one refuses creation, a closed one allows a new one; untracked files do not block creation; Open pull request #N opens only an https /pull/ link and was not clicked live (it would open his browser); no gh time limit yet (GIT-028's limits sit with T-176-b)
- [orchestration] T-229-a: hand links are kept in settings under `scmLinkedPrs`, keyed by worktree path, and accept only an https /pull/ link (checked through gh before it is kept); a hand link is looked up even on the default branch; the sidebar's pr field waits for T-176-b's polling, since filling it now would mean one gh call per workspace every refresh
- [orchestration] T-230-a: history shows the newest 200 commits of HEAD plus its upstream; a remote label beside a local branch of the same name is left out, and the local copy of the base reads as base; a commit's files are against its first parent; Copy hash / Copy message were not clicked live (they would overwrite the clipboard) and Explain changes was cancelled under the no-real-agent rule; open-in-browser waits for T-230-b with the GitHub actions
- [orchestration] T-231-a: review notes live in memory for the app session (copied or cleared by hand), not on disk; in the rich view and the preview the line is found by matching the selected text (then its first three words) in the source, line 1 when markup hides it; turning the setting off hides the tray but keeps the notes; Copy as Markdown was not clicked live (it would overwrite the clipboard), its text is shown in the tray and covered by vitest
- [orchestration] T-232-a: gh is always given --repo HOST/OWNER/REPO from origin (not from the upstream's remote), except when the call names a pull request link; the SSH config reader follows plain Host / HostName blocks only (no Include or Match); a remote that is not origin-shaped GitHub leaves gh to its own guess
- [orchestration] T-233-a: Refresh the base first is off by default (as T-116-b already said), and T-233-a builds the base-refresh part of T-116-b; the gh login is read offline from gh's config, used only when git has no user name; a cleaned user name over 40 characters gives no prefix with a warning; the sidebar gear no longer carries the prefix and compare-base fields, the Settings page does
- [orchestration] T-250-a: the help pages are cut from the one usage list, so they never drift from it; -V no longer prints the version (the card names only -v and --version); the acceptance's terminal sned is shown with worktree craete because the terminal group is not built yet; the worktree group's set verb comes with T-231-b; registering the command system-wide (CLI-008) changes the user PATH, so its live proof needs a throwaway user
- [orchestration] T-290: the coverage check is a CLI command, skills coverage, until the Skills page (T-243) can show it; each agent's folders follow the community skills installer's published global paths, and an agent with no known folder is shown as not covered with that reason rather than guessed at; only the orchestration skill is checked
- [orchestration] T-291-a: AUTO-023 says the row is off by default, but DT-A6 keeps it on until the command palette exists, so there is still a way to reach Automations; the row replaces the foot clock button and keeps the automationsButton setting; the View menu tick and all of AUTO-024 moved to T-291-b because the View menu, a made-by-automation marker, the card properties chooser and View run are not built
- [orchestration] T-176-b: the refresh is one minute for the workspace on screen, doubling after each failure up to 15 minutes, and pauses while the window is hidden; every gh call is stopped after 30 seconds; the many-workspace queue, the API budget, the circuit breaker and the big-diff limits moved to T-176-c, since there is no background poller, budget reader or diff view yet
- [orchestration] T-071: worker-stop ends the agent terminal while the orchestration store is held, so there is never a 'still stopping' worker and its exit is not reported as a crash; a terminal the user typed into is ended like any other until ORCH-036 keeps it open; a worker-stop answer reads 'unverifiable' for a terminal from an earlier start of Kolux; task-update by a worker whose agent already ended is refused (worker_exited) rather than taken
- [orchestration] T-072-a: the card's 'same refusal for the same due time' is read as the same cause and reason as the automation's newest run, so an every-five-minutes automation with its project gone for an hour is one entry; a missed time stays one entry per absence (AUTO-007); a run left pending or dispatching by an earlier start is closed at once on start, since nothing in this process can still be starting it; completion, the 'pane never moved' failure and reconnecting after a restart moved to T-072-b, since Kolux has no agent status yet (T-025)
- [orchestration] T-233-b: the group order offers two choices, Staged first and Changes first (Untracked follows Changes), with conflicts pinned first in both since they block a commit; the GitHub API budget moved to T-233-c, since nothing reads the budget yet (T-176-c)
- [orchestration] T-227-b: Change Base Ref saves the project's pinned base (the same field Project settings edits), since the summary already measures against it, and blank goes back to the default branch; the conflict list draws the first 100 cards and counts the rest; a conflicted file reads resolved here once its clash markers are gone (changed or added on both sides only); the committed list sends at most 1000 files to the window while the count stays whole; the AI resolve button already existed (VIEW-069), so only the commit-message generation moved to T-227-c
- [orchestration] T-228-b: a fork head is a branch whose upstream is not on origin, since pull requests are created on origin with the branch name as head; the reason sits after the push check, so a branch never pushed still asks for a push first
- [orchestration] T-229-b: a printed link is stored where a hand link is (the `scmLinkedPrs` setting keyed by the pane's folder), written from Rust so hidden and parked panes count too; it replaces an earlier link for that folder; only `https://host/owner/repo/pull/N` links count, with anything after the number dropped; each link is reported once per terminal.
- [orchestration] T-230-b: the merge box reads its state in one GraphQL call only when it is opened and after each action, so the five-second refresh costs nothing more; the field names (autoMergeAllowed, isInMergeQueue, isMergeQueueEnabled, autoMergeRequest, statusCheckRollup) are from GitHub's public GraphQL schema and were proven against a stand-in only, so the first real use may need a field renamed; a base with a merge queue offers only Add to merge queue (gh merges with no method there); auto-merge is offered only while the pull request cannot merge yet; after a merge the box says to delete the workspace from its sidebar row rather than adding a second delete flow.
- [worktrees] T-013-c: a create started with Create more is never overtaken (the user asked for several); every other create still running is overtaken by any newer one, in any project, since only one can take the front; one that Git finished before the cancel reached it is kept but does not take the front.
- [worktrees] T-106-b: a pull request whose head branch also exists locally but lags behind the pull request is left alone and the workspace gets a new branch `<head>-pr-<N>` at the pull request's head (numbered when taken), tracking the remote branch; a fork's remote is named after the fork's owner (`-2` and on for a clash) at the same kind of address as origin (https or ssh); the workspace is named after the pull request's title unless a name is typed, and linked through the same `scmLinkedPrs` setting a hand link uses. A development build takes `KOLUX_RS_GH` as a stand-in gh for live proofs (a release build ignores it).
- [worktrees] T-107-b: the setup script is kolux.yaml's `scripts.setup` only (the per-repository page that also sets it is T-116-c; the prompt before a shared script runs is T-156); a create from the command line runs it unless `--setup skip` (`inherit` means run when there is one, `--run-hooks` counts as `--setup run`), always in a background tab; a `#!` line naming a POSIX shell runs it through that shell with its flags, bash and sh resolving to Git for Windows' own copy and never System32's WSL launcher; without one it goes through the configured shell when that is POSIX, else cmd, which refuses a script of more than one line or with %, ^ or " rather than misread it; the agent waits only in tab mode with Wait ticked, starts whatever setup's exit code is (or when setup cannot start), and lands as a tab beside it; when not waiting the Setup terminal opens in the background so the agent or shell keeps the focus.
- [worktrees] T-107-c: the project for a pasted pull request or issue is the one with any remote whose address (as written in git config, so a mirror rewritten by insteadOf still counts) is that host/owner/repo, case-insensitively; with none Kolux says so and makes nothing rather than guess. Only `/pull/N` and `/issues/N` addresses count, on any host; home pages and plain names stay plain creates. A work-item address preselects the create row; other text keeps the first match selected. An issue workspace's branch is named from the issue title and the link is the origin's `issue` number (so `issue:N` finds it). A workspace made from the palette also runs the setup script in a background tab.
- [worktrees] T-108-b: GSD has no worktree folder of its own (its executors run in Claude Code's isolation worktrees under `.claude/worktrees/`), so "made by GSD" is read from the `gsd-spawn-toplevel` file GSD writes into the worktree's own Git folder; that mark wins over the folder rules, so a GSD worktree is never counted as Claude Code's. GSD writes it on its first commit guard, so a GSD worktree shows as Claude Code's until then. The new source starts hidden like the others; profiles from before keep every GSD worktree hidden as it was (it counted as Claude Code's).
- [worktrees] T-109-b: name-field suggestions are GitHub's own search of the open issues and pull requests (up to 8 of each, issues first), asked 350 ms after typing stops and from 2 characters; when gh is missing or signed out the suggestions are simply absent rather than an error under every keystroke. The 256-character refusal is GitHub's documented search limit. A pasted link to a repository that is not the chosen project's is refused, not followed to another project (the worktree palette does that). No tracker other than GitHub exists yet, so "keep a tracker link bound to no repository" is the rule in `keepOnSwitch`, ready for the first tracker; the name typed stays when the project changes.
- [worktrees] T-109-c: the spec names no retry policy for a failed create, so: a create Git refuses because another Git process holds a lock (an `index.lock` or a ref `.lock`) is tried three times, 0.2 s then 0.8 s apart; any other failure (bad name, branch taken, disk) is final at once, since retrying it cannot help. Every failed try removes what it made (folder, worktree record, a branch it created) before the next one or the error. Cancel is the x on the "creating..." row in the sidebar (the composer closes on submit unless Create more is on); a cancel that arrives after Git finished keeps the workspace and says so rather than deleting work silently.
- [worktrees] T-111-c: palette ranking order is: a match on the row itself before one found only on its project, then the whole query equal to the row name, a whole word, the start of a word, inside a word or a one-letter typo (words of 5+ letters only); ties go to open tabs, then the folder shown most recently. With a query the sections follow their best row, so the best match is always on top. Filler words dropped: go, goto, open, jump, switch, to (kept when the query is only filler). A worktree linked to an issue or pull request shows its number (#34) so the number finds it. The spec has no way to scope the sidebar to one repository, so the chips start empty; the palette takes a starting scope for when that exists. Chip fields are Repository and Kind (the palette section). A name typed in the palette is now made at once (in the one chosen repository chip, else the project in front) instead of opening the composer; the composer is still the way to set a base, parent or agent. Worktree-only quick actions are Source control and Delete this workspace, shown greyed with "needs an open worktree".
- [worktrees] T-112: split in place. T-112-a is VIEW-112; T-112-b (VIEW-076, a folder workspace's Attached worktrees and PR checks) stays unticked because folder workspaces themselves (PROJ-005 / PROJ-086, T-218) and the right panel's folder tabs (T-146-b) are not built. VIEW-112 names no tools, so two with public formats are read: Conductor's conductor.json (scripts.setup, and scripts.archive as the teardown) and the Codex app's local environment, .codex/environments/environment.toml ([setup] script, [cleanup] script as the teardown; its PowerShell [setup.windows] script is not taken since Kolux runs setup through a POSIX shell or cmd). Limit 64 KB, checked before reading; not text, bad JSON or TOML, or a scripts value that is not a table is refused and named in a warning. Only what kolux.yaml lacks is offered. A several-line imported script without a #! line gets #!/bin/sh so Windows runs it through Git Bash. Import writes kolux.yaml in the project's main folder (setup and archive as block entries), and the dialog says it must be committed for new workspaces to run it, since setup is read from the new worktree's own kolux.yaml; a local-settings target can come with the rest of STAT-055. The offer appears once, right after the project is added; there is no later way to reopen it yet.
- [worktrees] T-114: the "Run the project setup in each new worktree" option is off by default and appears only for "A new worktree for every run" when the project's main folder has a kolux.yaml setup (or one that cannot be read, so the choice is not hidden by an error). An existing worktree never runs setup again, so the option is not stored for it. Automations saved before this have no runSetup and skip setup, as AUTO-010 asks. The choice rides on the per-run worktree's created event (setup run or skip), which the existing setup runner already honours.
- [worktrees] T-115-b: EDIT-047 builds on the T-098 palette. Added: a typed pull request or issue number puts the worktree linked to it first (ahead of a branch that merely contains the number), a pasted pull request or issue link searches by its number, an emoji shortcode (:rocket:) finds a worktree whose name has that emoji (the same shortcode list as naming), the comment a worktree was made with (`worktree create --comment`) is shown after its branch and found, and with an empty box the worktree used last leads its section. Already there from T-098: name matches first, repository and worktree words across both parts, every word must match, the 200-character limit. Not built: host and port numbers, because Kolux records no ports per worktree yet; they join when something detects a workspace's dev-server port. The CLI's "--comment: shown nowhere yet" warning is gone, since the palette now shows it.
- [worktrees] T-116-c: split in place. T-116-c-a makes the Settings repository page edit the base branch and the workspaces folder (the same project_set the sidebar's project form uses); T-116-c-b keeps the setup-script half of SET-033 (a Kolux-stored script, waiting, local / shared / both, which needs T-156's prompt before a shared script runs), the per-repository visibility override, the display name and the icon. Each field shows the inherited value in grey (the default branch; the global workspaces folder with its path) and saves on leaving the field or Enter only when its text changed, so opening the page or tabbing through writes nothing; Enter while an input method is still composing is left to it. No check that the typed base exists: the sidebar form does not check either, and a wrong ref fails at workspace creation with Git's message.
- [worktrees] T-117-b: split in place. T-117-b-a is `worktree set` with --display-name, --issue <number> or null, --comment and --parent-worktree <selector>|current or --no-parent; T-117-b-b (--workspace-status, the WSL path rule, the folder: parent form) stays unticked because the Board (T-025..T-030) and folder workspaces (T-218) are not built. Until then --workspace-status is refused before anything is written, with a message naming the Board, rather than stored where nothing reads it. The parent is checked first (same project, not the main checkout, no loop, the same rules as the sidebar's Move under), so a refused move writes nothing else from the call. --issue null also drops the stored issue address; an empty --comment clears the comment; an empty --display-name is refused rather than guessing what the default name should be. The command tells the window with a new `changed` event, which only redraws; the same listener now also stops treating the older `repo` event as a new worktree (it used to reach the setup-tab code with no worktree).
- [orchestration] T-233-c: the budget is github.com's (gh's default host); an Enterprise host's budget is left for when one is added; it is read when the page opens and on Check again rather than polled, since nothing else reads it yet; amber means under a tenth left.
- [orchestration] T-224-a: the Tasks button is the sidebar's Tasks row (DT-O3); the page reads the repository of the workspace on screen, else the first project, and lists the first 50 open issues and 50 open pull requests (the default preset, everything), newest first; rows open nothing yet (the preview is T-232-b, opening in the browser was not wanted live); development builds take a stand-in gh from KOLUX_DEV_GH, because the program search puts the registry's PATH (which finds the real gh) ahead of the process PATH
- [orchestration] T-231-b: the All open preset runs two GitHub searches (is:issue and is:pr) and merges them newest first, since GitHub search wants a type; typing is:issue or is:pr narrows it to one. Mine, Assigned, Review requested and Mentioned use GitHub's @me words. A PR's checks come from one GraphQL lookup per page, and a failed lookup leaves the pill off. The kept preset, search, page and scroll last for the app session, not across restarts. T-224-a's fixed 50+50 list is replaced by this search.
- [orchestration] T-232-b: the preview reads the item again every 15 seconds while it is open (no push from GitHub); the description shows as plain text, not rendered markdown, for now; the timeline is the item's first 100 events with subscriptions left out; Escape does not close the dialog while a description edit is open, so a draft is not lost by a stray key.
- [orchestration] T-176-c: the background poll asks each GitHub project for its 100 most recent pull requests in one call (all states) and matches branches locally; a branch whose PR is older than that shows none. Rounds are 3 minutes apart, doubling after failures up to 30 minutes, at most 60 workspaces a round; a focus re-check happens only when the last round is over a minute old.
- [orchestration] T-230-c: "the built-in browser can open new tabs" is read as "the project has a GitHub remote", since the built-in browser can always open a tab; whether the project is on GitHub is read when Source Control opens for a workspace, so a remote added while it is open shows the item after reopening it.
- [orchestration] T-227-c: commit messages are written by Claude Code only for now (`claude -p --model sonnet`, prompt on standard input, 3 minute limit), from `git diff --cached` trimmed to 24,000 characters; the generate control needs something staged (unstaged edits are not described). Development builds read KOLUX_DEV_WRITER as a stand-in writer for live proofs, like KOLUX_DEV_GH.
- [orchestration] T-228-c: the commit-message writer is a setting with three choices (Claude Code, a custom command, off); a custom command is split on spaces with double quotes grouping words and backslashes kept, takes the prompt in place of `{prompt}` (otherwise on standard input), and custom instructions are capped at 2,000 characters in their own part of the prompt.
- [orchestration] T-291-b: the hiding filter is a switch in the sidebar's Group and sort panel (setting `hideAutomationWorktrees`, off by default), and a workspace counts as made by an automation when Kolux's record of how it came to be says so (written when a new-worktree-per-run run makes it; workspaces made before this have no such record and always show).
- [orchestration] T-347: every window settings save now sends only the keys it changed (new `settings_patch` command, laid over what is on disk); the whole-settings `save_settings` command stays for other callers. Granularity is the top-level key, so a hand link or unlink sent in the same instant as a printed link still writes the whole `scmLinkedPrs` map and one of the two can be lost (marked ponytail in scm.rs). Id T-347 rather than the next free T-339, to stay clear of another lane adding its own new line at the same time.
- [orchestration] T-196: SKILL-029's "guides always match the installed Kolux version" is met by building the guides into the program, so no version stamp is written into them; SKILL-024, SKILL-026 and SKILL-028 are left for T-196-b because each installs or updates through the community skills installer from a Kolux skills repository that has not been published.
- [orchestration] T-085-b: the dialog offers only "When a pull request opens" until checks failed and agent finished can fire (T-085-c); saved automations with those events still load. The starting point is kept in memory, so after every start the first state seen is the starting point (AUTO-004's restart rule). A worktree an automation made never sets off a pull-request event either, stretching the card's no-self-trigger rule from panes to worktrees.
- [orchestration] T-089-b: a settled worker whose terminal is gone (closed by hand, ended by worker-stop, or from an earlier start of Kolux) lists as released, since nothing is left to clean up; release pending and release unknown stay empty until worker-release lands (T-089-c). Until then a reclaimable or kept worker's next command is `terminal close --terminal <handle>`. A kept worker stays kept after its process ends or Kolux restarts. worker-retain refuses a worker still working (code dispatch_active) and one whose terminal is gone (code terminal_gone); keeping twice reports already kept. The default page is 50 workers.
- [orchestration] T-029: a tab's palette mark is the tab strip's own badge, so a working agent reads working even with unread output, as the strip does; the card's order (permission beats unread beats done) is kept on worktree rows. The age is the time since the row last changed state (a tab's last hook change, a worktree's last status change), reads now under a minute, and is hidden when nothing has been seen yet. Shell tabs carry only the unread dot.
- [orchestration] T-030: a done report or heartbeat naming a dispatch from a terminal other than the worker's (or for a worker terminal of an earlier start) is now delivered as mail and settles nothing, as ORCH-015 asks; this replaces T-160's refusal (not_your_dispatch). A heartbeat or report after the dispatch has settled is still turned away (dispatch_finished), which leaves the worker's state unchanged. A report must name its dispatch (`--dispatch-id`, which the worker prompt always carries) to settle anything; without it, it is plain mail. The task's result is the report's body, or its subject when the body is empty. A report whose task has moved to another dispatch fails as outcome_unknown, never as success.
- [orchestration] T-031: Enter on a run does its first action (View run, Resume workspace or Saved output); a run that never got a workspace shows only its details, so Enter does nothing there, and Rerun is only ever its own button. Rerun is Run now of the same automation, so it adds a new numbered run rather than reusing the failed one. A run's terminal counts as live only while the pane started for that run is still open in the run's worktree; the link from run to pane is kept in the open window, so after a restart a run offers Resume workspace (T-031-b). The snapshot shows the output the run saved (today only a precheck's output) until terminal output is saved (T-134). The selected run stays selected when a new run arrives on top.
- [orchestration] T-032: Review plan is a small text button in the pane header, not an icon, so it reads at a glance. Request changes says no to Claude's ask and then pastes the feedback as one message (so its line breaks never send it early), then presses Enter. The sheet's comments are kept per pane and plan text while the window is open, so closing and reopening the sheet keeps them (part of SAFE-005); a restart drops them. A new plan from the same pane starts with no comments. Only Claude sends the plan; Codex panes never show the button.
- [orchestration] T-033: the panel still refreshes every 4 seconds; the git status watcher that should replace it is on T-033-b. A plain click on a row opens its diff in a preview tab; Ctrl and Shift clicks only select, so picking several rows never opens tabs. A preview tab with unsaved edits is never replaced. Untracked files count only text files under 1 MB, the first 2 000 of them, so a huge untracked folder cannot stall the panel. Review changes is a header button (the card says header menu) because the header has no menu yet; it uses the same agent picker and "start without asking" choice as Explain changes.
- [orchestration] T-034: notes attach to the new side's line numbers, so a split diff has the plus only on the right. They are kept per workspace in the settings key reviewNotes, not in the repository. Send goes to the focused agent pane of the workspace, else the first one, as one bracketed paste followed by Enter 300 ms later; with no agent running it says so and offers Copy instead. Ctrl+Shift+A is wired straight into the diff for now, not through the keybindings list (T-034-b). The proof used a stand-in agent that prints what it receives, not a real one.
- [orchestration] T-035: nothing is answered inside the Inbox yet, so every item that needs you says Answer in Code and sends you to the pane. A permission whose terminal has exited turns into Done in this build, so it shows Open in Code (T-035-b). Opening an item marks it seen through the existing rule that clears unread marks on a pane in view. The proof used a stand-in agent that posts a permission request to its own pane's hook endpoint, not a real agent.
- [orchestration] T-127: the Checks tab reads one gh pr view call with statusCheckRollup and mergeable, so check runs and older commit statuses both show; NEUTRAL counts as passed and SKIPPED or STALE as skipped. It follows the workspace open in the Code view (the focused terminal is always in it in this build). Polling is every 15 s and the no-pull-request answer is trusted for 60 s; both are guesses, the card names no numbers. The proof used a stand-in gh, not GitHub.
- [orchestration] T-129-b: worker-list was already complete under T-089-b, so it was ticked without new code. Attention flags were not added to worker-list on their own, because the card puts them on worker-show and worker-read, which are not built yet.
- [orchestration] T-131: the 16,000-character limit is counted on the whole status update as sent to the window (characters, not bytes), so a big sub-agent roster leaves less room for the plan. A draft that is written to again keeps its place in the 128; only a new draft pushes the oldest out. The read-only proof used a stand-in Stop hook, because a PostToolUse hook names no tool and so does not clear a pending plan yet (T-131-b).
- [orchestration] T-132: Copy Context writes the header as path:from-to on its own line followed by the plain text, with no code fence, and the path is relative to the pane's workspace (the full path when the file is outside it). The Send menu lists only the agents in the workspace in front, newest change first; an agent that exited after the menu opened gets the terminal's own error and the notes stay.
- [orchestration] T-119: one name serves both the tab and the pane header (the same title the CLI rename and seat titles set), so Clear Pane Title also clears a seat's title. A blank name returns to the automatic title, and Tab saves as Enter does. The strip switch sits on Settings > General, on by default, and counts only permission and question waits, not a blocked session. tab.rename still has no default key on Windows (Ctrl+R is the shell's history search); the shortcut paths were not live-proved, since binding them would mean editing the real keybindings file.
- [orchestration] T-289: Copy Terminal ID copies the handle the CLI takes (term-N), and Copy Pane ID the pane's number (KOLUX_PANE_KEY). The session id is the newest one any hook event of that pane has named, so after /clear it is the new session. Only a handle that names a terminal open right now becomes a link; a well-formed handle of a closed terminal stays plain text. The clipboard in the proof was a stand-in, so his real clipboard was never written.
- [orchestration] T-291-c: View run only turns the switch off when it actually moves you; if the run's worktree is already the front workspace, nothing changes. This task needs no tick of its own in Appearance: the Automations row's single automationsButton setting from main is untouched, and the View menu tick stays on T-248's line.
- [orchestration] T-292: the red "Update failed" item stays until the update card is dismissed (closing the card is the acknowledgement); collapsing the card keeps it. "Restart to update" in the bar only opens the card, never restarts by itself. The item is not in the status bar's right-click chooser, because it shows only while something is happening. The live proof used a throwaway local feed (a debug copy's test-feed variables) with a slow download and a wrong signature, so the ready state was proved by unit test only: a ready fake update would try to install on quit.
- [orchestration] T-131-b: the hook script already forwards Claude's whole event, and Claude's public hooks reference says PostToolUse carries tool_name; the gap was Kolux RS reading the tool from its own outgoing change (which leaves it off PostToolUse) instead of from the event. Proved with stand-in events in Claude's documented shape, not a real Claude; a real-agent check is still worth one look when an agent run is allowed.
- [orchestration] T-119-b: the tab menu also has Close tab, so it is not a one-item menu; Rename is left off editor, browser and diff tabs, which take their names from their files and pages. The automatic tab titles switch was not added on its own: generated titles do not exist yet (T-124, T-258), and a switch with nothing behind it would mislead, so T-119-c builds it with them.

- 2026-10-19 · [launch] FIX-2 · markFor follows the program for an agent whose Command is claude/codex (chat review item 3): an agent (any catalogue id except claude, claude-agent-teams, codex) whose program file is claude or codex (folder, case and .exe/.cmd/.bat/.ps1/.com ignored) is a Claude or Codex pane instead of a shell pane, so it gets the hooked state, the plan gauge, Claude's Shift+Enter and permission keys and the Claude hand-off; built-in ids and every other program are unchanged. Revert = one line: make programMark in src/launch/PlusMenu.tsx return "shell" (the callers' second argument is then ignored). (Wording corrected at MERGE 117: there is no saved agent with its own id; the route is Settings > Agents > Command.)

## Older passes (beyond the last 10)

- 2026-10-19 · [look] FIX-6 · done (council d2 look-7ce0c6c5 review): startFailed never wipes a drawn root; cancel markers in editor_search.rs bounded (256); a dropped stale answer clears the empty-query cancel; patches for main.tsx (loadApp catch), App.tsx (useMemo seats), fence.rs (device-spelling volume GUID) · evidence/look-FIX-6.txt
- 2026-10-13 · [accounts] T-043-e · done: keychain.rs rule table (before, pick, after_login, undo, current) over an injected Keychain, 7 tests on an invented keychain; T-043-f split (Mac: entry names, security-backed keychain, wiring, live proof); DT-C18 · evidence/T-043-e.txt (no live check: no Mac)
- 2026-10-13 · [accounts] T-140 · not started, left open: AUTO 014 saves a finished run's output and usage, but no run finishes yet: a dispatched run is not linked to its pane and never completes (T-072-b, which needs the hook status of T-025); build it after T-072-b
- 2026-10-13 · [accounts] T-210-b · not started, left open: the packs have no source of translations; DT-A5 ties them to SKILL-040's plugin runtime, which is cut; asked under Needs Txais (bundled machine-translated packs, the lookup only, or cut)
- 2026-10-13 · [accounts] T-209-b · done: plainWords.test.ts scans Wizard.tsx, StartGit.tsx and CodexAccounts.tsx (18 files); StartGit.tsx says Git project with GLOSSARY.repository.hover · evidence/T-209-b.txt, T-209-b-1-start-git-dialog-plain-words.png
- 2026-10-13 · [accounts] T-208-b · not started, left open: every part waits on unbuilt work: the grid tour on T-245 (tour overlay), Skip marking the checklist dismissed on T-333, the star prompt on T-322, the older wizards mapping on their version numbers (importer), open-as-chat on the native chat area; build it after T-245
- 2026-10-13 · [accounts] T-207-b · done: catalog.ts readyVendors, App.tsx kitAIs = readyVendors(switched-on agents); T-207-c split (milestone with T-298, grid tour with T-208-b) · evidence/T-207-b.txt, T-207-b-1-kits-with-codex-switched-off.png, T-207-b-2-kits-with-codex-switched-on.png
- 2026-10-13 · [accounts] T-206-b · done: run.ts SeatInfo.stop and limit/signin row states; KitStrip Move to on a limit row, Sign in on a sign-in row; App.tsx kitStop from the hook stop cause, Sign in opens Accounts & keys; T-206-c split (remote workspaces) · evidence/T-206-b.txt, T-206-b-1-kit-strip-with-the-new-build.png (rows with a real limit not shown live: routed to T-025-d)
- 2026-10-13 · [accounts] T-201-c · done: agents.rs install_page +30 checked addresses (Trae none, split T-201-d), AgentInfo.docs; ChooserPane DocsLink on featured and More-agents rows (DOC_PAGES list gone); PlusMenu.tsx AgentInfo.docs · evidence/T-201-c.txt, T-201-c-1-chooser-featured-docs.png, T-201-c-2-more-agents-unfolded.png
- 2026-10-13 · [accounts] T-138-c · done: src/settings/CodexAccounts.tsx (list, naming, remove, sign in again, Add Account) under Manage accounts (advanced); CodexCard.tsx list removed; SettingsPage.tsx renders it after ClaudeAccounts · evidence/T-138-c.txt, T-138-c-1-codex-accounts-under-manage-accounts.png, T-138-c-2-after-naming-and-switching.png
- 2026-10-13 · [accounts] T-136-d · done: activity::pr_created counted from scm.rs pr_create on the new-PR path only; lost connection to T-067, importer to T-075, tried-usage to T-244; live create refused by the installed gh (local remote), count stays 0 · evidence/T-136-d.txt, T-136-d-1-usage-after-a-refused-create.png
- 2026-10-13 · [accounts] T-153-e · not started, left open: Manage Sessions lists the sessions the background terminal host holds, which is T-067 TERM-105 (not built yet; terminal host work); build it after T-067
- 2026-10-13 · [accounts] T-153-d · not started, left open: delete, reveal and open act on rows of the Agents tab past-sessions list, which is T-146-b (not built yet); build it after T-146-b
- 2026-10-13 · [accounts] T-154-c · done: Explorer file operations, Source Control stage/discard and kit_check fenced; drops from outside copyable; picked-file grants survive a restart (kv file_grants) · evidence/T-154-c.txt, T-154-c-1-app-after-restart.png, T-154-c-2-explorer-in-the-project.png
- 2026-10-13 · [accounts] T-170-b · done: automation runs look up their worktree's token use with worktree show|current --usage; the scan memory survives restarts · evidence/T-170-b.txt, T-170-b-1-usage-after-restart.png
- 2026-10-13 · [orchestration] T-186-b · not built, left unticked: the parent flags on `worktree set` come with T-117-b's lineage edit on the worktrees lane (a second copy here would collide at merge; `projects::reparent` is already the shared backend), the Board shows panes rather than workspace cards so there is no card middle to drop on, and the active-folder fallback needs folder workspaces (T-218)
- 2026-10-13 · [orchestration] T-291-d · not built, left unticked: the Automation tag is a workspace card property, and the card details chooser it lives in (T-266) is still unticked in this checkout
- 2026-10-13 · [orchestration] T-289-b · not built, left unticked: the window still has no view of orchestration tasks (Tasks shows GitHub issues and pull requests only), so a printed task-N has nothing to open
- 2026-10-13 · [orchestration] T-119-b · done (first part: tab menu Rename and Close; T-119-c has the rest, its program-title part HAND TO FABLE: PTY shell integration) · evidence/T-119-b-1-right-clicking-a-tab-opens-its-menu.png, -2-rename-tab-opens-the-name-field.png, -3-the-tab-and-pane-take-the-new-name.png, -4-close-tab-from-the-menu-closes-that-tab.png
- 2026-10-13 · [orchestration] T-131-b · done · evidence/T-131-b-1-the-plan-waits-for-approval-and-the-sheet-is-open.png, -2-another-tool-finishing-leaves-the-plan-answerable.png, -3-the-plan-tool-finishing-in-the-terminal-makes-the-sheet-read-only.png
- 2026-10-13 · [orchestration] T-292 · done (first part: VIEW-100's app update item; T-292-b has SKILL-025, SKILL-027 and the skill half, waiting on T-196-b) · evidence/T-292-1-a-quiet-update-download-shows-its-percent-in-the-status-bar.png, -2-the-download-fails-so-the-card-says-why-and-the-status-bar-item-turns-red.png, -3-the-card-collapsed-and-the-red-item-stays.png, -4-clicking-the-red-item-opens-the-card-again.png, -5-a-dismissed-download-keeps-its-status-bar-item.png, -6-clicking-the-download-item-brings-the-card-back.png
- 2026-10-13 · [orchestration] T-291-c · done (first part: View run turns the hiding switch off, proof only; T-291-d has the Automation tag card property, after T-266) · evidence/T-291-c-1-the-switch-on-hides-the-run-worktree.png, -2-the-hidden-run-offers-view-run.png, -3-view-run-moves-to-the-run-and-turns-the-switch-off.png
- 2026-10-13 · [orchestration] T-289 · done (first part: TERM-036 copy ids, TERM-096 terminal handle links; T-289-b has task references) · evidence/T-289-1-before-the-session-is-known-the-menu-offers-terminal-and-pane-ids.png, -2-once-the-hook-names-the-session-copy-session-id-appears.png, -3-copy-session-id-puts-the-session-on-the-clipboard-and-says-so.png, -4-with-the-clipboard-refused-copy-terminal-id-says-it-failed.png, -5-a-printed-handle-of-an-open-terminal-is-a-link.png, -6-term-99-names-no-open-terminal-so-it-is-plain-text.png, -7-clicking-term-1-brings-terminal-1-to-the-front-with-the-keyboard.png
- 2026-10-13 · [orchestration] T-119 · done (first part: TERM-027 pane name, TERM-048 tab rename, TERM-029 needs-you strip; T-119-b has titles following the program, the floating button dot, the automatic titles switch and a tab menu) · evidence/T-119-1-the-pane-menu-offers-set-title-and-no-clear-before-a-name-exists.png, -2-a-korean-name-and-an-ime-enter-keep-the-field-open.png, -3-the-name-is-saved-and-clear-pane-title-now-appears.png, -4-double-click-renames-the-tab-and-the-text-stays-out-of-the-terminal.png, -5-escape-keeps-the-old-tab-name.png, -6-two-waiting-sessions-in-the-needs-you-strip-in-grid-order.png, -7-the-chip-jumped-to-reviewer-and-resolving-it-removes-it.png, -8-with-nothing-waiting-the-strip-takes-no-room.png
- 2026-10-13 · [orchestration] T-132 · done (first part: EDIT-007 Copy Context, EDIT-020 Send menu; T-132-b has the rich-markdown margin rail, starting a new agent from the menu, Copy Context in rich view and diff, Linux primary selection) · evidence/T-132-1-lines-10-to-14-selected-with-the-copy-context-hint.png, -2-copy-context-pressed-so-a-brief-confirmation-shows.png, -3-two-notes-and-the-send-menu-lists-the-worktree-agent-with-its-age.png, -4-sent-so-the-tray-empties-and-a-toast-names-the-agent.png, -5-the-agent-received-the-notes-ordered-by-source-line.png, -6-the-agent-exited-so-the-send-failed-and-the-note-is-kept.png
- 2026-10-13 · [orchestration] T-131 · done (first part: SAFE-005 drafts, SAFE-006 cut plan, SAFE-007 read-only sheet; T-131-b has the sheet closing on an approve typed in the terminal) · evidence/T-131-1-a-short-plan-opens-with-no-cut-notice.png, -2-comment-and-note-kept-after-close-and-reopen.png, -3-a-different-plan-arrives-so-the-open-sheet-goes-read-only.png, -4-the-40000-character-plan-opens-cut-with-the-terminal-pointer-and-an-empty-draft.png, -5-the-cut-plan-ends-part-way-through-step-156.png, -6-claude-moved-on-so-the-sheet-says-the-prompt-closed.png
- 2026-10-13 · [orchestration] T-129-b · done (first part, bookkeeping only: worker-list by terminal state was built and proved under T-089-b; cargo test orch026 passes again today. T-129-c has release states, attention flags, screen-text prompts (HAND TO FABLE: needs a scan of the terminal grid) and task-named rows) · evidence/T-089-b-1-worker-list-states-retain-limit.png, -2-paged-json-tied-scope.png, -3-next-page-foreign-cursor-refused.png
- 2026-10-13 · [orchestration] T-127 · done (first part: VIEW-073 the Checks tab; T-127-b has PR comments, unlinked PRs, session rows, live-pane lookup and session tab titles) · evidence/T-127-1-helper-shows-pr-12-its-conflict-and-four-checks-one-running.png, -2-polling-while-in-view-test-now-passed.png, -3-focus-a-terminal-in-lead-no-pull-request-no-review.png, -4-back-on-helper-lint-finished-without-an-outcome-is-unresolved.png
- 2026-10-13 · [orchestration] T-035 · done (first part: EDIT-041 Open in Code and Answer in Code jump to the pane, its tab and its sidebar row; T-035-b has Floor lanes, answering on the spot, exited permissions, folded projects and a real agent check) · evidence/T-035-1-a-permission-offers-answer-in-code.png, -2-before-the-user-is-in-lead.png, -3-enter-lands-on-helper-with-the-agent-tab-on-top.png, -4-a-running-agent-offers-open-in-code.png, -5-before-the-sidebar-is-at-the-top-helper-is-out-of-sight.png, -6-answer-in-code-scrolls-the-sidebar-to-helper.png
- 2026-10-13 · [orchestration] T-034 · done (first part: GIT-040 notes on the new side's lines in both layouts with edit and delete, GIT-041 the notes section, Send, Copy, Clear sent; T-034-b has the commands and keys, Git-less folders, the old side and a real agent check) · evidence/T-034-1-the-plus-on-line-12-opens-the-note-popover.png, -2-cards-sit-under-their-lines-inline.png, -3-still-under-line-12-side-by-side.png, -4-edit-a-note-in-place.png, -5-send-marks-every-note-sent.png, -6-a-note-edited-during-the-send-stays-unsent.png, -7-clear-sent-keeps-the-edited-note.png, -8-the-agent-got-one-paste-and-one-enter.png, -9-opening-a-note-from-the-list-lands-on-its-line.png, -10-the-bin-on-a-card-deletes-the-note.png
- 2026-10-13 · [orchestration] T-033 · done (first part: GIT-001 line counts and tree view with folder staging, GIT-037 rows open a reusable preview diff, GIT-038 All changes in the header, GIT-016 Review changes; T-033-b has the git status watcher, split choice, base snapshot and the review commit area) · evidence/T-033-1-each-change-shows-its-line-counts-binary-none.png, -2-tree-view-stages-a-whole-folder.png, -3-a-click-opens-a-preview-diff-the-next-click-reuses.png, -4-review-changes-names-the-base-and-the-files.png, -5-a-clean-branch-says-so-and-starts-no-agent.png, -6-all-changes-opens-from-the-header.png
- 2026-10-13 · [orchestration] T-032 · done (first part: SAFE-001..004 plan from the hooks, Review plan button, section sheet, Approve, Request changes; T-032-b has cancelling a pending send and a check against a real Claude) · evidence/T-032-1-plan-ask-offers-review-plan.png, -2-sheet-with-a-comment-kept-after-close.png, -3-request-changes-sends-one-message.png, -4-approve-answers-yes-and-a-bash-ask-has-no-review.png
- 2026-10-13 · [orchestration] T-031 · done (first part: AUTO-013 run list keys, View run, Resume workspace, snapshot, Rerun, Try again; T-031-b has saved terminal output for snapshots and View run after a restart) · evidence/T-031-1-numbered-runs-with-their-actions.png, -2-gone-worktree-opens-its-snapshot.png, -3-unread-history-offers-try-again.png, -4-view-run-opens-its-live-terminal.png
- 2026-10-13 · [orchestration] T-030 · done (first part: ORCH-015 done reports and heartbeats; T-030-b has the mail pointer, worker-show and worker-read, HAND TO FABLE for the pointer: needs hook idle state from a real agent) · evidence/T-030-1-report-for-the-worker-is-mail-only.png, -2-own-done-report-completes-task.png, -3-done-report-shows-outcome-and-files.png
- 2026-10-13 · [orchestration] T-029 · done (first part: palette marks and ages; T-029-b has the monitoring mark, waiting on T-123) · evidence/T-029-1-palette-marks-working-unread-permission.png, -2-ages-after-minutes.png
- 2026-10-13 · [orchestration] T-089-b · done (first part: worker-list and worker-retain; T-089-c has show, read, release and ask's exit 75) · evidence/T-089-b-1-worker-list-states-retain-limit.png, -2-paged-json-tied-scope.png, -3-next-page-foreign-cursor-refused.png, -4-retained-after-restart.png
- 2026-10-13 · [worktrees] T-117-b-a · done: `kolux-dev worktree set` renames a worktree, links or unlinks its issue (--issue null), sets or clears its comment, and moves it under another worktree, under the current one, or back to the top; contradicting or empty parent flags, a bad --issue, no change asked for, and --workspace-status are refused before any lookup; the sidebar and the Ctrl+J palette update while the app runs; `set_worktree`, SET flags and text in cli.rs, `worktree show` gains number and comment, `changed` event kind in model.ts and App.tsx (cargo red first). T-117-b-b split off: needs the Board (T-025..T-030) and folder workspaces (T-218) · evidence/T-117-b-a.txt, T-117-b-a-before.png, T-117-b-a-set.png, T-117-b-a-linked.png, T-117-b-a-unlinked.png
- 2026-10-13 · [worktrees] T-116-c-a · done: Settings > a repository now edits where its new workspaces start from (base branch) and its workspaces folder, each showing the inherited value until overridden; saving only on a real change; RepoPage.tsx (draftSave, RepoView), wired in SettingsPage.tsx (vitest red first). T-116-c-b split off: the setup-script half (needs T-156), visibility override, name and icon · evidence/T-116-c-a.txt, T-116-c-a-inherited.png, T-116-c-a-develop.png
- 2026-10-13 · [worktrees] T-116-b · skipped, not started: every part left waits on unbuilt work. Renaming branches after the work done on them needs the agent status hooks (T-027, T-029, T-030 still open); the source control view's list and group order needs T-033's tree view (open); the AI help for commit messages and other source control actions needs the AI source-control actions, not built. Updating the local base branch before a worktree is made is already on the Settings Git page (refreshBaseFirst, GitPage.tsx), so nothing of it is left here.
- 2026-10-13 · [worktrees] T-115-b · done: the Mod+J worktree palette finds a worktree by its pull request or issue number (linked one first) or link, by an emoji shortcode, and by the comment it was made with; an empty box lists the worktree used last first; queryWords and paletteRows in nav.ts / WorktreePalette.tsx, Worktree.comment from the origin in projects.rs (vitest and cargo red first); host and port matching not built (no ports recorded yet) · evidence/T-115-b.txt, T-115-b-number.png, T-115-b-link.png, T-115-b-shortcode.png, T-115-b-comment.png, T-115-b-two-words.png, T-115-b-too-long.png, T-115-b-recent.png
- 2026-10-13 · [worktrees] T-114 · done: an automation that makes a new worktree for every run can choose to run the project setup in each one; the option shows only when the project has a setup, saved automations keep the choice (runSetup), old ones skip; `created_event` in automations.rs, `setupChoice` in AutomationDialog.tsx (cargo and vitest red first) · evidence/T-114.txt, T-114-setup-shown.png, T-114-nosetup.png, T-114-existing.png, T-114-ticked.png, T-114-saved.png
- 2026-10-13 · [worktrees] T-113-b · skipped, not started: its PLAN line says it is built with the workspace cleanup dialog on T-162 (PROJ-080), which does not exist yet; build it with or after T-162
- 2026-10-13 · [worktrees] T-112-a · done: adding a project that carries conductor.json or the Codex app's .codex/environments/environment.toml offers its setup and teardown commands in an Import setup commands dialog; Import writes them into kolux.yaml as scripts.setup and scripts.archive; a file over 64 KB or malformed is refused before parsing and named in a warning, nothing offered; `setup_imports`, `import_into`, `scripts_entry`, commands `setup_imports_list` / `setup_import` in setup.rs, ImportSetup.tsx (cargo and vitest red first). T-112-b (VIEW-076) split off: needs folder workspaces (T-218) and the folder tabs (T-146-b) · evidence/T-112-a.txt, T-112-a-offered.png, T-112-a-imported.png, T-112-a-malformed.png, T-112-a-oversized.png
- 2026-10-13 · [worktrees] T-111-c · done: the palette ranks matches (own fields before project-only, exact name, whole word, word start, inside or a forgiven typo; ties to open tabs then the folder used last), drops filler words, folds accents, full-width and CJK text, matches numbers exactly with or without #, lets a single Latin letter match only a word start; filter chips for Repository (options sorted by workspace count, hidden ones not counted) and Kind, values of one field any-of and fields all-of; Enter on the create row makes the workspace at once and opens it; Source control and Delete this workspace are greyed and not runnable with no worktree open; `fold`, `queryWords`, `scoreText` in nav.ts, `withRepos`, `chipFilter`, `repoOptions`, ranked `paletteRows` in WorktreePalette.tsx, `item_number` and `Worktree.number` in Rust (vitest red first, cargo) · evidence/T-111-c.txt, T-111-c-off.png, T-111-c-recent.png, T-111-c-number.png, T-111-c-chips.png, T-111-c-create-row.png, T-111-c-created.png
- 2026-10-13 · [worktrees] T-110 · HAND TO FABLE: STAT-039 is the status side of PROJ-039 (T-107-d, already handed to Fable): the rename starts on the first UserPromptSubmit from the hook stream and must move the worktree folder while the agent inside it holds it as its working folder, which Windows refuses, so it waits on the same design call; STAT-055 alone is buildable (setup already runs on create through PROJ-033; missing: the kolux.yaml archive script on remove with KOLUX_ROOT_PATH / KOLUX_WORKTREE_PATH / KOLUX_WORKSPACE_NAME, and the local-settings-first vs shared-first source policy), but the task stays whole and unticked · nothing changed in code
- 2026-10-13 · [worktrees] T-109-c · done: a workspace create that Git finds locked by another Git process is retried (3 tries, 0.2 s / 0.8 s apart) and any other failure is final, every failed try leaving no folder, worktree record or new branch behind; the "creating..." row in the sidebar has a cancel x that shows "stopping..." and ends in "Stopped creating X; nothing was left behind." (a cancel after Git finished keeps the workspace and says so); `CREATE_WAITS_MS`, `lock_held`, `clear_failed_add`, `add_retrying` in projects.rs used by new-branch, existing-branch and pull-request creates, `stoppedNote` in model.ts (cargo + vitest, red first) · evidence/T-109-c.txt, T-109-c-trying.png, T-109-c-failed.png, T-109-c-retried.png, T-109-c-stopped.png
- 2026-10-13 · [worktrees] T-109-b · done: the composer's name field suggests the open issues and pull requests of the chosen project's own repository (gh issue/pr list --search, at most 8 each), a pasted issue or pull request link to that repository resolves and seeds the name (a link to another repository is refused with why), the workspace is linked to the item (`issue:` selector finds it; a pull request opens through the PROJ-030 checkout), a lookup over 256 characters is refused before gh is asked, Create more and closing drop the link, switching project drops a GitHub item and would keep a link bound to no repository; `Linkable`, `find`, `lookup_refused`, `parse_found` in pr_checkout.rs, `workspace_items` / `workspace_item` and the `issue` argument of `workspace_create` in projects.rs, `Linked`, `bound`, `itemLabel`, `keepOnSwitch` in model.ts (cargo + vitest, red first) · evidence/T-109-b.txt, T-109-b-suggest.png, T-109-b-more.png, T-109-b-link.png, T-109-b-switch.png, T-109-b-long.png
- 2026-10-13 · [worktrees] T-108-b · done: worktrees GSD made are their own visibility source, "Made by GSD", with its global and per-project show/hide choice beside Claude Code's, elsewhere on disk and the extra folders; a worktree counts as GSD's when its own Git folder holds the `gsd-spawn-toplevel` file GSD's executors write (GSD's public reference worktree-path-safety.md), wherever it sits · evidence/T-108-b.txt, T-108-b-sources.png, T-108-b-shown.png, T-108-b-list.png
- 2026-10-13 · [worktrees] T-107-d · HAND TO FABLE: PROJ-039 starts from the first UserPromptSubmit on the hook stream, needs the configured agent run headless to propose the branch name, and on Windows the workspace folder cannot be renamed while the agent's own process has it as its working folder (the rename fails for every live agent), so it needs a design call (rename before the terminal starts when a launch carries its prompt, or rename the branch now and move the folder once no terminal is inside it); creature names (creatures.rs, `create_fresh`) are the only names Kolux suggests today and carry no origin mark yet; nothing changed in code · no evidence
- 2026-10-13 · [worktrees] T-107-c · done: a GitHub pull request or issue address pasted into the worktree palette preselects Create workspace from it; Enter makes the workspace in the project with that repository as a remote, named after the title and linked (pull request checked out at its head through T-106-b, issue as a new branch with `issue` in its origin), then runs the setup script; a repository home page stays a plain create; `worktree create --issue <n>` without `--name` takes the issue's title · evidence/T-107-c.txt, T-107-c-homepage.png, T-107-c-palette.png, T-107-c-pr.png, T-107-c-issue-palette.png, T-107-c-issue.png, T-107-c-cli.png
- 2026-10-13 · [worktrees] T-107-b · done: a workspace's setup script (kolux.yaml `scripts.setup`) runs in a Setup terminal when the workspace is made; the composer's Advanced part has the setup policy (run / skip), where it opens (new tab, split right, split below) and Wait for setup, which starts the agent only after setup ends; `kolux-dev worktree create` runs it in a background tab unless `--setup skip`. New `setup.rs` (3 cargo tests, red first: the kolux.yaml reader, the shebang shell with its flags, cmd's refusals), `waitsForSetup` in model.ts (1 vitest), the CLI test now expects no setup warnings. Live: sh setup in a tab with Claude Code waiting then starting beside it, a split-right setup, CLI skip vs run. Evidence: evidence/T-107-b*.png, evidence/T-107-b.txt
- 2026-10-13 · [worktrees] T-106-b · done: Advanced > Open a pull request lists the project's open pull requests through gh, picks one and checks it out as a workspace at its head (a lagging local branch is left alone, a fork gets its own remote), named after the title and linked to it; also fixed notify.test.ts, which only passed on 2026-10-12; cargo test 314, pnpm test 502 · evidence/T-106-b-picker.png, evidence/T-106-b-picked.png, evidence/T-106-b.png, evidence/T-106-b-linked.png, evidence/T-106-b.txt
- 2026-10-12 · [accounts] T-171-b · done: Check again detects without connecting; account cards refresh on focus; Codex settings copied into each managed home with warnings and trust kept; renewed sign-ins saved on quit with a time limit · evidence/T-171-b.txt, T-171-b-1-accounts-page.png
- 2026-10-12 · [accounts] T-339 · done: CloseAsk folded into chrome/Ask (OK-only when confirm is null); duplicate notification switches removed; claudeFigures / publishClaude in launchWarn.ts fed by ClaudePill; TopBar onSettings dropped; titleBarButton and the Title bar card removed, automationsButton drives the title-bar button; reset summary explains each scope; test_dir.rs guard for the account and usage tests; T-138-c split for the Codex list move · evidence/T-339.txt, T-339-1-one-automations-switch.png, T-339-2-switch-off-no-button.png, T-339-3-notification-switches-once.png
- 2026-10-12 · [accounts] T-137-b, T-139-c · not built: no public xAI source for Grok credit figures or the Grok session file (checked docs.x.ai); left unticked
- 2026-10-12 · [accounts] T-136-c · done (part): activity.rs (turns, working stretches, batched and quit saves), status.rs and terminal.rs feed it, src/usage/Activity.tsx headline cards and invitation · evidence/T-136-c.txt, T-136-c-1-first-run-invitation.png, T-136-c-2-two-turns-after-reload.png, T-136-c-3-counts-intact-after-quit.png
- 2026-10-12 · [accounts] T-170 · done (part): token_usage claude_file/codex_file/merge, per-file Cache, codex_roots, format mark; workspaces trim resolves . and .. · evidence/T-170.txt, T-170-1-fork-counted-once.png, T-170-2-original-gone-total-kept.png
- 2026-10-12 · [accounts] T-171 · done (part): ConnectGrid liveCheck (5 s while visible, on focus, changes broadcast); claude_key::strip_inherited, claude_accounts::sign_in_overrides, codex_accounts::ready_home wired in terminal_spawn · evidence/T-171.txt, T-171-1-grok-not-installed.png, T-171-2-grok-found-without-reload.png
- 2026-10-12 · [accounts] T-154-b · done: `src-tauri/src/fence.rs` (projects, worktrees and exact grants; shares, drive roots and links refused); file commands fenced; Open a file uses file_pick · evidence/T-154-b.txt, T-154-b-1-picker.png
- 2026-10-12 · [accounts] T-153-c · skipped this batch, left open: VIEW-054 is built or marked SKIPPED only after Txais clicks through the installed app (DT-37), which the clean-room rule bars the builder from
- 2026-10-12 · [accounts] T-153-b · done: `src/status/resources.ts` endNeedsAsk; Resource Manager End reads again before asking · evidence/T-153-b.txt, T-153-b-*.png
- 2026-10-12 · [accounts] T-201-b · done: kit row, Advanced fold, kit roles and Set up kit in `src/launch/ChooserPane.tsx`; `seatGap` in seats.ts; `openKits(kit, chooser)` opens one kit's setup and App closes the chooser once it starts; Grok docs link · evidence/T-201-b.txt, T-201-b-*.png
- 2026-10-12 · [accounts] T-208 · done: leave question (Escape, click outside, corner close) through Ask's new cancel words and safe confirm; firstRun.ts closer latch with retry, leaveKey, firstFolderAgent; onboarding.rs raises older records and keeps unknown fields; ProjectsPanel onAdded starts the default agent once · evidence/T-208.txt, T-208-*.png
- 2026-10-12 · [accounts] T-207 · done: `onboarding.rs` record and onboarding_get / _step / _close; `src/onboarding/` Wizard (four screens) and firstRun.ts rules; Connect cards report connected; KitCard split out of the gallery; Add project opens on a window event · evidence/T-207.txt, T-207-*.png
- 2026-10-12 · [accounts] T-206 · done: `kits.rs` kit_collect / kit_history / kit_open_file, the project-or-samples guard on every kit command, the per-folder and app-wide run history; strip Preview / Open / Collect results / Move to / Restart; Recent kit runs in the gallery; read-only editor and start-URL browser panes for previews · evidence/T-206.txt, T-206-*.png
- 2026-10-12 · [core] T-066 · done: session id from the hooks saved on the pane and restored as the agent's own resume command on its standing start line; live with a stand-in agent through the real hook path, quit twice and a hard kill · evidence/T-066-resumed.txt, .png
- 2026-10-12 · [core] T-065 · done: tabs and layout saved to `savedLayout` as they change and read back at start, damaged entries dropped one by one, gone folders dropped, active workspace and tab kept; live: one entry damaged by hand, relaunch, the rest back and workspace B active · evidence/T-065-restored.txt, .png
- 2026-10-12 · [core] T-064-b · done: Privacy section with the whole outbound list and Send feedback as a browser link, source audit test; live: no connection from the app while markers were typed, only WebView2's own startup rows; evidence/T-064-b-privacy.txt + .png
- 2026-10-12 · [core] T-064-a · done: diag.rs capped rotating user-only log, idempotent scrub, bundle, review copy, Settings > General > Diagnostics; live with a planted key masked on the clipboard; evidence/T-064-a-diagnostics.txt + .png
- 2026-10-12 · [core] T-063 · done: hooks endpoint and CLI port answer only Kolux's own tools (web headers, foreign Host, no token: 404 empty; HTTP line dropped; loopback only), live with curl, raw sockets, the LAN address and the app's page; evidence/T-063-endpoint.txt
- 2026-10-12 · [core] T-062-a · done: every file command fenced to the projects (no `..`, no link out, exact grants only), "Open this file anyway" in the editor, Windows removal retry, live through the WebView port; evidence/T-062-a-fence.txt, evidence/T-062-a-fence.png
- 2026-10-12 · [core] T-061 · done: discard asks first (Delete / Restore / Discard, counts, scrolling list, no undo), new files removed, tracked files put back, links never followed, live through the WebView port; evidence/T-061-discard.txt, evidence/T-061-discard-ask.png
- 2026-10-12 · [core] T-060 · done: host paths refused as text before any disk call (file_read, file_write, dir_list, path_kind), open_path reveals programs and opens documents, live through the WebView port; evidence/T-060-host-paths-reveal.txt
- 2026-10-12 · [core] T-059-a · done: recursive-delete rule and chain/wrapper/substitution/nested-shell/encoded reading for every protected rule, live through the installed script from a pane; Safety page and masking are T-059-b; evidence/T-059-a-delete-wrapped.txt
- 2026-10-12 · [core] T-058 · done: six built-in protected rules, the Claude hook prints the PreToolUse ask, settings switches read per command, live through the installed script from a pane; the signed-in Claude proof is T-058-b; evidence/T-058-protected.txt
- 2026-10-12 · [core] T-174-a · done: loopback channel proof (run-current 17-30 ms, ask kept alive over four minutes), panes point the data-folder override at their own app, worktree removal kills each shell's process tree, proves the pids gone and refuses as `stuck` unless forced; evidence/T-174-a-channel.txt
- 2026-10-12 · [core] T-102-a · done: tab right-click menu with Close / Close others / to the right / to the left / Close all (disabled when empty), middle-click close, Ctrl+Alt+W, one close question per set, focus returns to the tab used before; evidence/T-102-a-tabs.txt, T-102-a-menu.png
- 2026-10-12 · [core] T-144-a · done: draggable grid dividers (pointer capture, 120 px minimum, final size to the program once, release outside the window keeps the last position) and header items dropping at 344 / 264 / 204 / 134 px; evidence/T-144-a-dividers.txt, T-144-a-130px.png, T-144-a-250px.png
- 2026-10-12 · [core] T-040-b · done: context ring on rail rows with a reading, rail footer with the picked session's 5-hour figure (used or left by the usageReads key) and local reset time, plan figures in the pane header on Agents; evidence/T-040-b-rail.png, T-040-b-left.png, T-040-b-sessions.txt
- 2026-10-12 · [core] T-028-b · done: status word on every Agents rail row from the Board chip's signal and the status vocabulary; preset reads Not started; a killed process leaves Working for Stopped in 1.5 s; cannot-reach waits for remote hosts (DT-C21); evidence/T-028-b-words.png, T-028-b-stopped.png, T-028-b-sessions.txt
- 2026-10-12 · [core] T-050 · done: Agents rail grouped by saved agent with Other sessions, remembered pick, + presets, empty state, terminal or chooser body; Board cards in tab order without editor or browser tabs, named by the saved agent; chat body split to T-050-b; evidence/T-050-rail.png, T-050-other.png, T-050-board.png, T-050-sessions.txt
- 2026-10-12 · [core] T-145-b · done: pane replies to colour/light-dark questions reach the program as win32-input-mode key events; early output matched by pane key; OSC 10/11 questions measured as swallowed by the console (DT-C20, T-145-c); evidence/T-145-b-console.txt, T-145-b-answers.png, T-145-b-startup.png
- 2026-10-12 · [core] T-139-b · done: per-pane Codex account, restart keeps it or refuses when stale, account-change keep/restart prompt and removed-account prompt on running Codex panes only; DT-C19; evidence/T-139-b-accounts.txt, T-139-b-prompt.png, T-139-b-restarted.png, T-139-b-removed.png
- 2026-10-12 · [core] T-134-a · done: terminal read (log, cursor paging, --screen via xterm rows), send (paste, Enter, interrupt, prompt receipt, retry), wait (exit, tui-idle, blocked states, quiet fallback); T-134-b split off for the agent hooks commands; DT-C18; evidence/T-134-a-cli.txt, T-134-a-claude.png, T-134-a-app.png
- 2026-10-12 · [core] T-018-c · done: Source Control bulk bar, click/Ctrl/Shift selection, Esc clears, Stage k and Unstage m in one git call; evidence/T-018-c-bulk.png
- 2026-10-12 · [core] T-017-c · done, decision only: Cursor and Copilot pre-trust dropped (DT-C17), no documented trust file or interactive flag
- 2026-10-12 · [core] T-043-d · done: sign-in upkeep switch, lapsed warnings follow it, check on switch-off; Kolux-side renewal dropped (DT-C16); keychain rules → T-043-e; evidence/T-043-d-upkeep.png
- 2026-10-12 · [core] T-042-b · done, decision only: usage service and hidden /status screen dropped (DT-C15); background app-server read is the only Codex figures route
- 2026-10-12 · [core] T-041-b · done: resume after a limit (resume.rs, timer, foreground check, cancel on typing, persisted waits); evidence/T-041-b-resume.png
- 2026-10-12 · [core] T-041-a · done: 200k cap (env for Claude, -c overrides for Codex, Settings > Agents switch), weekly-only read-only pill with tint and countdown, config-folder guard and one-window merge on status-line reports; DT-C14 drops the usage service; evidence/T-041-a-cap.png
- 2026-10-12 · [core] T-040-a · done: Board card meter (context bar in tokens + plan %), tab ring, header gauge colours, USAGE-005 maths against the 200k cap; Agents view parts split to T-040-b; evidence/T-040-a-meter.png
- 2026-10-12 · [core] T-039-b · done: statusLine slot taken with a chaining bash command, /claude-status route → kv claudeRateLimits + claudeUsageLimitResetsAt, pill 'Claude N% left', header gauge, limit stop carries the reset; evidence/T-039-b-usage.png
- 2026-10-12 · [core] T-039-a · done: StopFailure → stop cause limit/signin/error kept while blocked, chip + header tooltip say it, 'Agent Stopped' switch, sign-in stop re-checks the account; Kimi/Codex no cause DT-C13; evidence/T-039-a-stopped.png
- 2026-10-12 · [core] T-014-b-fix · done: prompt without --agent falls back to the default or first installed agent, `warnings` list + stderr for inert flags, `issue:` selector; `identity:`/`active` refused by DT-C12; cargo test 116
- 2026-10-12 · [accounts] T-140 · not built, left unticked · WAITS ON T-072: reading the agents' logs is now allowed (Needs Txais, token analytics, RESOLVED 2026-10-12) and the token and cost figures it needs exist since T-136-b / T-137-a, but AUTO-014 saves a run's output when the run ends, and runs still only reach "dispatched" until T-072 (AUTO-012, truthful end status) is built, which is open on main too. Build after T-072.
- 2026-10-12 · [accounts] T-137-a · done (T-137 split: -b is USAGE-018's Grok credits panel, waiting on a Grok usage source): `src/usage/pricing.ts` (dated price table for Claude and OpenAI models, family / alias / variant matching, 5-minute and 1-hour cache writes, long-context bands), `tokens.ts` (range, Kolux scope, day bars, by model, recent sessions), the Claude / Codex panels in `TokenAnalytics.tsx`, a 272k prompt band in `token_usage.rs`; 8 pricing + 6 panel tests; live with invented stand-in logs: 30 then 7 days, Kolux scope then every local use, Codex outside-only shows no data, unknown model n/a and partial, inferred Codex price, overview cost; build / clippy / 199 Rust + 357 front-end tests / cargo-deny / tsc / licence check / plan-check green; no orphan process · evidence/T-137-a.txt, T-137-a-1..7 png
- 2026-10-12 · [accounts] T-136-b · done (T-136 split again: -c is USAGE-011's activity counts, waiting on T-025): new `src-tauri/src/token_usage.rs` (Claude / Codex log scan into local-day buckets, saved results, single-flight `Flights`, `token_usage` / `token_usage_scan` / `token_tracking_set`, 6 tests) and `src/usage/tokens.ts`, `pricing.ts` (empty until T-137-a), `TokenAnalytics.tsx`, `tokens.test.ts` (7 tests); Settings › Usage draws it; live with invented stand-in logs: off state, Enable Claude, Codex panel off then on, combined overview, broken folder keeps the figures, restart shows saved figures, both off shows the two enable buttons; build / clippy / 199 Rust + 343 front-end tests / cargo-deny / tsc / licence check / plan-check green; no orphan process · evidence/T-136-b.txt, T-136-b-1..7 png
- 2026-10-12 · [accounts] T-211 · done: new `src-tauri/src/tools.rs` (time-limited probes of git, gh, gh auth status and glab, cached until Check again; GitHub/GitLab-hosted projects read fresh; dismissals in kv), `src/launch/toolChecks.ts` and `ToolNotices.tsx` on the main screen; the app starts without Git · evidence/T-211.txt, T-211-1..4 png
- 2026-10-12 · [accounts] T-210-a · done: new `src/language.ts` (choices, System resolution, locale, apply on load) and `src/language.test.ts`; Language select in Appearance; every date, time and sort call reads `locale()` · evidence/T-210-a.txt, T-210-a-1..2 png
- 2026-10-12 · [accounts] T-209-a · done: new `src/glossary.ts` (banned words, plain words with hover text, the Connect cards' lines) and `src/plainWords.test.ts` (TypeScript syntax scan of 13 in-scope files plus a hover check); Add Project, sidebar and toast wording changed · evidence/T-209-a.txt, T-209-a-1..2 png
- 2026-10-12 · [accounts] T-208 · not built, left unticked · WAITS ON MERGE: ONB-006/007/008/010/012 are the leaving, progress, first-profile and grid-tour rules of the wizard T-207 builds, so it follows T-207 (which waits on the kit code from lane/release).
- 2026-10-12 · [accounts] T-207 · not built, left unticked · WAITS ON MERGE: ONB-004 and ONB-005 are the sample-data and kit screens of the wizard, and ONB-001 hides the wizard behind the kit setup dialog; the kit code (T-204, T-205) is on main from lane/release but not in lane/accounts, and a wizard with two missing screens should not reach new profiles. Build with the kits (lane/release), or here once main reaches this lane.
- 2026-10-12 · [accounts] T-206 · not built, left unticked · WAITS ON MERGE: SKILL-011..015 rescue, preview, collect and record runs of starter kits, and the kit code they act on (T-204 gallery and setup, T-205 kit runs and the results strip) is on main from lane/release (c03bab6, 55a1abf) but not in lane/accounts; building it here would mean a second copy of the kit system. Build in lane/release, or here once main reaches this lane.
- 2026-10-12 · [accounts] T-201-a · done: `seatAgents` in `src/launch/ChooserPane.tsx` orders featured, missing and folded agents per seat; App passes every offered agent plus whether detection is still running · evidence/T-201-a.txt, T-201-a-1..3 png
- 2026-10-12 · [accounts] T-200 · done: new `src/projects/AddProject.tsx` (`nextChoice`, `AddProjectView`, focus kept inside the dialog on every step), opened from the sidebar folder button and the composer's Add project item; `scripts/evidence/cdp.mjs` learns the arrow keys · evidence/T-200.txt, T-200-1..3 png
- 2026-10-12 · [accounts] T-157 · done: `secrets.rs` seals four fields (`httpProxy` and `browserSearchSessionUrl` added for T-240/T-323), a save while the store is down fails with "the system secret store is not answering; nothing was saved", `drop_unreadable` probes the store first so an outage never clears a key, `clear_setting` needs no store, `KOLUX_RS_SECRET_STORE_DOWN` stands in for an outage in development builds only · evidence/T-157.txt, T-157-1..2 png
- 2026-10-12 · [accounts] T-156 · not built, left unticked · HAND TO FABLE: SAFE-016/017/018/020 sit on the protected-action hook that T-058/T-059 build (the PreToolUse hook program, the listener, the rule engine and the Safety page section do not exist yet, and hooks are a Fable theme); SAFE-025 / STAT-056 need the shared setup, archive and issue scripts to run first (T-107-b, T-107-c). Build after T-058, T-059 and T-107-b.
- 2026-10-12 · [accounts] T-154-a · done: `secrets.rs` `drop_unreadable` (run at start before the window), `dropped`/`dismiss_dropped` + `secrets_dropped`/`secrets_dropped_dismiss`, `mask` applied to every log line, a masked log line when the Claude key connects; new `src/settings/KeyLostNotice.tsx` in the main window; T-154 split into -a/-b · evidence/T-154-a.txt, T-154-a-1..3 png
- 2026-10-12 · [accounts] T-153-a · done: new `src/chrome/Ask.tsx` (one confirmation dialog, `askKey`), replaces `src/terminal/CloseAsk.tsx` and the automation delete strip; `scm.rs` `discard` + `scm_discard` (staged back to HEAD, changes back to the index, untracked via git clean), Source Control discard buttons and `discardAsk` wording; T-153 split into -a/-b/-c · evidence/T-153-a.txt, T-153-a-1..6 png
- 2026-10-12 · [accounts] T-146-a · done: new `src/chrome/RightSidebar.tsx` (frame, tab strip, drag edge, `readRight`, `clampWidth`), `App.tsx` keeps open/tab/width in settings (rightSidebarOpen/Tab/Width) and routes Ctrl+L, Ctrl+Shift+E/G and the top-bar button through it; fixed the Explorer and sidebar not hiding (their display:flex beat the hidden attribute); T-146 split into -a/-b/-c · evidence/T-146-a.txt, T-146-a-1-explorer-tab.png, T-146-a-2-scm-640.png, T-146-a-3-after-restart-explorer.png
- 2026-10-12 · [accounts] T-138-b · done: `codex_accounts.rs` Account gains `label`, `set_label` (trim, 40 chars, blank clears, kept on re-sign-in) and the `codex_account_label` command; `CodexCard.tsx` Name/Rename with an inline field (Enter saves, Esc keeps), "Same email as another account" note, headline names the active account; `AccountRow.tsx` gains `onName`/`below`; 1 Rust test, 3 front-end tests; live with two seeded Codex accounts on one email · evidence/T-138-b.txt, evidence/T-138-b-1-same-email.png, evidence/T-138-b-2-named.png
- 2026-10-12 · [accounts] T-116-a-fix · done: `src/settings/GitPage.tsx` gains the New branches card (prefix select, custom field saved on blur, sample and refused/only-slashes warning from `branch_prefix_check`, Default compare base); `ProjectsPanel.tsx` gear keeps a link to the page; DESIGN.md amended · evidence/T-116-a-fix.txt, evidence/t116a-fix-gear.png, evidence/t116a-fix-git-page.png
- 2026-10-12 · [accounts] Git & worktrees gear move · not done: the sidebar gear's Git & worktrees part is T-116-a (b67005e), which is on main and lane/orchestration but not on lane/accounts, and this lane may not merge; move it into src/settings/GitPage.tsx (with the one-line DESIGN.md amendment) after main is merged into this lane, or in the merge itself
- 2026-10-12 · [accounts] T-096-b · done: `recordKey`, `editChords`, `removeChord` and the `recording` flag in src/keys/record.ts; `keybindings_write` (one command into this platform's section, through a temp file, refuses a broken file and bad ids or values, emits `keybindings-changed`) in src-tauri/src/keybindings.rs; KeymapProvider `save` and reload on change; the window's shortcuts stand aside while recording; recorder on each Shortcuts row; tests in src/keys/record.test.ts, src/settings/shortcutRows.test.ts and two Rust tests · evidence/T-096-b.txt, evidence/T-096-b-1-recording.png .. -5-clash.png
- 2026-10-12 · [accounts] T-096-a · done: `resolve` records clashes and takes an ignore list (src/keys/keymap.ts); `shortcutRows`, `filterRows`, `MAX_QUERY` in src/settings/shortcutRows.ts; `keywords` on actions; KeymapProvider ignores disabled agents' new-tab commands; Shortcuts page rebuilt; tests in src/settings/shortcutRows.test.ts and src/keys/keymap.test.ts · evidence/T-096-a.txt, evidence/T-096-a-1.png .. -3.png
- 2026-10-12 · [accounts] T-143 · done: `agentRows`, `searchAgents` (name, word start, alias, initials, command; over 40 characters ignored) and `wantsTerminal` in src/launch/agents.ts; PlusMenu search box, Show more toggle, Blank terminal row and Manage agents; sidebar row opens a shell tab, pane row splits a shell; tests in src/launch/dropdown.test.ts · evidence/T-143.txt, evidence/T-143-1-folded.png .. T-143-5-manage.png
- 2026-10-12 · [accounts] T-148-d · done: Appearance fields `paneDividerWidth`, `paneDividerDark`, `paneDividerLight`, `paneDim` (clamped, colours #rrggbb only) as CSS vars `--divider-width`, `--divider`, `--pane-dim`; the grid gap and ground follow them, unfocused pane content fades over 140 ms; Panes card under Terminal; DT-A7 + SET-023 amendment · evidence/T-148-d.txt, evidence/T-148-d-1.png .. T-148-d-3.png
- 2026-10-12 · [accounts] T-148-c · done: new `src/chrome/chromeItems.ts` (`titleBarAppName`, `tasksButton`, `automationsButton` with DT-A6 defaults, folded summary), Window & Sidebar switches and status bar item ticks in Settings > Appearance, TopBar app name, ProjectsPanel Tasks row and Automations button follow the switches; DT-A6 + SET-020 amendment; View-menu submenu on T-248, used/left usage on T-041 · evidence/T-148-c.txt, evidence/T-148-c-1-defaults.png .. T-148-c-5-automations-hidden.png
- 2026-10-12 · [accounts] T-148-b · done: Appearance page in three `<details>` sections with folded summaries (SET-016), links unfold their section (SettingsPage), App font / Editor font fields with installed-font suggestions (new `src-tauri/src/fonts.rs` `list_fonts`, `src/settings/fonts.ts`), fonts kept in `appFont` / `editorFont` and cached for the first frame; icon chooser, search unfolding, terminal font and editor noted on T-300, T-246, T-247, T-323 · evidence/T-148-b.txt, evidence/T-148-b-1-sections.png .. T-148-b-7-link-unfolds-window.png
- 2026-10-12 · [accounts] T-148-a · done: new `src/terminal/schemes.ts` (catalogue, search, Windows Terminal import, tidy on load), `src/settings/SchemePicker.tsx` (scheme lists), theme.ts dark/light picks (`terminalScheme`, `terminalSchemeLight`, `terminalCustomSchemes`), Appearance page Terminal colours rebuilt · evidence/T-148-a.txt, evidence/T-148-a-1-pickers.png .. T-148-a-5-custom-terminal.png
- 2026-10-12 · [orchestration] T-085-b · done (first part: pull request opened; T-085-c has checks failed, agent finished and the self-closing tab) · evidence/T-085-b-1-event-trigger-dialog.png, -2-one-run-by-the-event.png, -3-restart-with-pr-open-no-run.png
- 2026-10-12 · [orchestration] T-080 · not built, left unticked: VIEW-020 hands one agent's result to another chat session's composer, and native chat sessions with composers (T-325..T-334) are not built yet · none
- 2026-10-12 · [orchestration] T-079 · done (first part, no new code: the commands were built earlier; T-079-b has read, send and wait, the same commands as T-134) · evidence/T-079-1-create-in-background-and-list.png, -2-rename-split-close-all.png
- 2026-10-12 · [orchestration] T-188 / T-197-c / T-198-b · not built, left unticked. T-188's send-and-confirm needs `kolux terminal send` (T-134, unticked) and the hooks' busy-or-idle status (hard list); T-197-c's reuse-session and fresh-session wait on T-192-c and its other parts on remote hosts, tmux and the terminal wait; T-198-b's install and update need the published Kolux skills repository (T-196-b) and the browser command group (T-195)
- 2026-10-12 · [orchestration] T-192-c · not built, left unticked. HAND TO FABLE: keeping one agent session across runs means typing each run's prompt into an agent pane that is still open and knowing from the hooks' busy-or-idle status that it is free, which is PTY and hooks work on the hard list (the dev build's stand-in agent reports no hook status to prove it with)
- 2026-10-12 · [orchestration] T-195 · not built, left unticked. HAND TO FABLE: all four cards (annotating page elements, agents driving the visible browser tab, the CLI's navigate, wait, snapshot and capture, and acting on page elements) run on the embedded browser, which is on the hard list
- 2026-10-12 · [orchestration] T-196 · done (first part, SKILL-029, no new code: T-198-a's bundled guides meet it; T-196-b has the stale-skill notice, the update dialog and the Install panel, all waiting on a published Kolux skills repository for the community installer) · evidence/T-196-bundled-skills.txt
- 2026-10-12 · [orchestration] T-347 · done · evidence/T-347-1-pane-without-override-link-attached.png, -2-link-kept-after-stale-window-save.png, T-347-save-race.txt
- 2026-10-12 · [orchestration] T-291-b · done (first part; T-291-c has the Automation card tag and the View run proof) · evidence/T-291-b-1-run-worktree-shown.png, -2-filter-on-run-worktree-hidden.png, -3-jump-through-palette.png, -4-filter-off-after-jump.png (the switch label then read worktrees; it now reads workspaces for the plain-words rule)
- 2026-10-12 · [orchestration] T-228-c · done (first part; T-228-d has other agents, model and effort, the branch rename, one-click to a pull request and the live GitHub create) · evidence/T-228-c-1-writer-settings.png, -2-custom-command-message.png, -3-writer-off-no-button.png, T-228-c-writer-calls.txt
- 2026-10-12 · [orchestration] T-227-c · done (first part; T-227-d has the other writing agents, the conflicted-file note and big-branch line totals) · evidence/T-227-c-1-writing-with-stop.png, -2-message-in-original-workspace.png, -3-stopped-box-unchanged.png, T-227-c-writer-calls.txt
- 2026-10-12 · [orchestration] T-230-c · done (first part; T-230-d has review comments to the agent and merge conflicts with AI resolve, both waiting on T-229-d) · evidence/T-230-c-1-commit-menu.png, -2-commit-in-browser-tab.png, -3-no-github-no-open.png
- 2026-10-12 · [orchestration] T-229-c + T-176-c · done (first parts; T-229-d has AI drafts, the Checks panel, review comments and lookup fallbacks; T-176-d has the unavailable banner, sign-in help and big-diff limits) · evidence/T-229-c-1-grouped-by-pr.png, T-229-c-2-merged-moves-to-done.png, T-229-c-gh-calls.txt
- 2026-10-12 · [orchestration] T-232-b · done (first part; T-232-c has the full PR page, file review, URL paste, fork parent and picker grouping) · evidence/T-232-b-1-preview.png, -2-label-added.png, -3-body-changed-on-github.png, -4-draft-kept.png, -5-list-after-label-edits.png, T-232-b-gh-calls.txt
- 2026-10-12 · [orchestration] T-231-b · done (first part; T-231-c has the repository picker, new issue, close/reopen/comment and start-from-item) · evidence/T-231-b-1-all-open.png, -2-page-3-restored.png, -3-assigned.png, -4-assigned-is-pr.png
- 2026-10-12 · [orchestration] T-224-a · done: `Task`, `tasks_list` and `scm_tasks` in `scm.rs` (1 new cargo test, red first, against a stand-in gh: issues and pull requests merged newest first, drafts kept, unreadable answers refused), `src/tasks/model.ts` + `TasksPage.tsx` (2 new vitest), Tasks row and view.tasks open the page, openPage keeps it; debug-only KOLUX_DEV_GH stand-in hook; DT-O3 + VIEW-010 amendment; the rest on T-224-b · evidence/T-224-a-1-tasks-page.png, T-224-a-2-hidden-in-appearance.png, T-224-a-3-button-hidden.png
- 2026-10-12 · [worktrees] T-013-c · done: a newer workspace create overtakes a running one (cancelled before Git starts, or its half-made folder and new branch removed), create commands off the main thread so creates overlap, stand-in tab per running create above the panes; cargo test 310, pnpm test 501 · evidence/T-013-c-standin.png, evidence/T-013-c-overtaken.png, evidence/T-013-c.txt
- 2026-10-11 · [accounts] T-147 · done: new `src/chrome/statusItems.ts` (items, `readStatusBar` with old-list clean-up, `toggleItem`), `StatusBar.tsx` (right-click menu, popover guard, hidden items), App wiring (`statusBarVisible`, `statusBarHidden`), Settings > Appearance status bar switch; DT-A5 + VIEW-096 amendment; menu-bar item added to T-248 · evidence/T-147.txt, evidence/T-147-1-menu.png .. T-147-5-appearance-switch.png
- 2026-10-11 · [accounts] T-145-a · done: `src/theme.ts` (Tango light scheme, `currentDark`), new `src/terminal/colourMode.ts` (DEC 2031 subscribe, CSI ? 996 n query, CSI ? 997 ; 1|2 n reports), `TerminalPane.tsx` wires it to theme changes; T-145-b split off and HAND TO FABLE: Windows ConPTY swallows OSC 4/10/11 "?" and CSI ? 996 n / ? 2031 h before xterm sees them (proved live: a cursor-position query came back, the colour and mode queries did not); custom themes moved to T-148 · evidence/T-145-a.txt, evidence/T-145-1-light-tango.png, evidence/T-145-2-dark-kolux.png
- 2026-10-11 · [accounts] T-145-b · HAND TO FABLE: the colour and light/dark questions programs ask are swallowed by Windows ConPTY (system conhost via portable-pty) before xterm sees them; fixing it is PTY work (a pass-through console or answering in the Rust reader)
- 2026-10-11 · [accounts] T-141 · done: new `src-tauri/src/cli_accounts.rs` (app side: `account.list`, `account.add-begin` makes a throwaway folder in the profile's `sign-in-temp`, `account.add-finish` hands it to the same `sign_in` Settings uses and deletes it, a sign-in whose throwaway copy cannot be deleted is failed and not kept; CLI side: the login runs in the user's terminal with inherited input and output, a console handler passes Ctrl+C to the login only, then the folder is removed, a closing terminal removes it on the way out; an unknown begin command reads as a Kolux too old for accounts); `cli.rs` parses `account add [--agent claude|codex]` and `account list` (Claude when left out, an empty `--agent` refused, other flags refused as "this machine"), help text; `state.rs` `Store::dir`; windows-sys Console feature; 5 new Rust tests + 1 parse test; live: stand-in claude/codex, app not running -> `app_unreachable` and no folder made, add Claude -> listed, same again -> refused, add Codex with a printed device code -> listed and active, list text and JSON, Ctrl+C sent part-way -> "Sign-in interrupted; nothing was added" and the throwaway folder empty · evidence/T-141.txt, T-141-1-settings-after-cli-add.png
- 2026-10-11 · [accounts] T-140 · BLOCKED, not started: AUTO-014 saves a run's output when the run ends, and runs only ever reach "dispatched" until T-072 (AUTO-012, truthful end status) is built; its token and cost figures read the same unpublished Claude Code / Codex usage logs (Needs Txais, token analytics)
- 2026-10-11 · [accounts] T-139-b · not started · HAND TO FABLE: ACCT-023 and ACCT-064 need each pane to remember the account it started on, a check of the pane's foreground program (PTY) and an in-pane restart prompt that restarts Codex once the shell is ready; terminal-pane internals of the core lane.
- 2026-10-11 · [accounts] T-139-a · done: `modelsFor` returns nothing for an agent without a built-in list, `seatReady` counts such a seat ready once its AI is picked, the chooser hides the model group for it; seats test extended (5 listed agents end in Program default, Aider has none and is ready, Codex without a model is not); live: stand-in claude and aider on PATH, chooser opened from the pane's New session menu, Aider picked -> no model group and Start enabled, Claude picked -> model group with Start disabled · evidence/T-139-a-1-aider-no-model-step.png, T-139-a-2-claude-model-step.png. Seen: the Codex usage poller ran the real installed Codex for the system default's figures (top bar showed Codex 100% left); later live checks put a stand-in codex first on PATH.
- 2026-10-11 · [accounts] T-138 · done: `claude_accounts.rs` (duplicate check `same_account`, `activate(None)` for the system default, `remove` deleting only folders inside Kolux's own, refused during a sign-in), `codex_accounts.rs` (system default, `remove` with `remove_dir_patiently`, 30 s `missing_now` grace, roll-back only when no sign-in file exists, custom-provider refusal, read only), shared `AccountRow.tsx` with inline Remove confirm, Codex re-read on focus; 5 new Rust tests, 8 new front-end tests; live: seeded fake accounts with stand-in claude/codex on PATH, clicked rows, removed the active Claude and Codex accounts and the System default took over, folders gone · evidence/T-138-1-lists.png, T-138-2-remove-asks.png, T-138-3-removed-system-default-active.png
- 2026-10-11 · [accounts] T-136-b · BLOCKED, not started: USAGE-011 counts agent turns from the status hooks (T-025 unbuilt; the window only knows a program is running); USAGE-012 / 013 read Claude Code and Codex log files whose format has no public description (Needs Txais, token analytics)
- 2026-10-11 · [accounts] T-137 · BLOCKED, not started: the Claude / Codex token panels and cost figures parse the same unpublished log formats (Needs Txais, token analytics); the Grok credits panel waits for a Grok usage source
- 2026-10-11 · [accounts] T-136-a · done: `src/usage/alerts.ts` (`dueAlerts` 80 % and 95 % once per window and reset time, both at once when first seen over 95 %, nothing without a reset time, window wording for 5-hour / weekly / monthly / n-day / n-hour / other; `useUsageAlerts` watches the shared figures, waits for settings and the saved record) + `alerts.test.ts` (6 tests); `src-tauri/src/usage_alerts.rs` (fired record in state.db, saved before the notification shows) + tauri-plugin-notification; Settings > Notifications usage-alerts switch; live: Codex 70 % gave nothing, 82 % one toast, 84 / 90 % and a reload nothing more, 97 % the 95 % toast, a new reset time at 30 % then 81 % the 80 % toast again, Claude first seen at 97 % two toasts, no reset time none, switch off none, switch on again the one due; all read back from Windows' notification history; build / clippy / 132 Rust + 174 front-end tests / cargo-deny / tsc / licence check / plan-check green; no orphan process · evidence/T-136-a.txt, evidence/T-136-a-*.png
- 2026-10-11 · [accounts] T-135 · done: `src/usage/launchWarn.ts` (`launchWarnings` one line per provider at 80 % or more of its shortest window with a figure, seat count or the one agent named, reset time when known; the shared figures store the Codex pill now publishes to) + `launchWarn.test.ts` (4 tests: three Claude seats at 85 %, a second provider, 80 % exactly, 40 %, no figures, no usage source, the shortest-window rule); `ChooserPane.tsx` shows the lines above Start (1 more test); live: three Claude seats with 85 % set gave one line counting 3 sessions with its reset time and Start enabled, 40 % gave none, a real Codex seat (0 % used) gave none, Codex at 90 % added its own line; build / clippy / 132 Rust + 168 front-end tests / cargo-deny / tsc / licence check / plan-check green; no orphan process · evidence/T-135.txt, evidence/T-135-*.png
- 2026-10-11 · [accounts] T-037-fix-look · done: `styles.css` top bar is a three-column grid (`1fr auto 1fr`) instead of an absolutely centred switcher, a 1100 px rule that leaves the search box its icon, `.chooser-foot`; `ChooserPane.tsx` Start moved out of the scrolling body into a footer; a new test in `ChooserPane.test.ts` (Start sits in a footer after the scrolling body; failed before the move) and `scripts/evidence/overlap.mjs` (live check, exit 1 on overlap; before: switcher 595-805 over search box 771-961 at 1400 px, after: 517-727 against 771-961, and at 884 px 160-370 against 414-445 with the close button inside the window); live: Start reachable and starting a PowerShell session from a 6-pane chooser; seen, not fixed (core lane's tabs): a chooser that gets a tab beside it is named "Terminal N" on its tab · evidence/T-037-fix-look.txt, evidence/T-037-fix-look-*.png
- 2026-10-09 · T-024 · done: `src/terminal/tabs.ts` (one badge per tab, unread rule with the late-event drop) + `tabs.test.ts`; `TerminalPane.tsx` `onBell` (xterm's bell) and the `unread` mark; `App.tsx` unread panes and rows, window focus, in-view rule, `noticed` note, tab badges; `ProjectsPanel.tsx` takes the unread set from the window; `styles.css` badges. Live: Claude workspace via CLI, Ctrl+T second tab, `/exit` sent to the hidden Claude tab → bell badge, pane glow, row unread, note "Claude finished"; clicking the tab → green check, marks gone; `[char]7` from the hidden shell tab → bell badge and "Terminal 3 rang the bell". Evidence: `evidence/T-024-unread.png`, `evidence/T-024-viewed.png`, `evidence/T-024-bell.png`.
- 2026-10-09 · T-023 · done: `src/terminal/status.ts` (header word, tone, icon, age, needs-you cycle) + `status.test.ts`; `TerminalPane.tsx` finish time, minute tick, glow until focused, `onNeedsYou`; `App.tsx` Ctrl+J handler across workspaces; `styles.css` glow and age. Live: agent workspace via CLI, split shell focused, `/exit` sent to the agent → "Done · just now" with a glow, "1m ago" after a minute, glow gone on focus; Ctrl+J with nothing waiting left focus where it was. Evidence: `evidence/T-023-glow.png`, `evidence/T-023-focused.png`.
- 2026-10-09 · T-022 · done: `src/projects/rows.ts` (states, ranks, smart order, status and PR groups, setting keys) + `rows.test.ts`; `App.tsx` derives each folder's strongest state and change time from its panes and offers `saveSetting`; `ProjectsPanel.tsx` grouping, sort, filter form, state dots, unread marks, accent bar, 5 s branch poll; `styles.css`. Live: two CLI-made agent workspaces, one agent ended → done above working under Smart; Status grouping headers; hand-marked unread on the shown row; `git checkout -b renamed` in zeta's folder showed on its row. Evidence: `evidence/T-022-status.png`, `evidence/T-022-branch.png`.
- 2026-10-09 · T-021 · done: `cli.rs` (parse refuses the retired `--parent-workspace`, an empty `--parent-worktree`, a non-numeric or zero `--issue`; dispatch works out the parent from the calling folder, `--parent-worktree` in the same project or `--no-parent`, records the origin and echoes it; `calling_worktree`), `projects.rs` (`set_origin` / `origin` under `workspaceOrigins`, forgotten on removal), tests extended (65 Rust tests); live with `kolux-dev` rebuilt and the dev app up: from inside zeta `worktree create --name b --agent claude --prompt hi --issue 7 --comment "from zeta" --json` → envelope with parent = zeta's path, madeBy cli, issue 7, comment; row b appeared with zeta still selected and claude.exe running "hi" under the app; `--name c --activate` → c selected; `--name d --prompt hi`, `--parent-workspace name:zeta`, `--issue nope` → exit 1 with their messages; `rm --worktree name:b --force` and c → rows back to zeta, the Claude process gone; build / clippy / 65 Rust tests / 76 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-021-background.png, T-021-activate.png
- 2026-10-09 · T-020 · done: `projects.rs` (`resolve_workspaces_dir(env, setting)`, `KOLUX_WORKSPACES_DIR` read there, `PlaceInfo.fromEnv`, `set_place` makes an absolute folder and fails when it cannot; 2 tests, 65 Rust tests), `model.ts` (`placeFieldAction`; 1 test, 76 front-end tests), `ProjectsPanel.tsx` (Enter/Escape/composing, blur retry, Browse… for the folder, env label); live in the dev app started with the variable padded with spaces: Use default + Save showed the variable's folder with the "(from KOLUX_WORKSPACES_DIR)" label and env-proof was created at `<env>\repo\env-proof`; a folder under a file failed with "cannot be made" and kept the typed text, leaving the field after the blocker was removed saved it; Escape put the saved folder back; a typed folder + Enter put typed-proof at `<folder>\repo\typed-proof`; build / clippy / 65 Rust tests / 76 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-020-env.png, T-020-failed.png, T-020-folder.png
- 2026-10-09 · T-019 · done: `include.rs` (new: include-file lines, kolux.yaml shared list, tidy rules, copy, junction link, unlink; 3 tests), `git.rs` (`worktree_remove` keeps a branch in use elsewhere and reports its commit, `worktree_move`, `delete_branch_if_at`, `dirty` sees submodule work, `ref_ok` guard; 1 test), `projects.rs` (per-repo turn, `Created.warnings`, `remove_workspace(force)`; 1 test), 63 Rust tests; sidebar form asks "Discard and remove" after a refusal, warnings join the created note; live in the dev app on the throwaway repo with `.gitignore`, `.worktreeinclude` (`.env`, `*.log`) and kolux.yaml (`node_modules/`, `src`): Remove on the dirty zeta → "zeta has uncommitted changes. Remove it anyway? That work is lost." with work.txt still there; New workspace "bring along" → created from origin/main, note names `*.log` and `src`, `.env` copied, `node_modules` a junction to the main checkout showing its dep.js, `git status --porcelain` empty on branch bring-along; removal of a worktree with untracked files took the two-step path, of a clean one the one-step path, the main checkout's node_modules/dep.js survived both; build / clippy / 63 Rust tests / 75 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-019-dirty.png, T-019-created.png
- 2026-10-09 · T-018-b · done: `scm.rs` gains `Status.rewritten` / `Status.base`, `remote()` and `scm_remote` (push, pull, sync, fetch, ff, force --force-with-lease, publish --set-upstream origin, rebase after fetch); 1 Rust test over a bare remote (58 total); `nextStep` and `remoteItems` in `src/scm/model.ts` with 2 tests (75 total); panel: main button + Remote menu; live in the dev app on the throwaway repo with a bare origin: edit → "Stage all" → "Commit" held with "Write a message first" → typed → commit 6495041 → "Push 1"; menu read "Push 1 commit" on, "Pull · Nothing to pull", "Sync ↓0 ↑1", "Fast-forward · Already current", "Publish branch · Already published", "Rebase from origin/main · This is the base branch"; push → "Create pull request"; `feat` branch with a commit → "Publish branch" → published (`feat...origin/feat`); main moved from a second clone, menu Rebase from origin/main → `[ahead 2, behind 1]`, `git cherry HEAD @{u}` one `-`, button "Force push with lease" → pushed, counts 0; build / clippy / 58 Rust tests / 75 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-018-b-menu.png, T-018-b-lease.png
- 2026-10-09 · T-018-a · done: `scm.rs` (status / stage / commit, 4 Rust tests, 57 total), `src/scm/model.ts` + `SourceControlPanel.tsx` (2 front-end tests, 73 total), right card on Mod+Shift+G / Mod+L / the top bar button; live in the dev app on a throwaway repo: 1 edit + 4 new files listed as Changes 1 / Untracked 4, the three `docs/` rows staged by row, Ctrl+Enter in the box made commit 66f5f87 `Add the docs folder` (git log 2 → 3), the draft survived a switch to zeta and back, a refusing pre-commit hook gave `Commit blocked by a hook` + `nope, said the hook: README needs a title` + Fix with AI with no commit made, the Staged section's minus unstaged it; build / clippy / 57 Rust tests / 73 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-018-a-sections.png, -staged.png, -committed.png, -blocked.png
- 2026-10-09 · T-017-b · done: `trust.rs` gains `codex_config_file` (`CODEX_HOME` else `~/.codex`), `codex_key` (real path, lower-cased on Windows), `trust_codex` (`toml_edit` in-place edit of `[projects."<key>"] trust_level = "trusted"`, rest of the file byte for byte, locked, tmp + rename), `trust_folders` routes `codex`; `checked_keys` and `write_whole` shared with Claude; `toml_edit = "0.25"` in Cargo.toml; 1 Rust test (53 total); live with `CODEX_HOME` unset: `worker-start --spec "say hi and stop" --agent codex` → `trust: true`, the pane shows Codex (GPT-6-Sol) answering "Hi!" with no trust prompt, `~/.codex/config.toml` gained the worktree and the lower-cased repo root (12 → 14 `[projects…]` headers, everything above untouched); a second worker in the same worktree → `trust: true`, file hash unchanged; worktree removed; build / clippy / 53 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-017-b-codex.png
- 2026-10-09 · T-017-a · done: new `src-tauri/src/trust.rs` (`claude_config_file`, `claude_key` real-case forward-slash key, `trust_claude` locked read-modify-rename write that only touches the flag, `trust_folders` per agent, `trust_folders_cmd` command); `Ctx.claude_config` and a trust step in `worker_start` with a `trust` field in the receipt; App.tsx `pretrust(agent, dirs)` called from the new-tab path, `startSeats` (one call per agent for all its seats) and `startIn`; `serde_json` `preserve_order`; 3 Rust tests (52 total) + the cli dispatch test checks the trust write; live in the throwaway "repo": `worker-start --spec "say hello and stop" --agent claude` → `trust: true`, the pane shows Claude answering "Hello." with no trust menu (prompt reached it), `.claude.json` gained `%USERPROFILE%/kolux-rs/workspaces/repo/nimble-starfish` and the repo root with the flag; a second worker in the same worktree → `trust: true`, the entry unchanged and no new entry; worktree removed, both workers gone; build / clippy / 52 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-017-a-no-prompt.png
- 2026-10-09 · T-016 · done: `terminal.rs` marks program sessions (start time, last output) and `program_in(dir, since)`; `projects::create_fresh` shared by the UI command and the CLI; `cli.rs` `orchestration worker-start` parse (`WORKER_FLAGS`, `check_worker_start` with every refusal from CLI-035/ORCH-016/018/019), `worker_start` dispatch (task made/found under `orchestration.tasks`, worktree made or picked, `created` + `start` notify, readiness wait, receipt, `orchestration.dispatches`), `text_of` worker line, help text; front end `CliWorkspace` `start` kind → `startIn` with extra args and a pane title; 2 Rust tests (49 total; dispatch test runs the full flow with a 1 ms timeout); live in the throwaway "repo": `worker-start --spec "add a test" --agent claude --json` → `status: ready` in 1.8 s, `dispatch-1`/`task-1`, worktree hazel-otter, terminal 2; sidebar row hazel-otter + background tab "add a test" (Claude, Running) while the view stayed on main; opening the row shows one tab with Claude's trust prompt; `claude.exe --permission-mode auto "add a test"` under the app; `--worktree current --base-branch main` refused with exit 1 before anything was made; `worktree rm --worktree path:… --force` took the row, tab, process and folder away; build / clippy / 49 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-016-ready.png, evidence/T-016-one-tab.png
- 2026-10-09 · [accounts] T-037 · done: new `resources.rs` (`owners` counts each process tree under one session only and the rest under the app, `total` adds memory and CPU up with the app's working set standing in when its row is missing, `percent` clamps to the machine's cores, Win32 Toolhelp + process memory/times + GlobalMemoryStatusEx, `ps` and /proc/meminfo elsewhere; new `resources` command), `Terminals::list`, windows-sys features ProcessStatus / SystemInformation / Threading, `src/status/resources.ts` (grouping) and `ResourceManager.tsx`, the status bar memory figure opens it; 2 Rust tests (86 total), 1 front-end test (121 total); live: five sessions (three in a throwaway repository, one home terminal, one left from before a reload and shown in no pane) listed in their groups with memory figures, a session running a child read about twice the memory, ending it after the in-row question stopped it and its child while the other four kept running, ending the hidden one left the remaining three, a busy loop read 5.4 %; build / clippy / cargo-deny / tsc / JS licence check / plan-check green; no orphan process · evidence/T-037.txt, evidence/T-037-*.png
- 2026-10-09 · [accounts] T-036 · done: `agents.rs` (`StartLine` gains `program` and `env`; `start_line` applies the saved permission mode and the agent's command, arguments and environment; `split_args`, `parse_env`; `agent_start_line` reads the settings), `terminal.rs` (`terminal_spawn` takes `env`), App and TerminalPane pass them through, `src/launch/agents.ts` (`disabledAgents`, `offeredAgents`, `switchAgent`; no default means the first agent), new `src/settings/AgentsPage.tsx`; 1 Rust test (84 total), 1 front-end test (120 total); live: the page listed Claude Code and Codex, Claude given powershell.exe with `-NoLogo -NoExit -Command "echo $env:KOLUX_T036"` and KOLUX_T036=hello opened from New tab and printed hello, Manual dropped both agents' prompt-skipping flags, Claude switched off left Auto selected, no chip and a New tab menu without Claude, a saved default of aider showed "Aider (saved, not found right now)" through Refresh; build / clippy / cargo-deny / tsc / JS licence check / plan-check green; no orphan process · evidence/T-036.txt, evidence/T-036-*.png
- 2026-10-09 · [accounts] T-055 · done: `git.rs` (worktree `locked` read from `git worktree list --porcelain`, `changes` keeps the porcelain lines' leading space), `projects.rs` (`RemoveCheck`, `remove_check`, `removal_refused`: stamp, nested, locked never forced, changes need force; new `workspace_remove_check`, `workspace_remove` checks again before deleting), `src/projects/deleting.ts` (question rules), ProjectsPanel question lists up to five changes with a force box and shows a refusal in place, `workspace.delete` shortcut wired, `src/settings/GitPage.tsx`, `activeAfterRemove` picks the sibling used last; 1 Rust test (83 total), 4 front-end tests (119 total); live: lima with a changed and an untracked file listed both, Remove without the box refused and kept the folder, a file added while asking refused with the stamp message and listed three, forced delete removed it and moved to kilo with the list still at scroll 200, a locked workspace showed its reason with Remove disabled and a direct forced call was refused, the question switched off in Settings deleted clean golf from Ctrl+Shift+Backspace at once while dirty hotel still asked; build / clippy / cargo-deny / tsc / JS licence check / plan-check green; no orphan process · evidence/T-055.txt, evidence/T-055-*.png
- 2026-10-09 · [accounts] T-057 · done: `src-tauri/src/procs.rs` (has a process started a child), `terminal_busy` command and `Terminals::busy` (program panes live while running, shells while they have a child, ended or failed reads idle), each session keeps its process id, `src/terminal/closing.ts` + `CloseAsk.tsx` (the question naming the tab), every close in App goes through `closeTab`, the pane's own Close defers to the window, Settings > Terminal & sessions gets the switch; 1 Rust test (82 total), 3 front-end tests (115 total); live: a background tab running ping closed from its x asks "Close “Terminal 1”?" with Close tab focused, Escape keeps it, Close tab removes it and ping is gone, an idle shell closes with Ctrl+W without a question, Ctrl+W and the pane header's close button on a busy tab ask too, with the switch off a busy tab closes at once; build / clippy / 82 Rust tests / 115 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process · evidence/T-057.txt, evidence/T-057-*.png
- 2026-10-09 · [accounts] T-056 · NOT BUILT, left unticked, needs Txais: the permission check that guards this build session refused the edit that gives more agents their no-prompt start (Gemini CLI `--yolo`, Aider `--yes-always`, Goose `GOOSE_MODE` auto) as an unsafe-agent change, so nothing was changed. Claude Code (`--permission-mode auto`) and Codex (`--dangerously-bypass-approvals-and-sandbox`) already start that way from the agent catalogue. The rest of the card (the user's default arguments replacing the built-in ones, Kilo Code's refused argument dropped) waits with it. Txais decides: allow it for the build agent, or build it in a session of his own · no evidence
- 2026-10-09 · [accounts] T-054 · done: `src/theme.ts` (mode and light-terminal fields, `isDark`, light `buildTheme`, light terminal scheme, `followSystemMode`, two-frame transition hold on a light/dark switch), `src/settings/pages.ts` (ten pages, repo pages, `openSettings`, last page), `src/settings/general.ts` + `GeneralPage.tsx` (look and first screen), `ShortcutsPage.tsx` (file, errors, every command and its keys), SettingsPage rebuilt on the page list with lazily loaded pages and scroll-to-section, Appearance gets Interface > Mode and the light-scheme switch, App starts on the saved first screen and hides the switcher under Classic, the screen-cycle shortcut does nothing under Classic; 7 new front-end tests (112 total); live: existing profile opens Classic with System = light (Windows is in light mode) and the General page greys Agents and Board, New brings the switcher back, Board saved as first screen shows first after a restart, a fresh profile is written as New, Dark applies at once and System follows an emulated Windows switch to dark and back (#050405 / #fcfcfc), transitions held for two frames, light scheme on gives a #f6f6f6 terminal and off #0d0d0d, a link opens Shortcuts scrolled to its section, a repository adds an 11th entry with its own page; build / clippy / 81 Rust tests / 112 front-end tests / cargo-deny / tsc / JS licence check / plan-check green; no orphan process · evidence/T-054.txt, evidence/T-054-*.png
- 2026-10-09 · [accounts] T-053 · done: `src/theme.ts` (17 themes in wheel order, `readAppearance` / `writeAppearance` with unknown names as Classic and sliders clamped or defaulted, `buildTheme`, `previewOf`, `terminalFor` with a matched 16-colour palette, `applyAppearance` + `cachedAppearance`), `src/settings/AppearancePage.tsx` (swatches, preview, sliders, terminal picker, live apply and a 250 ms save), Settings gets an Appearance page, open terminals recolour in place, App applies the look on every settings read, the window starts hidden and is shown after the first themed frame (index.html, main.tsx, tauri.conf.json, `core:window:allow-show`, Rust backstop); 7 front-end tests (105 total); live: fresh profile Classic with sliders off, Teal on the whole window inside one frame, Moss saturation 0 grey and back, saturation 500 read as 160 and a word as 100, Match with Sky then Ember recolours a running PowerShell pane (#090e11 then #110b09) and Kolux dark puts it back (#0d0d0d), Rose saved while the app was closed is the first visible frame, an unknown name starts as Classic; build / clippy / 81 Rust tests / 105 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-053.txt, evidence/T-053-*.png
- 2026-10-09 · [accounts] T-043-d · HAND TO FABLE: Kolux-side renewal means Kolux sending the managed account's refresh credential to Anthropic's token service itself; that service's address, client id and answer are in no public Claude Code doc, so it cannot be built clean-room, and OD-01 (direct provider calls off) argues against building it at all, which is a call for Txais; the macOS keychain rules cannot be run or checked on this Windows PC; the switch alone (`claudeSignInUpkeepByClaudeCode` false) would only turn off Claude Code's upkeep with nothing in its place, so it was not shipped either; nothing changed, left unticked · no evidence
- 2026-10-09 · [accounts] T-042-b · HAND TO FABLE: Codex's own usage service is not in OpenAI's public Codex docs (only the background process's `account/rateLimits/read`, which T-042-a already uses), so its address and answer cannot be learnt clean-room, and the last route reads Codex's status screen in a hidden terminal (PTY screen parsing); nothing changed, left unticked · no evidence
- 2026-10-09 · [accounts] T-041 · HAND TO FABLE: blocked on T-025 and T-039 (carrying on after a limit needs the stop reason from the agent status hooks; Claude plan figures and the weekly pill need the status-line channel); the 200k window part could go alone (Claude Code's auto-compact variable, Codex's context-window and auto-compact overrides per run) but was not split off, to keep the task whole; the stored resume switch from T-045 waits for it; nothing changed, left unticked · no evidence
- 2026-10-09 · [accounts] T-040 · HAND TO FABLE: blocked on T-025 and T-039 (Board meters, tab rings and the Agents rings take their context and plan figures from Claude Code's status line, which needs T-039's report channel); nothing changed, left unticked · no evidence
- 2026-10-09 · [accounts] T-039 · HAND TO FABLE: needs T-025's agent status hooks (stop reasons, one notification per stop) and a token-checked local channel that Claude Code's status line reports figures through (hooks/IPC), none of which exists yet; the expired sign-in notice in the main window is already met by T-044's SignInNotice; nothing changed, left unticked · no evidence
- 2026-10-09 · [accounts] T-045 · done: `claude_own_sign_in` + `own_sign_in` (Claude Code's own sign-in reported on the Claude card only while panes run on it, warning when signed out), `auth_status` takes an optional folder, `codex_accounts::config_drift` / `top_level` and `drifted` ids in the Codex view, Codex rows marked Needs sign-in / Settings changed with Sign in again, Claude account rows marked Needs sign-in, `bad_arguments` (a Codex refusing its command line is no sign-in problem), the usage read reports a helper that quit before answering, the Claude card's resume-after-limit switch (`claudeResumeAfterLimit`, off by default), App reloads its settings copy on `settings-saved`; 4 Rust tests (81 total), 3 front-end tests (98 total); live with stand-in claude.exe / codex.exe and fake files only (no real sign-in): own sign-in shown as own@example.com, stand-in `claude auth logout` → Settings reopened → yellow "Claude Code is not signed in on this PC", a Codex account with `cli_auth_credentials_store = "keyring"` → Settings changed + Sign in again, a Codex that rejects its arguments → "This Codex version did not accept Kolux's sign-in command" and usage "quit before answering (exit code: 2)" with no sign-in flag set, resume switch turned on → settings.json true → app restarted → still on; build / clippy / 81 Rust tests / 98 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-045.txt, evidence/T-045-signed-in.png, evidence/T-045-signed-out.png, evidence/T-045-codex-args.png, evidence/T-045-resume-kept.png
- 2026-10-09 · [accounts] T-044 · done: `src/settings/SignInNotice.tsx` (main-window bar for a stale active managed Claude account or a Codex account with a sign-in error, hidden until both lists load, Sign in again with Signing in…), `src/settings/Attention.tsx` (reason → one fix, usage limit with its reset time and no button), `claude_key::Attention` with named reasons, `claude_account_check` (one `claude auth status` at start when Kolux looks after sign-ins), `mark_stale`, Codex sign in again in place, Codex sign-in errors set and cleared from usage reads, `open_install_page`, `settings-saved` event; 3 Rust tests (77 total), 6 front-end tests (95 total); live with stand-in claude.exe / codex.exe and fake sign-ins only (no real sign-in): stale account flagged at start and the bar shown, Sign in again → Signing in… → bar gone, stale again → bar back, upkeep handed to Claude Code → bar gone, Codex account with a sign-in error → bar, Sign in again → cleared and still active, usage limit → "It can be used again at 7:38 PM." with no fix button; build / clippy / 77 Rust tests / 95 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-044.txt, evidence/T-044-notice.png, evidence/T-044-signing-in.png, evidence/T-044-upkeep-on.png, evidence/T-044-codex.png, evidence/T-044-limit.png
- 2026-10-09 · [accounts] T-043-c · done: `codex_accounts.rs` (hidden `codex login` / `codex login --device-auth` with CODEX_HOME set to a private home per account, file credential store pinned in that home, device link and code shown only once both are printed, the new account made active, sealed vault copy, roll-back that never deletes a home holding a working sign-in, links and the code removed from errors, system-default login read as ChatGPT / API key / custom provider / signed out, `codex-accounts` event), Codex panes get the active home as CODEX_HOME, the usage pill reads that home first, `strip_ansi` keeps cursor-placed lines apart, `src/settings/CodexCard.tsx`; 4 Rust tests (74 total), 4 front-end tests (89 total); live with a stand-in codex.exe and fake sign-ins only (no real sign-in): Codex's own login reported, device view waiting then link + code with Cancel, connected as kim@example.com, a second account lee@example.com by the browser route, Cancel leaves two accounts and no half-made home, a failed code sign-in shows its reason with code and link removed, a Codex pane runs in the active home; %USERPROFILE%\.codex (11,903 files) byte-for-byte unchanged by SHA-256; build / clippy / 74 Rust tests / 89 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-043-c.txt, evidence/T-043-c-default.png, evidence/T-043-c-code-waiting.png, evidence/T-043-c-code.png, evidence/T-043-c-connected.png, evidence/T-043-c-browser.png, evidence/T-043-c-second.png, evidence/T-043-c-cancelled.png, evidence/T-043-c-failed.png, evidence/T-043-c-pane.png
- 2026-10-09 · [accounts] T-043-b · done (split; T-043-d holds the renewal opt-out switch, Kolux-side renewal and the macOS keychain rules): `claude_accounts.rs` (hidden `claude auth login` with CLAUDE_CONFIG_DIR set to a private folder per account and the 1-year key variable removed, 20 s hidden `claude auth status --json` for email and organisation, a failed add removes its folder, a failed re-auth restores the earlier credentials, unchanged credentials refused, links and codes scrubbed from errors, one sign-in at a time, Cancel, Make active, sealed vault copy, `claude-accounts` event), `claude_key::run_hidden` shared by both setups, Claude panes fall back to the active account's folder and drop an inherited key variable, `src/settings/ClaudeAccounts.tsx` + the Claude card's "Use my Claude account instead"; 6 Rust tests (70 total), 5 front-end tests (85 total); live with a stand-in claude.exe and fake credentials only (no real sign-in): empty list, browser step with Cancel, account added as sam@example.com · Stand-in Org, Cancel leaves the list and active account unchanged with no partial folder, failed re-auth keeps the row Active with the credentials file unchanged, a Claude pane gets the account folder and no key variable; build / clippy / 70 Rust tests / 85 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-043-b.txt, evidence/T-043-b-empty.png, evidence/T-043-b-browser.png, evidence/T-043-b-added.png, evidence/T-043-b-cancelled.png, evidence/T-043-b-reauth-failed.png, evidence/T-043-b-pane.png
- 2026-10-09 · [accounts] T-043-a · done (split; T-043-b ACCT-005/006, T-043-c ACCT-007): `claude_key.rs` (hidden `claude setup-token` in portable-pty answering ESC[6n, browser step seen from the first https:// line, key picked out of ANSI-stripped output, subscription line not final, 10-minute limit, cancel, single setup at a time, .cmd/.bat/.ps1 launcher → needs attention, status/connect/cancel/disconnect commands and a `claude-key` event, key handed to Claude panes only in key mode), `terminal_spawn` passes it as CLAUDE_CODE_OAUTH_TOKEN, `src/settings/` Settings overlay + Claude card, usage pill opens Settings; 7 Rust tests (64 total), 6 front-end tests (80 total); live: the real setup ran once by accident and connected (see Needs Txais: revoke that key), fake key now → "Renew in October 2027", fake key backdated 340 days → "runs out in 24 days (November 2026)" with Renew, new Claude pane in a throwaway worktree → /status "Auth token: CLAUDE_CODE_OAUTH_TOKEN" (401 with the fake key, no browser prompt), Disconnect → "Connect with a key that lasts a year"; build / clippy / 64 Rust tests / 80 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-043-a-browser.png, evidence/T-043-a-connected.png, evidence/T-043-a-renew.png, evidence/T-043-a-pane.png, evidence/T-043-a-disconnected.png
- 2026-10-09 · [accounts] T-042-a · done (split; T-042-b holds the usage-service and status-screen routes): `codex_usage.rs` (sign-in lookup account home → `CODEX_HOME` → `~\.codex`, nothing launched without one, API-key sign-ins reported as such; hidden `codex app-server` with CREATE_NO_WINDOW, initialize → account/read → account/rateLimits/read, 20 s limit, input closed then 3 s grace then the process tree stopped by force; windows placed by their own length, model-specific buckets ignored, reset credits from `rateLimitResetCredits`; refused sign-ins / dead refresh tokens → sign in again; errors scrubbed of paths and key-like text; one read per Codex home), `src/usage/` pill text and hover detail, `CodexPill` in the top bar; 5 Rust tests (57 total), 3 front-end tests (74 total); live: real sign-in → pill "Codex 100% left", hover "5-hour: 97% left, resets today 05:27 PM / Weekly: 100% left, resets Fri 12:27 PM / Limit-reset credits: 3 / Plan: plus", no codex.exe left afterwards; CODEX_HOME = a throwaway folder with fake tokens → yellow "Codex · sign in again", no figures, no window; build / clippy / 57 Rust tests / 74 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing; note: the first dev launch after a fresh compile quit by itself twice (no panic in the log), a second launch stayed up · evidence/T-042-a-figures.png, evidence/T-042-a-signin-again.png
- 2026-10-09 · [accounts] T-038 · done: `secrets.rs` (DPAPI seal/unseal with a `kolux-sealed:v1:` prefix, clear values from older profiles load as they are, settings fields `claudeOauthToken` / `xaiApiKey` kept out of `get_settings` and protected from `save_settings`, `secret_status` / `secret_set` / `secret_clear` commands, sealed vault files with read-and-reseal and move-aside, one-off pass 2 s after setup with `secretsSealingPassDone` in the store, profile folder limited to the user, `logs\kolux.log`); 4 Rust tests (52 total), 71 front-end tests; live with fake keys: a clear profile was sealed on first launch (settings + vault file, icacls shows only <user>), still connected; a key set through `secret_set` and an attempted overwrite from the window left no key text in settings.json, still connected after quit and reopen; `shot.ps1` takes `-ProcessId`; build / clippy / 52 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-038.png, evidence/T-038.txt
- 2026-10-09 · [release] T-097 · done: with the app minimised behind another window, kolux-dev open restored it and put it in front (four times out of four) and exited 0; with the app closed and a stale cli.json left behind, open started it detached and exited 0 once it answered (4.4 s), and a second open started no second copy; a missing app program failed at once and a silent one after 60 s, both exit 1 · evidence/T-097-*.png, T-097-live.txt
- 2026-10-09 · [release] T-096 · BLOCKED, not started: the Shortcuts page is one of the ten Settings pages (SET-006 in T-054, not built), and a Settings screen already exists only on lane/accounts (T-043-a); a second Settings screen here would collide with it at merge. The pieces it builds on are on main already: the keybindings file reader (T-005, SET-011) and the keymap resolver with scopes in src/keys. Build T-096 after T-054 lands, and note its live test writes Txais's real ~/.kolux/keybindings.json (shared with the old app), so back it up and restore it byte for byte · no evidence
- 2026-10-09 · [release] T-095-b · done: with a made-up Claude config folder, a publish written before start was ignored and a new one turned up within a poll as "Launch Plan · repo · session 7c371ba6" with its image and an offline copy of its jsdelivr script (the failed cdnjs one kept its address, a file outside the folder was not copied); a Bash look-alike, prose and a failed publish were ignored; publishing again kept one entry and refreshed the open viewer to v3; a replayed old publish in a resumed file was ignored; a subagent's publish was kept; a network-share page was listed Unavailable and a WSL path Remote · evidence/T-095-b-*.png, T-095-b-live.txt
- 2026-10-09 · [release] T-095-a · done: two pages added through the real Windows file dialog listed newest first and opened in the viewer offline with their stored image; a file outside the page's folder was not copied and the frame could not fetch it or another entry's files; a link to example.com opened in Chrome while a link outside the entry did nothing; "sales quarterly" hid the other row and "sales quarterly chart" showed the no-match message; an 11 MB page gave an error toast and left the list alone; a network-share page was listed Unavailable without being read; removing the open entry closed the preview and deleted its stored folder · evidence/T-095-a-*.png, T-095-a-live.txt
- 2026-10-09 · [release] T-094-c · done: Ctrl+P then "panel" listed panel.tsx and sidepanel.md before ui/panel/util.ts and index.ts; the hover tooltip moved with the pointer across four points and showed the full path with the name in bold; Enter opened panel.tsx; with no ripgrep on PATH the dialog said how to install it, offered Retry and listed git's files; with a portable ripgrep it left out .next, .vscode and a nested worktree and put mod9 before mod10; 100,000 files listed in about 0.7 s on a debug build and ranked in 15-18 ms a keystroke · evidence/T-094-c-*.png, T-094-c-live.txt
- 2026-10-09 · [release] T-094-b2 · done: Ctrl+C then Ctrl+V copied a file into another folder and, pasted again where the name was taken, as "taken copy.txt" with the original untouched; dragging a folder together with one of its own files moved only the folder, and Ctrl+Z moved it back still open; holding a drag at the tree's bottom edge scrolled it 792 px in 2 s; a folder dropped in from the desktop onto a root that already held one of that name arrived as "lib copy" with its contents, and a junction in the same drop was refused; undo sent the dropped copy to the trash. The drop was driven by emitting Tauri's own drag events (a real desktop drag could not be aimed at this window from here) · evidence/T-094-b2-*.png, T-094-b2-live.txt
- 2026-10-09 · [release] T-094-b · done: the explorer creates files and folders (a taken name is refused and the original kept), renames inline with F2 (Enter or clicking away commits, Escape cancels, a letter-case-only rename is allowed, another file's name is refused), deletes the selection to the system trash after one question (two files went to the Recycle Bin with one confirmation), and Ctrl+Z brought both back; Ctrl+Y and Ctrl+Shift+Z redo; Alt+Shift+C and Ctrl+Alt+Shift+C copy the path and the relative path (read back from the Windows clipboard); a WSL share deletes for good after saying so; T-094-b2 holds copy, drag to move and desktop drop · evidence/T-094-b-*.png, T-094-b-live.txt
- 2026-10-09 · [release] T-094-a · done: Ctrl+Shift+E opens an explorer of the worktree on the right with the keyboard in it; Down, Right, Down, Enter opened the first file of the second folder; Up, Down, Home and End move the highlight, Right opens or steps into a folder, Left folds or climbs to the parent; Shift-click two rows apart selected three, Ctrl-click adds one; a 2000-file folder drew 55 rows at a time; hiding and showing kept open folders and the scroll; a folder junction expanded and a file symlink opened as a file; an unreadable file opened from the tree showed the failure with Retry and loaded after access came back · evidence/T-094-a-*.png, T-094-a-live.txt
- 2026-10-09 · [release] T-093-d · done: New tab > All Changes opens one tab with a section per changed file and side (staged and unstaged are separate sections, each tagged Staged, Unstaged or Untracked, with its changed-line count); sections keep an estimated height and draw as they scroll near; over 2000 changed lines a section waits for Load diff; each text section stops at 560 px and scrolls inside; images show before and after at natural size, other binaries are named; the Files button shows a resizable side tree (grouped by folder, name filter, jump, viewed boxes that stay off until the section has drawn); a viewed tick, the scroll position, the tree and its filter survive a tab switch; a file changed in a terminal redraws within 2 s and its tick clears; at 2035 changes the tab opened in about 1.1 s and a jump stayed put · evidence/T-093-d-*.png, T-093-d-live.txt
- 2026-10-09 · [release] T-093-c · done: a diff tab for one changed file, opened from New tab > Changed file diff... (staged, unstaged and untracked files listed; staged and unstaged are separate tabs, the header says which); starts inline (no line numbers for the old side) and switches to side by side; the ... menu turns on whitespace-only changes and line wrapping, both off at first; F7 and Shift+F7 and the header arrows step through changes, the arrows grey while there are none; an unstaged diff's right side is the working file, editable, with the unsaved dot and Mod+S; the sides are read again every 2 s, so a terminal edit shows and a file staged elsewhere keeps its text with a No unstaged changes note; Shift+wheel scrolls the side under the pointer sideways; markdown diffs are plain source · evidence/T-093-c-*.png, T-093-c-live.txt
- 2026-10-09 · [release] T-093-b · done: a markdown file opens in a rich, document-style view (Lexical) with a Rich | Source switch in its header, rich edits go into the same text so the unsaved dot, Mod+S and twin panes work as in source; Mod+Shift+V opens a read-only preview tab marked Preview that follows the open text live and is reused for the next file; a file over 600 KB opens in source with a banner whose Open anyway turns that tab rich; a file the rich view cannot show faithfully (tables, images, HTML, front matter, reference links, footnotes, rules, underlined headings, or any word lost on the round trip) stays in source with the reason; a rich view that fails to start shows the reason and Retry; Mod+Shift+O picks from the worktree's markdown files (git ls-files: ignored files and symlinked folders left out, 2000 cap, asked afresh each time); Mod+Shift+M makes untitled.md, untitled-2.md... at the worktree root, never overwriting, stopping after 100 · evidence/T-093-b-*.png, T-093-b-live.txt
- 2026-10-09 · [release] T-093-a · done (T-093 split into -a..-d, one card each): New tab > File... opens a file from disk in an editor tab (CodeMirror 6, coloured by language), the tab and header carry an unsaved dot that trailing whitespace does not set, Mod+S saves the focused editor only on the terminals screen (atomic write, CRLF files keep CRLF), a failed save is a toast and the dot stays, a file that will not load is tried 3 times then shows the reason with Retry, the same file in two cells is one text (typing shows in both, one save writes once and cleans both), caret, selection and scroll survive a trip to Board · evidence/T-093-a-*.png, T-093-a-board-trip.txt, T-093-a-crlf.txt, T-093-a-load-failed.txt, T-093-a-save-failed.txt, T-093-a-two-panes.txt
- 2026-10-09 · [release] T-092 · BLOCKED, not started: the Connect cards live on Settings > AI connections and the xAI key must be sealed (ACCT-008 rule, ACCT-009), and both exist only on lane/accounts (T-038 sealing, T-043-a Settings with AI connections, T-043-b managed Claude accounts); building them again here would duplicate that lane and break the never-plain-text rule. Build T-092 in lane/accounts or on main after that lane merges · no evidence
- 2026-10-09 · [release] T-091 · done: pnpm ship (AI or own message, merge never rebase, conflict stops with nothing pushed, --main lands and starts the release job, --no-release, --merge, --dry-run, --model), release job (own checkout, lock + one queued rebuild, stale after 3 h or a dead holder, patch bump, signed installer + .sig + latest.json + notes with hidden source marker, smoke test, print-only and no-publish rehearsals), CI in four shards with one result job, release workflow behind a 30-minute CI gate, workflow-check script; kolux-dev --version; 15 script tests; live against a throwaway bare repo: two ships 20 s apart landed on main and built 0.1.1 then 0.1.2 one after the other into a local publish folder, a conflicting ship left the remote untouched, a released main was skipped, the gate refused a failed CI run and wrote the summary, the four shards add up to the whole suite (40+35+22+13 = 110); build / clippy / 52 Rust tests / 110 front-end tests / tsc / cargo-deny / JS licence check / plan-check / workflow-check green; no orphan process after closing · evidence/T-091-ship-dry-run.png, evidence/T-091-ship-and-queue.txt, evidence/T-091-conflict.txt, evidence/T-091-dry-run.txt, evidence/T-091-no-publish.txt, evidence/T-091-ai-message.txt, evidence/T-091-ci-gate.txt, evidence/T-091-shards.txt
- 2026-10-09 · [release] T-090 · done: quiet schedule (30 min, remainder wait, focus merge, 1 h retry doubling to 6 h, offline silence + recheck 5 s after online, wake check, timeouts), automatic signed download with progress, ready pop-up once per version per launch, install on Restart or on quit, update card through every phase with Escape / Enter, dismiss, tip and release notes; 10 schedule + 14 card tests, 4 Rust tests; live against a stub feed on 127.0.0.1 signed with a throwaway key: quiet check downloaded 0.2.0 and showed the pop-up, card listed 5 notes with headings removed, Escape collapsed, Enter on the error ran Try again, quitting ran the stub installer with /P /UPDATE and no restart, clicking Restart to update closed the app and ran it with /R; build / clippy / 52 Rust tests / 95 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-090-ready-popup.png, evidence/T-090-card-ready.png, evidence/T-090-card-collapsed.png, evidence/T-090-up-to-date.png, evidence/T-090-downloading.png, evidence/T-090-error.png, evidence/T-090-quit-install.txt, evidence/T-090-restart-install.txt
- 2026-10-09 · T-015 · done: `Copies` type, `defaultCopies` and `sharedWarning` in seats.ts; "Folders" radiogroup + warn note with the "Give each its own copy" fix on ChooserPane; App.tsx `startSeats` places each seat (terminal → chooser folder, agent → fresh worktree each when separate, shared folder or one fresh worktree otherwise); Rust `creatureNamesUsed` store key, `retired_names` / `remember_retired` / `fresh_name`, `workspace_create_fresh` holds the store lock; Rust test extended (48 total), 2 front-end tests added (71); live in the throwaway "repo" project: chooser from New session with 3 seats → "Separate copy for each AI" checked; "Same folder for all" → warn note + fix button, the fix re-selects separate; Claude + Claude + Terminal, Start → rows tidal-walrus and nimble-squid appeared, `git worktree list` shows both under workspaces/repo, Claude's trust prompt in nimble-squid's folder, the terminal seat in the chooser's folder; both removed through the sidebar (branches gone); one more Claude from New session → silver-narwhal; store key `creatureNamesUsed` = ["tidal-walrus","nimble-squid","silver-narwhal"]; build / clippy / 48 Rust tests / 71 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-015-default.png, evidence/T-015-warning.png, evidence/T-015-started.png, evidence/T-015-retired.png
- 2026-10-09 · T-014-b · done: loopback listener + `cli.json` in the app, `kolux-dev` program with the parser, the JSON envelope and exit codes, `worktree create` (name, repo selector or the shell's folder, base branch, agent + prompt, activate) and `worktree rm` / remove / delete (selectors current, name:, branch:, path:, id:; dirty refusal; --force), the window picks the change up over a `cli-workspace` event; 3 Rust tests added (48 total), 69 front-end tests; live: with the app closed `--help` exits 0, create says "Kolux is not running; start it first" (exit 1, JSON envelope with app_unreachable), a prompt without --agent is refused (exit 1); with the app up, from the repo folder `worktree create --name "cli test" --agent claude --prompt hello --json` → envelope with the path, the row "cli test" appeared, a hidden pane "cli-test Claude Running" with claude.exe started on "hello", the shown pane untouched; `--name quiet --activate --setup skip` → "created quiet at … (from main)", row selected with a shell; `rm --worktree name:quiet` → removed; junk file in cli test → `remove` exits 1 "cli test has uncommitted changes" + the --force hint; `delete --worktree branch:cli-test --force --json` → success envelope, rows back to main + zeta, the Claude pane and process gone, worktrees and folders gone; build / clippy / 48 Rust tests / 69 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; `cli.json` gone after closing · evidence/T-014-b-created.png, evidence/T-014-b-removed.png
- 2026-10-09 · T-014-a · done: global workspaces folder + nested/flat layout behind the footer gear, per-project folder + base ref behind the project row's gear with a used-folders list, create starts from the typed ref / saved base / default branch with a fetch for remote-tracking bases and a fallback note when the saved base is gone, agent + first prompt on the create form; 2 Rust tests added (45 total), model test updated (69 front-end tests); live over the debugging port: project gear → folder `…\t014\ws` + base `origin/feature` saved; after the remote branch was deleted, Mod+N "fallback test" → preview `…\t014\ws\repo\fallback-test`, created from main with the warn note "the saved base origin/feature no longer exists in repo; this workspace started from main instead", row selected with a shell; "pinned" + start from = a full commit id → worktree HEAD on that commit, no fetch; "agent run" + claude + prompt "hello" → one pane "agent-run Claude Running", claude.exe started with the prompt, no shell; layout flat → "flat one" at `…\t014\ws\flat-one`; all four removed through × / Remove (the agent process gone), settings reset; build / clippy / 45 Rust tests / 69 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-014-a-settings.png, evidence/T-014-a-fallback.png, evidence/T-014-a-form.png, evidence/T-014-a-agent.png, evidence/T-014-a-flat.png
- 2026-10-09 · T-013 · done: add-project resolves to the main checkout and opens it with a shell, scratch worktrees hidden, Mod+N / header plus open the name field with a branch + folder preview, stand-in row while Git works, taken names numbered (local and remote), typed name shown on the row and kept in the store; 2 Rust tests changed / added (43 total), model test updated (69 front-end tests); live over the debugging port: Mod+N with no project → "Add a project first.", Create disabled; gear form + a linked worktree's path → project "repo" at the main checkout, rows main + zeta (scratch hidden), main selected with a shell "repo main"; Mod+N + "Fix login 🔥" → preview "branch fix-login-fire · folder …\workspaces\repo\fix-login-fire", stand-in row at once, then the row selected with its own shell and the note "created Fix login 🔥 in …"; a second "fix login fire" while clicking back to main → `fix-login-fire-2` created, main stayed selected, no focus pull; "???" → "That name leaves nothing usable for a branch; use some letters or digits", Create disabled; both rows removed through × / Remove; build / clippy / 43 Rust tests / 69 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-013-noproject.png, evidence/T-013-added.png, evidence/T-013-pending.png, evidence/T-013-created.png, evidence/T-013-background.png, evidence/T-013-refused.png
- 2026-10-09 · T-012-b · done: the bar resolves sites, local hosts, file paths and searches (Google), refuses other schemes with a notice; back / forward / reload / stop toolbar with dimming and a loading spinner; Ctrl+L, Alt+Left / Right, Ctrl+R wired in the browser key scope; 1 Rust test, 4 front-end tests; live over the web view's debugging port: Ctrl+Shift+B opened the tab, "example.com" + Enter loaded https://example.com/ (tab "Example Domain", back lit), Ctrl+L selected the bar, "rust ownership" + Enter loaded Google results, Stop + spinner showed 116 ms into a reload and cleared at 1.3 s, "javascript:alert(1)" gave the red notice and left the page, Back returned to example.com with forward lit, Forward returned to the results; build / clippy / 42 Rust tests / 69 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-012-b-fresh.png, evidence/T-012-b-site.png, evidence/T-012-b-search.png, evidence/T-012-b-invalid.png, evidence/T-012-b-back.png, evidence/T-012-b-forward.png
- 2026-10-09 · T-012-a · done: Browser item in the New tab menu (Ctrl+Shift+B) opens a "New Tab" pane with an address bar focused over a blank page, the page is a child web view moved with the pane body and hidden while its tab / screen is away, tab named after the page title; 1 Rust test, 1 front-end test; live: "typed-in-bar" landed in the bar with no click, a local form page loaded from the bar and "kept-text" typed into its field survived a switch to Terminal 1 and back, a page calling `window.close()` left the tab in place, the Board showed no page; build / clippy / 41 Rust tests / 65 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-012-a-newtab.png, evidence/T-012-a-form.png, evidence/T-012-a-back.png, evidence/T-012-a-close.png
- 2026-10-09 · T-011 · done: Board screen lists every pane as a card (same cells as the grid, `.board` styling), expand shows the live terminal inside the card and collapses again, panes stay mounted across Agents / Board / Terminals; 1 grid test; live: `echo t011-ok` typed in the grid pane, Board showed the card collapsed, expand showed the same scrollback and `echo expanded-ok` typed into the card ran there, collapse + Terminals showed both lines in the grid pane in its old slot with the shell still at its prompt; build / clippy / 40 Rust tests / 64 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-011-grid.png, evidence/T-011-board.png, evidence/T-011-expanded.png, evidence/T-011-back.png
- 2026-10-09 · T-010 · done: grid cells hold tabs (`group` on panes, `cellsOf` / `neighbourTab` / `insertBefore` in grid.ts), "New tab" menu in the layout strip with Terminal + every installed agent and their chords, Ctrl+T / `tab.newAgent` / `tab.newAgent.<id>` / `tab.close` wired, a tab strip above cells with two or more tabs, `start_dir` for a requested start folder (relative, absolute, missing → workspace), paste through the pane's own text area with the chords left to the browser and queued behind an owed opening prompt; 3 grid tests + 1 strip test + 1 Rust test; live: New tab → Terminal opened "Terminal 3" as a second tab in the t010-repo cell at `PS G:\Temp\t010-repo>`, New tab → Claude Code opened a "Claude" tab with Claude running in that folder, closing "Terminal 2" from its x left the other two tabs with Claude in front; paste and Ctrl+T not provable from the harness (see decision); build / clippy / 40 Rust tests / 63 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-010-tabs.png, evidence/T-010-agent.png, evidence/T-010-close-tab.png
- 2026-10-09 · T-009 · done: pane grid 1..12 with balanced rows (`src/terminal/grid.ts`: clamp, columns / rows, resize plan, split index, insert), layout strip sets the count with the current count pressed, split button in every pane header, Ctrl+W / Ctrl+Shift+D / Alt+Shift+D wired through the keymap, close removes any pane including the last; 6 grid tests + strip test updated; live: "4" gave Terminal 1 plus three chooser panes 2x2, the split button opened Terminal 5 beside Terminal 1 in the same folder (3+2), "1" dropped the three unstarted panes and the second press showed the "started sessions" toast, the header close removed Terminal 5 and Terminal 1 took the full width; chords not provable from the harness (see decision); build / clippy / 39 Rust tests / 60 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-009-four.png, evidence/T-009-split.png, evidence/T-009-shrink.png, evidence/T-009-close.png
- 2026-10-09 · T-008-b · done: per-agent start-line builder with every SESS-051 prompt route (trailing, `--`, `--prompt`, `--prompt-interactive`, `-i`, Hermes query, typed), blank prompt = none, Hermes limit refused, foreground matcher with second names / Codex-Grok prefixes / interpreter entry scripts, "Opening prompt (optional)" box per AI seat, typed prompts sent after the pane goes quiet; 8 Rust tests + 1 chooser test; live: seat 1 Claude + Haiku with a prompt, Start opened worktree `silver-narwhal`, after the trust question Claude ran the prompt and answered "pong" with the session still open; build / clippy / 39 Rust tests / 54 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-008-b-prompt.png, evidence/T-008-b-launched.png
- 2026-10-09 · T-008-a · done: blank-seat caption, Same for all (greyed until a seat is finished), job-title field per seat, missing agents cleared not swapped, "Starting N sessions" toast, one pane per seat titled by its job, failed panes dropped with a toast; 2 seats tests + 1 chooser test; live: 3 seats blank with Start disabled, seat 1 Claude + Haiku then Same for all filled seats 2-3 and enabled Start 3, "Review" typed as seat 2's title, Start showed the toast and three Claude panes in worktree `velvet-seal` re-tiled 2+1 with the second titled Review; build / clippy / 31 Rust tests / 53 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-008-a-blank.png, evidence/T-008-a-same.png, evidence/T-008-a-toast.png, evidence/T-008-a-launched.png
- 2026-10-09 · T-007-b · done: chooser pane with per-seat AI and model radio groups, Start gated on every seat, count row 1/2/3/4/6/8 + free field, Start replaces the chooser with one pane per seat (`--model` appended, terminals in the same folder), close button hidden when it is the only pane; 4 seats tests + 3 chooser tests + 1 plus-menu test; live: menu item opened the chooser, Claude without a model kept Start disabled, Haiku enabled it, 3 → 2 kept seat 1, typing 15 + Enter gave fifteen seats with seats 1-2 untouched, 2 + Terminal + Start opened worktree `dusky-shrimp` with Claude (trust prompt) beside a PowerShell pane, a lone chooser had no close button; build / clippy / 31 Rust tests / 50 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-007-b.png, evidence/T-007-b-disabled.png, evidence/T-007-b-enabled.png, evidence/T-007-b-15.png, evidence/T-007-b-started.png
- 2026-10-09 · T-007-a · done: 34-agent catalogue with install detection on the PATH and the usual install folders (runnable files only), plus menu lists only installed agents with the default first and a "default" button on the others, `defaultAgent` saved in settings.json, `tab.newAgent` shortcut starts the default agent, `.cmd` shims start through cmd.exe; 4 Rust tests (find_in, catalogue order and start lines, newest nvm version, cmd shim start line) and 3 new front-end tests (menu ordering, default-agent setting, default-first rendering); live: menu showed only Claude Code and Codex of the 34 with Claude first and its Ctrl+Shift+K chip, "default" on Codex moved Codex to the top with the chip and wrote settings.json, clicking Codex opened worktree `ivory-crab` with Codex running through its npm `.cmd` shim; build / clippy / 31 Rust tests / 42 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-007-a.png, evidence/T-007-a-default.png, evidence/T-007-a-codex.png
- 2026-10-09 · T-006 · done: workspace switching (sidebar row click shows that workspace, panes of the others kept hidden, remove drops every pane inside the folder, empty-workspace placeholder) with 4 new front-end tests on the pure helpers; live: worktrees alpha and beta each got a shell, `echo alpha-one` / `echo beta-one`, switching back to alpha showed its earlier output unchanged with the row selected, removing beta dropped its pane (terminal count 3 to 2) and left alpha as it was; build / clippy / 28 Rust tests / 39 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-006.png, evidence/T-006-removed.png
- 2026-10-08 · T-006 · cut short by the usage limit before the live check: workspace switching code (pure helpers + 4 tests, hidden panes, sidebar selection, remove hook) passed tsc and 39 front-end tests but the live proof and the Rust gates had not run, so the work was reverted and the task stays unticked; the diff and the two new files are kept in the session scratchpad (t006-saved/) to re-apply next pass
- 2026-10-08 · T-002 · done: one PowerShell pane through a Rust PTY, drawn by xterm.js on the GPU with a plain fallback; typing, resize (shell reports 166x54 after the window grew) and Close all proven live; no shell left behind after Close or after closing the window; 4 Rust tests and 9 front-end tests green · evidence/T-002.png
- 2026-10-08 · T-003 · done: projects sidebar; a throwaway repository added as a project, "Fix login" created as branch `fix-login` in its own folder (confirmed with `git worktree list`), the pane opened inside it, then removed with a confirm step and both branch and folder gone on disk; 15 Rust tests (git runner round trip, name cleaner, project store) and 13 front-end tests green · evidence/T-003.png, evidence/T-003-removed.png
- 2026-10-08 · T-003b · done: frameless window with its own top bar, switcher, search box, usage pill and window controls; floating sidebar card; layout strip; rounded pane card with the design's header; status bar with live memory; palette from DESIGN.md as CSS custom properties; measured against the reference at 1920x1032: top bar 36 px, sidebar x 8..296, pane card from y 84, status bar from y 1008, all six background hexes exact, corners 1 px tighter; 16 Rust tests and 18 front-end tests green · evidence/T-003b.png, evidence/T-003b-compare.png (removed 2026-10-30 at Txais's request; the measurements above stay)
- 2026-10-08 · T-003b follow-up · done: chrome render test added (21 front-end tests green), hand-redrawn OpenAI knot removed in favour of a neutral glyph, cargo-deny installed and run ("licenses ok"), build / clippy / 16 Rust tests / tsc / JS licence check / plan check green; fresh maximized capture and side-by-side · evidence/T-003b.png, evidence/T-003b-compare.png (removed 2026-10-30 at Txais's request; the measurements above stay)
- 2026-10-08 · T-005 · done: shortcuts file read from the home folder (created empty when missing), 127 command ids with the COMPAT.md defaults per platform, overrides / null / win32 section / older top-level form / bad chords / unknown ids / conflicts all covered by 9 front-end tests and 4 Rust tests; live: chips show Ctrl+Shift+J and Ctrl+J from the map, an override in the win32 section showed Ctrl+Alt+P and "Unassigned" at the next start, a broken file showed the red notice with the defaults in use and was left untouched; Txais's own icon and mark carried over (src-tauri/icons regenerated); build / clippy / 28 Rust tests / 35 front-end tests / tsc / cargo-deny / JS licence check / plan-check green; no orphan process after closing · evidence/T-005.png, evidence/T-005-override.png, evidence/T-005-broken.png
- 2026-10-08 · T-004 · done: plus menu (sidebar and pane header) lists Claude Code and Codex with a PATH check, one click made worktree `jade-seahorse` off main and a pane running `claude --permission-mode auto` with mark, creature name, branch chip, "Claude", "Running"; closing the pane killed claude.exe; no orphan after closing the app; build / clippy / 24 Rust tests / 24 front-end tests / tsc / cargo-deny / JS licence check / plan-check green · evidence/T-004-menu.png, evidence/T-004.png
- 2026-10-07 · Phase 2: write PLAN.md · done: 338 tasks covering 1,030 cards (228 P0, 564 P1, 199 P2, 27 H marked build, 12 X), no dropped card · `node scripts/plan-check.mjs` prints OK
- 2026-10-07 · T-001 · done: Tauri 2 window opens, SQLite state store and JSON settings under the profile folder, cargo-deny and JS license gates green, build/clippy/test/vitest green · evidence/T-001.png
- 2026-10-12 · [orchestration] T-176-c · not built, left unticked. Polling every background workspace's pull request needs one owner for all workspaces' PR state, which T-229-c's sidebar grouping is to read, so the two are best built together; the Tasks banner needs the Tasks page (T-224); the diff limits, size budget and cache need a diff view (not built). The GitHub budget in Settings was built under T-233-c
- 2026-10-12 · [orchestration] T-250-b · not built, left unticked. HAND TO FABLE: kolux file open, diff and open-changed need the CLI-to-window channel and a diff view, and kolux tab needs the embedded browser, both on the hard list; registering the command for the whole system changes the machine PATH, which a pass may not do on Txais's PC; the argument grammar left here belongs to those commands and lands with them
- 2026-10-12 · [orchestration] T-232-b · not built, left unticked. The preview dialog, the full pull request page and the repository-picker grouping open from the Tasks page (T-224, not built); reviewing a PR's files needs a diff view (not built); pasting a GitHub URL into the new-workspace input needs the issue record a workspace keeps (T-231-b); a fork's parent owner has no reader until the fork-head lookup in T-229-c
- 2026-10-12 · [orchestration] T-231-b · not built, left unticked. Every card left here lives on the Tasks page (the issue and pull request list, the new-issue dialog, the item actions and start-from-item), and that page is T-224's, not built yet; the `kolux worktree create|set --issue` CLI needs the issue record a workspace keeps from GIT-049, which starts from the same page
- 2026-10-12 · [orchestration] T-291-b · not built, left unticked. The View menu's Appearance tick needs a View menu, which the app does not have yet; hiding or tagging worktrees made by automations needs a made-by-automation marker on worktrees, the card properties chooser and View run, none built yet
- 2026-10-12 · [orchestration] T-233-c · done: `Budget`, `gh_budget` and `scm_gh_budget` in `scm.rs` (1 new cargo test, red first, against a stand-in gh: three budgets parsed, a missing one left out, the call is exactly `api rate_limit`), `budgetLine` / `budgetLow` in `src/scm/model.ts` (1 new vitest, red first), the GitHub API budget section in `GitPage.tsx` (237 cargo tests, 357 vitest); T-176-c no longer holds the budget in Settings · evidence/T-233-c-github-budget.png (REST 4,962 of 5,000, Search used up in amber, GraphQL 4,988 of 5,000, each with its reset). Stand-in `gh.cmd` under G:\Temp only, no GitHub call; the stand-in was removed afterwards
- 2026-10-12 · [orchestration] T-230-b · done (first part, T-230-c split off): `MergeInfo`, `merge_info` (one `gh api graphql` read of the repository's merge settings and the pull request's merge state), `merge_act` and `scm_merge_info` / `scm_merge` in `scm.rs`, gh api calls no longer given --repo (1 new cargo test, red first, against a stand-in gh: parsed state, squash only, every action's gh arguments, bad method and action refused), `mergeLabel` / `mergeActions` in `src/scm/model.ts` (1 new vitest, red first), the merge box in `SourceControlPanel.tsx`, the PR row now wraps (236 cargo tests, 356 vitest) · evidence/T-230-b-squash-only-checks-pending.png (a squash-only repository with pending checks: Checks pending, Squash and merge when ready, Close pull request), T-230-b-auto-merge-on.png (after merge when ready: Auto-merge on (squash) · Checks pending, Turn off auto-merge; the stand-in logged pr merge --auto --squash). Stand-in `gh.cmd` under G:\Temp only, no agent started, no GitHub call; the linked-PR setting and the stand-in were removed afterwards. Also moved T-229-b's misplaced doc comment back onto `safe_pr_url`
- 2026-10-12 · [orchestration] T-229-b · done (first part, T-229-c split off): `PrScan`, `pr_url_in` and `link_printed` in `scm.rs` (1 new cargo test, red first: split chunks, colour codes, an Enterprise host, non-PR links, once per link, other settings kept), the scan in the output callback in `terminal.rs` with a settings-saved event (235 cargo tests, 355 vitest) · evidence/T-229-b-printed-pr-link.png (the link printed twice in the helper shell pane; Source Control shows #42 Stand-in pull request, Open, linked once). Stand-in `gh.cmd` under G:\Temp only, no agent started, no GitHub call; the linked-PR setting, the terminal and the stand-in were removed afterwards
- 2026-10-12 · [orchestration] T-228-b · done (split; T-228-c keeps the AI author, branch renaming, one-click PR and the real GitHub create): the fork-head check in `prReason` in `src/scm/model.ts` (GIT-023 vitest assertion, red first); vitest 355, tsc, licenses, plan-check green; live at 1416x889: the helper fixture pushed to a local bare `fork` remote, the Remote menu's Create pull request read the fork-head reason; remote, bare repo and commit removed afterwards · e7643be · evidence/T-228-b-fork-head-reason.png
- 2026-10-12 · [orchestration] T-227-b · done (split; T-227-c keeps the AI commit message): `files`, `committed`, `name_status`, `operation` and `abort` in `scm.rs` plus the conflict code and `resolved` in status (2 new cargo tests, red first: three commits on five files read 3 ahead and 5 files, a pinned base changes both; a merge conflict reads UU and AA, a hand fix reads resolved, abort restores HEAD for a merge and a rebase); `clashWord`, `abortLabel`, `capped` and `filesWord` in `src/scm/model.ts` (vitest, red first); the cards, Change Base Ref and refresh in `SourceControlPanel.tsx`, the project base saved from `App.tsx`; cargo 234, vitest 355, clippy, tsc, licenses, plan-check green; live at 1416x889 in the helper fixture: 3 ahead, 5 files changed with the five listed, Change Base Ref to a branch one commit back read 1 ahead and 1 file, a README conflict card read changed on both sides, Abort merge left no changes; base, branches and commits removed afterwards · 49cef4c · evidence/T-227-b-branch-row-and-conflict.png, evidence/T-227-b-change-base-ref.png, evidence/T-227-b-merge-aborted.png
- 2026-10-12 · [orchestration] T-233-b · done (split; T-233-c keeps the GitHub API budget): scmGroups and the two orders in `src/scm/model.ts` (vitest GIT-066 test, red first), the panel maps its sections over the chosen order in `SourceControlPanel.tsx`, the setting `scmGroupOrder` from `App.tsx`, the Source Control card in `GitPage.tsx`; vitest 353, tsc, licenses, plan-check green; live at 1416x889: Changes first chosen in Settings, the helper worktree's Source Control listed Changes above Staged; setting and fixture changes removed afterwards · f3aab4e · evidence/T-233-b-group-order-setting.png, evidence/T-233-b-changes-first.png
- 2026-10-12 · [orchestration] T-072-a · done (split; T-072-b keeps completion tracking): skip() counts a repeat on the newest entry, tidy() closes runs left pending or dispatching in `automations.rs` (2 new cargo tests, red first); statusWord's count in `src/automations/model.ts` (vitest assertions, red first); Last run and the Runs list show the latest and first time in `AutomationsPage.tsx`; cargo 232, vitest 352, clippy, tsc, licenses green; live at 1416x889: an every-minute stand-in automation whose worktree folder was removed read 'Skipped (unavailable) · 4 times' after four minutes; automation and folder removed afterwards · 037966e · evidence/T-072-run-history.png
- 2026-10-12 · [orchestration] T-071 · done: task_update and stop in `orchestration.rs` (2 new cargo tests, red first), Store::set_all so tasks and dispatches land in one transaction, task-update and worker-stop wired in `cli.rs` (help, required flags, text answers; 1 parse test extended), local_cli summaries and the orchestration skill's tasks reference; cargo 230, vitest 352, clippy, tsc, licenses green; live at 1416x889 on helper with an idle stand-in aider first on PATH: two workers started, worker-stop ended term-3 and kept stopme, a second stop answered the same, task-update completed task-2 and settled dispatch-2, the dispatched/unknown-state/finished refusals shown; worktrees, branches, stand-in and orchestration state removed afterwards · dbbd630 · evidence/T-071-*.png (3)
- 2026-10-12 · [orchestration] T-176-b · done (split; T-176-c keeps the rest): `scm.rs` GH_LIMIT and gh_run_for (pipes drained on their own threads, gh stopped at the limit) (1 new cargo test, red first, against a stand-in gh that hangs); PR_STALE_MS, prRefreshDelay and prLooked in `src/scm/model.ts` (1 new vitest test, red first); the panel's self-refresh, focus refresh, Refresh button and the kept-answer note in `SourceControlPanel.tsx`; notes wrap at word boundaries; cargo 228, vitest 352, clippy, tsc, licenses green; live at 1416x889 on helper with a local bare origin and a stand-in gh first on PATH: Open turned Merged by itself after 60 s, a hanging gh was stopped at 30 s with #7 still shown and the note, the retry waited 120 s and cleared it; stand-in, origin and remote removed afterwards · 7da1dea · evidence/T-176-b-*.png (4), T-176-b-refresh-timeline.txt
- 2026-10-12 · [orchestration] T-291-a · done: AutomationsRow.tsx (nav row with the clock icon, current while its page is open, right-click menu with Hide Automations row), ProjectsPanel puts it under Artifacts in place of the foot clock button, the Appearance switch reads Show Automations row in the sidebar (2 new vitest tests, red first); vitest 351, cargo 227, tsc, licenses green; live in the lane app: row shown, right-click menu, hidden with the Appearance switch off and the setting false, switched back on, row opens the page; the proof setting was removed afterwards · 3fde8a1 · evidence/T-291-a-*.png (4)
- 2026-10-12 · [orchestration] T-290 · done: `local_cli.rs` SKILL_HOMES (each agent's home skills folders, the shared .agents/skills for Codex, Cline, Kimi and Pi), coverage() with Claude's enabled plugins and Codex's plugin cache, Hermes local app data first, and the skills coverage command with its help line (1 new cargo test, red first); cargo 227, vitest 349, clippy, tsc, licenses green; live with the app closed against a stand-in home under G:\Temp: a repo-only install shows Claude not covered, Claude's home skills folder shows it covered · 3e7a3ef · evidence/T-290-skill-coverage.txt
- 2026-10-12 · [orchestration] T-288 · not built, left unticked. The issue command is one of kolux.yaml's shared values (T-149, unbuilt), its local twin lives on the per-repository page (T-116-c, unbuilt), and running it inside the new workspace needs the create-time command run that the setup script gets on T-107-b (unbuilt); build it right after T-107-b and T-149, reusing that run with the issue number filled in
- 2026-10-12 · [release] T-105 · done: CLI-023 CLI-026 and, as T-185-b, CLI-027 built and proven live from a shell outside Kolux RS against the lane app: list drew worktree, pane and tabs with the hosts line, show named pane, tab and in view, create opened in the background and came forward only with focus, a one-shot command stayed back, split opened beside a parked tab without moving the focus, rename and its reset, switch and focus, close of one terminal, of a pane's tabs, of a worktree from inside it (its own terminal left open), and the stop alias; reload survival, the navigation-took-over answer and other hosts not built (DT-R37) · evidence/T-105-live.txt, T-105-create-focus.png, T-105-split.png, T-105-switch.png, T-105-close-inside.png
- 2026-10-12 · [release] T-104-a · done: ACCT-046 ACCT-048 ACCT-049 built and proven live: with PowerShell 7 refused (access denied) the pane opened Windows PowerShell, with that gone too it opened the command prompt at code page 65001; a pane started from a partial conda activation under pnpm tauri dev showed none of those variables; an agent at a drive root was refused while a shell opened, a subst drive removed gave the not-connected message, and a project whose folder was moved showed the no-longer-exists message in the pane; T-104-b (ACCT-047 ready signal, ACCT-065 macOS and Linux fallback) left open · evidence/T-104-live.txt, T-104-auto-env.png, T-104-cmd.png, T-104-gone.png
- 2026-10-12 · [release] T-103-a · done: VIEW-108 proven live with no code change: a terminal scrolled up mid-stream came back on the same row after a workspace switch, a pinned one kept following new output, and a Windows full-screen program (a console-mouse stand-in) still counted wheel events after a workspace switch and a Board round trip; cdp.mjs gains a wheel command; T-103-b (VIEW-036 live check with keys assigned, plus the VIEW-036 vs SESS-008 confirm conflict) left open · evidence/T-103-live.txt, T-103-scrolled.png, T-103-back.png, T-103-pinned.png, T-103-mouse.png, T-103-mouse-back.png
- 2026-10-12 · [release] T-101-a · done: Settings > Terminal & sessions picks how many panes a new workspace starts with (shell plus empty choosers, checked with 4 and in the classic look), a kit started into a seeded grid filled its three empty panes and into a full one added cells with the running ones untouched, the sidebar's New session agent pick now uses the agent's start line, and Ctrl+] / Ctrl+[ cycle focus and keyboard with wrap; T-101-b (TERM-002 with keys assigned, TERM-009 equalize) left open; the kit's "Try with sample data" button made %USERPROFILE%kolux-rssamplesspreadsheet during the test and the lane could not delete it · evidence/T-101-live.txt, T-101-setting.png, T-101-seeded.png, T-101-filled.png, T-101-full.png, T-101-focus.png, T-101-launch.png
- 2026-10-12 · [release] T-100-a · done: each lineup seat offers effort and fast mode when its Claude model has them, Use last lineup brings back a project's shape, folders and each seat's AI and model, Claude Code started with nothing picked gets its top model at high effort, and the per-agent command, arguments and environment and the new-tab shortcuts were checked live; T-100-b (live model lists) left open · evidence/T-100-live.txt, T-100-options.png, T-100-lineup.png, T-100-project-b.png, T-100-claude-env.png, T-100-shortcuts.png
- 2026-10-12 · [release] T-098 · done: next and previous workspace (wrapping, folded rows skipped), Mod+1..9, focus the list, back and forward through workspaces and pages (keys and top bar arrows, removed workspaces skipped), and the worktree palette (open tabs, worktrees, projects, settings pages, quick actions, pull requests; every word must match, matches underlined, Create workspace from the typed name, long pastes refused) · evidence/T-098-live.txt, T-098-palette.png, T-098-settings.png, T-098-create.png
- 2026-10-12 · [release] T-205 · done: Start kit opens one titled session per role (reusing an idle first shell), keeps the last run's results in a dated copy, writes a hidden run record, gives every role the seven plain rules, types a waiting role its prompt once the role it waits on writes DONE, and shows a foldable results strip whose rows say what each AI is up to; also fixed a race where a pane dropped its program's first output and the program never started · evidence/T-205-live.txt, T-205-started.png, T-205-done.png, T-205-conflict.png, T-205-second-kit.png
- 2026-10-12 · [release] T-204 · done: six starter kits with a gallery (sidebar row), roles assigned to connected AIs, a setup dialog that checks file inputs on disk, refuses Excel workbooks, drops paste quotes, takes dropped files and warns on empty required fields, Try with sample data (built-in samples copied once into their own Git project), and inputs recalled per project. Live: gallery read back, workbook, missing-file and needed warnings, samples created then unchanged on a second try, real inputs recalled on reopen, sample runs not remembered. Start kit shows a placeholder until T-205 · evidence/T-204-live.txt, T-204-gallery.png, T-204-workbook.png, T-204-needed.png, T-204-samples.png, T-204-recalled.png
- 2026-10-12 · [release] T-203 · done: adding a folder without Git opens a first-commit preview (the folder's .gitignore honoured, secret-looking names unticked and labelled) and Start Git and commit, which inits, commits exactly the ticked files and adds the project, removing the new .git if a step fails; relative, missing and already-Git paths refused. Live: a throwaway folder with .env, deploy.pem and an ignored build/ previewed with 2 left out, one commit of the other 4, the project added and its workspace opened, the three refusals. The automatic folder-to-Git switch moves to T-214 with folder projects · evidence/T-203-live.txt, T-203-preview.png, T-203-added.png
- 2026-10-12 · [release] T-202 · done: every Disconnect asks first (the tab-close question generalised, with an explain-only single-OK form); Claude's erases the 1-year key; Codex's removes the active account Kolux made with its home and sealed copy, and with only Codex's own login explains `codex logout`; Grok's erases only the saved xAI key and explains `grok logout` for the CLI sign-in; connected Codex and Grok cards gain Manage beside Disconnect; quitting cancels every running hidden sign-in, key setup and install. Live: all five dialogs, a stand-in Codex account added then removed (home and vault copy gone, own login sha256 unchanged), the xAI key erased with the Grok sign-in kept, the Claude key erased, a Grok code sign-in's processes gone after quit · evidence/T-202-live.txt, T-202-*.png
- 2026-10-12 · [release] T-185-a · done: `src-tauri/cli/kolux.cmd` (forwards to the kolux.exe beside it with its exit status, declines orchestration send/reply with 2, missing launcher 1) and its cmd-run integration test; a `kolux` program behind the release-cli feature that the release script builds and bundles into `bin/` with the shim; panes prefer the install's bin folder and drop an inherited KOLUX_USER_DATA_PATH; call() tells app down from lost answer, timeout and version gap; every answer carries meta.appVersion and an older app refuses changes from a newer CLI; lasting UUID retry ids with the printed retry command; request-show and reset with one scope; PowerShell 5.1 stripped-quote JSON spotted. Live: shim exit statuses with the app open and closed, a two-line body through kolux.exe stored unchanged, one task for two creates with one retry id, request-show before and after reset, a lane pane reaching its own app. T-185-b (terminal close) waits for T-105 · evidence/T-185-live.txt, T-185-pane-cli.png
- 2026-10-11 · [release] T-099 · done: `shell_list` in pty.rs (installed shells once each, PowerShell first, WSL only with a default distribution), Refresh agents in the plus menu and chooser (one search, told to every window, seats of a vanished or switched-off agent go blank, a failed search keeps the list and warns), no default agent on a fresh install, all-off empty state with Agent settings..., create menu with each shell, Choose agent..., New/Open markdown; Add/Remove session actions (remove never closes a lone chooser). Live with stub agents: fresh default, Grok as default through Ctrl+Shift+K, Grok off, all off, Refresh adding and removing a stub Gemini (seat 2 blanked), Git Bash and Command Prompt tabs as real children, Choose agent... opening an empty chooser. The two session shortcuts ship unbound, so they are unit-tested only. Importer carry-over of switched-off agents and the default agent is T-181 / T-075 · evidence/T-099-*.png, T-099-live.txt
- 2026-10-11 · [release] T-092-b · done: `grok.rs` (Grok CLI login by browser or device code run hidden, sign-in told by its auth.json, sealed xAI key handed to Grok panes, Cancel that ends the login or wipes a leftover note) and the Grok card with its key dialog; all three cards now share "Other ways to connect", a needs-attention state with Cancel, and a 30 s pending release. Live with a stand-in grok: device code, Cancel, browser route to connected, key dialog (disabled, Cancel blanks it on reopen, sealed, never on the page), sign-in wins over key, expired code to needs attention and Cancel wiping it; Codex's wrapper refusal wiped by Cancel. Codex's real ChatGPT sign-in needs Txais · evidence/T-092-b-*.png, T-092-b-live.txt
- 2026-10-11 · [release] T-092-a · done (T-092 split; T-092-b keeps ACCT-002's state machine and ACCT-008 Grok sign-in): `install.rs` (WinGet install in a hidden terminal, progress from its printed sizes, 15-minute stop, exit codes to plain reasons, registry PATH re-read, found-after check, cancel and restart per agent) and `ConnectGrid.tsx` (Claude, Codex, Grok grid with taglines, loading placeholder, Install / progress / Cancel, Open install page, Manage accounts (advanced)). Live with a stand-in winget: only-Claude grid, Codex install 50% then Codex's own card with no restart, Grok cancel, Grok finished-but-not-found failure. One real xAI.GrokBuild install happened by mistake in testing and was uninstalled (see live.txt) · evidence/T-092-a-*.png, T-092-a-live.txt
- 2026-10-09 · [accounts] T-038 · How secrets are sealed: Windows DPAPI (current-user scope)
  through `windows-sys` 0.61 (MIT/Apache-2.0, already in the lock through Tauri); the profile folder
  is limited to the user with `icacls /inheritance:r /grant:r <user>:(OI)(CI)F`, so every file
  inside inherits it. On macOS/Linux this build only scrambles and logs that once. The settings
  fields are `claudeOauthToken` and `xaiApiKey`; managed sign-ins go in `<profile>\vault\`. The one-off
  pass waits 2 s after setup so it never delays the window. Recorded as DT-A1 in DECISIONS.md.

- 2026-10-09 · [accounts] T-042-a · Split: the background app-server route (Codex 0.156's
  `account/read` + `account/rateLimits/read`, shapes from `codex app-server generate-json-schema`)
  is built first; Codex's own usage service (tried first by the card) and the hidden status-screen
  route are T-042-b. A window of 24 hours or less counts as the 5-hour one, anything longer as
  weekly; with no length given, primary is the 5-hour one. The pill shows the weekly figure (the
  pill is the weekly pill, USAGE-008) and reads again every 10 minutes until USAGE-023's timer
  lands. The live proof read Txais's own Codex figures (read only, no session opened).

- 2026-10-09 · [accounts] T-043-a · Settings opens from a click on the top-bar usage pill and
  from Ctrl+Comma (`app.settings`), laid over the window body; it has only the AI connections page
  until T-092 brings the full Connect cards (ACCT-001..003). The profile fields are
  `claudeOauthToken` (sealed, from T-038), `claudeConnectionMode` = "key" and `claudeKeyCreatedAt`
  (milliseconds). Twelve months = 365 days; the warning starts at 30 days left or fewer; the
  renewal month shown is the month the key runs out. The setup runs in a hidden terminal (ConPTY,
  400 columns) that answers Claude Code's cursor-position question, because without that answer
  its output stalls; a launcher ending .cmd/.bat/.ps1 is refused rather than run through cmd. The
  key is taken only from an `sk-ant-oat…` run of at least 40 characters; a subscription line counts
  as final only when no key follows. Split: T-043-b (managed accounts, renewal opt-out), T-043-c
  (Codex sign-ins).
- 2026-10-09 · [accounts] T-043-b · Managed Claude accounts live in the profile: kv
  `claudeAccounts` (id, email, organisation, folder, last sign-in) and `claudeActiveAccount`;
  each account's folder is `<profile>\claude-accounts\<id>` holding Claude Code's own
  `.credentials.json`, with a sealed copy at `<profile>\vault\claude-<id>.json`. Adding an account
  does not make it active; the first one is not made active either, so nothing changes under a
  running setup until the user picks it. The 1-year key wins over the active account for new
  panes. An account pane drops any CLAUDE_CODE_OAUTH_TOKEN Kolux itself inherited, because Claude
  Code prefers that variable over the folder (found live). The email and organisation field names
  in `claude auth status --json` are not documented; several spellings are tried and a row shows
  "Claude account" when none match. Settings field `claudeSignInUpkeepByClaudeCode` (absent = on,
  DT-A2) holds the ACCT-006 opt-out; there is no switch for it until T-043-d.
- 2026-10-09 · [accounts] T-043-c · Codex accounts live in kv `codexAccounts` (id, email, home,
  last sign-in) and `codexActiveAccount`; each home is `<profile>\codex-accounts\<id>` with a
  `config.toml` holding only `cli_auth_credentials_store = "file"` (Codex's public auth docs), so
  the sign-in lands in that home's `auth.json` and not in the system keyring; a sealed copy goes to
  `<profile>\vault\codex-<id>.json`. Consequence: a pane on a managed Codex account does not
  see the user's own Codex settings (MCP servers, model choices); it starts from Codex's defaults.
  Unlike Claude accounts, a newly connected Codex account becomes active at once: Connect on the
  Codex card means "use this". The email comes from the `email` claim of the sign-in's identity
  token (not documented); the device code is taken as dash-joined groups of 4 or more capitals
  or digits, checked only against a stand-in so far. The usage pill reads the active account's home
  first. `claude_key::strip_ansi` now turns a cursor jump into a line break and a cursor-forward
  into a space, because the hidden console places lines that way (found live: the link and the next
  line ran together).

- 2026-10-09 · [accounts] T-044 · The reason list and its fixes live in `src/settings/Attention.tsx`
  (the back end names the reason, the page owns the button words). Choices: plan not covered
  offers Check again; a refused Claude account sign-in offers "Use a 1-year key instead"; an
  unknown reason shows for information only and keeps the card's own Connect. The startup check
  runs `claude auth status` once for the active managed Claude account and marks it stale when
  no identity comes back; it is skipped in key mode and when Claude Code looks after sign-ins
  (OD-01's default), so by default only Codex can raise the bar. Codex accounts are flagged from
  the usage read, only when the account home holds a sign-in. The usage-limit reset time is read
  from kv `claudeUsageLimitResetsAt`, which T-039 is to write. "Sign in again" on a Codex
  account updates that account in place and does not change which account is active.

- 2026-10-09 · [accounts] T-045 · Claude Code's own sign-in is read with a hidden `claude auth
  status --json` (no folder override, the 1-year key variable removed) each time Settings opens,
  and only when it is what new Claude panes use (no key mode, no active managed account); no
  answer within 20 s shows nothing rather than a false "signed out". Codex drift means the
  account home's config.toml no longer has `cli_auth_credentials_store = "file"` at the top level
  or now names another model provider; the user's own `~\.codex` is never checked (Kolux expects
  nothing of it). A Codex refusing its command line is spotted by its parser's usual wording
  ("unexpected argument", "For more information, try '--help'") and shown as "update Codex"
  with no fix button. The resume switch is settings field `claudeResumeAfterLimit`. The main
  window's copy of the settings now reloads after every save, so one writer no longer drops
  another's field.

- 2026-10-09 · [accounts] T-053 · Settings fields: `appTheme` (lower-case name, anything else is
  Classic), `themeTint`, `themeSaturation`, `themeDepth`, `terminalScheme` (`default` or `match`).
  A hued theme recolours only the grey tokens (backgrounds and lines at 30 % saturation times the
  slider, text at a third of that; depth moves backgrounds 1.2 % lightness per step) and leaves the
  status colours as they are. The window starts hidden (`visible: false`); main.tsx applies the
  saved look, renders, and shows the window two frames later, with a 5 s backstop in Rust. The
  last run's look is also kept in the page's local storage (`kolux.look`) for when the settings
  answer slowly; it is not relied on, since a killed app may not have written it. There are no
  pop-out windows yet; any later window loads the same page and gets the same look.

- 2026-10-09 · [accounts] T-054 · Settings fields: `appearanceMode` (`system` | `light` | `dark`,
  anything else is System), `terminalLightScheme` (true unless false), `uiLook` (`classic` | `new`),
  `firstScreen` (`agents` | `board` | `terminals`). A profile whose settings already hold anything
  but have no `uiLook` is Classic; an empty one is New; main.tsx writes the answer down on the
  first start so it does not change later. NOTE for the merge: every existing dev profile
  (main checkout included) therefore opens Classic, without the screen switcher, until New is
  picked in Settings > General. Light mode turns the grey tokens over (backgrounds 1 - 0.7 x
  lightness, text 1 - lightness) and darkens status colours by a quarter; warn / danger literals
  became tokens for light mode only (dark keeps the measured values). The window sets
  `data-mode` and `color-scheme` on the root. Settings links: `openSettings(page, section)` in
  `src/settings/pages.ts`; sections carry `data-section`. The shortcut-policy setting itself
  does not exist yet; the link is proved on Shortcuts > Commands and keys, and the keymap
  notice's "Shortcuts settings" button opens the Shortcuts file section. The terminal picker's
  "Kolux dark" is now called "Kolux", since it turns light in light mode.

- 2026-10-09 · [accounts] T-057 · Settings field `confirmCloseRunning` (true unless false). A pane
  started with a program (an agent) counts as live while it runs; a shell counts as live while a
  process has it as its parent (Windows process snapshot, `pgrep -P` elsewhere, `src-tauri/src/procs.rs`).
  A failed check closes without asking. The confirm focuses Close tab, so Ctrl+W then Enter closes;
  Escape or a click outside keeps the tab. Panes in this build split into separate cells, never into
  one tab, so the one-question-per-split-tab rule is in place (`closeTab` takes every pane key of a
  tab) but has nothing to act on yet; the rest is named on T-102. Settings pages now share
  `src/settings/useSettings.ts`.

- 2026-10-09 · [accounts] T-055 · Settings field `confirmWorkspaceDelete` (false skips the question
  for a clean workspace only). `workspace_remove` now takes `force` and `stamp` and re-checks before
  deleting; the stamp is HEAD plus the porcelain lines, so any new, changed or committed file
  refuses a delete asked about earlier. The CLI's remove (cli.rs) still deletes as before, forced.
  Nested means another worktree of the same repository inside the folder; other projects'
  folders inside it are not looked for (ponytail note in projects.rs). No delete animation exists,
  so reduced motion has nothing to turn off. The move-to-sibling only picks a sibling that still
  has panes, so the window never lands on an empty workspace.

- 2026-10-09 · [accounts] T-036 · Settings fields: `disabledAgents` (ids switched off),
  `agentOptions` ({id: {command, args, env}}, args split on spaces with double quotes keeping a
  part together, env one NAME=value per line), `agentPermissions` ("manual", anything else is
  Yolo), `defaultAgent` "" now means no default (Auto). An agent's own default arguments replace
  the built-in ones and the permission mode leaves them alone. Kolux's account variable wins over
  a user variable of the same name. No new no-prompt switch was added for other agents (that
  stays with T-056). Reading these fields from an old Kolux profile waits for the compat import task.

- 2026-10-09 · [accounts] T-037 · CPU is a share of the whole machine (every core), 0 to 100, so
  one busy core on this PC reads about 5 %. The status bar figure is still the main process's
  working set alone, while the Kolux row adds the WebView processes (about 500 MB against 38 MB
  here). Console host processes belong to the app's tree on Windows, so they count under Kolux,
  not under a session. A session's tree is found by parent ids (ponytail note in resources.rs).

- 2026-10-11 · [accounts] T-135 · the window checked is each provider's shortest one with a figure
  (5-hour, else weekly, else monthly), as USAGE-010 words it; a busy week behind a quiet 5 hours
  gives no line. The warning sits in the chooser's footer above Start. Dev builds expose
  `window.__koluxUsage(provider, figures)` so the live check can set 85 % and 90 %; release builds
  do not have it.

- 2026-10-11 · [accounts] T-136-a · T-136 split: -a is the usage alerts (USAGE-009) and the launch
  warning (USAGE-010, already built in T-135); -b keeps the Stats & Usage page, the analytics
  overview and the token-tracking switches (USAGE-011..013). Alerts are sent from the Rust side
  through the Tauri notification plugin (MIT/Apache-2.0). In dev builds Windows files them under
  PowerShell's name; an installed build shows Kolux RS. The master notifications switch is T-026's
  and the tray dot T-324's (noted on those lines).

- 2026-10-11 · [accounts] T-138 · DT-A3: no save-aside or mirrored copies of the system login (ACCT-017, ACCT-020 amended); managed accounts live in their own folders and a switch is one locked write, so a launch can never see a half-made change.
- 2026-10-11 · [accounts] T-138 · ACCT-018's "place the account runs": Kolux RS runs every account on this Windows install, so email + organisation decide sameness; a second runtime (WSL) would add itself to `same_account`.
- 2026-10-11 · [accounts] T-138 · the Codex personal-vs-business label goes to T-138-b: the workspace kind is only in undocumented token claims; for now each row shows its own last sign-in time.
- 2026-10-11 · [accounts] T-138 · Codex warnings: a missing sign-in file (after 30 s) is Needs sign-in, a failed sign-in check is Needs re-auth (the T-092 card said Needs sign-in for the latter; ACCT-019 names both).

- 2026-10-11 · [accounts] T-139 split: -a is ACCT-032's built-in model step (built), -b is ACCT-023 + ACCT-064 (pane account memory and the restart prompt, PTY foreground checks: HAND TO FABLE), -c is ACCT-027 (Grok's session file and credit figures need a public source); ACCT-031 moved to T-141, which builds the same `kolux account` commands (CLI-014).
- 2026-10-11 · [accounts] T-139-a · ACCT-032 over the earlier seats test: an agent with no built-in list now has no model step at all (it used to show only Program default).

- 2026-10-11 · [accounts] T-141 · DT-A4: account commands refuse every flag they do not take (environments, pairing codes and remote targets alike) instead of ignoring remote targets as CLI-014 said; spec/20-cli.md amended.
- 2026-10-11 · [accounts] T-141 · A Claude account added from the command line is not made active (as with Add Account in Settings); a Codex one is (as Settings does). The macOS Keychain restore is in T-043-d.

- [accounts] T-145-a · Tango light uses its bright yellow (#fce94f) as is, so yellow text is pale on white; a darker yellow would read better but stops being Tango. Kept the card's palette.
- [accounts] T-145-a · the terminal's light/dark answers follow the app's mode (System, Light, Dark), not the terminal background, so Match app theme and Kolux dark answer the same way.

- [accounts] T-147 · with no menu bar yet, a status bar hidden from its right-click menu comes back from Settings > Appearance > Show status bar; the View menu item waits for the menu bar (T-248).
- [accounts] T-147 · DT-A5: the bar has no agent items left to hide when an agent CLI is missing (the usage chips were retired), and its copy stays English until language packs; saved item lists drop ids this version does not have.

- [accounts] T-148-a · catalogue palettes are the schemes' own published values, unchanged; Solarized Light's bright white equals its background, so some PowerShell input colours read faint there, as they do in other terminals.
- [accounts] T-148-a · pasted schemes must be one Windows Terminal scheme object with a name and hex colours (purple/brightPurple/cursorColor accepted); a name already in the list is refused rather than replaced.

- [accounts] T-148-b · the font fields apply when a suggestion is picked, on Enter or on leaving the field, not on every keystroke (a half-typed name would flash the whole window into the fallback font).
- [accounts] T-148-b · App font and Editor font sit in the Interface section; the Editor font has no editor to draw yet (T-323), so for now it is only saved.

- [accounts] T-148-c · DT-A6: the title bar app name is off by default (DESIGN.md draws it nowhere) and the Automations button is on by default until the command palette exists; SET-020's card says shown and hidden. Confirm or flip.

- [accounts] T-148-d · DT-A7: the divider starts at 6 px with no colour and panes not in focus start undimmed; SET-023's card says 3 px and dimmed. Confirm or flip.

- [accounts] T-143: a default agent outside Claude Code, Codex and Grok also leads the dropdown (SESS-004 keeps the default first), so up to four rows show before the fold; the search box shows only when more than three agents are installed; Grok and the rest draw the plain shell glyph until T-335 brings vendor marks.

- [accounts] T-096-a: the shortcut search matches keys as a substring of the written or drawn chord with spaces and plus signs removed, so Cmd+D also finds Cmd+Down; no command sits behind a feature flag yet, so SET-008's flag rule has nothing to leave out today.

- [accounts] T-096-b: Reset takes the command out of this platform's section; when the all-platforms section still overrides it, the shipped default is written into this platform's section instead so the default really returns. Removing a command's last chord leaves it disabled (null in the file), the same as Disable. A recorded chord that clashes is still saved; the resolver drops it as SET-010 says, and the row keeps a Reset button because the file still holds the override.

- 2026-10-09 · [core] T-025-a: Kolux RS keeps its hook scripts in `~/.kolux-rs/agent-hooks` and
  adds its own entries beside the old app's in Claude's settings (DT-C1), so both apps can run
  on this PC until the old one retires; the identity header is built by Kolux into
  `KOLUX_HOOK_IDENTITY` (DT-C2). The hooks install unconditionally at every start (STAT-002's
  switch is T-120). The installer has NOT yet run against Txais's own
  `G:\Dev\claude-config\settings.json`: the auto-mode classifier refused the builder a copy of
  that file (self-modification), so the live proof used a scratch `CLAUDE_CONFIG_DIR`; the first
  launch of Kolux RS on this PC will add twelve `.kolux-rs` entries to that file (T-025-d).

- 2026-10-09 · [core] T-025-b: the Codex trust fingerprints are taken from Codex's own
  `hooks/list` answer rather than recomputed (DT-C3); the Devin skip in the Claude script is not
  built because no public source names the variable (DT-C4). The installer has NOT run against
  Txais's own `~/.codex`: the classifier refused the builder that write, so the proof used a
  scratch `CODEX_HOME`; the first launch of Kolux RS on this PC will add eight `.kolux-rs` groups
  to `~/.codex/hooks.json` and eight trust entries to `~/.codex/config.toml` (T-025-e for the
  real-session proof). A Kolux RS started from a shell that carries `CODEX_HOME` (a pane of the
  old app does) installs into that home instead, as COMPAT 3.4 says.

- 2026-10-09 · [core] T-025-c: "queued" is never produced by a hook event; it is the session queue's
  state (DT-C5). Claude's background-task list carries no truncation mark in its public shape, so
  the "partial" rule of the roster card is not built (DT-C6). The rust test
  `projects::tests::saving_a_folder_that_cannot_be_made_fails_and_keeps_the_old_one` failed once in
  three full runs (its `remove_dir_all` of the temp profile, a Windows file-lock race) and passed
  alone and on the reruns; not touched, it is not this lane's file.

- 2026-10-11 · [core] T-026-a: the notification settings live under Kolux RS's own keys,
  `notifyOnFinish` (true by default) and `quietMinutes` (10 by default); the importer task maps the
  old app's saved choices onto them (DT-C7). The desktop notification is not gated by the unread
  mark, only the toast and the mark are (one notification per event, as the card asks).

- 2026-10-11 · [core] T-026-b: the permission look is TERM-055's question mark (the card names no
  glyph), shared by blocked and waiting; a shell's header keeps Ready / Ended (code) as its words
  for the idle and stopped entries (TERM-020), the hover text says "Stopped: exit code N". No card
  or COMPAT rule contradicted, so no DECISIONS row.

- 2026-10-11 · [core] T-026-c: the Inbox's buttons read Open and Answer and open the terminal
  pane, since the Code view they are named after does not exist yet (DT-C8); a blocked agent is
  listed under needs you beside permissions and questions; the done-today stamp is the moment the
  window saw the state move, so a finish that happened before the window was open is not listed.

- 2026-10-11 · [core] T-027: deferred to T-326 (ordering, not a contradiction; no DECISIONS row).
  The Thought-row rules were copied onto the T-326 PLAN line so they are not lost.

- 2026-10-11 · [core] T-028-a: a blocked agent's chip reads Stopped (the card's word) while the
  pane header keeps the vocabulary word Blocked; STAT-022's cause text is T-039. The answer keys
  are Enter / Esc for Claude Code's dialog and y / n for Codex's approval modal, typed into the
  pane through the terminal, not a protocol; the card's file link is the file's name with the
  full path in its tooltip until an editor exists. The duration on a chip counts from the moment
  the window saw the state move. No card or COMPAT rule contradicted, so no DECISIONS row.

- 2026-10-11 · [core] T-029 and T-030: deferred to their feeders (T-098; T-082 / T-083 / T-089 /
  T-325). Ordering, not a contradiction; no DECISIONS row.

- 2026-10-11 · [core] T-003b-fix-a: the top bar is a three-column grid (left group, switcher,
  right group) instead of an absolutely centred switcher. The switcher is centred on the window
  while the right group fits in its half (at 1920 it sits at 855..1065, DESIGN.md's figure); below
  about 1540 px the right group keeps its width and the switcher moves left (70 px at the 1400
  default) instead of covering the search box. DESIGN.md section 4 notes the rule; no DECISIONS
  row (the review named this fix).

- 2026-10-12 · [core] T-010-fix: the paste rule of the paste card is now its own module,
  `src/terminal/paste.ts` (`attachPaste(textArea, paste, held)`), so the two rules the review asked
  for have a test without a browser: a paste into pane B's text area reaches B only, and a paste
  made while the opening prompt is still owed waits and goes in after it, oldest first. The
  listener is removed when the pane unmounts. Live, with two shells open, a paste event carrying
  "echo PASTED-INTO-PANE-B" dispatched into Terminal 2 landed there and Terminal 1 stayed at its
  prompt (`evidence/T-010-fix-paste.png`). A real Ctrl+V from the keyboard is Txais's by-hand
  check: the driver cannot put text on the system clipboard. No DECISIONS row.

- 2026-10-12 · [core] T-013-fix-a: with no project yet, Mod+N and the sidebar's New workspace
  button open the add-project form instead of a name field that can only say "Add a project
  first." (`createOpens()` in `src/projects/model.ts`, tested); with a project the name field opens
  as before. Proved on a fresh state folder: Ctrl+N on the empty sidebar showed the Add project
  form (`evidence/T-013-fix-a-no-project.png`). That reads the create-workspace card's "works even
  before any project exists" as a door to adding the project, so no DECISIONS row. The two rules
  T-013 left out, the overtaken create and the stand-in tab, now have an owner, T-013-c.

- 2026-10-12 · [core] T-013-fix-b: `safe_name()` no longer drops an emoji it has no word for.
  The fourteen table emoji keep their short word; any other symbol becomes its Unicode name in
  lowercase words (crate `unicode_names2` 4.0.0, MIT / Apache-2.0 and Unicode-DFS-2016, both on
  the deny.toml allow list), so a joined emoji names each of its parts: "ship it 🧑‍💻" cleans
  to ship-it-adult-personal-computer. Joiners, variation selectors, emoji tags, skin tones and
  combining marks say nothing (`silent()`), so a thumbs-up with a skin tone is thumbs-up-sign
  and a decomposed é keeps its e. That is a Unicode name, not a shortcode, for emoji outside the
  table: DT-C9. The pane header now shows the name exactly as typed: `ProjectsPanel` hands the
  window a folder-to-typed-name map beside the owner map, `nameOf()` in `src/workspaces.ts`
  (tested) looks a pane's folder up by content, and `App.tsx` passes it as the pane's title when
  no job title is set. Proved live: typing "Ship it 🧑‍💻" previewed branch
  ship-it-adult-personal-computer (`evidence/T-013-fix-b-preview.png`), and the created
  workspace's pane header, sidebar row and branch chip read "Ship it 🧑‍💻" over that branch
  (`-header.png`). The tab strip keeps its program word (TERM-040). The projects test that
  removes its temp folder no longer panics when Windows still holds the store file for a moment
  (it flaked once in T-025-c and once here).

- 2026-10-12 · [core] T-003b-fix-b: DESIGN.md names the two additions the look got in T-003b:
  section 6 the strip's "+ New tab" button (86 x 28 at x 1302..1388 in a 1400 px window, 12 px
  from the right edge, the layout group's border and type) and section 7 the pane header's split
  button (between Expand and "+", 24 px hit target). In the tab strip a browser tab now shows the
  globe where a terminal tab shows its program's mark (`App.tsx`). The native web view cannot be
  clipped by the pane's rounded corners, so `.pane.browser .pane-body` keeps a 1 px side margin
  and a 12 px bottom margin: the ring and the bottom curve stay visible around the page
  (`styles.css`; the web view follows the body's rect as before). Proved live with a shell and a
  browser tab in one cell (`evidence/T-003b-fix-b-browser.png`: globe on the New Tab tab, the
  page 1 px inside the ring and 13 px above the pane's bottom edge). Nothing pure to unit-test;
  the capture is the check. The projects test flake has its real cause: two tests shared the
  temp folder "profile4" and wiped each other when run in parallel; the second now has its own,
  and the full suite passed three runs in a row. No DECISIONS row.

- 2026-10-12 · [core] T-007-a-fix: the installed-agent scan starts from the search path a fresh
  shell would get, not from this process's PATH. On Windows `shell_path_dirs()` in `agents.rs`
  reads the machine Path (HKLM Session Manager\Environment) then the user Path (HKCU Environment)
  with `RegGetValueW` asking for a plain string, which expands `%SystemRoot%` and the like on the
  way out; a read that fails gives nothing and the process PATH stands alone. `search_dirs()` is
  shell path, then process PATH, then the usual install folders, each folder once as before. The
  `windows-sys` crate already in the tree got its `Win32_System_Registry` feature; no new crate.
  The test reads the real machine Path and checks it holds `system32` with no `%` left, that a
  missing value reads as `None`, and that every existing shell-path folder is among the walked
  ones. On macOS and Linux the shell's path is not read (a login shell would have to be spawned):
  the process PATH plus the install folders stand for it, recorded as DT-C10.

- 2026-10-12 · [core] T-008-b-fix: the foreground half of the start-line card is closed by a
  decision, not a poll (DT-C11). An agent Kolux starts is the pane's own program (`pty.rs`
  `program_command`, no shell in between), so the pane is credited to it from `terminal_spawn`
  until `terminal-exit`: exact, free, and already what the header, tab mark and account
  variables go by. An agent typed into a shell pane is credited by its hooks when it has them
  (the shell's children inherit `KOLUX_PANE_KEY`, T-025), and not at all when it has none; a
  process-tree poll with command-line reads is what that last case would cost, and nothing
  shown today depends on it. The command-line matcher is not orphaned any more: the account and
  key variables of a new pane call it (`claude_accounts`, `claude_key`, `codex_accounts`), so
  its stale "first caller is the poll" note and dead-code attribute went. No behaviour change,
  no new test.

- 2026-10-12 · [core] T-012-b-fix: chords pressed inside a browser page reach the app. Pages get
  no Tauri capability (by design), so the channel is a navigation: `browser.rs` gives every tab
  an initialization script (main frame only) that catches Mod+L, Alt+Left / Alt+Right (Mod+[ /
  Mod+] on a Mac), Mod+R and mouse buttons 4 and 5 on the way down, stops the web view's own
  handling, and calls `location.assign("kolux-chord:<action>")`; the tab's `on_navigation`
  handler recognises the four actions, emits `browser-chord` {id, what} and cancels the
  navigation (nothing reaches the network or the OS; a cancelled navigation never starts a
  page load, so the history stays untouched). For Mod+L the back end also hands the keyboard
  to the app's web view. `App.tsx` runs the same `browserAction` for a forwarded chord as for
  one pressed in the app, for the tab that sent it, and makes that split the focused one (a
  click into a page never reaches the app, so its focus could be stale). The toolbar history
  moved to `src/browser/history.ts` (`started`, `can`): a load with nothing asked that lands on
  the neighbouring entry is the page's own back or forward and moves the cursor instead of
  adding an entry. Proved live on the lane app with example.com and iana.org: Alt+Left in the
  page went back with back and forward both lit, Alt+Right went forward, the mouse back button
  went back, Ctrl+L put the cursor in the address bar with the text selected, no dialog
  appeared (`evidence/T-012-b-fix-chords.png`). Tests: `chord_of` and the script's contents in
  Rust; `history.test.ts` for the entries. Still open: a page's `pushState` and app chords
  such as Ctrl+T / Ctrl+W pressed inside a page (not browser-scope; they stay with the page).

- 2026-10-12 · [core] T-014-b-fix: `kolux-dev worktree create` stops refusing a prompt with no
  agent named. The app picks the agent the way the first-prompt card says: the settings' default
  agent when it is installed, else the first installed one in catalogue order (`fallback_agent`
  in `cli.rs`, sharing `default_agent` with the worker start); with no agent installed the call
  fails and says so; a create with neither prompt nor agent still makes a bare worktree with no
  agent tab. The flags nobody acts on yet are named instead of swallowed: `--setup run`,
  `--run-hooks` (on create and rm) and `--comment` each add a sentence to a `warnings` list in
  the result, and `main` prints every one as `warning: ...` on stderr whether or not `--json`
  was asked, so a script that counts on setup scripts learns they did not run. `issue:` is a
  working worktree selector now (it reads the issue number recorded with the worktree's origin;
  `projects::origin` is public for it). `identity:` and `active` stay refused, with the accepted
  forms listed, by DT-C12. Tests: the parse test accepts the prompt alone; the create-and-remove
  test checks the fallback agent against the real catalogue, the three warnings, `issue:12`,
  `issue:99` not found, and the two refusals. No live proof: the CLI has no window part.

- 2026-10-12 · [core] T-039-a: a Claude Code session that halts says why. The StopFailure hook's
  `error` becomes a cause (`hooks::stop_cause`: rate_limit is `limit`; authentication_failed,
  oauth_org_not_allowed and verification_required are `signin`; everything else `error`) and
  `error_details` rides along; `status.rs` keeps a `Stop { cause, detail, resetsAt }` on the
  session while it is blocked, ignores further failure reports in the same episode (one history
  line), drops it when a turn reaches done or a session boundary passes, and reads a failure after
  a Kolux cancel as interrupted and one with no error as nothing. The Board chip's second line
  and the pane header's tooltip read `Limit reached · 5-hour limit` (`stopLine` in
  `terminal/notify.ts`, shared by `board/chip.ts` and `TerminalPane`). The stopped notification
  says `stopped: limit reached` with the reset time or the details, once per episode (the state
  does not change on the second report), behind a new 'Agent Stopped' switch (`notifyOnStopped`,
  default on) separate from 'Agent Task Complete'. A sign-in stop calls `claude_account_check`
  once so the existing main-window SignInNotice shows the lapsed account (STAT-046). `resetsAt`
  is always empty until T-039-b reads the status line. Kimi and Codex report no cause (DT-C13).
  Live: posted a rate_limit StopFailure to the lane app's hook endpoint for the Claude pane; the
  Board card read Stopped / Limit reached · 5-hour limit and the header tooltip the same
  (`evidence/T-039-a-stopped.png`). Not live-proven: the desktop notification and the sign-in
  recheck (no lapsed account to hand).

- 2026-10-12 · [core] T-039-b: Claude Code's status line feeds Kolux. At start the hook installer
  also takes the `statusLine` slot in Claude's settings (`hooks::install_claude_status`, padding
  and the rest of the object kept) with a bash command that saves the report to a temp file,
  posts it through `~/.kolux-rs/agent-hooks/claude-status.cmd` to the endpoint's new
  `/claude-status` route, then runs the status line the user had (written once to
  `claude-status-prev.sh`, run only when that file exists) from the same file, so whatever they
  had keeps drawing; a stale Kolux command from another home is replaced, not chained. The route
  checks the token (403) and the pane identity (400), reads `context_window.used_percentage`
  (else input tokens over window size) and the `rate_limits` windows (kind, percent used, reset
  as ISO stamp or seconds/ms, kept as ms), writes the windows to kv `claudeRateLimits`, and when
  a window is used up writes when it lifts to kv `claudeUsageLimitResetsAt` and raises
  `claude-key` so the Claude card re-reads. The top-bar pill (`usage/ClaudePill.tsx`) shows
  "Claude N% left" from a used-up window first, else the weekly one, else the 5-hour one, from
  the last report at start (`claude_usage`) and each `claude-usage` event after; hovering lists
  each window with its reset time. The pane header's gauge draws the pane's context fill as an
  arc with the figure. A limit stop now carries the reset time (`status::LIMIT_RESETS_AT`) when
  it is still ahead, so the tooltip, chip and notification say "resets at …". Live: posted a
  report for the Claude pane → pill "Claude 63% left", hover with both windows' reset times,
  gauge 42% (`evidence/T-039-b-usage.png`); wrong token → 403, figures unchanged; a used-up
  5-hour window plus a rate_limit StopFailure → header "Limit reached · resets at 1:48 AM", kv
  both keys written, Settings' Claude card "It can be used again at 1:48 AM". Not live-proven:
  a real Claude Code session driving the command (the pane's Claude Code read the real user
  settings, not the scratch ones, as in T-025-a), and the chained previous status line.

- 2026-10-12 · [core] T-040-a: the usage meters. The status-line route now keeps the context
  reading in tokens (`Usage.contextTokens`/`contextWindow`: the stated total, else input plus
  cache writes plus cache reads from `current_usage`, else the stated percentage applied to the
  window) and `src/usage/meter.ts` works the figures out: `contextFill` against the 200k cap
  (always on until T-041 wires the USAGE-006 switch through its argument), else the model's own
  window, past full reads 100, a zero window 0; `shortTokens` (84k, 1.3M); `planOf` gives a
  Claude pane the Claude account's 5-hour and weekly percentages and a Codex pane Codex's, nothing
  for other agents or a failed read; `meterOf`/`meterText` build the card meter and its hover
  text. The two top-bar pills publish what they read into `src/usage/plan.ts` (a tiny external
  store) so the Board needs no second read. `src/usage/Ring.tsx` is the ring: track and arc, no
  number, coloured `warn` at 70% and `danger` past 90% (new theme token `danger` #e5484d, not
  measured); the pane header's gauge uses it with the figure, and agent tabs show it at 10 px with
  the meter words as its title. On the Board a card gets `.meter` under the chip row: the bar
  (width = fill, same colours), `84k / 200k`, and `5-hour 38% · Weekly 63%`; the bar only after a
  reading, plan figures without one, no meter with neither (shells and browser tabs never get
  one). Live: posted two reports (84k of 200k with both windows; 190k of 1M through
  `current_usage`) → tab rings plain and red with hover text, header gauges 42% and 95% red, Board
  cards with bars, token counts and plan lines, the shell card bare (`evidence/T-040-a-meter.png`).
  Not built here: the Agents view rings, footer and usage line (T-040-b, needs T-050 and T-263).

- 2026-10-12 · [core] T-041-a: the 200k cap, the weekly pill, and safer Claude figures. `cap.rs`
  holds the setting (`contextCap200k`, never saved = on, switch on the new Settings > Agents page)
  and `apply`, run by `terminal_spawn` on the start line and environment it hands the PTY, so the
  pane's saved start line never carries the cap and a rerun adds it exactly once: a program
  credited as Claude gets `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` unless Kolux's own environment
  already names it (any case) or `--autocompact` is on the line; one credited as Codex gets
  `-c model_context_window=200000 -c model_auto_compact_token_limit=180000` ahead of any `--`
  unless its arguments already name either key, `--profile`/`-p` or `--oss`; everything else is
  untouched and no agent's file is written. The meters (`contextFill`, `meterOf`) now take the
  switch from settings. The top-right pill follows USAGE-008/VIEW-008: a `<span>` (the click that
  opened Settings is gone; Ctrl+, does that), one part per provider with the weekly window alone,
  only while that CLI is installed and a weekly figure is known (Codex's refused sign-in still
  shows), tinted on the 70/90 scale of used, hovering `Weekly limit: N% left, resets in 2d 4h` or
  `reset time unknown` (a past reset time reads `resets now`); with nothing to show the pill is
  hidden. USAGE-021's status-line part: the status script sends `X-Kolux-Config:
  %CLAUDE_CONFIG_DIR%`, a report from a folder other than the active account's (or from a managed
  folder while the default sign-in is active) is dropped, and a report carrying one window is
  merged over the stored windows so the other stays. Live in the lane app: a Codex pane opened with
  the cap on runs `codex.cmd --dangerously-bypass-approvals-and-sandbox -c
  model_context_window=200000 -c model_auto_compact_token_limit=180000` (Win32_Process command
  line, parent the app), one opened after switching the cap off on Settings > Agents runs without
  the overrides, and the switch writes `contextCap200k` to settings.json both ways; Claude's
  variable is covered by the unit test only (a process's environment is not readable from outside).
  Posted status-line reports: weekly 85% used → pill `Claude 15% left` yellow, hover `Weekly
  limit: 15% left, resets in 2d 4h`; a five-hour-only report leaves it; one with
  `X-Kolux-Config: C:/somewhere/else` is dropped; 95% → red (`evidence/T-041-a-cap.png`). Not
  built: the provider's usage service and the hidden-terminal usage screen (DT-C14), the
  status-bar usage item switch (item list is T-148), the resume after a limit (T-041-b).

- 2026-10-12 · [core] T-041-b: resume after a limit (USAGE-007). New `resume.rs`: `pick_reset`
  takes the stop's own time, else the used-up weekly window, else the used-up 5-hour window (past
  or not-used-up ignored, a used-up weekly without a time never swapped); `Resumes` keeps one wait
  per pane, fires it once per reset time (times a minute apart count as one) a minute after the
  reset, only when the pane's foreground is the `claude` program Kolux started (`Terminals::program`
  from the spawn's credited agent), expires it when a shell or another program is in front or the
  terminal is gone, keeps waiting while the foreground cannot be told up to half an hour past the
  due time, and persists the waits under kv `claudeResumeWaiting` so a restart restores them with a
  two-minute settle and past resets skipped. `hooks.rs` schedules from every reported status whose
  stop is a limit; `terminal_write` cancels the pane's wait on the user's own keystrokes;
  `save_settings` clears on off and picks up blocked panes on on; a 15-second thread in `lib.rs`
  types the prompt (`Terminals::write`) and logs a refusal once to `logs/kolux.log`. Live in the
  lane app with a real Claude Code pane (a `/` pasted into its input first, so the typed line
  became an unknown slash command and no request went out): switch on, a posted weekly-100%
  report with a reset 75 s ahead plus a `StopFailure rate_limit` event → kv held the wait, and
  about 2.5 min after the post Claude Code showed `Unknown command: /The ... Args from unknown
  skill: usage limit has reset. Please continue where you left off.`, the wait gone; a second
  reset with a keystroke pasted into the pane after the stop → the wait dropped at once; a third
  reset with the pane closed → the wait dropped at its due time (`evidence/T-041-b-resume.png`). The rest of T-045's card (panels list only the view's
  accounts) is moot: one active Claude account per window.

- 2026-10-12 · [core] T-042-b: decision only, no code. The rest of the Codex-figures card
  (USAGE-022) named three routes; two are dropped in DECISIONS §7 DT-C15: Codex's own usage
  service (address, request and reply are not public documentation; the clean-room rule forbids
  learning them from the old app) and the status screen in a hidden terminal (Codex's interactive
  `/status` card: it needs a session open, which the card's own title rules out, its layout is
  undocumented and would have to be scraped, and it is drawn from the same rate-limit snapshots the
  app-server `account/rateLimits/read` call returns). The two rules that take the 5-hour figure or
  the reset-credit count "from the service" are therefore moot: `codex_usage.rs` already reads both
  windows and `rateLimitResetCredits.availableCount` from the background process. Card amended;
  its acceptance boxes stay as T-042-a left them. Gates re-run clean.

- 2026-10-12 · [core] T-043-d: the sign-in upkeep switch (ACCT-006). `ClaudeAccounts.tsx` shows
  "Leave sign-in upkeep to Claude Code" under the managed accounts once one exists, bound to
  settings field `claudeSignInUpkeepByClaudeCode` (absent = on, OD-01/DT-A2); switching it off
  saves the field and calls `claude_account_check` (ACCT-012, `claude auth status --json` in the
  account's folder, hidden, 20-s limit) so a lapsed account is flagged straight away; on hides the
  Needs sign-in chip and the main-window notice (the chip now follows the switch too). Kolux-side
  renewal is not built (DECISIONS §7 DT-C16): Anthropic's token service is not public
  documentation and the clean-room rule forbids learning it; Claude Code refreshes its own sign-in
  in every pane. The macOS keychain rules of the managed-account card go to T-043-e (needs a Mac).
  Live in the lane app with a stand-in account row seeded into the lane profile's kv (config
  folder that never signed in): switch on → no chip, no notice; off → settings file `false`, the
  check ran, the row went `stale`, chip "Needs sign-in" and the notice "Claude account
  fake@example.test is no longer signed in" appeared; on → both hidden, file `true`; off again →
  flagged within 12 s (`evidence/T-043-d-upkeep.png`). The very first check in a never-used
  folder did not flag the row: Claude Code's first run there took longer than the 20-s limit, so
  the account stayed as it was until the next check. Seed row, folder and setting removed after.

- 2026-10-12 · [core] T-017-c: decision only, no code beyond a comment. Pre-trust for Cursor and
  Copilot (the rest of the pre-trust card) is dropped in DECISIONS §7 DT-C17: Copilot's public
  technical reference lists `~/.copilot/config.json` as "internal state" and documents no
  trusted-folder key; Cursor's CLI reference documents `--trust` as "headless mode only" and the
  changelog says a trust decision is "saved" without saying where; Cursor's editor docs describe
  workspace trust (off by default) but not its storage. The clean-room rule forbids learning
  either shape from the old app. `trust_folders` keeps returning 0 for both agents, the launch
  proceeds, and the agent's own trust prompt, when it appears, is the user's to answer; a pasted
  starting prompt may then be swallowed, which is the card's stated risk. Gates re-run clean.

- 2026-10-12 · [core] T-018-c: the Source Control bulk bar (the rest of GIT-002). `model.ts` gained
  `rowOrder` (conflicts, staged, changes, untracked, each path once), `select` (plain click keeps
  one row and clears it when it was the only one, Ctrl/Cmd toggles, Shift spans from the anchor in
  list order, rows no longer listed drop out) and `bulk` (which of the selected rows Stage and
  Unstage each cover); the panel marks rows `aria-selected`, shows the bar above the list while
  anything is selected (`N selected`, `Stage k`, `Unstage m`, a close button; Esc clears), and
  each button sends its rows to the existing `scm_stage` in one call. Six model tests first failed
  (`select is not a function`), then passed; tsc 0. Live in the lane app on the proof worktree with
  one staged and three untracked files: click + two Ctrl-clicks read "3 selected · Stage 2 ·
  Unstage 1" (`evidence/T-018-c-bulk.png`); Stage 2 left `git status` with three `A` rows and the
  bar at Stage 0 · Unstage 3; a Shift-click spanned all four rows; Esc emptied the bar; Unstage 3
  put all four back to untracked. One fix during the proof: three clicks fired in the same tick
  each read the stale selection, so the updater now takes the previous state. Proof files removed.

- [accounts] T-138-b · ACCT-019's personal/business label is a name the user gives (Name / Rename on the row, up to 40 characters, kept across Sign in again), not read from the sign-in: the workspace kind sits in token claims OpenAI does not document. Two unnamed rows on one email ask to be named. Confirm, or point at a public source for the claim.

- [accounts] T-146-a · VIEW-056 says the right sidebar is open by default; that replaces DT-R17's "explorer closed at start" for a first run. With no workspace open it shows "Open a workspace to browse its files."
- [accounts] T-146-a · the tabs are short words (Explorer, Source Control), not icons, until more tabs arrive with T-146-b; the width is at least 240 px and always leaves the workspace 400 px.

- [accounts] T-153-a · closing a tab with a running program (TERM-045) used to open with Close tab focused; it now opens with Cancel focused, as VIEW-116 asks, and Enter closes the tab only after Tab moves focus to Close tab.
- [accounts] T-153-c · VIEW-054 needs a click-through of the installed app (DT-37) that the clean-room rule bars the builder from; Txais does it, then T-153-c is built or marked SKIPPED.

- [accounts] T-154-a · ACCT-010 says to reconnect on "Settings, then AI connections"; the page is titled Accounts & keys in this build, so the note says Settings › Accounts & keys. Only the unreadable key is cleared: the key mode and its date stay, so the card shows Not connected until a new key is made.

- [accounts] T-157 · SAFE-026 vs ACCT-009 off Windows: DT-A8. On Windows a save while the secret store is down fails and writes nothing; macOS and Linux keep the scramble with its log line until a keyring is chosen there.

- [accounts] T-200 · The dialog's Browse choice is worded Open a folder… (clearer than Browse for a non-coder); the Clone and New project steps exist now with a plain not-built-yet line and a disabled Clone button until T-214 builds them.

- [accounts] T-201-a · SESS-017's "AI connections" is the Settings › Accounts & keys page; the AI choice stays one native radio group (one tab stop), with Set up, Docs and More agents as their own links beside it; docs links for agents other than Claude Code and Codex wait for T-201-b.

- [accounts] T-209-a · Plain words chosen: clone = Copy from a web address, repository = project, worktree = workspace, main checkout = main folder, shell = terminal, CLI = program, PTY = terminal; the sidebar's pointer to the Settings page Git & worktrees now reads the Git page in Settings (the Settings list is not a newcomer path, so its page name stays). The scan reads the source of each in-scope file (all states at once) instead of rendering one state.

- [accounts] T-210-a · The saved value is a BCP-47 tag in settings field `language`: system, en, zh-CN, ko, ja, es or fr; anything else reads as system. English keeps Kolux's own short relative-time words (3h ago); other languages use the platform's relative-time wording. Mapping the old app's saved language names onto these tags (SET 017 Compat) is the settings importer's job.

- [accounts] T-211 · The landing screen is the main Terminals screen with no Settings or Automations page open (the app opens a terminal straight away, so the empty state is rarely seen); the notices sit at its top beside the other main-window notices. "Agent CLIs are missing" is read as no AI program from the catalogue being installed at all. A probe that hangs past 6 s reads as unknown and shows no notice (gh's sign-in check can be slow offline), except glab, whose failed or hung version check counts as not installed; GitLab's notice follows the GitHub rule (only once a project with a GitLab remote exists). Every notice's dismissal is recorded under the GitHub project set, so Git's and the AI-program notice also come back when that set changes. Without Git the app now starts (Git::detect no longer stops the launch) and each Git action fails with its own error.

- [accounts] T-136-b · Token tracking for a provider is off until turned on; a profile with saved results but no recorded choice counts as on and is rescanned on opening. "Served from cache" is cache reads over all input (fresh + cache reads + cache writes). Codex's cached input is taken as part of its input count, so fresh input is input minus cached; Codex cache writes stay inside fresh input (OpenAI bills them as input). A Claude reply counts once by message id, the last piece written winning; a Codex token event counts its own last-turn figures and only when the running total moved. The days are local days (system time zone). A missing log folder is a failed scan: saved figures stay with a plain warning, and with no saved figures the empty state shows. The provider picker leaves Grok out until its credits panel (T-137-b).

- [accounts] T-137-a · Prices come from the public pages read 2026-10-12 (platform.claude.com pricing; developers.openai.com pricing, Standard tier) and live in `src/usage/pricing.ts` as dated entries; a later price change adds an entry with its first day. Kolux scope counts a log record when its working folder is a registered project's folder, that project's own workspaces folder or the global workspaces folder (no git call per open). A model is matched after dropping a provider prefix, a context tag such as [1m], a release date and an effort ending (low / medium / high / xhigh / max / minimal / none); "-codex" and "-max" variants then fall back to their base model (gpt-5.1-codex-max to gpt-5.1) and are labelled inferred, and an unknown release takes the nearest known release of its family at or below it, so a newer point release gets the family's current price and an older one never a newer price. A bare alias (opus, sonnet[1m]) takes its tier's newest price, inferred. The current Anthropic page lists no long-context surcharge for any model but Haiku 5.5 (prompts over 100k), so none is charged; OpenAI's long-context prices apply to prompts over 272k, a new fourth prompt-size band in the scan. A model whose page shows no cached price (the pro models) pays the full input price for cached input. Codex cache writes stay inside fresh input at the input price; OpenAI's newest models list a cache-write price 1.25x input, so their estimates can run slightly low. Charts of more than a year draw one bar per week.

- [accounts] T-206 · Move to and Restart show on any stopped kit row (the usage-limit and sign-in states are not in the window yet, T-206-b); both need the run's first messages, which only the window that started the run holds, so after a restart they say to start the kit again. A declared file that is a link, or any path that leaves the role's folder, counts as missing and is never copied. The run history lives in the app store (kv kit_history, newest 50) and in each folder's run record; a record over 256 KB or that does not parse is ignored. Results.html is a standalone page with a no-scripts content policy; Markdown is rendered with pulldown-cmark with raw HTML shown as text. The embedded browser hides while the kits window is open (it drew over it), and the gallery closes before its own error toasts so they can be read.

- [accounts] T-207 · The wizard record is kv `onboarding` {version 7, step = last screen finished (-1 none), closedAt, outcome completed|dismissed}; only start one with no record writes it, so older profiles never see the wizard (the migration of older progress is T-208); a close is final. The wizard opens after the last finished screen. Connected means: Claude's key card connected or about to run out, Codex's card connected, Grok's card connected. Start kit launches straight away only when the open workspace is that kit's own sample folder (which fills every input) and an AI is installed; any other case opens the setup dialog, and a start from there closes the wizard as completed. Just open a session takes the default agent first, else the first installed one that is not switched off, in the open workspace with no branch. The corner close button closes as dismissed with no question for now (ONB 006's ask is T-208). Ctrl+Enter still fires from a checkbox, radio or button, since those take no typing.

- [accounts] T-208 · The corner close asks the same question as Escape and a click outside. Escape or a click outside while the question shows answers No, keep going (it never opens a second copy). The question names the help menu's Onboarding item as ONB 006 and DT-25 say; that item arrives with T-298 (ONB 009). A failed close store keeps the wizard and the close: whichever way out is clicked next (Start kit, Just open a session, Pick a folder, Skip) retries that close and does not repeat its own action, so a kit is never started twice. On start, a record from an older version gets version 7, its step held to -1..3 and a close time when it has an outcome but none; fields Kolux RS does not read yet (checklist ticks, milestones) are kept. ONB 010 is armed by Pick a folder, or by Skip while the project list is empty (a sample opened from the wizard is a project, so it disarms); it lives in the window only, so a relaunch disarms it; the saved default agent starts only when it is installed and not switched off, Auto starts nothing and a plain terminal is what the new workspace opens anyway.

- [accounts] T-201-b · SESS 019's older launch dialog is the chooser pane (SESS 007), the only launch surface until T-046 builds the new look's page. A chosen kit replaces the seat list and the shared task box with its roles, because a kit's prompts come from its own setup; Advanced can still be unfolded with a kit chosen, under a line saying it applies once the kit is cleared, and choosing a kit again folds it. The kit row is a toggle: the pressed kit clicked again clears it. Set up kit opens the kit's setup dialog (inputs come from there, SKILL-004) and is disabled while a role has no AI; the chooser closes only when that kit really starts. The footer count reads "N sessions" plus, for the first unfinished seat, "still needs an AI" or "still needs a model". Every child row of the chooser keeps its height (no squashed task box when the pane is short).

- [accounts] T-153-b · End skips its question only when a fresh read no longer lists the session; a failed read asks. Kolux RS sessions belong to the panes that opened them and end with the window, so the card's "nothing shown attached until the window has loaded its workspaces" and "sessions no window owns" only apply once T-067's background host exists (T-153-e). The per-row End stays the user's own explicit choice for every session, agent-owned ones included; the never-offered rule is about Manage Sessions' cleanup (T-153-e).

- [accounts] T-154-b · The fence (fence.rs) covers file_read, file_write, dir_list, file_list, md_list, md_new, diff_sides, diff_image, git_changes and change_entries. Roots are the stored projects, then, on a miss, every worktree Git lists for them (re-read at most every 3 s). Every path is resolved through its links before the check, a path that does not exist yet through its folder; the command then uses the caller's own spelling. A network share, a drive root and a folder are never a root or a grant. Picked files are granted exactly, newest 100 kept, in memory only for now (a restored tab for a picked file is refused after a restart; T-154-c). Open a file moved from the window's dialog to a Kolux command (file_pick) so the window cannot grant itself a file; the other pickers (project folders, kit inputs, artifacts) still use the window's dialog, since they grant nothing. A project added at a drive root gives no file access, by the card's drive-root rule.

- [accounts] T-171 · ACCT-014: the backup check runs on the connection grid (ConnectGrid) only, so it runs only while that page is open; it re-reads agent detection and install state, and a changed detection result is sent to every window as agents-changed. Account cards are not re-checked every 5 s, since a Claude account check starts a program per account (T-171-b covers their focus refresh). ACCT-024: the sign-in variables are ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN and CLAUDE_CODE_OAUTH_TOKEN; terminal_spawn became an async command so the Codex wait (re-reading the active account every 100 ms) does not hold up the window; when the account changed during the wait and the new one also has no sign-in, the pane is refused with "Open it again".

- [accounts] T-170 · USAGE-016/017: files are read oldest first (creation time, then change time, then path) and a reply (Claude message id) or token event (Codex time plus running total) held by several files counts for the first; the per-file memory (size and change time) lives in memory only, so the first scan after a restart reads every file once (T-170-b keeps it across restarts). The saved results carry a format mark (2) and anything else is thrown away and rescanned. The computer's own Codex folder is always <user folder>/.codex/sessions, whatever CODEX_HOME says; a managed home counts only when its resolved sessions folder lies inside <app data>/codex-accounts. Worktree credit (Kolux scope) now works out "." and ".." before comparing, so a path that climbs out of a worktree gets no credit.

- [accounts] T-136-c · USAGE-011: an agent turn starts when a pane's hook-fed state becomes working from no open turn and ends on done or interrupted (a SessionStart reads done), or when its terminal ends; waiting, permission and blocked close the working stretch without ending the turn. Counting runs in the app's back end from the hook events, so a window reload or reconnect restates nothing. Counts live under the store key activityCounts, saved every 5 s when changed and once at quit after open turns are closed; a batched save never follows the one at quit. The page keeps its Settings name Usage (SET-006 lists it so), and the palette's Settings entries already take "usage" straight there. The invitation is text only, pointing at New session, since no window event opens the new-session chooser.

- [accounts] T-137-b / T-139-c · 2026-10-12 source check: xAI's public Grok Build docs (docs.x.ai/build/cli/reference, docs.x.ai/build/features/status-line) document no usage, credit or allowance figures and no session-file format; the status-line input names only model.display_name, context_window.used_percentage, workspace.branch and cwd, and its built-in cost item has no documented field. The credits commands found elsewhere come from third-party tools, not xAI. Both tasks stay open until xAI publishes a source; nothing was built.

- [accounts] T-339 · One field per window item: `automationsButton` (SET-020, on by default per DT-A6) is also VIEW-011's title-bar button, so `titleBarAutomations` and the Title bar card are gone; a saved `titleBarAutomations` is ignored. The notification kind switches keep `notifyOnFinish` and `notifyOnStopped` (the Notifications card's own switches); `notifyUsage` is dropped as the Usage alerts section is that switch. Claude's launch figures are its five_hour and seven_day limits, published from the same read as the top-bar pill. The CLI reset summary keeps its counts and adds what went and what stayed: tasks clears tasks, workers and gates and keeps Runs and mail; messages clears the mail and delivery positions and keeps Runs and tasks; all clears everything and ids keep counting up. The Codex accounts list was not moved by T-138 or T-138-b (it is still inside the Codex card); moving it is T-138-c.

- [accounts] T-171-b · ACCT-014: Kolux RS never remembers an agent's version and agents.rs reads the program path fresh on every search, so "Check again" has nothing to forget: it sends the window event kolux-check-again (the grid re-runs agent and install detection, every card re-reads) and then does the card's Cancel, which wipes the stale note (claude_account_cancel now does so too when idle, like Codex's). The account cards use liveCheck with no timer (focus and Check again only); the Claude key card's re-read can ask Claude Code for its own sign-in, as it already did on opening the page. ACCT-021: the copy is the user's config.toml (CODEX_HOME, else ~/.codex) with Kolux's cli_auth_credentials_store line and the home's own projects and hooks tables put back over it (the home's entry wins); it runs before every managed Codex launch, so later edits are picked up; the file is read again just before the atomic write and the copy redone up to three times if Codex changed it meanwhile. A missing settings file is warned about too, as the card rule asks. ACCT-025: settings need no quit step, since every change is written to disk when it is made; the quit step re-seals each live sign-in file whose sealed copy no longer matches.
- [council-fable] T-542 · `pnpm smoke` is the behaviour check for merges and for structural moves of App.tsx or lib.rs: scripts/evidence/smoke.mjs launches this checkout's dev app with identifier `com.txaisxiong.kolux-rs.smoke` (profile wiped first, `confirmCloseRunning` false), vite 1431 and CDP 9240 by default, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` under a temp folder so the real agent configuration is never touched, then drives four flows through `window.__TAURI_INTERNALS__.invoke` and the DOM and ends with one PASS or FAIL line each and exit 1 on any FAIL. Proved 2026-10-13: 4/4 PASS in 1 min 20 s on a warm build; a deliberate wrong path in flow 2 gave FAIL and exit 1. Findings for whoever builds the next flow: the Explorer reads the tree once per open (a file created after the project was added is not listed), the native `File…` picker and the Windows close confirm are not drivable, the workspace-less "Terminal 1" pane stays in a zero-width cell so pane counts must filter on `offsetParent`, and `src/terminal/notify.test.ts` (STAT-022 reset-time wording) fails in the full `pnpm test` run at e3a44e5 with nothing of this task applied while passing alone.
- [council-fable] T-542-b · `pnpm smoke` flow 5 "quit and come back": with 2 shells, the Claude stand-in and needsStrip=false live it snapshots the app pid's descendant tree, closes the window over CDP (never taskkill) and reports every survivor by name; relaunches the same profile (`src-tauri/target/.../kolux-rs.exe` straight, vite restarted only if 1431 stopped serving) and checks settings.json is byte-identical, the setting holds, every restored shell echoes a marker and the Claude pane is back; then 10 relaunches with 12 saved shell panes, counting shells shown, stalled PTYs (ThreadCount <= 1 at 15 s) and survivors per close. Flow 5 is tagged [report-only] and left out of the exit code until PLAN.md ticks T-184 (regex on this checkout's PLAN.md, no hash hardcoded; `--require-quit` forces it on). Run on 2e2e24d: 4/4 required flows, flow 5 PASS report-only (17-process tree, 0 survivors, byte-identical settings, 2/2 shells restored, 12x10 shells, 0 stalled, 0 survivors in 11 closes); deliberate break of the flow-4 hook-file check gave FAIL + exit 1. Launch now also seeds `agentStatusHooks: true` in the smoke profile. evidence/T-542-b.txt.

- [accounts] T-170-b · USAGE-016: the lookup is a `--usage` switch on `worktree show` and `worktree current` (COMPAT lists `worktree current [--json]`; the default output is unchanged), so a run asks with the command it already has; it rescans only providers whose tracking is on (USAGE-012 opt-in) and a provider not tracked shows {tracked:false}. A worktree nested inside the asked one keeps its own figures. The scan memory is a JSON file per provider in the profile (token-scan-claude.json / token-scan-codex.json, with the results' format mark, ignored when damaged or older), not a kv row, since it holds one entry per reply; it is written only when a log file was read or went. ponytail: the whole memory is rewritten on such a scan; write per-file entries if it grows slow.

- [accounts] T-154-c · ACCT-055: every Explorer file command takes each path through the fence (exact=false: projects and worktrees; a picked-file grant opens that file to read and save, not to rename, trash or move). A refusal fails the whole call (trash, restore, move), except a copy, where each outside source is refused on its own line so the rest still land. A copy source from outside is allowed only when it is one of the paths of the latest drop, which the Rust side notes from the window's own drop event (WindowEvent::DragDrop), so the page cannot name an outside file and copy it in; a new drop replaces the list, shares never count. scm_stage/scm_discard take the worktree through the fence; kit_check goes through the same kit-folder guard as the other kit commands (projects and the samples folder), giving no result elsewhere. Grants are saved as one kv row (file_grants, a JSON list) on each pick; on load every entry is resolved again and a share, drive root, folder or missing file is dropped, a damaged row grants nothing, and the cap of 100 holds. ponytail: the list is rewritten on each pick; it is at most 100 lines.
- 2026-10-19 · [hooks] FIX-6 · (d9c329ef on lane/hooks, Fable, after the STEP 0 merge of main 1c102af4 = e19d8791): the stand-in review of FIX-5 answered. (1) The three status tests that lean on the ended ring (t563, fix_5, the fix_4 race test) take one test-only mutex, so the race test's 2,000 ends never flush the ring under the other two on a loaded PC; fix_5 gets a HOOKS_TEST_GAP_MS knob that reproduces the flake on demand (red at status.rs:1479 without the mutex, green with it). (2) The held-append proof counts a run only when its first try was 400 ms (was 100) clear of the lock's release; red rerun on the committed body with the script's retry loop at one try (no run met the lock), green at 782 ms with 20 tries. (3) stat_006's "a closed Kolux never holds the agent up" bound follows the PC: a PowerShell start is timed just before and the bound is twice that plus the 2 s retry window plus 1 s, with a 30 s hang ceiling (under this wave's load: baseline 3.94 s, run 7.53 s, bound 10.89 s; the old 5 s bound would have been red). (4) The Codex rollback treats a file the user deleted in the window as done and drops the "created" record instead of leaving a stray (new test red/green). Wording fixed in the fix_5 test comments. COMPAT 3.1 wording goes as evidence/hooks-FIX-6-COMPAT.md.patch for the coordinator (plain words: an empty set of hooks, not a zero-byte file; "when it installs"). Decision: COMPAT keeps plain words rather than a code span, per the spec-wording rule. Not touched: activity.rs:529/535 double terminal_ended (automations lane); the fix_4 missing-folder timing comparison (review AFTER 5b) stays open. Gates: hooks:: 85/85, status:: 34/34, clippy clean, tsc 0, plan-check OK, firewall 0 new; no app launch.
- 2026-10-19 automations FIX-3 (lane/automations from 94d86a9 on main 1c102af4): activity.rs restart test drops the second status::terminal_ended(OLD) and asserts the session/lane end through NEW; activity 17/0, status 34/0, clippy clean; evidence/automations-FIX-3.txt. AFTER 3 (SystemTime in artifacts.rs) left open.
- [marks] FIX-4 2026-10-19 (from 1c102af4): T-564 USAGE-034 header usage readout (headerUsage.ts, UsageReadout.tsx, TerminalPane usage prop, cost on the reading); FIX-SOON 1: a report held inside the fresh window stays a candidate and is shown stampless when the window ends or with its clock when a second held report agrees (sameRun). Decision: the window-end candidate carries no clock so the gauge cannot freeze; Math.floor, SAFE-004, T-032-c, gauge after /exit + --continue left to Txais. Hunks left: hooks.rs cost_usd, App.tsx usage prop, styles.css .usage-* (evidence/marks-FIX-4-*.patch).
- [cli] 2026-10-19 FIX-8 (council stand-in review of lane/cli 800b8a94; lane merged to main 1c102af4 as b0cb8e8b): T-172-e rewritten and still unticked (left: the live proof in evidence/cli-FIX-8.txt); a stamp that arrives after the timeout is kept ten minutes and the next worker-show/stop/release records that session on its dispatch row (reconcile_late, lateStamp), so a stop ends it; call sites tested through cli::spawn_stamped (terminal.rs patch) and startFields (App patch); fix7_a first case one settled tab, fix7_d gained a differently-marked session; tabs() reads only the stamped id. Gates: cargo cli+terminal tests 80 passed, clippy -D warnings clean with the terminal patch, tsc 0, vitest 1364 passed. Patches: evidence/cli-FIX-8-terminal.patch (apply first), cli-FIX-8-App.patch.

- 2026-10-19 · [skills] FIX-5 · done: council d2 stand-in review of ed8df8ed, FIX-SOON 1-3 + AFTER 1-5 on lane/skills; delete record gains `roots`, refused entries dropped (logged after the rewrite), I/O vs parse vs clear-failure messages, record settled once per request; 7 tests added, 6 changed, cargo test --lib skill_delete 47/0/2, clippy clean, tsc clean, plan-check OK, firewall 0 new · evidence/skills-FIX-5.txt
- [skills] FIX-5 · Removal trust for a set-aside copy = exact name form + next to its original when on record + parent under a skill folder the record names (`roots`, serde default). An older record without roots removes nothing: refused at start-up, dropped by the next delete, copies left on disk. A refused entry in a not-done record is dropped, never put back or removed. A readable record that could not be cleared says "could not be removed/rewritten (...); try again" and is retried once per request; "damaged ... rename each back" is for parse failures only. Planner: rust-version 1.90 in src-tauri/Cargo.toml is not named in PLAN/LOOP/STATE.
- 2026-10-19 · [launch] FIX-2 · done: markFor(id, program?) in PlusMenu.tsx (programMark by file stem), PlusMenu and ChooserPane callers pass the program; App.tsx, AgentsRail.tsx and LayoutStrip.tsx callers go as three patches (evidence/launch-FIX-2-*.patch) · evidence/launch-FIX-2.txt
- [tasks] FIX-3 (wave 11, lane/tasks from 322a209 ff to main 1c102af4) · the GitHub host gate in github.rs refuses when either `gh config get` read fails or times out (it used to take a failed top-level read for "no top-level user" and let the host through); the reads run through the repo bounded runner (scm.rs gh_config_within, patch evidence/tasks-FIX-3-scm.patch) which ends the whole process tree; evidence/tasks-FIX-3.txt
- [tasks] FIX-3 part 2 (TS, tasks-ec9aa5a review) · New issue create reports to its own workspace and shows failures on reopen; Projects cell shows the last good edit; title/label limits; focus return; tsc 0, vitest 1371 passed; evidence/tasks-FIX-3.txt
- [marks] 2026-10-19 FIX-5 (council stand-in review of lane/marks b08c624c, FIX-4 merged as ed50c435): a held report with no context no longer deletes the candidate (useAgentStatus.ts); the held-report timers are cleared when the window's hook unmounts; a pane with no plan windows shows only the gauge (piecesFor, tests changed in UsageReadout.test.ts and headerUsage.test.ts); --cost-fg added to theme.ts; live step 2 now checks the title (evidence/marks-FIX-5.txt). Decisions made for Txais: no-plan panes show the gauge only, per USAGE-034 (the earlier ring + tokens + cost was better looking but against the card); revert = delete the first line of piecesFor in src/terminal/headerUsage.ts and restore the old UsageReadout test. Left to Txais: Math.floor, SAFE-004 sheet, T-032-c Esc check, gauge after /exit + claude --continue. Optional styles.css hunk in the evidence file.
- [cli] 2026-10-19 FIX-9 (council stand-in review of lane/cli 529c53e2; lane merged to main as b8c85b32, brought in first as 7bbccf6f): a late session on a dispatch already stopped, abandoned or released is no longer attached in silence: the call that records it carries a lateWorker note (dispatch, session, status, worker-release as the next step), worker-show prints lateStamp and lateAfter, and worker-release closes it, also on a row released before it came (fix9_a, fix9_b); lock-order comment on STAMPS; evidence wording fixed. T-172-e stays unticked (live proof). evidence/cli-FIX-9.txt.
- 2026-10-19 · [hooks] FIX-7 · review hooks-d9c329ef-standin-review.md (FIX-SOON 1, AFTER 1-3, 5b), all in agent_hooks/tests.rs: the held-append test aims 1100 ms past the stamp (HELD_AIM_PAST_STAMP_MS, was 600) and keeps its 400 ms pass line, with a test that the aim keeps 600 ms of room each side of the 1900 ms the script retries for; stat_006 times the PowerShell start before and after the run and bounds on the larger (held_run_bound); its comment names the unused 2 s retry allowance and curl's 0.5 s connect timeout; the Codex rollback println says "saved just before the re-read"; the missing-holding-folder timing test alternates the two paths over 4 rounds and ties its 1 s margin to the script's retry reach. COMPAT wording (AFTER 4) was already on main. Hooks tests 88 passed (was 85), status 34, clippy clean, tsc 0, evidence/hooks-FIX-7.txt. The activity.rs extra terminal_ended(OLD) it listed as left was already closed by automations FIX-3 (MERGE 112).
- [look] 2026-10-19 FIX-7 (council stand-in review of lane/look 439081cb; lane fast-forwarded to main 1dcade8e first): cancel and claim split into cancel_in and claim_in on a map of their own so tests prove the 256-marker bound through the cancel itself (editor_search.rs: fix7_cancel_itself_bounds_the_map_and_keeps_a_running_search, fix7_a_pruned_marker_no_longer_stops_an_older_search_but_a_kept_one_does); comment ties a raised flag to a marker; FIX-6 evidence step letters corrected. No hunks for others. evidence/look-FIX-7.txt.
- [marks] 2026-10-19 FIX-6 (council stand-in review of lane/marks 2d4235af, FIX-5 line above): the costFg test now asserts the light value is darker (lightness below the dark one and about 0.75 of it), red first against a light theme that lightens the colour (G:/Temp/marks-w1-logs/fix6-red.log). Corrections to the FIX-5 record: (a) the FIX-5 revert note above ("delete the first line of piecesFor") is wrong: the first line is only the comment. Correct revert = delete headerUsage.ts lines 74-75 (comment and the `have.windows === 0` guard), delete the tests at headerUsage.test.ts:131 and UsageReadout.test.ts:116, and restore the bare-pane assertion in UsageReadout.test.ts (the test "no cost report yet is no chip; no plan windows leaves the ring and tokens": no `usage-win`, contains `155k/200k`); (b) the FIX-5 commit body listed the costFg test as red first, but it had no red run; the other four were red first (fix5-red.log, fix5-red2.log); (c) PROVENANCE now has the marks FIX-5/FIX-6 line. Still left to Txais, unchanged: gauge-only for panes with no plan windows (hides tokens and the cost chip for non-Claude/Codex agents, a Codex pane whose read failed, a Claude pane before its first limit read, and possibly API-key accounts), Math.floor on the gauge, SAFE-004, T-032-c Esc check, gauge after /exit + claude --continue. Width thresholds in headerUsage.ts stay LIVE PROOF PENDING (evidence/marks-FIX-5.txt step 2). AFTER 2/3 of useAgentStatus (no-cost report keeps the last cost; a shown candidate keeps old tokens) stay accepted.
- [cli] 2026-10-19 FIX-10 (council stand-in review of lane/cli 081bbfab; lane merged to main as 1dcade8e, brought in first as a6b21960): the late-worker note is durable: a late session on an ended dispatch marks the row latePending and every answer carries the note until worker-show or worker-release reads that dispatch; worker-list rows show lateStamp, lateAfter and latePending (and the text says it); completed and failed rows are covered; a release that leaves the terminal open (terminalLeftOpen) says it is left open and names terminal close; tests fix10_a, fix10_b, fix10_c (red first on a, b and the latePending part of c); the two raw-newline format strings are now \n. No hunks for the coordinator. T-172-e stays unticked until the live proof (evidence/cli-FIX-10.txt).
- [launch] FIX-3 round 2 (lane/launch from 1dcade8e, 2026-10-19): one credit rule for the pane mark. creditedAgent in src/launch/paneMark.ts is agents::credited_agent in TypeScript (program read as a command line), pinned to agents.rs by two drift tests; markFor/paneMark live there; App/LayoutStrip call-site hunks ride evidence/launch-FIX-3-App.tsx.patch and launch-FIX-3-LayoutStrip.tsx.patch; spent launch and T-552 patches deleted. Decision: an unquoted path with spaces stays uncredited, as in Rust (Rust fix belongs to the accounts/terminal lane). Revert = programMark back to the file-stem test.
- [tasks] 2026-10-19 FIX-4 (council stand-in review of lane/tasks 3937cbbd; lane brought to main 1dcade8e first): a gh config read that exits non-zero for any reason other than gh's own key-not-found answer now refuses the host instead of reading as an unset key (needs evidence/tasks-FIX-4-scm.patch in the merge: gh_config_within returns exit status and stderr); a New issue opened after a create failed while nobody watched shows that failure; AFTER 1, 2, 4, 5, 6 done in src/tasks, AFTER 3 documented; component tests (AFTER 7) stay open (no jsdom setup in the lane).
- [skills] 2026-10-19 FIX-6 (council stand-in review of lane/skills efa2f15a, FIX-5 merged as MERGE 115): a delete's record can no longer vouch for a folder that is empty, relative, missing, or not a skill folder the app scans (home skill folders, or a workspace .claude/.agents/.grok/skills folder at start-up); a delete keeps a leftover from a workspace it did not scan for the next start instead of removing or dropping it; refused entries are dropped at start-up too, only after the record was rewritten; the damaged-record advice names what follows .kolux-deleting-<pid>-<nanos>-; not-done put-backs respect the recorded folders. Tests fix6_a-e; evidence/skills-FIX-6.txt.
- [chat] 2026-10-19 FIX-6 (council stand-in review of lane/chat 64abfea0; STEP 0 merged main 8ed551e8 as 6ad7fb9c): the AFTER 1 claim corrected from main (markFor follows the program for saved agents since launch FIX-2 b26fdad3: PlusMenu.tsx:30-34, App.tsx:868/1058/1101, a custom-id agent running claude carries the claude mark and is hooked; pinned by a kitPrompt test using markFor), and the hand-over refusal note is keyed by the reply id not its words (model.ts lastReplyItem, ChatView.tsx Hand.noteFor); red 1 failed, green chat+agents 127/127, full vitest 208/1416, cargo lib 905+1 load flake (rerun ok), clippy 0, tsc 0, plan-check OK, firewall 0 new (evidence/chat-FIX-6.txt).
- 2026-10-19 · [hooks] FIX-8 · review hooks-060af6b8-standin-review.md (AFTER 1-4), comments only in agent_hooks/tests.rs: the stat_006 allowance lists parts that fit 3 s with the 2 s retry window named as outside it; the fix_4_a headroom reads "about that much more (measured 1.5-1.9 s)"; a discarded warm-up before attempt 0 of the held-append test was tried (leads 1329, 1643, one miss, 1968 vs 1175, 981, 606 without it) and dropped as no help, so the 600 ms of room each side is documented as nominal (measured early-side room 300-420 ms in FIX-7); every red run kept as a raw log (G:/Temp/hooks-w1-logs/w13-*.log). Base 904 passed with 2 load timeouts (fix_4_a, an scm test) that pass alone; hooks:: 88/88, status:: 34/34, clippy clean, tsc 0, firewall 0 new. No hunks left.
- [reliability] 2026-10-19 FIX-7 (council stand-in review of lane/reliability 1b4b2dbd; lane merged main 8ed551e8 first): the leftover kill's real runner (run_program) moved out of the cfg(unix) block so a Windows test runs it, the FIX-6 evidence now says the Unix paths were never compiled or run, and fix4_a waits for its second program's started.txt before the tree kill and no longer reads a leaf-first kill as the wait being over (5 solo runs green); lib 908 passed, clippy 0, tsc 0; Linux CI and the Shift-click live proof stay open
- [cli] 2026-10-19 FIX-11 (council stand-in review of lane/cli 9afdd308; lane brought to main ee8daae4 first, merge 14884b32, no conflicts): a release that leaves the late terminal open or ends release_unknown keeps latePending and the lateAfter fact on the row, spent only when the receipt says the terminal is closed (or a later release finds it gone); worker-show clears the alarm on a later show, not the first read; late notes follow ORCH-033 (the answer's Run plus Run-less rows, all for a caller tied to no Run); a left-open row is told with terminal close on every answer; tests fix11_a, fix11_b, fix11_c, fix9_a/fix10_a/fix10_c changed (red first); fix10_a now pins that a release changes no finished task or result. No hunks for the coordinator. T-172-e stays unticked until the live proof (evidence/cli-FIX-11.txt).
- [accounts] 2026-10-19 FIX-4 (council stand-in review of lane/accounts 6431497): a saved terminal default no longer ticks the Setup Guide agent step; reads made when the guide switches on stamp the sidebar focus floor; the wizard wiring is tested through the real useWizard hook instead of a source scan; the first-AI retry wording says next page visit or connection change; the page note counts its use once; acct_024_a counts polls instead of time (old test failed 14 of 20 under 12 busy processes, new 20 of 20; G:/Temp/accounts-w1-logs/fix4-flake-old.log, fix4-flake-new.log); evidence/accounts-FIX-4.txt
- [launch] 2026-10-19 FIX-4 (lane/launch from 8c856676; council stand-in review launch-75e39584): one way to credit a spawn program - tools::credited_program (quoted first, then raw; the inventory agent_of form) with 16 asserts that paneMark.test.ts parses and replays through creditedProgram, call-site swap for terminal/claude_accounts/codex_accounts/claude_key/grok/cap/inventory/cli in evidence/launch-FIX-4-credit.patch (9 files, apply-checked, patched cargo + clippy green); drift tests now require every credited_agent( / credited_program( call to be a parsed literal assert, Rust whitespace set and ASCII-only lowercase, App.tsx guard tightened to paneMark(a|agent, line) with a bad-forms test; T-552 evidence 'patches applied and deleted' line, PROVENANCE line, tsc exit codes in evidence/launch-FIX-4.txt. pnpm test 1423 passed, tsc exit 0, clippy exit 0, plan-check OK, firewall 0 new. Not done: Rust returning the credited agent in Spawned/StartLine (terminal.rs + App.tsx).
- [tasks] 2026-10-19 FIX-5 (council stand-in review of lane/tasks 32e8b3cc; lane brought to main 2f79fc02 first): the gh config read now takes only gh's "could not find key" as an unset key and a config answer of more than one line as no answer (host refused), the scm gate tests get a stand-in that prints the key-not-found text plus a !contains("did not answer") check (evidence/tasks-FIX-5-scm.patch, scm.rs is outside tasks), the burst re-read of a project is skipped while another edit is out and dropped if one was sent since, and a failed New issue create shows only in a New issue for the same host and repository (evidence/tasks-FIX-5.txt; live proof pending).
- [skills] 2026-10-19 FIX-7 (council stand-in review of lane/skills d9e2c699, merged as MERGE 129 d823b3f8): a not-done put-back under a folder the record names that exists and is called skills now goes through even when that folder is no longer a home skill folder, and a done entry under it is kept on the record instead of dropped; a record without folders puts a copy back only under a scanned or workspace-shaped folder; a delete says "kept" once; a linked folder dressed up as a workspace skills folder is no longer taken for one; a delete re-checks that each item still sits in a scanned folder before renaming it. Tests fix7_a-e; evidence/skills-FIX-7.txt.
- [chat] 2026-10-19 FIX-7 (lane/chat from BEFORE e20000d6; STEP 0 merged main 0cf10093 as 0ef49fbf, clean): the head's reply id now comes from one place (ChatView.tsx headOf) and ChatHead's resultId is required with no text fallback, pinned by lastReplyItem and headOf tests with two same-word replies; the gemini assertion split out of the markFor pin; item ids checked (chat.rs:383/399/452: unique, stable unless a line-n fallback is re-read after a reset); red 3 failed, green chat+agents 132/132, full vitest 209/1432, cargo lib 915+1 pty load flake (alone ok), clippy 0, tsc 0, plan-check OK, firewall 0 new (evidence/chat-FIX-7.txt).
- 2026-10-19 · [hooks] FIX-9 · stand-in review hooks-0cf01757-standin-review.md (items 4-7), correcting FIX-8's record: the base failure of fix_4_a at MERGE 131's cargo run was its margin assert (quickest held 7.7 s, missing 9.3 s, "no retries for a missing folder"), NOT a timeout; fix_4_a now keeps timing 4 rounds at a time (up to 4 attempts, rounds pooled) until the two quickest held times are within the 1000 ms margin, and fails only on a calm reading (a script that retries on every error stays red: quickest 1.5-1.8 s slower, w14-red-R3*.log); new unit test fix_9_a_load_swing_bigger_than_the_margin_is_noisy_not_a_retry (red against the FIX-8 rule, w14-red-fix9-judge.log); the HELD_AIM_PAST_STAMP_MS doc comment gains the 206 ms late-side room, run 4 and the 1968 ms reach, and the constants test is renamed fix_7_the_held_append_aim_constants_leave_600_ms_nominal_room_each_side; the two FIX-8 evidence wordings corrected; every gate logs its command and exit code (G:/Temp/hooks-w1-logs/w14-*.log).
- [look] 2026-10-19 T-268 (VIEW-052, lane/look from 766ed2cd): the left sidebar can be Standard, match the terminal background, or take a tint colour at a strength of 0 to 100; src/look/sidebar.ts, Appearance fields sidebarLook / sidebarTint / sidebarStrength in theme.ts, --sidebar-bg painted on the left sidebar only; the pickers are T-270; evidence/T-268.txt.
- [look] 2026-10-19 T-270 (SET-021, lane/look on T-268): Settings > Appearance > Window & Sidebar gets the Left sidebar look picker and the Workspace cards layout (Default / Compact / Detailed); workspace rows draw a second line and a hover by that layout; src/look/SidebarSettings.tsx, cards.ts, CardLine.tsx; the git-ignored-files switch waits for T-236-b; evidence/T-270.txt.
- [look] 2026-10-19 T-266 (PROJ-017, PROJ-062, lane/look on T-270): project and group headers carry a coloured badge from a fixed palette (grey for new projects, saved as headerColours) with swatch pickers in their settings forms; the sidebar gets a Card details chooser over CARD_DETAILS (unblocks T-291-d); src/look/headerColour.ts, HeaderBadge.tsx; evidence/T-266.txt.
- [worktrees] 2026-10-19 T-212 (suggest_name asks every project and skips branch tails, hand-typed names and retired ones; takeSuggestion keeps an edited name; command needs the lib.rs hunk and the panel needs the ProjectsPanel hunk (evidence/worktrees-T-212-*.patch))
- [worktrees] 2026-10-19 T-299 (icons kept under store key projectIcons, validated in projects.rs clean_icon, drawn by IconView, chosen in IconPicker; retired names are per scope and only for suggested names, recorded in forget_workspace; needs the lib.rs hunk and the ProjectsPanel hunk (evidence/worktrees-T-299-*.patch))
- [worktrees] 2026-10-19 T-294 (setup.rs suggest() offers import then install, save keeps a local setup that workspace_setup now falls back to, dismissal per project in the store; needs the lib.rs hunk and the ProjectsPanel hunk (evidence/worktrees-T-294-*.patch))
- [worktrees] 2026-10-19 T-212 FIX-1 (panel patch re-cut against the look lane file; false evidence sentence dropped)
- [worktrees] 2026-10-19 T-299 FIX-1 (forget_gone retires names; old creatureNamesUsed names stay retired; forget_projects prunes card state; panel patch re-cut)
- [worktrees] 2026-10-19 T-294 FIX-1 (save refuses a script changed since shown; setupPolicy honoured; card keyed on project and folder with stale replies dropped; reads and shown names capped; T-294-b opened)
- [marks] 2026-10-19 T-336 (lane/marks from 53807a11, brought to main d823b3f8): the share-to-X button is the words Share on X with no picture (src/usage/ShareButton.tsx; T-263-b mounts it), and a test fails if an X logo file or glyph path ships. evidence/T-336.txt.
- [marks] 2026-10-19 T-338 (lane/marks, after c7c88424): HID-042 is a standing test that no pet picture or old-character name is in the bundle and that src pictures are only NOTICE-listed vendor marks (src/marks/noPetArt.test.ts); the pet stays out. evidence/T-338.txt.
- [marks] 2026-10-19 T-335 (lane/marks, after 81b01160): vendor logos now come only from public brand kits, unaltered, with source, date, terms and SHA-256 in src/assets/vendors/NOTICE.md; src/marks/registry.ts + AgentMark draw OpenAI, GitHub, Copilot, Linear, VS Code and Claude (light and dark), with the neutral glyph for any other agent; nothing is fetched at run time; the wiring into VendorMark.tsx and PlusMenu.tsx is two patches for the coordinator; T-335-b holds the other vendors. evidence/T-335.txt.
- [marks] 2026-10-19 FIX-6 on the new cards (lane/marks, after 52195201; corrects the T-335 line above, which still lists Linear): marks.css now switches light and dark on [data-mode="dark"], the attribute the app really sets (test reads the stylesheet); the two Linear files, their NOTICE rows and registry entry are gone (cut feature, HID-044; a test fails if a GitLab, Jira, Atlassian, Linear, iOS or Android file ships); both OpenAI pictures carry alt=Codex; T-335-b names every remaining mark as kit mark or name only; T-263-b points at ShareButton; T-336/T-338 red-run claims corrected; ShareButton scan covers all of src; NOTICE match is by table row; cost chip test is exact. evidence/marks-FIX-6b.txt.
- [editor] 2026-10-19 T-178 (EDIT-046, lane/editor from ab6c9df2): saves are all-or-nothing (flushed same-folder temp swapped in; failure leaves the original and no temp; a dead save's old copy is cleared by the next save of that file); text opens up to 32 MB (was 5 MB), the first 8 KB is sampled and binary files (signatures, NUL, mostly control bytes) get no text view and no retries. Decision: bound 32 MB, UTF-16 is refused as binary. Live proof pending; evidence/T-178.txt.
- [editor] 2026-10-19 T-318 (EDIT-055, lane/editor from ab6c9df2): new notes can start from the repository's templates (.kolux/templates, markdown, subfolders searched, links and dependency folders skipped, natural-order names from file names); placeholders title/date/time/datetime/filename are filled, unknown ones stay; only a listed template is accepted; no templates means a blank note at once. Decision: the note is a real file on disk so closing it untouched keeps it. Wiring for App.tsx/lib.rs left as evidence/editor-T-318-wiring.patch. Live proof pending; evidence/T-318.txt.
- [editor] 2026-10-19 T-316 (EDIT-006 wrap, EDIT-010, EDIT-011, EDIT-023, lane/editor from ab6c9df2): word wrap on by default with Alt+Z saved to the setting; Astro/Svelte via HTML, Nim and JSON Lines tokenizers; explorer folders-first natural order (ties by exact name) and file-kind icons by whole name then multi-part ending; CSV/TSV table view (separator detected, BOM ignored, quoted fields kept whole, first 2000 rows). Decision: first row is the header, Alt+Z writes the global setting. EDIT-006 minimap, EDIT-018 PDF export and EDIT-024 notebooks split to T-316-b (EDIT-024 run skipped per brief). Live proof pending; evidence/T-316.txt.
- [worktrees] 2026-10-19 FIX-2 (T-299, T-294, T-212; council stand-in review of lane/worktrees 313721b4: the launch sweep of gone worktrees clears the same record as a removal by the user (typed name, parent, note, origin, retired name), test failed before the code; PLAN figures corrected, no UI sets setupPolicy yet said plainly on T-294, weak cardAsk test renamed, wrong comment in projects.rs fixed)
- [cli] 2026-10-19 FIX-12 · fix round from the council stand-in review of lane/cli 28f3eb7a (items 1-5 + AFTER): worker-show never silences a live left-open terminal; a late terminal that is gone spends the alarm on any row and lateAfter stays on every path; the worker-list line names terminal close for left-open rows and worker-release otherwise (no worker-show); fix11_c checks RELEASE and WORKER_SHOW per Run; tests fix12_a, fix12_b, fix12_c (red first), fix10_c changed; T-172-e wording matched to the code, card unticked until the live proof (evidence/cli-FIX-12.txt). No hunks for the coordinator.
- [reliability] 2026-10-19 FIX-8 (council stand-in review of lane/reliability 5bf0d5ce; lane merged main 649cb862 first): fix4_a now cannot pass vacuously (the job half reads started.txt and reruns up to 3 times, then fails "fixture did not start"; the no-job half bounds its wait at 10 s) and checks that no program started from its own folder is still alive (late.cmd waits with its own ping.exe copy), and the kill_leftover wiring test is a shape check shown red against the old closure; three scratch mutations recorded red, lib 920 passed, clippy 0, tsc 0, firewall 0 new; Linux CI and the Shift-click live proof stay open
- [docs] 2026-10-19 FIX-1 (pre-merge, from the docs-de5958ea review): command-line.md and troubleshooting.md worker text re-verified at 5e6726c2: release left-open reason in plain text, stamp-based worker detection and the current timeout wording, two stop-warning forms, new Late agents paragraph; release-wording row deleted; docs only, plan-check OK; evidence/docs-FIX-1.txt
- [accounts] 2026-10-19 FIX-5 (council stand-in review of lane/accounts 2cd07cae): a real-clock test proves the Codex pane wait ends when it has time (red with two broken clocks); the wizard terminal-default test now has an installed terminal agent so the guard is what it proves (red without the guard); one shared isAiAgent rule (agentKind.ts) for the guide and the first-folder start; every gate log ends with its command and exit code; evidence/accounts-FIX-5.txt
- [launch] 2026-10-19 FIX-5 (lane/launch from 5e6726c2; council stand-in review launch-ca3c8afd): tools::credited_program and creditedProgram read a line as a command line only when it is quoted or its first word is a bare name, otherwise the whole path quoted (the raw fallback is gone), so C:\Users\Grok Fan\bin\tool.exe credits nobody and `codex --cd C:\work\claude` credits codex; 6 new asserts replayed in both languages; drift parser counts whole-word credited_agent / credited_program uses (function pointers too) and reports \u{..} / \x.. escapes; new Rust test fix5_only_agents_tools_and_foreground_name_credited_agent; evidence/launch-FIX-5-agents.rs.patch (agents.rs Callers comment, outside OWNS, for the coordinator); launch-FIX-4.txt line 5 and LIVE PROOF step 3 reworded; clippy exit codes in the logs. pnpm test 1437 passed, tsc exit 0, clippy exit 0, cargo lib 924 passed + 2 load flakes that pass alone (edit044, term098). Not done: Rust returning the credited agent in Spawned/StartLine (item 7).
- [tasks] 2026-10-19 FIX-6 (council stand-in review of lane/tasks f10d97e1; lane brought to main a93496ce first): the burst re-read of a project is no longer lost (a skipped or dropped read stays due and is sent when the last edit out settles), the gh config read takes only the quoted `could not find key "` as an unset key (a wrapper's "could not find keyring" is no answer), a New issue create clears only a failure of its own repository, the created reset and the shown error follow the selected repository, tsc exit code recorded, three spent patches removed (evidence/tasks-FIX-6.txt; real gh wording stays LIVE PROOF PENDING).
- [i18n] 2026-10-19 FIX-1 (1/2, be41da3a; council stand-in review of lane/i18n): the text lookup accepts only text pack values and reads English for anything missing or not text; glossary ids are typed.
- [i18n] 2026-10-19 FIX-1 (2/2, e4ab8fa7): T-213 parked (not wired, waits on Txais yes), destination links never followed, retired settings matched by exact old camelCase names only; T-331 state.rs filter landed by hand at MERGE 151.
- [sessions] T-309 · STAT-043 done (STAT-038 split to T-309-b, needs ProjectsPanel.tsx): real notifications play the saved sound; nine tones, custom file with type check, silent toast when Kolux plays its own; coordinator hunk evidence/sessions-T-309-lib.rs.patch.
- 2026-10-19 · [hooks] FIX-10 · stand-in review hooks-891b834f-standin-review.md (items 4-7), tests only (agent_hooks/tests.rs): the missing-folder judge no longer compares quickest times (its second clause could never fail, so one lucky missing round cleared a retrying script); it judges every round on its held-to-missing difference (Retried at 3 of 4 rounds a margin slower, Fine at 1 of 8, else Noisy and more rounds); fix_9_a gets the raw w14-red-R3.log rounds and a lucky-round case (red before at tests.rs:631), the R3 mutation is red three times against the final rule, fix_4_a's rounds under real builder load are quoted in evidence/hooks-FIX-10.txt (one run, not a rate), and "no longer fails a correct script under load" is withdrawn; hooks:: 89, status:: 34, clippy, tsc, plan-check, firewall 0 new.
- [shell] 2026-10-19 T-256 (lane/shell from 2b425e51): per-worktree shell history - shell_history.rs gives bash and zsh a HISTFILE and fish a fish_history session per worktree, leaves cmd, PowerShell and unknown shells alone, keeps a history the user set, makes private folders, and sweeps a deleted worktree's history and leftover fish sessions at start; Settings > Terminal switch; terminal.rs and lib.rs hunks handed back as evidence/shell-T-256-*.patch; evidence/T-256.txt
- [shell] 2026-10-19 FIX-1 (council stand-in review of lane/shell 693dbb00): a fish pane's history session is now named with underscores only (fish rejected the hyphen and fell back to shared history), the start-up sweep reads the key back with rsplit_once('_'), the history variable is worked out before the pane registry lock and the on/off bool comes from terminal_spawn's own settings read (terminal.rs hunk re-cut on 1512cfee), and tests no longer read the real home's fish folder; FIX-SOON 3 and AFTER 1-5 stay open. Tests term119_bash_and_zsh_..._fish_a_session, term119_the_sweep_..., term119_a_history_the_user_set_..., term119_plan_...; evidence/shell-FIX-1.txt
- [look] 2026-10-19 FIX-1 (council review of 87f3fd67): the sidebar Card details chooser saves a preset-equal set as that preset (marker in workspaceCardDetails) so it keeps following the preset; click-through tests for swatches, chooser and the Settings look and layout controls (src/look/clickTree.ts); header colours are forgotten on group delete (patch for ProjectsPanel.tsx); Card details is a heading; ports and task hover lines left open as T-266-b; evidence/look-FIX-1.txt
- [look] 2026-10-19 FIX-2 (council review of 3b7d89d4): ProjectsPanel patch re-cut against main f1d6f6b0 (plain git apply --cached --check ok; tsc and 131 tests pass on a scratch copy of main with it); group delete prunes header colours through pure headersGoneWithGroup/colourSaveAfterDelete (members read before the delete, no save when nothing to prune, latest settings via a ref); CardLine indent-wins test; clickTree limits noted; evidence/look-FIX-2.txt.
- [skills] 2026-10-19 FIX-8 (council stand-in review of lane/skills ccb2b3e0, merged as MERGE 137 dff7cd49): a link named skills that leads to a folder not named skills is no longer treated as a skills folder, so nothing is put back through it and the log says how to put the copy back by hand; a leftover kept because its folder is not scanned is counted at each start, left alone by deletes, and taken off the record with that hint at the fifth start; a delete that stops early now logs what it kept and what stays on the record; each item's folder is checked again right before it is renamed. Tests fix7_d (extended), fix8_b-d; evidence/skills-FIX-8.txt.
- [skills] 2026-10-19 FIX-9 (pre-merge, council stand-in review of lane/skills 416b6ecd): a delete's rename now checks again that the item's folder is still a scanned skills folder before every retry, not only the first attempt, so a link re-pointed while a file is held no longer lets a retry rename inside another folder; the start count for a leftover under a folder that is not scanned is kept for each leftover, so a newly affected one is not forgotten with an older one; a failed record write logs the refused entry once instead of twice; test hooks tightened (swap between two renames, one lock in run_hook). Tests fix9_a-c, fix8_b/c/d and fix5_d changed; evidence/skills-FIX-9.txt.
- [skills] 2026-10-19 FIX-10 (pre-merge, council stand-in review of lane/skills 0c31b49e, AFTER 1 and 2): test-only round, no production change. fix9_b now proves the newer leftover starts at 1 (it checks only the last start's log lines and that stale_counts is exactly [(later, 1)]; red under a mutation that gives that leftover count 2, which the old assertion let through; evidence/skills-FIX-10.txt), and evidence/skills-FIX-9.txt got one appended correction block for the RED wording and the post-mutation green run. AFTER 3 stays open.
- [core] 2026-10-19 T-144-c: the pane menu (header button, header right-click, right-click inside the pane) lists Copy, Select All, Paste, Review plan, splits, Equalize, Expand/Collapse, titles, ids, diagnostics, Close Pane (destructive colour), Clear Screen, Find, each only when it applies; Escape or an outside click closes it, the opening click cannot; Equalize waits for the App hunk (evidence/core-T-144-c-App.tsx.patch); live proof pending (batched).
- [core] 2026-10-19 T-151-c: removing a pane whose agent has already ended no longer asks whether the agent is still running (classify gets a running flag, new kind ended); a program other than Claude or Codex gets no guessed y/n and no Approve/Deny buttons; the question fix waits for the App hunk (evidence/core-T-151-c-App.tsx.patch); live proof pending (batched).
- [core] 2026-10-19 T-151-d: the kept terminal stream shows a repainted command line once instead of every drawing run together (a start-over by carriage return, CSI n G or CSI H / f counts as a repaint; a move to another column keeps the text); live proof pending (batched).
- [core] 2026-10-19 FIX-1 (pre-merge, from the core-16ff8b54 review): an agent pane still starting is asked about before removal (running is undefined while starting, true while it runs, false once it ended); an ended agent pane running a shell is asked as a shell; the kept stream keeps earlier rows when a cursor move goes to another row (only a column-1 move on the same row starts over) and reads zero-padded columns and a carriage return right after ESC[; a vendor agent has no y/n keys in Rust either; the pane menu's click path is tested; T-151-d stays unproven against real PSReadLine bytes (capture step added); App hunk updated in evidence/core-T-151-c-App.tsx.patch; live proof pending (batched).
- [accounts] 2026-10-19 T-548 quick account switcher (lane/accounts from 3042c76f; evidence/T-548.txt): src/switcher/ builds the top-bar pill and menu and the palette rows over the existing claude_account_activate / codex_account_activate (running panes keep their account); codexOf keeps the active Codex account's plan figures off a Codex pane begun on another account on the Board and in the Tower, and a Tower usage card says whose figures it shows; no Rust changed; the TopBar mount, the actions.ts entries (keymap counts 131 / 55, Shortcuts 130) and the App.tsx palette rows, key cases and meter calls ride three patches in evidence/accounts-T-548-*.patch checked with git apply --cached --check on 3042c76f; Claude and per-account Codex figures are T-548-b; live proof pending (batched).
- [accounts] 2026-10-19 FIX-1 (pre-merge fixes to T-548, evidence/accounts-FIX-1.txt): the Tower says 'Figures for <name>' on Codex cards only and names accounts as the switcher does; a stale active id reads as System default; a failed keyboard or palette switch shows a notice; Escape closes the account menu even with every row disabled; the PLAN tick lists the three surfaces still on the active account; the three coordinator patches re-cut against main 34e7ea29 (keymap 134/134/55, shortcutRows 133) and proven by git apply --check; vitest 231 files / 1609 passed, cargo test 1009 passed, plan-check OK, firewall 0 new; live proof pending (batched).
- [accounts] 2026-10-19 FIX-2 (pre-merge fixes to T-548, evidence/accounts-FIX-2.txt): Escape closes the open account menu and goes no further (window capture listener, stops and prevents only while the menu is open), so a focused terminal or agent pane no longer sees the key that interrupts a turn; two accounts of one provider with the same name show a short id suffix on the Tower; the FIX-1 red-first breakdown corrected. switchAccount memo is in App.tsx, left open for the coordinator; live proof pending (batched).
- [accounts] 2026-10-19 FIX-3 (wave 16, evidence/accounts-FIX-3-wave16.txt): the same-name suffix on the Tower is the shortest tail of the id (four characters or more) that no other same-name account shares, so ids with the same last four still read differently; a test now pins that the account menu's Escape listener is on the window (mutation to document goes red); vitest 232 files / 1617 passed, tsc 0, plan-check OK, firewall 0 new; no Rust touched; live proof pending (batched).
- [accounts] 2026-10-19 FIX-4 (wave 16, evidence/accounts-FIX-4-wave16.txt): a test pins the tail edge of the same-name suffix (ids 'ab12' and 'xab12' read '(ab12)' and '(xab12)'); it passed at once and goes red when the suffix growth is removed; no code change, no Rust; live proof steps 7-9 still pending (batched)
- [setup] 2026-10-19 T-059-b (lane/setup from dff7cd49): the Safety page is now the Protected actions section (master switch + one switch per built-in rule, names and examples from the Rust catalog, searchable), and protected::mask hides secrets in a command text (Stripe keys keep prefix and last four); the attempts list that calls the mask moved to T-156-b; hunk evidence/setup-T-059-b-lib.rs.patch; live proof pending (batched).
- [setup] 2026-10-19 FIX-1 pre-merge (lane/setup from 42673bcf; evidence/setup-FIX-1.txt): the secret mask no longer hides ordinary -p words (find -print, gcc -pthread, tar -pxzf) or limit-style flags (--max-tokens, --password-stdin), takes Bearer/Basic words as tokens only in a header, and now hides curl -u user:pass, sshpass -p, Name: value headers, JSON password/token values, glpat-/npm_/hf_ keys and single-quoted dollar literals; every safe019 test input is masked twice; the Safety page re-reads the saved settings after each save so a failed write never shows a wrong switch; the Safety guide describes the switches; SAFE-019 moved to the T-156-b card list (acceptance: the attempts list masks via protected::mask). protected::tests 20/20, clippy 0, tsc 0, vitest src/settings 157/157, plan-check OK.
- [marks] FIX-7 (lane/marks from 1e3f7cf2): Jira, not Atlassian, is the cut name (registry test regex, NOTICE row, T-335-b); T-335-b now names every catalogue agent and open-in preset (Rovo Dev name only) with a default of name only until a public kit is found; usage views follow the same per-vendor call; evidence/marks-FIX-7.txt.
- [editor] FIX-1 2026-10-19 (lane/editor from 1e3f7cf2): council FIX-SOON round on T-178, T-316, T-318. CSV table reads only the header, 2000 rows and one more ("at least N rows"); "MZ" no longer marks a file binary; link-skip tests make a junction too and prove each link exists. evidence/editor-FIX-1.txt.
- [editor] FIX-2 2026-10-19 (lane/editor from 17b46851): council FIX-SOON on the CSV table. The read now also stops after 4 million characters or at one cell over 1 million, so a file whose first quote never closes shows the rows before it with "at least N rows" (or a note pointing to the source view) instead of freezing the window for about 5 s on a 32 MB file (134 ms after). CsvTable comment and the T-316 PLAN suffix now say so; the two link tests clean up their links; the counting-proxy test says what it does not catch. evidence/editor-FIX-2.txt. Live proof pending (batched).
- [shell] FIX-2 2026-10-19 (lane/shell from f2cc6e2e): council FIX-SOON on T-256. The history sweep now removes a deleted worktree's history only after it was found missing by one start-up and still missing at a later one 30 days on (a missing-since note in the history folder; a worktree that is back clears it), so an unplugged or unmounted drive keeps its history; it also skips folders not named after their record and never follows a link, a verbatim UNC path is keyed as the share, and a Store-alias bash.exe/zsh is left alone. 13 shell_history tests (5 red first). evidence/shell-FIX-2.txt. Vitest for the Settings switch left open (outside this lane's files).
- [shell] FIX-3 2026-10-19 (lane/shell from 41b37722): stand-in review of the T-256 history sweep. A worktree whose drive or share is not there at all keeps its history for good again (the folder-above-it rule is back beside the 30-day note; an older note is dropped), a pane started in a worktree clears its missing-since note, the fish sessions are left alone when the history folder is a link, and the junction test asserts no note is written through the link (mutation-checked). 16 shell_history tests (4 red first). evidence/shell-FIX-3.txt. AFTER 3 and 4 and the Settings-switch vitest left open.
- [shell] FIX-4 2026-10-19 (lane/shell from 091e79da): review FIX-SOON 1 of the T-256 history sweep. The fish-link test now removes its folder link with remove_file on Unix and remove_dir on Windows (new test helper unlink_dir, one new test), so cleanup never fails or leaves a link on either platform; no production code changed, no red run (the Unix failure cannot happen on this PC), 17 shell_history tests, full cargo 5 ok / 0 failed, vitest 1587; four review AFTER items stay open. evidence/shell-FIX-4.txt.
- [chrome] 2026-10-19 T-248-b (lane/chrome from dff7cd49): Help now has Report Crash, Explore Kolux, Getting Started (all systems) and Check for Updates (Windows and Linux in Help, macOS in the app menu), the macOS menu reports its stock chords so a global command on Cmd+Q shows Conflicts on the Shortcuts page, and menu::navigation decides which addresses load, go to the browser or are refused (the on_navigation hunk in tools.rs is a coordinator patch); APP-008, APP-010 and Ctrl+Tab moved to T-248-c
- [chrome] 2026-10-19 T-246-c (lane/chrome on top of T-248-b): the saved interface zoom has its own keys, Ctrl+Alt+= / Ctrl+Alt+- / Ctrl+Alt+0 (Cmd+Option on a Mac), and the View menu shows them; Ctrl+= and friends still zoom only the focused pane; the key case in App.tsx and the command count in keymap.test.ts are coordinator patches (evidence/chrome-T-246-c-*.patch)
- [chrome] FIX-1 (pre-merge, 2026-10-19): a German or French AltGr character no longer fires the zoom, floating-terminal or next-tab keys (AltGr guard in keymap.ts); the main window loads only the one origin its platform serves (Windows http://tauri.localhost, tauri://localhost elsewhere), drops about:blank, and Help no longer lists Report Crash until T-183; the tools.rs patch now also sends _blank links and window.open to the browser (menu::new_window), the App.tsx patch is re-cut on 1e3f7cf2 and the keymap.test.ts patch is folded into the lane (evidence/chrome-FIX-1.txt)
- [chrome] FIX-2 (lane/chrome from c72ada9b): Ctrl+Alt+letter chords fire again on Russian, Greek, Hebrew and Arabic layouts (non-Latin key letters count as typed text only with the AltGraph flag), macOS is checked before AltGraph, and the live-proof step for Ctrl+Alt+0 is marked a US-layout check with the AltGr zoom-key limit; keymap.test.ts FIX-2 test red then green; vitest 1447, cargo 944 (stat_006 rerun alone), plan-check OK, firewall 0 new; evidence/chrome-FIX-2.txt
- [usage] 2026-10-19 T-263-b (lane/usage from 2d14c7db): the usage card as a picture. A Share dialog (ShareCard.tsx) previews the card, Copy image puts a PNG on the clipboard and reads Copied for 2 s, Share on X opens the ready-written post through open_external with the T-336 button; figures, post, drawing and clipboard step are in shareCardData.ts (7 tests, vitest src/usage 85/85, tsc 0, no Rust touched). The panel's Share button and the mount are evidence/usage-T-263-b-TokenAnalytics.patch for the coordinator; live proof pending (batched).
- [usage] 2026-10-19 FIX-1 (council d2 review of lane/usage 962dbe64): the share card now survives a canvas that throws when made into a PNG (Copy image answers Couldn't copy and leaves its busy state instead of sticking), shows a partial cost as "$12.34+" with "unpriced models left out" under it (and "at least" in the post) when some models have no price, and its every-bar test now counts exactly one bar per day (a dropped bar fails it). src/usage only, 2 new tests + 1 tightened; evidence/usage-FIX-1.txt; live proof pending (batched).
- [look] 2026-10-19 T-291-d (lane/look from 34e7ea29): the Card details chooser gets an Automation tick-box (in no preset): ticked, a card made by an automation run says "Automation" under its name and one made by hand does not; the sidebar fill is a two-line coordinator patch (evidence/look-T-291-d-ProjectsPanel.patch).
- [look] 2026-10-19 T-307 (lane/look from 34e7ea29): Settings > Terminal gets "Bring in from Ghostty or Warp": it reads your Ghostty config and theme and your Warp theme files, previews them (settings it will set, schemes it will add, what Kolux has no setting for, invalid values, skipped files by bare name, Warp images and gradients skipped) and saves only when you click Bring in; needs the one-hunk coordinator patch evidence/look-T-307-lib.rs.patch; the rest of the old card is the open line T-307-b (core lane).
- [look] 2026-10-19 FIX-2b (T-307, from 070e4832): Ghostty includes are read only while they stay inside the config folder after symlinks and junctions are resolved; the Ghostty preview comes from the same plan Bring in saves (a scheme the 40-scheme cap refuses says Will not add); a failed save is read back and reported with nothing changed; Warp rows are keyed by place plus file name; the three glue tests were seen red and one real gap found and closed; folder names still unchecked against the public docs (docs quota out), live proof stays pending (evidence/look-FIX-2b.txt).
- [look] 2026-10-19 FIX-3b (T-307, from 355862c5): an include that cannot be resolved is refused instead of read and is read only through its checked real path; Ghostty themes and Warp theme files must stay inside their folder too; the Warp Windows theme folder is now under APPDATA as Warp's page says (it was LOCALAPPDATA) and Linux honours XDG_DATA_HOME; a render test proves a save that did not reach the disk leaves the window unpainted and the 40-scheme preview says Will not add; live proof still pending (batched).
- [worktrees] 2026-10-19 FIX-3 (council stand-in review of lane/worktrees 14a097f9: the sweep-vs-removal test now compares the stores on a twin worktree, a busy worktree with a full record is shown to survive sweep_gone, and a record the sweep cannot clear goes to the diag log instead of being dropped; diag test failed before the code)
- [worktrees] 2026-10-19 T-302 (PROJ-009/018/029/043/054/058; ticked for the tested pieces, the panel wiring is T-302-b): Rust auto icon from the repository (favicon files, page-source links kept inside the repo, owner avatar, else folder symbol) with 6 tests; tested logic for same-name path fragments, the behind note with Dismiss, the outside-worktrees card, scroll-to-top / jump to current, multi-select; lib.rs registration is evidence/worktrees-T-302-lib.patch; cargo projects:: 50 passed, vitest src/projects 129 passed, tsc and clippy clean; live proof pending (batched), see evidence/T-302.txt
- [repo] 2026-10-19 T-116-c-b · the repository page gets a Setup script card (saved script shown/edited/removed, run choice local|shared|both with a Run both suggestion, agent-waits checkbox); setup.rs pick_parts/join_both + per-repo store keys setupPolicies/setupWaits + five repo_setup_* commands; trust asked over the shared text alone; 3 new setup:: tests (34/34) + 4 vitest; hunks evidence/repo-T-116-c-b-lib.patch and -ProjectsPanel.patch for the coordinator; display name / outside worktrees split to T-116-c-c (projects.rs), icon on T-302; settings file is setupChoice.ts, not repoSetup.ts (case-insensitive clash with RepoSetup.tsx); live proof pending (batched)
- [repo] 2026-10-19 T-294-b · the repository page shows the saved local setup with a Remove row (the undo for a sidebar-card Save) and a Which-runs row; the row sets the repository's own policy (setupPolicies) over the global setupPolicy key, which still has no screen; new test proj035_removing_the_saved_setup_from_the_page_lets_the_card_offer_one_again (setup:: 35/35), code shared with T-116-c-b, needs evidence/repo-T-116-c-b-lib.patch; live proof pending (batched)
- [kits] 2026-10-19 T-333-b (lane/kits from b6e8ab4a): Start kit on a file outside the samples folder marks the checklist own-file item once the kit started (needs the App.tsx patch evidence/kits-T-333-b-App.tsx.patch), Preview and Open file mark results opened; vitest kits+onboarding 116, tsc 0; live proof pending (batched).
- [chat] 2026-10-19 T-329 (lane/chat from BEFORE 2d14c7db): CHAT-018 Stop (Escape after cancelling queued sends via a per-terminal epoch, 700 ms double-click guard, no Stop while the agent asks), CHAT-023 permission card (ask.ts counts prompts per pane, reuses permissionAnswer/planReview by import, dismissed stays dismissed, OpenClaude left out), CHAT-025 links (chatLinks.ts + ChatText.tsx, only agent-printed files open, modifier rules); tests red then green (src/chat 159 passed), tsc 0, no Rust touched; App.tsx hunk left as evidence/chat-T-329-App.patch; the editor pane has no jump prop yet so the line is kept but not scrolled to
- [chat] 2026-10-19 T-330 (lane/chat from BEFORE f1ad80d5): CHAT-009 hidden chats pause reading (reading.ts ChatReader: hidden start reads nothing, hide cancels retry and drops in-flight reads and calls chat_close, show starts one read whose first snapshot replaces stale, kept view per pane dropped when the terminal changed, failed/loading reads never replace kept messages); ChatView uses it with an optional hidden prop plus page visibility; 18 tests in reading.test.ts; vitest src/chat 177, tsc 0; no Rust, no App.tsx patch; live proof pending (batched)
- [chat] 2026-10-19 T-332 (lane/chat from BEFORE f1ad80d5): CHAT-028 files the agent wrote (steps.ts writtenFiles: four newest per finished turn, deduped by path, deleted left out, files view under the worked-for line; ChatView FilesRow reuses HandOff/Hand.onHand so the path lands in the other draft via handOver and no terminal is written); 14 tests in written.test.ts; vitest src/chat 191, tsc 0; no Rust, no App.tsx patch; live proof pending (batched)
- [chat] 2026-10-19 FIX-1 (lane/chat from BEFORE a1a27dbc; council stand-in review of f1ad80d5, items 1-6): the permission card follows the terminal (ask.ts answeredElsewhere, TerminalPane calls in evidence/chat-FIX-1-TerminalPane.patch), Allow/Deny and Stop re-check the prompt inside the terminal queue's job, the send's tool wait ends on Stop, a changed tool/detail is a new prompt, links drop decoded NUL paths and mailto extras and render without href; evidence/chat-T-329-App.patch regenerated on main 546687e6 with inKolux; T-329 PLAN text reworded, T-329-b opened; vitest src/chat 212, full 1612, cargo 973+3, tsc 0, firewall 0 new; live proof pending (batched)
- [chat] 2026-10-19 FIX-2 (lane/chat from BEFORE 47de0346; stand-in review of 47de0346, items 5-8): the permission card and a click on it also need the window's own reading of the pane to say permission (cardOf and answerCard take it, ChatView passes stateOf), so an answer given on the board or the plan sheet hides the card and a waiting click types nothing; written files are listed and handed over as full paths resolved against the pane's folder (fold and writtenFiles take cwd, a relative path with no folder is not offered for sending); ChatReader's next read waits for the close still out for its pane and a hide with a read out closes again behind it; Stop re-checks the pane's terminal at its turn in the queue; 21 new tests (ask 6, written 6, stop 3, reading 6; 13 of them red on assertions first, see evidence/chat-FIX-2.txt); vitest src/chat 233, tsc 0; no Rust, no coordinator patch; live proof pending (batched)
- [onboarding] 2026-10-19 T-321-b ONB-016 (lane/onboarding from 562c8347): the Setup Guide's Multi-task, notifications, default-agent and setup-script steps now have action panels (src/onboarding/actions.ts, StepPanels.tsx): Create a workspace picks the active git project, else the first (a non-git folder asks for a git project first), a stale composer request is dropped and a new-workspace tour follows; sound choices with a slider for the system sound only; the macOS permission card reads delivered/awaiting/dialog/blocked from the delivery check; agent picker with a Show/Hide fallback agents fold-out; evidence/onboarding-ONB-016.txt (live proof pending, batched).
- [onboarding] 2026-10-19 T-321-b ONB-018 (lane/onboarding from 562c8347): the Connect integrations step now has a panel (src/onboarding/integrations.ts, StepPanels.tsx): GitHub review is connected only when gh is signed in and its token is accepted (a stale, pending or failed check is not connected), the task step waits behind review and folds into Tasks come from GitHub (account) once the tracker answers, Re-check marks old answers stale, and the guide tick and sidebar ring follow the same rule; proved against a stand-in gh process; evidence/onboarding-ONB-018.txt (live proof pending, batched).
- [onboarding] 2026-10-19 T-321-b ONB-020 + ONB-015 legacy rule (lane/onboarding from 562c8347): the sidebar Getting Started entry (SidebarStart.tsx) now has a Hide from sidebar button that saves setupChecklist false and drops the entry; a profile with the checklist hidden (or the setup-complete mark) counts every Setup Guide step as complete everywhere (guide.ts legacyProfile), a failed read never counts, a retired step never counts; the spec's dismissed-on-every-load rule is not built, DT-ONB-020 patch left for the coordinator (evidence/onboarding-ONB-020-DECISIONS.patch); evidence/onboarding-ONB-020.txt (live proof pending, batched).
- [onboarding] 2026-10-19 T-321-b ONB-024 (lane/onboarding from 562c8347): Explore Kolux stops now carry setup cards (src/onboarding/stopCards.ts, StepPanels.tsx StopSetup): tasks and PR view show GitHub connected or not, agent statuses has the keep-awake switch (off turns on Agent, either on mode switches off), ship has the commit message writer switch and instructions; usage and the orchestration/browser skill command cards (no terminal; terminal is T-244-b) split to T-321-c; T-321-b ticked; evidence/onboarding-ONB-024.txt (live proof pending, batched).
- [onboarding] 2026-10-19 FIX-1 (lane/onboarding from 238a0a6d, pre-merge review items 1-6 plus AFTER 8-9): Explore Kolux stop cards wait for the saved settings and the writer-instructions box saves only a real change; the tasks and PR stops use the ONB-018 token-accepted rule; closing the Setup Guide no longer cancels the Create a workspace composer request; the sign-in check is remembered for a minute and survives a network failure; the keep-awake card shows the hooks-off line and the commit-writer switch restores custom; Hide saves in turn and shows a message when it fails; also fixed readSeen matching the real budget name "Search"; evidence/onboarding-FIX-1.txt (live proof pending, batched).
- [onboarding] 2026-10-19 FIX-2 (lane/onboarding from a1ff1e57, stand-in review items 1-4): the GitHub sign-in check now remembers only a good answer, so signing in in a terminal shows on the next focus, guide close or project add; reads asked together share one run of gh (Re-check never joins an older one); an account change is no longer covered by the offline answer (test added, mutation-checked); hooksOn has one home in src/onboarding/hooksOn.ts (callers patch evidence/onboarding-FIX-2-hooksOn-callers.patch for AgentsPage, KeepAwakeCard, App.tsx). vitest src/onboarding 154/154, tsc 0, full vitest 1599/1599; evidence/onboarding-FIX-2.txt (live proof pending, batched).
- [onboarding] 2026-10-19 FIX-3 (lane/onboarding from 419ae39c, stand-in review items 1-3): a GitHub read that was running when a newer one began (the guide opening, then Re-check) now gets the newer answer, so the guide and the Integrations panel cannot disagree; the cost of re-reading a not-good answer and the gh auth switch gap are written in the code; item 4 (hooksOn same-reference test) stays open until the FIX-2 callers patch lands. vitest src/onboarding 157/157, tsc 0, full vitest 1602/1602; evidence/onboarding-FIX-3.txt (live proof pending, batched).
- [hooks] 2026-10-19 T-126 (lane/hooks from b6e8ab4a): STAT-062 ended-turn memory in agent_hooks/vendors.rs - once Antigravity sends a fully idle Stop for a conversation or Amp ends a thread, a late tool event, end-of-invocation event or repeated end naming that transcript is discarded (normalize returns None, so the pane stays done and the spool replay skips it too); a fresh PreInvocation or agent.start clears it; keyed by vendor + transcript id, bounded 256, Amp threads kept apart; test stat_062_late_events_after_an_ended_turn_never_bring_back_working red then green; evidence/T-126.txt; live proof pending (batched).
- [hooks] 2026-10-19 T-134-b (lane/hooks from b6e8ab4a): CLI-040 rest / COMPAT 3.4 uninstall path proven, tests only - t_134_b_off_takes_only_kolux_out_of_every_agents_file_and_nothing_else drives the same remove calls clear() makes for Claude, a managed Codex home, Gemini CLI, Antigravity and Amp on scratch files holding the user's own entries beside Kolux's: every file is byte for byte the user's again, sibling files untouched, status reads not installed, a second off returns false and writes nothing, a file without Kolux's entries is never written and gets no copy; red by a removal-only mutation of remove_claude_once (restored byte-identical), then green; the PLAN note that only tests use is_mine was stale (install uses it at hooks.rs:853/1114; the off path uses names_mine, the same check); evidence/T-134-b.txt.
- [watch] 2026-10-19 T-033-e · git status watcher edges (council AFTER, MERGE 37): an overflow re-issues the read and the worker catches up with one read (stays Watching, logged once); a worktree whose folder is gone ends its own watch (logged once); unwatch_root(path) ends and joins a watch for workspace remove; unwatch_all() for the window going; packed-refs watched (Spot::Common + .git/packed-refs); the watching flag is shared and true to life for late joiners; the 120-a-minute burst of T-033-b explained (pauses ended bursts under the 1 s cap; the 4 s gap bounds read starts) and replayed in a Schedule test; cargo test scm::watch 20 passed; two coordinator patches (lib.rs Destroyed → unwatch_all, projects.rs workspace_remove → unwatch_root); live proof pending (batched)
- [watch] 2026-10-19 FIX-1 · fix round from the council stand-in review of lane/watch cdbf3911 (items 1-7 + AFTER 9-12): T-033-e unticked and narrowed to what the unit tests prove (reload is covered only by a new on_page_load Started hunk in the lib.rs patch; workspace_remove is sync today, the projects.rs patch makes it async; both evidence lines corrected); unwatch_root's fallback takes only the watch whose canonical root is the removed folder and skips a missing one; a real 3000-file overflow into a 64-DWORD buffer is tested on the same reader; an overflow forgets the ignore cache; a watch that ends on its own (gone, or a removal that then failed) tells the page as scm-watch-ended-<id> and watch.ts subscribes again (releasing at once if git answered with another worktree); unwatch_root joins five readers in under 100 ms (Wake event); CancelIoEx + GetOverlappedResult before the buffer drops on the wait-failed path; a failed worker spawn halts its readers; tests fix1_a_real_buffer_overflow_..., fix1_removing_a_gone_or_plain_workspace_..., fix1_unwatch_root_joins_five_readers_... and two FIX-1 vitest cases (red first); scm::watch 23, vitest src/scm 62, clippy 0; three patches for the coordinator (lib.rs, projects.rs, new watch-FIX-1-scm.rs.patch); live proof pending (batched)
- [core] FIX-2 (post-merge fixes from the fd88672b stand-in review, items 3-6; BEFORE 3042c76f; evidence/core-FIX-2.txt): the pane's running report is a pure runningOf(kind) with a test recorded red against the old mapping (a starting agent pane still asks before removal); last_drawing reads a left-out or 0 cursor row as row 1 and always records it, so a frame that starts at home keeps its first line (two inputs red first; the row-3-then-home fixture now keeps both drawings); markShell(set, key, shell, agent) replaces the vacuous has(7) assertion and is tested; PaneMenu click test renamed to what it proves; live step 5 (Starting chip during the spawn window) added for the coordinator; item 7 left until the PSReadLine capture exists; terminal.rs is a hard-stop file; no App patch this round.
- [orchestration] T-260-b: child lanes follow the task a session was started for (its parent task decides the nesting), not the pane that ran 'worker-start': the stored dispatch does not name its starting pane, so a worker started by a coordinator with no task of its own stays on top; the clicking proof is the page render test here and the live proof is batched; the fresh-Mac check is T-260-d (T-260-c was already taken). Tests t260b_* and the three T-260-b timeline tests; evidence/T-260-b.txt
- [orchestration] T-035-b: the exited-prompt half needs the app to keep a hook state it now throws away on exit (permission, waiting, blocked), so it ships as the App.tsx hunk evidence/orchestration-T-035-b-App.patch next to the Floor mount hunk; the Inbox already read Answer in Code for every Needs-you item, so the new part is the exited flag and its sentence. The on-the-spot answer, unfolding a folded row and the real-agent check are T-035-c. Tests: the T-035-b inbox and Floor tests; evidence/T-035-b.txt
- [orchestration] FIX-1 (review of 56c5de48): the exited prompt is kept in a separate map only the Inbox sources read, not in the pane's hook state, because the sidebar row, needs-strip, plan sheet and finished notice all read that state with no running check; a stop (blocked) turns to Done as before and its exit sentence names a stop, not a prompt; nest_lanes needs a string runId on both sides; the Floor name column and axis widen with the deepest nesting; the CDP proof moved to T-260-d with the starting-pane-on-dispatch change (orchestration.rs is not this lane's).
- [orchestration] FIX-2 (review of ad0b773d): the keep-on-exit and forget-on-start rule moved out of App.tsx into src/inbox/exitedPrompt.ts so it has real tests (a prompt is kept only for permission or waiting, dropped on restart, on pane close and when a fresh hook state arrives, and an exit call with no hook state left changes nothing), and the Floor gutter indent stops at five levels; the App.tsx calls ship as evidence/orchestration-FIX-2-App.patch, which applies on top of the first patch.
- [setup] FIX-2 2026-10-19 (lane/setup from f2cc6e2e): council FIX-SOON/AFTER round on the secret mask (T-059-b). A quote that is already closed no longer hides the program (curl "..a=1&b=2" -u, mysql -e "a; b" -p); the command word, not any look-alike word, picks the program (find /var/lib/mysql -perm stays); any secret-sounding header name after -H and a "name: value" at a line or quote start are hidden; JSON values with $ or an escaped quote are hidden whole; the Safety page keeps the last re-read while a save runs. Mask code and its tests only, check() untouched. evidence/setup-FIX-2.txt.
- [setup] FIX-3 2026-10-19 (lane/setup from 47cc3302): council FIX-SOON round on the secret mask (T-059-b), the leaks FIX-2's command-word rule opened. The program is matched as the command word or any other word that is not part of a folder path (folders cut at / and \, a .exe path counts), so C:\xampp\mysql\bin\mysql.exe -u root -p, .\7z.exe a -p, sudo -n mysql -p, if x; then mysql -p; fi, winpty mysql -p and echo "mysql -p.." >> ~/.bashrc are hidden again while find /var/lib/mysql -perm stays; wrapper options are per wrapper; then/do/else/!/{ and winpty pass through; an apostrophe inside double quotes is text. Per-assertion red probe on 47cc3302 in the evidence. Mask code and its tests only, check() untouched. evidence/setup-FIX-3.txt.
- [setup] FIX-4 2026-10-19 (lane/setup from 6b0ad7fa): council FIX-SOON round on the secret mask (T-059-b), the leaks FIX-3 left. A search tool no longer exempts its pattern (grep -rn "mysql -p.." and rg -e "curl -u a:b" are masked), and ) and a closing backtick give back the command a $( or backtick interrupted ($(which mysql) -u root -p.., `which curl` -u a:b); a path whose parent folder is bin or sbin (any case) is a program (the default Windows MySQL path, doskey/alias/echo lines), and a quoted path with spaces in its folders that begins a command is one word ("C:\Program Files\7-Zip\7z" a -p..); the password echo/printf pipes into sudo -S, sudo --stdin or a --password-stdin command is hidden; a lone " inside single quotes is text (mysql -e 'a "b; c' -p..). Mask code and its tests only, check() untouched. evidence/setup-FIX-4.txt.
- [launch] T-056 done 2026-10-19 (lane/launch from 3042c76f): Gemini CLI starts with --yolo and Aider with --yes-always, Manual and the user's own default arguments drop them, Kilo Code loses other agents' no-prompt switches before launch (list is a reading of the card, flagged for Txais); Goose split to T-056-b (variable name waits on the firewall allowlist); agents:: 33 ok; evidence/T-056.txt; live proof pending (batched).
- [setup] FIX-5 2026-10-19 (lane/setup from ee00c5fd): council FIX-SOON round on the secret mask (T-059-b/T-156-b), the launcher, here-string and PowerShell forms FIX-4 left. A password echoed inside a launcher or shell command (ssh host "echo pw | sudo -S x", wsl bash -c "..."), piped into sudo -S behind env, nohup or a launcher (echo pw | ssh host sudo -S x), put after <<< for sudo -S or --password-stdin, written with Write-Output or write, or given as one quoted literal before the pipe is hidden; the hidden echo now ends at ; & a line break or an unbalanced ), |& is a pipe, and the pipe may continue on the next line. Tests: 3 new in protected.rs (the duplicate row in the wrapper test removed); red first 31 passed / 3 failed, per-assertion probe 34 RED then 0 RED / 164 ok; 300,000-string fuzz nonidempotent 0 (it caught a here-string idempotence bug, fixed). Still open: echo pw 2>&1 | sudo -S, brace group, echo $(date) pw, separator inside a launcher quote, gh auth login --with-token, over-masking (cp -pr, "Password: required"); the FIX-4 line "nothing left open" was wrong. Mask still unwired. Only the masking code of the coordinator file protected.rs was touched. Evidence: evidence/setup-FIX-5.txt.
- [watch] 2026-10-19 FIX-2 · fix round from the council stand-in review of lane/watch 99f1f674 (items 1-4 + FIX-BEFORE 1 compiled early): watch.ts tries again with backoff (1 s / 4 s / 15 s / every 30 s, cleared on unmount) after an ended watch answers foreign or errors, outside-Git stays one call; both page listeners register together (ended-listener window of one IPC trip recorded as known, needs scm.rs); scm_watch.rs refuses a watch call that started before a reload (page generation counter under the WATCHES lock), holds the OVERLAPPED behind one raw pointer (Box<UnsafeCell>), forgets the ignore answers once per catch-up read instead of once per overflow; projects.rs patch recut with keep before unwatch_root, all three patches apply-check clean on main f04cdeaa (temp GIT_INDEX_FILE) and compiled together in the lane tree (one new dead-code marker on scm_watch::watch). Tests: cargo scm::watch 25 (+2), vitest watch.test.ts 9 (+4). T-033-e stays [ ] (coordinator patches + live proof E-G batched). Evidence: evidence/watch-FIX-2.txt.
- [worktrees] 2026-10-19 FIX-4 (stand-in review of lane/worktrees a771196e: no address a repository file names is ever handed to the page, only the github.com owner avatar, with a CSP patch for the coordinator and no-referrer on the img; web icons moved to T-302-c for a Rust fetch; multi-select keyed by path; AUTO_ICON_FILE_MAX 49122 equal on both sides; the avatar lookup stays inside the project's own repository; page and manifest reads refuse links out of the repo; the launch sweep is a tested function; red tests failed on assertions first)
- [chat] FIX-3 (wave 16, 2026-10-19, from 9e63435d): the written-files list leaves out a path that starts with ~ and one whose .. climbs above the drive or share root of the pane folder (steps.ts unreachable), a normal ../x still resolves; the reading-order test now uses a transcript stand-in that answers an early read with a delta and goes red when the wait is removed; 10 new tests (written 9, reading 1; 7 red first, see evidence/chat-FIX-3.txt); vitest src/chat 243, full 1760, tsc 0; no Rust, no coordinator patch; live proof pending (batched)
- [onboarding] 2026-10-19 FIX-4 (lane/onboarding from f04cdeaa, stand-in review items 1-3): the GitHub reads are shown to be bounded in Rust (account 5 s, budget 30 s), so a hung gh cannot leave the guide waiting and no timer was added; two comment lines say where and that an older good answer is dropped on a newer offline failure; the hooksOn test now proves the Settings page and onboarding share one function by identity; comments and one test only, no Rust; evidence/onboarding-FIX-4.txt
- [repo] 2026-10-19 FIX-1 (T-294-b follow-up, lane/repo from 9e63435d): "Run both" is refused when the two #! lines differ or the joined script would misrun under cmd, and the repository page says so next to Which runs before any workspace is made (nothing is asked for trust on a refused join); a failing saved setup stops the kolux.yaml part; the Guides and automation probes read repo_setup_get (no trust question); the shown kolux.yaml is labelled as the main folder copy; a blanked box resets; Remove it / Keep it click-tested; pick_setup private; setup:: 38 (4 red on assertions first), vitest 444, tsc 0, clippy -D warnings 0; Guides and ProjectsPanel hunks as evidence/repo-FIX-1-*.patch for the coordinator, no lib.rs patch; live proof pending (batched)
- [repo] 2026-10-19 FIX-2 (T-294-b follow-up, council d2/repo-f3b22ce0 items 3-5, lane/repo from f3b22ce0; evidence/repo-FIX-2.txt): the one-line `&&` join is used only when neither part holds a `#` and the saved part has no leading whitespace, so `pnpm i # deps` or `  # TODO` no longer swallow kolux.yaml's setup (line join with the status stop, run through a real sh); under Run both the runner builds the line before the trust gate, so a join cmd would misread or a #! shell this PC lacks is refused with 0 trust calls and script_trust_needed returns nothing for it; a #! naming no POSIX shell is refused under both with one accurate sentence (identical non-POSIX lines included); platform and shell finder injected (setup_for_on, shared_script_on, repo_setup_on) so the page test needs no Git and the real-sh tests print SKIPPED instead of passing silently; 10 stale allow(dead_code) comments dropped (lane lib.rs registers all ten); setupChoice.ts hasSetup comment made true; setup:: 41 (3 red on assertions first), vitest src/settings 176, tsc 0, clippy -D warnings 0; no patch for the coordinator; live proof pending (batched)
- [feedback] 2026-10-19 T-249 (lane/feedback from 34e7ea29): Send feedback now opens a message box (src/feedback) that holds the version, platform, Windows release, architecture and GitHub login (unless anonymous) under the user text, refuses empty text, replaces paths and secrets, trims a long report with a note and opens GitHub pre-filled in the browser with no request from the app; src-tauri/src/clipboard.rs places files as a real file list only for full paths inside the permitted roots and checks copied text byte for byte; 7 Rust tests (2 on the real clipboard) and 16 new TS tests, full Rust suite 1037 and full TS suite 1619 passed; lib.rs, App.tsx and GeneralPage.tsx hooks are evidence/feedback-T-249-*.patch for the coordinator, the cli, image-paste and crash-report rest is T-249-b; live proof pending (batched).
- [feedback] 2026-10-19 FIX-1 (lane/feedback from 9b6e5841): Send feedback now removes paths whose user name has a space, paths after a backtick, brace or colon, file:/// addresses and root-relative \Users paths, and private key blocks, sk_live_/rk_live_/glpat-/npm_ tokens, --password/--token values and pass: values; a title or long report with emoji no longer breaks the address (cut by code point) and a failure building the report shows in the box; a report closed with a stray click on the background is still there at the next open; the two real-clipboard tests are opt-in (#[ignore], run with cargo test --lib clipboard -- --ignored --test-threads=1) and restore the earlier clipboard through a Drop guard; the T-249 tick now claims only the built parts and the open review items sit in T-249-b; 13 new TS tests and 2 new Rust tests, full TS 1632 passed, full Rust 1036 passed with one unrelated timing test failing under machine load each run (pty term098 first run, hooks stat_006 second; both pass alone); evidence/feedback-FIX-1.txt; live proof pending (batched).
- [feedback] 2026-10-19 T-249 FIX-2 (lane/feedback from c75c2b61): Send feedback now hides a user folder in any letter case and in the Git Bash, WSL and long-path (backslash backslash question mark) spellings, hides Slack and Discord webhook addresses, Hugging Face tokens, storage keys and signatures, MYSQL_PWD, --pass, "the pass is ..." and "Authorization: token X", no longer freezes on a 40 000 character one-line paste (13 timing tests, 0 to 94 ms; the old code took minutes), and the opt-in real-clipboard run fails instead of passing when it skipped; 18 new TS tests and 1 new Rust test, full Rust suite and full TS suite 1650 passed; the T-249 tick claims only the built parts; evidence/feedback-FIX-2.txt; the three patches are unchanged and re-checked on 9e63435d; live proof pending (batched).
- 2026-10-19 · [automations] T-085-e · done · AUTO-004 agent finished: fires once on an ordinary finish (done after work seen in this process), never at a session boundary, on an interrupted turn, for a sub-agent, for a restored row never confirmed, or for a pane an automation run opened; the hooks listener feed is a one-line patch (hooks.rs is a hooks-lane hard-stop file) · evidence/T-085-e.txt
- 2026-10-19 · [automations] T-085-h · done · AUTO-011/AUTO-012 after a restart: tidy keeps each dispatched run old terminal and hook pane aside; reconnect asks the terminal service for them right after tidy: still running = followed again at once, settling over, its text so far replayed onto the run (outputFrom replay, replaced by the real end text at the finish); known ended = failed with the reason and its last text; unknown (today always, terminal numbers start over per process) = left to claim and settle as before · evidence/T-085-h.txt
- [browser] 2026-10-19 T-074 BROW-008 + BROW-009 (lane/browser from 0a301115): failed pages get a recovery overlay (what failed, Retry, Switch to HTTPS, Open Externally; local-server advice only for this computer's addresses) and a dead page is reloaded once by itself, then the crashed overlay, never a loop; detection = location.href probe 4x/s through eval_with_callback (wry gives only started/finished). Decision for Txais: the probe route over the webview2-com ProcessFailed event (no new dependency, ~1 s instead of instant). Evidence evidence/T-074.txt; patch evidence/browser-T-074-lib.rs.patch; live proof pending (batched). Also: browser FIX-5 committed 545a2c18 under v3 STEP 0a.
- [editor] T-034-b piece 1 2026-10-19 (lane/editor from 676e6a9f, main merged at b603fb22): Add Review Note and Send Notes are note commands (noteCommands.ts) with the ids editor.addReviewNote (Ctrl+Shift+A by default) and sourceControl.sendReviewNotes (no default) that were already in the shortcut table; the diff tab now reads the user's chord for Add Review Note instead of a hard-coded Ctrl+Shift+A, so a rebinding is the one that works; Send Notes pastes the workspace's line notes into its agent (patch evidence/editor-T-034-b-App-1.patch for App.tsx). 4 tests in noteCommands.test.ts.
- [editor] T-034-b piece 2 2026-10-19 (lane/editor from 06d4b386): notes in a folder workspace without Git. fileNotes.ts: plainNote (a note on a selection in a plain file, trimmed, empty refused, end line from the quote), repolessError (git's "not a git repository" or ours), noteTarget (open the file at the line, not a diff), emptyNotesHint, useRepoless(dir) (scm_status refusal). The book is already keyed by the folder alone, so keeping, listing, sending, clearing and the edited-in-flight rule need no repo (tested with a mixed-case/backslash/trailing-slash folder). Wiring is in patches evidence/editor-T-034-b-App-2.patch and evidence/editor-T-034-b-LineNotes-2.patch (apply after App-1). 4 tests in fileNotes.test.ts.
- [editor] T-034-b piece 3 2026-10-19 (lane/editor from 6d394117): notes on the old (left) side of a split diff. A LineNote may carry side "old"; diffNotes.ts gains sideOf, notesOn, where and lineLabel (the card title, the Source Control entry "old 12" and the send text say "(old side)"), and the same line on both sides sorts new first. oldSide.ts clamps an old-side line to the text the left view has and refuses an empty old side; DiffPane puts a note field and gutter plus on the left view too, opens an old-side note by switching to side-by-side and scrolling the left view, and sends the note's side with the keyboard chord by whichever view has focus. Shared files go as evidence/editor-T-034-b-App-3.patch and LineNotes-3.patch (openDiff gets a side, the list shows lineLabel). Tests: oldSideNotes.test.ts 4, DiffPane.test.ts +3. tsc 0; vitest src/editor src/keys shortcutRows 187/187. T-034-b ticked with evidence/T-034-b.txt; live proof pending (batched).
- [core] T-075 slice a 2026-10-19 (lane/core from 2e428da5): APP-048 corrupt or half-written settings.json falls back to settings.json.bak and the corrupt bytes are set aside (state.rs patch, 2 tests), settings_patch async (lib.rs patch), debounced layout writer flushed at close (src/terminal/layoutSave.ts, 4 tests; App.tsx patch); reused T-441 atomic save, PROJ-067 saved layout, TERM-106 history. Patches: evidence/core-T-075-{state.rs,lib.rs,App.tsx}.patch · evidence/T-075.txt
- [core] T-075 slice b 2026-10-19 (lane/core from 2e428da5): APP-050 final_save.rs barrier + deadline runner (3 tests), lib.rs mod line; Exit wiring + quitting() guard in evidence/core-T-075-lib.rs.patch (regenerated); clippy -D warnings clean, final_save:: 3/3.
- [core] T-075 slice c 2026-10-19 (lane/core from 2e428da5): APP-052 terminal service generation + protocol, terminal_service_info / terminal_attach (lib.rs patch registers), typing from a replaced run refused, output from a replaced run dropped, src/terminal/reattach.ts waits for the service up to a hard limit (terminal.rs 2 tests, reattach.test.ts 8); T-075 ticked a-c live proof pending (batched), T-097 + T-136-d split to T-075-b; full cargo test --lib 1073 ok · evidence/T-075.txt
- [chrome] 2026-10-19 T-049-c (lane/chrome from 6339eca2): Classic now has a title header exactly as wide as the sidebar card and no full-width top bar or screen switcher (the window buttons and search stay at the far end of the same row), the New look is unchanged; the App.tsx prop and the styles.css rules are patches for the merge resolver; live proof pending (batched).
- 2026-10-19 · [automations] T-085-g · done · AUTO-011 self-closing run tab: src/automations/runTab.ts decides (close when the run's own agent tab exits, once; keep when the user clicked, typed or pinned it; never a tab no run opened; a failed run closes too, its output lives on the Runs page) with 8 vitest tests; no Rust change; App.tsx wiring is evidence/automations-T-085-g-App.tsx.patch for the merge resolver (no terminal.rs patch); live proof pending (batched).
- [chat] T-050-c 2026-10-19 (lane/chat from 71d98945): the agent the foreground poll sees in front of a pane decides chat or terminal over the launch record (shell with claude typed by hand, orchestrator and typed-command panes, a launch whose program changed); a hand-started transcript is followed from its documented location, the pane's folder first then any folder written since the first sighting. 8 Rust + 4 TS tests on fake tables and fixtures. Patches for the resolver: evidence/chat-T-050-c-terminal.rs.patch + evidence/chat-T-050-c-foreground.rs.patch (apply together). Live proof pending (batched).
- [repo] 2026-10-19 T-225-b (lane/repo from 2f7d15db; evidence/T-225-b.txt): Source Control rules as tested pure functions in src/scm/rules.ts (23 new vitest tests, src/scm 89/89) and the panel now keeps the last good status when a reload fails, drops an older status answer, steers an equivalent-patch branch and a detached HEAD to Create pull request, disables the message box during conflicts or an operation and sums a failed commit up in one line (a lint-step failure named as one); on-screen wiring of the other rules goes to kolux-rs-after.md; live proof pending (batched).
- [repo] 2026-10-19 T-229-d (lane/repo from 2f7d15db; evidence/T-229-d.txt): pull request lookup fallbacks, check rerun and failing-log reads, AI title and description prompt and parsing, review comment reading and actions as tested Rust in pr_review.rs (12 tests, needs evidence/repo-T-229-d-lib.rs.patch), neutral checks no longer counted as passed, and the Checks panel grouped Failing / Pending / Passing with the first 100 drawn (11 new vitest tests); screens for AI text, Fix with AI and comments go to kolux-rs-after.md; live proof pending (batched).
- [repo] 2026-10-19 T-218 (lane/repo from 2f7d15db; evidence/T-218.txt): remove form keeps the branch and reports it so it is deleted later only while unmoved (projects.rs, 1 test), delete-many/forget/statuses/space scan as tested Rust in bulk.rs (6 tests, needs evidence/repo-T-218-lib.rs.patch), Space and folder-workspace rules in src/projects (11 vitest tests); screens pending
- [skills] 2026-10-19 T-243-b (lane/skills from 8d76ce1f): the Skills page now also lists the skills inside the WSL distribution the open project lives in (its home and project skill folders, asked of the distribution through a swappable runner), and an answer from WSL that is cut off or broken shows that folder as an error with the reason instead of an empty list; plugin caches inside WSL are not read yet
- [skills] 2026-10-19 T-196-b (lane/skills from 8d76ce1f): the Skills page now warns once per session when a Kolux skill installed outside Kolux is out of date, and its Update dialog lists which copies qualify (recorded by the community skills installer and not changed by hand) and why the others are kept, with a reinstall command; Update runs the installer in the background (one at a time, under the skills-folder lock) with Stop and Show log, and the result of each skill comes from a rescan; an Install panel copies the installer command. The real published Kolux skills repository is not proven yet.
- [skills] 2026-10-19 T-198-b (lane/skills from 8d76ce1f): `kolux skills install` and `kolux skills update` are built as rules in skills/cli_install.rs (skill list or all, agent list or universal, local, dry run, the detected-agents rule, JSON refused on a real run, the installer's exit status passed on, one skills-folder lock), tested with a fake installer; the route into the CLI is a patch pair for the CLI lane's files; the browser reference of the kolux-cli guide is still open
- [cli] 2026-10-19 T-250-b (lane/cli from 90a97257): kolux file open, diff and open-changed open editor and diff tabs in the running app (the window goes to the worktree first), cookie set and skills install are parsed exactly and answer not in this build yet, and the kolux command can be registered on the Windows PATH or as a Linux launcher by three app commands; the lib.rs registration and the window handling are patches for the merge resolver; tab and profiles and the Settings buttons are T-250-c; live proof pending (batched).
- [cli] 2026-10-19 T-249-b (lane/cli from 777cc3d4): the copy-files command now refuses paths that climb or link out of the permitted folder, checks the clipboard holds the very files placed and does its permission check off the async thread; the verified-copy caller switch and the feedback box focus trap are patches for the merge resolver; image paste into a terminal, the crash report button and a file-copy caller are T-249-c; live proof pending (batched).
- [worktrees] 2026-10-19 T-113-b (lane/worktrees from 14f714bd): cleanup removes only workspaces Kolux can show it made (origin record) and leaves any other, the main checkout and invented paths in place with a reason, never forcing (cleanup.rs 4 tests, projects:: 56/56); lib.rs mod + command registration in evidence/worktrees-T-113-b-lib.patch; live proof pending (batched) · evidence/T-113-b.txt
- [worktrees] 2026-10-19 T-116-c-c (lane/worktrees from bdd2bd9f): a repository can have a display name (shown in the sidebar row, picker and group tag) and its own show/hide for workspaces made outside Kolux, from its Settings page (projects:: 58/58, vitest 234/234); lib.rs registration in evidence/worktrees-T-116-c-c-lib.patch; icon on the page moves to T-302-b; live proof pending (batched) · evidence/T-116-c-c.txt
- [worktrees] 2026-10-19 T-161 (lane/worktrees from 14f714bd): a stalled git is stopped with a cloud-folder message, failed creates say what kind of problem with Git's output behind a details control, a delete of a hand-removed or too-long-path workspace is cleaned up and a registration Git still reports is never removed, older sidebar refresh never replaces a newer; 7 cargo + 1 vitest tests, projects:: git:: 97 pass; live proof pending (batched) · evidence/T-161.txt
- 2026-10-19 [repo] T-226 DONE: history list drops stale/other-worktree loads, Checks empty state starts a PR (push-and-create, 5 min readiness, per-worktree errors, review link modifier), Ports status item back end + popover; 2 patches for the resolver
- 2026-10-19 [repo] T-214-b DONE: a plain folder opens as a folder project (one folder workspace, becomes Git by itself when git init runs in it), Remove project from Kolux clears its remembered traces and ends its terminals; live proof pending
- 2026-10-19 [repo] T-215-b DONE: scan a folder for repositories (level order, ignore files, no dependency folders or links, stop keeps results) and import the ticked ones as one mirrored group or separate projects; live proof pending
- [tray] 2026-10-19 T-248-b DONE: APP-008 the real tray icon (Open Kolux / Quit, left click opens on Windows, amber dot while hidden or minimised, DEV marker + branch in icon and tooltip) in src-tauri/src/tray.rs behind the crate feature `tray` (Cargo.toml + lib.rs patches in evidence/tray-T-248-b-*.patch); notifications::show pings the tray, the test button does not. Tests app_008_a_dev_copy_reads_its_branch_from_the_checkouts_git_head, app_008_the_icon_gets_an_amber_dot_and_a_dev_marker_only_when_asked, app_008_only_a_released_left_click_on_windows_opens_the_window; evidence/T-248-b.txt; T-248-c holds the rest of the card set.
- [tray] 2026-10-19 T-125 DONE: STAT-044 paced + merged notifications with a fixed id and click-to-pane (src/notify/pacing.ts, notify_event / notification_clicked), STAT-047 the dot on T-248-b's icon, STAT-048 Windows overlay badge with the count (badge_set, paint_badge); lib.rs / App.tsx / useAgentStatus.ts patches in evidence/tray-T-125-*.patch; STAT-049 + STAT-061 + OS toast click to T-125-b; live proof pending (batched)
- [tray] 2026-10-19 T-324 DONE: APP-007 close hides to the tray (closeToTray switch, off by default; on_close_requested in tray.rs; once-only explanation; Quit sets a quitting flag and still kills every pane), USAGE 009 dot via Ping::UsageAlert; lib.rs + usage_alerts.rs patches in evidence/tray-T-324-*.patch; APP-014/019/022/032/038 + the session-end record to T-324-b; live proof pending (batched)
- [tray] 2026-10-19 FIX-1 DONE (D2 stand-in review of d6a1d645, items 1-7 + 9-12): APP-007 rewired through the page (tray_close_requested command; close hides only with a tray icon present; tray Quit and File > Exit go through the window close with a one-shot quitting flag, begin_quit; never app.exit straight), the lib.rs install patch logs instead of `?`, one event id per report (eventId), "Stay quiet" scoped to the worktree in view, tray_ping before the toast gate, T-248-b renamed T-248-d (main's T-248-b is chrome's); patches recut against 34e7ea29 (9 files, evidence/tray-*.patch; tray-T-324-lib.rs.patch dropped); evidence/tray-FIX-1.txt; live proof pending (batched)
- [tray] 2026-10-19 FIX-2 DONE (D2 stand-in review of a8c1d430, items 4-7 + 10): tray Quit ends Kolux after 5 s when the page never answers the close (QuitFlag generations, quit_fallback_due; a user at the unsaved-changes question is left alone), the tray dot repaints from its model (Dot::report), tray_close_requested acts only for the main window (WebviewWindow label), pacing.ts "fixed id" comments reworded, a "gone quiet" warning is never held back by the pacer, the no-icon switch hide deferred to T-324-b; the 9 patches are unchanged; evidence/tray-FIX-2.txt; live proof steps 10-11 in evidence/T-324.txt pending (batched)
- [tray] 2026-10-19 T-248-c joined with lane/watch: APP-008 was already built as T-248-d, so this pass added Dot::window_minimised + tray::window_minimised + the Resized hook patch (evidence/tray-T-248-c-lib.rs.patch), watch's icon() and close_to_tray() model, and evidence/tray-T-248-c-tray.rs.patch (watch tray.rs -> this lane's); overlaps with lane/watch (two badge_set commands, T-125 ticked twice) are in evidence/T-248-c.txt; tray tests 18 pass; live proof pending (batched)
- [worktrees] 2026-10-19 T-162 (lane/worktrees from c78fb8fd): deleting a workspace opened on an existing branch keeps the branch with a delete notice or one review list (a moved branch is refused), a deleted folder goes through a hidden trash and is deleted in the background and swept at launch, and project settings has Clean up workspaces (timed single-flight scan, quiet clean ones preselected, show every workspace); cleanup:: git:: projects:: 93/93, vitest cleanup.test.ts 10; lib.rs lines in evidence/worktrees-T-162-lib.patch after the T-113-b and T-116-c-c patches; live proof pending (batched) · evidence/T-162.txt
- [worktrees] 2026-10-19 T-162 data-loss fix (lane/worktrees from 8f16886f): the cleanup dialog never pre-ticks an idle workspace with unmerged commits, shows "unmerged commits" on its row, and removing it keeps its branch and hands it to the kept-branch delete notice; evidence/T-162.txt data-loss fix section.
- [shell] 2026-10-19 T-102-b (lane/shell from 9c6a2aa7): drag a pane header or a tab to rearrange the split or reorder tabs (right half after, left half before, outer band opens a new cell, self-drops do nothing) and an editor moved to another cell keeps its caret, selection and scroll; rearrange.ts + viewKeep.ts with 21 tests, window wiring as four evidence/shell-T-102-b-*.patch files; live proof pending (batched).
- [shell] 2026-10-19 T-102-c (lane/shell from 9c6a2aa7): the tab right-click menu now also has Change Title, Tab Color (eight swatches) and Split Right / Split Down that move the tab into its own pane; tabColor.ts + tabSplit.ts with 9 tests, window wiring as two evidence/shell-T-102-c-*.patch files; live proof pending (batched).
- [shell] 2026-10-19 T-219 (lane/shell from 9c6a2aa7): Ctrl+Tab now opens a recent-tab list that switches when Ctrl is released, and the next/previous tab keys move by type; fork/continue, the new-tab entry box and shell choice are tested models; 32 tests, window wiring as evidence/shell-T-219-*.patch; live proof pending (batched).
- [shell] 2026-10-19 T-220 (lane/shell from b60b5d57): a floating workspace panel (Ctrl+Alt+A) with its own terminal, agent, browser and note tabs that moves, resizes, maximizes and remembers its place, Mod+S saves only a floating editor, and pasting a screenshot pastes a saved image's path; 34 vitest + 5 cargo tests, window wiring as evidence/shell-T-220-*.patch; live proof pending (batched).
- [shell] 2026-10-19 T-246-b (lane/shell from b60b5d57): the models behind double-tap shortcuts, keeping the old tab-stepping keys on upgraded installs, the AltGr zoom help and searching launch commands; 17 vitest, wiring left to T-246-d
- [shell] 2026-10-19 T-247-b (lane/shell from b60b5d57): the rules behind ligatures and GPU on automatic, middle-click paste, OSC 52, Option as Alt, the PowerShell version and the four skippable confirmations; 13 vitest, page wiring left to T-247-d
- 2026-10-19 [repo] T-216-b DONE: drag project/group headers within their siblings, drag workspaces into a Manual order, filter the list (hide default-branch row, only some projects, clear all; retired active-only filter ignored); live proof pending
- 2026-10-19 [repo] T-217-b DONE: right-click menu on workspace rows (delete, sleep, status, parent, open in), details form (name, linked issue or pull request, formatted comment), delete a parent with its children, back/forward guard; live proof pending
- 2026-10-19 [repo] T-227-d PARTLY: line totals give up past 20,000 files (still open: other writer agents, conflicted-file note); live proof pending
- [editor] 2026-10-19 T-177 (lane/editor from 9c4a66e4): autosave (off by default, Settings pause, stands down on the changed-on-disk banner), unsaved drafts that come back after a quit or crash, rich view that leaves front matter and line endings untouched, large diffs that ask before drawing, and renames that keep the tab and its unsaved text; the lib.rs, App.tsx and ProjectsPanel.tsx hookups are patches for the merge resolver; live proof pending (batched).
- [editor] 2026-10-19 T-222-c (lane/editor from 9c4a66e4): a printed path:line Ctrl+clicked in a terminal opens the editor at that line, a link click no longer reaches a program that captures the mouse, and a restored pane keeps its program links; the App.tsx and TerminalPane.tsx hookups are patches for the merge resolver; the IME checks and the on-screen steps are live proof pending (batched).
- [editor] 2026-10-19 T-234-b piece 4 (lane/editor from 9c4a66e4, task stays open): Ctrl/Cmd+click on a link in a note preview or the rich view now follows it (web to the Kolux browser or system browser with Shift, notes to a preview, code files to the editor at the anchored line, headings by GitHub-style anchor), with the rules for [[note]] matching ready; the App.tsx hookup is a patch for the merge resolver; live proof pending (batched).
- [editor] 2026-10-19 T-235-b first piece (lane/editor from 9c4a66e4, task stays open): on macOS the replace-in-editor chord now defaults to Cmd+Alt+F; diagrams, maths, image and PDF viewers and the CI check tab are blocked (libraries, Rust file-bytes read, Checks panel data).
- [editor] 2026-10-19 T-132-b DONE (lane/editor from 9c2affed): Copy Context now works in the rich Markdown view and in single-file diffs, review notes show in a margin rail beside the rich view, and the Send menu can start a new agent with the notes; Linux primary selection left for a Linux build; App.tsx hookup is a patch for the merge resolver; live proof pending (batched).
- [editor] 2026-10-19 T-236-b second piece (lane/editor from 9c2affed, task stays open): the explorer now has a name filter, a dotfiles switch, refresh and collapse-all, and files or folders dragged in from the desktop go where they are dropped (folder on the project list adds a project), with drops over 50 files refused; git-ignored switch, size limit, live refresh and row menus remain.
- [editor] 2026-10-19 T-237-b third piece (lane/editor from 9c2affed, task stays open): notes in rich view now have a formatting toolbar (headings, bold, italic, lists, quote), and a custom Open in app can be edited; the first-save name prompt and the Changes view switch have their rules built and tested but are not on screen yet.
- [browser] 2026-10-19 T-195 (lane/browser from 421de827): agents drive the worktree's visible browser tab from the command line (goto, back, forward, reload, wait, eval, scroll, snapshot, 24 element actions, mouse and exec, through Kolux's own page driver; screenshot, full-screenshot, pdf and download refused as unsupported) and a browser tab's Annotate button collects element notes and sends them to an agent pane in the same worktree; CLI wiring, help, summaries, command registration and the pane mount travel as 4 patches (evidence/browser-T-195-*.patch).
- [browser] 2026-10-19 T-241 (lane/browser from 421de827): kolux-dev tab list|current|show|switch|create|close, profiles list|create|delete, tab profile [set|use-default|clone], cookie get|set|delete, storage get|set|clear (browser_cli.rs; the pane answers over a browser-cli event); browser_profiles.rs stores profiles in browser-profiles.json and a --profile tab gets its own WebviewBuilder data_directory; browser_preview.rs serves a document's folder from 127.0.0.1 under a per-folder token and the pane shows a folder / file chip; draw.ts holds the screenshot-drawing rules (canvas waits on a page capture; --httpOnly refused as unsupported); wiring travels as 4 patches (evidence/browser-T-241-*.patch, superseding T-195's).
- [orchestration] 2026-10-19 T-172-e ticked with live proof pending (batched): no code; every piece of council FIX-1 S1 (cli FIX-6..12) is in the merged tree, cargo test cli::tests::fix 33 passed; the live proof needs one real agent run and is a row in state/kolux-rs-after.md; lane/orchestration from 4148df12 (main 6cf66db4).
- [orchestration] 2026-10-19 T-174-b (ORCH-055) prompts land exactly once: src-tauri/src/orchestration/sendonce.rs Send state machine (settle wait with redraw restart, Windows pause 60 ms + 40 ms/KiB cap 1.5 s, 4 KiB+ paste waits for its echo, Enter once, held back as stale/cancelled/held_permission, blocked with nothing pasted while a permission prompt shows, proves_arrival, store-backed terminal send Receipts, per-terminal lane lock), 14 tests; patches evidence/orchestration-T-174-b-cli.patch and -terminal.patch for the resolver; full cargo test 1212 ok with the patches applied; decisions: pause was 300 ms flat, bare --enter is never blocked, permission marks are the public tools' phrases; live proof pending (batched); lane/orchestration from 4148df12.
- [watch] 2026-10-19 T-129-d (lane/watch from deebac56): open prompts (Claude permission, trust and question menus, Codex y/n tails, Cursor accept/reject) are read off a pane's newest output and never from restored scrollback, surfacing through the in-band status path; worker-show passes the pane's hook state (screen as fallback, an ended process never flags); worker-list lists the coordinator's own finished top-level tasks as finishedItems; the lib.rs registration, the cli.rs worker-show arm and the App.tsx label hunks are patches for the merge resolver; worker-read flags wait on T-089-d; live proof pending (batched).
- [watch] 2026-10-19 T-125 (lane/watch from deebac56): desktop notifications merge per worktree inside a 5 s cooldown with a fixed identity and a bounded memory; the tray dot counts a minimised window as hidden and keeps the DEV marker on the attention icon; the taskbar overlay or dock badge counts workspaces with unseen results and clears at zero; viewing a finished pane in a focused window marks it seen (hand-marked stays, no-status-yet keeps watching, a future turn once); Grok's ask tool reads waiting with the question and working again on its end or failure; the lib.rs, useAgentStatus.ts and App.tsx hunks are patches for the merge resolver; click-to-focus, per-pane Mark unread and the /grok route go to kolux-rs-after.md; live proof pending (batched).
- 2026-10-19 [accounts] T-171-c DONE: a managed Codex account home now gets the user's skills, plugins, prompts, rules and AGENTS.md before each launch (never sign-ins or sessions), the older release's shared settings are read when the user's own are missing, and reattaching a running pane is pinned never to wait for sign-in; ACCT-026 moved to T-171-d (waits on the importer); live proof pending
- 2026-10-19 [accounts] T-264 DONE: Settings gets the Codex session folder (empty = standard, Reset), the MiniMax usage credentials (sealed, kept/forgotten, endpoint, group, models; shown only where MiniMax is seen) and the experimental Gemini credentials switch (off until turned on); lib.rs and SettingsPage hunks are patches; live proof pending
- 2026-10-19 [worktrees] T-116-b DONE: Settings > Git & worktrees gets Rename branches after the work (on by default); a Kolux-suggested workspace's branch is renamed from an agent reply with git branch -m (never -M, never deletes; commits and tracking move with it), hand-named workspaces and the main checkout are never renamed; lib.rs patch evidence/worktrees-T-116-b-lib.patch; live proof pending
- 2026-10-19 [worktrees] T-112-b DONE: folder workspace Attached worktrees (any depth, children under their parent) and PR Checks rollup (unlinked, missing and dismissed PRs left out; failing beats pending beats passing) as pure core plus two tab components; mount is T-146-g; live proof pending
- 2026-10-19 [worktrees] T-117-b-b DONE: worktree set --workspace-status (id, label or completed; unknown writes nothing), folder:<id> as a parent on set and create, WSL /mnt/<drive> and caller-distro path resolution; cli.rs changes in evidence/worktrees-T-117-b-b-cli.patch; live proof pending
- 2026-10-19 [worktrees] T-186-b DONE: middle-band row drop sets the parent (same rules as Move to), a vanished composer parent falls back to the front folder workspace with a warning; ProjectsPanel changes in evidence/worktrees-T-186-b-ProjectsPanel.patch; live proof pending
- [shell] 2026-10-19 T-247-c (lane/shell from 52dd9745): one terminal font size key, default 13, range 8-32 on both the Terminal text and Appearance cards; 590 vitest
- [shell] 2026-10-19 T-246-d (lane/shell from 6d8cb16f): double-tap shortcuts recorded and run, the old tab-key pairing kept once on upgraded installs, the AltGr and zoom help card, and launch-command search opening How it starts; 12 new vitest, patches for App, SettingsPage, AgentsPage
- [shell] 2026-10-19 T-247-d (lane/shell from cf2feb54): the Terminal page's drawing and input card and PowerShell version card, panes follow ligatures, GPU, middle-click, OSC 52, pointer, focus-follows-mouse, wheel speed, Option and Yen settings; 11 new vitest, patches for TerminalPane, TerminalPage, package.json
- [browser] 2026-10-19 T-238-b (lane/browser from 99763733): the address bar's history drop-down (ranked by site, title and recency, previewed documents included) and downloads placed in the Downloads folder without overwriting (numbered suffix, progress strip, cancelled on tab close); 16 cargo + 9 vitest tests, patch for lib.rs
- [browser] 2026-10-20 T-179 (lane/browser from 99763733): browser tabs come back after a restart on their trail (only the shown page loads, Back/Forward fall back to the trail) and a budget of 3 hidden worktrees unloads the oldest ones' pages, sparing downloads and agent-driven pages; 7 cargo tests, no patch
- [browser] 2026-10-20 T-159 (lane/browser from 99763733): document previews are fenced to their folder: path checks before and after the join (junctions/symlinks 403), only the opened document until Allow folder (browser_preview_grant), outside addresses offered once in the pane with the full address, popups blocked, downloads refused with one notice per burst, agent commands wait for the render; 5 cargo tests; patch evidence/browser-T-159-lib.rs.patch
- [browser] 2026-10-20 T-240 (lane/browser from 99763733): built BROW-034 viewport presets (toolbar select, Default resets), BROW-033 proxy from the sealed httpProxy setting (every tab, every profile, bad value keeps the tab closed), BROW-028 cookie import from a JSON list file with per-site replace and rollback and BROW-029's Google rule, BROW-027's proxy before hand-out; left open BROW-035 (no page capture on Windows) and the installed-browser import (needs Txais); 4 cargo tests; patch evidence/browser-T-240-lib.rs.patch
- 2026-10-19 [repo] T-228-d DONE: commit messages written by any listed agent with a model and thinking effort, placeholder branches renamed after the first task, one click from unfinished work to a pull request with a progress notice; the live GitHub create and live proof pending (batched)
- 2026-10-19 [repo] T-227-d DONE: other writer agents (through T-228-d), conflicted files left out of the message diff with a note, prompts fitted to command-line limits; live proof pending (batched)
- 2026-10-19 [sessions] T-104-b DONE: zsh/bash/fish/PowerShell wrapped to print OSC 133 prompt marks (user files first), pane holds output until the first prompt and delivers the startup command once (typed or one bracketed paste), Unix shell chain bare name as is / missing path → zsh, bash, sh; patches for lib.rs, pty.rs, terminal.rs; Mac/Linux runtime boxes blocked on a Mac/Linux build
- 2026-10-19 [sessions] T-119-c DONE: pane and tab follow the running program (title and claude/codex icon from OSC 0/2 titles between the 133;C start and the next 133;A/D mark; replayed history never counts; hook word beats the title guess); patches sessions-T-119-c-TerminalPane.tsx / -App.tsx; TERM-063 dot and the auto-title switch stay named with T-124-b/T-258; live proof pending
[reliability] 2026-10-19 · T-552 ticked: root cause confirmed (WebView2 user-data folder held by the quitting instance; Tauri's own setup panicked), fix already on main (guarded_setup retry + quit-side wait), +1 tools test, 25/25 smoke flow 5 stress runs green; live proof pending (batched)
[reliability] 2026-10-19 · T-183 ticked: recovery.rs (damaged state.db set aside + restored from state.db.bak or frozen on a scratch store; icacls permission repair on per-user installs; heartbeat watch with one reload, one retry, native Retry/Cancel prompt, 3-in-10-min breaker, sleep reset; 3-in-60-s graphics burst -> --disable-gpu flag bound to the version; crash records from the log + pre-filled GitHub issue) + src/recovery; 14 cargo + 10 vitest, clippy 0, tsc 0; patches lib.rs/App.tsx/main.tsx for the resolver; live proof pending (batched)
> 2026-10-19 [watch] T-033-e batch-2 rerun: all edges already built and unit-proven (patches in the merged tree); made fix1_a_real_buffer_overflow deterministic (4 writers, long names, scm_watch.rs test only); ticked, live proof pending (batched).
> 2026-10-19 [watch] T-275: gone.ts (retire dead agents, closed-tab ledger, genuine-new-turn rule) + 2 patches for the resolver; unit-proven, live proof pending (batched).
> 2026-10-19 [watch] T-259: status/working.ts (working agents per workspace, split panes apart) + 3 patches (rows.ts, App.tsx, ProjectsPanel.tsx); unit-proven, live proof pending (batched).
> 2026-10-19 [watch] T-309-b: status/finished.ts (one early pull request round per finish, skipped hidden/unlisted/limited) + 2 patches (useAgentStatus.ts, ProjectsPanel.tsx); unit-proven, live proof pending (batched).
- [browser] 2026-10-19 T-239 (lane/browser from 68b887e7): pages get Kolux's own right-click menu (Back, Forward, Copy, open a link in Kolux or the default browser, copy its address; drawn inside the page, flipped at the pane edges), the app's keymap chords pressed inside a page are swallowed by the page script and replayed on the window so tab and global shortcuts work with the keyboard in a page (custom bindings included, Mod+C/V/X/A/Z stay in the page), a closed browser tab is remembered and Mod+Shift+T reopens it (tab.reopenClosed bound again), and the jump palette lists open pages by title and site under "Browser pages"; BROW-025 (Google sign-in identity) split to T-239-b, blocked on a run-time user-agent switch; App.tsx, actions.ts and shortcutRows.ts wiring travel as 3 patches and the T-074 lib.rs patch was regenerated to follow T-241's.
- [browser] 2026-10-19 T-242 (lane/browser from 68b887e7): the browser CLI gains intercept enable|disable|list, capture start|stop, console, network, viewport, geolocation, set device|offline|headers|credentials|media, clipboard read|write and dialog accept|dismiss on a per-tab emulation state the page script re-applies on every load (console and network recorder in the page, held requests released on disable or close, offline refuses goto and page loads, Basic credentials and extra headers on fetch/XHR, matchMedia answers, armed dialog answers, viewport cut through the pane bounds plus zoom, OS clipboard with an oversized write refused before anything runs); the layout strip gets the globe Preview button (browser_ports.rs: printed local addresses that listen, ranked printed > HTTP > smallest port; tab named Preview host:port; a page already on that origin in the workspace is focused; greyed with a hint when no server is found; arrow menu for two or more). Shared wiring left as evidence/browser-T-242-{lib.rs,App.tsx,LayoutStrip.tsx,TerminalPane.tsx}.patch; live proofs pending (batched).
- [orchestration] 2026-10-19 T-031-b ticked with live proof pending (batched): the saved-output half was already in from T-140/T-140-d/T-085-h; added runPaneKey (src/automations/runTab.ts) so View run finds a reconnected run's pane through the run row's terminal after a restart, Run.terminal in model.ts, App.tsx hunk as evidence/orchestration-T-031-b-App.patch; vitest src/automations 60 ok, tsc clean.
- [orchestration] 2026-10-19 T-173-c (ORCH-034) ticked with live proof pending (batched): src-tauri/src/orchestration/upgrade.rs upgrades our own store layouts 0..3 in place (threads for old messages and replies, receipt stamps and pending ledger, dispatch runtime/status), <key>.v<n> backups, one transaction, fail closed on an unreadable blob, a newer store left alone; lib.rs hook as evidence/orchestration-T-173-c-lib.patch; cargo test orchestration:: 59 ok, clippy clean; restart parts moved to T-173-d (blocked on T-075).
- [orchestration] 2026-10-19 T-155-b (ORCH-036, ORCH-067) ticked with live proof pending (batched): typing into a worker's terminal takes it over (sendonce TAKEN + keep_open, stop/release leave it open and say so); every worker-start dispatch gets a pass carried only in the brief's commands as --dispatch-capability, report() and Mail::ask check it, terminal read and the release archive hide it; cli.rs hunks as evidence/orchestration-T-155-b-cli.patch (after T-174-b); 5 tests; clippy 0, cargo test --lib 1220 ok with patches, orchestration:: 64 ok on the lane.
- 2026-10-19 [worktrees] T-116-b DONE: Settings > Git & worktrees gets Rename branches after the work (on by default); a Kolux-suggested workspace's branch is renamed from an agent reply with git branch -m (never -M, never deletes; commits and tracking move with it), hand-named workspaces and the main checkout are never renamed; lib.rs patch evidence/worktrees-T-116-b-lib.patch; live proof pending
- 2026-10-19 [worktrees] T-112-b DONE: folder workspace Attached worktrees (any depth, children under their parent) and PR Checks rollup (unlinked, missing and dismissed PRs left out; failing beats pending beats passing) as pure core plus two tab components; mount is T-146-g; live proof pending
- 2026-10-19 [worktrees] T-117-b-b DONE: worktree set --workspace-status (id, label or completed; unknown writes nothing), folder:<id> as a parent on set and create, WSL /mnt/<drive> and caller-distro path resolution; cli.rs changes in evidence/worktrees-T-117-b-b-cli.patch; live proof pending
- 2026-10-19 [worktrees] T-186-b DONE: middle-band row drop sets the parent (same rules as Move to), a vanished composer parent falls back to the front folder workspace with a warning; ProjectsPanel changes in evidence/worktrees-T-186-b-ProjectsPanel.patch; live proof pending
- 2026-10-19 · [automations] T-085-d · done · AUTO-004 checks failed: fires once on the step from pending or passing to failing, never on red staying red, passing, an unreadable reading or the first state learned; last state kept in the store so a restart does not refire; the poll hunk (checks lookup only while an automation listens) is a scm.rs patch for the resolver · evidence/T-085-d.txt
- 2026-10-19 · [automations] T-085-f · done · AUTO-004 the dialog's Starts list offers pull request opens, checks fail and an agent finishes, each with its own note; saved and reopened by the same event value the back end already accepts · evidence/T-085-f.txt
- 2026-10-19 · [automations] T-140-b · done · AUTO-014 a finished run saves what the agent said (its transcript: hook-reported file, else the newest one in the run's folder since dispatch) in place of the pane's screen text, noted as such on the run; no transcript means the pane text stays; the pane-exit half was already merged · evidence/T-140-b.txt
- 2026-10-19 · [automations] T-192-c · done · AUTO-009 an existing-worktree automation can keep one agent session: the next run types its prompt into the last run's tab when that pane is still open, the same pane and idle by the hooks, else opens a new tab as before; dialog checkbox; new-worktree mode refuses it; the CLI flags stay with T-197-c · evidence/T-192-c.txt
- [tasks] 2026-10-19 T-231-e (wave 16): the Tasks repository picker chooses several GitHub projects (one row each, checkouts folded, no-remote projects left out, ones being checked shown, choice kept in tasksRepos, a count, a failing host named while the others still list) and an open item starts or resumes its workspace; repoPicker.test.ts 11 + workStart.test.ts 3 failed first; vitest src/tasks 86 ok, tsc clean; App.tsx mount hunk left as evidence/tasks-T-231-e-App.patch; live proof pending (batched).
- [tasks] 2026-10-19 T-232-c (wave 16): a pull request opens as a full page (Conversation, Checks, Files changed) where Txais can close or reopen it, ask for reviews with the sixteenth refused, react, reply to threads, rerun checks and merge after a confirm; descriptions show formatted and assignees can be edited in the dialog; pull_requests.rs 8 tests and prModel/markdown 8 tests failed first; vitest src/tasks 95 ok, tsc and clippy clean; live proof pending (batched); lib.rs patch left for the coordinator; viewed-file sync, fix with AI and the rest split to T-232-d
- [tasks] 2026-10-19 FIX-1 (BEFORE a8bac8b7): every task row carries its own host (dialog, page, workspace start); thread reply sends the root id; merge pins the page head sha (409 reads "changed, reload") and needs an added repository; files/reviews/comments past 100 are paged to a cap and say when cut; unknown mergeable_state reads "still checking"; PullRequestPage component test (9) with fake DOM; pull_requests.rs 10 tests; vitest 232 files 1584 ok, cargo lib 1009 ok, clippy and tsc clean; live proof pending (batched);
- [tasks] 2026-10-19 FIX-2b (BEFORE f5123b80): a Reload that finds new commits closes the merge confirm and rereads the files; the Tasks page proven on a second host; pr_merge refuses a repository no added project has; workspaces keyed host/owner/name; backend sends the read cap; template HTML comments hidden; rerun failed includes action_required; vitest 233 files 1595 ok, cargo lib 1010 ok, clippy and tsc clean; AFTER 6 and 7 open; live proof pending (batched);
- [tasks] 2026-10-19 FIX-3b (BEFORE 2d55f2db): the merge command reads an SSH-alias origin the way the page does (an aliased remote is offered Merge and merges), the pr_merge store/remote wrapper is tested, a description whose HTML comment never closes shows as written and tilde fences keep their comments, a late files answer for an old head after a Reload is dropped; each test red on an assertion first; evidence/tasks-FIX-3b.txt; open: AFTER 6, 7 and the still-checking re-read.
- [tasks] 2026-10-19 FIX-4 wave 16 (BEFORE 9446cf2d): a pull request description with thousands of unclosed "<!--" openers now reads in one pass (16000 openers 61 s before, under 500 ms after), the pasted-link and workspace-from-link paths read the SSH config once per call and are tested through an aliased remote, the proj037 assertions no longer depend on the real ~/.ssh/config, one SSH config reader (scm::ssh_config); each test red on an assertion first; evidence/tasks-FIX-4.txt; open: AFTER 6, 7 and the still-checking re-read.
- [tasks] 2026-10-19 T-142 v3 (BEFORE d6c415ba): the workspace board (a lane per status, search across lanes, drag or Move to change status, lanes and cards windowed) over the existing status commands, 16 vitest, no Rust; App.tsx and ProjectsPanel hunks as patches; evidence/T-142.txt
- [tasks] 2026-10-19 T-176-d v3 (BEFORE d6c415ba): Tasks and the pull request page say when GitHub is unavailable (rate limit with a self-reload at the reset, timeout, outage) and walk through gh auth login; pull request file diffs over 20,000 lines or 2 MB or past an 8 MB budget are held back with the limits named and load on request (pr_file_patch); 17 cargo + 132 vitest; lib.rs and ChecksPanel hunks as patches; evidence/T-176-d.txt
- [tasks] 2026-10-19 T-281-b v3 (BEFORE d6c415ba): Tasks lists the repositories GitHub can search when one is refused and names the refused one, names a gone issue source; assignee, close and reopen edits show at once, fade out of a filter that no longer matches and undo only themselves on failure (edits.ts overlay); 90 cargo scm + 142 vitest; no shared files; evidence/T-281-b.txt
- 2026-10-19 [hooks] T-035-c DONE: a question or permission whose terminal is alive is answered from the Inbox on the spot: prompt_answer.rs keys the menu read off the ORCH-056 grid scan (highlighted = Enter, numbered = its number, y/n = y or n), types one answer per reading and refuses with a sentence when the pane is gone, the screen moved on, the keys are unsure or the reading was answered; prompt_scan.rs Prompt gains options + live_prompt (additive); lib.rs and InboxView.tsx hunks are patches; 6 unit tests; folded-row unfold and real-agent check stay open on the line; live proof pending (batched)
- 2026-10-19 [hooks] T-140-e DONE: a dispatched run keeps its agent's session id (sessionId) from the hook status that already carries it (Change.session); two patches for the resolver (automations.rs on_status session argument + test; hooks.rs call site), gated green with them applied; live proof pending (batched)
- 2026-10-20 [hooks] T-156-b DONE: the user's own protected rules (starts-with / contains / regex with SAFE-016's refusals and a size limit), per-project scopes with resets, and an in-memory recent-attempts list that masks every command through protected::mask before keeping it (protected_custom.rs + SafetyRules.tsx, 8 + 6 tests); five patches for the resolver (Cargo.toml, Cargo.lock, lib.rs, hooks.rs reply_body -> listen, SafetyPage.tsx), the hooks.rs one waiting on the open mask leaks or Txais's acceptance; live proof pending (batched)
- 2026-10-19 [cli] T-250-c DONE: the kolux command registers on macOS (link in /usr/local/bin, administrator prompt only when needed) and for an AppImage (launcher follows a moved image), Settings has a CLI card with a skill offer, file open/diff list files the window could not open as skipped; tab, profiles and cookie set came with T-241; live proof pending (batched)
- 2026-10-19 [cli] T-262-b DONE: the terminal, worktree and peer lists read the one session tab inventory so every list shows the same tabs; live proof pending (batched)
- 2026-10-19 [cli] T-279-d DONE: kolux orchestration task-reset frees a held task through the breaker reset, the task-list text line reads "held (3 failures)"; live proof pending (batched)
- [browser] 2026-10-20 T-272-c (lane/browser from eebc71ee): each tab family (the user's tab plus every tab its pages opened) gets its own five-per-ten-seconds allowance, joined through the address the opener was let open; the opener's toolbar says how many popups were blocked; live proof pending (batched)
- [browser] 2026-10-20 T-272-d (lane/browser from 383ce906): left open; a system-focus provenance guard (browser_holder.rs) drops a keyboard chord or app shortcut from a page while another page's container holds the keyboard, failing open; live reading pending
- [browser] 2026-10-20 T-283 (lane/browser from ef903551): one wake signal (a jump of the wall clock across a 5 s tick) makes every browser pane recheck its page with a fresh automatic reload, an overlaid page is retried; each page's engine process is recorded with its start moment, program and owning run, closed at the next start only when its run is gone and it still runs as recorded, and stopped at quit; KOLUX_RS_NO_HELPER_SWEEP=1/true/yes/on turns the start-up sweep off; live proof pending (batched)
- 2026-10-20 [repo] T-224-b PALETTE PART: the palette finds pull requests by number or title with their check state from the Checks panel's reads, and drops a PR the host no longer reports; Explorer toolbar and Search tab parts still open; live proof pending (batched)
- 2026-10-20 [repo] T-127-b COMMENTS PART: pull request comments as cards in the Checks tab (open, conversation, resolved or by time), reactions, replies, resolving, Add comment; other cards of the line still open; live proof pending (batched)
- 2026-10-20 [repo] T-230-d: review threads can be queued and sent to the workspace's agent (orchestration send), then replied to once and resolved; a conflicting pull request shows its files with AI resolve; live proof pending (batched)
- 2026-10-20 [repo] T-294-c: a global Settings row writes setupPolicy (local, shared or both), so a repository's Same as everywhere names a value that can be set; live proof pending (batched)
- 2026-10-20 [editor] T-236-b piece 3 (still open): Copy path in the file header, a Save / Don't save / Cancel prompt on every way of closing tabs (nothing unsaved closes without it), the untitled note's first-save name prompt, empty untitled notes removed on close; App patch for the resolver; live proof pending (batched)
- 2026-10-20 [editor] T-237-b piece 4 (still open): the tab-header view switch (Edit / Source / Rich / Table / Changes) with an editable Changes view of the last commit against the working file; rich toolbar link, image and collapsible still open; live proof pending (batched)
- 2026-10-20 [editor] T-317 piece 1 (still open): Preview for HTML files in a browser tab, a log tab that follows a growing file, a file search that starts from the editor selection, the picker filter rules; live proof pending (batched)
- 2026-10-19 [shell] T-182 DONE: single instance (named mutex, forward over the CLI port, raise by pid), close asks for unsaved files and running agents with a page watchdog and a quit deadline, save point before restart, pane PATH refreshed; four patches for the resolver; live proof pending (batched)
- 2026-10-20 [shell] T-146-e DONE: Space page (src/space/SpaceView.tsx + view.ts, 5 vitest) on T-218's rules and commands; Skills and Space in the full-page set; Floor already there; patches shell-T-146-e-TopBar.tsx / -keys / -App.tsx for the resolver; live proof pending
- 2026-10-20 [shell] T-258 DONE: tab title tooltip (data-tip, full title) and generated titles behind generatedTabTitles (off by default) in src/shell/tabTitle.ts; patch shell-T-258-App.tsx; live proof pending
- 2026-10-20 [shell] T-285 DONE (Windows parts): End all + Restart terminals in the Resource Manager via src/shell/endAll.ts; patch shell-T-285-ResourceManager.tsx; macOS SET-062 and memory pressure open (needs a Mac, DT-C41); live proof pending
- 2026-10-20 [shell] T-267 PARTIAL: pane header density (Comfortable/Compact), thin overflow bar and wheel scroll on the tab strip (src/shell/paneChrome.ts + shell.css), minimum contrast on by default; TERM-011 found built; TERM-102 ligatures left open (dependency held by Txais); patches shell-T-267-App.tsx and -TerminalPage.tsx; live proof pending
- 2026-10-20 [shell] T-310 PARTIAL: palette caps (20 a section, 20 more) and focus return, clear review notes asks first, hover-only actions visible on touch, About panel rows (Safe Graphics ahead of GPU), per-file contents-panel memory; VIEW-118 found built; Help menu About item, frontmatter toggle and contents drag width open; patches shell-T-310-*; live proof pending
- 2026-10-20 [shell] T-252 done: Tidy (Equalize drops every dragged size of the folder) and Move to Tab (pane folds into the neighbouring cell, same key and run), src/shell/tidy.ts; patches shell-T-252-App.tsx, -PaneMenu.tsx, -TerminalPane.tsx; live proof pending
- 2026-10-20 [shell] T-305 PARTIAL: one clipboard-failure notice per drag for copy on select, Cmd+A select all on macOS, floating-panel tab rename and double-tap reset on blur, tab-name search rule (src/shell/inputExtras.ts); focus follows mouse and right-click paste found built; new-tab entry box not mounted so tab search UI left open; patches shell-T-305-*; live proof pending
- 2026-10-20 [shell] T-308 PARTIAL: hollow unfocused cursor only for block and glyph rescaling (src/shell/termDraw.ts), ten tab colours with a dot (tabColor.ts + shell.css), the first plain web link click asks where links open and a Links switch on the Terminal page (src/shell/linkAsk.ts, LinkAskDialog.tsx; patches shell-T-308-*); TERM-121 found built (PROJ-033 setup tab); TERM-104 rest (Unicode 11+ widths, graphemes, Arabic shaping) open; live proof pending
- 2026-10-20 [shell] T-302-b: path fragment, found icon, behind note, outside card, scroll-to-top and Jump to current workspace, Ctrl/Cmd-click multi-select with one confirmation wired into the Projects panel (src/shell/projectsGlue.ts, ProjectsExtras.tsx; patch shell-T-302-b-ProjectsPanel.tsx); live proof pending (batched)
- 2026-10-20 [shell] T-280-b PARTIAL: editor autosave on/off and pause survive a restart, proven by src/shell/autosaveRestart.test.ts; custom sound location and the older right-sidebar key stay open
- 2026-10-20 [hooks] T-257 DONE: busy dots and tab icons credit the agent launched in a pane (its launch record), MiMo / Pi-style / Cursor title patterns recognised, a title naming another agent claims nothing; the worktree working count now counts Cursor, MiMo and Pi panes (src/status/credit.ts + working.ts, 6 new tests); patches App.tsx then TerminalPane.tsx for the resolver; live proof pending (batched)
- 2026-10-20 [hooks] T-271 DONE: the floating workspace opens only in folders picked in the system folder picker (store-kept list no interface list can reach, cleaned at load with unreachable entries kept, old single folder moved in once, every unpicked folder refused; floating_trust.rs 5 tests + floating/trusted.ts 4 tests); patches lib.rs then FloatingLayer.tsx for the resolver; live proof pending (batched)
- 2026-10-20 [hooks] T-124-b PART (left open): a terminal title's agent is decided only by marks the agent prints (src/status/titleOwner.ts, 3 tests; credit.ts uses it); patch shellMarks.ts for the resolver; rest blocked by T-258, the src/settings and src/terminal lanes and a real Gemini run
- 2026-10-20 [hooks] T-121 PART (left open): Cursor Agent, Droid and Kimi Code status hooks from their public docs (agent_hooks/more.rs, 13 tests; status.rs routes Vendor events through it, Droid never reads Ctrl+C as an interruption; saved.rs replays the new routes); patches mod.rs, switch.rs, hooks.rs, tests.rs for the resolver; open: STAT-013 PermissionRequest and STAT-015 limit fields undocumented, STAT-014 Command Code and STAT-016 Hermes have no usable public source
- 2026-10-20 [hooks] T-122 PART (left open): Copilot CLI status hooks from GitHub's public hook reference (Kolux's own kolux-rs.json in Copilot's home, 2 tests in agent_hooks/more_tests.rs); patches mod.rs, tests.rs after T-121's; open: Grok (quit hook in lib.rs), Devin (JSONC writer), MiMo Code and Pi/OMP (no reference checked)
- [look] 2026-10-20 T-546-b (lane/look from 17a0bd18): the open rules were checked against main: the Tower tab, the Show Tower command (no chord) and the App mount are all on main and keymap.test counts 134 / 55 and passes; the three choices left (chord, strip link, row naming) are after-rows; live proof pending (batched).
- [look] 2026-10-20 T-550 (lane/look from 17a0bd18): clicking the usage pill in the top bar now opens Settings > Accounts & keys already scrolled to the AI connections cards, and the user guide no longer calls the pill read-only; live proof pending (batched).
- [look] 2026-10-20 T-546-c (lane/look from 17a0bd18): the Tower in its own window for a second screen is fully wired on main (permission, close handling, page for the window, bridge) with the listbox fix; Refresh pressed in the Tower window is the one live step still to see; live proof pending (batched).
- [browser] 2026-10-20 T-158 (lane/browser from b93b698d): left open; sized window.open requests open a small popup window on the opener's engine (title bar = origin strip + page title, not-secure mark for remote http, closes with its tab, system browser before the tab's first load), certificate trust rules for local dev servers as a pure policy (engine event unreachable without webview2-com), Google cookie toast advice and needs_key, grabbed page details scrubbed (safe attributes, 16 styles, masked secrets, bare addresses); passkey chooser open
- [browser] 2026-10-20 T-251 (lane/browser from 052de9ff): left open; storage local|session word forms, scroll left|right, empty --pass kept, --expires a finite number from 0 (0 = session), --httpOnly cookies set through the engine's store on the page's site only, screenshot --format png|jpeg checked, wait timeout never claims Kolux is down; help + agent-context by patch; capture verbs still refused (no webview2-com)
- 2026-10-20 [onboarding] T-244-b DONE: the CLI step and CLI tip register the command system-wide, show Installed or Needs attention, and type the skills installer command into a small inline terminal without running it; live proof pending (batched)
- 2026-10-20 [onboarding] T-245-b DONE: board, browser, floating-workspace and workspace-creation tours added with their fallbacks, the browser tour always counts three, waiting tours stop on page change, another tour or a switched-off feature, and the parallel tour hands over into the composer; cookie import only shows as a step; live proof pending (batched)
- 2026-10-20 [onboarding] T-322-b DONE: ONB-025 demos, ONB-037/038 star prompt (STAR_REPO empty per OD-16), ONB 029 double-tap caps, T-208-c star hook; patch evidence/onboarding-T-322-b-lib.patch; live proof pending (batched)
- 2026-10-20 [onboarding] T-298-b DONE: ONB 011 rest milestone times in the copied terminal diagnostics; patch evidence/onboarding-T-298-b-TerminalPane.patch; live proof pending (batched)
- [browser] 2026-10-20 T-272-c (lane/browser from eebc71ee): each tab family (the user's tab plus every tab its pages opened) gets its own five-per-ten-seconds allowance, joined through the address the opener was let open; the opener's toolbar says how many popups were blocked; live proof pending (batched)
- [browser] 2026-10-20 T-272-d (lane/browser from 383ce906): left open; a system-focus provenance guard (browser_holder.rs) drops a keyboard chord or app shortcut from a page while another page's container holds the keyboard, failing open; live reading pending
- [browser] 2026-10-20 T-283 (lane/browser from ef903551): one wake signal (a jump of the wall clock across a 5 s tick) makes every browser pane recheck its page with a fresh automatic reload, an overlaid page is retried; each page's engine process is recorded with its start moment, program and owning run, closed at the next start only when its run is gone and it still runs as recorded, and stopped at quit; KOLUX_RS_NO_HELPER_SWEEP=1/true/yes/on turns the start-up sweep off; live proof pending (batched)
> 2026-10-20 [chat] T-325-b: omp chat reader (session log, home variables, finder, tool rows) + CHAT-002 support, terminal.rs patch for the resolver; Grok left open (no public session-file format); unit-proven, live proof pending (batched).
> 2026-10-20 [chat] T-329-b: a chat file link opens the editor at its line and column, and Settings > General gets the Open-links-in-Kolux switch; fileJump and linksOpenInKolux unit-tested in the lane, EditorPane + App + GeneralPage patches for the resolver; live proof pending (batched).
> 2026-10-20 [chat] T-327-b: the agent's multiple-choice question shows as a card in the chat (options, free text, steps, Sending/Cancel) and its answer is typed as option numbers through the existing send queue; Select All and Paste from the app menu act on the message box; App.tsx patch for the resolver; unit-proven, live proof pending (batched).
> 2026-10-20 [chat] T-334: the message box suggests / commands, skills and @ files, has Model, Effort and Fast controls beside Send, takes pasted, dropped and picked files as chips, the chat text zooms with Ctrl plus, minus, zero and a long chat loads in pages of 200; App.tsx patch for the zoom chords; unit-proven, live proof pending (batched).
> 2026-10-20 [hooks] T-122 batch 4: Grok status with Kolux's own hook file, kept when hand-edited or emptied and removed at quit unless another running Kolux owns it (lib.rs exit patch); Devin status through marked comment blocks in its commented config.json, removed byte for byte; MiMo Code and Pi/OMP left open (no public hook source); T-122 left open; unit-proven, live proof pending (batched).
- 2026-10-20 · [automations] T-197-c · done · CLI-029 automations create / edit take --reuse-session / --fresh-session (refused together or with a new worktree per run); CLI-028 rows carry host, orphaned and recovery steps, edit and run of an orphan are refused with owned_elsewhere, an edit that lost the owner race says owner_conflict; next-step values are quoted for the shell; account add sign-in output goes to stderr; shared-file edits ship as two patches; ask 75 stays in T-089-d, tmux in T-255 · evidence/T-197-c.txt
- [browser] 2026-10-20 T-158 (lane/browser from 406e41da): done; WebView2's certificate-error event now answers from the local-dev-server trust rules (allow only an approved certificate for that origin and tab, cancel everything else, never the engine's click-through), Trust button on the load overlay, Stop Trusting in the page menu clears the engine's allowances, webview2-com =0.39.1 + windows =0.62.2 direct deps via evidence/browser-T-158-b-Cargo.toml.patch (no new crate in Cargo.lock), browser_cert registered by evidence/browser-T-158-b-lib.rs.patch; passkey chooser blocked (no platform passkey API through tauri 2.12 / wry 0.57); live proof pending (batched)
- [browser] 2026-10-20 T-251 (lane/browser from 55ab50c5): done; screenshot / full-screenshot write the engine's DevTools picture (png or jpeg, whole page by layout metrics, bytes = decoded size), pdf prints through the engine's PrintToPdf, download clicks the element with the tab's next download armed to the path and waits for the end (120 s); --path confined to the worktree by kolux file's rule, never overwritten, default captures/ in the app data folder; cli.rs and local_cli.rs patches regenerated; live proof pending (batched)
- [browser] 2026-10-20 T-272-d (lane/browser from fea63414): done, live proof pending; the WebView2 accelerator-key event backs each page's keyboard chords and app shortcuts with a real key press in that very page (browser_engine.rs hook, browser_holder.rs pure logic)
- [browser] 2026-10-20 T-286-b (lane/browser from 4d5e3390): left open; crash records from the WebView2 process-failed event (browser_crash.rs pure logic, browser_engine.rs hook, lib.rs and recovery.rs patches); late crash dumps, crash-dump module, store-side retry and the reliability lane's part remain; live proof pending
- [tasks] 2026-10-20 T-314-d v3 (BEFORE 343984ba): the Projects table edits an issue's assignees and issue type on the issue itself and a repository not in Kolux offers to be added (clone dialog opened on its copy step); github 40 cargo, 150 vitest src/tasks; also Enter in a cell editor no longer reopens it; lib.rs registration as a patch; evidence/T-314-d.txt
- [tasks] 2026-10-20 T-315-b v3 (BEFORE 343984ba): a pasted GitHub link in the worktree switcher opens its linked workspace else the item, Alt+digit picks the numbered row; CLI open-changed already built (T-250-b); src/projects + src/scm 305 vitest, tsc 0; App.tsx wiring as a patch; evidence/T-315-b.txt
- 2026-10-20 [worktrees] T-107-d DONE: the first prompt in a Kolux-named workspace renames the branch once from the task (never hand-named, pushed, pull-request or already-renamed branches; git branch -m only); lib/App/ProjectsPanel patches for the resolver; live proof pending
- 2026-10-20 [worktrees] T-110-b BUILT (line stays open: COMPAT 5.5 alias variable names unknown): the first prompt renames the branch and asks before the folder follows (git worktree move, never deletes; Git refusal shown in full); renameFolders switch; plain folders get a title only; lib/App patches for the resolver; live proof pending
- 2026-10-20 [worktrees] T-303 BUILT (Opus 5.5): :shortcode: emoji in rename (PROJ-061), quiet background prune + gc only (PROJ-069), delete-under-pointer rules incl. folder workspaces forgotten (PROJ-075), cleanup search/filters/sort with lazy sizes (PROJ-081), off-by-default *.localhost:4580 label proxy, http only, 0.0.0.0 to loopback (PROJ-088); lib/ProjectsPanel patches for the resolver; live proof pending
> 2026-10-20 [launch] T-163: agents.rs refuses an unstartable agent by name before any pane exists + agent_prompt_send (send-once, exactly once, says why when not sent) + src/launch/startWatch.ts (5 s no-process warning) + 3 patches for the resolver (lib.rs, App.tsx, TerminalPane.tsx); unit-proven, live proof pending (batched).
> 2026-10-20 [launch] T-150: src/launch/launchOrder.ts settles each new workspace's setup (trust question, Setup tab or a visible reason) before hook trust and agent start, and refuses a bulk launch of an ask-each-time project before anything is made; setup launch mode per repository (new tab default); 5 patches for the resolver (setup.rs, lib.rs, setupChoice.ts, RepoSetup.tsx, App.tsx); unit-proven, live proof pending (batched). Opus 5.5.
> 2026-10-20 [core] T-223-b: TERM-120 a new terminal's PATH is the registry's machine then user Path read at every start (pty.rs terminal_path / fresh_terminal_path, wired in terminal.rs spawn), last good read kept when the registry fails; PowerShell console UTF-8 first via evidence/core-T-223-b-shell_marks.rs.patch; 4 cargo tests; live proof pending (batched).
> 2026-10-20 [core] T-254: ACCT-060 modeReset.ts (modes off + cursor shown inside xterm at program exit), ACCT-061 links.ts allowed/safeLinks on all three providers, ACCT-053 trim_history char boundary + UTF-8 console (T-223-b); 10 vitest cases + 1 cargo test; ACCT-052 split to T-254-b (needs a Mac build); live proof pending (batched).
> 2026-10-20 [core] T-274: TERM-095 links.ts LINK_SCAN_CAP (spanOf stops at 16 KiB, a 1 MB line costs a bounded walk and no scan), TERM-137 terminal.rs shell_hook_dir (hook files under <app data>/shell/<hex of contents>/, other builds' folders untouched and never loaded, missing files rewritten at the next pane start); 2 vitest cases + 1 cargo test; live proof pending (batched).
> 2026-10-20 [core] T-279-b: ORCH-057 rest (terminal.rs Snap per session + seq on output events + snapshot answer on terminal_ack after a flow give-up, resync.ts; queries.ts DA1 Windows answer, XTVERSION, hidden Grok holds version answers only, palette-brightness dark-or-light; exit outcome unverifiable), ORCH-059 rest (kill drops screen bits/snapshot, fresh_incarnation on id reuse); 8 vitest cases + 2 cargo tests; live proof pending (batched).
- [core] 2026-10-20 T-306 (lane/core from bd48395d): TERM-082 kittyKeys.ts (enhanced keyboard protocol, flag stacks per screen, reset at exit and ESC c), TERM-086 latinControl, TERM-085 terminal_next_input_source (lib.rs patch evidence/core-T-306-lib.rs.patch); TERM-073/084/087 already built under SET-025; decision: TERM-073 macOS default follows SET-025 (on), after-list row.
- [core] 2026-10-20 T-253 (lane/core from 402c9b6c): VIEW-109 keyLayout.ts (layout-following punctuation labels; patch keymap.ts), IME guard on the window chord handler (patch App.tsx); VIEW-110 copy.ts COPY_CAP 10 MiB too-big notice, OSC 52 older off overridden once (inputPrefs osc52On/osc52Save; patch InputCards.tsx); decisions: copy cap 10 MiB, letters/digits keep US labels.
- [core] 2026-10-20 T-307-b partial (lane/core from 0f2b7058): TERM-088 Shift hint + modes reset after a history replay, TERM-089 mouseFeel.ts WheelDrain (normal 1.15, full-screen 1), TERM-091 row kept over a tab switch; TERM-094 / VIEW-105 left open (overlap with shell T-308 link-click patch).
- [sessions] 2026-10-20 T-169 (lane/sessions from 7a314925): the Agents tab lists the past sessions of Claude and Codex with titles (sub-agents and workers left out, the user's session folder and chosen Codex home first), refreshes from a cache with a forced rescan and never draws results while the user is typing, and Resume opens a terminal on the agent's resume line in the session's folder or Copy command copies it written for PowerShell, cmd or POSIX; the shared-file hunks are evidence/sessions-T-169-*.patch
- [sessions] 2026-10-20 T-168 (lane/sessions from 7a314925): the Agents tab gains search (words, quoted phrases, repo:, path:; an oversized paste matches nothing), a workspace/project/all picker whose manual choice stays, and Options (order, grouping, show per agent, hide empty, depth with Unlimited, Reset with a changed-count) saved in settings; a window follows another window's saved screen only on a real change and never leaves an open page; a fork push names the fork, a push refused as behind offers Pull first, failures stay until dismissed, and the agent fix hides with Source Control AI actions. Shared wiring left as evidence/sessions-T-168-{App.tsx,scm}.patch; live proof pending (batched).
- [sessions] 2026-10-20 T-261 (lane/sessions from 7a314925): a session id now belongs to one pane at a time (the pane that reports it takes it over, a saved layout holding it twice gives it to the newest tab) and a fork is recorded as a fork of its source and never resumed as it. Shared wiring left as evidence/sessions-T-261-{useAgentStatus,layout,App.tsx}.patch; live proof pending (batched).
- [chrome] 2026-10-20 T-164-b v3 (BEFORE bb826916): Mod+Shift+T reopens closed terminal tabs in their folder (ten kept, newest first, in close order with browser pages) through src/chrome/reopenTab.ts; reopenTab.test.ts 10 tests; App.tsx hunk left as evidence/chrome-T-164-b-App.tsx.patch; evidence/T-164-b.txt
- 2026-10-20 [tasks] T-281 RE-LANDED (Opus 5.5): per-worktree limiter for short git reads only (long-running commands exempt, no app-wide cap, hung reads stopped with their process tree), huge change sets cut with a heavy-folder ignore offer, Tasks empty/no-access/expired reasons, optimistic label and reviewer edits; lib patch evidence/tasks-T-281-lib.patch; live proof pending (batched)
- [orchestration] 2026-10-20 T-312 v3 (BEFORE 27443937): agents get file list, read and rename inside their worktree (both rename paths checked, links followed, letter-case renames allowed), git branch and git pr read in the worktree folder (never pushing), sessions list with titles from a 30 s shared cache, and automations mine that settles the owning repo first; ORCH-061 page leases split to T-312-b (browser lane host); patches orchestration-T-312-cli and -local_cli; live proof pending (batched)
- [orchestration] 2026-10-20 T-255 v3 (BEFORE 46d15306): LEFT OPEN, Agent Teams teammate panes host-neutral half built in orchestration/teams.rs (16 tests); blocked: Claude Code documents split panes only via tmux/iTerm2, no host-terminal interface; T-191-c open on the same blocker
- 2026-10-20 [shell] T-305 DONE (Sonnet 5.5): TERM-053 tab search box mounted (TabSearch.tsx + findTab.ts, command tab.search Mod+Shift+K, palette row Search open tabs); App/actions/keymap/shortcutRows patches for the resolver; live proof pending
- 2026-10-20 [shell] T-310 DONE (Sonnet 5.5): VIEW-106 Help > About item, VIEW-113 front matter control + draggable contents width, VIEW-072 send-notes id test; App/EditorPane/menu.rs patches for the resolver; live proof pending
- 2026-10-20 [shell] T-280-b (open): custom notification sound location restart proof (customSoundRestart.test.ts); right-sidebar older key still waits on Txais
- 2026-10-20 [reliability] T-286-b (Opus stand-in) built, left open: crash records count only real crashes (clean ends, quits and Kolux's own restarts excluded), keep the newest five, merge repeats within 30 s and late dumps, carry the last memory reading and the faulting module read from the engine's crash dumps (crashdump.rs, recovery.rs); the watch repaints every window after a wake; hidden.ts holds updates while hidden and replays them on show; every window excused from background throttling (12 Rust + 5 vitest tests); patches lib.rs, browser.rs, update.rs, tauri.conf.json, ClaudePill.tsx; open: the WebView2 process-failed event (not exposed without webview2-com), sessions per host (no hosts yet); live proof pending (batched)
- 2026-10-20 [reliability] T-293 (Opus stand-in) DONE: a downloaded update's Windows publisher must match the running copy's (or the pinned one); a mismatch, an unsigned installer for a signed copy or a damaged signature stops it with a security stop card and no install button, and the refused version is never offered again; unsigned copies take unsigned or validly signed installers; 9 Rust + 1 vitest tests; patches update.rs (+resources.rs line), UpdateCenter.tsx (+card.ts, card.test.ts); live proof pending (batched)
- 2026-10-20 [reliability] T-199 (Opus stand-in) PARTIAL, left open: APP-028 (failed install reported at the next launch with Try again and the installer page), APP-029 (Restart to update installs, or stays open with the plain cause and Restart again; a 20 s watchdog), APP-031 (half-published release explained calmly and re-checked, protocol errors offer compatibility mode) built in resources/update_care.rs + 3 patches; APP-061 open (needs a packaged-app launch and a migration command). Gates: cargo test update 40, clippy 0, tsc 0, vitest 42 patched / 39 unpatched.
- 2026-10-20 [hooks] T-124-b PART (Opus 5.5): generated-titles switch on Settings > Agents, tab-name rule (ready / action required for Codex, Devin, Pi, OMP; shared spinner beat), Notifications master switch + Open Settings on a failed test; 6 patches for the resolver; left open: Gemini title symbols (real run), STAT 034 provider-session hunk; live proof pending
- 2026-10-20 [hooks] T-122 PART (Opus 5.5): Pi status through Kolux's own extension file kolux-rs.ts in Pi's extensions folder (STAT 021 Pi part; user extensions untouched, foreign file refused); mod/tests patches for the resolver; left open: Pi needs-you (no documented dialog event), OMP (no public source), MiMo; live proof pending
- 2026-10-20 [hooks] T-121 RECHECK (Opus 5.5): public docs rechecked for Droid PermissionRequest (still absent), Command Code (none), Hermes (shell hooks and approval hooks now documented, plugins.enabled format not; design call on the after-list); nothing built, still open
- 2026-10-20 [hooks] T-121 PART (Opus 5.5): STAT-016 Hermes status built through its documented config.yaml shell hooks (coordinator default): marked YAML blocks with a checksum, allowlist pairs, 13 events; patches hooks-T-121-2-mod.rs / -T-121-2-tests.rs; still open STAT-013/014/015
- 2026-10-20 [sessions] T-276 (Sonnet 5.5): session scan Report (skipped, cut short, unreadable index, no folder), on-disk summary cache with version stamp, joined overlapping scans, 25 s budget, running-only WSL roots; Agents tab notices and a memoised panel (VIEW-090/092/115); live proof pending
- 2026-10-20 [sessions] T-146-g (Sonnet 5.5): folder-workspace right-sidebar tabs (Attached, PR Checks, remembered PR Checks per folder) as src/sessions/folderTabs.ts + useWorkspaceKind.ts; RightSidebar/App patches for the coordinator; Search tab waits on T-236; live proof pending
- 2026-10-20 [sessions] T-069-c (Sonnet 5.5): restored tabs rebuilt in session (key) order in one sort, src/sessions/restoreOrder.ts; layout.ts patch for the core lane; live proof pending
- 2026-10-20 [repo] T-313-b PARTS DONE: fork push flag and notice, submodule warning on worktree removal, editable Open in list in the file menu, stack map with merge through #n, AI recipe rules and per-repository AI mode; GIT-019 recipe running and GIT-034 stacked create stay open; needs 8 patches (evidence/T-313-b.txt); live proof pending (batched)
- 2026-10-20 [repo] T-232-d DONE: viewed marks synced with GitHub, Fix with AI on failed checks, fork owner and parent, pasted issue/PR/#n address strip, editable description and labels, Start/Resume workspace and recent-editor reviewer picks on the full pull request page; patch repo-T-232-d-lib.rs (after the 4 repo-T-313-b patches, which are the only others pending); live proof pending
- 2026-10-20 [repo] T-313-b DONE: GIT-019 recipes run for commit messages and Fix with AI ({variable} expansion refuses unknown names, per-word, shell-free), GIT-034 next stacked PR created and the stack note written idempotently into every PR body; new patches repo-T-313-b-lib2.rs and repo-T-313-b-App.tsx apply after repo-T-313-b-GitPage.tsx, -lib.rs (regenerated), -scm.rs, -projects.rs, repo-T-232-d-lib.rs; live proof pending (batched)
- 2026-10-20 [hooks] T-121 owner FIX (Hermes consent = let Hermes ask, Txais 2026-10-20): agent_hooks/hermes.rs no longer writes or cleans Hermes's shell-hooks-allowlist.json (only reads it for the consent hint); config.yaml marked blocks unchanged; older Kolux-written pairs are left alone (no per-pair record; after-list AFTER row); T-121 stays open; live proof pending (batched)
- 2026-10-20 [hooks] T-124-b DONE: STAT 034 rest built (src/status/inbandSession.ts: an in-band new turn drops the stored provider session, a completion keeps it; wired by useAgentStatus.ts and patch hooks-T-124-b-TerminalPane.tsx), STAT 035 rest confirmed live on main through T-258's tabTitle.ts; STAT 033 Gemini CLI title symbols moved to new T-124-d (needs a real Gemini run); live proof pending (batched)
- 2026-10-20 [automations] T-187-b DONE: SESS-031 carry a past conversation to another (or the same) agent through a Continue dialog, SESS-033 start an agent on failing pull-request checks, SESS-034 start an agent from an issue or pull request; patches automations-T-187-b-lib.rs.patch, -App.patch, -ChecksPanel.patch, -TasksPage.patch, -AgentsPanel.patch, independent of each other; live proof pending (batched)
- 2026-10-20 [automations] T-189-b DONE: VIEW-011 Skills page shown again after a restart (patch automations-T-189-b-general.patch; the Skills button was already the T-243 sidebar switch) and VIEW-087 continue a past session with the same or another agent (the T-187-b dialog, via automations-T-187-b-AgentsPanel.patch); live proof pending (batched)
[core] 2026-10-20 T-307-b ticked (Opus): link action menu (TERM-094, VIEW-105 by DT-39) built with the TERM-135 first-click question; plain Ctrl+click asks until answered then opens; Ctrl+right-click on a link opens the menu (coordinator default, Txais may overrule); settings switch via evidence/core-T-307-b-TerminalPage.tsx.patch; live proof pending (batched).
[orchestration] 2026-10-20 T-030-b ticked (Opus): ORCH-007 idle mail pointer in orchestration/pointer.rs against hook state (stand-in hook events in tests), cli.rs side as evidence/orchestration-T-030-b-cli.patch; worker-show/worker-read stay with T-089-d; live proof pending (batched).
[orchestration] 2026-10-20 T-172-d ticked (Opus): coordinator default (Txais may overrule): worker-start asks the window to run the trust question and setup once and waits (orchestration/setup_gate.rs, src/orchestration/workerSetup.ts); a failed setup fails the start at the setup stage with its exit code; kept terminal after restart dropped (DT-C27); cli/lib/App/useWorkspaces sides as evidence/orchestration-T-172-d-*.patch; live proof pending (batched).
[orchestration] 2026-10-20 T-173-d ticked (Opus): coordinator default under DT-C27 (Txais may overrule): workers live at a quit or crash come back cut short, outcome unknown, with worker-stop / worker-start recovery steps (orchestration/restart.rs from upgrade::at_start); re-attach, settled tabs and the terminal service with instance lock deferred (DT-C27); live proof pending (batched).
- 2026-10-20 [editor] T-236-b: the explorer has row menus, a 3-second live refresh, a git-ignored switch and a 1 GiB drop check, Mod+Shift+F wakes a hidden explorer, and a tab says when its file was deleted; live proof pending (batched)
- 2026-10-20 [editor] T-237-b: the rich toolbar has Link, Image and a Collapsible section (a details block the rich view reads and writes); live proof pending (batched)
- 2026-10-20 [editor] T-317: the Base branch box in automations narrows as you type, the settings search waits a moment before filtering, and App can open a followed log; two small callers still open
- 2026-10-20 [editor] T-234-b: tables show hover controls and a right-click menu, code blocks have a language label, cut with nothing selected takes the block, Ctrl+K adds a link and typing [[ lists the notes; code colouring, link bubble, images and source underline still open; live proof pending (batched)
- 2026-10-20 [editor] T-323-b: All Changes starts from the diff choices in Settings > General and the Explorer's Open in menu lists the apps set there, in order; file and keybindings-file Open in, proxy and Warp/Ghostty scan still open; live proof pending (batched)
- 2026-10-20 [onboarding] T-208-c DONE: ONB 008 older wizards mapped (version 6 view-choice moves back one, versions below restart at screen one unless completed with enough steps; coordinator default numbers); ONB 010 rest needs no code (no setting opens a session as chat); live proof pending (batched)
- 2026-10-20 [onboarding] T-322-c DONE: five noteUse patches (palette, workspace-create, board, tasks, automations, skill-setup), legacy split-pane credit ticks Multi-task, moved-control hint for the usage move; patches evidence/onboarding-T-322-c-*.patch; live proof pending (batched)
- 2026-10-20 [onboarding] T-181 DONE: settings follow every window (settings-saved now carries the redacted change), values tidied on save and load, draft text fields (useDraft in Git and Agents pages), picker/number/segment/Ctrl+Enter rules; patch evidence/onboarding-T-181-lib.patch; live proof pending (batched)
- 2026-10-20 [onboarding] T-311 DONE: settings search finds each provider's card and accounts, commit-writer model lists remembered per agent with a built-in fallback, Tasks source falls back to GitHub and shows unavailable when gh is signed out, Review bots field in Settings > Git; ACCT-033 discovery, ACCT-058 matching and ACCT-062 Nim colours were already built; two patches pending (WriterPicker, TasksPage); live proof pending (batched)
- [browser] 2026-10-20 T-240 second pass (lane/browser from 317d2fda): left open (grab a page element only); Import from Google Chrome built as a guided cookies.txt export (Chrome's store never opened) plus the cookies.txt importer (tabs, #HttpOnly_, comments, CRLF, malformed lines counted by line number, never by value); toolbar menu Chrome / file, off while importing; merge build fix in browser_crash.rs; live proof pending (batched)
- [i18n] 2026-10-20 T-210-c (lane/i18n from ebaaf05b): machine-translated packs es, fr, ja, zh-CN, ko (16 keys each) with META, registerBundledPacks, pack test; main.tsx and AppearancePage.tsx change as patches; live proof pending (batched).
- [i18n] 2026-10-20 T-213 (lane/i18n from b9c22233): former-name settings carry-over rebuilt as an allow-list importer in import.rs (one settings file read, 34 typed settings on the list, secret-like names/values skipped, preview/apply/counts-only summary, lock file, fenced profiles never); start-up call as evidence/i18n-T-213-lib.patch; projects/repos/worktrees blocked on T-213-b (no allowed source describes their former shape). Decision for Txais (OD-19): the carried-settings list is import::CARRIED, by the rebuild's own names; kolux.-prefixed interface preferences are not carried (window storage). Live proof pending (batched).
- 2026-10-20 [look] T-301: Settings > Appearance ends with an App icon card (Classic, Watercolor, Blue drawn from the Kolux mark; the taskbar icon changes at once) and a window background blur switch (Acrylic, off by default); four shared-file patches for the resolver.
- 2026-10-20 [look] T-302-c: a project whose package.json names a web picture or a homepage, or whose page source links an https icon, now gets that icon, fetched in Rust behind the browser pane's guarded client (https only, never a local address, redirects re-checked, 4 s, size cap); three shared-file patches for the resolver.
- 2026-10-20 [look] T-266-b: a workspace card's hover now also lists its ports (the scan the status bar uses, asked for the hovered workspace) and its task (the linked issue or pull request number); both are two more ticks in Card details, in no preset; sidebar wiring is one shared-file patch for the resolver.
- 2026-10-20 [accounts] T-548-b PARTLY: Codex plan figures are read per account (new codex_usage_of command, a figures-by-account store, the Tower row shows each account's own numbers); pane gauge, tab ring, Agents footer and Board card follow via three shared-file patches; the Claude half waits on T-547.
- 2026-10-20 [accounts] T-139-d PARTLY: a running Codex pane is asked to restart when the Codex command, arguments, variables or permissions change in Settings, and a restored pane is asked again about its account after a restart; the pane-output scan for Codex sign-in errors is handed up.
- [browser] 2026-10-20 T-239-b (lane/browser from 18c45db9): ticked; Firefox identity on the Google and YouTube sign-in hosts with no client hints, per-profile native mode, popups follow; cli.rs help patch; live proof pending (batched)
- [browser] 2026-10-20 T-272-b (lane/browser from bbb623cd): ticked; permission requests answered by one rule set, refusals named in the pane toolbar; Mac prompt, popups and remount queue are after rows; live proof pending (batched)
- 2026-10-20 [skills] T-292-b (Sonnet 5.5): freshness pill, status bar skill update item (count, fading check, failure kept until clicked) built as pure rules + injectable-clock store; patches skills-T-292-b-App/-StatusBar/-styles; live proof pending
- 2026-10-20 [hooks] T-156-b acceptance met (Opus, batch 8): the attempts list masks command, rule text and folder through protected::mask when kept and when listed (tokens, env-file lines, PEM blocks, URL credentials, Authorization headers proven); hooks.rs wiring applied in the lane per Txais 2026-10-20; coordinator patch evidence/hooks-T-156-b-2-lib.rs.patch; live proof pending (batched)
- 2026-10-20 [hooks] T-167-b partly built, left open (Opus, batch 8): STAT-037 record also taken at workspace sleep (agent_hooks/saved.rs at_sleep, coordinator patch evidence/hooks-T-167-b-projects.rs.patch); still open: unconfirmed restored rows on panes (design call), blocked row after an upgrade, child rows kept while alive, Mac/Linux limits (DT-C41)
- 2026-10-20 [editor] T-235-b piece 3 partly built, left open (Sonnet): diagrams and maths drawn in the rich view as a panel under the block the caret is in (richDraw.ts, DrawPanel.tsx); image and PDF viewers wait on a file-bytes read (files.rs) and a PDF library; live proof pending (batched)
- 2026-10-20 [editor] T-234-b pieces 6-7 built, left open (Sonnet): link hover bubble, source-view [[note]] links, missing-file toast (App.tsx patch pending), data-picture size check; code colouring waits on a highlighter library, local pictures wait on files.rs; live proof pending (batched)
- 2026-10-20 [editor] T-316-b piece 2 built, left open (Sonnet): Jupyter notebook Cells view (notebook.ts, NotebookView.tsx); PDF export waits on a PDF library, Python run skipped by the brief; live proof pending (batched)
- 2026-10-20 [sessions] T-146-d: each past session in the Agents tab gets a Resume as chat button (Claude only in its own workspace, Codex from any, remote and WSL refused, the reason shown on the greyed button); one shared-file App patch after the regenerated T-146-g one.
- 2026-10-20 [sessions] T-153-c: stays skipped (DT-C44); its close (spec tier D plus removing the PLAN line) is one patch for the resolver, plan-check OK with it applied.
- 2026-10-20 [repo] T-127-b: a pull request the host reports as unlinked is hidden, one the user unlinked sits behind a notice with Link again, Agents rows show prompt, latest turn, sub-agent runs and worktree line, resuming a running session focuses its pane, and tab titles follow session names; Codex sub-agent runs and queuing threads (T-230-d) still open; needs 3 patches; live proof pending (batched)
- 2026-10-20 [repo] T-224-b: the Explorer has expand all, a refresh that spins and is off while it runs, Windows paths compared without case on whole folder names, Collapse and Copy as file on row menus and an add-project row when empty (the rest of the toolbar and the search view were already there); a Search tab on the sidebar strip stays with T-146-g; needs 2 patches; live proof pending (batched)
- 2026-10-20 [browser] T-312-b: agents can take a named page placement in the Kolux browser (tab lease), open pages under it (tab create --lease), list leases (tab leases) and release it, which closes the pages opened under it; a placement someone else holds is refused with their name; needs 2 patches (cli.rs help, local_cli.rs summaries); live proof pending (batched)
- 2026-10-20 [browser] T-319-b: sites in a browser tab sign in through a popup because the engine's identity prompt (FedCM) is off; a toolbar hint offers to bring logins over, naming the browsers installed, and stays hidden once dismissed; a document preview's chip takes a web address (same tab becomes that page, Back returns) or another document; BROW-052 drags moved to T-319-c (HAND TO FABLE: the child web view takes the pointer from the app); needs 2 patches (recovery.rs, lib.rs); live proof pending (batched)
- 2026-10-20 [cli] T-089-d: worker-read pages a worker's transcript, else its terminal output, else its release archive; worker-show says waiting from the hook; terminal commands take a dispatch id; ask hands back with exit 75 on the packaged Windows build; live proof pending (batched)
- 2026-10-20 [orchestration] T-260-d left open: a worker whose task has no parent task nests on the Floor under the pane that started it (activity.rs; dispatch side in evidence/orchestration-T-260-d-cli.patch); still blocked on the fresh-Mac check (needs a Mac build); live proof pending (batched)
- 2026-10-20 [orchestration] T-289-b left open again: the Runs view a task-N link would open is a DECISIONS default skip; three ways to close it are on the after-list for Txais
- 2026-10-20 [editor] T-317 third piece: PR composer Base box on SearchPick via worktree_branches (patches editor-T-317-files.rs, -lib.rs, -PrStart.tsx); T-323-b piece 3: Open in for a single file in the Explorer menu; T-317 stays open for the View Log caller
- 2026-10-20 [editor] T-235-b piece 5: PDF viewer tab on pdfjs-dist 5.4.624 (package patches editor-T-235-b-pdf-package.json.patch and -pdf-pnpm-lock.yaml.patch); T-316-b EDIT-018 left open (PrintToPdf is browser-lane only)
- [reliability] 2026-10-20 T-547 (lane/reliability from ebaaf05b): left open; Kimi balance + MiniMax remains client logic, sealed keys, host list, error mapping and the Provider usage settings rows built with fixture tests (cargo 22 passed, vitest 14 passed, clippy 0, tsc 0, app070 findings unchanged); network transport refused by the session safety classifier and needs the privacy audit widened (BLOCKER after-list row); patch evidence/reliability-T-547-lib.rs.patch
- [reliability] 2026-10-20 T-286-b ticked (lane/reliability from c2b7ed24): browser ProcessFailed 2338bdb4 on main; sessions per host N/A (remote hosts cut); live proof pending (batched)
- 2026-10-20 [core] T-075-b DONE (Opus): background terminal service src-tauri/src/pty_service.rs (lock per user+identifier, loopback+token terminals.json, attach/detach with recent output, generation-checked typing, 10-minute idle exit, kolux open refuses an incompatible service); DT-C27 reversed by Txais 2026-10-20 (patch evidence/core-DT-C27-DECISIONS.md.patch); patches spec, lib.rs, main.rs, cli.rs; importer part left to T-213; window routing is T-184-b; live proof pending (batched)
- 2026-10-20 [core] T-184-b DONE (Opus): panes run in the background terminal service (pty_link.rs: one link per window, per-pane control, events held until registered); reopen takes the service terminals back with handle, pane, secret, recent output and the gap printed while closed; quit ends only window-run panes; installed builds only unless KOLUX_TERMINAL_SERVICE=1; cargo test 1776/0 with patches 1-6; patch core-T-184-b-lib.rs applies after the T-075-b ones; live proof pending (batched)
- 2026-10-20 [core] T-153-f DONE (Opus): Manage Sessions also lists and ends the background service's terminals no window owns (pty_link unowned/end_unowned, terminal_host_sessions/terminal_host_end, BackgroundSessions.tsx); agents and busy ones never offered; patches core-T-153-f-lib.rs + -ResourceManager.tsx; live proof pending (batched)
- 2026-10-20 [core] T-067-b DONE (Opus): a lost background-service connection ends each carried pane's open turn once (terminal::turns_end, the one end every exit takes; losable_link test helper); test as patch core-T-067-b-activity.rs; live proof pending (batched)
- 2026-10-20 [accounts] T-139-d: a sign-in error Codex prints in a pane on a managed account flags that account, so the main window offers Sign in again (bounded tail-only scan, one report per pane per minute, never the system default); with the setup-change and restored-pane prompts built earlier the card is done; needs 2 more patches; live proof pending (batched)
- 2026-10-20 [accounts] T-548-b re-check (Opus): Codex half complete, lane clippy fixed (allow dead_code on the command its lib.rs patch registers); Claude half stays open: needs T-547 per-account usage read (Txais blocker) or per-config-folder status-line reports in hooks.rs plus terminal_spawn answering a Claude pane account (hooks + core lanes)
- 2026-10-20 [usage] T-263-c re-check (Opus): still blocked, every quota read in USAGE 026 / USAGE 027 needs the T-547 network transport that sends stored sign-ins or keys (a Txais blocker); Gemini, Antigravity and Kimi Code have no public quota service (T-547 survey); nothing built
- 2026-10-20 [shell] T-308 DONE (Opus 5.5): TERM-104 own Unicode 16 width provider (unicodeWidth.ts + generated data from unicode.org), emoji sequences join, TerminalPane patch; live proof pending
- 2026-10-20 [shell] T-280-b DONE (Opus 5.5): autosave and custom sound restart proofs stand; unnamed older right-sidebar key rule dropped (coordinator default); live proof pending
- 2026-10-20 [shell] T-267 DONE (Opus 5.5): ligatures with the approved addon (literal import, GPU glyph cache rebuilt), TerminalPane patch after T-308's; live proof pending
- 2026-10-20 [chat] T-326-b (Sonnet 5.5): subagent roster rows show the token count a finished Task call reports (Tool.tokens from the result line); rail 268/240 pinned by a test; subagent idle state has no source yet (after-list); live proof pending (batched)
- 2026-10-20 [marks] T-335-b (Sonnet 5.5): Cursor cube taken from its public brand zip; Claude Agent Teams wears the Claude spark; all other catalogue agents, open-in editors, shells and terminal apps are NAME_ONLY registry entries (no reachable kit for Gemini, Kimi, Qwen, MiniMax, Devin, Zed, Warp, JetBrains); Agent type widening is a coordinator patch; live proof pending (batched)
- 2026-10-20 [onboarding] T-321-c DONE: the Explore Kolux usage stop shows which agents are connected and the orchestration and browser stops show their skill setup card with a short inline terminal; live proof pending (batched)
- 2026-10-20 [worktrees] T-110-b DONE: the first real work of an agent names the new worktree and the folder-rename question follows; the two COMPAT 5.5 alias variables stay unbuilt (names unknown); live proof pending (batched)
- 2026-10-20 lane/tray: merge main 337043ce into lane/tray 7c25c865, badge_set clash settled (main's badge::badge_set the one command, lane/tray's notifications::badge_set removed; badge.ts main's; T-125 evidence split to evidence/tray-T-125.txt); patches regenerated (tray-T-125-lib/App/useAgentStatus, tray-FIX-1-lib/App), tray-T-248-c-tray.rs dropped as moot; gates green merged and wired
- 2026-10-25 [fix-other] PASS 10 (Sonnet 5.5): T-056-b DONE on df11826f: GOOSE_MODE=auto in Goose's start-line env (agents.rs built_in_env + start_line_as), not under Manual, the user's own default arguments or the user's own GOOSE_MODE; GOOSE_ prefix already allowlisted (firewall 0 new); agents:: 40 ok, clippy clean; live proof pending (batched)
- 2026-10-25 · [release-port] T-100-b · done: cherry-picked from lane/release c62bc689; Grok and Cursor are asked for their models once per run (models.rs, agent_models registered in lib.rs, ChooserPane asks on open); decision renumbered DT-R38 to DT-R67 because main already uses DT-R38 for T-500; PLAN/STATE/DECISIONS/PROVENANCE kept as main's text plus this task's own lines.
- 2026-10-25 · [release-port] T-199-c · cherry-picked from lane/release 78517281: scripts/release.mjs smokeCli also checks that --help lists a command list (--version, worktree) before a release is published (APP-061 command-line half, DT-R44); the packaged-app terminal smoke and migration check stay open on the T-199 row.
- 2026-10-25 · [release-port] T-161-c · cherry-picked from lane/release 952c87a5, record-carry half only: a workspace renamed outside Kolux or moved with git worktree move keeps its name, parent, children, note, origin, hidden and seen marks (projects.rs carry_over rekeys through main's rekey_workspace, keyed by the worktree's Git folder), a folder renamed by hand is repaired with git worktree repair, a removed workspace forgets its Git folder (DT-R50). The refresh-ordering TS half was dropped: main has refreshSeq.
- 2026-10-25 · [release-port] T-182-d · ported from lane/release a44a31f4 by hand into a new src-tauri/src/login_env.rs (main moved the pane PATH code to pty.rs/lifecycle.rs): on macOS and Linux the login shell's environment is read once at startup in the background and every new terminal gets it; Windows is unchanged; unproven on a Mac or Linux box. Re-read on a configured-shell change stays open.
- 2026-10-25 · [release-port] T-182-e · ported from lane/release e568a3e3 by hand: on macOS the app stays running when its last window closes unless a quit or restart is under way (lifecycle::keeps_running + QUIT_UNDER_WAY, the ExitRequested hunk in lib.rs), and a Dock click with no window builds the main window again (tools::reopen_main, which shares build_window with the first start so the navigation guards stay on). Windows and Linux quit as before; macOS branches unproven here.
- 2026-10-25 · [release-port] T-199-b (release.mjs hunk only) · from lane/release 04cba920: scripts/release.mjs uploads latest.json after the installer and signature, so a release is never announced before its installer exists; the rest of that commit (update feed handling) is already on main in 70ca4ce4.
- 2026-10-20 [setup] T-149 (Sonnet 5.5): kolux.yaml default tabs (limits, trimmed, new "tabs" trust kind) and the bulk-remove model for cleanup (confirmation, children first, slow/late outcomes) built; patches setup-T-149-lib.rs then setup-T-149-CleanupDialog.tsx; live proof pending
- 2026-10-26 [prove] T-025-d (hooks half), T-058-b (manual and auto legs), T-032-c, T-033-d proven live (Sonnet 5.5): real Claude Code haiku in a hidden dev app, test account A; evidence/T-025-d.txt, T-058-b.txt, T-032-c.txt, T-033-d.txt; scripts evidence/prove/*-live.mjs, scripts/prove/live-common.mjs; open halves split as T-025-d-rest and T-058-b-rest
- 2026-10-26 [prove] spec/03 LIVE boxes proved in a hidden app (Sonnet 5.5): TERM-004, 006, 013, 017, 023, 028, 040, 041, 103, 105, 106 (13 boxes) ticked; scripts/prove/live-TERM-*.mjs, evidence/cards-TERM-*.txt; TERM-106 uses a hard kill of the app as the host (no separate host in this build)
- 2026-10-26 [prove] spec/05 LIVE boxes proved in a hidden app (Sonnet 5.5): VIEW-001 b1+b2, 002 b2, 003 b1, 004 b1+b2, 005 b1, 017 b1, 050 b1, 107 b2 ticked (10 boxes); VIEW-026 b1+b2 BUG (src/board/board.css .board collides with styles.css:396 so the Board card is 2x29 px, row in kolux-rs-after.md); scripts/prove/live-VIEW-*.mjs, evidence/cards-VIEW-*.txt
- 2026-10-26 [ux] SET-006 b3: Terminal settings has a "Keys in terminals" card whose Shortcuts settings link opens Shortcuts at the terminal-first policy; SET-006-b3.test.ts (caller) + SET-006-link.test.ts (scroll); box ticked (Sonnet 5.5); evidence/cards-SET-006.txt
- 2026-10-26 [prove] spec/12 LIVE boxes proved in a hidden app (Sonnet 5.5): EDIT-001 b2, 003 b3, 012 b1+b2, 027 b1+b2, 029 b1+b2, 033 b1, 041 b1 ticked (11 boxes); EDIT-044 b1+b2 stay LIVE (no WSL distribution installed); scripts/prove/live-EDIT-*.mjs, evidence/cards-EDIT-*.txt
- 2026-10-27 [prove] spec/11 LIVE boxes proved in a hidden app (Sonnet 5.5): GIT-001 b2+b3, 003 b2, 004 b2+b3, 007 b2 (622 s trace), 037 b1+b2, 038 b1+b2, 040 b2 ticked (11 boxes); spec/05 VIEW-026 b1+b2 re-proved after ux 806d9925 and ticked; VIEW-025 stays REAL-AGENT; scripts/prove/live-GIT-*.mjs, live-git-common.mjs, evidence/cards-GIT-*.txt
- 2026-10-27 [ux] SESS-007 b3: a lone grid chooser has no close button (chooserClosable follows the shown-pane count; New session sheet unchanged); spec/02 box ticked, 3 cards tests (Sonnet 5.5)
- 2026-10-27 [prove] live-v6 LIVE boxes proved in a hidden app (Sonnet 5.5): STAT-053 b2, USAGE-007 b4, ORCH-016 b1+b3, AUTO-011 b1+b2, CLI-018 b1+b2, CLI-007 b1, SESS-007 b3 re-proved classic+new ticked; CLI-007 b2 DRIFT, CLI-011 b2 stays LIVE (visible window); gates green
[browser] 2026-10-27 row 939 (Sonnet 5.5): the saved proxy now reaches the in-app browser on Windows. wry dropped proxy_url whenever browser arguments are passed, so browser_proxy.rs puts one --proxy-server into the tab's arguments, refuses credentials and a changed proxy (restart message), and keeps each data folder's first argument string; recovery.rs launch_browser_args_for reads the profile's proxy for the window (needs evidence/browser-939-lib.rs.patch for lib.rs:226; without it a default-profile tab with a proxy refuses). 12 row939 tests; live proof pending (prove lane); evidence/browser-939.txt
- 2026-10-27 [ux] app070: scripts/prove + scripts/stress excluded like evidence (never bundled); browser.rs XHR (page-script wrapper, EXACT x1) and pty_service.rs 127.0.0.1 connect (ALLOWED + count 1) allowed; labels.rs connect left red, filed NOW in after.md (target host not pinned to loopback) (Sonnet 5.5)
- 2026-10-27 [ux] labels: target_of (the one door every label-proxy connect goes through) now refuses any host that is not a loopback IP or localhost, no DNS; labels.rs connect allow-listed + PINNED 1 in the privacy audit, app070 2 of 2 green (Sonnet 5.5)
- 2026-10-27 [ux] labels: resolve_in takes the first Ports row that passes target_of (a 192.168.x row no longer hides a later 127.0.0.1 one; first_target test red then green); privacy audit widened to TcpStream\s*::\s*connect (plain, spaced and split lines; negative test red then green) and app070 now asserts no src or src-tauri/src file names scripts/evidence, prove or stress and tauri.conf.json has no bundle.resources or externalBin (Sonnet 5.5)
- 2026-10-27 [prove] live-v6 LIVE boxes proved in a hidden app (Sonnet 5.5): STAT-053 b2, USAGE-007 b4, ORCH-016 b1+b3, AUTO-011 b1+b2, CLI-018 b1+b2, CLI-007 b1, SESS-007 b3 re-proved classic+new ticked; CLI-007 b2 DRIFT, CLI-011 b2 stays LIVE (visible window); gates green
- 2026-10-27 [ux] fence-cli-worktree: the fence's 3 s worktree cache is now also dropped whenever Kolux runs git worktree add/remove/move/prune/repair (counter in git.rs), so a worktree the CLI/UI/orchestration just made opens in the Explorer at once; outside paths stay refused (cli018 tests red then green; evidence/fence-cli-worktree.txt) (Sonnet 5.5)
- 2026-10-27 [prove] live-prover-7: BROW/SET boxes proven (6 ticked, 3 BUG rows, 2 DRIFT, SET-004 stays LIVE); browser row 939 live run recorded FAIL (PDF export 0x8007139F; two script checks and the dead-port tab step to fix)
- 2026-10-27 [prove] live-prover-8: SET-001 b3 and BROW-001 b2 re-proved and ticked; row 939 browser-proxy rerun PASS incl. PDF (959 PASS); row 962 model listing PASS; APP-052 b1/b2 stay LIVE (service cannot outlive the app in the harness), APP-025/059 LIVE, APP-050 b2 not attempted (context cap)
[prove] 2026-10-27 live-prover-9 PAUSED: APP-050 b2 BUG; STAT-001 b1, VIEW-025 b1-b2, SAFE-003 b1, SAFE-004 b2 ticked (real Claude 2.1.312); SAFE-003 b2 needs rerun; next SAFE-009 b1.
- 2026-10-27 [prove] live-prover-10: SAFE-003 b2, SAFE-009 b1+b5, ORCH-007 b1, ORCH-013 b1, CLI-035 b1, SESS-030 b1+b2 all PASS and ticked with real Claude 2.1.312 (account-a, 13 runs); APP-052 b1/b2 stay LIVE (installed build needed, T-544); plan-check OK P0 195/228, tsc 0, firewall 0 new
2026-10-28 prove live-prover-11: APP-050 b2 re-proved 15.7 s (over the 15 s box limit, stays BUG); SAFE-023 b1 BUG (trust still goes to the app scratch config, not the pane account); row 954 browser re-proof items 2+3 FAIL (second rebuild: webview label exists), others pass or partial; lane/prove head see commit log.
2026-10-28 prove live-prover-12: SAFE-023 b1 + APP-050 b2 (14.2 s) PASS and ticked; BROW 977/978 steps 15-17 PASS; browser 954 item 3 PASS (item 2 cap holds, stale toolbar note after Retry LOW); VIEW-025 Board Deny PASS x2, CDP-typed Esc unproven; sub-agent Deny (MERGE 418) strict FAIL by 0.5 s; SAFE-024 b1 + row 989 stay LIVE; 12 real Claude sessions + 1 auth probe.
2026-10-28 prove live-prover-13 (main 9acd3c86): SAFE-024 b1 PASS and ticked (six fresh worktrees, six panes at their prompt box in 8.7 s, no trust menu; real Claude 2.1.312, account-a); SUBAGENT-418 B PASS (Esc byte at a sub-agent prompt, Done 5.2 s), C PASS (Esc byte plain prompt, Interrupted 5.1 s), D PASS in run 2 (chat Deny, Interrupted 3.7 s) but run 1 FAIL (no chat card before the Agents screen is first opened; after.md SOON row); P0 cards passing 198/228; health check loggedIn true; account-a settings.json never existed.
[prove] 2026-10-28 live-prover-15 on main 442de7aa (MERGE 423 TERM-106 fix): TERM-106 b1 PASS and ticked (real service kill, quit + relaunch: marker < note < prompt, echo M2 within 10 s, cwd kept, pane alive and answering at +65 s, no terminal-exited line after the relaunch; the batch-14 exit at +16 s is gone); the review's old-service-cleanup guess refuted (old pane exit logged at its kill, before the quit); APP-052 b1+b2 script PASS incl. typing into the restored pane, not ticked (service still ends with the app here); P0 cards passing 199/228; no Claude started.
2026-10-29 [fix-pathleak] T-580 + T-581 merged (lane/fix-pathleak ae44023d): fenced runs put the real user Path back after script installs; Path entries below a scratch/smoke marker never count in a real run; npm engine refusal reads "<Agent> needs a newer Node.js (<range>)"; cargo-deny green (pulldown-cmark 0.13.5; zip x3 and zbus x3 ignores with reasons in deny.toml). Gates: build, clippy 0, deny ok, lib 2565/2566 (row1014 timing, passes alone), int 246/0, tsc 0, pnpm 4975/4975, plan-check OK, firewall 0 new, smoke 4/4 (evidence/smoke-ae44023d.txt).
2026-10-30 [foundation] T-582 (lane/foundation, integrator): Unix kill_tree ends option parsing (kill -9 -- -<pid>) and never signals 0, 1 or itself, which had killed the whole audit sandbox; git leads its own process group on Unix; the Rust tests compile and run to the end on Linux (2453 passed, 38 Linux-only failures read and listed); STAT-052 reads CRLF and LF alike; scripts/test-env.ps1 and .sh make the scratch homes; scm.rs NUL written as \0. Proof: windows-gnu check + clippy clean, vitest 4975/4975, evidence/T-582.txt. CI set aside by Txais 2026-10-30.
2026-10-30 [topbar-drag] T-620 (lane/topbar-drag, integrator, asked by Txais): the whole top bar moves the window: the header is data-tauri-drag-region="deep" and the View and account menus drawn inside it opt out ("false"). Browser proof with Tauri 2.12.1's own drag.js: empty presses that drag 67/467 -> 467/467 (Classic 308/510 -> 510/510), presses on controls 0, double-click maximizes, a backdrop press closes the menu. vitest src/chrome + src/switcher 117/117, tsc 0. evidence/T-620.txt.
2026-10-30 [topbar-drag] T-620 review fixes (fresh review of PR #3): the switcher's frame opts out of the drag; the table cell menu closes on pointerdown (drag.js stops the mousedown of bar presses: 301/316 reached the window before, 0/316 after); the test applies drag.js's rules to every element of the bar using React's own handlers; browser proof with the app's look, account and usage pills: empty presses that drag 15/316 -> 316/316, Classic 117/421 -> 421/421, control presses 0, every control still does its job. Found on the way, filed as T-621: the switcher's Tower segment overflows its frame and the right group covers it at the default 1400 px.
2026-10-30 [integrator] Txais's calls of 2026-10-30 recorded: the releases repository TxaisX/kolux-rs-releases is public and releases are built on GitHub's Windows runners (DT-R39); CI is not a merge gate and Claude opens and merges the PRs (DT-C51). T-622 (installed copies update themselves) waits on Txais's four setup steps, listed under Needs Txais in STATE.md.
2026-10-30 [cli] T-593, T-595, T-596, T-619 merged, T-594 code only: Register finds the installed kolux.exe and kolux.cmd; `kolux open` starts Kolux from a neutral folder; `kolux worktree list` names an unreadable project instead of emptying the list and --wait-submit is capped at 1 to 300 s; closing a busy terminal no longer freezes the others; the installer adds the bin folder to PATH (live Windows install/uninstall pending); proof: evidence/T-593.txt, T-594.txt, T-595.txt, T-596.txt, T-619.txt
2026-10-30 [reliability] T-565, T-597, T-598, T-599, T-600 merged: Escape closes Settings (and only the inner box when one is open); a slow start never wipes the saved tabs and a tab opened during the wait cannot take over a saved one (App.patch applied); Settings keep what you typed when a save fails and pages write only what changed; the crash screen never reloads while a report is written; the update card never opens itself or takes the keyboard, and a stray Enter cannot restart; proof: vitest before/after runs in evidence/<id>.txt, tsc and full vitest at integration; live Windows checks pending.
2026-10-30 [review-editor] T-317 + T-601 + T-602 + T-603 merged (lane/review-editor): a .log file can be followed from the Explorer row menu (Follow log) and a followed log never wipes unsaved edits in another tab; notes, agent plans and chat no longer put live HTML or diagram settings into the window; typing a | into a table cell no longer deletes cell text and an overfull table row opens in source view; CRLF notes stay CRLF after rich-view edits and a file rewritten with other line endings reloads line by line; proof: unit tests failing before and passing after, headless Chromium probe for T-601 (evidence/T-601-proof.mjs), live Windows proof pending
2026-10-30 [workspaces] T-613, T-614, T-615, T-616, T-617 merged: deleting a workspace names commits found on no other branch and keeps its branch by default (also when several go at once); removing workspaces never closes tabs opened meanwhile or brings back removed ones; "Discard N changes?" only discards in the workspace it was asked in; a rename onto another file's name in other capitals is refused; saving through a link writes the real file and keeps the link; proof: vitest red/green, cargo test t613_/t616_/t617 central run, evidence/T-613..617.txt
2026-10-30 [release-ci] T-587, T-588, T-589, T-590, T-591, T-592 merged: releases publish through a tested path; the release job pins its actions, signs in its own step and signs only the build it made; library upgrades close known holes (mermaid, highlight.js, katex, DOMPurify, vitest, updater); Kolux cannot be framed by another page; CI checks every invoke name and a first-load bundle budget; a downloaded update, Restart Kolux and both safe-graphics restarts now outlive the app's job (outside lifecycle.rs/recovery.rs one-liners applied; the diagrams.ts follow-up was already on main from PR #7); proof: evidence/T-587..T-592.txt, cargo test 2673 pass with only the 45 known Linux failures, procs/t592 6/6, vitest 5052/5052, live Windows update check pending
2026-10-30 [integrator] Project record written: docs/history/kolux-project-record.md tells the whole story of Kolux (built as "Kolux RS"; Txais named it simply Kolux on 2026-10-30) in plain words: timeline from the 2026-10-06 spec to the "Path to an A" cycle 1, sessions, lanes and agents (34 agents in 8 lane workflows today), and the numbers (709/775 tasks, P0 208/228, 2,715 commits, 2,484 evidence files, PRs #1 to #10), each with its source.
2026-10-30 [integrator] Old-app material removed at Txais's request: design/reference/ (36 screenshot crops) and evidence/T-003b-compare.png deleted, DESIGN.md measurements kept with "removed" notes; live-common.mjs ACCOUNT_A now KOLUX_LIVE_ACCOUNT_A or G:\Temp\live-signin\account-a (X-proc.6); docs/reclaim-old-kolux.md and scripts/reclaim-old-kolux.ps1 added for Txais to free about 408 GB; PROVENANCE.md section added.
2026-10-30 [safety] T-604, T-605, T-606, T-607 merged: a stray quote, comment, heredoc or escape can no longer hide a protected command and your own "starts with" rules see through wrappers (a 1 MB command is answered in time); npm-installed agents start as node on their script so an opening prompt never passes through cmd.exe; AI writers (commit message, one-click flow, agent recipes, PR text, branch name) run their agent from an empty temp folder with only the user's Claude settings and no project MCP (evidence/safety-scm.patch applied to scm.rs and scm_recipe.rs); browser tabs and sign-in popups refuse frames of Kolux's own address; proof: evidence/T-604..T-607.txt; cargo test lib 2481 pass, failures only the known Linux list plus two skill_delete self-relaunch tests hit by a parallel build (pass alone); git019 failed before the patch and passes after; the 1 MB test at most 523 ms optimized; vitest 5064/5065 (an editor 60 ms timing test, 166/166 alone); live Windows checks pending
2026-10-30 [status-hooks] T-583, T-584, T-585, T-586, T-618 merged, T-566 code merged (live proof pending): a slow automation, a busy store or one huge protected command no longer freezes status or skips the safety pause, and a pane's status reaches the window in order; Claude hooks install when settings.json holds an empty list such as "Stop": []; after Esc stops a helper agent the pane ends Done instead of "working" forever; link underlines and Ctrl+click land on the right cells after Chinese text and emoji; a new tab never inherits a closed tab's saved status after a restart; a restored pane shows its restored chip from its first paint and terminal panes carry data-key (clippy large-enum fix in hooks.rs at integration; App.patch named in the lane result did not exist, nothing applied); proof: evidence/<id>.txt with real before runs at integration, cargo test 2689 pass with the 45 known Linux failures plus one flaky activity proj051 (not this lane), vitest 5075/5075, live Windows checks pending
2026-10-30 [safety] PR #15 review fixed: a backslash line join, a backslash inside a word, a $'..' quote, a git -c alias, a shortened option (--ha, --del, --force-w, --mirr, --recu), an rm bundle like -rrrrf, env -S and $IFS can no longer hide a protected command; a pasted prompt loses ESC and control characters so it cannot end the paste early; a protected command is masked outside the shared attempts lock (status-hooks follow-up 4 done); the writer temp folder has a random name and mode 0700; proof: evidence/T-604.txt and T-605.txt before/after, cargo test lib 2502 pass with only baseline failures, windows check and clippy clean
2026-10-30 [safety] PR #15 re-review fixed: every command is also read with its backslashes dropped as bash does, and a rule asks when either reading trips it (HEAD:ma\in, a backslash after a colon, \.\. in a temp path no longer slip through; Windows paths keep their backslashes for deletes on a Windows base); automation prompts for a reused session and the app's typed prompts drop control characters before the paste like sendonce does; proof: evidence/T-604.txt and T-605.txt before/after, cargo test lib 2503 pass with only baseline failures
2026-10-30 [product-ux] T-608 to T-612 code merged, live Windows proof pending (T-609's sidebar count open): status hooks are on by default after one plain consent line, and the Board, Tower, Inbox, needs strip, bell and sidebar read one status per pane, including for an agent started by hand in a plain terminal; a finished agent's Board card and Inbox row offer Review changes; every screen is reachable from the top bar or the palette and only one screen is called Board (the other is Workspace Statuses); the palette lists every command and none does nothing (sidebar.ports.toggle deleted, DT-C53); the wizard's Open a session always finishes and Escape closes the Tip; four outside patches applied together (App, ProjectsPanel by hand after a conflict with main, TerminalPane, settings); hooks.rs queue comment now says catch_unwind only helps in debug builds (release is panic = "abort"); proof: evidence/<id>.txt with failing-then-passing tests, live Windows checks pending
2026-10-30 [product-ux] PR #16 review fixed: agents Kolux launched with no vendor mark (Gemini, Grok...) show their status again; the Inbox and bell still count blocked panes as on main (question for Txais); a palette command whose place is not open says so; Force Reload asks first over unsaved editor text; the hooks card's switch starts from the saved answer; a quit hand-started agent's last status is cleared; PLAN lines left open until the live checks; proof: paneStatus.test.ts and commands.test.ts, failing output before the Gemini fix in the PR #16 review notes
2026-10-30 [safety] PR #15 round 3 fixed: on Windows both readings of each delete path are judged, so x/\.\./\.\. and build/\.\. no longer pass as staying put; a command over 256 KB is asked about at once without being read, so the hook answers well inside 1.5 s; proof: evidence/T-604.txt before/after, cargo test lib 2505 pass with only baseline failures
2026-10-30 [safety] PR #15 round 4 fixed: a recursive delete whose target holds a backtick, a caret, a backslash before anything but a plain path character, or a drive-relative form (C:, C\:) now always asks; plain Windows paths (C:\...\Temp\other, dist\*.o) still run; proof: evidence/T-604.txt before/after, cargo test lib 2506 pass with only baseline failures
2026-10-30 [safety] PR #15 round 5 fixed: a recursive delete whose target has a wildcard (*, ? or [) in a folder part asks (.?/* can mean ../*); build/* and dist\*.o still run; follow-up recorded for deletes the rule does not cover ([IO.Directory]::Delete, find -delete, rimraf, robocopy /MIR); proof: evidence/T-604.txt before/after
2026-10-30 [safety] PR #15 round 6 fixed: a cd, pushd or Set-Location to a folder with a wildcard, an escape or a drive-relative form makes the folder unknown, so a later recursive delete asks (cd .?; rm -rf *); cd build && rm -rf * still runs; proof: evidence/T-604.txt before/after
2026-10-30 [safety] PR #15 round 7 fixed: Push-Location and Pop-Location, a wrapper's own folder option (env -C, sudo -D, start /D, wsl --cd) and CDPATH now move the folder a recursive delete is judged from, so env -C ../.. rm -rf build or export CDPATH=/; cd home; rm -rf * ask; proof: evidence/T-604.txt before/after
2026-10-30 [integrator] cycle 1 closed: all 8 lanes merged (PRs #1-#16), report in docs/history/cycle-1-report.md; proof: plan-check 718/775, P0 208/228
2026-10-31 [live-proofs] docs/live-proofs-windows.md merged: 43 items (31 to run in one sitting, 12 not runnable yet); DT-C54 (CI not used) recorded, STATE release/CI lines updated; proof: evidence/live-proofs-list.txt
2026-10-31 [cli-path] T-594 redone: a PATH over 1,024 characters now gets kolux from the app at its next start, and uninstall removes only our entry at any length; proof: evidence/T-594.txt (18 tests; live re-run pending)
2026-10-31 [product-ux-2] T-608b, T-609, T-621, T-612b merged: Txais's three status answers (exited agents read Stopped in the Inbox; Ctrl+J and tab badges count only permissions and questions), the real changed-files count on by default, the Tower segment fits the switcher, PR #16 follow-ups; proof: evidence/T-608b, T-609b, T-621, T-612b
2026-10-31 [data-loss] T-613b, T-604b merged: no delete path can drop commits found nowhere else (CLI delete, detached HEAD kept as kolux/kept-*), and more recursive deletes are judged (find -delete, rimraf, IO.Directory, robocopy /MIR); proof: evidence/T-613b.txt, T-604b.txt
2026-10-31 [engineering] App.tsx split (3,315 -> 221 lines) and the 13 dead commands removed (456 -> 443 registered); first load measured 3.37 MB raw (over 1.5 MB), pnpm test 1:52 with 3 known failures; proof: evidence/T-ENG-*.txt
2026-10-31 [integrator] cycle 2 closed: 5 lanes merged (PRs #18-#22), report in docs/history/cycle-2-report.md; proof: plan-check 719/775, P0 208/228
2026-10-31 [data-loss] T-604b-e (lane/fix-data-loss, cycle 3 assignment 4): find -delete is read through an escaped group and through a link named as a start point (canonicalized against the workspace, junction proven on Windows); -L or -follow with -delete asks outright; red 4+4, green 66 protected tests, clippy and cargo deny clean; evidence/T-604b-e.txt
2026-11-08 [ready-tools] T-813: stress harness follows the current layout (Ctrl+T for new terminals, kolux-add-project event and chooser for adding a project, cli-workspace event for diffs); all of S1-S8 and S10 run to a verdict, none HARNESS-BLOCKED; S8 memory 660 -> 564 MB (-14.5%), the 860-1000 MB drift did not reproduce; evidence/T-813.txt
2026-11-08 [ready-tools] T-811: editPlacement test timeout 20 s, t606 ask timeout 60 s (the real cause was GNU find on PATH in the stand-in script, now System32 find.exe); 16 variable-name invoke sites go through src/ipc/commands.ts (CommandName, invokeNamed) and invoke-contract checks the list: 0 unchecked dynamic names; pnpm test 6375 and cargo test 2947 green; evidence/T-811.txt
