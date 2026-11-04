# 11 · Git, source control & review

Everything Kolux does with Git and GitHub. The Source Control panel in the right sidebar shows what
a workspace has changed and lets the user stage, discard, commit, push, pull and publish, with one
main button that always proposes the next sensible step and AI help for commit messages, failed
pushes and conflicts. Changes can be read file by file or as one long scrolling view, marked up with
review notes that reach the agent in a single message, or handed to an agent for a full review
before shipping. Pull requests are opened from the panel with AI-written text, tracked per
workspace, and followed in a Checks panel that carries CI results, review comments and merge
actions. The Tasks page lists GitHub issues and pull requests, opens them in a dialog or on a full
pull request page, and starts a workspace from any of them; GitHub Projects open as an editable
table. GitHub is the only hosted service kept: GitLab, Bitbucket, Azure DevOps, Gitea, Jira and
Linear are dropped by default, one card each, along with the settings pages that served them.

Tier counts: P0 12 · P1 38 · P2 21 · H 0 · X 0 · D 15
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 07 Accounts, sign-in & keys · 12 Editor & files · 13 Browser pane & computer use · 15 Skills, plugins & starter kits · 16 Onboarding & guidance · 17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations · 20 The `kolux` CLI

## Cards

### GIT-002 · Stage and unstage by file, folder or section
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: clicks plus or minus on a file or folder row, uses a section's stage-all or unstage-all
  control, or selects several rows and acts from the bulk bar.
User sees: files move between staged and unstaged at once; the bulk bar counts how many of the
  selected rows the action will cover.
Rules: acting on a folder covers every file beneath it; paths are matched exactly, so a name holding
  wildcard characters never drags in other files; a huge selection reaches git in several batches so
  no command line grows too long; staging touches only this worktree's index, never another
  workspace's; a path that resolves outside the selected worktree is rejected.
  (Kolux RS, T-018-c: rows select on click, Ctrl adds or removes, Shift spans in list order, Esc
  clears; the bulk bar reads N selected · Stage k · Unstage m; a file with staged and unstaged
  parts is one selection counted on both sides. Folder rows come with the tree view, T-033.)
  (Kolux RS, T-676: the live Changes tab (EDIT-029) has Stage and Unstage on each file and Stage all
  and Unstage all above the commit box. Stage all takes the changed and new files, never the
  conflicted ones, which are resolved by hand; when the list was cut short (GIT-012) the rows shown
  are only some of the changes, so both buttons send the whole worktree instead, except that Stage
  all with conflicts present sends only the rows listed so no conflict is marked resolved.
  Unstaging a renamed file unstages both its old and its new path, so the delete is not left
  staged. Before the repository's first commit there is no HEAD to restore from, so unstaging
  removes the file from the index only and never touches the file on disk. One git action runs at a
  time; the buttons wait while it runs.)
Acceptance:
  - [x] Stage a folder holding three changed files → all three show as staged. (cards; evidence/cards-GIT-002.txt)
  - [x] Select 2,000 files and stage them → every one is staged and no error appears. (cards; evidence/cards-GIT-002.txt)
  - [x] Unstage a renamed file, and unstage a file in a repository with no commits yet → nothing stays half-staged and the file on disk is unchanged. (unit; evidence/T-676.txt)
Compat: —
Source: D-11-002

### GIT-004 · Commit from the panel with a message
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: types a message in the commit box and clicks Commit, or presses Ctrl+Enter (Cmd+Enter on
  macOS).
User sees: the staged work becomes a commit, the sections clear and the new commit shows in history.
Rules: the shortcut acts only while focus is inside Source Control and the main button is an enabled
  Commit; it does nothing with Alt or Shift held or while an input method is still composing; a
  half-written message is kept per worktree through closing the panel and switching workspaces; a
  failed commit raises a notice whose details can be expanded; a commit refused by a hook is
  labelled blocked; the failure notice carries a Fix with AI action that starts an agent primed with
  the error output. (Kolux RS, T-676: in the Changes tab a second click or shortcut while a commit
  or any other git action is running does nothing, so a double click makes one commit; the Commit
  button waits and the tab says what is running.)
Acceptance:
  - [x] Stage a file, type a message, press Ctrl+Enter → exactly one new commit and a clean panel. (cards; evidence/cards-GIT-004.txt)
  - [x] Type a draft, switch to another workspace and come back → the draft is still there. (cards live; evidence/cards-GIT-004.txt)
  - [x] Install a pre-commit hook that exits with 1 → the notice says blocked and shows what the
        hook printed. (cards live; evidence/cards-GIT-004.txt)
  - [x] Click Commit twice quickly in the Changes tab → one commit. (unit; evidence/T-676.txt)
Compat: —
Source: D-11-004

### GIT-006 · The main button always proposes the next step
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: watches the large button below the commit box while the branch moves through its states.
User sees: the button's label and action follow the state: stage all, commit, push, pull, sync,
  publish branch, force push, or create a pull request.
Rules: unstaged edits with nothing staged lead to stage all; staged work plus a message leads to
  commit, which unresolved conflicts block; a clean branch with an upstream leads to push, pull or
  sync by its ahead and behind counts; a branch never pushed leads to publish branch, which is
  refused while HEAD is detached; a branch that differs from its remote only by commits with
  identical patches, as after a rebase, leads to force push with lease; a clean, fully pushed branch
  leads to create a review, and the button waits while that check is still loading.
Acceptance:
  - [x] Take a new branch through edit, stage, commit, publish and create PR → the label matches
        each step. (cards; evidence/cards-GIT-006.txt)
  - [x] Rebase a pushed branch onto its base → force push with lease is offered in the commit area, not pull. (cards; evidence/cards-GIT-006.txt)
Compat: —
Source: D-11-006

### GIT-007 · Remote actions from the panel
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: uses the remote menu: push, pull, sync, fetch, fast-forward, force push, publish branch,
  or rebase from base.
User sees: the action runs against the branch's remote; labels carry counts, such as how many
  commits a push or pull would move, and a down-and-up pair for sync.
Rules: fetch refreshes remote refs and merges nothing; publish pushes to origin and makes it the
  upstream; force push always uses a lease; a disabled item gives its reason (no branch checked out,
  branch unpublished, nothing to pull, already current, PR already merged); a push target that
  differs from the branch's configured remote is rejected; a branch with no upstream is not checked
  against the remote over and over; git and GitHub calls only reach the remotes and hosts the user
  already set up.
  (Kolux RS, T-676: Kolux's own push, pull, sync and fetch, and the push made before a pull request,
  run with terminal and credential prompts off and no input, and are stopped, with the git processes
  they started, after 600 seconds; a stopped step comes back as a network failure that says it timed
  out and names likely causes. A rebase from base is a local step and has no limit. The live Changes
  tab (EDIT-029) offers Push, Pull and Sync with the counts and the reason a disabled one waits;
  the rest of this menu is not in the live layout.)
Acceptance:
  - [x] Make two local commits → the menu offers to push 2 commits; push → the counts fall to zero. (cards; evidence/cards-GIT-007.txt)
  - [x] Make a push hang in a pre-push hook → it is stopped at the limit and the result says it timed out. (unit; evidence/T-676.txt)
  - [x] Leave an unpublished branch open for ten minutes → git traces show no repeating remote
        checks. (cards live; evidence/cards-GIT-007.txt)
Compat: —
Source: D-11-007

### GIT-067 · Git side of creating, moving and removing worktrees
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: creates, moves or deletes a workspace.
User sees: a new worktree on its own branch, with chosen ignored files copied in and shared folders
  linked; removal refuses or warns when work would be lost.
Rules: a branch name already taken locally or on the configured remote is caught before creating;
  ignored files named in an include file at the repository root (such as local secrets files) are
  copied into new worktrees; ignored folders listed as shared in the project's kolux.yaml are shared
  rather than copied, and folders that are not ignored are skipped; removal checks for uncommitted
  changes and submodule work first, and deletes the branch only if no other worktree uses it; moving
  a worktree keeps Git's own records right; shared-folder entries that are absolute, point outside
  the repository or point into Git's own folder are dropped before anything on disk changes, and
  duplicates and trailing slashes are tidied; creations in one repository run one at a time, and a
  failure does not hold up the next one; a branch kept when its worktree was removed is deleted
  later only while it still points at the commit recorded at removal, and never while another
  worktree has it checked out; if checking whether a base branch exists fails, for example offline,
  the answer is unknown rather than missing, and malformed branch input is never run.
Acceptance:
  - [x] Name an ignored file in the include file and create a workspace → the file is present in the
        new worktree. (cards; evidence/cards-GIT-067.txt)
  - [x] Delete a workspace with uncommitted work → Kolux refuses or asks before anything is lost. (cards; evidence/cards-GIT-067.txt)
Compat: existing repositories may already carry the root include file (one path per line, a hash
  sign starts a comment) and a shared-folders list in kolux.yaml; both are user-facing and should
  keep working under their existing names (the exact spellings are in COMPAT.md 5.6; OD-14 in
  DECISIONS.md keeps the shared-folders list).
Source: D-11-067

### GIT-001 · Source Control lists a workspace's changes by section
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens Source Control in the right sidebar of a Git workspace, by its icon or with
  Mod+Shift+G.
User sees: each changed file of that worktree, sorted under staged, changed, untracked and committed
  on this branch; every section carries a count, and every file a status letter plus the lines it
  adds and removes.
Rules: only Git workspaces get the panel, plain folders do not; a header menu flips between a flat
  list (the default) and a folder tree and remembers the pick; a setting decides whether changes,
  staged or untracked comes first; a renamed file shows at its new path; binary files carry no line
  counts; names with spaces, quote marks or non-ASCII letters display and behave normally; the list
  updates by itself when git state moves outside Kolux, such as a commit or checkout typed in a
  terminal.
Acceptance:
  - [x] Edit a tracked file, stage a second one and add a new one → three sections with the right
        counts and line totals. (cards; evidence/cards-GIT-001.txt)
  - [x] Switch to tree view, close the panel and reopen it → it is still a tree. (cards live; evidence/cards-GIT-001.txt)
  - [x] Commit from a terminal → the panel clears with no manual refresh. (cards live; evidence/cards-GIT-001.txt)
Compat: the panel's toggle command defaults to Mod+Shift+G; existing keybinding files that rebind it
  must still load (its command id is an allowlist candidate).
Source: D-11-001

### GIT-016 · Review changes: an agent checks the branch before it ships
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: picks Review changes from the Source Control header menu and chooses an agent.
User sees: an agent session in that worktree, asked to review the work and told the base branch and
  the changed files.
Rules: each list of files in the prompt stops at 50 entries and then says how many more there are;
  if the branch has no changes to look at, a plain message says so and no agent launches; this
  shipped in 0.12.0.
Acceptance:
  - [x] Change 60 files and run it → the prompt names the base, lists 50 files and mentions 10 more. (cards; evidence/cards-GIT-016.txt)
  - [x] Run it on a clean branch → a plain message explains the branch has no changes to look at; no
        agent starts. (cards; evidence/cards-GIT-016.txt)
Compat: —
Source: D-11-016

### GIT-037 · Open a changed file as a diff
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: clicks a changed file in Source Control, then moves through its hunks with F7 and
  Shift+F7.
User sees: a diff tab comparing the file with its last committed or staged version; next change and
  previous change jump from hunk to hunk.
Rules: the staged and unstaged versions of one file open in separate tabs; a single click opens a
  preview tab that the next click reuses; the diff opens in whichever split the user chose; closing
  a diff while it loads never crashes the editor; reopening a file whose diff is already open
  refreshes that tab; a deleted image shows its last committed version.
Acceptance:
  - [x] Click an unstaged file → its diff tab opens; press F7 → the cursor moves to the next hunk. (cards live; evidence/cards-GIT-037.txt)
  - [x] Single-click one file, then another → the second replaces the first in the same preview tab. (cards live; evidence/cards-GIT-037.txt)
Compat: next change defaults to F7 and previous change to Shift+F7 (their command ids are allowlist
  candidates).
Source: D-11-037

### GIT-038 · Every change in one scrolling view
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens all changes, or the branch diff against its base, from Source Control.
User sees: every changed file's diff stacked in one tab, with an optional file tree, inline or
  side-by-side layout, whitespace and wrap toggles, and expand or collapse all.
Rules: inline layout, no wrap, whitespace hidden and tree hidden are the defaults, each a setting;
  the tree resizes within limits (by dragging, or from the keyboard with the arrow keys, Home and
  End, T-676), can be filtered, and marks files already viewed; the scroll
  position survives switching to another tab and back; files changing underneath do not freeze the
  view; the branch diff uses a snapshot of the base, so it holds still during a review.
Acceptance:
  - [x] Change 10 files and open all changes → 10 sections; scroll to the seventh, switch tabs and
        back → still at the seventh. (cards live; evidence/cards-GIT-038.txt)
  - [x] Turn on side-by-side and whitespace → the layout and markers change at once. (cards live; evidence/cards-GIT-038.txt; the Inline / Side by side switch and the keyboard resize, evidence/T-676.txt)
Compat: —
Source: D-11-038

### GIT-040 · Review notes on diff lines
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: hovers a diff line and clicks the plus, or selects lines and presses Mod+Shift+A, then
  types a note.
User sees: a note card beneath that line in both inline and side-by-side layouts, editable in place
  and removable with a trash button.
Rules: notes attach only to lines present in the diff; edits are trimmed and an empty edit is
  refused; saved notes keep their height reserved so the lines below do not shift; the note popover
  stays inside the window and closes on a click outside it; while the diff has keyboard focus the plus
  shows on the cursor line, not only under the mouse (T-746).
Acceptance:
  - [x] Add a note on line 12 → the card sits under line 12; switch to side-by-side → still under
        line 12. (cards; evidence/cards-GIT-040.txt)
  - [x] Tab into a diff and move the cursor → the plus shows on the cursor line. (unit; evidence/T-746.txt)
  - [x] Edit the note → the open card updates; click trash → it is gone. (cards live; evidence/cards-GIT-040.txt)
  - [ ] Click trash → a banner offers Undo for 8 s; Undo puts back the same note. (unit for the delete and
        restore only; the banner is not rendered in a test; evidence/T-723.txt)
Compat: Add Review Note defaults to Mod+Shift+A (its command id is an allowlist candidate).
Source: D-11-040

### GIT-041 · Gather review notes and send them to the agent
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens the notes section of Source Control and sends the notes to the workspace's agent,
  or copies them.
User sees: every note listed by file; sending pastes them into the agent as a single message and
  marks them sent.
Rules: a note can be opened at its line, copied or deleted, and notes can be cleared per file or all
  together; each note becomes a short block with file, line and text, with a blank line between
  notes; clearing delivered notes keeps any note edited while the send was still in flight; if
  saving a note fails, the change is reverted and the user is told; folder workspaces without Git
  keep notes as well; an empty notes section explains how to add one; sending notes has no default
  key and the user may bind one.
Acceptance:
  - [x] Add three notes across two files and send → the agent gets all three and they show as sent. (cards; evidence/cards-GIT-041.txt)
  - [x] Edit a note while a send is running, then clear delivered → the edited note remains. (cards; evidence/cards-GIT-041.txt)
Compat: the send-notes command has no default key (its command id is an allowlist candidate).
Source: D-11-041

### GIT-003 · Discard asks first and spells out what will be lost
Tier: P0 · Pushed: 5 · State at 0.15.0: live-unverified
User does: clicks discard on a file, a folder or a whole section.
User sees: a confirmation worded for the case: a new file is removed for good, a deleted file comes
  back from the last commit, a modified file loses its edits; a section discard states how many
  untracked files will go.
Rules: every version warns that there is no undo; the confirm button is named for what it does
  (Delete, Restore or Discard); a symbolic link is never followed out of the repository and its
  target is never removed; a long list of untracked files scrolls inside the dialog while its
  buttons stay in view.
  (Kolux RS, T-061: the panel lists files flat, so a folder is discarded through its selected rows
  or its section; a renamed file is put back under its old name and the new name removed; a
  tracked link is removed before git rewrites it, an untracked link or folder is removed as
  itself, so no target is written or removed; the confirm button is focused on open, Escape keeps
  everything.)
Acceptance:
  - [x] Discard an untracked file → the dialog says it is removed for good; confirm → the file is
        gone. (cards; evidence/cards-GIT-003.txt)
  - [x] Discard a section with 40 untracked files → the dialog gives the number 40 and its buttons
        can be reached without resizing. (cards live; evidence/cards-GIT-003.txt)
  - [x] Discard a change to a symbolic link aimed at a file beyond the repository → that file is
        left alone. (cards; evidence/cards-GIT-003.txt)
Compat: —
Source: D-11-003

### GIT-061 · Turn a plain folder into a Git repository
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: starts Git for a folder workspace, or converts the folder, checks the proposed first
  commit, and commits.
User sees: a preview of the files going into the first commit, with secret-looking files left out by
  default; afterwards the folder works as a Git workspace.
Rules: files that look like keys, tokens or environment secrets stay out unless the user adds them;
  if Git is started outside Kolux, the folder workspace becomes a Git workspace by itself; a
  relative path, or one that is not an existing folder, is refused.
Acceptance:
  - [ ] Initialise a folder holding an environment secrets file → the preview leaves it out; commit
        → one commit without it.
  - [ ] Start Git in the folder from a terminal → the workspace turns into a Git workspace with no
        action in Kolux.
Compat: —
Source: D-11-061

### GIT-027 · PR status stays current without flooding GitHub
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: keeps several workspaces with PRs open through a long session.
User sees: PR state and checks update by themselves, the visible workspace first; a refresh control
  updates everything at once.
Rules: active and visible workspaces refresh before background ones, and bursts are spaced out; a
  workspace whose data is stale refreshes when it gains focus; repeated validation errors back off,
  and the refresh queue has a fixed maximum length; requests for one repository under different
  names are merged; a forced refresh that fails leaves the last known PR data showing; every
  workspace linked to the same PR gets its update.
Acceptance:
  - [ ] Push a fix and wait → the check state changes in the panel without pressing refresh.
  - [ ] Open 20 workspaces → GitHub API use stays inside the budget shown in Settings.
Compat: —
Source: D-11-027

### GIT-028 · GitHub rate limits and outages are visible
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: uses GitHub features heavily, or while GitHub or the gh CLI is having trouble.
User sees: Settings shows the REST, search and GraphQL budget left; near the limit, calls wait
  instead of failing; Tasks shows a banner that GitHub is unavailable for now; a stuck gh call times
  out and recovers.
Rules: a circuit breaker stops new calls once the limit is hit and resumes after the reset time;
  loading check details has its own time limit, so the panel never spins forever; if gh has no
  signed-in account, a help message walks through signing in.
Acceptance:
  - [ ] Make gh hang while fetching issue details → the Tasks drawer recovers once the time limit
        passes.
  - [ ] Use up the search budget → the banner shows; after the reset, lists load again.
Compat: —
Source: D-11-028

### GIT-039 · Very large diffs are held back instead of freezing the app
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens a diff of a huge or generated file.
User sees: a notice that the diff is too large to show safely, with the limits; in the combined view
  that file waits until the user asks to load it.
Rules: limits apply to line count and to characters; diff data sent to the window has a size budget;
  diffs of files unchanged since the last read come from a cache; a diff read that a newer change
  overtook is never cached.
Acceptance:
  - [ ] Change a 100,000-line file and open all changes → the app stays responsive and that file
        shows a load button.
  - [ ] Edit a file while its diff is loading → the diff shown afterwards reflects the newer edit,
        not the overtaken read.
Compat: —
Source: D-11-039

### GIT-063 · Agents never stall on an unseen Git password prompt
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs an agent, or an unattended automation, that reaches a remote needing credentials.
User sees: Git fails quickly with an error rather than the agent waiting on a credential prompt no
  one can see.
Rules: this applies to recognised agent launches and marked automation runs only; ordinary shells
  still prompt. (Kolux RS, T-676: widened to the git steps Kolux runs itself, which are not shells:
  push, pull, sync, fetch and the push before a pull request never wait on a prompt either; see
  GIT-007.)
Acceptance:
  - [ ] Have an agent pull from a private remote with no saved credentials → the command errors
        within seconds; the same pull in a plain shell prompts.
  - [ ] Run an automation against the same remote → it also fails fast.
Compat: —
Source: D-11-063

### GIT-065 · Workspaces warn about unpushed commits
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: looks at a workspace in the sidebar.
User sees: a badge reading synced, ahead by some commits, unpublished with some commits, or cannot
  be checked.
Rules: an unpublished branch whose commit count cannot be read shows as unverifiable, never as
  synced.
Acceptance:
  - [ ] Commit twice without pushing → the badge shows two unpushed; push → it clears.
  - [ ] Make the count unreadable on an unpublished branch → the badge says it cannot be checked,
        not synced.
Compat: —
Source: D-11-065

### GIT-068 · Worktree changes and overlap from the CLI
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux worktree changes` or `kolux worktree overlap`, optionally for a chosen
  worktree and with JSON output.
User sees: the worktree's committed and uncommitted changes since its base, or the other worktrees
  that touch the same files and whether merging them would conflict.
Rules: the conflict forecast reads clean, conflicting with the paths involved, or unverifiable on
  Git older than 2.38; an unsupported Git is remembered and not probed again.
Acceptance:
  - [ ] Edit one file in two worktrees and run overlap → both worktrees show, with that file.
  - [ ] Run changes with JSON output → a machine-readable list of committed and uncommitted files.
Compat: `kolux worktree changes [--worktree <selector>] [--json]` and
  `kolux worktree overlap [--worktree <selector>] [--json]`.
Source: D-11-068

### GIT-005 · Commit together with push, sync or force push
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the dropdown next to the commit button.
User sees: commit and push, commit and sync, commit and force push, and commit then pull and push;
  each runs its steps in that order.
Rules: only combinations that fit the branch's current state are enabled, and a disabled one gives
  its reason; the force variant explains that it pushes with a lease, so remote commits it has not
  seen are never overwritten; when the commit step fails the push is skipped.
Acceptance:
  - [ ] On a branch with an upstream, pick commit and push → one new commit, visible on the remote.
  - [ ] Make the commit step fail → nothing is pushed.
Compat: —
Source: D-11-005

### GIT-009 · A failed push can be handed to an agent
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: pushes, and the push fails.
User sees: a notice that the push failed or was blocked, naming the kind of failure; for a hook or
  lint failure it offers to let an agent fix it.
Rules: hook and lint failures are told apart from sign-in, protected branch, non-fast-forward,
  network and submodule failures; the agent's prompt carries the last part of the hook output and a
  capped list of changed files, with terminal colour codes removed; fetch failures are sorted the
  same way so their notices are just as specific.
Acceptance:
  - [ ] Add a pre-push hook that fails and push → the notice offers the AI fix; accept → an agent
        opens with the hook output in its prompt.
  - [ ] Push to a protected branch → the notice says protected and offers no AI fix.
Compat: —
Source: D-11-009

### GIT-011 · Branch row compares the workspace with its base
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: reads the branch row at the top of Source Control, or uses Change Base Ref or Refresh
  branch compare in the header menu.
User sees: the base being compared against, commits ahead and behind, how many files differ from the
  base, and a chip with the total lines added and removed; a committed-on-branch section lists files
  touched by the branch's own commits.
Rules: the base is the repository's default branch unless a setting switches the comparison to the
  upstream; changing the base refreshes the counts, the committed section and the branch diff; on an
  enormous branch the line totals give up cleanly instead of stalling the panel; hovering the chip
  separates test lines from generated-file lines, and a file that is both counts as generated.
Acceptance:
  - [ ] Make three commits that touch five files → the row reads 3 ahead and 5 files changed.
  - [ ] Point the base at another branch → the counts and committed files change to match.
Compat: —
Source: D-11-011

### GIT-015 · Merge and rebase conflicts with abort and AI resolve
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs into conflicts while merging or rebasing in a workspace.
User sees: conflict cards naming each file and the kind of clash (changed on both sides, added on
  both sides, deleted on one side), whether it is resolved locally yet, plus buttons to abort the
  merge or rebase or to hand the conflicts to an agent.
Rules: committing is blocked while any conflict remains; conflicted files are kept out of the
  combined diff, with a note saying so; abort matches whichever operation is running; a very long
  conflict list is capped, but rows already on screen are never dropped.
Acceptance:
  - [ ] Make a conflicting merge → the cards list the file; abort → the repository is back where it
        was before the merge.
  - [ ] Choose resolve with AI → an agent starts in that worktree with the conflicted files in its
        prompt.
Compat: —
Source: D-11-015

### GIT-017 · AI writes the commit message from what is staged
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks the generate control next to the commit box.
User sees: a message written by an agent CLI on this computer fills the box; the control turns into
  a stop button while it works.
Rules: the control stays out of sight until there are changes it could describe; a generation
  belongs to the worktree that began it, survives switching workspace and the panel being rebuilt,
  and fills that worktree's box only; only agents installed here are offered, with Claude Code as
  the default; a large diff is trimmed to a budget split fairly across files and cut at line ends;
  code fences, an opening line that announces the message, and list bullets are stripped from the
  result; on failure the excerpt shown favours the agent's error stream and masks secrets; an agent
  that exits cleanly but prints nothing is reported as an empty result, with its error-stream
  excerpt.
Acceptance:
  - [ ] Stage a change and click generate → a short message appears in the box.
  - [ ] Start generating, switch workspace and return → the message lands in the original workspace
        only.
  - [ ] Click the control again mid-run → generation stops and the box is unchanged.
Compat: agents offered for writing: Claude Code, Codex, Amp, Kimi, Copilot, Pi, Cursor, Antigravity,
  plus a custom command.
Source: D-11-017

### GIT-018 · Choose who writes commit messages
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the AI author settings and picks an agent, a model and a thinking effort, or
  supplies a custom prompt or a custom command.
User sees: the next generations use that agent and model; the model list comes from the installed
  CLI.
Rules: on by default and can be switched off; a custom command receives the prompt wherever its
  placeholder appears, otherwise on standard input; quoted arguments in a custom command stay
  together as one argument, and on Windows backslashes are kept as typed; the effort levels on offer
  depend on the agent; until the user picks a model each agent uses a capable built-in default
  (Sonnet for Claude Code); custom instructions sit in their own size-capped part of the prompt, and
  blank ones add nothing.
Acceptance:
  - [ ] Pick Codex and a model, then generate → Codex runs with that model.
  - [ ] Enter a custom command that contains the placeholder → the prompt text is put in its place.
Compat: the placeholder is the word prompt inside curly braces; saved custom commands that use it
  must keep working.
Source: D-11-018

### GIT-020 · Branches are named after the work done in them
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: starts work in a fresh workspace whose branch has a placeholder name.
User sees: the branch is renamed to a short name that describes the work.
Rules: on by default and can be switched off; the generated name is cleaned into a short lowercase
  slug carrying the configured prefix; before renaming, Kolux looks for an upstream so tracking is
  not quietly broken; profiles that predate the feature had it turned on once, and an opt-out after
  that is respected.
Acceptance:
  - [ ] Give an agent a task in a new workspace → the branch becomes a slug describing the task.
  - [ ] Switch the feature off → a new workspace keeps its placeholder branch name.
Compat: —
Source: D-11-020

### GIT-021 · Create a pull request from Source Control
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the create-PR composer, sets the title, description, base branch and draft flag,
  optionally has the text generated, and creates the PR.
User sees: the PR opens on GitHub and is linked to the workspace; an unpushed branch is pushed
  first.
Rules: base and head must differ; if the branch already has a PR, that one is linked instead of a
  second being made; a failed create keeps everything typed and shows the error; uncommitted tracked
  changes block creation with a clear reason; a base that exists only locally gets a message saying
  what to do; GitHub Enterprise Server works as well. (Kolux RS, T-686: the title box takes focus
  when the form opens; Escape pressed inside the form closes it and keeps what was typed, while
  Cancel clears it, and an open Base list takes the first Escape; each folder keeps its own text, so
  switching folders neither drops it nor shows it in another folder; focus returns to the button
  that opened the form; a finished AI draft does not overwrite text typed or kept since it began.)
Acceptance:
  - [ ] On a pushed branch, fill in a title and create → the PR exists on GitHub and the panel shows
        its number.
  - [ ] Make the create fail → title and description stay in the composer next to the error.
  - [ ] Type a title, press Escape, open the form again, or switch to another folder and back → the
        text is still there; Cancel clears it. (unit; evidence/T-686.txt)
Compat: —
Source: D-11-021

### GIT-022 · One click takes unfinished work all the way to a pull request
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks create PR while the branch still has uncommitted or unpushed work.
User sees: a progress notice stepping through preparing the branch, writing a commit message,
  committing, publishing or pushing (force with lease when needed), writing the review text, and
  opening the review.
Rules: the flow keeps going while the user is busy in a different workspace and shows its progress
  on return; it stops with a specific message if the branch has to be synced first or changed while
  the text was being written; the notice keeps its shape with long step names. (Kolux RS, T-686: in
  the right panel's automatic-flow line, Dismiss hides any line that is not still running, and
  Retry on a line that stopped on a failure runs the automatic flow again, only if automatic pull
  requests are still switched on for that folder, otherwise it says why nothing ran; a running line
  has neither. A link that will not open shows the reason under the line.)
Acceptance:
  - [ ] Edit a file and click create PR → commit, push and PR all happen and the notice ends in
        success.
  - [ ] Start it, switch workspace, then come back → it is either finished or showing its current
        step.
  - [ ] A line that stopped on a failure offers Retry and Dismiss; a running line offers neither.
        (unit; evidence/T-686.txt)
Compat: —
Source: D-11-022

### GIT-023 · Create PR explains why it is unavailable
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: hovers the disabled create-review action.
User sees: a reason such as commit first, push first, sync first, move to a feature branch, base
  missing on the remote, fork head not supported, or host not supported.
Rules: commits ahead of base are counted again before creation is allowed; creation is refused if
  the head branch is no longer checked out; if looking up an existing review fails, creation is
  refused rather than risking a duplicate; when a push is what is missing, push is offered as the
  next step.
Acceptance:
  - [ ] On the default branch → create review is disabled with the move-to-a-feature-branch reason.
  - [ ] On a feature branch with unpushed commits → the reason asks for a push and push is offered.
Compat: —
Source: D-11-023

### GIT-024 · AI drafts the PR title and description
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks generate in the composer, or lets it run on its own when the composer opens.
User sees: a title and a plain-language description split into problem and solution, mentioning the
  linked issue and following the repository's PR template when it has one.
Rules: by default a PR is created as a draft, its text is generated on open, the review opens after
  creation, and the template is used, each adjustable; a linked GitHub issue's title and body go
  into the prompt, and if the issue cannot be fetched its saved title is still used; generation can
  be stopped and stays with its worktree, as commit generation does; a description the user cleared
  on purpose stays empty; a bare base name that matches several remotes, none of them preferred, is
  not guessed.
Acceptance:
  - [ ] Link an issue and open the composer → the description mentions the issue and closes it by
        number.
  - [ ] Add a PR template to the repository → the generated description keeps its headings.
Compat: —
Source: D-11-024

### GIT-025 · Each workspace knows its branch's pull request
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: works on a branch that has a PR, or links or unlinks a PR by hand.
User sees: the PR's number, state and link in Source Control and in Checks; another PR can be linked
  instead, or the link removed.
Rules: the lookup handles branches pushed from forks and branches that were renamed, and can also
  find the PR by its number as a last resort; closed or merged PRs on the default branch stay hidden
  unless linked on purpose; a hand-linked PR whose branch no longer matches is flagged, not quietly
  replaced; merged PRs remain visible on their own branch.
Acceptance:
  - [ ] Open a PR from a workspace branch → its number shows in the panel within one refresh.
  - [ ] Link another PR by its URL, then unlink it → the panel goes back to the branch's own PR.
Compat: —
Source: D-11-025

### GIT-026 · A PR link printed by an agent attaches to its workspace
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: lets an agent open a PR from the terminal, which prints the PR's URL.
User sees: the workspace takes that PR as its linked review with no manual step.
Rules: a URL split across chunks of output is still recognised once it is whole; the same link
  printed twice is handled once; hidden or parked terminals count too.
Acceptance:
  - [ ] Print a GitHub PR URL in a workspace terminal → Checks shows that PR.
  - [ ] Print the same URL twice → the workspace links it once.
Compat: —
Source: D-11-026

### GIT-029 · Checks panel shows CI results and hands failures to AI
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens Checks in the right sidebar of a workspace that has a PR.
User sees: checks grouped into failing, pending and passing; each opens into jobs, annotations and
  output, with copy log, open file at line, rerun, and fix with AI.
Rules: long lists show the first 100 checks or jobs and the first 20 annotations, with a note about
  the rest; fix with AI lets the user pick the agent and sends the failing output, trimmed to its
  final part; a blocked check that needs action counts as failing, never passing, and neutral checks
  are not counted as passed; folder workspaces get a separate PR checks panel. (Kolux RS, T-686: the
  button words are Rerun failed jobs, Retry (a read failed), Refresh (read again) and Fix with AI;
  Rerun waits while it is asking, reads the checks again afterwards, and shows a failure in a red
  note; a link that will not open says so in that note; the check card has a Refresh button, and a
  Retry beside a read error; its close button names the check for a screen reader; the PR row has
  the collapsed stack map, GIT-034.)
Acceptance:
  - [ ] Break a test and push → the failing job is listed; expand it → its log shows; fix with AI →
        an agent opens with the failure. (button words, Rerun and Refresh; evidence/T-686.txt)
  - [ ] A run with 150 jobs → 100 are listed with a note about the rest.
Compat: keybinding id sidebar.checks.toggle, unbound by default.
Source: D-11-029

### GIT-030 · Read and answer PR review comments in Kolux
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: reads PR comments in the Checks panel; adds, replies to, edits, deletes, resolves or
  reacts to them.
User sees: comments grouped by file and thread, or laid out as a timeline; every change shows up on
  GitHub.
Rules: deleting asks for confirmation; authors can be marked as bots so their comments sit apart,
  and that list is a setting; long threads show the first 100 comments with a note; blank comments
  cannot be sent, and text is trimmed first; times are compact, relative when recent, and an invalid
  time shows nothing. (Kolux RS, T-686: every comment box says "Enter sends. Shift+Enter adds a new
  line."; each comment or thread shows its own waiting state and error, so one card's action does
  not block or blame another, and the errors clear when the folder or pull request changes; Reply
  is disabled, with the reason as its tooltip and a hint, for a thread whose first comment GitHub
  gave no id.)
Acceptance:
  - [ ] Reply to a review thread and resolve it → GitHub shows the reply and the thread resolved.
  - [ ] Try to send a comment made only of spaces → nothing is sent.
  - [ ] Make one comment's save fail → the error sits under that comment and the others still work.
        (unit; evidence/T-686.txt)
Compat: —
Source: D-11-030

### GIT-031 · Send review comments to the agent
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: queues PR comments for the agent, or uses resolve comments with AI.
User sees: the queued comments reach the workspace's agent; afterwards the threads can be resolved
  with a reply.
Rules: the send button shows how many comments are queued; threads are marked resolved only once
  delivery has succeeded.
Acceptance:
  - [ ] Queue three comments and send → the agent terminal gets all three with file and line
        context.
  - [ ] Make delivery fail → the threads stay unresolved.
Compat: —
Source: D-11-031

### GIT-032 · PR merge conflicts are explained, with Resolve with AI
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens Checks for a PR that GitHub reports as conflicting.
User sees: a conflict section stating that the conflicts must be fixed before checks run and the PR
  can merge, listing the conflicting files, with a Resolve with AI action (T-686: renamed from
  "AI resolve"; a failed copy of the commands shows "Copy failed" on the button and a red note).
Rules: when GitHub reports conflicts that do not happen locally, the panel says so and offers
  commands to copy that make GitHub recompute whether the PR can merge.
Acceptance:
  - [ ] Open a PR that conflicts with its base → the files are listed; resolve with AI starts an
        agent. (button name; evidence/T-686.txt)
  - [ ] A PR that GitHub flags as conflicting but that merges cleanly here → the panel says so and
        offers the commands.
Compat: —
Source: D-11-032

### GIT-033 · Merge, auto-merge, merge queue and PR state actions
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: uses merge, merge when ready, auto-merge on or off, add to merge queue, mark ready for
  review, close or reopen.
User sees: a merge-state label (checking, checks pending or failed, blocked, behind, conflicts, in
  merge queue, changes requested, approval required, draft, closed, merged) and only the actions
  possible right now.
Rules: only merge methods the repository permits are offered; auto-merge appears only where the
  repository allows it and never on closed, draft, conflicting or unstable PRs; after a merge the
  user can delete the workspace.
Acceptance:
  - [ ] On a PR with pending checks, pick merge when ready → auto-merge turns on and the label says
        so.
  - [ ] On a repository that allows squash only → squash is the one method offered.
Compat: —
Source: D-11-033

### GIT-035 · History panel draws the commit graph
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the history section of Source Control.
User sees: recent commits on a lane graph with branch and tag labels, incoming and outgoing markers
  against the upstream, a tooltip with the full message, and the files of the selected commit.
Rules: lane colours stay stable, and the current branch, its remote and the base each have their own
  colour; a remote-tracking label is hidden when a local branch of the same name sits on the same
  commit; upstream commits fetched later do not show up inside an older workspace's history;
  multi-line conventional commit messages wrap in the tooltip without broken lines; an empty
  repository shows a no-commits state; the section can be resized and refreshed.
Acceptance:
  - [ ] Make two local commits ahead of upstream → both appear as outgoing at the top.
  - [ ] Hover a commit with a long message → the tooltip shows all of it, wrapped.
Compat: —
Source: D-11-035

### GIT-036 · History commit menu: copy, open or explain
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: right-clicks a commit in history.
User sees: copy the hash, copy the message, open the commit in the browser, and Explain changes,
  which starts an agent to explain that commit.
Rules: open in browser appears only when the built-in browser can open new tabs; explain sends its
  prompt once the agent is ready, and shows an error when no agent is available.
Acceptance:
  - [ ] Choose Explain changes → an agent session starts and gets a prompt about that commit.
  - [ ] Copy the hash → the clipboard holds the commit's hash.
Compat: —
Source: D-11-036

### GIT-042 · Review notes on Markdown documents
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: selects text in a Markdown file (rich editor, source editor or preview) and uses the
  add-note shortcut.
User sees: a note tied to the selection; the notes can be copied as one Markdown block to hand to an
  agent.
Rules: on by default, with a setting that turns the Markdown review tools off; with no selection the
  shortcut does nothing; copied notes are ordered by file, line and time, grouped per file, and
  quote the selected text.
Acceptance:
  - [ ] In preview, select a sentence and press the shortcut → the note popover opens; copy the
        notes → the clipboard holds the quoted sentence and the note.
  - [ ] Press the shortcut with nothing selected → nothing happens.
Compat: —
Source: D-11-042

### GIT-043 · Tasks page lists GitHub issues and pull requests
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens Tasks, picks repositories, and chooses a preset (all open, mine, assigned, needs
  review and others) or types a GitHub search query.
User sees: a paged list of matching issues or PRs with state, labels, assignees and a checks pill,
  and numbered page buttons at the foot.
Rules: whether issues or PRs show follows the preset and any is:issue or is:pr typed in the query;
  the repository picker has one row per GitHub project, folding local and duplicate checkouts
  together; repositories with no GitHub remote are left out, and ones still being checked stay
  visible; pages beyond GitHub's search window say they cannot be reached; scroll position and
  recent pages are restored on return; the pager stays on an empty page after the first, so the user can go back; the checks pill reads passing, failing, running or
  unresolved; merged and open PRs each have their own muted status colour; the repository choice
  becomes the default for next time; a source label names the GitHub host and the signed-in account,
  shows a count when several repositories are chosen, and warns about hosts that cannot be reached.
Acceptance:
  - [ ] Choose the assigned preset → only items assigned to the user; add is:pr → the list switches
        to PRs.
  - [ ] Go to page 3, open an item, come back → still on page 3 at the same scroll position.
  - [ ] Go to a page past the last result → it says nothing matches and the pager still lets the user go back. (unit tests: evidence/T-670.txt)
Compat: —
Source: D-11-043

### GIT-046 · Create a GitHub issue from Tasks
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks new issue, chooses the repository, enters a title, an optional Markdown
  description, labels and assignees, and creates it.
User sees: the issue on GitHub and at the top of the list.
Rules: the target starts as the first selected repository; an unfinished draft is kept; changing
  repository drops labels and assignees that belonged to the previous one; if the chosen repository
  goes away the draft falls back to the first selected one; a very long body that cannot be saved as
  a draft still creates the issue, and the draft is kept for recovery.
Acceptance:
  - [ ] Fill in a draft, close the dialog and reopen it → the fields come back.
  - [ ] Create an issue with a label → GitHub shows the issue with that label.
Compat: —
Source: D-11-046

### GIT-047 · Close, reopen and comment on issues
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: closes an issue as completed, not planned, or a duplicate of another number; reopens it;
  adds a comment.
User sees: the state changes on GitHub and in the list; the comment is posted.
Rules: a duplicate target is checked before anything is sent, and suggestions list other matching
  issues; validation failures read as plain messages.
Acceptance:
  - [ ] Close an issue as a duplicate of an existing number → GitHub shows it closed as a duplicate.
  - [ ] Give a duplicate number that does not exist → a readable message, and nothing is sent.
Compat: —
Source: D-11-047

### GIT-049 · Start or resume a workspace from an issue or PR
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks start workspace on an issue or PR in Tasks, or resume when one already exists.
User sees: a new worktree (on the PR's branch, for a PR) and an agent whose prompt already holds the
  item's URL; resume goes to the existing workspace.
Rules: an issue just created can be started at once with its URL filled in; a fork's PR fetches the
  fork's branch first; the workspace remembers the issue or PR it belongs to; item text given to the
  agent is labelled as outside data, cleaned of terminal control characters and limited in size; a
  note typed while creating the workspace goes above the item link in the first prompt; the issue
  field accepts a number, a number after a hash sign, or an issue URL, and refuses PR URLs, zero or
  negative numbers, and junk.
Acceptance:
  - [ ] Start from an issue → the prompt holds the issue URL; go back → the item offers resume.
  - [ ] Type a PR URL into the issue field → it is refused.
Compat: `kolux worktree create --issue <number>` and `kolux worktree set --issue <number>`.
Source: D-11-049

### GIT-050 · Issue and PR preview dialog
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks an item in Tasks.
User sees: a dialog with the description, a timeline (closed, reopened, assigned, mentioned and
  similar events), labels, assignees and actions, including opening a workspace.
Rules: body edits keep an unsaved draft for that item for as long as Kolux runs and put it back in
  the editor when the item is opened again (it is dropped once saved or put back); a load that
  fails says so with a Retry, never "Loading…" for ever; closing the dialog returns focus to what had
  it; the dialog does not redraw for list updates while it is closed; while the body is not being
  edited it shows GitHub's latest version.
Acceptance:
  - [ ] Open an issue and add a label in the dialog → the label shows in the dialog and in the list.
  - [ ] Change the issue body on GitHub while the dialog is open but not being edited → the dialog
        shows the new body.
  - [ ] Type in the description, close the dialog without saving, open the same item → the typed text is back in the editor. (unit tests: evidence/T-670.txt)
  - [ ] Open an item while GitHub cannot be read → the dialog says so and Retry reads it again. (unit tests: evidence/T-670.txt)
Compat: —
Source: D-11-050

### GIT-051 · Full pull request page
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a PR from Tasks.
User sees: Conversation, Checks and Files changed tabs; editable description, assignees, labels and
  reviewers; reactions; review threads with replies; close or reopen; rerun all checks or only
  failed ones; fix broken checks with AI; copy link; open GitHub's merge box; start or resume a
  workspace.
Rules: copy link briefly shows that it copied; merging from the page needs the repository added in
  Kolux, and says so otherwise; the Checks tab keeps its state between visits; a Back button with an
  arrow, and Escape, return to Tasks unless a text field, menu, dialog or edit is open (an open merge
  confirm closes first); a Refresh button reads the PR again; a failed checks or review-threads read
  leaves a note above the tabs instead of an empty list; "Yes, merge it" is the red danger button.
Acceptance:
  - [ ] Open a PR, go to Checks, rerun failed → GitHub reruns the failed jobs.
  - [ ] Click copy link → the clipboard holds the PR URL and the button briefly confirms it.
  - [ ] Press Escape on a PR page with a merge confirm open → the confirm closes; press it again → back at Tasks. (unit tests: evidence/T-670.txt)
Compat: —
Source: D-11-051

### GIT-052 · Review a PR's files and mark them viewed
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens Files changed on a PR and marks files as viewed.
User sees: every file diff in the PR, inline or side by side, with context that can be expanded;
  viewed marks sync with GitHub.
Rules: very large files are not loaded whole; review comments show the code around them, and that
  context can be expanded and stays expanded for that comment.
Acceptance:
  - [ ] Mark a file viewed → GitHub shows it viewed; unmark it → it is cleared there too.
  - [ ] Expand a review comment's context, scroll away and back → it is still expanded.
Compat: —
Source: D-11-052

### GIT-059 · Paste a GitHub URL to start work on it
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: pastes an issue or PR URL into the new-workspace input.
User sees: the input recognises the link and switches to starting work on exactly that item.
Rules: a pasted URL never picks an older cached item with a similar number; GitHub Enterprise URLs
  are recognised; a pasted URL or a number after a hash sign is treated as an item lookup, while an
  ordinary workspace name is not; oversized pasted text is refused.
Acceptance:
  - [ ] Paste an issue URL → the input shows that issue's title; submit → the workspace starts with
        the issue attached.
  - [ ] Type an ordinary workspace name → no item lookup happens.
Compat: —
Source: D-11-059

### GIT-060 · GitHub repositories are recognised from any remote form
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: adds a repository whose remote uses HTTPS, SSH, a host alias from the SSH config, or a
  GitHub Enterprise host.
User sees: PRs, checks and Tasks work for it, and it is grouped with other checkouts of the same
  project.
Rules: SSH host aliases resolve to the real host; a fork knows both its own owner and its parent's;
  Enterprise hosts use their own API address.
Acceptance:
  - [ ] Clone through an SSH alias host → the workspace still shows its PR.
  - [ ] Add two checkouts of the same GitHub project → they are grouped together.
Compat: —
Source: D-11-060

### GIT-066 · Git & worktrees settings page
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the Git settings page.
User sees: the branch prefix (git username, custom or none), the default compare base (repository
  default or upstream), the order of the Source Control groups, the GitHub API budget, and whether
  new workspaces refresh the base first.
Rules: the git-username prefix takes the configured git user name first, then the gh login, and
  refuses overly long names; refreshing the base fast-forwards only when that is safe and skips a
  base with uncommitted changes; with refresh off and the local base behind, Kolux suggests updating
  it unless the base's own worktree is dirty.
Acceptance:
  - [ ] Set a custom prefix of feat → the next workspace branch begins with feat and a slash.
  - [ ] Leave the local base behind origin and create a workspace with refresh on → it starts from
        the updated base.
Compat: —
Source: D-11-066

### GIT-012 · Huge change sets are capped, with an offer to ignore heavy folders
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens Source Control on a worktree with tens of thousands of changed files.
User sees: only a first batch of changes, a banner saying the list is cut short, and an offer to add
  known heavy folders (dependencies or build output) to the repository's ignore file.
Rules: the offer names only heavy folders that exist and are not ignored yet, and creates the ignore
  file when there is none; the panel keeps responding while the list is capped.
Acceptance:
  - [ ] Put 30,000 untracked files in a dependency folder → the banner appears; accept the offer →
        the folder is ignored and the list shrinks.
  - [ ] Reopen the panel once that folder is ignored → the folder is not offered again.
Compat: —
Source: D-11-012

### GIT-045 · Tasks explains empty lists, missing sources and sign-in trouble
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: opens Tasks with no repository chosen, a query with no results, a repository without a
  GitHub remote, or gh signed out.
User sees: a message fitted to each case: pick a source, nothing matches, no GitHub source found,
  the preferred issue source is no longer set up, or how to sign in to gh.
Rules: a failure in one repository shows on that repository and does not hide the others' results;
  the sign-in help works out whether gh is missing, signed out or lacks access.
Acceptance:
  - [ ] Sign gh out and open Tasks → the sign-in help names the problem.
  - [ ] Choose two repositories, one of which fails → the other one's items still list.
Compat: —
Source: D-11-045

### GIT-048 · Edits in Tasks appear at once and do not flip back
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: changes an item's state, assignees, reviewers or labels from the list or from the dialog.
User sees: the change shows straight away; items that stop matching the filter fade out; a failed
  change is rolled back with a message.
Rules: a late search response that still carries the old value does not undo a confirmed change; two
  quick edits to different people on one item both stick; a hard refresh takes GitHub's current
  state again; a change that went through but whose read-back then fails says so and is not put
  back.
Acceptance:
  - [ ] Close an issue while filtering for open ones → it leaves the list and does not return on the
        next refresh.
  - [ ] Add two assignees in quick succession → both remain.
  - [ ] A change goes through but the read-back fails → the item says so and keeps the change. (unit tests: evidence/T-670.txt)
Compat: —
Source: D-11-048

### GIT-070 · Git stays quick across many worktrees
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs many agent workspaces at the same time.
User sees: Source Control and the status badges stay quick; git work for the visible workspace does
  not wait behind background work.
Rules: the number of git processes at once is capped, with foreground work let in first; git
  commands have time limits; identical status reads already running are shared; old Git versions get
  fallbacks rather than errors; long Windows paths work. (Kolux RS, T-676: the git commands the
  Changes tab starts for staging, committing, discarding and sync run off the app's async runtime, on
  a blocking thread, so a slow one never freezes the app; network steps have the 600-second limit in
  GIT-007.)
Acceptance:
  - [ ] Open 16 workspaces with changes → the focused panel refreshes within a second of an edit.
  - [ ] A git command hangs → it is stopped at its time limit and the panel recovers. (unit, push only; evidence/T-676.txt)
Compat: —
Source: D-11-070

### GIT-008 · Pull guides the user when git has no pull policy
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: pulls a branch whose history has split from its remote while git has no pull strategy
  set.
User sees: a notice that the two histories have split, offering merge, rebase or fast-forward only,
  plus a command to copy that sets the policy permanently.
Rules: picking a policy runs the pull again with it; the copy control only places the git config
  command on the clipboard and changes nothing until the user runs it.
Acceptance:
  - [ ] Split local and remote history, clear the pull strategy in git config, pull → the notice
        appears; choose rebase → the pull finishes.
  - [ ] Click the copy control → the clipboard holds the command and the repository's git config is
        unchanged.
Compat: —
Source: D-11-008

### GIT-010 · Pushing to a fork is flagged
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: works on a branch that pushes to a fork rather than to origin.
User sees: a notice in the panel naming the fork the branch will push to.
Rules: a branch taken from a fork's pull request fetches from and pushes to that fork's remote;
  leftover fork branch refs are cleaned out, never reused.
Acceptance:
  - [ ] Start work from a PR opened from a fork → the notice names the fork; push → the commits land
        on the fork.
  - [ ] Start from the same fork PR a second time → a fresh branch ref is used, not the leftover
        one.
Compat: —
Source: D-11-010

### GIT-013 · Submodules show as single rows
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: works in a repository that has submodules.
User sees: each changed submodule as one row with its state; past a limit, a note says further
  submodule changes were left out.
Rules: submodule locations are remembered so repeated status reads stay quick; removing a worktree
  looks for unsaved work inside its submodules first.
Acceptance:
  - [ ] Move a submodule to another commit → one submodule row appears under changes.
  - [ ] Leave uncommitted work inside a submodule and remove the worktree → Kolux warns before
        removing it.
Compat: —
Source: D-11-013

### GIT-014 · Filter the changes and act on a file from its menu
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: types in the panel's filter box, or right-clicks a changed file.
User sees: the list narrows to matching paths; the menu copies the full or the relative path, opens
  the file in an outside app, or shows it in the file manager.
Rules: Escape empties the filter and closes the box; the list of apps to open with can be edited
  from the same menu.
Acceptance:
  - [ ] Type part of a file name → only matching rows stay; press Escape → the full list is back.
  - [ ] Right-click a file and copy its relative path → the clipboard holds the path from the
        repository root.
Compat: —
Source: D-11-014

### GIT-019 · Source Control AI actions tuned per action and per repository
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: edits the AI recipes for the commit, PR, branch-name and fix actions (agent, extra CLI
  arguments, or a command template) and sets per-repository overrides.
User sees: each recipe offers variable chips to insert; a repository can follow the global choice,
  force AI actions on, or force them off.
Rules: one switch hides every Source Control AI action; the linked-issue variable is available only
  in the commit and PR recipes; configurations from before recipes existed are turned into recipes
  on first launch; an invalid recipe cannot be saved and the reason is shown.
Acceptance:
  - [ ] Turn the switch off → the generate and fix with AI controls vanish from the panel.
  - [ ] Force one repository off → it shows no AI actions while others still do.
Compat: —
Source: D-11-019

### GIT-034 · Stacked pull requests
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: works on a branch built on top of another PR's branch.
User sees: a collapsible stack map of the PRs with each one's state; actions to open the next PR in
  the stack, and to merge or queue everything up to a chosen PR after confirming.
Rules: creating a stacked PR makes the current PR first and then records the stack, and a retry
  never duplicates anything; parent links that do not form one chain create nothing; merging up to a
  PR is refused when a lower one cannot merge. (Kolux RS, T-686: the map sits under the PR row in
  the Checks tab, collapsed, and reads GitHub only once opened; it is per folder and pull request,
  so an answer for another one is dropped; a link that will not open shows the reason in its note.)
Acceptance:
  - [ ] Build two stacked branches and create their PRs → the map shows both; merge through the top
        one → both merge in order. (the map's place in the Checks tab; evidence/T-686.txt)
  - [ ] Make the lower PR unmergeable → merging through the top one is refused.
Compat: —
Source: D-11-034

### GIT-044 · Opening Tasks and its default view
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens Tasks from the title-bar button, the View menu or a bound key, and hides the button
  if it is not wanted.
User sees: Tasks opens on its default preset.
Rules: the button shows by default and a checkbox under View, Appearance hides it; the open-Tasks
  command ships with no key and the user can bind one; the default preset is all open items, and it
  is a setting.
Acceptance:
  - [ ] Untick Show Tasks Button → the button is gone; bind a key to view.tasks → that key opens
        Tasks.
  - [ ] Change the default preset → Tasks next opens on that preset.
Compat: keybinding id view.tasks, unbound by default.
Source: D-11-044

### GIT-053 · Mentions, reviewers and avatars
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: types @ in a comment, or adds reviewers and assignees.
User sees: a filtered list of people with avatars; reviewer suggestions include people who recently
  edited these files; each reviewer shows their review state.
Rules: up to 15 reviewers can be requested; existing requests are kept, and people on different
  GitHub hosts are kept apart; avatars fall back cleanly on GitHub Enterprise.
Acceptance:
  - [ ] Type @ and two letters → matching people appear; pick one → the mention is inserted.
  - [ ] Try to request a sixteenth reviewer → the request is refused.
Compat: —
Source: D-11-053

### GIT-054 · Filter PR lists
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the PR filter pickers in Tasks.
User sees: filters for state, author, assignee, label, review requested and reviewed by, applied as
  a GitHub query.
Rules: picking a filter rewrites the search query; clearing one removes only its own part.
Acceptance:
  - [ ] Choose review requested by me → only PRs waiting on the user's review are listed.
  - [ ] Clear the label filter → only the label part leaves the query.
Compat: —
Source: D-11-054

### GIT-055 · Forks: issues from upstream or from the fork
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: works in a fork and chooses where its issues come from.
User sees: issues from the chosen repository; a marker when issues and PRs come from different
  repositories.
Rules: the choice is saved per repository; if the chosen source disappears, Tasks warns and falls
  back.
Acceptance:
  - [ ] In a fork, choose upstream → the parent repository's issues are listed.
  - [ ] Remove the chosen source → Tasks warns and uses the fallback.
Compat: —
Source: D-11-055

### GIT-056 · GitHub Projects as an editable table
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: picks a GitHub Project (pinned, recent, by browsing, or by pasting a URL or an owner and
  number) and opens one of its views.
User sees: a table of project items whose columns sort and group, with editable cells (labels,
  assignees, numbers, text, issue type, iteration).
Rules: board and roadmap views are marked unsupported, with a suggestion to switch to a table view;
  rows can be limited to repositories open in Kolux or to chosen ones, and a repository not in Kolux
  offers to add it; items the user cannot see show as restricted; pinned and recent projects and
  each project's last view are remembered; the view can be opened on GitHub; "Chosen repositories"
  starts with the project's repositories that are open in Kolux ticked, else all of the project's
  repositories, so the table is never empty before the user picks; a failed read shows the error
  with a Retry.
Acceptance:
  - [ ] Paste a project URL → its table loads; edit a status cell → GitHub shows the new value.
  - [ ] Pick a board view → it is marked unsupported, with the table suggestion.
  - [ ] Open a project with none of its repositories open in Kolux → all its repositories start ticked. (unit tests: evidence/T-670.txt)
Compat: —
Source: D-11-056

### GIT-057 · GitHub Projects roadmap timeline
Tier: P2 · Pushed: — · State at 0.15.0: half-done
User does: opens a project view laid out as a roadmap.
User sees: items placed on a date timeline by their start and end fields.
Rules: the project picker still calls roadmap views unsupported, so whether a user can reach this
  timeline at all is an open question.
Acceptance:
  - [ ] Open a roadmap view → either the items sit on the timeline at their dates or the unsupported
        notice shows; the owner picks which.
  - [ ] Whichever is picked, the picker and the view agree about roadmap views.
Compat: —
Source: D-11-057

### GIT-058 · Paste a GitHub URL into the quick switcher
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: pastes an issue or PR URL into the Cmd+J switcher, or uses a digit chord.
User sees: the item, or the workspace attached to it, opens directly.
Rules: digit chords pick the numbered entry shown in the switcher.
Acceptance:
  - [ ] Paste a PR URL into the switcher → that PR opens.
  - [ ] Paste the URL of an item that already has a workspace → that workspace opens.
Compat: —
Source: D-11-058

### GIT-062 · A failed clone gives one line of reason
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: clones a repository and the clone fails.
User sees: one readable reason, such as the destination already existing, instead of raw progress
  output.
Rules: the last fatal line wins over any trailing fragments.
Acceptance:
  - [ ] Clone into a folder that exists and is not empty → the message says the destination exists.
  - [ ] A clone that fails part-way → only the reason shows, with no progress lines.
Compat: —
Source: D-11-062

### GIT-064 · Workspace label shows the branch or a detached commit
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: looks at a workspace's branch label.
User sees: the branch name, or a detached label with the short commit when no branch is checked out.
Rules: when neither is known, no label shows.
Acceptance:
  - [ ] Check out a commit by its hash → the label shows detached with that commit.
  - [ ] Switch back to a branch → the label shows the branch name.
Compat: —
Source: D-11-064

### GIT-069 · Open changed files from the CLI
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: runs `kolux file open-changed` with a mode.
User sees: the changed files open in the editor, as diffs, or both.
Rules: edit mode opens the files, diff mode opens diffs, and both does each.
Acceptance:
  - [ ] Change two files and run it in diff mode → two diff tabs open.
  - [ ] Run it in edit mode → the two files open as ordinary editor tabs.
Compat: `kolux file open-changed --mode edit|diff|both`.
Source: D-11-069

### GIT-071 · Invitation to star the project on GitHub
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: sees the star prompt on the landing screen or in the support part of Settings, and clicks
  it.
User sees: Kolux stars the repository through gh and stops asking once it is starred.
Rules: Kolux first checks whether the user already starred it; an unknown answer does not count as
  starred.
Acceptance:
  - [ ] Click star with gh signed in → the repository is starred and the prompt hides.
  - [ ] When the starred check cannot be answered → the prompt still shows.
Compat: —
Source: D-11-071

### GIT-072 · GitLab merge requests, pipelines and issues
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: works in a GitLab repository.
User sees: merge requests, pipeline checks with job logs, GitLab issues in Tasks, a GitLab item
  dialog and a separate GitLab API budget.
Rules: merge requests were created, merged and commented on from Source Control and Checks.
Acceptance:
  - [ ] A GitLab repository gets plain Git features only; no merge request, pipeline or GitLab issue
        view appears.
  - [ ] Tasks offers no GitLab source.
Compat: —
Decision: default cut: the owner kept GitHub as the only hosted provider (table 1b). Revive via
  DECISIONS.md.
Source: D-11-072

### GIT-073 · Bitbucket pull requests
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: works in a Bitbucket repository.
User sees: Bitbucket PRs and their status linked to workspaces, using saved Bitbucket credentials.
Rules: those credentials lived in a store of their own.
Acceptance:
  - [ ] A Bitbucket repository shows no PR link or status.
  - [ ] No Bitbucket credential entry exists anywhere in Settings.
Compat: —
Decision: default cut: the owner kept GitHub as the only hosted provider (table 1b). Revive via
  DECISIONS.md.
Source: D-11-073

### GIT-074 · Azure DevOps pull requests
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: works in an Azure DevOps repository.
User sees: Azure DevOps PRs linked to workspaces, on-premises servers included.
Rules: older servers were retried with a preview version of the service's API.
Acceptance:
  - [ ] An Azure DevOps repository shows no PR link or status.
  - [ ] No Azure DevOps sign-in is offered.
Compat: —
Decision: default cut: the owner kept GitHub as the only hosted provider (table 1b). Revive via
  DECISIONS.md.
Source: D-11-074

### GIT-075 · Gitea pull requests
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: works in a Gitea repository.
User sees: Gitea PRs linked to workspaces.
Rules: self-hosted Gitea addresses were recognised from the remote.
Acceptance:
  - [ ] A Gitea repository gets plain Git features only.
  - [ ] No Gitea PR is ever detected or linked.
Compat: —
Decision: default cut: the owner kept GitHub as the only hosted provider (table 1b). Revive via
  DECISIONS.md.
Source: D-11-075

### GIT-076 · Jira issues as a task source
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: connects Jira and browses or creates issues in Tasks.
User sees: Jira issues listed, filtered and created with Jira's required fields, and workspaces
  started from them.
Rules: the create form adapted to each project's required fields.
Acceptance:
  - [ ] Tasks offers no Jira source.
  - [ ] No Jira connect option exists in Settings.
Compat: —
Decision: default cut: Tasks becomes GitHub-only (table 1b). Revive via DECISIONS.md.
Source: D-11-076

### GIT-077 · Linear issues as a task source
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: connects Linear, browses issues in Tasks, and pastes a Linear URL to start work.
User sees: Linear issues with team filters and labelled filter chips, a remembered issue view, and
  workspaces started from a Linear URL.
Rules: the default team choice and the Linear settings page leave with it.
Acceptance:
  - [ ] Pasting a Linear URL into the new-workspace input starts no item lookup.
  - [ ] Settings has no Linear page.
Compat: —
Decision: default cut: Tasks becomes GitHub-only and the Linear settings section is cut (table 1b).
  Revive via DECISIONS.md.
Source: D-11-077

### GIT-078 · The kolux linear command group
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: runs `kolux linear` subcommands, including its bridge for MCP clients.
User sees: Linear issues read and changed from a terminal.
Rules: the group leaves with the Linear task source.
Acceptance:
  - [ ] `kolux --help` lists no linear group.
  - [ ] Running `kolux linear` reports an unknown command.
Compat: `kolux linear` is removed; scripts that call it will fail.
Decision: default cut: the Linear integration is cut (table 1b), and area 20 lists the group as cut.
  Revive via DECISIONS.md.
Source: D-11-078

### GIT-079 · Integrations settings page
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens the Integrations page in Settings.
User sees: one place to connect GitHub, GitLab, Linear and other source hosts.
Rules: GitHub sign-in moves to a page that stays (Accounts & keys, or Git & worktrees).
Acceptance:
  - [ ] Settings has no Integrations page.
  - [ ] GitHub sign-in can be reached from a page that stays.
Compat: —
Decision: default cut: the integrations section is cut (table 1b). Revive via DECISIONS.md.
Source: D-11-079

### GIT-080 · Task sources setting and switching providers in Tasks
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: chooses the default task source and which providers appear in Tasks, then switches
  between them.
User sees: a source switcher on Tasks across GitHub, GitLab, Jira and Linear.
Rules: Tasks keeps GitHub only, so no switcher is needed.
Acceptance:
  - [ ] Tasks shows no source switcher.
  - [ ] Settings has no task sources section.
Compat: —
Decision: default cut: the tasks section is cut and the Tasks page becomes GitHub-only (table 1b).
  Revive via DECISIONS.md.
Source: D-11-080

### GIT-081 · macOS developer permissions settings page
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens the developer permissions section on macOS.
User sees: the state of the macOS privacy permissions that developer tools rely on, with shortcuts
  to grant them.
Rules: table 1b lists it together with the integrations cut; it is not a Git feature and may belong
  to another area.
Acceptance:
  - [ ] Settings on macOS has no developer permissions section.
  - [ ] Nothing else in the app sends the user to that section.
Compat: —
Decision: default cut: the developer permissions section is cut (table 1b). Revive via DECISIONS.md.
Source: D-11-081

### GIT-082 · Sync a fork with its upstream
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: brings a fork's branch up to date with the parent repository.
User sees: the fork's branch updated from upstream.
Rules: it was a per-repository setting.
Acceptance:
  - [ ] No sync-fork action or per-repository setting exists.
  - [ ] Pushing to a fork (GIT-010) still works.
Compat: —
Decision: default cut: per-repository fork sync is cut (table 1b). Revive via DECISIONS.md.
Source: D-11-082

### GIT-083 · Sparse-checkout workspaces
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: creates a workspace that checks out only chosen folders of a large repository.
User sees: a worktree that holds only those folders.
Rules: the sparse state was cached per worktree.
Acceptance:
  - [ ] Creating a workspace offers no folder subset.
  - [ ] Every new worktree is a full checkout.
Compat: —
Decision: default cut: per-repository sparse checkout is cut (table 1b). Revive via DECISIONS.md.
Source: D-11-083

### GIT-084 · Folders shared across worktrees through symbolic links
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: sets up a repository so its worktrees share folders through symbolic links.
User sees: linked folders in each worktree, kept out of the change list and out of the PR creation
  checks.
Rules: it was a per-repository setting.
Acceptance:
  - [ ] The per-repository page offers no symbolic-link setting.
  - [ ] New worktrees get no linked folders from such a setting.
Compat: —
Decision: default cut: per-repository symbolic links are cut (table 1b). Revive via DECISIONS.md.
Source: D-11-084

### GIT-085 · Git, GitHub and AI text on remote SSH hosts
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: works in a repository on a remote SSH host.
User sees: Source Control, PR creation and commit-message writing running on that host.
Rules: this is a leftover of area 18.
Acceptance:
  - [ ] No workspace lives on a remote host.
  - [ ] All git, GitHub and AI text work runs on this computer.
Compat: —
Decision: default cut: SSH hosts and remote execution were dropped with area 18. Revive via
  DECISIONS.md.
Source: D-11-085

### GIT-086 · Git for repositories inside WSL runs inside the distribution
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens, from Windows, a repository stored in a WSL distribution.
User sees: git and gh run inside that distribution, falling back to the Windows gh.
Rules: running commands inside WSL went with area 18; path handling itself became local again on
  2026-10-06 (area 12).
Acceptance:
  - [ ] No git or gh command is run inside a WSL distribution.
  - [ ] The owner's answer on git for WSL-stored repositories is recorded in DECISIONS.md.
Compat: —
Decision: default cut: execution inside WSL was dropped with area 18; the owner should confirm
  whether git for WSL-stored repositories stays now that their paths are local again. Revive via
  DECISIONS.md.
Source: D-11-086

## Dropped by default (tier D)

- GIT-072 · GitLab merge requests, pipelines and issues — table 1b keeps GitHub only.
- GIT-073 · Bitbucket pull requests — table 1b keeps GitHub only.
- GIT-074 · Azure DevOps pull requests — table 1b keeps GitHub only.
- GIT-075 · Gitea pull requests — table 1b keeps GitHub only.
- GIT-076 · Jira issues as a task source — Tasks becomes GitHub-only.
- GIT-077 · Linear issues as a task source — Tasks becomes GitHub-only; the Linear settings section
  is cut.
- GIT-078 · The kolux linear command group — goes with the Linear integration; area 20 lists the
  group as cut.
- GIT-079 · Integrations settings page — the integrations settings section is cut; GitHub sign-in
  moves to a kept page.
- GIT-080 · Task sources setting and switching providers in Tasks — the tasks settings section is
  cut; Tasks is GitHub-only.
- GIT-081 · macOS developer permissions settings page — the developer permissions settings section
  is cut.
- GIT-082 · Sync a fork with its upstream — per-repository fork sync is cut.
- GIT-083 · Sparse-checkout workspaces — per-repository sparse checkout is cut.
- GIT-084 · Folders shared across worktrees through symbolic links — per-repository symbolic links
  are cut.
- GIT-085 · Git, GitHub and AI text on remote SSH hosts — SSH hosts and remote execution went with
  area 18.
- GIT-086 · Git for repositories inside WSL runs inside the distribution — execution inside WSL went
  with area 18; owner to confirm.

## Hidden or retired (tier H)

None: no card in this area is tier H.
