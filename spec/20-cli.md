# 20 · The `kolux` CLI

The `kolux` command is how a person, a script or a coding agent drives Kolux from a terminal. This
area covers the shape of the command line itself (help at every level, the version flag, how flags
and values are typed, typo suggestions, JSON output, exit codes, the two Windows entry points and
how kolux becomes available inside and outside Kolux terminals), the selectors that name repos,
worktrees and terminals, and every command group kept at 0.15.0: open and status, accounts, repos,
projects, worktrees, files, terminals, automations, the orchestration commands that coordinators and
workers use to talk to each other, agent hooks, diagnostics, the machine-readable command map, the
bundled skill guides and the browser commands. Most commands talk to the running app; a few answer
on their own. Remote targeting, headless serving, host setups, WSL, VM recipes, the emulator,
desktop control and Linear are dropped by default and are listed at the end so they can be revived
on purpose.

Tier counts: P0 11 · P1 35 · P2 1 · H 1 · X 0 · D 8
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 06 Usage & limits · 07 Accounts, sign-in & keys · 08 Orchestration · 09 Automations · 10 Plan review & protected actions · 11 Git, source control & review · 12 Editor & files · 13 Browser pane & computer use · 15 Skills, plugins & starter kits · 17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations · 21 Retired, hidden, removed & dev-only

## Cards

### CLI-018 · kolux worktree create, with an optional agent started inside
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: runs `kolux worktree create` with a name and, if wanted, a repo, a base branch, an agent
  with a first prompt, a GitHub issue number, a comment and a choice about setup scripts.
User sees: a new isolated checkout shows up in Kolux; when an agent was named, the worktree's first
  terminal starts that agent and gives it the prompt. The worktree is made in the background unless
  `--activate` asks for it to be shown.
Rules: when `--repo` is left out, the repo comes from the worktree the command was run inside;
  `--agent` must name an agent Kolux knows; a prompt with no agent goes to the default agent
  (DT-CLI-018); an empty agent, prompt or setup value is refused; `--setup` takes run, skip or
  inherit to decide whether the repo's
  setup scripts run; setup flags that contradict each other are refused; `--run-hooks` opts in to
  both setup and activation scripts; the starting branch is the repo's default base unless
  `--base-branch` says otherwise; lineage: the parent is the worktree the command was called from,
  unless `--parent-worktree` names another or `--no-parent` asks for none; a parent flag with no
  value, the retired parent-workspace flag, and parent flags that disagree are all refused before
  any selector is looked up; `--no-parent` only changes the family tree Kolux shows, never the
  branch the checkout starts from; the calling terminal is recorded, and every worktree made through
  the CLI is marked as made by the CLI, even when the call came from a shell outside Kolux;
  `--issue` attaches a GitHub issue number; when the call comes from a terminal that belongs to a
  plain folder workspace, that folder is recorded as the new worktree's parent.
Acceptance:
  - [x] Inside worktree A, `kolux worktree create --name b --agent claude --prompt hi` → b exists
        with A as its parent, Claude starts in b's first terminal with the prompt, and focus stays
        where it was. (cards live; evidence/cards-CLI-018.txt)
  - [x] The same command with `--activate` → b is brought into view. (cards live; evidence/cards-CLI-018.txt)
  - [x] `kolux worktree create --name b --prompt hi` → accepted, not refused: b is made and the
        default agent is picked to receive the prompt (DT-CLI-018). (cards; evidence/cards-CLI-018.txt)
Compat: worktree create with `--repo`, `--name`, `--agent`, `--prompt`, `--base-branch`, `--issue`,
  `--comment`, `--setup`, `--parent-worktree`, `--no-parent`, `--run-hooks` and `--activate`.
Source: D-20-018

### CLI-012 · kolux status tells whether the app is up
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs `kolux status`, often from a script.
User sees: one of four answers: running and ready; not running; stale, meaning the app's startup
  files were left behind but nothing answers; or answering but still loading its workspace graph.
Rules: the four states are running, not running, stale and graph not ready; the command works, and
  answers cleanly, while the app is closed; with `--json` the same state comes back in
  machine-readable form.
Acceptance:
  - [x] App closed → reports not running. (cards; evidence/cards-CLI-012.txt)
  - [x] Kill the app hard so its startup files stay behind → reports stale. (cards; evidence/cards-CLI-012.txt)
  - [x] App up → reports running. (cards; evidence/cards-CLI-012.txt)
Compat: the command word status; scripts read the state from its JSON output, so the four state
  names stay stable.
Source: D-20-012

### CLI-007 · kolux works in every Kolux terminal with no setup
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: types kolux, or an agent does, in any terminal pane that Kolux opened.
User sees: the command reaches the CLI that ships with the running copy of Kolux, even when nobody
  ever registered it for the whole system.
Rules: Kolux puts its own bundled CLI folder at the front of the program search path of every
  terminal it starts, so the CLI always matches the app's version; on Linux a small extra launcher
  folder supplies the plain word kolux inside Kolux terminals; agents in Kolux terminals also
  receive two environment values, the terminal's handle and its pane key, so orchestration commands
  can tell who is calling.
Acceptance:
  - [x] On a machine where kolux was never registered system-wide, open a new pane → `kolux status`
        works. (cards live; evidence/cards-CLI-007.txt)
  - [ ] With an older kolux registered system-wide, `kolux --version` inside a Kolux pane prints the
        app's own version.
Compat: agents and the owner's skills read the terminal-handle and pane-key environment values by
  their old names; keep those names.
Source: D-20-007

### CLI-030 · Orchestration runs: start one, bind to one, look one up
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: a coordinator agent, or the user, starts an orchestration run with an objective, attaches
  the current terminal to a run that already exists, asks which run is attached, lists runs or shows
  one.
User sees: a run record owned by the coordinator terminal that made it; later orchestration commands
  from that terminal use that run unless told otherwise.
Rules: run-create attaches the new run to the coordinator terminal it resolves; run-use attaches an
  existing run; with `--takeover-legacy` it adopts a run from the older protocol, which has to be
  done from the live coordinator terminal being attached and keeps the workers already in it;
  run-list pages by default with opaque cursors, and run-show takes a run id; run commands that
  change something accept `--retry-request` for exact recovery; run-current reports the run attached
  to the calling coordinator terminal, or to the one named with `--from`.
Acceptance:
  - [x] `kolux orchestration run-create --objective x`, then `kolux orchestration run-current` in
        the same terminal → shows that run. (cards; evidence/cards-CLI-030.txt)
  - [x] `kolux orchestration run-list --limit 1` → one row and a cursor for the next page. (cards; evidence/cards-CLI-030.txt)
Compat: orchestration run-create, run-use, run-current, run-list and run-show; `--objective`,
  `--id`, `--from`, `--takeover-legacy`, `--limit`, `--cursor` and `--retry-request`.
Source: D-20-030

### CLI-031 · Orchestration messages: send and reply
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: an agent sends a typed message to a run's mailbox, a dispatch, a terminal or a group, or
  answers a question by its message id.
User sees: a receipt naming who got the message, which recipients were skipped, and any delivery
  limits that applied.
Rules: nine message types are given with `--type`: status, dispatch, escalation, handoff, question,
  heartbeat, and three two-word types written with an underscore between the words, worker done,
  merge ready and decision gate (for example
  `kolux orchestration send --type worker_done --outcome succeeded`); a worker-done message needs
  `--outcome` with succeeded or failed; worker-done and heartbeat messages go to exactly one
  dispatch and never to a group; sent from inside an active dispatch with no recipient named, a
  message goes to the run's mailbox; addressing dispatch:<id> gives guidance to that one attempt;
  the group addresses are @all and @worktree:<id>; the structured payload flags (`--task-id`,
  `--dispatch-id`, `--files-modified`, `--report-path`, `--phase`) are preferred over raw JSON in
  `--payload`, and using both kinds at once is refused; message bodies that span several lines
  arrive unchanged (on Windows that needs the native launcher, see CLI-006); the sender is worked
  out from the handle and pane key the terminal carries in its environment; when that fails, the
  error says so plainly; reply takes `--id` and `--body`, and has to go through the same kolux
  program that asked the question.
Acceptance:
  - [x] A worker sends a worker-done message with `--outcome` succeeded and no `--to` → it lands in
        the coordinator's run mailbox. (cards; evidence/cards-CLI-031.txt)
  - [x] `kolux orchestration send --type heartbeat --to @all` is refused before the sender is even
        worked out. (cards; evidence/cards-CLI-031.txt)
Compat: orchestration send and reply; `--to`, `--run`, `--from`, `--subject`, `--body`, `--type`,
  `--priority`, `--thread-id`, `--payload`, `--task-id`, `--dispatch-id`, `--dispatch-capability`,
  `--outcome`, `--files-modified`, `--report-path`, `--phase`, `--retry-request` and `--id`; the
  address forms run:, dispatch:, @all and @worktree:.
Source: D-20-031

### CLI-032 · Orchestration inbox: check and inbox
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: an agent reads its mailbox once, peeks at it, acknowledges what it read, or blocks until
  something new arrives; or opens the inbox view of a terminal.
User sees: the oldest batch of messages not yet acknowledged, in the order they arrived, with
  guidance on how to answer the current ones.
Rules: plain check returns the oldest unacknowledged batch; `--ack` acknowledges the previous batch
  first; `--peek` lets the caller look at new messages while leaving them unacknowledged; `--all`
  returns everything without marking anything read; only one of these read modes at a time; `--wait`
  holds the command open until a message of interest turns up or the `--timeout-ms` limit passes,
  and while waiting prints a keepalive line on stderr about every 15 seconds; `--types` only decides
  what ends the wait; the batch that comes back is always complete; `--format` only changes how rows
  print here and never writes into another terminal; rows from runs on the older protocol are
  labelled and keep their bodies; against older app versions that cannot peek, rows already read are
  filtered out, a full page of 100 rows comes with a warning, and peek combined with wait fails with
  a clear reason; inbox with `--full` includes all the supported issue context, within limits.
Acceptance:
  - [x] Two messages arrive → check returns both; check with `--ack` afterwards returns nothing new. (cards; evidence/cards-CLI-032.txt)
  - [x] `kolux orchestration check --wait --timeout-ms 30000` prints keepalives on stderr and
        returns as soon as a message arrives. (cards; evidence/cards-CLI-032.txt)
Compat: orchestration check and inbox; `--terminal`, `--run`, `--ack`, `--unread`, `--peek`,
  `--all`, `--types`, `--format`, `--wait`, `--timeout-ms`, `--limit`, `--full` and
  `--retry-request`.
Source: D-20-032

### CLI-033 · Orchestration ask: a question that waits for its answer, and can be resumed
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: a worker puts a question, optionally with choices, to a coordinator or a person and waits
  for the reply.
User sees: the answer once it comes; on a timeout, the id of the pending question and the exact
  command that picks the wait up again.
Rules: `--timeout-ms` sets both how long the app waits and how long the CLI waits; leaving it out
  gives a default margin; `--resume` goes back to waiting on an existing question without asking a
  new one, and mixing new-question input with resume input is refused; on the packaged Windows
  build, the older protocol hands control back with exit status 75 so the caller can resume, and a
  resumed wait never hands back again; with `--json` the output uses the shared envelope from
  CLI-004.
Acceptance:
  - [x] Ask with a short timeout → the output includes a resume command, and running it later
        returns the answer. (cards; evidence/cards-CLI-033.txt)
  - [x] Ask with an invalid timeout → refused before the app is contacted. (cards; evidence/cards-CLI-033.txt)
Compat: orchestration ask; `--to`, `--run`, `--question`, `--resume`, `--dispatch-capability`,
  `--options`, `--timeout-ms`, `--from` and `--retry-request`; exit status 75 for the Windows
  hand-back.
Source: D-20-033

### CLI-034 · Orchestration tasks and dispatch
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: a coordinator creates tasks with dependencies, lists and updates them, sends a task to a
  worker terminal, and previews the opening text the worker will receive.
User sees: task rows with their status and whether they are ready; dispatch results that name the
  worker; previews of that opening text.
Rules: task-create takes a spec, a short title, a display name, dependencies and a parent; the
  creator is the calling terminal, worked out again from its pane key if its handle has gone stale,
  and the command fails closed when neither works; dependency lists still arrive correctly when
  PowerShell has stripped their quotes; task-list filters by status or by readiness; `--brief`
  squeezes whitespace and trims each spec to 160 characters, done by the app, or by the CLI itself
  for older app versions; task-update sets the status and the result; dispatch hands a task to a
  worker; with `--dry-run` it needs no recipient and only returns the opening text;
  `--return-preamble` adds the opening text to a real dispatch; `--inject` types it into the
  terminal; dispatch refusals come back as ordinary clear errors through the normal error output;
  dispatch-show shows a dispatch or its opening text.
Acceptance:
  - [x] Create task B that depends on A → `kolux orchestration task-list --ready` leaves B out until
        A is done. (cards; evidence/cards-CLI-034.txt)
  - [x] `kolux orchestration dispatch --task t --dry-run` prints the opening text and changes
        nothing. (cards; evidence/cards-CLI-034.txt)
Compat: orchestration task-create, task-list, task-update, dispatch and dispatch-show; `--spec`,
  `--task-title`, `--display-name`, `--deps`, `--parent`, `--status`, `--ready`, `--brief`,
  `--result`, `--task`, `--to`, `--inject`, `--dry-run`, `--return-preamble`, `--preamble`, `--run`,
  `--from` and `--retry-request`.
Source: D-20-034

### CLI-035 · Orchestration worker-start launches a worker, with model routing
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: a coordinator starts a worker for a new or existing task, in a new or existing worktree,
  choosing agent, model, effort or a routing tier if it wants to.
User sees: a receipt that says ready, failed or unknown, which launch path actually ran, anything
  left half made along the way, and the exact commands to recover.
Rules: `--task` names an existing task, while `--spec` creates one in the same step; `--model`
  accepts Claude, Codex and Cursor model ids; `--effort` needs `--model`; neither applies when an
  existing `--terminal` is reused; `--tier` with major, deep, build or light takes model and effort
  from the per-provider routing set in Settings; `--retry-of` needs `--task` and does not carry over
  where the earlier worker ran; failed and unknown receipts exit non-zero; a worker left running in
  the background gets a hint on how to reveal it; a refusal from a structured chat session names the
  way out; if the app would quietly drop the launch choices, the command fails before starting
  anything.
Acceptance:
  - [x] `kolux orchestration worker-start --spec x --tier build` starts a worker on the model routed
        for build and prints a ready receipt. (cards live; evidence/cards-CLI-035.txt)
  - [x] `kolux orchestration worker-start --spec x --effort high` with no `--model` is refused. (cards; evidence/cards-CLI-035.txt)
Compat: orchestration worker-start; `--task`, `--spec`, `--task-title`, `--deps`, `--parent`,
  `--worktree`, `--name`, `--repo`, `--base-branch`, `--display-name`, `--comment`,
  `--setup`, `--agent`, `--model`, `--effort`, `--terminal`, `--tier`, `--retry-of`, `--timeout-ms`,
  `--run`, `--from` and `--retry-request`.
Source: D-20-035

### CLI-036 · Orchestration workers: list, show, read, stop, abandon, release and retain
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: a coordinator lists its workers, looks at one, reads its transcript, or stops, abandons,
  releases or keeps a worker.
User sees: worker rows with their state and the literal next command to run; transcripts that say
  where they came from; whether a worker needs a human answer.
Rules: worker-list covers the run attached to the calling terminal unless `--run` names another,
  covers every run when none is attached, and names the scope it used; worker-list filters by
  terminal state, pages with opaque cursors and accepts a limit from 1 to 100; worker-show can wait
  interactively; it reports that nothing is waiting only after it really looked at the pane, and
  says unknown otherwise; worker-read pages a transcript with opaque cursors, labels evidence that
  came from the terminal as a fallback, tells a released archive apart from a live worker, and keeps
  the verdict on the terminal process separate from the verdict on the agent; worker-stop warns when
  the process is kept alive; release and retain decide what happens to the worktree once the work is
  done; cleanup and retention timers are not exposed on the CLI; some workers have no terminal:
  terminal commands refuse such a worker's handle, while worker-read with `--source` set to
  transcript always works; help states this limit without naming kinds of worker.
Acceptance:
  - [x] From a coordinator terminal, worker-list shows only that run's workers. (cards; evidence/cards-CLI-036.txt)
  - [x] worker-read on a released worker says that it is reading an archive. (cards; evidence/cards-CLI-036.txt)
Compat: orchestration worker-list, worker-show, worker-read, worker-stop, worker-abandon,
  worker-release and worker-retain; `--dispatch`, `--source`, `--cursor`, `--limit`, `--run`,
  `--terminal-state` and `--retry-request`.
Source: D-20-036

### CLI-011 · kolux open starts the app or brings it to the front
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: runs `kolux open`.
User sees: Kolux starts, or its window comes to the front if it is already running; the command
  returns once the app is ready to take CLI calls.
Rules: the window is brought forward even when the app was already answering; when only a background
  server is running, the command waits for that server to show a desktop window, and fails with a
  clear reason when the server cannot safely become the desktop app; if the app never answers, the
  command gives up with an error after a time limit.
Acceptance:
  - [x] App closed → `kolux open` launches it and exits 0 once it is ready. (cards; evidence/cards-CLI-011.txt)
  - [ ] App minimised → `kolux open` brings it to the front.
Compat: the command word open.
Source: D-20-011

### CLI-023 · kolux terminal list and show
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: lists terminals (for one worktree or all, with an optional limit) or shows one by its
  handle.
User sees: terminal rows with handle, title, worktree and the host each one runs on; the readable
  listing also draws tabs, split groups and panes nested inside them.
Rules: tab and pane layout is part of the readable listing; JSON callers get it only with
  `--include-visual-layouts`; the listing says which hosts it covered and which it left out, and a
  row whose host cannot be told says unverifiable rather than local; an empty listing still says
  what it looked at.
Acceptance:
  - [ ] `kolux terminal list --json` returns handles that work with terminal read and terminal send.
  - [ ] `kolux terminal list` shows split panes indented under their tab.
Compat: terminal list and show; `--worktree`, `--limit`, `--include-visual-layouts` and
  `--terminal`.
Source: D-20-023

### CLI-026 · kolux terminal create, split, rename and switch (also focus)
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens a new terminal in a worktree with an optional startup command and title, splits an
  existing terminal, renames one, or brings one into view.
User sees: the terminal joins the worktree's tabs, and is brought into view only when that was asked
  for.
Rules: create works out the worktree from the current folder when given active or nothing at all;
  interactive Claude or Codex startup commands open in the background unless `--focus` is given, and
  one-shot forms (exec, print, review, help) are not pushed onto the visible path; `--title` sets
  the tab title, and rename without a title puts the default title back; split takes a direction,
  horizontal or vertical, and an optional command; switch brings the terminal forward and says so
  when a later navigation took over; launching another agent beside the existing ones means creating
  a terminal with `--worktree` set to active and that agent's command as the startup command; a
  terminal the CLI created in the background survives a reload of the window and never comes back
  later as a duplicate, empty tab; split works on exactly the terminal named even when its tab is
  parked in the background, without changing the active tab or taking focus.
Acceptance:
  - [ ] `kolux terminal create --command codex --worktree active` opens a Codex tab without taking
        focus; adding `--focus` brings it into view.
  - [ ] `kolux terminal split --terminal h --direction vertical` adds a pane beside it.
Compat: terminal create, split, rename and switch, with focus as another name for switch;
  `--worktree`, `--command`, `--title`, `--focus`, `--direction` and `--terminal`.
Source: D-20-026

### CLI-009 · Selectors for repos, worktrees and terminals, with the current folder as default
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: names a repo, worktree or terminal on a command, or leaves it out and runs the command
  from inside a worktree's folder.
User sees: the command acts on the named target; when none is named, many commands act on the
  worktree that contains the current folder. A wrong selector fails and lists the forms that are
  accepted.
Rules: repo selectors: id:, name: and path:; worktree selectors: identity:, id:<repo-id>::<path>,
  name:, branch:, issue:, path:, and active or current for the worktree around the current folder;
  where a parent worktree is expected, folder:<id> and worktree:<id> are accepted too; terminal
  handles are handed out by the app (through terminal list) and are the preferred way to point at
  the same terminal again and again; a bare value with no prefix is refused with a message that
  repeats the value and lists the accepted forms, in text and in JSON alike; a name that fits more
  than one target never quietly picks one; from a WSL shell, a path on a Windows drive mounted into
  Linux resolves without needing the caller's distro, and when two distros write the same path the
  caller's own distro wins.
  (Kolux, T-014-b-fix: `issue:` matches the issue number recorded when the command line made the
  worktree; `identity:` and `active` are refused with the accepted forms listed, DT-C12.)
Acceptance:
  - [ ] Inside a worktree's folder, `kolux worktree current` shows that worktree.
  - [ ] `kolux worktree show --worktree 42` fails and lists the selector forms.
  - [ ] Two worktrees share a name → a name: selector fails as ambiguous rather than choosing one.
Compat: the selector prefixes listed above are part of the typed interface.
Source: D-20-009

### CLI-015 · kolux repo: list, add, show, base ref and ref search
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: lists repos, adds a folder as a repo, shows one, sets its default base ref, or searches
  its refs.
User sees: repo rows carrying ids that work in selectors; add registers the folder; set-base-ref
  changes the default starting point for new worktrees; search-refs lists the branches and tags that
  match.
Rules: repo add reads a relative path from the folder the command was run in; repos are picked with
  id:, name: or path:; search-refs takes `--query` and `--limit`, and picks its repo by the usual
  selector rules.
Acceptance:
  - [ ] In a git folder, `kolux repo add --path .` registers it, and repo list then shows it.
  - [ ] Run repo set-base-ref, then worktree create without `--base-branch` → the new worktree
        starts from the new base.
Compat: repo list, add, show, set-base-ref and search-refs.
Source: D-20-015

### CLI-016 · kolux project list
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: runs `kolux project list`.
User sees: the long-lived projects Kolux knows about.
Rules: the listing comes from the project-first view; filtering by host belonged to the dropped host
  setups (CLI-051).
Acceptance:
  - [ ] `kolux project list --json` returns every project the app shows.
  - [ ] Add a project in the app → it appears the next time project list runs.
Compat: project list.
Source: D-20-016

### CLI-017 · kolux worktree list, show, current and ps
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: lists worktrees (optionally for one repo, with a cap on rows), shows one, asks which
  worktree the current folder belongs to, or lists live sessions across worktrees.
User sees: worktree rows with selectors, branch, parent and child lineage and status; current names
  the worktree around the current folder; ps lists running sessions worktree by worktree.
Rules: listings say which hosts they covered and which they left out, so an empty result is never
  read as the whole picture; current is worked out from the current folder only when talking to the
  local app; `--limit` caps the number of rows.
Acceptance:
  - [ ] `kolux worktree list --repo name:x` lists only that repo's worktrees.
  - [ ] `kolux worktree current` inside a worktree prints it; outside any worktree it fails with a
        hint about selectors.
Compat: worktree list, show, current and ps.
Source: D-20-017

### CLI-019 · kolux worktree set: rename, link, comment, board status and lineage
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: runs `kolux worktree set` on a worktree to give it a new display name, issue, comment,
  board status or parent.
User sees: the worktree's card in Kolux changes to match.
Rules: `--workspace-status` takes a board status id; the built-in ones are todo, in-progress,
  in-review and completed; `--issue` given null removes the linked issue; the parent can be set,
  taken from current, or removed with `--no-parent`; parent flags that contradict each other or lack
  a value are refused before any lookup; active as the selector means the worktree of the current
  folder.
Acceptance:
  - [ ] `kolux worktree set --worktree name:feat --workspace-status in-review` moves the card to In
        review.
  - [ ] `kolux worktree set --worktree active --issue null` removes the issue link.
Compat: worktree set with `--display-name`, `--issue`, `--comment`, `--workspace-status`,
  `--parent-worktree` and `--no-parent`.
Source: D-20-019

### CLI-021 · kolux worktree changes and overlap: what a worktree touched and who else touches it
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: runs `kolux worktree changes` or `kolux worktree overlap`, for the current worktree
  unless told otherwise.
User sees: changes lists every file that differs from the base, committed and uncommitted work
  together. overlap lists sibling worktrees that touch the same files and predicts whether their
  committed work would clash.
Rules: both commands only read, and both default to the worktree of the current folder; changes
  reports no base when the base cannot be found, and a plain folder workspace reports that it is not
  supported; overlap looks only within the same repo, hidden worktrees included; the clash
  prediction uses the committed tips; when it cannot be checked (an old Git, a remote, or a failure)
  it says unverifiable, never clean; when the scan was incomplete, the text output says it could not
  verify instead of claiming there are no siblings, and it flags siblings whose own list of changes
  could not be read.
Acceptance:
  - [ ] Two worktrees edit the same file → overlap names that file and the sibling.
  - [ ] Make the merge check fail → overlap says unverifiable, not clean.
Compat: worktree changes and worktree overlap.
Source: D-20-021

### CLI-024 · kolux terminal read: output history or the screen as it looks now
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: reads a terminal's output by its handle, paging with a cursor, or asks for the rendered
  screen instead.
User sees: the latest output lines plus a cursor for the next read, or, with `--screen`, the frame
  that is visible right now.
Rules: `--cursor` returns only output that came after that point, and `--limit` caps the number of
  lines; when only part of the output was kept, the result warns and explains how to carry on from
  the oldest cursor; `--screen` and `--cursor` cannot be combined, since a screen has no history;
  when the screen is requested yet the host can supply only the output stream, the result carries a
  warning, and output from an older host is never presented as a screen; text the user typed into an
  agent's input box but has not sent yet is labelled separately from terminal output.
  (Kolux, T-134-a: the stream is the program's output with escapes removed and a redrawn line
  kept in its last state, not a rendering, so a line editor's redraws can leave traces in it; the
  screen is the window's terminal rows, which include whatever sits in an agent's input box, so unsent
  text is not labelled separately, DT-C18; one host, so the older-host warning only covers the
  window not answering within 1.5 s.)
Acceptance:
  - [ ] `kolux terminal read --terminal h --screen` returns the visible frame.
  - [ ] `kolux terminal read --terminal h --screen --cursor 5` is refused.
Compat: terminal read with `--terminal`, `--cursor`, `--limit` and `--screen`.
Source: D-20-024

### CLI-025 · kolux terminal send and wait
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: types text into a terminal, optionally pressing Enter or sending an interrupt, or waits
  for a terminal to exit or for its agent to go idle.
User sees: send returns a receipt that says what was delivered and, for a prompt to an agent,
  whether the agent took it and began a turn; wait returns once its condition holds or its time runs
  out.
Rules: text followed by Enter sent to an agent counts as a prompt; the receipt reports what was seen
  on delivery and warns when the Enter seems to have been lost; text on its own, or Enter on its
  own, is plain input; `--wait-submit` only watches, for the time given, for the prompt being taken;
  when the time runs out it returns the queued receipt and never sends again; `--retry-request`
  takes a request id for an exact retry after an unknown outcome; older hosts refuse such a retry
  before sending anything and are never reported as having submitted; when a structured chat session
  blocked the send, the error explains how to recover; if a send the host supports does not get as
  far as starting a turn, the result names the next command to run; wait takes `--for` with exit or
  tui-idle, plus `--timeout-ms`; a wait that ends blocked without meeting its condition exits
  non-zero.
  (Kolux, T-134-a: the receipt comes from the status hooks' turn history, so a pane without hook
  reports answers unknown with a warning; retry receipts live in memory, so a retry after a Kolux
  restart sends anew; there is one host and no structured chat session, so those refusals do not
  arise; tui-idle on a pane without hook reports means 3 s without output, warned; permission,
  waiting and blocked are the blocked states.)
Acceptance:
  - [ ] `kolux terminal send --terminal h --text hi --enter` to an idle Claude pane returns a
        receipt showing that the turn began.
  - [ ] `kolux terminal wait --terminal h --for tui-idle` returns once the agent has finished.
Compat: terminal send and wait; `--terminal`, `--text`, `--enter`, `--interrupt`, `--wait-submit`,
  `--retry-request`, `--for` (exit or tui-idle) and `--timeout-ms`.
Source: D-20-025

### CLI-040 · kolux agent hooks: status, on, off and prepare-codex
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: checks whether the agent status hooks are installed, switches them on or off, or prepares
  the trusted hook setup Codex needs.
User sees: the hook state for each agent, and confirmation of any change.
Rules: prepare-codex applies Codex trust according to the current hooks setting, and respects a
  Codex-only switch-off even when the app cannot be reached; the commands use the active profile's
  settings rather than leftover older ones, and respect a switch-off that has not finished saving;
  writing settings while the app is offline never turns on optional interface styles the user did
  not choose.
Acceptance:
  - [ ] `kolux agent hooks off`, then `kolux agent hooks status` → off, and Claude panes stop
        reporting live status.
  - [ ] With Codex hooks switched off, `kolux agent hooks prepare-codex` leaves them off.
Compat: agent hooks status, on, off and prepare-codex.
Source: D-20-040

### CLI-014 · kolux account add and account list
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: runs `kolux account add`, optionally choosing the provider, to sign in one more account,
  or `kolux account list` to see them all.
User sees: add runs the provider's own sign-in inside the terminal and registers the result as a
  Kolux account; list shows the registered accounts with the active one marked.
Rules: the provider is Claude when `--agent` is left out, while an empty `--agent` is refused rather
  than falling back; Codex sign-in uses device authorisation; the command stops before any sign-in
  starts when the app cannot be reached or is too old to take in accounts; interrupting the sign-in
  (Ctrl+C, or an SSH session that drops) removes the temporary credentials and restores the earlier
  macOS Keychain entry; a second interrupt waits for that cleanup to finish; a sign-in that worked
  is still reported as failed when the throwaway credentials it used cannot be cleaned up; list does
  not force a fresh usage fetch from the providers; account commands always run on this machine and
  ignore remote-target flags.
Acceptance:
  - [ ] `kolux account add` completes a Claude sign-in and the account then shows in
        `kolux account list`.
  - [ ] Pressing Ctrl+C part-way through sign-in leaves no stray credentials behind.
Compat: account add with `--agent` (claude, codex or another supported provider) and account list.
Amended 2026-10-11 (DT-A4): remote-target flags are refused like environment and pairing flags, not ignored.
Source: D-20-014

### CLI-003 · Typos are caught before the app is contacted, with safe suggestions
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: misspells a command word or a flag.
User sees: an error that names the word it did not recognise, offers the nearest valid command or
  flag as the next step and, for a flag, lists the flags that command takes; the exit status is not
  zero.
Rules: command and flag checking happens before anything looks for the running app, so a typo never
  turns into a misleading message that the app is not running; suggestions are drawn only from words
  at the same level (group names for a wrong group, verbs for a wrong verb), alias paths included;
  up to three edits away counts as near; very long words skip the distance calculation but still
  receive the list of valid flags; a harmless typo is never pointed at a destructive command: rm,
  delete, close or anything else marked destructive is offered only when the typed word is one edit
  away from a destructive word; hidden compatibility commands are never offered; on the one verb
  where the caller-handle flag was renamed (from `--from` to `--terminal`), the error points to the
  new flag, and only on that verb; with `--json`, the suggestion is carried as structured next steps
  inside the error data; a misspelt flag typed before or between the command words, such as a wrong
  global flag ahead of the group, is reported as unknown against the full command path, still before
  the app is contacted.
Acceptance:
  - [ ] With the app closed, `kolux worktre list` suggests worktree list and exits with a non-zero
        status.
  - [ ] `kolux worktree rmm` suggests rm; `kolux worktree lst` never suggests rm.
  - [ ] `kolux terminal list --worktre` suggests `--worktree` and lists the flags terminal list
        accepts.
  - [ ] `kolux --jso worktree --json list` exits 1, naming the unknown flag and the worktree list
        command, without calling the app.
Compat: —
Source: D-20-003

### CLI-020 · kolux worktree rm, also reachable as remove and delete
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: runs `kolux worktree rm` on a worktree, possibly with `--force` or `--run-hooks`.
User sees: the worktree disappears from disk and from Kolux.
Rules: the command is marked destructive, so typo suggestions never lead to it from harmless words;
  `--force` forces only the removal of the checkout; it never forces the branch to be deleted;
  `--run-hooks` runs the repo's archive scripts.
Acceptance:
  - [ ] `kolux worktree delete --worktree name:x` behaves exactly like rm.
  - [ ] With uncommitted changes, rm fails; with `--force` it removes the checkout and the branch
        stays.
Compat: worktree rm, with remove and delete as aliases; `--force` and `--run-hooks`.
Source: D-20-020

### CLI-039 · Who is calling: caller identity for orchestration
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: runs orchestration commands from an agent terminal, a structured chat session or a shell
  outside Kolux.
User sees: commands act as the terminal they run in; pretending to be another terminal, or using an
  identity that has gone stale, is refused with a clear reason.
Rules: identity comes from the handle and pane key in the terminal's environment, and `--from` names
  a handle explicitly where that is permitted; a stale handle is worked out again from the pane key,
  and when that cannot be proven the command fails closed; a structured worker can run orchestration
  commands as itself, while a chat session that lacks an orchestration identity is refused; runs on
  the older protocol are read-only from the CLI, and their workers' completion reports are accepted
  only when attested, never from a relay that cannot vouch for them; lifecycle verdicts the app
  rejects are reported as failures, in JSON mode too; a worker-done message whose dispatch cannot be
  shown to settle (for instance because the dispatch had already failed for another reason and left
  its task blocked) is reported as an unknown outcome and fails, never as success.
Acceptance:
  - [ ] Running check from a plain shell that has no handle fails with a clear error about identity.
  - [ ] A worker-done message sent from a different pane does not complete the task.
Compat: the terminal-handle and pane-key environment values from CLI-007, and `--from`.
Source: D-20-039

### CLI-006 · Windows: the kolux.cmd shim and the kolux.exe launcher
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: calls kolux on Windows from cmd, PowerShell or an agent, sometimes with message bodies
  that run over several lines.
User sees: kolux.cmd passes everything on to the kolux.exe sitting next to it and returns that
  program's exit status; for orchestration send and reply it declines and tells the caller to use
  kolux.exe.
Rules: the shim looks for the launcher in its own folder; if it is not there, an error goes to
  stderr and the exit status is 1; orchestration send and reply are declined with exit status 2,
  because cmd reads the arguments a second time and could execute, or cut short, line breaks inside
  a message body; kolux.exe passes bodies that span several lines through untouched; the shipped CLI
  sits in a folder inside the per-user install, and the name Windows shells find is kolux.cmd; group
  addresses such as @all have to be quoted in PowerShell; values whose quotes Windows PowerShell 5.1
  removes (JSON handed to a flag) are spotted and reported instead of being misread in silence, and
  dependency lists are recovered where the native launcher receives its arguments.
Acceptance:
  - [ ] Run status through kolux.cmd → the call is passed on and the exit status is the launcher's.
  - [ ] Run orchestration reply with an id and a body through kolux.cmd → exit 2 and nothing is
        sent.
  - [ ] Send a two-line message body with kolux.exe orchestration send → both lines arrive
        unchanged.
Compat: the two Windows entry names kolux.cmd and kolux.exe, and exit status 2 for the shim refusal.
Source: D-20-006

### CLI-010 · Which commands need the app to be running
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs a kolux command while the app may or may not be open.
User sees: most commands talk to the running app and, when it cannot be reached, fail with advice to
  run `kolux open` first. A handful answer by themselves while the app is closed.
Rules: answered without the app: help, the version flag, agent-context, skills list, skills get,
  skills install and update (they start a package tool), and the agent hooks commands that change
  local settings; the connection to the app is made only when it is needed: help and validation
  errors never load or touch it, and a single connection serves the whole command; an app too old
  for a command is reported as a version gap rather than a vague failure; an ordinary timeout from
  the app is not reported as the app being down.
Acceptance:
  - [ ] With the app closed, `kolux agent-context --json` and `kolux skills list` succeed, while
        `kolux terminal list` fails with the advice to run open.
  - [ ] With the app closed, `kolux --help` comes back straight away.
Compat: —
Source: D-20-010

### CLI-027 · kolux terminal close, with the old stop kept as a hidden alias
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: closes one terminal by its handle, its whole tab, or every terminal in a worktree.
User sees: the terminals close, and the result says whether each process was confirmed stopped.
Rules: `--tab` closes the whole tab and waits until that change is saved for good; `--worktree`
  together with `--all` closes every terminal in that worktree; success is claimed only when the
  process was confirmed killed; if the process might be alive, the close is reported as failed, in
  JSON mode as well; a host too old to close in bulk fails before anything changes; terminal stop is
  deprecated and hidden, and points the caller to close with `--worktree` and `--all`.
Acceptance:
  - [ ] `kolux terminal close --all --worktree active` closes every pane there and confirms each
        one.
  - [ ] `kolux terminal stop` is missing from help but still explains what replaced it.
Compat: terminal close with `--terminal`, `--tab`, `--worktree` and `--all`; terminal stop stays as
  a hidden word.
Source: D-20-027

### CLI-038 · Safe retry after a lost result: the retry flag, request-show and reset
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: re-runs an orchestration change whose outcome was lost (say, a dropped connection),
  checks what became of a request, or resets orchestration state.
User sees: the retried change takes effect no more than once; request-show says what happened to the
  request; reset clears the scope that was chosen.
Rules: only orchestration changes carry a request id that lasts; when the connection drops, the
  error prints the exact command to retry with `--retry-request`; the value of `--retry-request`
  must be a UUID, and the flag is meant only for exact recovery; an older local app is refused
  before any orchestration change is sent; request-show asks without sending a change and gives an
  honest account of the state, naming the version gap on older servers; it takes the request id with
  `--request`; reset needs exactly one scope (`--all`, `--tasks` or `--messages`), and a bare reset
  is refused before the app is contacted.
Acceptance:
  - [ ] Drop the connection in the middle of task-create → the error shows a retry command, and
        running it creates exactly one task.
  - [ ] `kolux orchestration reset` with no scope is refused.
Compat: `--retry-request` taking a UUID on orchestration changes and on terminal send; orchestration
  request-show and reset (`--all`, `--tasks` or `--messages`).
Source: D-20-038

### CLI-004 · JSON output and structured errors
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: adds `--json` to a command, usually from a script or an agent.
User sees: on success, the full response printed on stdout as indented JSON: a request id, a success
  flag set to true, the result and some metadata. On failure, the same envelope with the success
  flag false and an error that holds a code, a message and data for recovering. Without `--json`,
  results are printed as readable text and errors go to stderr together with suggested next steps.
Rules: errors produced inside the CLI itself get a request id made on the spot and an empty runtime
  id in the failure envelope; the failure envelope keeps its recovery data: how selectors are
  written after a bad worktree selector, did-you-mean steps, the commands that recover an
  interrupted change, and the steps for an automation owned by another host; recovery advice
  specific to the error beats general hints, and the recovery steps for an interrupted change are
  never swapped for general advice about starting the app; when the app cannot be reached, text mode
  adds advice to run `kolux open` first, except for orchestration changes that already print their
  own recovery; interactive sign-in prompts never write into the JSON on stdout; replies are
  checked: a malformed frame, or a reply whose id differs from the request, is rejected, and the
  keepalive frames sent during long waits are never taken for results; payloads encoded as base64
  report their size in decoded bytes, not the length of the encoded string; a failure exits 1 in
  both text and JSON mode; next-step commands printed in errors and receipts put quotes around
  values with spaces in the way the current shell expects, so they paste and run as they are, while
  plain selectors stay unquoted.
Acceptance:
  - [ ] `kolux worktree show --worktree 123 --json` with a bare number prints a false success flag,
        a selector error code and the accepted selector forms in the error data.
  - [ ] `kolux status --json` with the app closed prints an envelope that parses.
  - [ ] `kolux account add --json` keeps sign-in prompts off stdout so the output still parses.
Compat: scripts depend on the envelope's request id, success flag, result, error code, message and
  data, and on the runtime id in its metadata; keep their meaning and naming stable. JSON goes to
  stdout, text errors to stderr.
Source: D-20-004

### CLI-005 · Exit codes
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: calls kolux from a script or an agent and looks at the exit status.
User sees: 0 when the command worked and 1 for any error, with a few commands using other values for
  particular hand-overs.
Rules: 1 covers validation errors, help paths that do not exist, an app that cannot be reached,
  failures inside the app, and worker receipts that say failed or unknown; 2 is the Windows
  command-script shim declining orchestration send or reply (CLI-006); 75 is orchestration ask on
  the packaged Windows build passing the wait back to the caller; picking the same question up again
  does not pass it back a second time; terminal wait exits non-zero when it stops in a blocked state
  without its condition being met; skills install and skills update pass on the exit status of the
  package tool they start; claude-teams and the hidden tmux stand-in return the status of whatever
  they handed the call to; kolux.cmd returns the launcher's own exit status, and 1 when the launcher
  is not there.
Acceptance:
  - [ ] A wrong flag exits 1; `kolux status` that succeeds exits 0.
  - [ ] Orchestration send run through kolux.cmd exits 2 and points the caller to kolux.exe.
  - [ ] `kolux terminal wait --for exit --timeout-ms 1` while the watched process keeps going exits
        non-zero.
Compat: exit statuses 0, 1, 2 (shim refusal) and 75 (Windows hand-back from ask).
Source: D-20-005

### CLI-013 · kolux claude-teams runs Claude Code agent teams in Kolux panes
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux claude-teams` followed by any arguments meant for Claude Code.
User sees: Claude Code starts and its team members appear as Kolux panes; on Windows the command
  explains that native team panes are not available there.
Rules: everything after claude-teams goes to Claude Code untouched, so flags added to Claude later
  need no change in Kolux; the Claude process inherits the caller's environment, but never the
  setting that makes the app's own program behave as a bare script runtime; a hidden stand-in for
  tmux answers Claude's pane requests through the app and returns their output and exit status; help
  never lists it.
Acceptance:
  - [ ] `kolux claude-teams --some-new-flag` reaches Claude unchanged.
  - [ ] On Windows, the command says it is not supported there.
Compat: the command word claude-teams, with every following argument passed through raw.
Source: D-20-013

### CLI-028 · kolux automations list, show and runs
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: lists scheduled automations, shows one, or lists one's past runs.
User sees: each automation with its schedule, its target and the host that owns it; runs with their
  outcomes, skipped ones included.
Rules: rows name the owning host, and a row whose host has gone is shown as orphaned along with why
  it cannot run; reading never requires the owning host to still exist; an automation id can be
  given bare or by flag.
Acceptance:
  - [ ] `kolux automations list --json` returns every automation the Automations view shows.
  - [ ] `kolux automations runs <id>` lists a skipped run after a precheck failed.
Compat: automations list, show and runs.
Source: D-20-028

### CLI-029 · kolux automations create, edit, remove and run
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: creates or edits a scheduled agent run with a name, schedule, prompt, provider and
  target; removes one; or starts one right away.
User sees: the automation appears or changes in Kolux and fires on its schedule; run starts it at
  once, unless that automation is still running, when it is refused naming the run in progress.
Rules: run goes through the same check as Run Now in the window: an automation with a run pending,
  dispatching or dispatched is refused, and the refusal creates no second run; a schedule is
  hourly, daily, weekdays, weekly, a five-field cron line or an RRULE;
  `--schedule` is another name for `--trigger`; `--time` takes HH:MM, `--day` takes 0 to 6 with
  Sunday as 0, and `--timezone` takes an IANA zone name; on edit, schedule modifiers need a schedule
  flag alongside them, and invalid days are refused before the app is contacted; the target is the
  current worktree unless `--repo` or `--workspace` is given (never both); `--workspace-mode` is
  existing or new-per-run, and a new worktree for each run is the default; `--reuse-session` makes
  each new run continue in the session left alive by the last run (existing-workspace mode only),
  `--fresh-session` does the reverse, and asking for both is refused; `--precheck` runs a bounded
  command first: exit 0 lets the run go ahead, any other status logs the run as skipped, and
  `--precheck-timeout` limits how long it may take; `--enabled` or `--disabled` switch the
  automation on or off, and `--missed-run-grace-minutes` decides whether a missed run is caught up;
  `--source-context` takes JSON task data; null on edit clears it, and invalid JSON is refused
  early; edits carry the owner they read; if another host owns the automation by then, the command
  explains the conflict and how to recover, and never offers a retry for a target that has been
  removed.
Acceptance:
  - [ ] `kolux automations create --name r --trigger daily --time 09:00 --prompt review --provider claude`
        makes a daily 9:00 automation in the current repo.
  - [ ] A precheck that exits 1 → a skipped run is recorded.
  - [ ] `kolux automations edit <id> --day 7` is refused without contacting the app.
  - [ ] `kolux automations run <id>` while that automation is still running → refused, naming the
        run in progress; no second run is made. (unit tests: evidence/T-671.txt)
Compat: automations create, edit, remove and run; `--name`, `--trigger` (or `--schedule`), `--time`,
  `--day`, `--timezone`, `--prompt`, `--provider`, `--repo`, `--workspace`, `--workspace-mode`,
  `--reuse-session`, `--fresh-session`, `--precheck`, `--precheck-timeout`, `--enabled`,
  `--disabled`, `--missed-run-grace-minutes` and `--source-context`.
Source: D-20-029

### CLI-037 · Orchestration decision gates
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: a coordinator opens a gate that holds until a decision is made, resolves it, or lists
  gates.
User sees: gate rows and how each one was resolved.
Rules: gate-create uses the attached coordinator handle; when no run is attached it fails with an
  error that says what to do, and changes nothing; an explicit `--from` is accepted without checking
  that the terminal is still alive; gate-list covers the caller's run, or looks at a named run
  without attaching to it; gate-resolve takes the gate's `--id` and a `--resolution`, optionally
  `--from`, and accepts `--retry-request`.
Acceptance:
  - [ ] gate-create from a terminal with no attached run fails and nothing is created.
  - [ ] gate-resolve with an id and a resolution → gate-list then shows that gate as resolved.
Compat: orchestration gate-create, gate-resolve and gate-list.
Source: D-20-037

### CLI-042 · kolux agent-context: a machine-readable map of every command
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: an agent runs `kolux agent-context --json` to learn the CLI.
User sees: a document with a version number that lists every command: its full words, path, aliases,
  whether its arguments are parsed or passed through raw, a summary, usage, the flags it accepts
  (global ones included), bare arguments, examples and notes. Without `--json` it prints only how
  many commands there are and how to get the whole document.
Rules: the answer comes from the CLI's own command list with the app closed, and remote-target flags
  are ignored; commands appear in a stable order, and optional lists are empty rather than missing;
  commands that pass their arguments through raw are marked as such and get no invented Kolux flags;
  aiming at a particular browser page is not advertised in this local discovery.
Acceptance:
  - [ ] `kolux agent-context --json` parses, its command count equals the number of entries, and
        worktree rm lists remove and delete as aliases.
  - [ ] With the app closed, `kolux agent-context --json` still succeeds.
  - [ ] `kolux agent-context` without `--json` prints only the count and how to get the full
        document.
Compat: the document carries a schema version (1 at 0.15.0), a command count and one entry per
  command; agents and the owner's skills read its field names, so keep them stable (see COMPAT.md).
Source: D-20-042

### CLI-043 · kolux skills list and get: the agent guides bundled with the CLI
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: lists the skill guides that ship with this CLI version, or prints one in short form, in
  full, or one of its references.
User sees: topic names with a one-line description each; the guide's Markdown text.
Rules: works locally with the app closed, and lists topics in a stable order; get prints the short
  guide; `--full` prints the whole package; `--references` lists the names of its references;
  `--reference` prints one reference on its own (also accepted written as its path inside the
  guide's references folder, or through a topic alias); `--full`, `--reference` and `--references`
  cannot be combined, and `--reference` aimed at a topic that has none, or at an unknown reference
  name, is refused with the available ones listed; an unknown topic exits non-zero and lists every
  topic; skills show is another name for get; with `--json` the answer gives the canonical name,
  what was selected and the Markdown in a stable shape; the topic can be given bare or with
  `--topic`.
Acceptance:
  - [ ] `kolux skills get orchestration` prints the short guide, and adding `--full` prints more.
  - [ ] `kolux skills get nope` exits non-zero and lists the valid topics.
Compat: skills list and get, with show as another name for get; `--full`, `--reference`,
  `--references`, `--topic` and `--json`.
Source: D-20-043

### CLI-044 · kolux skills install and update
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: installs or updates Kolux skills into the coding agents found on this machine, globally
  or for the current project, or previews the command first.
User sees: the package command about to run, printed on stderr, followed by that tool's own output;
  with `--dry-run` the command is printed and not run.
Rules: with neither `--skill` nor `--all` it lists what can be installed or updated; `--skill` can
  be repeated and accepts aliases; `--all` together with `--skill` is refused, and so are unknown
  names; `--agent` takes a comma-separated list; by default the command targets the agents Kolux
  detects, and when it detects none it refuses to run rather than targeting all of them; `--local`
  installs for the project instead of for the whole user; `--json` works only with `--dry-run` or a
  listing, and real runs refuse it; the package tool's exit status is passed on, and failing to
  start the tool exits non-zero; on Windows a package tool that is a command-script shim is run
  through cmd safely, paths that cmd would misread are reported, and the current folder is never
  added to the tool's program search path; if kolux in this shell is forwarded to another machine's
  Kolux, the command declines; a package tool installed under a folder whose name contains spaces or
  brackets (such as the 32-bit Program Files folder) is run rather than refused, and a tool that is
  not a command-script shim is started directly.
Acceptance:
  - [ ] `kolux skills install --skill kolux-cli --dry-run` prints the exact command and changes
        nothing.
  - [ ] With no agents detected, skills install without `--agent` refuses to run.
Compat: skills install and update; `--skill` (repeatable), `--all`, `--agent`, `--local` and
  `--dry-run`.
Source: D-20-044

### CLI-001 · Help on every level of the command tree, plus a version flag
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs kolux with nothing after it, adds `--help` to any group or command, types kolux help
  followed by a command path, or asks for `kolux --version`.
User sees: at the top level, an overview split into sections: groups arranged by purpose, frequently
  used commands, how selectors are written, option groups, notes on behaviour and worked examples. A
  group's help lists its commands, one line of purpose each. A command's help gives its usage line,
  what it is for, each option with a brief explanation, notes and examples. The version flag prints
  the build version and nothing else.
Rules: help works with the app closed and never opens a connection to it; a help path that matches
  no group and no command prints the closest help it can, adds a suggestion and exits 1, while a
  real group or command exits 0; every command lists the global options; at 0.15.0 there are four:
  help, JSON, and two remote-targeting ones (pairing code and environment) that leave with the
  dropped remote targeting in CLI-050; hidden compatibility commands (the deprecated terminal stop
  and the tmux stand-in from CLI-013) never show up in help or in suggestions; the top-level
  overview names the current close command rather than the deprecated stop; each visible command can
  be found from its own group's help, including the ones the top-level overview leaves out at 0.15.0
  (worktree changes and overlap, agent hooks, claude-teams, orchestration request-show and many
  browser verbs); the skill guides bundled with the CLI may only mention command paths and flags
  that really exist, and this is checked across the guides and their references; -v or `--version`
  counts as asking for the version only if nothing else is typed; when the version cannot be worked
  out, the reason goes to stderr and the exit status is 1.
Acceptance:
  - [ ] With the app closed, `kolux --help` prints the overview and exits 0, with no message about
        the app not running.
  - [ ] `kolux worktree --help` lists list, show, current, create, set, rm, ps, changes and overlap.
  - [ ] `kolux help terminal sned` prints help, proposes terminal send and exits 1.
  - [ ] `kolux --version` prints a single version line; `kolux --version --json` is parsed as an
        ordinary command, not as a version request.
Compat: the words help, `--help`, `--version` and -v; help is reachable both as `kolux help <path>`
  and by putting `--help` after the path.
Source: D-20-001

### CLI-002 · Argument grammar: flags, values, aliases and bare arguments
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: types a command with its flags in whatever order, giving values after a space or joined
  with an equals sign, using an alias, or ending with a bare argument.
User sees: the command runs with exactly the values that were typed; an alias acts just like the
  command it stands for; a missing or badly formed value is refused, and the error identifies the
  flag.
Rules: the space form and the equals form both work, and the equals form splits at the first equals
  sign, so a value may contain further equals signs; a flag followed by an equals sign and nothing
  else means an explicit empty string, and empty values survive where they carry meaning (a cookie
  value, a storage value, a credential password); values beginning with two dashes are accepted only
  in the equals form; switches and value flags may appear between command words, and an unrecognised
  flag never eats the command word after it; a selector value that happens to spell a command or
  group name is still treated as a value; repeatable flags (such as `--skill` on skills install)
  collect every value given; ordinary text flags keep a single value; aliases are turned into the
  real command before anything runs: worktree remove and worktree delete become rm, terminal focus
  becomes switch, skills show becomes get, orchestration run becomes coordinator-start and
  orchestration run-stop becomes coordinator-stop; bare arguments (the file path for file open, the
  skill name for skills get, the automation id for automations edit, remove, run and show) are
  matched after aliases are resolved, and giving the same id both bare and by flag with two
  different values is refused; the global flags are accepted by every command, even where a
  command's own definition does not mention them; flags that need a value fail when they get none or
  an empty one, for example `--worktree`, `--mode`, `--agent`, `--retry-request` and
  `--wait-submit`; naming policy: commands that delete use rm, with other verbs allowed only as
  aliases, and reading a single item uses show, with get kept only where it already existed; global
  flags may be typed before the command words, a lone double dash in front of the command is
  ignored, and text resembling a command word stays a value.
Acceptance:
  - [ ] `kolux cookie set --name a --value=` sends an empty value; leaving `--value` out entirely is
        refused before the app is called.
  - [ ] `kolux worktree delete --worktree name:x` takes exactly the same path as worktree rm.
  - [ ] `kolux skills install --skill a --skill b` installs both skills.
  - [ ] `kolux file open --worktree` with no value fails before any folder lookup or call to the
        app.
Compat: the space form, the equals form and the empty equals form of a flag, and every alias named
  above, are part of the typed interface.
Source: D-20-002

### CLI-008 · Register or remove the kolux command for the whole system
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the CLI section in Settings to make kolux available in terminals outside Kolux, or
  to take it away again.
User sees: the section explains where the command will be registered on this operating system, shows
  whether it is registered right now, and offers to register or remove it; when something fails it
  names the path that is in the way and how to clear it. It also offers to install the matching
  kolux skill for agents.
Rules: Windows: the CLI folder is added to the user's PATH in the registry, matching the variable
  name whatever its letter case; when PATH cannot be read, the state shows as unknown and no change
  is offered; removing an entry the user PATH does not contain changes nothing; macOS: a link in the
  system-wide folder for locally installed programs, falling back to an administrator prompt when
  that folder cannot be written; Linux: a launcher in the per-user programs folder under the home
  directory, with a warning when that folder is not on PATH; AppImage installs get a steady launcher
  that keeps working after the AppImage is moved or updated; development builds register a separate
  kolux-dev command, so they never take the place of the installed one; a file or link of unknown
  origin already at the target is reported as a conflict and left where it is; outdated launchers
  Kolux wrote itself are replaced; wrappers of an older style are tidied away; a registration that
  failed or only half worked never shows a success message; registering and removing look at the
  target again after any step that needed elevated rights: a file or link someone else put there in
  the meantime is put back, never deleted, and an elevated step that takes too long reports its
  timeout as an error; AppImage: the steady launcher keeps answering while a newer version is being
  put in place and moves to it once it exists, works on file systems with no hard links, and older
  unpacked copies are cleaned away after a grace period without disturbing other installs.
Acceptance:
  - [ ] Register on Windows and open a fresh terminal outside Kolux → `kolux --version` works.
  - [ ] Place an unrelated file at the macOS target → registering reports the conflict with the path
        and leaves the file untouched.
  - [ ] Remove → the command no longer resolves in a fresh terminal outside Kolux.
Compat: the command names kolux, and kolux-dev for development builds; one install place per
  operating system as described above.
Source: D-20-008

### CLI-022 · kolux file open, diff and open-changed
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a file in the Kolux editor, opens a diff for a file, or opens every changed file of
  a worktree.
User sees: the files or diffs open in the app, and the command reports which ones opened and which
  were skipped.
Rules: a relative path opens in the worktree of the current folder, and an explicit `--worktree`
  skips that guess; open-changed opens diffs by default and can open editing tabs as well; deleted
  files are skipped for editing, and unresolved conflicts are skipped in diff mode; diffs the app
  could not open are listed as skipped, not as opened; `--mode` is checked before any lookup; an
  absolute path that lies inside the target worktree is accepted and opened as the matching path
  within it (also when a WSL shell writes a Windows worktree path in Linux form), while the
  worktree's top folder itself is refused because it is a folder, not a file; file diff with
  `--staged` opens the staged changes instead of the working-tree changes; the path can be given
  bare or with `--path`.
Acceptance:
  - [ ] Inside a worktree, file open with a relative path to one of its files → that file opens.
  - [ ] open-changed in a worktree with a deleted file → the deleted file is listed as skipped.
  - [ ] file open with a full path to a file of this worktree → that file opens; naming the
        worktree's top folder → exit 1 and nothing opens.
Compat: file open, diff and open-changed; `--worktree`, `--mode`, `--staged` and `--path`.
Source: D-20-022

### CLI-045 · Browser tabs and profiles (kolux tab)
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: lists, shows, creates, switches or closes Kolux browser tabs, and manages the browser
  profiles the tabs use.
User sees: tab rows with page ids and profile labels; new tabs open in the worktree's browser.
Rules: page ids from tab list are the dependable way to aim a command at a single tab with `--page`,
  and commands without it act on the worktree's active tab; the current worktree is worked out only
  when `--page` is combined with `--worktree` set to current; tab switch brings the tab into view
  only with `--focus`; tab switch and tab close take a tab number with `--index` or a page id with
  `--page`, and tab list with `--show-profile` adds each tab's profile; profiles can be listed,
  created (isolated by default; imported scope or the browser's own user agent on request; an
  unknown scope is refused), deleted, set, shown, set back to the default, and a tab can be copied
  into another profile; deleting a profile is marked destructive; browser commands are words at the
  top level (tab, snapshot, click, cookie, storage and so on) rather than members of a browser
  group, and they are not suggested inside unrelated groups.
Acceptance:
  - [ ] `kolux tab create --url x`, then `kolux tab list --json` → the new page id is in the list.
  - [ ] `kolux tab profile create --label x --scope bogus` is refused.
Compat: tab list, show, current, switch, create and close, and tab profile list, create, delete,
  set, show, use-default and clone; `--page`, `--index`, `--worktree`, `--profile`, `--label`,
  `--scope`, `--no-ua-spoof`, `--show-profile` and `--focus`.
Source: D-20-045

### CLI-046 · Browser page interaction through snapshot references (kolux snapshot, click, fill and more)
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: an agent drives a browser tab: it navigates, takes an accessibility snapshot, then
  clicks, types into or fills elements using the references the snapshot gave out.
User sees: the result of each action; snapshots list the elements with short references (e1, e2 and
  so on).
Rules: the loop is: open or navigate, take a snapshot, act on references, and take a new snapshot
  after any navigation; navigation verbs: goto, back, forward and reload; action verbs: click,
  dblclick, hover, drag, fill, type, inserttext, clear, select, select-all, check, uncheck, focus,
  keypress, scroll, scrollintoview, upload, and mouse move, down, up and wheel; query verbs: get,
  is, find, highlight and eval; wait takes a selector or a condition; waits on a selector get their
  own time budget, stretched by `--timeout`; exec hands a raw command string straight to the
  underlying browser-automation engine, for anything that has no verb of its own; every browser verb
  takes `--worktree` to choose whose browser to drive; flags by verb: type uses `--input`; scroll
  uses `--direction` (up, down, left or right) with `--amount` in pixels; eval uses `--expression`;
  wait uses `--selector`, `--text`, `--url`, `--load`, `--fn`, `--state` and `--timeout`; get and is
  use `--what`; find uses `--locator` with `--action`, `--value` and `--text`; download uses
  `--selector` and `--path`; highlight uses `--selector`; mouse move uses `--x` and `--y`; mouse
  down and up use `--button`; mouse wheel uses `--dx` and `--dy`.
Acceptance:
  - [ ] Snapshot a sign-in page, fill the email reference and click the submit reference → the page
        moves on.
  - [ ] A wait for a selector that never shows up times out without claiming that Kolux is down.
Compat: the top-level verbs listed above; `--element`, `--value`, `--worktree` and `--page`.
Source: D-20-046

### CLI-047 · Browser state, emulation and capture (kolux cookie, storage, set, screenshot and more)
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: reads or sets cookies and local or session storage; emulates a device, a viewport, a
  location, offline mode, headers, credentials or media preferences; intercepts or records network
  traffic; reads console and network logs; uses the clipboard; answers dialogs; downloads; or
  captures screenshots and PDFs.
User sees: the value that was read, confirmation of a change, or the file that was captured.
Rules: empty values are kept for a cookie value, a storage value and a credential password, while
  empty names or keys and values left out entirely are refused before the app is contacted; a
  cookie's expiry must be a finite number that is not negative; viewport has a mobile option; set
  covers device, offline, headers, credentials and media; intercept has enable, disable and list;
  capture has start and stop; console and network read their logs; clipboard has read and write;
  dialog has accept and dismiss; download saves a file; screenshot, full-screenshot and pdf produce
  files, and base64 sizes are reported in decoded bytes; screenshot and full-screenshot take
  `--format` with png or jpeg; cookie delete and storage clear are marked destructive; geolocation
  overrides the page's location with `--latitude` and `--longitude`, and optionally `--accuracy`;
  flags by verb: cookie set takes name, value, domain, path, secure, HTTP-only, same-site and expiry
  flags, typed as in
  `kolux cookie set --name a --value b --domain d --path p --secure --httpOnly --sameSite Lax --expires 0`;
  cookie delete takes `--name` with `--domain` or `--url`; viewport takes `--width`, `--height`,
  `--scale` and `--mobile`; set offline takes `--state`; set headers takes `--headers`; set
  credentials takes `--user` and `--pass`; both take an optional `--origin` (T-656); set media takes `--color-scheme` and `--reduced-motion`;
  intercept enable takes `--patterns`.
Acceptance:
  - [ ] `kolux storage local set --key a --value=` stores an empty string.
  - [ ] `kolux screenshot` writes an image of the current tab.
Compat: the top-level words cookie (get, set, delete), storage local or session (get, set, clear),
  viewport, geolocation, set (device, offline, headers, credentials, media), intercept (enable,
  disable, list), capture (start, stop), console, network, clipboard (read, write), dialog (accept,
  dismiss), download, screenshot, full-screenshot and pdf.
Source: D-20-047

### CLI-041 · kolux diagnostics memory
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs `kolux diagnostics memory`.
User sees: the same memory breakdown the app's resource usage popover shows, with committed memory
  next to resident memory.
Rules: with `--json`, the committed figure is passed through unchanged.
Acceptance:
  - [ ] The figures match the Resource Usage popover read at the same moment.
  - [ ] `kolux diagnostics memory --json` parses and carries the committed figure beside the
        resident one.
Compat: diagnostics memory.
Source: D-20-041

### CLI-048 · Retired orchestration coordinator-start and coordinator-stop
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-09-10
User does: runs orchestration coordinator-start or its alias orchestration run, or coordinator-stop
  or its alias run-stop.
User sees: a note that the command has been retired and that the current orchestration skill should
  be loaded instead; nothing else happens.
Rules: the command does nothing at runtime and only exists to redirect old habits; it was already
  retired when the Kolux history begins (2026-09-10), so the retirement is older than the fork.
Acceptance:
  - [ ] `kolux orchestration coordinator-start` prints the retirement note and no run is created.
  - [ ] `kolux orchestration run-stop` prints the same note and nothing changes.
Compat: the words orchestration coordinator-start and coordinator-stop, with the aliases
  orchestration run and run-stop.
Decision: H: default skip.
Source: D-20-048

### CLI-049 · kolux serve: headless server
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: runs `kolux serve` to start Kolux with no window, optionally printing pairing or recipe
  details.
User sees: a headless server in the foreground that remote clients can pair with.
Rules: contradictory pairing flags and bad port numbers are refused before launch, and it always
  runs on this machine.
Acceptance:
  - [ ] `kolux serve` is reported as an unknown command.
  - [ ] The top-level help lists no serve command.
Compat: —
Decision: default cut: headless serving and the web client belong to area 18. Revive via
  DECISIONS.md.
Source: D-20-049

### CLI-050 · Remote targeting: pairing codes, environments, hosts and opening links on a paired client
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: aims commands at another Kolux with the pairing-code or environment flags or their
  environment variables, manages saved environments, lists hosts, names a runtime host explicitly,
  or opens a link on the paired client.
User sees: commands run against the chosen remote Kolux; the environment and host lists show what
  can be targeted.
Rules: local-only groups (account, environment, host, serve, agent, vm, agent-context) ignore remote
  selection, and host list refuses explicit remote flags; an explicit runtime host outranks pairing
  settings picked up from the surroundings, and disagreements are refused; a separate environment
  variable let the SSH relay pass along the remote caller's folder; open-url opened a link on the
  paired client hosting the terminal.
Acceptance:
  - [ ] A command given `--pairing-code` or `--environment` reports an unknown flag.
  - [ ] Help lists no environment or host group.
Compat: —
Decision: default cut: saved environments, pairing codes, SSH hosts and paired clients belong to
  area 18. Revive via DECISIONS.md.
Source: D-20-050

### CLI-051 · kolux project host setups
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: lists, creates, updates or deletes a project's host setups, or sets a project up on
  another machine, either from a folder already there or by cloning.
User sees: host setup records for each project.
Rules: relative paths are refused for remote and SSH targets; `--project` with `--host` aimed
  worktree create and automations at a setup.
Acceptance:
  - [ ] The project group offers list only.
  - [ ] worktree create and the automations commands accept no host-setup targeting.
Compat: —
Decision: default cut: host setups (table 1b, per-repo pages). Revive via DECISIONS.md.
Source: D-20-051

### CLI-052 · kolux inside WSL distros
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: uses kolux from a WSL shell after Kolux has registered a launcher inside the distro.
User sees: kolux commands typed in WSL reach the Windows app.
Rules: registrations are reconciled distro by distro, one at a time, and Windows paths are
  translated into distro paths.
Acceptance:
  - [ ] Kolux registers no launcher inside any WSL distro.
  - [ ] The CLI section in Settings offers no WSL registration.
Compat: —
Decision: default cut: WSL execution belongs to area 18. Revive via DECISIONS.md.
Source: D-20-052

### CLI-053 · kolux vm recipe doctor
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: checks an ephemeral VM recipe or does a trial provisioning of one.
User sees: findings about the recipe, or the whole transcript when provisioning fails.
Rules: runs on this machine without the app, and warns when the recipe has no cleanup step.
Acceptance:
  - [ ] `kolux vm` is reported as an unknown command.
  - [ ] Help lists no vm group.
Compat: —
Decision: default cut: ephemeral VM recipes belong to area 18. Revive via DECISIONS.md.
Source: D-20-053

### CLI-054 · kolux emulator
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: drives the mobile emulator pane: gestures, logs and the like.
User sees: emulator actions and their output.
Rules: gesture points must be given as normalised coordinates.
Acceptance:
  - [ ] `kolux emulator` is reported as an unknown command.
  - [ ] Help lists no emulator group.
Compat: —
Decision: default cut: the iOS and Android emulator pane belongs to area 18. Revive via
  DECISIONS.md.
Source: D-20-054

### CLI-055 · kolux computer: controlling desktop apps
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: lists desktop apps and windows, reads an app's state, and clicks, types or presses keys
  in desktop apps.
User sees: the result of each action, with screenshots and follow-up commands.
Rules: actions can be aimed at one particular window, and permission setup is offered when it is
  missing.
Acceptance:
  - [ ] `kolux computer` is reported as an unknown command.
  - [ ] The agent-context document lists no computer commands.
Compat: —
Decision: default cut: computer use (table 1b). Revive via DECISIONS.md.
Source: D-20-055

### CLI-056 · kolux linear, and Linear issue links on worktrees
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: reads and edits Linear issues from the CLI, or links a Linear issue while creating or
  editing a worktree.
User sees: Linear issue data; the worktree shows its linked Linear issue.
Rules: the Linear-issue flag took an identifier or a link, null cleared it on worktree set, and bad
  values were refused before the app was contacted.
Acceptance:
  - [ ] `kolux linear` is reported as an unknown command.
  - [ ] worktree create and worktree set take no Linear-issue flag, while `--issue` for GitHub
        stays.
Compat: —
Decision: default cut: the Linear integration (table 1b). Revive via DECISIONS.md.
Source: D-20-056

## Dropped by default (tier D)

- CLI-049 · kolux serve: headless server — headless serving and the web client belong to area 18.
- CLI-050 · Remote targeting: pairing codes, environments, hosts and opening links on a paired
  client — saved environments, pairing codes, SSH hosts and paired clients belong to area 18.
- CLI-051 · kolux project host setups — host setups (table 1b, per-repo pages).
- CLI-052 · kolux inside WSL distros — WSL execution belongs to area 18.
- CLI-053 · kolux vm recipe doctor — ephemeral VM recipes belong to area 18.
- CLI-054 · kolux emulator — the iOS and Android emulator pane belongs to area 18.
- CLI-055 · kolux computer: controlling desktop apps — computer use (table 1b).
- CLI-056 · kolux linear, and Linear issue links on worktrees — the Linear integration (table 1b).

## Hidden or retired (tier H)

- CLI-048 · Retired orchestration coordinator-start and coordinator-stop · already retired when the
  history begins (2026-09-10); exact date unknown · default skip
