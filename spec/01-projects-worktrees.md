# 01 · Projects, repos & worktrees

A project is a folder the user adds to Kolux: usually a Git repository, sometimes a plain folder.
Inside a project every workspace is a Git worktree with a branch and a folder of its own, so several
agents can work on one repository side by side. This area covers adding projects (browse, clone,
create new, scan a parent folder), project groups, icons and colours; how new workspaces are named,
where their folders live (including KOLUX_WORKSPACES_DIR and the OneDrive workaround) and which ref
they start from; setup scripts and the shared kolux.yaml file; the sidebar list of workspaces with
its grouping, sorting, nesting, pinning, filters and keyboard movement; the worktree palette and
back and forward history; safe deletion, forgetting, the cleanup dialog and the Space view; and the
`kolux repo`, `kolux project` and `kolux worktree` commands. By default the rebuild leaves out
sparse-checkout presets, shared folder links, fork sync, repo hooks, host setups, remote and WSL
execution, and work-item providers other than GitHub.

Tier counts: P0 15 · P1 56 · P2 18 · H 2 · X 0 · D 10
Related areas: 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 08 Orchestration · 09 Automations · 11 Git, source control & review · 12 Editor & files · 16 Onboarding & guidance · 17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations · 20 The `kolux` CLI · 21 Retired, hidden, removed, dev-only

## Cards

### PROJ-066 · Switching workspaces is instant and keeps each one's state
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: clicks from one workspace to another.
User sees: the selection moves on the same click; every workspace keeps its own tabs, open files and
  terminals.
Rules: removing a workspace clears its tabs, open files and browser tabs.
Acceptance:
  - [x] Switch from A to B and back → A's terminals and tabs are as they were. (cards live; evidence/cards-PROJ-066.txt)
  - [x] Delete a workspace → none of its tabs remain anywhere. (cards; evidence/cards-PROJ-066.txt)
Compat: —
Source: D-01-066

### PROJ-001 · Add a project by choosing a folder; nothing else is pulled in
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: opens Add Project, chooses Browse and selects one or more folders in the system folder
  picker.
User sees: every chosen folder shows up in the sidebar as its own project, and no other folder on
  disk is scanned or added along the way.
Rules: several folders can be chosen in one go and each becomes a separate project; this route never
  searches inside the chosen folder for further repositories; an already-registered folder is not
  added again; on Windows the comparison resolves each path to its canonical form and ignores letter
  case; a freshly added project goes to the top of the Recent order.
Acceptance:
  - [x] Choose two sibling repositories together → exactly two new projects appear and nothing else. (cards; evidence/cards-PROJ-001.txt)
  - [x] Choose a folder that is registered already → no second row appears. (cards; evidence/cards-PROJ-001.txt)
  - [x] Add three plain folders (no Git) at once → it asks about the first and one note counts the
        other two and any that failed. (T-687; evidence/T-687.txt)
Compat: —
Source: D-01-001

### PROJ-007 · After adding a project its main checkout opens, with existing worktrees listed
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: finishes adding, cloning or creating a project.
User sees: the dialog closes and the repository's main checkout becomes the active workspace;
  worktrees that already existed beside it, made outside Kolux, are listed; a folder project opens
  on its folder workspace.
Rules: the main checkout is chosen on purpose, never simply whichever worktree is listed first; the
  worktree list is fully re-read before the hand-off; scratch worktrees that coding tools make for
  their own sub-agents stay out of sight.
Acceptance:
  - [x] Add a repository with three worktrees where the main checkout is not first alphabetically →
        the main checkout is the active workspace. (cards; evidence/cards-PROJ-007.txt)
  - [x] Add a repository that holds a coding tool's scratch worktree → that worktree is not listed. (cards; evidence/cards-PROJ-007.txt)
Compat: —
Source: D-01-007

### PROJ-020 · Create a workspace: a new branch in a folder of its own
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: presses the new-workspace shortcut or uses the composer, types a name and creates.
User sees: a placeholder row appears immediately, then the new workspace, with its own branch and
  folder, becomes active with a terminal of its own.
Rules: the shortcut is Mod+N, and Mod+Shift+N is bound as well; terminals in the new workspace start
  in its folder and never reach into another workspace; while Git is working a stand-in row and tab
  are shown, and the user can let it finish in the background without focus being pulled back; a
  creation overtaken by a newer one is cancelled and its half-made checkout removed; the sidebar
  header has one-click New workspace and Add project buttons, and New workspace works even before
  any project exists.
Acceptance:
  - [x] Create a workspace called fix-login → its branch and folder exist, its terminal starts in
        that folder, and going back to the main checkout keeps the two terminals apart. (cards live; evidence/cards-PROJ-020.txt)
  - [x] Start a create and move to another workspace → the create finishes in the background without
        taking focus. (cards live; evidence/cards-PROJ-020.txt)
  - [x] Make creating a workspace fail → the form opens again with the typed name, branch, prompt and
        base; if another project's form is open by then, the words are not put into it. (T-687; evidence/T-687.txt)
Compat: Keybinding id workspace.create.
  (Kolux RS, T-013-fix-a: with no project, Mod+N and the New workspace button open the add-project
  form; T-013-c built the overtaken-create and stand-in tab rules: a create made with Create more
  is never overtaken, and one Git finished before the cancel reached it stays, in the background.)
Source: D-01-020

### PROJ-021 · Workspace names become safe branch and folder names
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: types a workspace name containing spaces, punctuation, accented letters or emoji.
User sees: the shown name is exactly what was typed; the branch and folder get a cleaned-up form.
Rules: spaces turn into hyphens, repeated separators merge, characters Git does not allow are
  dropped, and runs of dots shrink; letters outside plain ASCII stay; emoji become their readable
  shortcode words in the branch and folder, while the shown name keeps the emoji itself; a name that
  cleans down to nothing becomes the branch "workspace" (SESS-036); when the branch name is already taken on the
  remote, a number is added; with no display name typed, the branch name is shown without its refs
  prefix.
Acceptance:
  - [x] Create "Fix login 🔥" → the branch reads like fix-login-fire and the shown name is
        unchanged. (cards; evidence/cards-PROJ-021.txt)
  - [x] Create a name made only of characters Git rejects (e.g. "???") → the branch becomes
        "workspace". (Reworded per Txais 2026-10-28 decisions file, A2: keep the fallback.)
        (cards; evidence/cards-PROJ-021.txt)
Compat: —
  (Kolux RS, T-013-fix-b: emoji outside the short-word table become their Unicode name in words,
  DT-C9; the pane header shows the typed name, `evidence/T-013-fix-b-header.png`.)
Source: D-01-021

### PROJ-025 · Choose where workspace folders live
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: sets the workspaces folder in settings, for all projects or for one, and picks the nested
  or flat layout.
User sees: new worktree folders are created in that place: inside a folder named after the project
  when nested, or all side by side when flat.
Rules: by default the root is a workspaces folder inside a kolux folder in the home folder, and
  leaving that default untouched does not count as a choice the user made; a relative folder is
  resolved from the project root; the nested layout names the project folder without a trailing
  dot-git ending; a folder set for one project overrides the global one; folders used before are
  remembered so they can be picked again quickly.
Acceptance:
  - [x] Point the folder at a location on another drive with nesting on, then create a in project
        app → the new folder sits at that location, inside app, named a. (cards; evidence/cards-PROJ-025.txt)
  - [x] Set a separate folder for one project → its new workspaces go there while other projects
        keep the global folder. (cards; evidence/cards-PROJ-025.txt)
Compat: Today the owner sets a project's own workspaces folder from the CLI through the host-setups
  command group, which is cut (PROJ-096). The folder moves to the per-repository settings page with
  no CLI route (OD-07 in DECISIONS.md); if that is flipped, a kolux command is added to COMPAT.md
  first.
Source: D-01-025

### PROJ-028 · Choose what a new workspace starts from (base ref)
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: leaves the start point as it is, or picks a branch, tag or commit under Start from.
User sees: the workspace begins at the chosen ref, or else at the project's saved base, or else at
  the default branch Kolux detects; when the saved base has disappeared, a dialog explains which ref
  was used instead.
Rules: a choice made for this one workspace always takes priority; a saved base that no longer
  exists falls back to the detected default, and the user is told once; if no default can be found
  at all, creation stops and asks the user to set a base; a base that tracks a remote is fetched
  fresh before use, while a full commit id is used directly with no fetch; fully spelled-out refs
  and review refs are passed along untouched; the fallback dialog waits until other dialogs close
  and lines up several notices one after another.
Acceptance:
  - [x] Delete the saved base branch on the remote, then create a workspace → it starts from the
        default branch and a fallback notice appears. (cards live; evidence/cards-PROJ-028.txt)
  - [x] Pick a full commit id as the start → the workspace starts there and no fetch happens. (cards; evidence/cards-PROJ-028.txt)
Compat: —
Source: D-01-028

### PROJ-038 · A new workspace can start an agent with a first prompt
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: chooses an agent and types a prompt while creating a workspace, or passes both to the
  CLI.
User sees: the workspace opens with that agent already working on the prompt in its first tab.
Rules: the agent runs in the startup tab made for it, not in an extra default tab; when no agent is
  chosen, the fallback order follows the catalog of installed agents.
  (Kolux RS, T-014-b-fix: on the command line the fallback is the settings' default agent when it
  is installed, else the first installed agent in catalogue order, and only when a prompt was
  given; a create with no prompt and no agent makes the worktree and opens no agent tab.)
Acceptance:
  - [x] Create with Claude and the prompt hello → the first tab runs Claude with that prompt. (cards live; evidence/cards-PROJ-038.txt)
  - [x] Create with an agent and a prompt → no additional empty default tab is opened. (cards live; evidence/cards-PROJ-038.txt)
Compat: —
Source: D-01-038

### PROJ-077 · `kolux worktree` create and remove
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: creates or removes workspaces from a terminal or from an orchestrating agent.
User sees: a workspace made with a name and, optionally, an agent and prompt, a base branch, a
  linked issue, a parent and a setup choice; removal with an optional force.
Rules: rm also answers to remove and delete and is marked as destructive; create can make the new
  workspace active in the app; setup can be run, skipped, or left to the project default.
Acceptance:
  - [x] Create one with a name, an agent, a prompt and JSON output → the JSON includes the new
        folder path; remove it by name → it is gone. (cards; evidence/cards-PROJ-077.txt)
  - [x] Create with setup skipped → no setup script runs for it. (cards live; evidence/cards-PROJ-077.txt)
Compat: kolux worktree create takes --name plus optional --repo, --agent, --prompt, --setup (run,
  skip or inherit), --base-branch, --issue, --comment, --parent-worktree or --no-parent, --activate,
  --run-hooks (the older spelling that runs setup and activates) and --json; kolux worktree rm (also
  remove and delete) takes --worktree plus optional --force, --run-hooks (runs the archive script)
  and --json. The --project, --host, --project-host-setup and --linear-issue flags belong to cut
  features.
Source: D-01-077

### PROJ-045 · Group the workspace list by project, status or pull request
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: picks a grouping for the workspace list in the sidebar.
User sees: rows grouped by nothing, by project, by workspace status or by pull-request state, under
  headers that fold.
Rules: a merged pull request goes to done, while a suppressed pull request counts as in progress;
  agent states sort into needs-you, working and done, with queued as a group of its own; the choice
  is remembered.
Acceptance:
  - [x] Group by pull-request state with one merged pull request → that workspace sits in done. (cards; evidence/cards-PROJ-045.txt)
  - [x] Restart after choosing a grouping → the same grouping is in place. (cards; evidence/cards-PROJ-045.txt)
Compat: —
Source: D-01-045

### PROJ-050 · Smart sort puts workspaces that need you first
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: leaves the list sorted by Smart.
User sees: blocked or waiting workspaces come first, then finished ones, then working, then idle;
  within each class the most recently changed is on top.
Rules: an old Recent setting is moved over to Smart once; an agent that was interrupted counts as
  interrupted, not as done.
Acceptance:
  - [x] One workspace blocked and one done → blocked is above done, whichever changed last. (cards; evidence/cards-PROJ-050.txt)
  - [x] Interrupt an agent → its workspace is not sorted among the done ones. (cards; evidence/cards-PROJ-050.txt)
Compat: —
Source: D-01-050

### PROJ-063 · Workspace row shows agent status, unread and pull request state
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: glances at the sidebar.
User sees: each row shows the strongest live state among its agents (a permission request ranks
  highest), an unread marker, and the state of any linked pull request.
Rules: unread can be switched by hand, even on the active row; switching branch inside the folder
  updates the row; pull request state is kept out of the main status slot by default; status
  reported by a session's hooks wins over status guessed from its title; the current workspace's row
  has a thin accent bar showing where the user is.
Acceptance:
  - [x] An agent in a background workspace asks for permission → its row shows the permission state
        ahead of other activity. (cards; evidence/cards-PROJ-063.txt)
  - [x] Switch branch in a workspace's terminal → the row shows the new branch. (cards live; evidence/cards-PROJ-063.txt)
Compat: —
Source: D-01-063

### PROJ-070 · Delete a workspace safely
Tier: P0 · Pushed: 5 · State at 0.15.0: live-unverified
User does: deletes a workspace from its row, from the menu, or with Mod+Shift+Backspace.
User sees: a confirmation that warns about uncommitted or untracked changes and lists any children;
  after confirming, the folder and branch are removed and focus moves to the most recently used
  sibling.
Rules: a workspace with changes is not deleted unless forced, and a locked one is never
  force-deleted; a folder that contains another registered worktree is refused; a workspace with
  children only offers to delete them all, children first and the parent last; a setting skips the
  confirmation for single deletes, but parents and batches always ask; if the workspace changed
  after the dialog opened, the confirmation is refused; focus stays within the same project and is
  not taken back if the user has gone elsewhere; the list holds its scroll position, and with
  reduced motion the row disappears without animation.
Acceptance:
  - [x] Delete a workspace holding an unsaved change → a warning shows; confirming without force is
        refused. (cards; evidence/cards-PROJ-070.txt)
  - [x] Delete the active row while the list is scrolled → no row still on screen moves; the list's
        scroll offset may shift by about one row (~70 px) because the active row is pinned. (Reworded
        per Txais 2026-10-28 decisions file, A.) (live 2026-10-27; evidence/cards-PROJ-070.txt)
Compat: Keybinding id workspace.delete.
Source: D-01-070

### PROJ-067 · Workspace tabs and layout are saved and restored
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits and reopens Kolux.
User sees: every workspace returns with its tabs and layout; saved state that is damaged is rescued
  in part rather than lost.
Rules: parts that cannot be read are dropped and the rest is kept; the workspace and tab that were
  active come back if they still exist. (Kolux RS, T-065: the tabs, the active tab per cell, the focus,
  the active workspace and the stacked cells are written to the saved-layout setting as they change; an
  agent tab comes back at its prompt in its folder, the session itself is SESS-030; a browser tab comes
  back as a fresh tab; tabs whose folder is gone are dropped.)
Acceptance:
  - [x] Corrupt one tab's saved entry → the other tabs still come back. (cards; evidence/cards-PROJ-067.txt)
  - [x] Quit with workspace B active → B is active after reopening. (cards; evidence/cards-PROJ-067.txt)
Compat: —
Source: D-01-067

### PROJ-047 · Child workspaces nest under their parent
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: creates workspaces from a parent, for instance one per agent.
User sees: children sit indented under the parent, can be folded away, and can nest to any depth.
Rules: a child whose parent is gone stays at the top level; with nesting switched off the list is
  flat; folding the children does not fold an agent summary that is open.
Acceptance:
  - [x] Create a child of P → it sits under P; fold P → the child is hidden. (cards; evidence/cards-PROJ-047.txt)
  - [x] Switch nesting off → every workspace is listed at one level. (cards; evidence/cards-PROJ-047.txt)
Compat: —
Source: D-01-047

### PROJ-055 · Move between workspaces with the keyboard
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: presses next or previous workspace, a number key, or the key that focuses the list.
User sees: the selection steps through the visible list and wraps at either end, jumps to the
  workspace at that position, or the list takes focus.
Rules: next and previous are Mod+Shift+Down and Mod+Shift+Up; Mod+1 to Mod+9 select by position;
  Mod+Shift+0 focuses the list; keyboard movement skips rows inside folded sections.
Acceptance:
  - [ ] On the last workspace, press next → the first workspace is selected.
  - [ ] Fold a section and press next → the rows inside it are skipped.
Compat: Four keybinding commands (previous, next, select by position, focus the list); their command
  ids are allowlist candidates.
Source: D-01-055

### PROJ-057 · Worktree palette: jump to any workspace by typing
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens the palette (Mod+J on Mac, Mod+Shift+J elsewhere; the View menu shows Open Worktree
  Palette only as a shortcut hint) and types.
User sees: workspaces where every typed word matches somewhere in the project, name or branch; Enter
  jumps to the selection, or creates a workspace from what was typed.
Rules: every word has to match somewhere, and matches are highlighted; filters combine, and on
  opening they start from the sidebar's current scope; main checkouts stay listed even while
  sleeping rows are hidden; with an empty query the palette obeys the hide-sleeping filter, while a
  typed query searches every workspace that is not archived.
Acceptance:
  - [ ] Type api fix → only workspaces matching both words show.
  - [ ] Hide sleeping rows and type nothing → sleeping workspaces are not listed, but main checkouts
        are.
Compat: Keybinding id worktree.palette.
Source: D-01-057

### PROJ-006 · Picking a linked worktree adds or selects its main repository
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: browses to a folder that is a linked worktree belonging to another repository.
User sees: when that repository's main checkout is already a project, that project is selected and
  no duplicate appears; when it is not, the linked worktree folder itself is added.
Rules: the match is made on the repository's main checkout, never on the folder that was picked.
Acceptance:
  - [ ] With repository A already added, add one of A's linked worktrees → no new project appears
        and A becomes selected.
  - [ ] With A not added, add one of its linked worktrees → that folder is added as a project.
Compat: —
Source: D-01-006

### PROJ-022 · Branch names get a configurable prefix
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: picks a branch-prefix style in the Git settings.
User sees: new branches begin with the Git user name, with custom text, or with nothing.
Rules: the Git user name is the default, and when no user name is configured the bare name is used;
  a custom prefix that Git would refuse is reported as an error, and trailing slashes are tidied.
Acceptance:
  - [ ] Set a custom prefix of tx/ → a new branch is tx/ followed by the name.
  - [ ] Pick no prefix → the branch is the bare name.
Compat: —
Source: D-01-022
Amended 2026-10-09 (DT-O1): a refused custom prefix is a warning on create and the bare name is used, per SET-031.

### PROJ-026 · KOLUX_WORKSPACES_DIR moves the default workspaces folder
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: sets the environment variable before starting Kolux.
User sees: workspaces are created under that folder rather than the default one in the home folder.
Rules: whitespace around the value is ignored and an empty value counts as not set; its purpose is
  to keep worktrees out of a home folder that a cloud service syncs.
Acceptance:
  - [ ] Start Kolux with KOLUX_WORKSPACES_DIR pointing at a folder on another drive and no folder
        setting → new workspaces are created under it.
  - [ ] Start with the variable holding only spaces → the default folder is used.
Compat: KOLUX_WORKSPACES_DIR takes an absolute path; it is trimmed and ignored when empty.
Source: D-01-026

### PROJ-030 · Open an existing branch or pull request as a workspace
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: picks an existing branch or a pull request when creating a workspace.
User sees: the workspace checks out that very branch rather than starting a new one.
Rules: changing the folder name still uses the existing branch; when the remote name for a pull
  request clashes with one already present, a suffix is added; branches opened this way stay when
  the workspace is deleted; a local branch for the pull request is reused only if it points at the
  pull request's latest commit.
Acceptance:
  - [ ] Create from the existing branch feat/x → the workspace is on feat/x with its earlier
        commits.
  - [ ] Open a pull request whose local branch lags behind it → that local branch is not reused.
Compat: —
Source: D-01-030

### PROJ-032 · Ignored local files the repo lists are copied into new workspaces, within a budget
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: keeps, at the repo root, a list of ignored local files to bring along (env files, for
  example) and creates a workspace.
User sees: the listed files show up in the new workspace; anything over the budget is left out with
  a warning that names up to five of the skipped items.
Rules: the budget is about 2 GB and 50,000 entries per workspace; on macOS a fast copy-on-write
  clone is used; an interrupted copy warns that partial files may be left behind.
Acceptance:
  - [ ] List an env file and a large dependency folder → the env file is copied, and the dependency
        folder is skipped and named in the warning.
  - [ ] Interrupt a copy → a warning says leftovers may remain.
Compat: Reads `.worktreeinclude` at the repo root, one literal path per line; wildcard and negation
  lines are skipped with a warning (COMPAT 5.6).
Source: D-01-032

### PROJ-033 · A project setup script runs when a workspace is created
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: sets a setup script on the per-project page or in kolux.yaml, then creates a workspace.
User sees: a Setup tab runs the script in the background; the agent can start alongside it or wait
  until it is done.
Rules: where it opens: a new tab (the default), a vertical split or a horizontal split; in new-tab
  mode with wait for setup on, the agent starts only once setup has finished; on Windows the script
  runs through the configured shell when that shell is a POSIX one; creating from the CLI can force
  the script to run, skip it, or follow the project's default; on Windows, a script whose first line
  names a POSIX shell runs through that shell with the flags it declares; Windows line endings are
  accepted, and other interpreters are not mistaken for POSIX shells; on Windows, a script that
  would go through cmd is refused when it holds characters cmd would misinterpret.
Acceptance:
  - [ ] Set the setup to install dependencies with wait for setup on → the agent tab starts only
        after the install exits.
  - [ ] Create from the CLI with setup skipped → no Setup tab runs.
Compat: —
Source: D-01-033

### PROJ-037 · Create a workspace straight from a GitHub issue or pull request
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: pastes an issue or pull request URL into the palette, or uses the CLI's issue flag.
User sees: the create action is already selected; the new workspace is linked to the item and named
  after its title.
Rules: plain names and repository home pages are not taken as links to work items; free text offers
  create but leaves the first matching workspace selected.
Acceptance:
  - [ ] Paste a pull request URL into the palette and press Enter → a workspace named after the pull
        request's title opens, linked to it.
  - [ ] Paste a repository's home page URL → it is not treated as a work item.
Compat: —
Source: D-01-037

### PROJ-039 · The branch is renamed to fit the work once it begins
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: starts working in a workspace that still has its suggested name.
User sees: the branch and its folder get a new name that describes the work; if renaming fails, a
  dialog shows the complete output.
Rules: on by default; the folder is renamed in place, inside the same parent, to the last part of
  the new branch name; only a name Kolux suggested itself is ever replaced automatically; the
  configured agent proposes a short, lowercase, hyphenated branch name from the work; the shown name
  changes to a readable sentence-case version of that branch name; a reply that repeats the branch
  prefix has the prefix removed, and a reply that is only the prefix is ignored.
Acceptance:
  - [ ] Turn the setting off → the branch keeps its suggested name.
  - [ ] Start work in a workspace the user named by hand → its name is not changed.
Compat: —
Source: D-01-039

### PROJ-041 · Worktrees made outside Kolux are noticed and offered for review
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: makes a worktree with plain Git, another tool or the CLI.
User sees: a count line in the sidebar (for example, 3 new worktrees) opens a review where each can
  be shown or hidden; worktrees created from the CLI appear without a restart.
Rules: workspace folders are watched in both layouts for worktrees appearing and disappearing, with
  polling wherever file watching is unreliable; scratch worktrees made by coding tools are
  recognised and stay hidden; a burst of events produces one notice.
Acceptance:
  - [ ] Add a worktree with plain git worktree add → the sidebar notices it within a refresh, with
        no restart.
  - [ ] Add several worktrees at once → a single notice appears.
Compat: —
Source: D-01-041
Amended 2026-10-09 (DT-O2): new worktrees are noticed by a 5 s poll of Git's worktree list while the window is visible, in both layouts, rather than a folder watcher.

### PROJ-042 · Show or hide individual worktrees, with defaults for new projects
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: opens the worktree visibility dialog for a project.
User sees: the hidden worktrees, each listed by its path relative to the repository with show and
  hide controls, and a link to the global defaults.
Rules: in new projects, worktrees made outside Kolux start hidden; long lists are shown a page at a
  time; existing projects keep their earlier behaviour when the default changes; visibility is
  chosen per source: the worktree folder of each built-in agent tool, other locations, and custom
  folders the user adds; custom folders start hidden and are limited to 32; invalid, repeated,
  over-limit and failed-to-save entries each get their own error; a project-level override shows the
  global value it replaces and can be reset to it.
Acceptance:
  - [ ] Hide a worktree → it leaves the sidebar; show it again → it comes back.
  - [ ] Try to add a 33rd custom folder → an over-limit error appears.
Compat: —
Source: D-01-042

### PROJ-044 · Kolux tells its own worktrees apart from external and scratch ones
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: has worktrees made by Kolux, by hand and by agent tools in the same repository.
User sees: Kolux-made ones act as managed workspaces; the rest count as external; scratch folders
  from tools stay hidden.
Rules: Kolux's own records mark a worktree as managed even when it sits outside the workspaces
  folder; a folder under the workspaces folder that Kolux has no record of is external; a base
  folder the user set explicitly takes priority over the built-in rule for scratch paths.
Acceptance:
  - [ ] Make a worktree by hand inside the workspaces folder → it is listed as external.
  - [ ] A Kolux-made workspace that lives outside the workspaces folder → still treated as managed.
Compat: —
Source: D-01-044

### PROJ-034 · kolux.yaml shares setup, issue command and tabs with the whole team
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: commits a kolux.yaml file at the root of the repository.
User sees: Kolux asks once whether to trust the file before running its setup script, and asks again
  whenever that script changes; after that it applies the setup, the default issue command and the
  default terminal tabs to every new workspace.
Rules: trust is granted per repository and per exact script text; values are trimmed, and an empty
  file means no shared settings; local per-repo settings can run in place of the shared ones or in
  addition to them; a file that is too big, or whose aliases expand out of control, is refused
  before it is read, and fields or lists beyond their limits are dropped.
Acceptance:
  - [ ] Change the setup line in kolux.yaml → the next create asks for approval again.
  - [ ] Commit an empty kolux.yaml → no shared settings apply.
Compat: The kolux.yaml file at the repo root holds a setup script, whether the agent starts at once
  or waits for setup, an issue command, and a list of default tabs, each with a title, a colour and
  a command; its archive script and shared-folders list stay as well (STAT-055, GIT-067 and OD-14
  in DECISIONS.md), while its environment recipes belong to a cut feature and are ignored. Files
  already in users' repositories must keep working; the exact key spellings are in COMPAT.md 5.6.
Source: D-01-034

### PROJ-082 · Bulk remove from cleanup runs in the background
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: confirms removal of the selected workspaces.
User sees: a confirmation naming each kind of local context that will be lost, then progress while
  removal runs; parents go after their children.
Rules: a removal that times out but later succeeds counts as a success, and a late failure skips its
  parent; rows whose safety could not be checked need explicit agreement; large selections are shown
  as a list of limited length; nothing starts if no candidates are left.
Acceptance:
  - [ ] Remove five workspaces with one slow → progress shows, and the slow one finishes and is
        counted.
  - [ ] Include a row whose safety could not be checked → removal waits for explicit agreement.
Compat: —
Source: D-01-082

### PROJ-002 · The Add Project dialog opens on cloning, with browse and create one step away
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: opens the Add Project dialog.
User sees: cloning from a URL is the main, most prominent choice; opening an existing folder
  (Browse) and starting a new project sit beside it as secondary choices that are always visible;
  the arrow keys and Enter move between the choices.
Rules: Browse comes first among the secondary choices; the dialog opens on this same first step
  whether or not any project exists yet.
Acceptance:
  - [ ] With no projects yet, open Add Project → cloning is the main choice and Browse is visible
        without scrolling.
  - [ ] With several projects present, open Add Project → the same first step appears.
  - [ ] Press the arrow keys, then Enter → focus moves between the choices and Enter activates the
        focused one.
  - [x] Close the dialog while a clone is copying → it asks first, and Keep copying carries on;
        with no clone running it closes at once. (T-687; evidence/T-687.txt)
Compat: —
Source: D-01-002

### PROJ-085 · Workspace board: lanes by status
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: opens the workspace board and drags cards between lanes.
User sees: a lane for each status holding its workspaces; dragging changes the status; search
  filters every lane where it stands.
Rules: the command that opens the board has no default shortcut; a row dragged from the sidebar can
  be dropped on a lane; a drop in a gap goes to the nearest lane, and column widths are kept within
  limits; Escape does not close the board while a popover is open; the board's search is cleared
  when the board closes.
Acceptance:
  - [ ] Drag a card from Todo to Review → the sidebar shows Review too.
  - [ ] Close and reopen the board → its search is empty.
Compat: The open-board command is a keybinding command with no default key; its command id is an
  allowlist candidate.
Source: D-01-085

### PROJ-027 · Worktree work on cloud-synced folders fails fast instead of hanging
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: creates or removes a workspace inside a folder synced by OneDrive or a similar service.
User sees: a Git step that stalls ends with an error after a fixed wait instead of freezing the app;
  a flood of file events causes one refresh of the list, not many.
Rules: adding a worktree waits up to three minutes by default; an environment variable can lengthen
  that, held between three and thirty minutes; checks before removal and reads of the worktree list
  give up after thirty seconds.
Acceptance:
  - [ ] Make a worktree add stall → an error arrives within the limit and the app keeps responding.
  - [ ] Set off a burst of file events in the synced folder → the list refreshes once.
Compat: An environment variable sets the add timeout in milliseconds, clamped to between three and
  thirty minutes; its exact name is an allowlist candidate.
Source: D-01-027

### PROJ-031 · Workspace-creation errors say what kind of problem it was
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs into a failure while creating a workspace.
User sees: a message naming the type of problem (missing base, name in use, Git failure,
  permissions, other) and what to try next.
Rules: Git's own detailed output can still be viewed.
Acceptance:
  - [ ] Create with a branch name that already exists locally → the message says the name is in use.
  - [ ] Cause a Git failure → the message gives access to Git's full output.
Compat: —
Source: D-01-031

### PROJ-064 · Rows show commits not yet pushed
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: commits in a workspace and does not push.
User sees: the row shows how many commits are ahead of the remote, or that it is in sync, or that
  the branch is unpublished when it has no upstream.
Rules: the unpublished count is looked up only for branches that lack an upstream.
Acceptance:
  - [ ] Commit twice without pushing → the row shows 2 ahead.
  - [ ] Push → the row shows it is in sync.
Compat: —
Source: D-01-064

### PROJ-068 · Workspace records survive refreshes, renames and re-adds
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: renames folders, refreshes, or removes a project and adds it back.
User sees: names, parents, notes and order stay with the right workspaces.
Rules: simultaneous updates to one project are applied one after another; a refresh that finds no
  change does not reorder the list; an older refresh never replaces the result of a newer one.
Acceptance:
  - [ ] Refresh twice with nothing changed → no row moves.
  - [ ] Rename a workspace's folder outside Kolux → its notes and parent stay with it.
Compat: —
Source: D-01-068

### PROJ-072 · Recover from a failed delete
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs into an error while deleting.
User sees: a toast that says why (naming the terminals still running, the lock reason, or that the
  folder is already gone), with Force delete when that is safe and View changes when files changed.
Rules: after the user confirms force, leftover folders Kolux created are cleaned up; on Windows,
  failures caused by over-long paths are recovered by forcing a local delete and pruning; a
  registration Git still reports is never removed underneath it; a missing folder that Git still
  tracks is handled as cleanup.
Acceptance:
  - [ ] Delete while a terminal is using the folder → the toast names the terminal and offers force.
  - [ ] Delete a workspace whose folder was removed by hand → it is cleaned up without an error.
Compat: —
Source: D-01-072

### PROJ-073 · Branches stay when a workspace was opened on an existing branch
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: deletes a workspace that was opened on an existing branch.
User sees: the folder goes and the branch stays; a toast offers to delete the branch as well, and a
  batch delete opens a single review list.
Rules: only branches ticked in the review are force-deleted, one at a time per repository; an
  out-of-date action, where the branch has moved since, is refused.
Acceptance:
  - [ ] Delete such a workspace → the branch still exists; choose delete in the toast → the branch
        is gone.
  - [ ] Move the branch, then use the old toast's delete → refused.
Compat: —
Source: D-01-073

### PROJ-074 · Deleted folders go to a hidden trash and are cleared in the background
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: deletes a large workspace.
User sees: the row vanishes at once; disk space comes back shortly after, and leftovers are swept up
  on later runs.
Rules: the folder is first moved into a hidden trash folder beside it, then deleted; if the removal
  has to be undone, the folder is moved back to where Git expects it; the sweep touches only trash
  folders, including ones named the way they were before the rename step existed.
Acceptance:
  - [ ] Delete a 2 GB workspace → the row is gone at once and the space returns within the
        background pass.
  - [ ] Leave a trash folder behind and restart → the next sweep clears it.
Compat: —
Source: D-01-074

### PROJ-080 · Workspace cleanup: scan for stale and merged workspaces
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens the cleanup dialog.
User sees: a scan with progress that lists workspaces gone quiet; clean, inactive ones come
  preselected; an option shows every workspace.
Rules: a listing that hangs, or a slow read of details, times out for that repository instead of
  holding up the scan; repeated scans join the one already running; the previous result shows
  straight away while a new scan runs, and filters and browsing state are kept.
Acceptance:
  - [ ] Open cleanup with three idle, clean workspaces → all three are preselected.
  - [ ] Open cleanup twice in quick succession → only one scan runs.
Compat: —
Source: D-01-080

### PROJ-089 · Crash reports and feedback from the sidebar
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens a captured crash report or the feedback dialog.
User sees: the report can be copied; feedback opens already filled in with the app version and
  operating system.
Rules: reports dismissed without being sent can still be reached from Help; text typed above the
  pre-filled block is kept.
Acceptance:
  - [ ] Open feedback → the version and operating system are already there.
  - [ ] Dismiss a crash report without sending it → it is still reachable from Help.
Compat: —
Source: D-01-089

### PROJ-023 · New workspaces are offered a unique sea-creature name
Tier: P1 · Pushed: 10 · State at 0.15.0: live-unverified
User does: opens the create flow without typing a name.
User sees: a lowercase sea-creature name is suggested that no workspace in any project is using.
Rules: uniqueness ignores case and covers every project; once the list of names is used up, numbered
  rounds follow; a name the user has changed is never replaced by a fresh suggestion.
Acceptance:
  - [ ] With otter in use in another project → otter is never suggested.
  - [ ] Edit the suggested name and let another suggestion come in → the edited name stays.
Compat: —
Source: D-01-023

### PROJ-040 · Nest a new workspace under a parent workspace
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: creates a workspace while a parent is chosen, or passes a parent to the CLI.
User sees: the new workspace shows up as a child of that parent.
Rules: if the chosen parent has disappeared it is dropped and the active folder workspace is used;
  if a parent is dropped because it was archived, a warning is shown.
Acceptance:
  - [ ] Create with parent P → the new row sits under P.
  - [ ] Create with a parent that was archived → a warning appears and the workspace is not placed
        under it.
Compat: —
Source: D-01-040

### PROJ-048 · Change a workspace's parent
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: uses the parent picker, drops a card onto the middle of another card, or uses the CLI's
  parent flags.
User sees: the workspace moves under its new parent, or to the top level when the parent is cleared.
Rules: the picker never offers the workspace itself, its current parent or any of its descendants;
  only the middle band of a card accepts a parent drop; dropping on its edges reorders instead; if
  assigning fails, a short error shows once the picker has closed.
Acceptance:
  - [ ] Drag A onto the middle of B → A becomes B's child.
  - [ ] Open the parent picker for A → A, its parent and its descendants are not offered.
Compat: —
Source: D-01-048

### PROJ-078 · `kolux worktree` list, show, current and set
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: looks up or edits workspaces from the CLI.
User sees: a list (per project if asked, with a limit), one workspace's details, the current
  workspace, and edits to the shown name, linked issue, comment, status or parent.
Rules: every one accepts --json.
Acceptance:
  - [ ] Set a workspace's shown name to A from the CLI → the sidebar shows A.
  - [ ] Ask for the current workspace from a terminal inside one → that workspace is reported.
Compat: kolux worktree list with optional --repo and --limit; show --worktree; current; set
  --worktree with optional --display-name, --issue, --comment, --workspace-status, and
  --parent-worktree or --no-parent; all accept --json.
Source: D-01-078

### PROJ-079 · `kolux worktree changes` and `kolux worktree overlap`
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: asks which files a workspace has changed, or which workspaces touch the same files.
User sees: a list of changed files, or the files shared between workspaces, to catch conflicts
  between agents early.
Rules: both accept --json.
Acceptance:
  - [ ] Two workspaces edit the same file → overlap lists that file.
  - [ ] Change two files in a workspace → changes lists both.
Compat: kolux worktree changes and kolux worktree overlap, each with an optional --json.
Source: D-01-079

### PROJ-003 · Clone a repository from a URL into a suggested folder
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: pastes a Git URL into the clone step and confirms.
User sees: the target folder is already filled in; the clone shows progress, and when it succeeds
  the new project opens on its default checkout.
Rules: the suggested target is the folder above the workspaces folder (a final path part called
  workspaces is dropped), or the home folder when no workspaces folder is set; relative URLs, and
  URLs carrying dot or double-dot segments, are rejected; a user name, password or token embedded in
  the pasted URL is stripped before Git runs; the clone never opens an interactive password window;
  a missing credential ends it with Git's complete error text on screen; cancelling deletes only a
  folder this clone itself created, and two clones aimed at the same folder wait for each other; no
  prompt about setup choices interrupts the hand-off to the new checkout.
Acceptance:
  - [ ] Paste a URL that carries a user name and token → Git receives the URL with those parts
        removed.
  - [ ] Cancel part-way through a clone into a new folder → that folder is gone; cancel one aimed at
        a folder that existed before → it is left as it was.
Compat: —
Source: D-01-003

### PROJ-004 · Start a brand-new empty project from a name
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: picks the create-new choice, types a name, and optionally changes the parent folder.
User sees: a new folder holding a fresh Git repository with one empty first commit, registered as a
  project and opened.
Rules: the parent folder starts as the home folder, whatever the workspaces folder setting says; an
  empty name, a lone dot, a double dot, or any name with a forward or back slash is rejected; a
  target folder that exists and has content is rejected, and a create that fails undoes whatever it
  had made; when Git has no user name or email configured, the user gets a plain explanation of what
  to set; the dialog says so when Git itself is not installed.
Acceptance:
  - [ ] Create a project called demo under the home folder → a demo folder exists there with one
        commit and opens as a project.
  - [ ] Try to create into a folder that already has files → refused, and nothing is written.
Compat: —
Source: D-01-004

### PROJ-005 · A folder without Git can be opened as a folder project
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: adds a folder that is not a Git repository.
User sees: a confirmation offering Open as Folder; accepting adds a folder project, whose workspaces
  are ordinary folders rather than Git worktrees.
Rules: a Git repository goes straight to its default checkout with no confirmation; saying no adds
  nothing.
Acceptance:
  - [ ] Add a plain folder → the confirmation shows; accept → the project has one folder workspace.
  - [ ] Add a plain folder and decline → no project is added.
Compat: —
Source: D-01-005

### PROJ-008 · Remove a project from Kolux
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: chooses delete on a project's main workspace, or removes the project from its header.
User sees: a confirmation for removing the project; afterwards the project and its rows are gone
  from the sidebar, while its files stay on disk.
Rules: removal also clears what Kolux kept about that project (retired suggested names, saved
  presets), so adding it back starts fresh; cached scan results for that path are thrown away
  whenever it is added, removed or added again; the project's sessions and terminals are closed.
Acceptance:
  - [ ] Remove a project → it leaves the sidebar and its folder is untouched; add it again → it
        returns with a clean record.
  - [ ] Remove a project that has a running terminal → that terminal closes.
Compat: —
Source: D-01-008

### PROJ-010 · The `kolux repo` commands
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs the repo commands from a terminal or from an agent.
User sees: commands to list projects, add one by path, show one, set its base branch, and search its
  branches and tags; each can print JSON.
Rules: setting the base ref changes what new workspaces start from when no start point is given; the
  ref search takes a query and an optional cap on the number of results.
Acceptance:
  - [ ] Add a repository by path, then list with JSON output → the repository is in the list.
  - [ ] Set a base ref, then create a workspace without naming a start point → it starts from that
        ref.
Compat: `kolux repo list`; `kolux repo add --path <p>`; `kolux repo show --repo <r>`;
  `kolux repo set-base-ref --repo <r> --ref <ref>`; `kolux repo search-refs --repo <r> --query <q>`
  with an optional `--limit`; every one accepts `--json`.
Source: D-01-010

### PROJ-011 · The `kolux project list` command
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs `kolux project list`.
User sees: the projects Kolux knows about, as plain text or as JSON.
Rules: it only reads and never changes anything.
Acceptance:
  - [ ] Run it with `--json` → one entry for each project in the sidebar.
  - [ ] Run it while the app is open → nothing in the sidebar changes.
Compat: `kolux project list`, with an optional `--json`.
Source: D-01-011

### PROJ-012 · Scan a parent folder for the repositories inside it
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: picks a folder that is not a repository itself but holds several.
User sees: a scan with running progress that lists each repository it finds; the user can stop it
  and keep everything found so far.
Rules: the scan goes level by level in alphabetical order, honours ignore files, and neither enters
  heavy dependency folders nor follows symbolic links; bare repositories are recognised without
  being entered; depth and count limits bound the scan, and there is no time limit unless one is
  asked for.
Acceptance:
  - [ ] Scan a folder holding three repositories and a large package-dependency folder → three
        repositories are listed and the dependency folder is never opened.
  - [ ] Stop the scan early → the repositories found so far can still be selected.
  - [x] Close the scan dialog while it is scanning → that scan is stopped; closing after it ends stops
        nothing. (T-687; evidence/T-687.txt)
Compat: —
Source: D-01-012

### PROJ-013 · Import found repositories as one group or as separate projects
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: ticks repositories in the checklist and says whether to group them.
User sees: grouped, they become one project group named after the parent folder (the name can be
  edited) with the repositories nested to mirror the folder layout; separate, each repository is its
  own top-level project.
Rules: a blank group name falls back to the parent folder's name; in-between folders that lead to
  only one repository are folded away instead of becoming empty groups; with nothing ticked, the
  parent itself can be opened as a folder project; repositories that share a name get steady labels
  that tell them apart in the checklist; a linked worktree found by the scan is mapped to its main
  checkout.
Acceptance:
  - [ ] Bring in x and z as one group, where z sits one folder deeper inside y → one group, with x
        directly inside it and z inside a sub-group for y.
  - [ ] Untick everything → the parent can be opened as a folder project.
Compat: —
Source: D-01-013

### PROJ-014 · Project groups organise the sidebar
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: creates, renames and nests project groups and moves projects into them.
User sees: group headers that fold open and closed, holding projects and sub-groups; empty groups,
  and projects with no workspaces, still appear.
Rules: groups are kept across restarts; an empty name is replaced by a default name; a group made
  while the sidebar is refreshing is not lost.
Acceptance:
  - [ ] Create a group and restart → it is still there, empty.
  - [ ] Create a group while the sidebar is refreshing → the group survives the refresh.
  - [x] Make a new group, then close its form before Save → the group is removed again, once, and only
        while it still exists. (T-687; evidence/T-687.txt)
Compat: —
Source: D-01-014

### PROJ-015 · Delete a project group, with or without its projects
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: deletes a project group.
User sees: a confirmation with a choice to also remove the projects inside it, sub-groups included;
  without that choice the projects move out of the group.
Rules: removing projects never deletes their folders on disk.
Acceptance:
  - [ ] Delete a group with the choice off → its projects are back at the top level.
  - [ ] Delete a group with the choice on → its projects, those in sub-groups too, leave the sidebar
        while their folders stay on disk.
Compat: —
Source: D-01-015

### PROJ-016 · Drag project and group headers into order
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: drags a project header or group header up or down.
User sees: the header settles into the closest allowed slot among its siblings, and the order holds
  after a restart.
Rules: a header moves only within the group that holds it, or within the ungrouped list; projects
  with no saved position come last, sorted by name.
Acceptance:
  - [ ] Inside a group holding A, B and C, drag C above A and restart → the order reads C, A, B.
  - [ ] Drag a header toward a different group → it stays within its own group.
Compat: —
Source: D-01-016

### PROJ-046 · Pin workspaces to a pinned section
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: pins a workspace.
User sees: it shows in a pinned section at the top, along with its visible children.
Rules: by default a pinned row is not repeated inside its usual group; a setting shows a copy there
  as well.
Acceptance:
  - [ ] Pin a parent → its children also appear under it in the pinned section.
  - [ ] Turn on the copies setting → the pinned row also shows in its group.
Compat: —
Source: D-01-046

### PROJ-049 · Manual order: drag workspaces into a custom order
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: drags one row, or several selected rows, to a new position.
User sees: the list switches to Manual order and the new positions hold through activity and
  restarts.
Rules: the first drag captures the order currently on screen as the starting manual order; dragging
  near the top or bottom edge scrolls the list; long lists that only draw the rows in view stay
  steady while dragging downward; when grouped by status and not in Manual order, dropping into a
  different lane only changes the status, while dropping within a lane saves the order.
Acceptance:
  - [ ] Drag the fifth row to the top and restart → it is still first.
  - [ ] Grouped by status in Smart order, drop a row into another lane → its status changes and the
        sort stays Smart.
Compat: —
Source: D-01-049

### PROJ-051 · Recent sort orders by last activity
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: switches the list to Recent.
User sees: workspaces in order of their latest activity; brand-new ones keep their place for a short
  while.
Rules: newly added projects are time-stamped so they show at the top.
Acceptance:
  - [ ] Add a folder project → it is first in Recent.
  - [ ] Work in an older workspace → it moves up in Recent.
Compat: —
Source: D-01-051

### PROJ-052 · Filter the workspace list
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: turns on filters such as hiding sleeping workspaces or the default branch, or showing
  only some projects.
User sees: only matching rows are shown; one control clears every filter; filters are kept across
  restarts.
Rules: hiding sleeping workspaces still keeps the default-branch row unless the user chooses
  otherwise; only a main checkout backed by a branch counts as the default-branch row, and folder
  projects never do; a retired filter for active workspaces only is not brought back from old
  settings.
Acceptance:
  - [ ] Hide sleeping workspaces while the main checkout is asleep → the main checkout still shows.
  - [ ] Clear the filters → every row returns.
Compat: —
Source: D-01-052

### PROJ-053 · Put a workspace to sleep
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: chooses sleep on a workspace.
User sees: its browser tabs and terminals close, it goes into a sleeping state along with its
  children, and it can be woken later.
Rules: if it was the active workspace, another one is selected first; the toggle for the
  sleeping-workspaces panel has no default shortcut.
  Since T-687 (DT-C123): when running terminals in the workspace or its children would close, Sleep
  first asks, naming how many, as Remove does.
Acceptance:
  - [ ] Put a workspace with two terminals to sleep → both processes end and the row shows it is
        sleeping.
  - [ ] Put the active workspace to sleep → another workspace is selected first.
  - [x] Sleep a workspace whose child has a running terminal → it asks first, counting that terminal;
        a parent's sleep plan lists only the folders that change. (T-687; evidence/T-687.txt)
Compat: The sleeping-workspaces panel toggle is a keybinding command with no default key; its
  command id is an allowlist candidate.
Source: D-01-053

### PROJ-056 · Back and forward through visited workspaces
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses back or forward (Mod+Alt+Left or Mod+Alt+Right) or the toolbar arrows.
User sees: the workspace visited before comes back, the way browser history works.
Rules: the buttons appear only in the terminal view and start out disabled; picking the workspace
  that is already current adds nothing to history, and going somewhere new discards forward history;
  it has no effect inside settings.
Acceptance:
  - [ ] Visit A, then B, then C, and press back twice → A; then visit D → forward is disabled.
  - [ ] Open settings and press back → nothing happens.
Compat: Keybinding ids worktree.history.back and worktree.history.forward.
Source: D-01-056

### PROJ-059 · Rename a workspace inline
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: starts an inline rename on a row (Mod+Alt+R on Mac) and types.
User sees: pressing Enter updates the shown name; a blank or unchanged name cancels.
Rules: surrounding spaces are trimmed; emoji shortcodes turn into emoji as the user types.
  Since T-687 (DT-C123): clicking elsewhere in the window saves the rename too and puts the focus
  back on the row; switching to another window does not.
Acceptance:
  - [ ] Rename to x with spaces before and after it → saved as x.
  - [ ] Rename to an empty name → the rename is cancelled.
Compat: Keybinding id workspace.rename.
Source: D-01-059

### PROJ-060 · Workspace details: name, linked item and notes
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a workspace's details.
User sees: fields for the shown name, a linked GitHub issue or pull request, and a comment that
  appears on the card as compact formatted text.
Rules: pasting a GitHub link fills in the linked-item field; the comment shows headings, links and
  images in compact form, and links open when clicked.
Acceptance:
  - [ ] Paste an issue URL into the details → the card shows the linked issue.
  - [ ] Write a comment with a heading and a link → the card shows it formatted and the link opens
        on click.
Compat: —
Source: D-01-060

### PROJ-065 · Workspace context menu
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: right-clicks a workspace row.
User sees: actions that include delete, sleep, move to a status, set parent, and Open in (file
  manager, editor, terminal).
Rules: the file manager's name follows the platform; Open in is disabled while the workspace is
  being deleted; a developer submenu appears only when Alt or Option was held as the menu opened,
  and never for several rows at once.
Acceptance:
  - [ ] Right-click on Windows → Open in lists Explorer.
  - [ ] Hold Alt while right-clicking two selected rows → no developer submenu.
  - [x] Open the menu and press the arrows, Home and End → the focus wraps and jumps; when statuses or
        editors fail to load, a note says which. (T-687; evidence/T-687.txt)
  - [x] Open the menu on a workspace → Move up and Move down step among its siblings only and are off
        at either end; the main checkout's menu has neither. (T-687; evidence/T-687.txt)
Compat: —
Source: D-01-065

### PROJ-071 · Delete many workspaces at once
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: selects several rows and deletes them.
User sees: one confirmation for the whole set, deletions running side by side, and a single summary
  of any branches kept.
Rules: main checkouts are taken out of a batch; each item is checked again just before it runs, and
  rows that changed are reported rather than quietly skipped; duplicates count once.
Acceptance:
  - [ ] Delete 100 workspaces → one confirmation and one summary.
  - [ ] Include the main checkout in the selection → it is left out of the batch.
Compat: —
Source: D-01-071

### PROJ-076 · Forget a workspace locally without touching disk
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: chooses forget on a workspace whose folder or project is gone.
User sees: the row and Kolux's records for it disappear; nothing on disk changes.
Rules: it works even after the project itself was removed; a folder project's root cannot be
  forgotten this way.
Acceptance:
  - [ ] Forget a workspace whose folder was deleted by hand → the row is gone with no error.
  - [ ] Look for forget on a folder project's root → it is not offered.
Compat: —
Source: D-01-076

### PROJ-083 · Space view: what each workspace costs on disk
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the Space view.
User sees: a disk-usage map of projects and workspaces, counting reclaimable space only for linked
  worktrees, with delete actions.
Rules: scans report progress and are shared between requests; if the system's size tool never
  finishes, size reading switches to a fallback; scan budgets cap memory, and a scan that goes over
  is marked incomplete rather than showing wrong numbers; results are saved and shown next time, and
  leftover worktree registrations that no longer exist are left out; deleting from Space uses the
  safety-checked confirmation without force; Git status checks cover every row that can be deleted,
  not just the first 50.
Acceptance:
  - [ ] Open Space → the main checkout is not counted as reclaimable.
  - [ ] Reopen Space after a scan → the saved result shows right away.
Compat: —
Source: D-01-083

### PROJ-084 · Workspace statuses form a workflow
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: moves a workspace to a status, or edits the list of statuses.
User sees: each workspace carries a status from an ordered workflow: the default set, or the user's
  own labels and order.
Rules: every status the user defines is kept, in order, none cut off.
Acceptance:
  - [ ] Add a custom status → it shows in Move to Status and on the board.
  - [ ] Reorder the statuses → the menu and the board follow the new order.
Compat: —
Source: D-01-084

### PROJ-086 · Folder workspaces for projects without Git
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: adds more workspaces to a folder project.
User sees: each is a folder entry with its own terminals and notes; a folder that has gone missing
  is flagged on its row.
Rules: the project's root folder workspace cannot be deleted; creating one closes the composer even
  if showing it fails; notes survive downgrading and then upgrading the app; a folder workspace
  shows the worst pull-request check result among the worktrees attached to it, nested ones included
  (failing beats pending beats passing), leaving out pull requests that were dismissed.
Acceptance:
  - [ ] Delete a folder workspace's folder by hand → its row shows it is missing.
  - [ ] Attach two worktrees, one with failing checks and one passing → the folder workspace shows
        failing.
Compat: —
Source: D-01-086

### PROJ-035 · Sidebar card that suggests adding a setup script
Tier: P2 · Pushed: 6 · State at 0.15.0: live-unverified
User does: works in a project that has no setup script in effect.
User sees: a small card above the sidebar toolbar offers to set one up; it goes away once a script
  takes effect or the user dismisses it.
Rules: while the card is up, it re-checks whenever the Kolux window comes back into focus or a
  workspace is made active; dismissal is remembered per project; it suggests the install command of
  the package manager the project declares; when another worktree tool's settings or a Codex
  environment file holds a setup command, the card offers to save it as a local setup, lists any
  fields it skipped as unsupported, and the confirmation links to the project's settings; when the
  shared setup file cannot be read, the card shows an error with Retry and recovers once the file is
  fixed.
Acceptance:
  - [ ] Save a setup script from the card → the card goes away.
  - [ ] Dismiss the card, then reopen the project → it stays dismissed.
Compat: —
Source: D-01-035

### PROJ-017 · Project headers have a colour
Tier: P2 · Pushed: 7 · State at 0.15.0: live-unverified
User does: picks a colour for a project or group header.
User sees: the header's badge takes the chosen colour from the palette; new projects begin grey.
Rules: only colours from the palette are saved.
Acceptance:
  - [ ] Make a header blue and restart → it is still blue.
  - [ ] Add a new project → its badge is grey.
Compat: —
Source: D-01-017

### PROJ-062 · Workspace cards: Default and Compact looks
Tier: P2 · Pushed: 7 · State at 0.15.0: live-unverified
User does: picks which details workspace cards show, or a preset.
User sees: Default shows the status and an agent summary; Compact shows status only, with the pull
  request, ports, task and notes on hover.
Rules: status stays on in both presets; older profiles receive the newer separate options without
  duplicates; hovering a row shows a long title again even when the branch is also shown.
Acceptance:
  - [ ] Choose Compact → rows shrink to a single line; hovering shows the pull request and ports.
  - [ ] Choose Default → status and the agent summary show.
Compat: —
Source: D-01-062

### PROJ-087 · Claude finds each workspace's history on Windows
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: resumes Claude history for a workspace on Windows.
User sees: the history belonging to that workspace folder is found.
Rules: the folder key uses forward slashes and keeps the drive letter's case as the system reported
  it.
Acceptance:
  - [ ] On Windows, start a session in a workspace → it is listed for that workspace.
  - [ ] Open history for a workspace whose drive letter the system reports in lower case → its
        sessions are listed.
Compat: —
Source: D-01-087

### PROJ-019 · Choose a project icon or emoji by hand
Tier: P2 · Pushed: 10 · State at 0.15.0: live-unverified
User does: opens the project icon picker, searches, and picks an emoji or icon, or resets.
User sees: the choice replaces the automatic icon straight away and is still there after a restart.
Rules: only emoji, built-in icons or images are accepted, within a size limit, and reset brings back
  the automatic icon; an image that will not load shows a built-in icon instead and is tried again
  when its source changes; an icon name Kolux does not recognise shows a folder.
Acceptance:
  - [ ] Search for rocket, pick it, restart → the project shows the rocket.
  - [ ] Reset the icon → the automatic icon returns.
Compat: —
Source: D-01-019

### PROJ-024 · Names of deleted workspaces are not suggested again
Tier: P2 · Pushed: 10 · State at 0.15.0: live-unverified
User does: deletes a workspace that had a suggested name, then creates more.
User sees: that name never comes back as a suggestion, restarts included.
Rules: retired names are kept per project and compared ignoring case and spaces; only names from the
  suggestion list are retired, never names the user typed freely; the retired-name record stays
  bounded however many numbered rounds are used, and a damaged record means nothing counts as
  retired; with the flat folder layout, projects sharing the workspaces folder share their retired
  names; with the nested layout each project keeps its own.
Acceptance:
  - [ ] Delete otter, restart, create ten workspaces → otter is not suggested.
  - [ ] Damage the retired-name record → suggestions carry on and no name is treated as retired.
Compat: —
Source: D-01-024

### PROJ-036 · Linked issues can start with a per-project issue command
Tier: P2 · Pushed: 11 · State at 0.15.0: live-unverified
User does: creates a workspace linked to a GitHub issue in a project that has an issue command.
User sees: the issue command runs inside the new workspace with the issue filled in.
Rules: a local setting wins over the value shared in kolux.yaml when both exist.
Acceptance:
  - [ ] Set an issue command and create from issue #12 → the command runs with #12.
  - [ ] Give the project different local and shared issue commands → the local one runs.
Compat: —
Source: D-01-036

### PROJ-009 · Projects with the same folder name stay distinguishable
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: has two projects whose folders share a name.
User sees: a unique name shows just the folder name; names that clash add enough of the path to tell
  them apart; long labels are shortened and the full name appears on hover.
Rules: only clashing names get the extra path; a label counts as shortened only when its text really
  overflows.
Acceptance:
  - [ ] Add two projects both called app from different parent folders → each header shows a path
        fragment that separates them.
  - [ ] Add a project with a name no other project has → its header shows the folder name alone.
Compat: —
Source: D-01-009

### PROJ-018 · Projects pick up an icon from the repository
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: adds a project.
User sees: the project shows the app's own icon when one is found, otherwise the avatar of the owner
  on the hosting site, otherwise a folder symbol.
Rules: places are tried in this order: a small favicon inside the repository, icons from desktop app
  bundles, an image published on the web, the favicon of the homepage named in the package manifest,
  then icon links declared in the source; only files inside the repository are used, and files that
  are too large are passed over; for a fork, the upstream owner's avatar wins; a fork that was
  renamed uses its own owner's avatar instead.
Acceptance:
  - [ ] Add a repository with a small favicon image → that image becomes the project icon.
  - [ ] Add a repository with no icon of any kind → the hosting owner's avatar shows, or a folder
        symbol when there is none.
Compat: —
Source: D-01-018

### PROJ-029 · Hint when the local base branch is behind its remote
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: creates a workspace from a local base branch that is behind the remote.
User sees: a suggestion to bring the local base up to date, which can be dismissed for good; an
  opt-in setting updates it automatically on create.
Rules: automatic updating is off by default; the dismissal is remembered.
Acceptance:
  - [ ] Dismiss the hint and create again → no hint.
  - [ ] Turn the automatic setting on and create → the local base is brought up to date first.
Compat: —
Source: D-01-029

### PROJ-043 · A card for outside worktrees heads each project
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a project holding worktrees brought in from outside Kolux.
User sees: a compact card heading the project group that expands to list those worktrees, or that
  can be dismissed.
Rules: hidden while the project group is collapsed; still shown, under the header, when the project
  has no other rows.
Acceptance:
  - [ ] Dismiss the card → it stays dismissed.
  - [ ] Collapse the project group → the card is hidden.
Compat: —
Source: D-01-043

### PROJ-054 · Jump back to the current workspace or to the top
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: scrolls far down the sidebar, or flicks upward hard.
User sees: after a strong upward flick, a scroll-to-top button appears and fades out when idle;
  revealing the current workspace clears any filters that were hiding it.
Rules: the button does not show for short lists or close to the top; making a workspace active
  scrolls its row into view, waiting for the row to be drawn if it is not there yet.
Acceptance:
  - [ ] Filter out the current workspace, then reveal it → the filters clear and the row scrolls
        into view.
  - [ ] In a short list, flick upward → no scroll-to-top button appears.
Compat: —
Source: D-01-054

### PROJ-058 · Select several workspaces at once
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: Cmd-clicks (Mac) or Ctrl-clicks rows.
User sees: several rows are selected for dragging or deleting together; a plain click replaces the
  selection.
Rules: a toggle-click leaves the rest of the selection in place.
Acceptance:
  - [ ] Ctrl-click two rows, then delete → one confirmation covers both.
  - [ ] Plain-click a third row → only that row is selected.
Compat: —
Source: D-01-058

### PROJ-061 · Type :shortcodes: to insert emoji
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: types a colon followed by a word in rename, the details or the palette.
User sees: emoji suggestions; Enter takes one, Escape closes the list, and any text after it is
  kept.
Rules: flags can be found by country name or ISO country code; exact matches rank first and
  skin-tone variants are not offered; text being composed with an input method (IME) is not
  interrupted.
Acceptance:
  - [ ] Type :fire and press Enter → 🔥 is inserted.
  - [ ] Type :fire and press Escape → the list closes and the typed text stays.
Compat: —
Source: D-01-061

### PROJ-069 · Repositories are tidied quietly in the background
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: leaves Kolux idle.
User sees: nothing visible; Git maintenance happens only once a repository has gone quiet for a
  while.
Rules: maintenance waits for a complete quiet period and never runs while there is activity.
Acceptance:
  - [ ] Keep editing in a repository → no maintenance starts.
  - [ ] Leave a repository untouched past the quiet period → maintenance runs.
Compat: —
Source: D-01-069

### PROJ-075 · Delete the workspace under the pointer
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: hovers a row and presses the delete shortcut.
User sees: the most deeply nested row under the pointer starts its delete; a folder workspace is
  taken out of Kolux while its folder stays.
Rules: does nothing on main checkouts, on rows already being deleted, or while a text field has
  focus.
Acceptance:
  - [ ] Hover a folder workspace and press delete → it leaves the sidebar and the folder is still on
        disk.
  - [ ] Hover the main checkout and press delete → nothing happens.
Compat: —
Source: D-01-075

### PROJ-081 · Cleanup filters, search and sorting
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: filters the cleanup list by activity, size, status, agent, Git state, review, ticket,
  location or safety, searches it, and sorts by a column.
User sees: the list narrows and reorders; workspaces whose size is unknown, or that were never
  visited, drop to the bottom.
Rules: Git details are read only when a filter or sort needs them; before a row is expanded it shows
  plain facts (status, size, activity, Git state), never policy labels.
Acceptance:
  - [ ] Sort by size, largest first → rows without a size are last.
  - [ ] Filter by Git state → only matching rows stay.
  - [x] Sort by name → the direction button names the order for that key (A–Z); Tick all and Untick
        all change only the rows the filters show. (T-687; evidence/T-687.txt)
Compat: —
Source: D-01-081

### PROJ-088 · Friendly local addresses for each workspace's dev server
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: turns on workspace localhost labels.
User sees: each workspace's local web server can be reached under a readable local name.
Rules: off by default; only plain http targets are served, responses pass through unchanged, and
  targets on 0.0.0.0 are sent to loopback.
Acceptance:
  - [ ] Turn it on and run a dev server in workspace a → its label address serves that server.
  - [ ] Leave it off → no label addresses exist.
Compat: —
Source: D-01-088

### PROJ-090 · Experimental new workspace card style
Tier: H · Pushed: 7 · State at 0.15.0: hidden
User does: turns on the experimental card style.
User sees: a different design for workspace cards.
Rules: off by default, behind an experimental setting.
Acceptance:
  - [ ] With the setting left off → cards use the standard design.
  - [ ] Turn the setting on → cards switch to the alternative design.
Compat: —
Decision: H: default skip.
Source: D-01-090

### PROJ-091 · Agent rows inside sidebar workspace cards
Tier: H · Pushed: — · State at 0.15.0: retired 2026-09-20
User does: nothing; the sidebar now lists sessions instead.
User sees: earlier, each workspace card listed its agents as rows; the parts behind that remain in
  the old app but no longer feed the sidebar.
Rules: logged as a known gap: unused parts waiting to be removed.
Acceptance:
  - [ ] The sidebar shows sessions, not per-card agent rows.
  - [ ] No setting brings the per-card agent rows back.
Compat: —
Decision: H: default skip.
Source: D-01-091

### PROJ-092 · Sparse-checkout presets per project
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: saves sets of folders and creates workspaces with only those folders checked out.
User sees: smaller workspaces that hold only the preset folders.
Rules: presets were stored per project with duplicates removed.
Acceptance:
  - [ ] Creating a workspace offers no sparse preset.
  - [ ] A new workspace always holds the full checkout.
Compat: —
Decision: default cut: owner cut table 1b, per-repo sparse checkout. Revive via DECISIONS.md.
Source: D-01-092

### PROJ-093 · Shared or linked folders in workspaces
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: lists files or folders to link from the main checkout into every workspace.
User sees: new workspaces share those paths (a single install of dependencies, for example) through
  symbolic links.
Rules: the same list could also be set in kolux.yaml as shared folders.
Acceptance:
  - [ ] No per-repository symbolic-link setting exists.
  - [ ] A shared-folders entry in kolux.yaml is still honoured when a workspace is created (GIT-067;
        owner to confirm, see OD-14).
Compat: —
Decision: default cut: owner cut table 1b, worktree symlinks (the per-repository settings control
  only; the kolux.yaml shared-folders list stays under OD-14). Revive via DECISIONS.md.
Source: D-01-093

### PROJ-094 · Fork sync and fork push remotes
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: sets how a fork stays in step, or opens a pull request from a fork as a workspace.
User sees: the fork kept level with its upstream, and a remote for pushing to the fork that was
  added, then removed once no workspace used it.
Rules: clashing remote names got a number on the end.
Acceptance:
  - [ ] No fork sync setting exists.
  - [ ] Opening a fork's pull request adds no fork push remote (owner to confirm, see the decision).
Compat: —
Decision: default cut: owner cut table 1b, fork sync; fork push remotes go with it. Revive via
  DECISIONS.md.
Source: D-01-094

### PROJ-095 · Repo hooks: archive script and hook runs on create and remove
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: defines an archive script in kolux.yaml or passes the run-hooks flag.
User sees: a script runs before a workspace is removed, and the repository's hooks run around create
  and remove from the CLI.
Rules: the lock state was checked again after the archive script ran.
Acceptance:
  - [ ] No per-repository repo-hooks settings exist; the archive script comes from kolux.yaml only.
  - [ ] Removing a workspace still runs the kolux.yaml archive script after the trust dialog, and
        the CLI create and remove commands keep their run-hooks flag (STAT-055, CLI-018, CLI-020;
        owner to confirm, see OD-14).
Compat: —
Decision: default cut: owner cut table 1b, repo hooks (the per-repository settings control only;
  the kolux.yaml archive script and the run-hooks flag stay under OD-14). Revive via DECISIONS.md.
Source: D-01-095

### PROJ-096 · Project host setups (one project on several machines)
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: registers one project on several machines and chooses which one a workspace runs on.
User sees: a choice of host per project, plus setup commands for existing folders, clones and new
  projects.
Rules: the local machine was listed first.
Acceptance:
  - [ ] Projects offer no choice of host.
  - [ ] `kolux project` offers no setup subcommands.
Compat: The cut command words were kolux project setups, setup-existing-folder, setup-clone,
  setup-create, setup-update and setup-delete.
Decision: default cut: owner cut table 1b, host setups. Revive via DECISIONS.md.
Source: D-01-096

### PROJ-097 · Projects and workspaces on SSH hosts
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: adds or clones a project on a remote machine and browses its files.
User sees: remote projects with a remote file browser, nested scans run on the remote machine, and
  host controls on cards.
Rules: every add, scan, clone and remove route worked over SSH.
Acceptance:
  - [ ] Add Project offers no remote-machine choice.
  - [ ] Workspace cards carry no host controls.
Compat: —
Decision: default cut: area 18 remote and hosts dropped. Revive via DECISIONS.md.
Source: D-01-097

### PROJ-098 · Paired devices and web-client workspace views
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens Kolux from a paired device or from the web client.
User sees: the host's workspaces, with other devices' workspaces filtered out and Add Project
  disabled for hosts that are unavailable.
Rules: external worktrees appeared on paired clients without reconnecting.
Acceptance:
  - [ ] No pairing or web-client route to the workspace list exists.
  - [ ] Add Project has no disabled state tied to a host being unavailable.
Compat: —
Decision: default cut: area 18 pairing and web client dropped. Revive via DECISIONS.md.
Source: D-01-098

### PROJ-099 · WSL projects side by side with Windows projects
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: adds a project stored inside WSL.
User sees: it runs inside the WSL distribution, with a notice when work crosses between the two file
  systems.
Rules: base refs were looked up inside the chosen distribution.
Acceptance:
  - [ ] A WSL path is handled as an ordinary local path.
  - [ ] No distribution picker appears when adding a project.
Compat: —
Decision: default cut: area 18 WSL execution dropped; WSL paths are local again. Revive via
  DECISIONS.md.
Source: D-01-099

### PROJ-100 · Linear, GitLab and Jira links on workspaces
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: links a workspace to a Linear, GitLab or Jira item, or syncs board status to Linear.
User sees: provider links on cards, a prompt to set up a Linear agent skill, and Linear states
  following the board's lanes.
Rules: the palette read these providers' URLs as links to work items.
Acceptance:
  - [ ] Pasting a Linear, GitLab or Jira URL into the palette does not create a linked workspace.
  - [ ] Workspace details accept GitHub links only.
Compat: —
Decision: default cut: table 1b, only GitHub stays as a provider. Revive via DECISIONS.md.
Source: D-01-100

### PROJ-101 · Ephemeral VM environment recipes in kolux.yaml
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: declares environment recipes with a checkout mode in kolux.yaml.
User sees: a virtual environment per workspace, created, suspended and destroyed by the recipe.
Rules: an older spelling of the checkout mode was read as the newer one.
Acceptance:
  - [ ] Environment recipes in kolux.yaml are ignored and the rest of the file still applies.
  - [ ] Creating a workspace starts no virtual machine.
Compat: —
Decision: default cut: area 18 ephemeral VM recipes dropped. Revive via DECISIONS.md.
Source: D-01-101

## Dropped by default (tier D)

- PROJ-092 · Sparse-checkout presets per project — table 1b cuts per-repo sparse checkout.
- PROJ-093 · Shared or linked folders in workspaces — table 1b cuts worktree symlinks (the settings
  control only; the kolux.yaml shared-folders list stays, owner to confirm under OD-14).
- PROJ-094 · Fork sync and fork push remotes — table 1b cuts fork sync, and fork push remotes go
  with it (owner to confirm).
- PROJ-095 · Repo hooks: archive script and hook runs on create and remove — table 1b cuts repo
  hooks (the settings control only; the kolux.yaml archive script and the run-hooks flag stay,
  owner to confirm under OD-14).
- PROJ-096 · Project host setups (one project on several machines) — table 1b cuts host setups and
  their command words.
- PROJ-097 · Projects and workspaces on SSH hosts — area 18 (remote and hosts) is dropped; projects
  are local only.
- PROJ-098 · Paired devices and web-client workspace views — area 18 is dropped, pairing and the web
  client with it.
- PROJ-099 · WSL projects side by side with Windows projects — area 18 WSL execution is dropped; WSL
  paths are handled as local.
- PROJ-100 · Linear, GitLab and Jira links on workspaces — table 1b keeps GitHub as the only
  work-item provider.
- PROJ-101 · Ephemeral VM environment recipes in kolux.yaml — area 18 VM recipes are dropped;
  kolux.yaml entries for them are ignored.

## Hidden or retired (tier H)

- PROJ-090 · Experimental new workspace card style · experimental setting, off by default · H:
  default skip.
- PROJ-091 · Agent rows inside sidebar workspace cards · retired 2026-09-20 · H: default skip.
