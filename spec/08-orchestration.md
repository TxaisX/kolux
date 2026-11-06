# 08 · Orchestration

Orchestration lets one agent act as a coordinator for other agents from inside its own terminal,
through the `kolux orchestration` command group. The coordinator opens a Run (a named space for one
objective, with its own mailbox), splits the work into tasks that can wait on each other, and hands
tasks to workers: agent terminals that already exist, or new agents that Kolux starts in fresh
worktrees. Agents talk through typed mail that Kolux keeps until it is read and, when the recipient
is idle, announces by typing a one-line pointer into its pane. Decision gates and questions let work
pause for an answer. Workers can be watched, read, stopped, abandoned, kept or released, and neither
they nor their mail are lost across restarts. A worker's model follows four work tiers mapped per
provider. `kolux worktree ps` gives a one-screen summary across worktrees, and `kolux claude-teams`
starts Claude Code's Agent Teams inside Kolux. The orchestration settings page is cut, so its knobs
become fixed defaults and flags; a read-only Runs view exists only behind an experimental flag that
ships off; workers on remote hosts go with area 18.

Tier counts: P0 17 · P1 31 · P2 10 · H 5 · X 0 · D 4
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 09 Automations · 11 Git, source control & review · 12 Editor & files · 13 Browser pane & computer use · 14 Native chat · 15 Skills, plugins & starter kits · 17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations · 20 The `kolux` CLI · 21 Retired, hidden, removed and dev-only

## Cards

### ORCH-016 · One command starts a worker agent in a worktree of its own
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: from a coordinator agent, runs `kolux orchestration worker-start` with a task (or the
  text of a new one) and an agent, optionally choosing a tier, a model or where the worker is
  placed.
User sees: a new agent terminal opens as a background tab, by default in a freshly made worktree;
  the agent receives its brief, and the command returns only once the worker is ready.
Rules: exactly one of an existing task or a new task text is given, and the text form creates the
  task; placement is the coordinator's current worktree, an existing worktree picked by any usual
  selector (identity, id, name, branch, issue number or path), a new child worktree, or a new
  top-level one; a new worktree is the default and is made agent-first; options that shape a new
  worktree (repo, base branch, name, display name, comment) are turned away when the placement is
  the current or an existing worktree; a new worktree runs its setup by default and the setup option
  can skip or inherit it; current or existing worktrees never run setup again; whether the agent
  begins while setup runs alongside it or waits for setup to finish follows the user's own
  preference for new agent tabs, with no option of its own; the worker always runs the coordinator's
  own agent provider, and naming a different agent is turned away; an existing Kolux terminal can be
  reused (with its worktree named) instead of opening a fresh one; that cannot be combined with a
  model, effort or tier, and the reused terminal must run the coordinator's own agent; exactly one
  prompt turn is submitted: a swallowed Enter stays queued instead of the brief being typed again,
  and output left over from an earlier busy turn is not counted toward the new prompt; coming back
  to the workspace shows the one existing background worker tab, never a duplicate; a repo with no
  setup script reports setup as not configured and the start still succeeds; a timeout caps how long
  the command waits for readiness; the receipt lists every terminal it touched with its role
  (worker, setup, or a tab the user configured), naming the actual setup terminal rather than
  guessing from tab titles.
Acceptance:
  - [x] `kolux orchestration worker-start --spec "add a test" --agent claude` → exit 0, a ready
      status in JSON, and a new worktree plus a background tab exist. (cards live; evidence/cards-ORCH-016.txt)
  - [x] `kolux orchestration worker-start --worktree current --base-branch main` → turned away
      before anything is created. (cards; evidence/cards-ORCH-016.txt)
  - [x] Leave the workspace and come back → still exactly one worker tab. (cards live; evidence/cards-ORCH-016.txt)
Compat: `kolux orchestration worker-start (--task <id>|--spec <text>) [--worktree current|<selector>|new-child|new-top-level] (--agent <agent>|--terminal <handle>|--tier major|deep|build|light) [--model <m>] [--effort <e>] [--name <n>] [--repo <r>] [--base-branch <b>] [--display-name <d>] [--comment <c>] [--setup run|skip|inherit] [--retry-of <dispatch>] [--timeout-ms <ms>] [--json]`.
Source: D-08-016

### ORCH-007 · An idle agent gets a one-line pointer typed in when mail arrives
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: leaves a coordinator or worker sitting idle while another agent writes to it.
User sees: Kolux types a short line into the idle pane saying how many orchestration messages are
  waiting and which check command will read them, then submits it so the agent wakes up.
Rules: the line gives the count and the exact check command, adding the Run when the pane is tied to
  one; while the agent is busy the mail is held, and the line is typed only once it goes idle; if
  the pane already has a live waiting check, nothing is typed and the waiter receives the mail; a
  pane parked asleep gets one line, not one per message; Enter follows the line, except in Cursor
  panes, where pressing it is left to the user; once a pane has moved to a different Run, mail for
  the old Run is never pointed into it; nothing is written into a pane whose terminal has
  disappeared, so text never lands in a dead or replaced pane; if the agent reads its mail before
  the line goes out, the pending line is dropped; a second arrival notice during the pause before
  Enter never types the line twice; if some other writer, such as a chat view of the same session,
  takes the pane during that pause, the line's Enter is held back; when nobody owns the pane the
  line is written as usual; for mail sent straight to a worker's own handle outside any dispatch,
  the line tells it to run a plain check of its own mailbox with no Run named; while a chat view is
  handing the pane back to the terminal, or the chat session has no attachment on this computer, the
  line waits instead of landing in the wrong place.
Acceptance:
  - [x] Coordinator idle, a worker sends to run:<id> → within a few seconds the coordinator pane
      shows the line and the agent runs check. (cards live; evidence/cards-ORCH-007.txt)
  - [x] Coordinator in the middle of a turn → no line until the turn ends. (cards; evidence/cards-ORCH-007.txt)
  - [x] Coordinator blocked in a waiting check → nothing typed; the wait returns the message. (cards; evidence/cards-ORCH-007.txt)
Compat: —
Source: D-08-007

### ORCH-015 · Workers report done and send heartbeats
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: a worker sends a done report with an outcome of succeeded or failed, or sends a
  heartbeat.
User sees: the done report, with its outcome, the files touched and a report path, lands in the
  coordinator's Run mailbox and the task status follows it; heartbeats keep the worker counted as
  alive.
Rules: a done report has to carry an outcome; a heartbeat that arrives after the worker's dispatch
  has ended is ignored instead of bringing the worker back to life; heartbeats and done reports are
  threaded per dispatch; once the worker's own completion is accepted, a replayed or foreign report
  cannot overwrite it, and no marker the caller supplies can turn a rejection into success; a done
  report sent from any terminal other than the worker's own (the coordinator writing one on its
  behalf, say) is delivered as mail but neither completes the task nor frees tasks that wait on it;
  done reports and heartbeats from a worker started with worker-start must include its dispatch pass
  (see ORCH-067)
Acceptance:
  - [x] A worker sends a succeeded done report listing one changed file → the coordinator's check
      shows it and task-list shows the task completed. (cards; evidence/cards-ORCH-015.txt)
  - [x] A heartbeat arrives after the worker was stopped → the worker's state does not change. (cards; evidence/cards-ORCH-015.txt)
  - [x] The coordinator sends a done report on the worker's behalf → it arrives as mail, but the
      task stays dispatched. (cards; evidence/cards-ORCH-015.txt)
Compat: `kolux orchestration send --type worker_done --outcome succeeded|failed [--files-modified <list>] [--report-path <path>]`
  and `kolux orchestration send --type heartbeat`.
Source: D-08-015

### ORCH-020 · See a worker's live state, including when it waits on a person
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs `kolux orchestration worker-show --dispatch <id>`.
User sees: status, terminal, liveness, and a waiting-on-a-person field that names any open prompt (a
  permission, a menu or a question) and how it was spotted.
Rules: the waiting evidence comes from a hook, the prompt text on screen, or the title; an explicit
  empty value says Kolux checked and saw no open prompt; a missing field means it could not look;
  during a long tool call the field stays empty rather than guessing; the reading always matches the
  terminal data it was built from; the field clears as soon as the agent is idle or working again;
  whether a worker's latest sign of life is fresh is judged by when Kolux received it, never by a
  time the sender stamped, so a wrong clock cannot make a worker look alive or stale.
Acceptance:
  - [x] A worker reaches a permission prompt → worker-show reports the waiting field with that
      prompt and a source of hook or prompt text. (cards; evidence/cards-ORCH-020.txt)
  - [x] A worker in the middle of a tool call → the waiting field reads "no" (checked, no open
        prompt); it reads "yes" with a prompt, and "unknown" when Kolux could not look. (Reworded per
        Txais 2026-10-28 decisions file, A.) (cards; evidence/cards-ORCH-020.txt)
Compat: `kolux orchestration worker-show --dispatch <id> [--json]`.
Source: D-08-020

### ORCH-021 · Read what a worker has written, from its transcript or its terminal
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs worker-read for a dispatch, optionally choosing the source, a cursor and a limit.
User sees: the worker's latest conversation turns, or terminal output labelled as such when no
  transcript exists, plus a cursor to carry on from.
Rules: the automatic source prefers the provider's transcript and falls back to terminal output,
  saying so; transcripts are read for Claude and Codex; Gemini falls back to terminal output; Grok
  goes through its chat decoder; a cursor belongs to the source that produced it; if the source
  changes, the read says so and asks for a fresh start; big reads are capped, and output stays
  readable after the worker is released because it was archived first; terminal output comes back as
  plain text with colours and control codes removed, while accented letters and emoji survive; some
  workers have no terminal at all: the automatic and transcript sources always work, but asking a
  worker without one for terminal output is turned away; a transcript is used only when it provably
  belongs to the worker's own session; for WSL workers a transcript reported from a different Linux
  distribution is ignored; dispatch passes are hidden in every read (see ORCH-067)
Acceptance:
  - [x] Claude worker, worker-read → transcript turns; hand back the returned cursor → only newer
      turns. (cards; evidence/cards-ORCH-021.txt)
  - [x] Gemini worker, automatic source → terminal output, labelled as terminal output. (cards; evidence/cards-ORCH-021.txt)
Compat: `kolux orchestration worker-read --dispatch <id> [--source auto|transcript|terminal] [--cursor <c>] [--limit <n>] [--json]`.
Source: D-08-021

### ORCH-012 · Changing a task's state, with guards that keep tasks and workers in step
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs task-update with a task id, a new state and an optional result.
User sees: the task moves to the new state, or the move is turned away with a reason.
Rules: the states are pending, ready, dispatched, completed, failed and blocked; completing a task
  frees the worker slot it held; a task cannot be marked done underneath a supervised worker that is
  still stopping; task and dispatch changes land together or not at all; simultaneous updates can
  never leave a task dispatched with no worker, or with two; a worker that claims to be finished
  after its process has already died is turned away, and its kept terminal is reconciled instead.
Acceptance:
  - [x] Mark a dispatched task completed → the task is completed and its worker shows as settled. (cards; evidence/cards-ORCH-012.txt)
  - [x] Two updates to one task at the same moment → exactly one wins and the state stays valid. (cards; evidence/cards-ORCH-012.txt)
Compat: `kolux orchestration task-update --id <task> --status pending|ready|dispatched|completed|failed|blocked [--result <text>] [--json]`.
Source: D-08-012

### ORCH-022 · Stop a worker and keep its worktree
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs `kolux orchestration worker-stop --dispatch <id>`.
User sees: the worker's dispatch is fenced and its agent terminal stops, while the worktree, the
  setup terminal and any other tabs remain.
Rules: stopping never deletes the worktree and never closes the setup terminal or tabs the user
  configured; if Kolux has lost touch with the terminal, the process is reported as unverifiable
  rather than exited; if the process ends during its own stop, the worker settles once and cleanly;
  a terminal the user has typed into is left open (see ORCH-036)
Acceptance:
  - [x] Stop a running worker → its agent terminal ends and the worktree folder is still on disk. (cards; evidence/cards-ORCH-022.txt)
  - [x] Cut the daemon connection, then stop the worker → the receipt says unverifiable, not
      stopped. (cards; evidence/cards-ORCH-022.txt)
Compat: `kolux orchestration worker-stop --dispatch <id> [--json]`.
Source: D-08-022

### ORCH-001 · A coordinator opens a Run and its terminal becomes the Run's home
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: from inside an agent terminal, runs `kolux orchestration run-create --objective <text>`.
User sees: the reply carries a new Run id and the calling pane is now tied to that Run, so later
  task, mail and worker commands from the same pane work inside it without naming it.
Rules: a Run is only a namespace with a home mailbox; creating one schedules no work and places no
  workers; tying a pane to a Run needs a pane identity the runtime saw for itself; a caller that
  cannot show a stable pane is turned away instead of being tied to a guess; the reply shows the
  Run, its objective and the binding, and none of the internal routing details; if the pane already
  had a waiting check parked with no Run, creating the Run fences that waiter off so it cannot take
  the new Run's mail; a new Run leaves the caller's nesting depth as it was (see ORCH-032); a retry
  request id makes the create safe to repeat: the same id hands back the first answer instead of
  making a second Run.
Acceptance:
  - [x] In an agent pane, run run-create → the JSON reply holds a Run id, and run-current from that
      pane prints the same id. (cards; evidence/cards-ORCH-001.txt)
  - [x] Run run-create from a plain shell the runtime does not know as a pane → turned away with a
      binding error; no Run exists afterwards. (cards; evidence/cards-ORCH-001.txt)
  - [x] Run run-create twice with the same retry request id → one Run id both times; the number of
      Runs does not change. (cards; evidence/cards-ORCH-001.txt)
Compat: `kolux orchestration run-create --objective <text> [--from <handle>] [--retry-request <id>] [--json]`.
Source: D-08-001

### ORCH-002 · Switch between, inspect and list Runs from the coordinator terminal
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs run-use, run-current, run-list or run-show.
User sees: run-use points the pane at a different Run; run-current names the Run the pane is tied
  to; run-list pages through Runs, newest first; run-show prints the details of one Run.
Rules: changing tasks needs an explicit binding; a pane tied to no Run cannot alter tasks; switching
  with run-use cancels and fences any waiter still parked on the previous Run, and later task
  listings follow the new Run; run-list takes a page size and an opaque cursor for the next page; a
  Run brought over from an older install can only be inspected until someone explicitly takes it
  over (see ORCH-048)
Acceptance:
  - [x] Create two Runs and run-use the first → run-current prints the first, and task-list shows
      only that Run's tasks. (cards; evidence/cards-ORCH-002.txt)
  - [x] run-list with a page size of 1 → one Run and a cursor; handing the cursor back returns the
      next Run. (cards; evidence/cards-ORCH-002.txt)
Compat: `kolux orchestration run-use --id <run> [--from <handle>] [--takeover-legacy] [--retry-request <id>]`,
  `kolux orchestration run-current`, `kolux orchestration run-list [--limit <n>] [--cursor <c>]` and
  `kolux orchestration run-show --id <run>`; each accepts `--json`.
Source: D-08-002

### ORCH-003 · Send typed mail to a Run, a worker, a terminal or a group
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux orchestration send --subject <s>` with an optional recipient, body and
  message kind.
User sees: a receipt with the id of each message stored; the recipient finds the mail with check, or
  gets a pointer typed into its pane once it is idle.
Rules: a recipient is a Run mailbox (run:<id>), a worker (dispatch:<id>), a terminal handle, or a
  group such as @all; the message kinds are status, dispatch, done report, merge ready, escalation,
  handoff, decision gate, question and heartbeat (their typed names are under Compat); priority is
  normal, high or urgent, and the delivered banner marks high and urgent; optional extras are a
  thread id, a JSON payload, a task id, a dispatch id, the files changed, a report path and a phase;
  a done report must say whether it succeeded or failed; done reports and heartbeats can never go to
  a group; a worker inside an active dispatch that names no recipient writes to its Run's mailbox;
  in PowerShell the group token needs quotes ("@all"), otherwise the shell swallows it; routing
  reads only the recipient field, so a task title can never steer a message elsewhere; a retry
  request id makes a resend safe; a handle that could mean the coordinator of more than one Run is
  turned away as ambiguous, and a recipient outside the Run named on the command is turned away as a
  mismatch; Kolux never picks one for the sender; mail to a worker whose dispatch has already
  finished is turned away, the error points at that Run's mailbox instead, and nothing is kept for
  the finished worker.
Acceptance:
  - [x] Send to run:<id> with a subject → a receipt with one message id; check on the coordinator
      returns that message. (cards; evidence/cards-ORCH-003.txt)
  - [x] Send a done report with no outcome → turned away; nothing is stored. (cards; evidence/cards-ORCH-003.txt)
  - [x] Send a heartbeat to @all → turned away. (cards; evidence/cards-ORCH-003.txt)
Compat: `kolux orchestration send --subject <s> [--to run:<id>|dispatch:<id>|<handle>|@<group>] [--body <text>] [--type status|dispatch|worker_done|merge_ready|escalation|handoff|decision_gate|question|heartbeat] [--priority normal|high|urgent] [--thread-id <t>] [--payload <json>] [--task-id <id>] [--dispatch-id <id>] [--outcome succeeded|failed] [--files-modified <list>] [--report-path <path>] [--phase <p>] [--retry-request <id>] [--json]`.
Source: D-08-003

### ORCH-005 · check reads the mailbox oldest batch first and repeats it until acknowledged
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux orchestration check`, perhaps with options to acknowledge, peek, show unread
  or all, filter by kind, or wait.
User sees: the oldest batch of mail not yet acknowledged for the tied Run, in arrival order, with a
  delivery id for acknowledging it.
Rules: without an acknowledgement the next check returns the same batch again; acknowledging its
  delivery id moves past it; peek reads without touching delivery state; unread and all widen what
  is shown; wait blocks until matching mail arrives or the timeout passes, and meanwhile writes a
  JSON keepalive line to standard error roughly every 15 seconds; a kind filter decides which
  message kinds end a wait; a text rendering exists for people at a local terminal; JSON is the form
  for machines; a caller with the authority can read another terminal's or another Run's mail by
  naming it; after run-use moves the pane to another Run, an older waiter is fenced so it cannot
  take the new Run's mail.
Acceptance:
  - [x] Send two messages, then check → both, in order, under one delivery id; check again without
      acknowledging → the same two. (cards; evidence/cards-ORCH-005.txt)
  - [x] Acknowledge that delivery id, then check → nothing. (cards; evidence/cards-ORCH-005.txt)
  - [x] `kolux orchestration check --wait --timeout-ms 40000` with no mail → at least two keepalive
      lines on standard error, then a timeout result. (cards; evidence/cards-ORCH-005.txt)
Compat: `kolux orchestration check [--terminal <handle>] [--run <run>] [--ack <delivery>] [--unread|--peek|--all] [--types <list>] [--format] [--wait] [--timeout-ms <ms>] [--json]`;
  the keepalive lines carry a fixed marker name, plus an older alias, that agent scripts may watch
  for.
Source: D-08-005

### ORCH-006 · Answer a message, and browse recent mail
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs reply with a message id and a body, or inbox with an optional row limit and the full
  option.
User sees: the reply goes back to whoever sent the original, on the same thread; inbox shows this
  terminal's recent mail, shortened unless the full option is given.
Rules: a reply inherits the thread of the message it answers; every delivered message comes with a
  reply command ready to run, so agents never have to build one; inbox only reads; it acknowledges
  nothing.
Acceptance:
  - [x] A worker replies to a coordinator's message → the coordinator's check shows the reply on the
      same thread id. (cards; evidence/cards-ORCH-006.txt)
  - [x] Inbox with a limit of 5 → five rows at most; with the full option the bodies are shown
      whole. (cards; evidence/cards-ORCH-006.txt)
Compat: `kolux orchestration reply --id <message> --body <text>`;
  `kolux orchestration inbox [--limit <n>] [--terminal <handle>] [--full] [--json]`.
Source: D-08-006

### ORCH-010 · Tasks can wait on each other and become ready when their dependencies finish
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux orchestration task-create --spec <text>`, perhaps with dependencies, a title,
  a display name or a parent task.
User sees: a task id; a task without dependencies starts ready, and one with dependencies starts
  pending and turns ready once every dependency has completed.
Rules: dependencies are written as a JSON list naming the tasks waited on; a badly formed value or
  an unknown id is turned away; tasks belong to the tied Run, or to the Run named on the command;
  the title and display name are what lists and escalations show; a parent makes the new task a
  subtask; a task text too big to store safely (several megabytes) is turned away before any task,
  dispatch or terminal is touched.
Acceptance:
  - [x] Create task A, then `kolux orchestration task-create --spec b --deps '["<id of A>"]'` → A is
      ready and B pending; complete A → B turns ready. (cards; evidence/cards-ORCH-010.txt)
  - [x] `kolux orchestration task-create --spec x --deps '["missing"]'` → turned away; no task is
      made. (cards; evidence/cards-ORCH-010.txt)
Compat: `kolux orchestration task-create --spec <text> [--task-title <t>] [--display-name <n>] [--deps <json array>] [--parent <id>] [--run <run>] [--json]`.
Source: D-08-010

### ORCH-011 · List a Run's tasks, filtered or compact
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs task-list, perhaps filtering by status, showing ready tasks only, asking for the
  compact form, or naming a Run.
User sees: the Run's tasks with status, title and dependencies; the compact form squeezes each task
  text onto one short line.
Rules: the compact form folds whitespace and cuts each task text at about 160 characters; ready-only
  shows just the tasks that could be handed out right now; a named Run can be read; with no Run
  named, the caller's own tied Run is used; the shown name falls back from display name to title to
  a shortened task text; a task a worker currently holds shows which worker terminal and dispatch
  have it; finished dispatches are not listed against the task.
Acceptance:
  - [x] Compact listing of a task whose text is 2,000 characters long → one line of about 160
      characters. (cards; evidence/cards-ORCH-011.txt)
  - [x] A task held by a running worker → the listing names that worker's terminal and dispatch;
      once the worker has finished, it no longer does. (cards; evidence/cards-ORCH-011.txt)
Compat: `kolux orchestration task-list [--status <state>] [--ready] [--brief] [--run <run>] [--json]`.
Source: D-08-011

### ORCH-013 · Hand a task to an agent terminal that already exists
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux orchestration dispatch --task <id> --to <handle>`, perhaps with the inject,
  dry-run or return-brief options.
User sees: the task is assigned to that terminal; with inject the task brief is typed into the agent
  as a prompt, and without it only the context is recorded.
Rules: without inject nothing is typed into the target; the dispatch carries context only; a dry run
  reports what would happen and changes nothing; the return-brief option hands back the brief text;
  targets turned away: a terminal not running a recognised agent, a terminal already busy with a
  dispatch, a task still waiting on dependencies, and the coordinator's own pane; refusal messages
  stay fixed and documented so scripts can match on them; a context-only dispatch to the caller
  itself is allowed only inside the nesting budget; dispatch-show prints a task's dispatch context,
  and with the brief option also the brief the worker got; a terminal counts as running a recognised
  agent only after the agent has fully started; part of a startup banner is not enough; a pane title
  alone proves nothing: an agent-like title over a generic wrapper process, or Claude's own
  agent-management screen, does not count as a running agent.
Acceptance:
  - [x] Dispatch a task with inject to an idle Claude pane → the pane receives the brief and starts
      work. (cards live; evidence/cards-ORCH-013.txt)
  - [x] Dispatch to the coordinator's own pane with inject, or once the nesting budget is spent →
        turned away with a reason; a context-only one inside the budget is allowed. (Reworded per
        Txais 2026-10-28 decisions file, A2.) (cards; evidence/cards-ORCH-013.txt)
  - [x] Dispatch with dry-run → the plan is printed and the task is still ready. (cards; evidence/cards-ORCH-013.txt)
Compat: `kolux orchestration dispatch --task <id> --to <handle> [--inject] [--dry-run] [--return-preamble] [--json]`.
Source: D-08-013

### ORCH-014 · A worker's brief tells it how to report, ask and stay in touch
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: dispatches or starts a worker and looks at what it was told.
User sees: ahead of the task text the worker gets the exact command for reporting done, a heartbeat
  instruction, how to put a question to the coordinator, and how often to look for follow-up mail.
Rules: the commands in the brief are tied to the worker's own terminal, and each fits on one line
  that runs in any shell; the worker is asked for a heartbeat roughly every five minutes; questions
  go through Kolux's ask command, not the agent's own built-in question tool; agents that come back
  to a prompt stay idle after reporting done; bare-shell workers exit after reporting; the task
  divider comes last, so the task text is the final thing the agent reads; the command name in the
  brief is kolux, kolux-dev in development builds, or the exact path for WSL workers; when the
  worktree has fallen behind its base, a base-drift section warns the worker; a section on starting
  sub-workers appears only while nesting budget remains; the report, heartbeat and question commands
  include the worker's dispatch pass (see ORCH-067)
Acceptance:
  - [x] `kolux orchestration dispatch-show --task <id> --preamble` → contains a done-report command
      with this dispatch's id and ends with the task text. (cards; evidence/cards-ORCH-014.txt)
  - [x] Start a worker on a worktree two commits behind its base → the brief has the base-drift
      section. (cards; evidence/cards-ORCH-014.txt)
Compat: `kolux orchestration dispatch-show --task <id> [--preamble] [--json]`.
Source: D-08-014

### ORCH-018 · Choose a worker's model by work tier instead of by name
Tier: P0 · Pushed: 11 · State at 0.15.0: live
User does: runs worker-start with a tier of major, deep, build or light.
User sees: the worker starts on the model and effort that tier maps to for the coordinator's own
  provider.
Rules: what each tier is for: major for big system changes, planning and final review; deep for
  planning, review and hard bugs; build for features and refactors; light for mechanical work;
  shipped Claude mapping: major is fable at high effort, deep is opus at high, build is sonnet at
  medium, light is haiku with no effort setting; shipped Codex mapping: major is gpt-5.6-sol at
  high, deep is gpt-5.6-terra at high, build is gpt-5.6-terra at medium, light is gpt-5.6-luna at
  low; a tier the user never changed follows the shipped mapping; per-provider changes live in the
  Model routing section of the Agents settings page; a tier cannot be combined with an explicit
  model, an effort or a reused terminal; a provider with no route for the tier is turned away
  instead of borrowing another provider; if the routing preferences cannot be read, the shipped
  mapping applies instead of failing the start; naming an agent alongside a tier is allowed only
  when it is the coordinator's own agent.
Acceptance:
  - [x] Claude coordinator, `kolux orchestration worker-start --spec x --tier light` → the worker
      runs haiku with no effort setting. (cards; evidence/cards-ORCH-018.txt)
  - [x] `kolux orchestration worker-start --tier deep --model opus` → turned away for mixing
      options. (cards; evidence/cards-ORCH-018.txt)
Compat: `kolux orchestration worker-start --tier major|deep|build|light`; carried-over routing
  preferences map each agent and tier to a model and an optional effort.
Source: D-08-018

### ORCH-026 · List workers by terminal state to see what can be cleaned up
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs worker-list, optionally for one Run or one terminal state, with a page size of 1 to
  100 and a cursor.
User sees: workers with their terminal accounting (active, reclaimable, kept, release pending,
  release unknown, released), shown apart from task status, plus where the scope came from.
Rules: the scope is the named Run, else the tied Run, else every Run, and the output says which;
  pages hold 1 to 100 rows; a cursor from a different Run is rejected; very old dispatch records
  still list, reshaped to the current form.
Acceptance:
  - [ ] `kolux orchestration worker-list --terminal-state reclaimable` → only settled workers not
      yet released.
  - [ ] `kolux orchestration worker-list --limit 101` → turned away.
Compat: `kolux orchestration worker-list [--run <run>] [--terminal-state active|reclaimable|retained|release_pending|release_unknown|released] [--cursor <c>] [--limit 1-100] [--json]`.
Source: D-08-026

### ORCH-037 · Coordinators see which workers need attention
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: reads worker-show or worker-read across a set of workers.
User sees: a worker is flagged when it needs input, needs approval, has failed, was interrupted, or
  has been quiet too long.
Rules: the attention kinds are input, approval, failure, interruption and stale; liveness is worked
  out again whenever the host gives a fresh verdict, so a dead worker never looks healthy; a status
  record left from a pane's earlier process is ignored once the pane runs a new process; only the
  coordinator's own top-level work finishing well is flagged, as a finished item that needs nothing;
  a worker finishing well raises no flag.
Acceptance:
  - [ ] A worker silent past the staleness window → flagged stale.
  - [ ] A worker at a permission prompt → flagged as needing approval.
Compat: —
Source: D-08-037

### ORCH-040 · `kolux worktree ps` sums up orchestration across worktrees
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs `kolux worktree ps`, optionally with a row limit.
User sees: one compact row per worktree with its agents and orchestration state, plus a scope line
  saying what was covered.
Rules: if a repo scan is slow or fails, the last known worktrees are still listed and marked
  degraded; a failed scan is remembered, so repeated polling does not start git again each time;
  repeated polls get one full snapshot, then tiny no-change answers; remote host columns go with
  area 18; the command covers this computer only; a git failure during the scan shows as degraded,
  never as an empty list; a scan that really finds nothing shows as empty; a scan that finds no
  worktrees is remembered too, so polling does not rescan each time.
Acceptance:
  - [ ] `kolux worktree ps --limit 3` → three rows at most and a scope line.
  - [ ] Break one repo → ps still lists its worktrees from the last snapshot, marked degraded.
Compat: `kolux worktree ps [--limit <n>] [--json]`.
Source: D-08-040

### ORCH-056 · Open agent prompts are noticed even with no hook reporting them
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs an agent that stops at an approval menu, a trust screen or a question.
User sees: Kolux marks the agent as waiting, Cursor approval menus that send no hook included.
Rules: waits found in screen text are shown, not just matched internally; the scan cache is cleared
  when a pane's transcript is pruned; a prompt that appears only in restored scrollback does not
  mark the agent as waiting.
Acceptance:
  - [ ] Cursor shows an approval menu → worker-show and the pane status both show waiting.
  - [ ] Restore a pane whose old scrollback holds a prompt → the agent is not marked waiting.
Compat: —
Source: D-08-056

### ORCH-066 · A worker's agent row is named after its task, not its brief
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: starts workers from a coordinator, then looks at the agent rows in the Agents view or on
  the Board.
User sees: each worker's row reads as its task: the display name, else the title, else a one-line
  preview of the task text. The wrapper instructions Kolux puts around the task never appear as the
  row's text.
Rules: label order is display name, then task title, then a short one-line preview of the task text;
  a label counts only while it belongs to the task the worker is on now; one left from an earlier
  task in the same terminal is ignored; before the task details arrive, the preview comes from the
  brief's task section, whether the brief arrived on many lines or folded onto one; text inside a
  task that imitates the brief's task divider cannot change the label; when the brief has no task
  section, the row shows nothing from the wrapper text rather than its boilerplate; sessions that
  are not orchestration workers keep showing their own prompt; generated session titles use the same
  labels, and only for worker briefs.
Acceptance:
  - [ ] Start a worker with the display name Fix login → its row reads Fix login, not the brief.
  - [ ] Start a worker with only a task title → the row shows the title; with neither → a one-line
      preview of the task text.
  - [ ] Dispatch a second task into the same terminal → the first task's label does not linger.
  - [ ] Start an ordinary Claude session and type a prompt → the row shows that prompt.
Compat: —
Source: D-08-066

### ORCH-023 · Abandon a worker's dispatch without touching processes or files
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: runs `kolux orchestration worker-abandon --dispatch <id>`.
User sees: the dispatch is fenced so the worker can no longer report on it; its terminal keeps
  running and the pane stays open.
Rules: no process is killed and nothing on disk changes; dispatches made with the low-level dispatch
  command (not worker-start) can be abandoned or stopped without closing their pane.
Acceptance:
  - [ ] Abandon a worker, then have it send a done report → turned away; its terminal is still
      alive.
  - [ ] Abandon a low-level dispatch → its pane stays open.
Compat: `kolux orchestration worker-abandon --dispatch <id> [--json]`.
Source: D-08-023

### ORCH-032 · Workers cannot spawn further workers past a depth cap
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: a worker tries worker-start or dispatch to bring in another worker.
User sees: at the default cap the attempt is turned away with a message telling the worker to do the
  task itself.
Rules: the default cap is 1: the coordinator plus one level of workers; the cap used to sit on the
  orchestration settings page, which is cut; it becomes a fixed default of 1 that a CLI flag or
  config value can raise, taking only whole numbers of 1 or more; a cap of 2 lets a worker start one
  more level; creating a new Run from inside a worker leaves its depth as it was; stores from
  earlier versions gain the depth record on upgrade without losing anything.
Acceptance:
  - [ ] Default cap; a worker runs worker-start → turned away, telling it to do the work itself.
  - [ ] Cap raised to 2 → the same call works; a third level is turned away.
Compat: Carried-over value: the nested worker depth (default 1), to become a flag or config default.
Source: D-08-032

### ORCH-033 · One Run cannot see or change another Run's work
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: two coordinators each run their own Run on one machine.
User sees: each sees only its own tasks, gates and mail; ids from the other Run read as not found.
Rules: probing another Run's ids gives the same not-found answer as a missing id, so Runs cannot be
  mapped from outside; the sender label on a command is a label, not proof of who is calling;
  authority comes from the pane the runtime observed; a named Run can be read for inspection;
  changes need the binding.
Acceptance:
  - [ ] Coordinator B updates a task from Run A → not found.
  - [ ] Coordinator B lists Run A's tasks by naming it → the list is shown, read-only.
Compat: —
Source: D-08-033

### ORCH-036 · Typing into a worker's terminal takes it over
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: clicks into a worker's tab and types.
User sees: the terminal becomes the user's; a later stop or release leaves it open.
Rules: ownership moves on user input, not on focus alone; release and stop skip a taken-over
  terminal and say so.
Acceptance:
  - [ ] Type into a worker pane, then release the worker → the pane stays open and the receipt notes
      the takeover.
  - [ ] Only click into a worker pane without typing, then release → the pane closes.
Compat: —
Source: D-08-036

### ORCH-067 · Worker report commands carry a secret dispatch pass that output reads hide
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: starts a worker, lets it report back, and reads its output from the coordinator.
User sees: the worker's brief holds ready-made done, heartbeat and question commands that each carry
  a secret pass unique to that dispatch. Reports with the right pass settle the task; when the
  coordinator reads the worker's terminal or transcript, the pass shows only as a redacted
  placeholder plus a warning that something was hidden.
Rules: every worker dispatch gets a fresh pass tied to that worker's pane and its current process; a
  pass from another worker, from an earlier process in the same pane, or from another dispatch is
  turned away; a done report or heartbeat with a missing or wrong pass is still delivered as mail,
  but the task does not change and the reply says the lifecycle update was turned down; a question
  with a missing or wrong pass is turned away before any question is made; the refusal names the
  option that supplies the pass, since the reader is usually an agent that sees only the error; the
  pass appears only inside the brief's ready-made commands, never as a separate data field; every
  way of reading worker output hides the pass: live terminal lines, text typed but not yet submitted
  in the agent's input box, transcripts (prose and tool payloads alike), the archive kept after
  release, and chat-style workers; dispatches made with the low-level dispatch command get no pass;
  they are tied to the pane's process instead, so a replacement process in that pane cannot report
  for them; if a start is marked failed because the prompt looked stuck, the worker keeps its pass,
  so a genuine done report that comes later can still correct the record.
Acceptance:
  - [ ] Start a worker and read its brief → the done, heartbeat and ask commands all carry the same
      pass option.
  - [ ] Send a done report for that dispatch without the pass → the mail arrives, the task stays
      dispatched, and the reply names the missing option.
  - [ ] Ask with a wrong pass → turned away; no question reaches the coordinator's inbox.
  - [ ] Type the pass into the worker's input box without pressing Enter, then read the worker → the
      output shows a redacted placeholder and a warning, never the pass.
  - [ ] Release the worker and read it again → the archived output is still redacted.
Compat: The owner's orchestration skill passes it as `--dispatch-capability` on send and ask; keep
  that option name.
Source: D-08-067

### ORCH-008 · Waiting mail outlives a restart without repeating keystrokes
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits Kolux, or the daemon dies, while mail is waiting for an agent, then opens Kolux
  again.
User sees: the waiting mail is still there; the idle agent gets its pointer once after the restore,
  and no Enter is pressed twice.
Rules: mail not yet delivered is kept across restarts of both the app and the daemon; an Enter that
  might already have gone out before a crash is never sent again; mail meant for a pane that was
  detached follows it to the restored pane instead of being lost.
Acceptance:
  - [ ] Queue mail for an idle pane, kill the app, start it again → exactly one pointer appears and
      check returns the queued mail.
  - [ ] Crash after the pointer text is typed but before its Enter is confirmed, then relaunch →
      Enter is not pressed a second time.
Compat: —
Source: D-08-008

### ORCH-017 · A failed worker start says what happened and how to recover
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs worker-start and something goes wrong: setup fails, the agent never comes up, or
  time runs out.
User sees: exit code 1 and a receipt naming the stage reached, the setup result, the effects already
  made, any leftover terminal or worktree, and the commands to clean up or try again.
Rules: exit 0 means the worker is ready; a failure and an unknown outcome both exit 1; a leftover
  terminal is listed as a leftover, never quietly closed; if the same start is repeated before the
  first has finished, the repeats join the first one; retrying a failed dispatch needs a task and
  does not reuse the old placement.
Acceptance:
  - [ ] Run worker-start where the setup script exits with 1 → exit 1; the receipt names setup as
      the stage, lists the terminal as left over, and offers a stop or release command.
  - [ ] Run the same worker-start twice at once → a single worker is started.
Compat: Worker-start exits 0 when ready and 1 when failed or unknown;
  `kolux orchestration worker-start --retry-of <dispatch> --task <id>`.
Source: D-08-017

### ORCH-024 · Release a finished worker's terminal after saving its output
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs `kolux orchestration worker-release --dispatch <id>` once the worker has settled.
User sees: the worker's own agent terminal closes, and worker-read still returns its output from the
  saved copy.
Rules: only the exact agent terminal the worker owns is closed; setup terminals, reused terminals
  and terminals the user took over all stay; output is archived before the close, WSL workers
  included; releasing twice does no harm and reports that it was already released; only a release
  whose outcome is unknown exits 1, and it can be recovered later; a kept resource whose process has
  already exited can still be released; if Kolux's records show another owner claiming the very same
  terminal, release keeps that terminal open rather than risk closing one that is not the worker's.
Acceptance:
  - [ ] Settle a worker and release it → its tab closes and worker-read still returns text.
  - [ ] Release it again → reported as already released, exit 0.
Compat: `kolux orchestration worker-release --dispatch <id> [--json]`; the result is one of
  released, already released, or release outcome unknown.
Source: D-08-024

### ORCH-025 · Keep a settled worker's terminal open on purpose
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs `kolux orchestration worker-retain --dispatch <id>`.
User sees: the terminal is marked as kept and is not reclaimed; a later release clears the mark and
  closes it.
Rules: keeping is a lasting user exception that survives restarts; worker-list shows kept terminals
  apart from reclaimable ones.
Acceptance:
  - [ ] Keep a worker, restart Kolux → `kolux orchestration worker-list --terminal-state retained`
      still lists it.
  - [ ] Release the kept worker → the mark clears and its tab closes.
Compat: `kolux orchestration worker-retain --dispatch <id> [--json]`.
Source: D-08-025

### ORCH-027 · The coordinator hears when a worker's terminal dies
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: nothing; a worker's agent process exits or crashes in the middle of a task.
User sees: an escalation message arrives in the Run mailbox naming the task by title, so the
  coordinator can retry or reassign it.
Rules: one escalation per worker exit; its subject uses the task title, or the task id when there is
  no title.
Acceptance:
  - [ ] Kill a worker's process → the coordinator's check shows one escalation naming the task
      title.
  - [ ] Kill a worker whose task has no title → the escalation names the task id.
Compat: —
Source: D-08-027

### ORCH-030 · Retrying a command after a timeout never does the work twice
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: adds a retry request id to a command that changes something, or asks about a request
  after a dropped connection.
User sees: a retry carrying the same request id returns the original result; request-show says
  whether that request finished, is still pending, or never arrived.
Rules: receipts are kept across restarts; request-show never changes anything; old finished receipts
  expire and are pruned; if unfinished receipts fill the ledger, new changes are turned away rather
  than losing track; a request turned away before it took effect (a worker start naming a missing
  task, for example) leaves no receipt, so a retry with the same id runs fresh.
Acceptance:
  - [ ] Send twice with the same retry request id → one message is stored and both calls return the
      same id.
  - [ ] `kolux orchestration request-show --request <unknown id>` → absent.
Compat: `--retry-request` on run-create, run-use, send and the other commands that change state;
  `kolux orchestration request-show --request <id> [--json]` answers completed, pending or absent.
Source: D-08-030

### ORCH-034 · The orchestration store is private and upgrades in place
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: upgrades Kolux, or another user on the computer looks in the data folder.
User sees: Runs, tasks and mail carry over after an upgrade, and the files can be read only by the
  user who owns them.
Rules: the database and its companion files are limited to the current user; upgrades run from every
  earlier store version; old question records are upgraded so their thread identity survives.
Acceptance:
  - [ ] Open a store from the oldest shipped version → it upgrades and its tasks list.
  - [ ] Check file permissions after the first launch → only the user has access.
Compat: Carried-over data: Runs, tasks, dispatches, messages, gates and request receipts.
Source: D-08-034

### ORCH-038 · In-flight workers come back inspectable after a restart
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits or crashes Kolux while workers are starting, running or stopping, then opens it
  again.
User sees: workers whose start or stop was cut short show an unknown outcome with recovery steps;
  running workers are re-attached, not started over.
Rules: a start or stop that was interrupted becomes an unknown outcome, never a quiet success;
  workers are picked up again after a restart without being sent their brief again; a worker whose
  terminal is gone is not replaced by a newly spawned one; a worker whose process was replaced while
  settled is recorded as such.
Acceptance:
  - [ ] Kill the app during a worker start → after relaunch worker-show reports an unknown outcome
      with recovery commands.
  - [ ] Restart with a running worker → the same terminal, and no second brief is typed.
Compat: —
Source: D-08-038

### ORCH-039 · Finished worker tabs stay after a restart and do not wake by themselves
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: leaves a finished worker's tab open, restarts Kolux, then clicks the tab.
User sees: the tab is still there, and a background worker that completed is not cold-resumed just
  because its tab was opened.
Rules: settled worker tabs survive a restart whether or not the daemon's session for them survived;
  a completed worker gives up its resume the moment it settles, before it is ever activated; a
  settled worker can be woken at most once by policy, never in a loop.
Acceptance:
  - [ ] Complete a background worker, restart, click its tab → the transcript shows and no new agent
      turn starts.
  - [ ] Restart after the daemon session has gone → the settled worker tab is still listed.
Compat: —
Source: D-08-039

### ORCH-053 · The background daemon starts once and checks it can run terminals
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: launches Kolux, or a second copy tries to start.
User sees: one runtime daemon serves both the app and the command line; a second copy defers to the
  first; a clear error appears if the terminal layer cannot load.
Rules: an instance lock stops two daemons running at once; a native check confirms the terminal
  layer works before serving; headless serve mode goes with area 18; the rebuild serves only the
  local app and command line.
Acceptance:
  - [ ] Start two daemons → the second exits and the first keeps serving.
  - [ ] Make the terminal layer fail to load → a clear error, not a silent hang.
Compat: —
Source: D-08-053

### ORCH-054 · The command line reaches the open app through a local channel
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs any kolux command while Kolux is open.
User sees: commands answer quickly, and long waits such as a waiting check stay connected.
Rules: a local socket or named pipe carries the traffic; long waits use long-polling with
  keepalives; network transports go with area 18; a blocked ask is kept alive with the same
  keepalives as a waiting check, so a long wait for an answer is not cut off.
  (Kolux, T-174-a: the local socket is a loopback TCP port with a token in a connection file in the app data folder (DT-C22);
  a waiting check or ask re-asks every half second and prints a keepalive line every 15 s, so the
  connection is never held long; a pane Kolux opens points `KOLUX_USER_DATA_PATH` at this app's own
  folder so an inherited other-build override cannot send it elsewhere.)
Acceptance:
  - [ ] `kolux orchestration run-current` with the app open → an answer in under a second.
  - [ ] An ask left waiting for several minutes → still connected, and it returns the answer when a
      reply arrives.
Compat: —
Source: D-08-054

### ORCH-055 · Prompts typed into agents land exactly once
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: dispatches with inject, starts a worker, or queues several prompts quickly.
User sees: each prompt is submitted once and in order, even on Windows terminals that need a pause
  before Enter.
Rules: each submission gets a lasting receipt so a retry cannot send it twice; on Windows a short
  pause comes before Enter so the text is not cut off; sixteen queued prompts go through without a
  doubled Enter; a prompt waits until the agent's input box has drawn and settled; a late redraw
  restarts that wait, and Enter is still pressed only once; if the prompt is cancelled while Kolux
  checks that the text arrived, no further Enter is sent; on Windows the pause before Enter grows
  with the prompt's size instead of being one long fixed wait, and Enter is never sent while a large
  paste is still being taken in; if another writer takes the session in the gap between the text and
  Enter, Enter is held back and the send is reported as stale; nothing is pasted while the agent
  shows a permission or approval prompt, even one seen only in its output; the send is turned away
  as blocked, and if such a prompt appears mid-paste, Enter is held back; a working report from the
  agent dated before the send does not count as proof the prompt arrived.
Acceptance:
  - [ ] Queue 16 prompts to one agent → 16 turns, none merged or repeated.
  - [ ] Send a prompt while the agent shows a permission prompt → turned away as blocked, with
      nothing pasted.
Compat: —
Source: D-08-055

### ORCH-058 · Removing a worktree stops its processes first
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: deletes a worktree that still has terminals or workers.
User sees: its processes are stopped before any files go; if a terminal cannot be shown to have
  stopped, deletion asks for an explicit waiver.
Rules: every process belonging to the worktree is killed before deletion; a terminal stop that
  cannot be proven blocks destructive removal unless waived; chat-style sessions in the worktree are
  closed too, forcibly if they do not close on their own, so no child process is orphaned; a stale
  terminal record the daemon no longer knows, with no live process behind it, does not block
  removal; such a stuck workspace is removed without force.
  (Kolux, T-174-a: each shell is ended with everything it started, the pids are polled for up to
  three seconds, and a pid still there refuses the removal as stuck unless `--force`, or the
  Projects panel's force box, waives it; chat-style sessions wait for the chat view task.)
Acceptance:
  - [ ] Delete a worktree with a running worker → the worker stops, then the folder is removed.
  - [ ] Delete a worktree whose only leftover is a stale terminal record → removed without force.
Compat: —
Source: D-08-058

### ORCH-004 · Group addresses fan one message out to several agents
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: sends to @all, @idle, @worktree:<id> or an agent-kind group such as @claude.
User sees: one copy for each matching terminal, all on one shared thread, so the answers gather in a
  single place.
Rules: @all reaches every agent terminal except the sender's own; @idle reaches only agents that are
  idle at that moment; @worktree:<id> reaches the agents in that one worktree; @claude, @codex,
  @cursor and @droid match on the agent the host really detected, ignoring letter case; pane titles
  play no part, and an agent of unknown kind is left out; a group name Kolux does not know, or a
  group that matches nobody, is an error rather than a quiet no-op; questions go to exactly one
  recipient and turn group addresses away; the receipt for a group send lists only the messages it
  made and their ids, never delivery bookkeeping; the sender is never part of its own group send,
  @idle included, even while the sender is idle.
Acceptance:
  - [ ] Three agent panes; send to @all from one → each of the other two gets a copy carrying the
      same thread id.
  - [ ] Rename a Codex pane's title to claude, then send to @claude → that pane gets nothing.
  - [ ] Send to @nobody → an error that names the unknown group.
Compat: Group tokens @all, @idle, @worktree:<id>, @claude, @codex, @cursor and @droid.
Source: D-08-004

### ORCH-009 · Delivered mail reads as a banner with sender, priority and a reply hint
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: reads mail in its text form, or watches an agent receive mail typed into it.
User sees: each message shows its sender (name and handle), a HIGH or URGENT tag when set, its kind,
  subject, body, any payload, a reply command ready to run, and then a dividing line.
Rules: several messages print one after another, each followed by its own divider; messages carried
  over from an older install are marked as read-only replays kept for compatibility or recovery; a
  message from an older install's Run that this terminal has not taken over is tagged read-only and
  offers no acknowledge or reply hint, even when one was supplied.
Acceptance:
  - [ ] Send with urgent priority and a small JSON payload → the banner shows URGENT, a payload line
      and a reply command naming the message id.
  - [ ] Read a message from an older install's Run that nobody has taken over → it carries the
      read-only tag and no reply hint.
Compat: —
Source: D-08-009

### ORCH-019 · Give a worker a model and effort by name
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs worker-start with a model and, optionally, an effort level.
User sees: the worker starts on that model of the coordinator's provider.
Rules: an effort needs a model; neither can be used with a reused terminal; with no tier and no
  model, the worker takes the coordinator's provider and that provider's default model; the provider
  never changes; model names for Claude, Codex and Cursor are accepted.
Acceptance:
  - [ ] worker-start with an effort and no model → turned away.
  - [ ] Codex coordinator, worker-start with the model sonnet → rejected as not a Codex model;
      Claude is never launched.
Compat: `kolux orchestration worker-start --model <name> [--effort <level>]`.
Source: D-08-019

### ORCH-028 · Decision gates hold a task until the coordinator decides
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs gate-create with a task, a question and optional choices, later gate-resolve with a
  resolution, and gate-list.
User sees: the task shows blocked while the gate is open and goes back to ready once it is resolved;
  gate-list shows open, resolved and timed-out gates.
Rules: choices are written as a JSON list of strings; no gate can be opened while a supervised
  worker on that task is active; gates belong to the caller's Run; a gate from another Run reads as
  not found; gate-list can inspect a named Run, and otherwise uses the caller's own Run; a gate is
  stored only if its task can really move to blocked; otherwise nothing is left behind.
Acceptance:
  - [ ] Open a gate on a ready task → the task is blocked; resolve it → the task is ready.
  - [ ] Resolve a gate id that belongs to another Run → not found.
  - [ ] Open a gate with choices written as a plain comma list → turned away as not a JSON array.
Compat: `kolux orchestration gate-create --task <id> --question <text> [--options <json array>]`;
  `kolux orchestration gate-resolve --id <gate> --resolution <text>`;
  `kolux orchestration gate-list [--task <id>] [--status pending|resolved|timeout] [--run <run>] [--json]`.
Source: D-08-028

### ORCH-029 · A worker asks the coordinator a question and waits for the answer
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: a worker runs `kolux orchestration ask --question <text>`, perhaps with choices and a
  timeout.
User sees: the coordinator receives a question message, and the worker's command returns the answer
  once someone replies.
Rules: when the timeout passes, the question stays open; the worker goes back to waiting by resuming
  that message, not by asking again; choices are a comma-separated list; group recipients are turned
  away; the default timeout follows a fixed policy sized for agent turns.
Acceptance:
  - [ ] Ask with a one-second timeout and no reply → returns as still open with a message id; reply,
      then resume that id → the answer comes back.
  - [ ] Ask a group address → turned away; no question is created.
Compat: `kolux orchestration ask (--question <text>|--resume <message>) [--options <list>] [--timeout-ms <ms>] [--json]`.
Source: D-08-029

### ORCH-031 · Reset orchestration state by scope
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux orchestration reset` with the tasks, messages or all scope.
User sees: the chosen state is cleared and the rest is kept.
Rules: the tasks scope clears tasks and workers but keeps Runs and mail; the messages scope clears
  mail but keeps the delivery positions, so nothing gets delivered again; the all scope clears
  everything, archived worker output included; exactly one scope must be given.
Acceptance:
  - [ ] `kolux orchestration reset --tasks` → task-list is empty; run-list and inbox are unchanged.
  - [ ] Reset with no scope, or with two → turned away.
Compat: `kolux orchestration reset (--all|--tasks|--messages) [--json]`.
Source: D-08-031

### ORCH-041 · Start Claude Agent Teams inside a Kolux terminal
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: picks Claude Agent Teams in the agent picker, or runs `kolux claude-teams` with any
  Claude arguments in a Kolux terminal.
User sees: Claude Code starts with Agent Teams turned on; teammates run inside the same session or
  open as real Kolux panes beside the leader.
Rules: it has to run in a Kolux terminal; anywhere else it refuses because there is no pane to
  attach to; the Agent Teams mode preference is off by default, and can be in-process or native
  panes; on Windows and WSL teammates always run in-process; the picker offers it only when both the
  Kolux command line and Claude Code are installed, and hides it on Windows and WSL; extra arguments
  go straight through to Claude; a keybinding command opens a new Agent Teams tab; it ships with no
  key bound.
Acceptance:
  - [ ] On macOS or Linux, in a Kolux pane, `kolux claude-teams` → Claude starts with teams enabled.
  - [ ] On Windows, `kolux claude-teams` → an unsupported message and a non-zero exit.
Compat: `kolux claude-teams [claude arguments]`; carried-over preference: Agent Teams mode (off,
  in-process or native panes).
Source: D-08-041

### ORCH-065 · Every orchestration command speaks JSON for scripts and agents
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: adds `--json` to any orchestration command.
User sees: one structured result, or one structured error, instead of text meant for people, ready
  for an agent to parse.
Rules: in JSON mode errors carry a stable code and message; every command has help.
Acceptance:
  - [ ] `kolux orchestration run-current --json` → a valid JSON object.
  - [ ] A command that is turned away, run with `--json` → a JSON error with a code and a message.
Compat: `--json` on every orchestration subcommand.
Source: D-08-065

### ORCH-042 · Agent Teams teammates open as real side-by-side panes
Tier: P2 · Pushed: 1 · State at 0.15.0: live-unverified
User does: runs Agent Teams in native-panes mode and the leader starts teammates.
User sees: the first teammate opens to the right of the leader, and later ones stack downward in
  that column.
Rules: Kolux plays the part of tmux, so Claude's split requests become Kolux pane splits; a teammate
  cannot respawn the leader pane; when the leader's terminal exits, the whole team is cleared; if no
  usable absolute path to Claude can be found, teammates fall back to running in-process; a restored
  Agent Teams terminal comes back in native-panes mode with a fresh environment; Kolux itself
  answers the tmux commands Agent Teams depends on: version checks, pane splits of a given size,
  format queries (unknown fields come back empty) and sending keys; only commands that launch Claude
  directly are rewritten.
Acceptance:
  - [ ] The leader starts three teammates → one column to the right, with three panes stacked in it.
  - [ ] The leader's terminal exits → every teammate pane closes.
Compat: The stand-in exposes tmux-style environment variables that point at the Kolux pane.
Source: D-08-042

### ORCH-060 · Session tab inventory the command line and agents can read
Tier: P2 · Pushed: 3 · State at 0.15.0: live-unverified
User does: asks the runtime which session tabs exist.
User sees: an authoritative list of tabs with their agents and placement.
Rules: tab lists everywhere are taken from the published inventory and nowhere else.
Acceptance:
  - [ ] Open three tabs → the inventory lists three.
  - [ ] Close one of them → the inventory lists two.
Compat: —
Source: D-08-060

### ORCH-035 · A task that keeps failing is no longer handed out
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: dispatches a task that fails over and over.
User sees: after three failures the task is held back instead of being given out again.
Rules: the breaker trips after three failed dispatches of the same task; dispatching to a terminal
  that already holds a dispatch is turned away.
Acceptance:
  - [ ] Fail the same task three times → the next dispatch of it is turned away.
  - [ ] Dispatch to a terminal already holding a dispatch → turned away.
Compat: —
Source: D-08-035

### ORCH-057 · Many viewers follow one terminal without drifting apart
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: has a terminal open while both the command line and the app read it.
User sees: every viewer gets the same output, and a slow viewer catches up from a snapshot instead
  of breaking.
Rules: when acknowledgements overflow, the viewer recovers from a fresh snapshot; terminal
  capability queries are answered on the app's behalf, with a Windows-specific answer; dark-or-light
  queries from programs in the terminal are answered from the brightness of the terminal palette,
  not from the app's light or dark mode; for a hidden Grok terminal the terminal-version answer is
  held back, while its other query answers still go out; when a watched terminal ends and Kolux
  cannot confirm how, viewers are told the outcome is unverifiable rather than that it exited.
Acceptance:
  - [ ] Pause one viewer, flood output, resume it → it resyncs from a snapshot.
  - [ ] A program asks whether the terminal is dark while the app is light but the palette is dark →
      it is told dark.
Compat: —
Source: D-08-057

### ORCH-059 · Closing a terminal retires it everywhere
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: closes a terminal tab or pane.
User sees: the terminal disappears everywhere it was shown; a handle opened again later is a new
  terminal, not the old one.
Rules: handle continuity is tracked per incarnation.
Acceptance:
  - [ ] Close a pane → it disappears from every window and list.
  - [ ] Reopen a terminal under the same handle → it is treated as a new terminal with none of the
      old one's state.
Compat: —
Source: D-08-059

### ORCH-043 · Kolux checks whether each agent has the orchestration skill
Tier: P2 · Pushed: 11 · State at 0.15.0: live-unverified
User does: looks at which agents know how to use Kolux orchestration.
User sees: each agent is marked covered when a global install of the orchestration skill is found
  for it.
Rules: an install in the shared cross-agent skills folder in the home directory covers the agents
  that read that folder; Claude counts as covered from its own home skills folder or an enabled
  plugin, and Codex from its plugin cache; installs inside a repo do not count; the install and
  update button and the coverage list sat on the orchestration settings page, which is cut; the
  check moves to the skills surface or a CLI; agent-specific home skill folders count too (Codex's
  own, for example), and Windows-style paths are recognised the same way as Unix-style ones.
Acceptance:
  - [ ] Install the skill only in a repo folder → the agent shows as not covered.
  - [ ] Install it in Claude's home skills folder → Claude shows as covered.
Compat: —
Source: D-08-043

### ORCH-061 · Runtime browser commands for agents
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: an agent drives the built-in browser through the runtime.
User sees: pages open in the right host, screencasts stream, and page leases are tracked and
  released.
Rules: one host lease at a time owns where a page is placed.
Acceptance:
  - [ ] An agent opens a page → it appears in the Kolux browser and closes when released.
  - [ ] Two agents ask for the same page placement → only one holds it at a time.
Compat: —
Source: D-08-061

### ORCH-062 · Runtime file commands for agents
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: an agent or the app reads, renames or lists files through the runtime.
User sees: file operations stay within the worktree's authority.
Rules: a rename checks authority over both the old and the new path; renaming to a name that differs
  only in letter case is allowed.
Acceptance:
  - [ ] Rename inside the worktree → succeeds; rename to a place outside it → turned away.
  - [ ] Rename a file to the same name in different letter case → succeeds.
Compat: —
Source: D-08-062

### ORCH-063 · Runtime git and GitHub calls
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: the app or an agent asks the runtime for git or GitHub data.
User sees: branch, pull request and review data for the right worktree.
Rules: git targets resolve to the worktree's own host.
Acceptance:
  - [ ] Ask for the pull request of a worktree's branch → the matching pull request comes back.
  - [ ] Ask for a worktree's branch → it matches what git reports in that folder.
Compat: —
Source: D-08-063

### ORCH-064 · Runtime calls for past sessions and automations
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: the app lists past agent sessions or automations through the runtime.
User sees: session lists with titles, and automations limited to their owner.
Rules: session lists are cached and shared between callers; automation lists check the owner first.
Acceptance:
  - [ ] List sessions twice → the second answer comes from the cache with the same content.
  - [ ] List automations as a different owner → none of another owner's automations appear.
Compat: —
Source: D-08-064

### ORCH-045 · Read-only Runs view in the agent dashboard
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: turns on the experimental agent dashboard and opens its Runs tab.
User sees: a list of Runs and their tasks with refresh and paging, and a detail pane that only
  reads; nothing can be created or routed from it.
Rules: creating and routing work stays on the command line; it is hidden while the dashboard flag is
  off, which is how it ships.
Acceptance:
  - [ ] Flag on, open the dashboard's Runs tab → existing Runs are listed, and refresh picks up a
      new one.
  - [ ] Flag off → no Runs tab anywhere.
Compat: —
Decision: H: default skip.
Source: D-08-045

### ORCH-048 · Taking over a coordinator Run left by an older Kolux
Tier: H · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs run-use on an old Run with the take-over option, in the live coordinator terminal.
User sees: the old Run becomes this terminal's Run, keeping its worker assignments and mail targets;
  until then it can only be inspected.
Rules: only the coordinator agent terminal that is live right now can do it; two takeovers racing
  each other end with one winner; old-style questions and gates keep working after takeover; a Run
  already adopted can be bound without the take-over option when the runtime already holds
  authority; recovering an old worker reveals its existing tab without stealing focus; before
  takeover, acknowledging or replying to an older Run's mail is turned away and changes nothing: the
  mail stays unread and no reply is made.
Acceptance:
  - [ ] Two terminals take over the same old Run at once → exactly one succeeds.
  - [ ] Reply to an older Run's mail before takeover → turned away; the mail stays unread.
Compat: `kolux orchestration run-use --id <run> --takeover-legacy`.
Decision: H: default skip.
Source: D-08-048

### ORCH-046 · Retired coordinator-start and coordinator-stop commands
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-09-10
User does: runs `kolux orchestration coordinator-start` (also reachable as
  `kolux orchestration run`) or `kolux orchestration coordinator-stop` (also
  `kolux orchestration run-stop`).
User sees: nothing happens; the reply points to the orchestration skill guide for the current way of
  working.
Rules: both commands have no effect; the recovery hint names
  `kolux skills get orchestration --full`.
Acceptance:
  - [ ] Run coordinator-start → no Run, task or worker is created, and the reply names the skill
      guide.
  - [ ] Run coordinator-stop → no effect, and the same pointer.
Compat: The four retired command names answer with the pointer and nothing else.
Decision: H: default skip.
Source: D-08-046

### ORCH-047 · Retired background coordinator that worked through a task graph on its own
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-09-10
User does: can reach it only through an internal runtime call; no command starts it any more.
User sees: tasks handed out in dependency order under a concurrency limit, with a failure breaker, a
  stale-base guard and triage of escalations.
Rules: one coordinator loop at a time; it refuses to dispatch onto a stale base unless the task
  allows it; drift checks are merged rather than repeated.
Acceptance:
  - [ ] No `kolux` command starts the loop.
  - [ ] Without the loop, tasks move only when a coordinator or a worker changes them.
Compat: —
Decision: H: default skip.
Source: D-08-047

### ORCH-049 · Workers as structured chat sessions instead of terminals
Tier: H · Pushed: 11 · State at 0.15.0: hidden
User does: with structured native chat set as the default, starts a worker.
User sees: the worker opens as a chat tab instead of a terminal; groups, the brief, stop, abandon
  and release all handle it.
Rules: it is off by default (the structured native chat flag ships false), so workers start as
  terminal agents; if the host turns down a structured session, a terminal worker starts instead of
  failing; releasing a structured worker retires its chat tab.
Acceptance:
  - [ ] Flag off → worker-start opens a terminal worker.
  - [ ] Flag on, and the host declines to open a structured session → a terminal worker starts and
      the command succeeds.
Compat: —
Decision: H: default skip.
Source: D-08-049

### ORCH-044 · Orchestration settings page
Tier: D · Pushed: 11 · State at 0.15.0: dropped
User does: opened the Orchestration page in Settings.
User sees: a page with the orchestration skill install and update, agent coverage, usage examples, a
  prompt dialog and the nested worker depth control.
Rules: its knobs move elsewhere: the depth cap becomes a default plus a flag (ORCH-032), the skill
  check moves to skills (area 15), and model routing already lives under Agents.
Acceptance:
  - [ ] Settings shows no Orchestration page.
  - [ ] The depth cap and the skill coverage check are still reachable from their new homes.
Compat: —
Decision: default cut: the owner cut the orchestration settings page; its knobs become CLI flags or
  fixed defaults. Revive via DECISIONS.md.
Source: D-08-044

### ORCH-050 · Workers on remote servers
Tier: D · Pushed: 11 · State at 0.15.0: dropped
User does: passed a remote server to worker-start, or asked worker-list to include remote workers.
User sees: workers started and listed on connected remote servers.
Rules: federated start receipts, release ownership and remote stop all belong to area 18; the
  remote-server option on worker-start and the include-remote option on worker-list go with this
  card.
Acceptance:
  - [ ] `kolux orchestration worker-start --help` lists no remote-server option.
  - [ ] `kolux orchestration worker-list --help` lists no include-remote option.
Compat: Retired options: `--on` on worker-start and `--include-remote` on worker-list.
Decision: default cut: remote hosts (area 18) are dropped. Revive via DECISIONS.md.
Source: D-08-050

### ORCH-051 · Remote and mobile runtime connections
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: connected a phone or another computer to the runtime over the network.
User sees: encrypted network sessions, long-poll fallbacks and snapshots of tabs for mobile.
Rules: binding to a network address, end-to-end encryption, heartbeats and mobile gating all go with
  area 18.
Acceptance:
  - [ ] The runtime accepts connections only from this computer.
  - [ ] No mobile pairing appears anywhere.
Compat: —
Decision: default cut: remote hosts and mobile transport (area 18) are dropped. Revive via
  DECISIONS.md.
Source: D-08-051

### ORCH-052 · Linear, Jira and GitLab calls through the runtime
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: let agents read or write Linear, Jira or GitLab issues through Kolux.
User sees: issue look-ups and saves from inside Kolux.
Rules: covered by the owner's cut of tracker integrations other than GitHub.
Acceptance:
  - [ ] No runtime call reaches Linear, Jira or GitLab.
  - [ ] GitHub issue calls still work (area 11).
Compat: —
Decision: default cut: tracker integrations other than GitHub are cut. Revive via DECISIONS.md.
Source: D-08-052

## Dropped by default (tier D)

- ORCH-044 · Orchestration settings page — the owner cut the page; the depth cap becomes a fixed
  default with a flag, the skill coverage check moves to the skills surface, and model routing stays
  under Agents.
- ORCH-050 · Workers on remote servers — area 18 (remote hosts) is dropped; workers run on this
  computer only.
- ORCH-051 · Remote and mobile runtime connections — area 18 is dropped; the runtime serves only the
  local app and command line.
- ORCH-052 · Linear, Jira and GitLab calls through the runtime — table 1b keeps GitHub as the only
  tracker; Linear, Jira and GitLab go.

## Hidden or retired (tier H)

- ORCH-045 · Read-only Runs view in the agent dashboard — hidden behind the experimental agent
  dashboard flag, which ships off; default skip.
- ORCH-048 · Taking over a coordinator Run left by an older Kolux — compatibility path for Runs made
  by an older Kolux; default skip, though an importer may still need to carry old Runs.
- ORCH-046 · Retired coordinator-start and coordinator-stop commands — retired 2026-09-10, the
  commands now only point to the skill guide; default skip.
- ORCH-047 · Retired background coordinator that worked through a task graph on its own — retired
  2026-09-10 with the coordinator commands; default skip.
- ORCH-049 · Workers as structured chat sessions instead of terminals — hidden behind the structured
  native chat flag, which ships off; default skip.
