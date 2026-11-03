# 04 · Agent status, hooks & notifications

Kolux knows what each agent is doing because the agent tools tell it themselves. For fourteen agent
command-line tools Kolux installs and looks after its own hook entries in the tool's settings; MiMo
Code, Pi and OMP report through a small Kolux plugin or extension instead; every other agent is read
from the title it gives its terminal. All of those reports end up in one shared set of states
(working, needs you, stopped with a reason, done, interrupted) that drive the status dots, tab
titles, the Board, the Agents view and the Inbox. Built on top of that: system notifications when an
agent finishes, stops or goes quiet; a notice when a saved sign-in has expired; a tray icon that
gains a dot when something wants the user; a count badge on the dock or taskbar; unread tracking
that clears when a session is looked at; a shortcut that jumps to the next agent waiting on the
user; and Thought rows in the Agents view. Closing an agent ends every process it started. The
Activity feed and terminal attention marks sit behind experimental switches that are off. Hook
delivery from WSL and SSH hosts left with area 18.

Tier counts: P0 13 · P1 41 · P2 4 · H 2 · X 0 · D 2
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes ·
05 Views & navigation · 06 Usage & limits · 07 Accounts, sign-in & keys · 08 Orchestration ·
10 Plan review & protected actions · 11 Git, source control & review · 12 Editor & files ·
14 Native chat · 17 Settings, appearance & input · 18 Remote & hosts (dropped) ·
19 App lifecycle & operations · 20 The `kolux` CLI · 21 H — retired, hidden, removed, dev-only

## Cards

### STAT-001 · Agents report their own status through hooks Kolux looks after
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: starts any supported agent tool in a Kolux terminal, with nothing to set up first.
User sees: the session's dot, its tab and every view move between working, needs you, stopped and
  done as the agent itself announces each step, rather than Kolux guessing from what is on screen.
Rules: Kolux adds its own entries to each agent's per-user hook settings so status works out of the
  box; the hook-driven agents are Claude Code, OpenClaude, Codex, Gemini CLI, Antigravity, Amp,
  Command Code, Cursor Agent, Droid, Kimi, Hermes, Copilot CLI, Grok and Devin, while MiMo Code, Pi
  and OMP report through a Kolux plugin or extension; every report goes to a small listener inside
  Kolux that only accepts callers holding a secret token, and names the pane it came from, so two
  agents sharing one tab are never confused; whatever the agent, its events boil down to four
  states (working, waiting on the user, blocked with a reason, done), with interrupted as a kind of
  done; incoming text is trimmed before Kolux keeps it: tool name to about 60 characters, tool input
  about 160, the agent's reply about 8,000, an interactive prompt about 16,000, agent type 40, model
  name 120, and no more than 32 child agents per report; an ordinary prompt typed over several lines
  is folded onto one line and long orchestration preambles are shortened, while question and plan
  text keeps its line breaks.
Acceptance:
  - [x] Start Claude Code and send a prompt → the pane shows working within about a second, and done
        once the reply ends. (cards live; evidence/cards-STAT-001.txt)
  - [x] Make the agent ask for permission to use a tool → the pane changes to needs you. (cards; evidence/cards-STAT-001.txt)
  - [ ] Repeat with Codex and Gemini CLI on a fresh machine → the same changes, with no manual setup.
Compat: the listener runs on this computer only; each terminal Kolux opens is handed the address,
  token and pane identity the hooks need. The events registered for each agent are on that agent's
  card.
Source: D-04-001

### STAT-007 · Claude Code and OpenClaude status
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: works with Claude Code: sends prompts, approves tools, answers questions, compacts the
  conversation and lets it run subagents.
User sees: the status tracks every turn closely: working while it thinks or uses tools, needs you on
  a permission, a question or a plan, done when the turn is over, stopped with a reason on failure.
Rules: a submitted prompt or any tool event means working; Stop means done, or interrupted when the
  user cut the turn short; the question tool and the leave-plan-mode tool count as waiting even if
  no permission event follows; a pending permission stays shown until that same tool carries on,
  and activity from a different subagent does not clear it; a session start counts as a boundary
  only when it comes from a fresh start, a resume or a clear, and is never a finished task;
  compacting by hand ends as a quiet boundary done, automatic compaction changes nothing, and Kolux
  does not register the before-compact event; if Stop arrives while child agents or background
  shells are still running, the session stays working; OpenClaude gets exactly the same treatment
  in its own settings.
Acceptance:
  - [x] Claude asks a multiple-choice question → needs you; answer it → working again at the next
        tool step. (cards; evidence/cards-STAT-007.txt)
  - [x] Type /compact → the pane settles with no completion notification. (cards; evidence/cards-STAT-007.txt)
  - [x] Let Claude end its reply while a subagent is still going → the pane stays working. (cards; evidence/cards-STAT-007.txt)
Compat: Kolux registers SessionStart, UserPromptSubmit, Stop, StopFailure, SubagentStart,
  SubagentStop, TeammateIdle, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest and
  PostCompact in Claude Code's user settings, and follows Claude Code's config-folder override when
  the user has set one.
Source: D-04-007

### STAT-008 · Codex status, with hook trust handled for the user
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Codex in a pane and approves or answers what it asks.
User sees: working, needs you on approvals and input requests, done with its final reply; nested
  subagents listed with their role and model; Codex never asks the user to trust Kolux's hooks.
Rules: session start and a submitted prompt mean working; Stop means done and brings the last reply
  with it; an input-request tool or a permission request means waiting and shows what the tool wants
  to do; Kolux's hook never answers an approval itself, so Codex still asks the user; Kolux marks
  its own hook entries as trusted using the fingerprints Codex itself computes, keeps a record of
  what it trusted, and never copies system-level trust into the separate Codex settings it keeps for
  its own launches; several launches at once write the trust settings only once; Kolux places its
  entry after the user's entries in Codex's hooks file so their trust positions stay valid; if trust
  cannot be set, that file goes back exactly as it was, or is deleted when Kolux created it; a hooks
  file Kolux cannot read or parse is left alone and Kolux uses its private Codex home instead; the
  user's own Codex hooks and their approvals are copied into that private home and refreshed when
  the originals change, with Kolux's status hook running first, and an approval the user withdraws
  disappears from the copy; trust is granted again whenever Kolux's entry changes, and trust for one
  entry never counts for another.
Acceptance:
  - [ ] Launch Codex in a fresh profile → no hook-trust question, and status updates on the first
        prompt.
  - [x] Codex wants to run a command → needs you, and Codex still offers its own approve and deny. (cards; evidence/cards-STAT-008.txt)
  - [x] Withdraw approval of a personal Codex hook → it no longer runs in sessions Kolux launches. (cards; evidence/cards-STAT-008.txt)
Compat: Codex events: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse,
  SubagentStart, SubagentStop, Stop; trust is recorded in Codex's own TOML settings.
Source: D-04-008

### STAT-026 · Subagents and teammates shown under their lead session
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: lets Claude Code or Codex start subagents or a team of agents.
User sees: the lead session keeps reading working while any child is busy, lists its children with
  role and model, and raises needs you when a child is waiting for permission.
Rules: a child's pending permission clears when that teammate goes idle or when a complete roster no
  longer includes it, never because the lead made unrelated progress; rosters have a size cap, a
  background-task list that arrived cut short is marked as partial (Kolux RS, DT-C6: not built, the
  list carries no such mark), and live children missing from it are kept; each subagent turn is announced at its own Stop with its own text; a teammate going
  idle never ends the lead's working state, even when Kolux holds no stored status for the lead; a
  child already cleared away as gone never comes back as working.
Acceptance:
  - [x] The lead ends its turn while a subagent still works → the lead shows working until the child
        finishes. (cards; evidence/cards-STAT-026.txt)
  - [x] A teammate asks for permission → the lead shows needs you; the teammate goes idle → it
        clears. (cards; evidence/cards-STAT-026.txt)
Compat: —
Source: D-04-026

### STAT-041 · Desktop notification when an agent finishes or needs permission
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: leaves an agent working and turns to something else.
User sees: a system notification when the agent finishes, with the agent's name, a preview of its
  reply and, when several repositories are active, the repository's name; Claude Code permission
  requests raise one as well.
Rules: nothing is sent for session boundaries, replayed events, Cursor Agent shell steps or Grok's
  routine permission prompts; blocked and interrupted turns get their own wording; every subagent
  turn and every background-shell turn is a notification of its own; it works when the agent's
  workspace is not the one on screen; the 'An agent finishes its task or needs permission' switch
  controls it and is on by default.
Acceptance:
  - [x] Codex finishes in a workspace that is not active → exactly one notification with a preview
        of its reply. (cards; evidence/cards-STAT-041.txt)
  - [x] Turn 'An agent finishes its task or needs permission' off → the next finish raises nothing.
        (Reworded per Txais 2026-10-28 decisions file, A2: keep the page wording.)
        (cards; evidence/cards-STAT-041.txt)
Compat: carry over the user's saved on or off choice; default on.
Source: D-04-041

### STAT-045 · Alert when a working agent goes quiet
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: leaves an agent working; it hangs or stalls with nothing printed.
User sees: after the chosen number of minutes with no terminal output, a single notification saying
  the agent has gone silent.
Rules: the default is 10 minutes and 0 switches it off; it fires once per silent spell, any fresh
  output restarts the clock, and leaving the working state cancels it; silence is judged by terminal
  output, not by hook events; rows in the agent dashboard drawer carry a short quiet tag with the
  silent time, such as quiet 12m or quiet 1h (Kolux RS, T-026-a: the alert is built; the tag
  waits for the drawer view and reads `Terminals::silence`).
Acceptance:
  - [x] Set the threshold to 1 minute and stall an agent → one alert after a minute and no more
        until output resumes and stops again. (cards; evidence/cards-STAT-045.txt)
  - [x] Set the threshold to 0 → no quiet alert however long the agent is silent. (cards; evidence/cards-STAT-045.txt)
Compat: carry over the user's saved threshold; default 10.
Source: D-04-045

### STAT-050 · Inbox of what needs you, what is running and what finished today
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: clicks the bell button labelled 'Inbox' in the top bar, then steps through the
  items with the arrow keys.
User sees: three groups: needs you (questions and permissions, newest first), waiting on agent
  (running sessions, plus stale ones that cannot be confirmed) and done today (newest first, 20 at
  most); a detail panel with the changes, branch, host, files changed and line counts, plus buttons
  'Open in Code' and 'Answer in Code'; an all-clear state when nothing needs the user.
Rules: prompts that ask for approval are labelled as permissions and the rest as questions;
  interrupted sessions and anything older than 30 minutes stay out of done today; Up and Down walk
  through needs you, then waiting, then done, and Enter opens the selected item; with nothing
  selected, Down picks the first row and Up the last; movement stops at both ends; if the selected
  item disappears, the selection goes back to the first row; keys pressed on the detail panel's
  buttons are not the list's, so Enter and Space on a button work; a changes read that fails says
  "Could not read the changes" with the reason, never "No files changed"; a 'Show Inbox' shortcut
  exists but has no key by default.
Acceptance:
  - [x] Two agents waiting and one finished → two items under needs you and one under done today. (cards; evidence/cards-STAT-050.txt)
  - [x] Press Down with nothing selected → the first row is selected; Enter → it opens. (cards; evidence/cards-STAT-050.txt)
  - [x] A session finished 40 minutes ago → not listed under done today. (cards; evidence/cards-STAT-050.txt)
Compat: the Inbox is its own top-level view; its keybinding command id view.inbox ships with no key.
  (Kolux RS, T-026-c: built; the buttons read Open / Answer and open the terminal pane until the
  Code view exists, DT-C8; line counts, the host line and stale rows wait for their feeders.)
Source: D-04-050

### STAT-052 · One status vocabulary for every dot, chip and label
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: reads or hovers a session's status dot in a tab, a pane header, the Board or the Agents
  view.
User sees: the same set of states everywhere, each with its own glyph: working (a spinner),
  monitoring background tasks, blocked, waiting for input, needs attention for a permission,
  interrupted, failed, done (a check mark), idle, and no recent update.
Rules: blocked and waiting both use the permission look; the Agents view adds starting and
  cannot-reach labels, and stopped labels say what caused the stop; the working spinner moves 12
  frames a second with every spinner on screen in step, and holds still when the system asks for
  reduced motion; hovering a status indicator explains it after about 200 ms (Kolux RS, T-026-b:
  the vocabulary, glyphs, spinner and hover are built; the background entry lights with T-123,
  no-recent-update with the Inbox or the Agents view, the Agents view's labels with that view).
Acceptance:
  - [x] Take one agent through working, waiting and done → the glyph and its hover text change each
        time. (cards; evidence/cards-STAT-052.txt)
  - [x] Turn on reduced motion in the system → spinners stop moving but still read as working. (cards; evidence/cards-STAT-052.txt)
Compat: —
Source: D-04-052

### STAT-053 · Agent reasoning folds into Thought rows in the Agents view
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: reads an agent's transcript in the Agents view and clicks a 'Thought' row.
User sees: each reasoning message as one collapsed line labelled Thought; a click opens or closes
  it, and the toolbar's expand-all control opens every one.
Rules: the row behaves as a real button, so Enter and Space toggle it; in the new look the Agents
  rail is a card about 268 px wide, otherwise a flat rail about 240 px wide.
Acceptance:
  - [x] Open a session that contains reasoning → its Thought rows start collapsed; press expand-all
        → all open. (cards; evidence/cards-STAT-053.txt)
  - [x] Move keyboard focus to a Thought row and press Space → it opens; press Enter → it closes. (cards live; evidence/cards-STAT-053.txt)
Compat: —
  (Kolux RS, T-027 deferred to T-326: the rows need the transcript reader and the Agents screen.)
Source: D-04-053

### STAT-022 · Stopped state says why an agent halted
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: runs into a usage limit, an expired sign-in or a provider outage partway through a
  session.
User sees: the session reads Stopped with the cause (limit reached, sign in again, or the AI hit an
  error) instead of Done, plus the reset time when the agent gave one; Board chips use the same short
  wording.
Rules: rate-limit failures count as limit; authentication failures, an organisation that is not
  allowed and failed verification count as sign-in; every other or unknown failure counts as a
  provider error; a failure report with no error attached, or one caused by an interrupt, does not
  make the session stopped; the cause and reset time stay attached while the session is blocked and
  are dropped once it later reaches done; Claude Code and Kimi both report this state.
  (Kolux RS, T-039-a: only Claude Code reports it, through its StopFailure hook; Kimi and Codex
  have no failure hook, DT-C13. The reset time is filled by T-039-b from the status line; a
  session boundary also drops the cause. The pane header's tooltip carries the same words.)
Acceptance:
  - [x] Simulate a rate-limit failure → the session shows stopped for the limit with its reset time,
        and no task-complete notification appears. (cards; evidence/cards-STAT-022.txt)
  - [x] Send a new prompt that completes → the stop reason is gone. (cards; evidence/cards-STAT-022.txt)
Compat: —
Source: D-04-022

### STAT-023 · Notification when an agent stops
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: leaves an agent running and switches away, and the agent halts on a limit or a sign-in
  problem.
User sees: one system notification saying the agent stopped and why, with the reset time when known;
  it never reads like a finished task.
Rules: one notification per stop episode, however many failure reports arrive; a normal finish never
  raises it; the 'Agent Stopped' switch controls it and is on by default.
  (Kolux RS, T-039-a: the switch is settings key `notifyOnStopped`; a second report in the episode
  leaves the state as it was, so no second note is raised; 'Agent Task Complete' no longer
  covers a stop.)
Acceptance:
  - [x] Cause two sign-in failures in the same episode → exactly one notification, naming sign-in. (cards; evidence/cards-STAT-023.txt)
  - [x] Let an agent finish normally → no stopped notification. (cards; evidence/cards-STAT-023.txt)
Compat: carry over the user's saved on or off choice; default on.
Source: D-04-023

### STAT-040 · Claude Code's status line feeds usage and context figures
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: runs Claude Code inside Kolux.
User sees: Kolux's usage and context numbers refresh from the figures Claude Code itself produces
  for its status line.
Rules: reports without the right token are refused; reports carrying only the context size stay out
  of the rate-limit figures; this is where the context number in the session usage meter on Board
  cards, tabs and the Agents view comes from.
  (Kolux RS, T-039-b: Kolux's `statusLine` command is a bash line, since Claude Code runs the
  status line through a POSIX shell on Windows too; it saves the report to a temp file, posts it
  through `~/.kolux-rs/agent-hooks/claude-status.cmd` with the hook token and pane identity to
  the endpoint's `/claude-status` route, then runs the status line the user had before Kolux,
  saved once to `claude-status-prev.sh`, from the same file. The report's fields are Claude
  Code's: `context_window.used_percentage` (else `total_input_tokens` over
  `context_window_size`) and `rate_limits[]` with `kind` (five_hour, seven_day, spend_limit),
  `percentUsed` and `resetsAt`. The windows are kept in kv `claudeRateLimits`; a used-up window
  writes when it lifts to kv `claudeUsageLimitResetsAt`, which the Claude card and the next limit
  stop read. The pane header's gauge is the first place the context figure shows; Board cards,
  tabs and the Agents view take it from the same `claude-usage` event when they get a meter.)
Acceptance:
  - [x] Finish a Claude Code turn → the usage pill shows the latest rate-limit figures. (T-039-b, by a posted report)
  - [x] Send a report with a wrong token → it is refused and the figures stay as they were. (T-039-b)
Compat: —
Source: D-04-040

### STAT-046 · Expired sign-in notice in the main window
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: carries on working while one saved account's sign-in has lapsed.
User sees: a notice in the main window, not tucked away in Settings, saying that account must sign
  in again, with a 'Sign in again' button.
Rules: the notice names the account whose sign-in lapsed; the button starts the sign-in flow for
  that account.
  (Kolux RS, T-039-a: a sign-in stop reported by a Claude pane asks Claude Code once whether the
  active account is still signed in, `claude_account_check`, so the notice appears without waiting
  for the next window start.)
Acceptance:
  - [x] Let a saved Claude account's sign-in expire → the notice appears; finish signing in → it
        goes away. (cards; evidence/cards-STAT-046.txt)
  - [x] Two saved accounts, the active one expired → only the active one is named; the notice covers
        the active account only (spec/07 rule). (Reworded per Txais 2026-10-28 decisions file, A.)
        (cards; evidence/cards-STAT-046.txt)
Compat: —
Source: D-04-046

### STAT-039 · The agent's first real work names a new worktree
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: creates a worktree with a placeholder name and starts an agent on a task.
User sees: once the agent begins real work, the branch and the shown name change to a short slug
  taken from the task, and Kolux asks before renaming the folder on disk to match.
Rules: folder renaming can be turned off while branch and name renaming carry on; stray work-item
  markers in the text do not replace the generated name; projects that are plain folders without
  git only get a new title; an earlier rename error clears after a later rename succeeds.
Acceptance:
  - [ ] Start an agent in a fresh worktree → the branch becomes a slug of the task and a
        folder-rename question appears.
  - [ ] Turn folder renaming off → the branch and name still change, the folder does not.
Compat: —
Source: D-04-039

### STAT-055 · Setup and archive scripts for worktrees
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: commits a kolux.yaml to a repository, or sets scripts in local settings, to prepare new
  worktrees and tidy up removed ones.
User sees: Kolux runs the setup script when a worktree is made and the archive script when one is
  removed, taking them from whichever source the repository's policy points to.
Rules: local settings win by default even if kolux.yaml has a command; an older shared-first policy
  means only kolux.yaml is used; setup steps are read from the kolux.yaml inside the worktree being
  created; Windows batch scripts run under the classic command prompt even if the user's shell is Git
  Bash; a partly activated conda environment is not used.
Acceptance:
  - [ ] Create a worktree in a repository with a setup script → the script runs inside the new
        worktree.
  - [ ] Remove that worktree → the archive script runs.
Compat: kolux.yaml at the repository root carries the setup, archive and issue-command scripts; the
  exact entry names are in COMPAT.md 5.6. The per-repository archive script setting goes with the
  repo-hooks cut (OD-14 in DECISIONS.md), so the archive script comes from kolux.yaml only; the
  per-repository setup script stays.
Source: D-04-055

### STAT-002 · Settings switch for agent status hooks
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens Settings → Agents and flips 'Agent status hooks'.
User sees: switched off, Kolux takes its own hook entries out of every agent's settings and stops
  adding them back at launch, and status falls back to reading terminal titles; switched on, the
  entries are put back.
Rules: on by default; only Kolux's own entries are removed and the user's hooks stay; a short line
  under the switch explains that turning it off removes the hooks and stops them being reinstalled.
Acceptance:
  - [ ] Turn it off → Claude Code's settings no longer contain Kolux entries, and relaunching does
        not add them back.
  - [ ] Turn it on again → the entries return and live status resumes on the next prompt.
Compat: carry over the user's saved on or off choice; default on.
Source: D-04-002

### STAT-003 · `kolux agent hooks` commands
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs the agent hooks commands from any shell to check, enable, disable or prepare the
  hooks.
User sees: an install report per agent (installed, partial, not installed, or error with a reason);
  a way to switch the hooks on or off without opening Settings; a Codex preparation command that
  marks the hooks as trusted before Codex is launched.
Rules: every subcommand except the Codex preparation one accepts `--json` for output a script can
  read; partial means some events Kolux manages are missing, or an old Kolux entry remains under an
  event it no longer uses; an agent settings file that cannot be parsed reports an error and is
  never overwritten.
Acceptance:
  - [ ] `kolux agent hooks status --json` → one entry per agent with its install state.
  - [ ] `kolux agent hooks off`, then status → every agent reads not installed.
Compat: `kolux agent hooks status`, `kolux agent hooks on` and `kolux agent hooks off`, each taking
  `--json`, plus `kolux agent hooks prepare-codex`.
Source: D-04-003

### STAT-009 · Gemini CLI status
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Gemini CLI in a pane.
User sees: working while Gemini plans or calls tools, showing the tool's name and input; done when
  its agent turn ends.
Rules: the before-agent event and the before and after tool events mean working, and the
  after-agent event means done; when a tool event has no input field its arguments are shown
  instead; Gemini has no permission event, so its waiting state comes from the terminal title; older
  tool event names sent in the Antigravity-style format are still understood, and leftover Kolux
  entries under them are removed on reinstall.
Acceptance:
  - [ ] Ask Gemini to read a file → the pane names the tool while it runs, then shows done.
  - [ ] Gemini asks for permission → needs you, picked up from its terminal title.
Compat: Gemini events: BeforeAgent, AfterAgent, BeforeTool, AfterTool, plus the older PreToolUse and
  PostToolUse.
Source: D-04-009

### STAT-010 · Antigravity status
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Antigravity in a pane.
User sees: working through invocations and tool calls, needs you when it asks a question or for
  permission, done only once it has gone fully idle.
Rules: a Stop that arrives before Antigravity is fully idle keeps the pane working, and its tool
  hooks stay live afterwards; its ask-a-question and ask-permission tools mean waiting, and Kolux's
  hook replies in a way that still leaves the question to the user; the final reply is taken from
  the transcript; install writes one global hooks bundle plus a script Kolux manages.
Acceptance:
  - [ ] Antigravity asks for permission → needs you; it finishes everything → done.
  - [ ] Antigravity sends Stop while still busy → the pane stays working.
Compat: Antigravity events: PreInvocation, PostInvocation, Stop, PreToolUse, PostToolUse.
Source: D-04-010

### STAT-011 · Amp status through a Kolux plugin
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Amp in a pane and sometimes cancels a turn.
User sees: working while Amp runs, done when it ends, interrupted when the turn was cancelled.
Rules: Amp's session start is ignored; agent start and tool events mean working; agent end means
  done, or interrupted if the turn was cancelled; Kolux installs a system plugin file, never
  replaces a user plugin of the same name, and on removal deletes only its own files; an older Kolux
  plugin that lacks a needed handler reports partial.
Acceptance:
  - [ ] Cancel an Amp turn → interrupted, not done, and no completion notification.
  - [ ] Keep a personal plugin under Kolux's plugin name → install leaves it untouched.
Compat: Amp plugin events: session.start, agent.start, tool.call, tool.result, agent.end.
Source: D-04-011

### STAT-012 · Cursor Agent status
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Cursor Agent in a pane.
User sees: working while it runs, done or interrupted at the end, and no stream of notifications
  from shell or MCP steps.
Rules: prompt submission and tool events mean working, and shell or MCP steps never
  notify; a stop whose status is anything but completed means interrupted; the after-response event
  counts as done only when the status was already done; install follows Cursor's own command layout
  and keeps the user's entries; Cursor's session-start event is left unhooked on purpose because it
  can fire while idle, and its session-end event is understood but not installed.
Acceptance:
  - [ ] Cursor runs several shell commands → no notification until the turn finishes.
  - [ ] Cursor stops with a status other than completed → interrupted.
Compat: Cursor's events, in Cursor's own naming style: before prompt submit, stop, before and after
  tool use, tool-use failure, before shell execution, before MCP execution and after agent response
  (the 8 installed); session start and session end are mapped but not installed (COMPAT.md 3.4).
Source: D-04-012
Amended 2026-10-26 (kolux-87 ruling, SAFE-009, DT-C49): 5 events installed (before prompt submit, stop, after tool use, tool-use failure, after agent response); the 3 permission events stay mapped for older files but are never installed, because Cursor blocks on any answer outside their schema (Cursor's public hooks documentation).

### STAT-013 · Droid status
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Factory's Droid in a pane.
User sees: working during turns, needs you for high-risk or ask-the-user tools and for permission
  prompts, done when idle.
Rules: Droid's session start is ignored because it fires while idle, and so is its subagent stop;
  notification events are judged by their wording: permission prompts mean waiting, idle prompts
  mean done, anything else is ignored; Kolux never infers an interrupt from Ctrl+C for Droid; when
  Factory has hooks switched off globally, install reports partial.
Acceptance:
  - [ ] Droid asks to run a high-risk command → needs you.
  - [ ] Switch hooks off globally in Factory → the install report says partial.
Compat: Droid events: SessionStart, UserPromptSubmit, Stop, SubagentStop, PreToolUse, PostToolUse,
  PermissionRequest, Notification.
Source: D-04-013

### STAT-014 · Command Code status from tool events and its transcript
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Command Code in a pane.
User sees: working while tools run and done at Stop, with the prompt and the last reply taken from
  its transcript.
Rules: only tool start, tool end and Stop are hooked; prompt and reply text are read from the
  transcript, and very long or line-heavy transcripts are read without slowing down; the hook finds
  Kolux even when Command Code strips the token variables; for turns without tools Kolux watches
  Command Code's screen: only after its banner has shown does thinking text mean working (and the
  submitted prompt is captured), and a return to the idle prompt means done; another agent that just
  mentions Command Code never switches this on; a fresh prompt appearing in the transcript
  mid-turn makes Kolux start a new turn, while tool signals within one prompt do not.
Acceptance:
  - [ ] Finish a Command Code turn → done, with the last reply shown.
  - [ ] Ask Command Code something that needs no tools → working while it thinks, done when the
        idle prompt returns.
Compat: Command Code events: PreToolUse, PostToolUse, Stop.
Source: D-04-014

### STAT-015 · Kimi status in a marked block of its settings
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Kimi in a pane.
User sees: working, needs you on questions and permissions, done or interrupted at Stop, and stopped
  with a reason when Kimi hits a limit.
Rules: a rate-limit failure means blocked for the limit, never done, while an ordinary Stop is a
  plain done; install adds one clearly marked block after the user's own settings, reinstalling
  never adds a second block, and removal restores the original; if a hand edit deletes only the
  block's end marker, Kolux still recovers the block; a block written under the product's former
  name is replaced rather than doubled.
Acceptance:
  - [ ] Install then remove Kimi hooks → the settings file is identical byte for byte to before.
  - [ ] Reinstall twice → still exactly one Kolux block.
Compat: Kimi events: UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure,
  PermissionRequest, Stop, StopFailure; the block sits in Kimi's TOML settings.
Source: D-04-015

### STAT-016 · Hermes status through a switched-on plugin
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Hermes in a pane.
User sees: working during model and tool calls, needs you on approval requests, done when a model
  call or the session ends.
Rules: Kolux installs a plugin and switches it on in Hermes's settings, keeping the user's other
  enabled plugins and taking Kolux off the disabled list; a plugin that is present but not switched
  on reports partial; badly formed plugin lists are tidied up; reports are trimmed before sending.
Acceptance:
  - [ ] Hermes asks for approval → needs you; once approved → working.
  - [ ] Disable the Kolux plugin by hand → the install report says partial.
Compat: Hermes hook points used: session start; before and after each model call; before and after
  each tool call; before an approval request and after its answer; session end, finalise and reset.
  The plugin is switched on in Hermes's YAML settings.
Source: D-04-016

### STAT-017 · Copilot CLI status
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs GitHub Copilot CLI in a pane.
User sees: working during turns, needs you when Copilot asks the user something or shows a
  permission or input dialog, done at the end.
Rules: an ask-the-user tool means blocked, with the question shown; an error event means working
  when Copilot can recover, otherwise done; older camel-case event names are still accepted; Kolux
  writes its own user-level hook file in the Copilot home folder, sets that file's version field and
  clears a disable-all switch in that file only; subagent and before-compact events are registered
  but change nothing.
Acceptance:
  - [ ] Copilot asks a question → needs you, with the question text visible.
  - [ ] Copilot hits an error it cannot recover from → done.
Compat: Copilot events, 13 in all: SessionStart, SessionEnd, UserPromptSubmit, PreToolUse,
  PostToolUse, PostToolUseFailure, Copilot's subagent-start event (spelled with a lower-case first
  letter), SubagentStop, PreCompact, Stop, ErrorOccurred, PermissionRequest, Notification; the hook
  file sits in Copilot's home folder, honouring the user's override of that folder.
Source: D-04-017

### STAT-018 · Grok status, with its hook settings removed at quit
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Grok in a pane, quits Kolux, or edits or empties Grok's hook settings by hand.
User sees: Grok's status updates without a flood of notifications; Kolux takes its Grok hook
  settings away when it quits, and respects any hand edit or emptying.
Rules: routine tool-permission notices keep the pane working and never notify; a failed stop and a
  session end both mean done; at quit the Kolux-written settings are removed, within a time limit,
  unless another running Kolux still owns them, and an owner whose machine, boot or profile cannot
  be checked is treated as alive so the settings stay; settings the user emptied are not put back on
  the next launch, but are when the user switches hooks on again; writes are all-or-nothing and
  never overwrite or delete a newer edit by the user; Grok's home-folder override is honoured; a
  session id sent by Grok can never make Kolux read outside Grok's chat-history folder; Grok's other
  notices are judged by their wording: one asking for permission, approval, feedback or an answer
  means needs you, one showing Grok back at its empty input prompt means done, and only the generic
  per-tool permission notice at information level counts as routine; notice text is never kept as
  the prompt, so the card keeps what the user typed, and Grok's own wrapper around a submitted
  prompt is stripped before it is shown, even when the wrapper's closing half is missing.
Acceptance:
  - [ ] Quit Kolux → Grok's Kolux-written hook settings are gone.
  - [ ] Empty them by hand and relaunch → Kolux leaves them empty.
Compat: Grok events: SessionStart, UserPromptSubmit, Stop, StopFailure, SessionEnd, PreToolUse,
  PostToolUse, PostToolUseFailure, Notification; the settings live in a dedicated global hook file
  in Grok's home folder.
Source: D-04-018

### STAT-061 · Grok questions show needs you with the question
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Grok in a pane and gets asked a question by it.
User sees: the pane switches to needs you and the question travels with the status, so views can
  show it as a question card; once the user answers, the pane is back to working and the card is
  gone.
Rules: Grok lets its own ask-the-user tool run without any permission step, so the start of that
  tool is the only signal and on its own means waiting, carrying the question text; the end of that
  same tool means working again and drops the question text; a failure report for the question
  tool, such as a cancelled question, means working and never rebuilds the question card; the
  start of any other tool still means working.
Acceptance:
  - [ ] Grok asks a multiple-choice question → needs you, with the question text visible.
  - [ ] Answer it → working, and the question card is gone.
  - [ ] Cancel the question instead → working, with no question card.
Compat: —
Source: D-04-061

### STAT-019 · Devin status in its commented settings file
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Devin CLI in a pane.
User sees: working during turns, needs you on permission requests, done or interrupted at Stop, and
  a warning when Devin is also set to load Claude Code's settings.
Rules: Devin's session start is ignored; a Stop flagged as a user interruption means interrupted; a
  compaction event means working and session end means done; install keeps comments, layout and
  unrelated keys, and uses the roaming application-data folder on Windows; when Devin's setting
  for loading Claude Code's settings would also pull in Claude Code's hooks, the install detail
  warns about the overlap; Kolux's own Claude Code hook checks whether it is running inside a Devin
  session and, when it is, answers with an empty neutral reply and reports nothing, so a Devin pane
  is never also counted as a Claude Code session; the OpenClaude hook has no such check.
Acceptance:
  - [ ] Install into a settings file that has comments → the comments are still there after install
        and after removal.
  - [ ] Turn on Devin's loading of Claude settings → the hooks report carries the overlap warning.
Compat: Devin events: SessionStart, UserPromptSubmit, Stop, PostCompaction, SessionEnd, PreToolUse,
  PostToolUse, PermissionRequest.
Source: D-04-019

### STAT-020 · MiMo Code status through a plugin in a separate home
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs MiMo Code in a pane.
User sees: working while busy, needs you on permissions and questions, done when idle, without
  Kolux touching MiMo's real settings.
Rules: Kolux copies the user's MiMo settings into a shared separate home folder, installs its status
  plugin there and reuses that folder across launches; busy reports keep the stored user prompt; a
  sub-task the plugin has confirmed stays busy until its own idle arrives, every background sub-task
  running at once is tracked, the final reply is sent before the idle report, and a permission or
  question clears once the user answers it.
Acceptance:
  - [ ] MiMo asks for permission → needs you; it goes idle → done.
  - [ ] Launch MiMo twice → the same separate home is reused and MiMo's real settings are unchanged.
Compat: the plugin reports busy, idle, message-part, permission and ask-the-user events.
Source: D-04-020

### STAT-021 · Pi and OMP status and titles through Kolux extensions
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs Pi or OMP in a pane.
User sees: status updates; needs you while a question or approval dialog is open inside the agent,
  back to done when it closes; the tab title follows the agent.
Rules: opening a generic dialog clears an old question card, and once it closes a session with
  nothing running goes back to done; approval forwarding applies only to OMP, never to a real Pi
  process; when OMP ends its terminal later after a continuation, the turn still settles; a second
  extension feeds the tab title; Kolux never replaces the agent's own working title, which holds
  its session name and folder, only the brand part of it, and an idle compaction never takes over a
  spinner that is already running; the agent's own state marker in its title drives status,
  ordinary titles never do, and a stale working title is cleared; Kolux tells Pi from OMP by how it
  was launched, a pane where OMP runs Pi underneath is treated as OMP, and OMP keeps its own data
  files in the real home folder.
Acceptance:
  - [ ] OMP asks for approval → needs you; approve → working.
  - [ ] Run Pi on its own → no approval forwarding, and the tab title still follows Pi.
Compat: —
Source: D-04-021

### STAT-024 · Monitoring state while background work outlives the turn
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: lets Claude Code start a background shell or a scheduled session task and end its turn.
User sees: the dot shows a yellow activity mark meaning Kolux is watching background tasks, not
  done, until that work stops.
Rules: monitoring begins only after the foreground turn has settled; terminal-title or in-band
  status updates do not end monitoring, only a hook does; when the background work ends the pane
  goes to done; Claude Code's own background task list decides when monitoring is over.
Acceptance:
  - [ ] Claude starts a long background command and ends its reply → monitoring; the command exits
        → done.
  - [ ] The terminal title changes during monitoring → the pane stays monitoring.
Compat: —
Source: D-04-024

### STAT-025 · Status shows the tool in use, the prompt and the last reply
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: glances at a session card, a Board card or an Inbox row while an agent works.
User sees: the tool in use with a short preview of its input (the file path, for edits), the prompt
  that began the turn, and the agent's last reply once it finishes.
Rules: tool output is marked so it is never shown as the agent's reply; some updates, such as
  task-list bookkeeping tools, show no input preview so as not to mislead; agents whose hook reports
  carry no reply text have it read from their transcript; in the last reply, Unicode line and
  paragraph separators become normal line breaks and long stretches of blank lines are cut down.
Acceptance:
  - [ ] The agent edits a file → its card shows the edit tool and the path; on finish → the reply
        preview.
  - [ ] A reply with ten blank lines in a row → shown with the blank run shortened.
Compat: —
Source: D-04-025

### STAT-027 · Waiting rows carry the plan or the question
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: gets a plan to review, or a question, from the agent.
User sees: the waiting status includes the plan or question so views can show it as a card; the card
  goes away once the agent resumes after being answered.
Rules: plans above the size limit are cut and marked as cut; an answered question clears once later
  tool work starts, including questions shaped like permissions; a real permission is never cleared
  just by the keystroke that answers it.
Acceptance:
  - [ ] Claude Code leaves plan mode → the waiting status shows the plan text.
  - [ ] Answer a question → it clears when the next tool step begins.
Compat: —
Source: D-04-027

### STAT-028 · Interrupted turns read interrupted, not done
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: presses Ctrl+C or Escape to halt an agent mid-turn, or cancels inside the agent.
User sees: the session settles as interrupted, with no completion notification, and is left out of
  done today.
Rules: Ctrl+C or Escape while working lets Kolux conclude the turn was interrupted when the agent
  sends no Stop; Kolux draws no such conclusion while a subagent or background shell is still
  working, and never for Droid; hook events that arrive late cannot turn an interrupted turn back to
  working; agents that report their own cancellations (Amp, Cursor Agent, Kimi, Devin, Claude Code)
  are shown as interrupted.
Acceptance:
  - [ ] Press Escape while Claude Code works → interrupted, no notification.
  - [ ] A late tool event arrives after the interrupt → the pane stays interrupted.
Compat: —
Source: D-04-028

### STAT-062 · Late events after a finished Antigravity or Amp turn never bring back working
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: lets Antigravity or Amp finish a turn and looks away.
User sees: the finished pane stays done; a stray event that turns up after the end never flips it
  back to working or leaves a spinner stuck.
Rules: once Antigravity has sent a fully idle Stop for a transcript, any later tool event or
  end-of-invocation event that names the same transcript is discarded, and a Stop sent while it is
  still busy does not count as the end; once Amp has ended a thread, any later tool event for that
  thread is discarded; a fresh Antigravity invocation or a fresh Amp agent start begins a new turn
  and clears that memory; Amp keeps the memory for each thread in a pane separately, so one ended
  thread never silences another.
Acceptance:
  - [ ] Antigravity finishes, then a late tool event for the same transcript arrives → the pane
        stays done.
  - [ ] Amp ends a thread, then a late tool result for it arrives → the pane stays done.
  - [ ] Start a new Antigravity prompt afterwards → working again.
Compat: —
Source: D-04-062

### STAT-029 · Starts, resumes, clears and manual compacts are not finished work
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: starts, resumes or clears an agent session, or compacts it by hand.
User sees: the pane settles quietly: no notification, no unread mark, nothing added to done today.
Rules: a real completion pushed aside by such a boundary is still kept in history and still counted;
  the compacted turn keeps its summary as its label; compacting by hand settles a row stuck on
  working into a quiet done; the compaction's own summariser finishing never settles the pane; a
  compact that starts and is then cancelled leaves the pane as it was; with automatic compaction,
  the turn's own Stop closes it; after a compaction the agent sends a machine-written continuation
  message as though the user had typed it, and for Claude Code, OpenClaude and Kimi a prompt-submit
  event that opens with that message is ignored, so no new turn starts and the card keeps the
  user's last real prompt, while a real prompt that only quotes that wording further in still
  counts.
Acceptance:
  - [ ] Type /clear in Claude Code → no notification and the unread count stays the same.
  - [ ] Start a manual compact and cancel it → the pane looks exactly as before.
Compat: —
Source: D-04-029

### STAT-032 · Status with no update for 30 minutes is marked unverified
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: leaves a session alone for a long time.
User sees: a working row with no news for half an hour changes to a no-recent-update look instead
  of claiming the agent is still busy; the Inbox lists it as unconfirmed while its terminal is open.
Rules: the window is 30 minutes; repeat signals within the same turn do not reset unread counts; the
  next genuine signal brings the row back to life.
Acceptance:
  - [ ] Block an agent's hooks for 31 minutes → its dot shows no recent update.
  - [ ] Let a new hook event arrive → the row is live again.
Compat: —
Source: D-04-032

### STAT-033 · Terminal titles stand in when no hook reports
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs an agent whose hooks are off, missing or not available.
User sees: Kolux still shows working, waiting or done by reading the title the agent gives its
  terminal.
Rules: it understands braille spinners; Gemini CLI's working, idle, permission and timer symbols;
  Claude Code's title prefixes and quarter-circle busy marks; and words such as ready, idle, done,
  working, thinking and running; titles that look like file paths are ignored; every agent gets a
  readable label and noisy titles are reduced to a steady form; a title from something other than
  an agent appearing mid-turn does not end the working state; which agent a title belongs to is
  decided only by marks the agent itself prints (its name in a fixed place, or a vendor marker),
  never by a name inside the task text, a worktree name or a model name alone; conflicting marks of
  the same kind give unknown, and the order of title parts never decides; agents with no hooks of
  their own (Aider, Goose, Cline, Qwen Code, Rovo Dev, Kilocode, Kiro, Charm, Auggie, Codebuff,
  Continue, Mistral Vibe, OpenClaw, Autohand Code, Ante, Trae and Prime Agent) depend on this alone.
Acceptance:
  - [ ] Turn hooks off, run Gemini CLI and trigger a permission → the pane still shows needs you.
  - [ ] Give Claude Code a task whose text mentions Codex → the pane is still identified as Claude
        Code.
Compat: —
Source: D-04-033

### STAT-034 · Status written into terminal output (OSC 9999)
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs a tool or script that prints Kolux's status escape sequence.
User sees: the pane's status changes, and the escape sequence never shows up as text.
Rules: normal output is left alone; the sequence is removed from the terminal stream before it is
  drawn; an in-band update cannot erase details that only hooks provide, such as completion text or
  monitoring, and only a hook clears those; an in-band completion keeps the stored provider session,
  while an in-band new turn drops it.
Acceptance:
  - [ ] Print the OSC 9999 sequence with a working status → the pane shows working and no stray
        characters appear.
  - [ ] Print an in-band done while the pane is monitoring → monitoring stays.
Compat: OSC 9999 is a channel scripts already use; the rebuild accepts the same sequence number so
  they keep working.
Source: D-04-034

### STAT-035 · Tab titles follow status, with optional generated titles
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: watches tabs while agents work, and may turn on 'Auto-generate tab titles' in Settings
  → Agents.
User sees: a tab that said the agent needed action is renamed once the agent is done; with
  generated titles on, tabs get a short name drawn from the task; a name the user typed always wins.
Rules: generated titles are off by default; many generated titles arriving together are applied as
  one batch; with generated titles off, views ignore them and use the prompt or history instead; for
  agents whose own titles do not show state (Codex for ready and action needed, Devin, Pi and OMP)
  Kolux writes its own title from hook status, the agent's name followed by ready or by action
  required, and animates a working spinner unless the agent's own working title already has one or
  holds session details; all of Kolux's spinners advance on one shared beat, decorative frames are
  skipped while the window is hidden but final-state titles always get through, and a pane whose
  terminal is gone leaves the beat.
Acceptance:
  - [ ] An agent finishes after asking for permission → the tab no longer shows the action-needed
        title.
  - [ ] Rename a tab by hand with generated titles on → the typed name stays.
Compat: carry over the user's saved on or off choice for generated titles; default off.
Source: D-04-035

### STAT-042 · Notifications settings page
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens Settings → Notifications to pick which events alert them, and presses the
  'Send Test Notification' button.
User sees: a master switch that greys out everything beneath it; switches for task complete,
  terminal bell, agent stopped and usage alerts; a minutes box for quiet agents; a
  'Suppress While Focused' switch; and a test button that confirms when the system really showed
  the notification, and otherwise points to the system's notification settings.
Rules: defaults are master on, task complete on, terminal bell off, agent stopped on, quiet alert
  at 10 minutes, usage alerts on, suppress while focused on; any value missing from saved settings
  is read as on, and a missing quiet threshold as 10; on macOS and Windows a test that was not shown
  offers 'Open Settings' for the system panel, and on other systems says the platform is not
  supported; usage-alert notifications are held back while their switch is off.
Acceptance:
  - [ ] Turn the master switch off → every control below it is disabled.
  - [ ] Press the test button with system notifications allowed → a confirmation appears.
Compat: carry over every saved choice on this page, including the sound, custom file and volume.
Source: D-04-042

### STAT-044 · Notifications are merged, paced and open the right pane
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs many agents at once, then clicks a notification.
User sees: no bursts of repeats; clicking a notification brings Kolux forward on the pane that
  raised it.
Rules: repeats for one worktree are merged, including a task-complete and a terminal bell for the
  same event; a cooldown spaces out repeats and its memory stays bounded during bursts, while test
  notifications ignore it; nothing is shown while the window has focus if that option is on; each
  agent event gets a fixed notification identity so the same event never appears twice; clicking
  focuses the source pane in the main window.
Acceptance:
  - [ ] Two completions from one worktree inside the cooldown → one notification.
  - [ ] Click a notification → the pane that raised it is focused.
Compat: —
Source: D-04-044

### STAT-047 · Tray icon with an attention dot
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: hides or minimises Kolux while agents work.
User sees: the tray icon gains an amber dot when an agent finishes or a terminal rings its bell; the
  tray menu reopens or quits the app.
Rules: the dot is shown only when the window is minimised or out of sight, never while on screen;
  Windows has a tray icon with Open and Quit, and a left click opens the app; macOS has a template
  menu-bar item with the full menu; Linux has no tray; development builds show a DEV marker in the
  icon and tooltip, kept when the attention version of the icon is swapped in; closing to the tray
  is off by default.
Acceptance:
  - [ ] Minimise Kolux and let an agent finish → the amber dot appears; restore the window → it
        clears.
  - [ ] Let an agent finish with the window visible → no dot.
Compat: carry over the user's saved close-to-tray choice; default off.
Source: D-04-047

### STAT-048 · Dock and taskbar badge counts workspaces with unseen results
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: switches away from Kolux while agents finish.
User sees: the app badge shows how many workspaces have agent results not yet seen, and clears once
  all of them are viewed.
Rules: unread tabs count once, under their workspace; large counts are capped; zero clears the
  badge; a failure to clear it is ignored.
Acceptance:
  - [ ] Two workspaces finish unseen → the badge reads 2; view both → it clears.
  - [ ] Three unread tabs in one workspace → the badge counts 1.
Compat: —
Source: D-04-048

### STAT-049 · Looking at a finished session marks it seen
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens or focuses a pane whose agent finished while they were elsewhere.
User sees: its unread mark, glow and share of the badge clear by themselves; a session the user
  marked unread on purpose stays unread.
Rules: this works for panes in the main grid and in a floating panel; a turn stamped later than the
  local clock is acknowledged exactly once; a focused pane whose status has not arrived yet, as can
  happen at startup, keeps being watched and is acknowledged when its status shows up.
Acceptance:
  - [ ] An agent finishes in a background tab → open the tab → unread clears with no click.
  - [ ] Mark a session unread by hand, then focus it → it stays unread.
Compat: —
Source: D-04-049

### STAT-051 · Shortcut to the next session that needs you
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: presses the 'Next That Needs You' shortcut.
User sees: focus jumps to the next terminal whose agent is waiting on the user, cycling through
  every such session.
Rules: the default key is Mod+J on Windows and Linux, and Mod+Shift+J on macOS.
Acceptance:
  - [ ] Two agents waiting, press the shortcut twice → focus visits both.
  - [ ] On macOS, press Mod+Shift+J with an agent waiting → focus moves to it.
Compat: keep the old keybinding command id for this shortcut so a user's keybindings file still
  works.
Source: D-04-051

### STAT-004 · Hooks go only to agents that are installed and switched on
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: starts Kolux with some agent tools installed and some agents switched off in Settings.
User sees: Kolux changes settings files only for agents it actually finds on the machine, and takes
  its hooks out of agents the user has switched off.
Rules: detection searches the program path once for all agents and also accepts executable
  locations the user set explicitly; if the shell environment cannot be read, the inherited path is
  used and a warning is logged; if detection fails altogether, nothing is installed; startup never
  removes hooks just because an agent was not found, since another Kolux profile may rely on them,
  and refreshes the existing scripts instead; agents switched off in Settings have Kolux's hooks
  removed.
Acceptance:
  - [ ] Only Claude Code installed → only its settings gain Kolux hooks.
  - [ ] Switch Gemini CLI off in Settings → its Kolux hooks are gone after the next sync.
Compat: —
Source: D-04-004

### STAT-005 · Installing hooks never damages the user's own settings
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: keeps personal hooks or custom options in an agent's settings while Kolux manages its
  own entries.
User sees: the user's hooks, unrelated options, comments and layout survive every install and
  removal; only Kolux's own entries are added, refreshed or cleared away.
Rules: Kolux spots its entries by the command or script they run, including the older
  direct-command and argument-list forms, and removes them without touching user hooks nested
  beside them; leftover Kolux entries under events it no longer uses are cleared on reinstall; the
  file's permissions are kept when it is rewritten; the formats covered are plain JSON, JSON with
  comments (Devin), TOML with a marked block (Kimi), YAML plugin lists (Hermes) and plugin files
  (Amp, MiMo Code); a plugin or hook file the user wrote under the same name as Kolux's is never
  overwritten; installs from several Kolux processes at once take a shared lock so their writes
  never interleave, a lock left by a crashed install is cleaned up, and a late release never removes
  a lock another process now holds.
Acceptance:
  - [ ] Add a personal PreToolUse hook to Gemini CLI and reinstall → it is still there, beside
        exactly one Kolux entry.
  - [ ] Remove Kimi hooks → its settings file matches what the user had before installing.
Compat: the rebuild recognises and removes the entries the old app wrote, so an upgrade leaves one
  Kolux entry per event, not two.
Source: D-04-005

### STAT-056 · Repository scripts need the user's trust before running
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: opens a repository whose kolux.yaml defines setup scripts or default tab commands.
User sees: a trust prompt listing exactly what will run, before anything runs; Kolux asks again if
  the scripts change.
Rules: trust is tied to a fingerprint of the script content; if trust cannot be checked, nothing
  runs.
Acceptance:
  - [ ] Change the setup script after trusting it → the prompt comes back.
  - [ ] Trust the scripts, reopen the repository unchanged → no prompt.
Compat: —
Source: D-04-056

### STAT-006 · Hooks stay harmless outside Kolux, finish quickly and catch up after a restart
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs the same agent tool in an ordinary terminal outside Kolux, or quits Kolux while
  agents keep going.
User sees: outside Kolux the hooks do nothing and print nothing; a slow or closed Kolux never holds
  up the agent; events sent while Kolux was closed are applied when it starts again.
Rules: without Kolux's pane identity or address in the environment, a hook exits successfully and
  writes nothing; every Kolux hook entry has a time limit in the agent's settings, and on macOS and
  Linux the delivery step also has a connection limit and an overall limit; events that cannot be
  delivered are added to a holding file one complete record at a time, and broken or partial lines
  are skipped when replaying; on Windows the hooks post through the system's own HTTP command-line
  tool without starting PowerShell, are safe from delayed variable expansion, and clean up quotes or
  trailing backslashes in agent home paths; for agents that strip the token variables, the hook
  reads the address from a file instead; every running Kolux, parallel development builds included,
  publishes its own address record that only the user can read, so an agent never posts to the wrong
  copy, and after a restart the record holds the new address.
Acceptance:
  - [ ] Run Claude Code in a terminal outside Kolux → no output, no errors, and the hook exits with
        code 0.
  - [ ] Quit Kolux mid-turn, let the agent finish, start Kolux again → the pane shows done.
Compat: —
Source: D-04-006

### STAT-030 · Last known status survives a restart until a live event confirms it
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits or restarts Kolux while agents are mid-turn or waiting.
User sees: sessions return showing their last status, marked as not yet confirmed, and update as
  soon as a live event arrives; leftover subagents from before the restart are cleared away.
Rules: saved status has an expiry and a version, and a damaged save is treated as empty; a restored
  row never counts as fresh, however recent, until a matching live reading of the terminal confirms
  it; a restored permission does not block the first live working event; restored child rows with
  no living process are removed so a pane that slept through its finish reaches done, while rows
  whose process might still be alive are kept; saved status replayed at startup waits until its
  pane has loaded; a terminal that cannot be reconnected to status reporting after an upgrade shows
  a blocked row asking the user to restart that terminal.
Acceptance:
  - [ ] Restart Kolux with an agent waiting → it comes back as waiting, unconfirmed; approve in the
        terminal → status updates live.
  - [ ] Damage the saved status → Kolux starts normally with no restored rows.
Compat: —
Source: D-04-030

### STAT-037 · Agents that can be resumed are recorded at quit and sleep
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits Kolux, or puts a workspace to sleep, while agents are mid-task.
User sees: those agents can be resumed later in every workspace; agents that had already finished
  are not offered.
Rules: the record covers every worktree, not just the one on screen; provider session details are
  saved before the sleeping rows are cleared.
Acceptance:
  - [ ] Quit with agents working in two workspaces → both are offered for resume after relaunch.
  - [ ] Quit with one agent done and one working → only the working one is offered.
Compat: —
Source: D-04-037

### STAT-054 · Closing an agent ends every process it started
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: closes a pane or tab running an agent, or kills the agent's terminal.
User sees: the agent and everything it launched, detached processes included, stop; nothing lingers
  in the background or keeps files locked.
Rules: on macOS and Linux the kill reaches detached process groups started under the agent; on
  Windows each exit is checked, processes that merely reused an old parent's number are left alone,
  and stale branches are pruned; ending a tree never kills Kolux's own processes, such as its
  built-in browser; if the system refuses to end the whole tree, the root process Kolux owns is
  still ended.
Acceptance:
  - [ ] Start an agent that launches a detached server, close its pane → the server process is
        gone.
  - [ ] Close an agent's pane while Kolux's built-in browser is open → the browser keeps running.
Compat: —
Source: D-04-054

### STAT-036 · Count of working agents per workspace
Tier: P2 · Pushed: 3 · State at 0.15.0: live-unverified
User does: looks at the sidebar or the workspace cards.
User sees: how many agents are working in each workspace, with split panes counted separately;
  sleeping or never-opened workspaces show as inactive.
Rules: when pane-level titles are not available, the count falls back to live tabs.
Acceptance:
  - [ ] Split one tab and run an agent in each half → the workspace shows two working.
  - [ ] Put a workspace to sleep → it shows as inactive.
Compat: —
Source: D-04-036

### STAT-031 · Agents that are gone stop reporting
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: closes a tab, or the agent process dies while its shell stays open.
User sees: no ghost working or waiting rows hang around for agents that have gone; a pane reused for
  a new agent starts clean.
Rules: a working or waiting row whose process is certainly dead is retired; when the shell outlives
  the agent, its resume identity is kept for later; once a tab is closed, any late events for it are
  ignored until Kolux quits, and other tabs carry on unaffected; a retired pane returns only when a
  genuine new turn begins.
Acceptance:
  - [ ] Kill the agent process while it shows needs you → the row clears.
  - [ ] Close a tab, then let a late hook event arrive → nothing reappears.
Compat: —
Source: D-04-031

### STAT-038 · Pull request status refreshes when an agent finishes
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: lets an agent finish work on a branch that has a pull request.
User sees: the workspace's pull request status refreshes shortly after the agent is done, with no
  manual refresh.
Rules: one refresh per finish, however many done updates arrive; skipped when no status lane or pull
  request view is on screen.
Acceptance:
  - [ ] An agent finishes on a pull request branch with the pull request panel open → its status
        updates.
  - [ ] The same finish reported twice → only one refresh.
Compat: —
Source: D-04-038

### STAT-043 · Notification sound, custom file and volume
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: picks a notification sound or a custom audio file, and sets the volume.
User sees: notifications play the chosen sound at the chosen volume; with nothing custom set, the
  system's default sound plays.
Rules: the choices are the system default, nine short built-in tones and a custom file, which must
  be an allowed audio type; with a custom sound the system notification is muted so only one sound
  plays; the default volume is 100.
Acceptance:
  - [ ] Choose a custom file → the next notification plays it and not the system sound.
  - [ ] Pick a built-in tone → the next notification plays that tone once.
Compat: carry over the user's chosen tone, custom file and volume.
Source: D-04-043

### STAT-057 · Activity feed of agent threads
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: switches on the experimental Activity setting and opens the Activity view.
User sees: a feed of agent threads grouped by status with a scope filter, a search box that
  Cmd/Ctrl+F focuses, unread counts, hover cards on rows with a mark-read action, a
  'Clear completed' action, and agent rows that jump to the matching split pane.
Rules: off by default, and switched off for everyone by a one-time settings change; clearing
  completed removes only finished and interrupted threads; session-boundary dones do not count as
  unread.
Acceptance:
  - [ ] With the experimental switch off → no Activity view can be reached.
  - [ ] If the owner marks it build: Clear completed leaves running and waiting threads in the feed.
Compat: —
Decision: H: default skip
Source: D-04-057

### STAT-058 · Attention marks for background terminals and bells
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: switches on the experimental terminal attention setting.
User sees: background terminals with new output get an unread mark that clears on focus; a bell in
  the focused tab raises a marker that clears on a click or Escape; agent finishes feed these marks
  even when system notifications are off.
Rules: off by default.
Acceptance:
  - [ ] With the experimental switch off → new output in a background terminal leaves no mark.
  - [ ] If the owner marks it build: ring the bell in the focused tab → a marker appears; press
        Escape → it clears.
Compat: —
Decision: H: default skip
Source: D-04-058

### STAT-059 · Hook relay for agents running inside WSL
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: runs an agent inside a WSL distribution from Kolux on Windows.
User sees: the WSL agent's status reaches Kolux through a relay that installs the Kolux hooks in
  the distribution's home folder.
Rules: a failed relay marks that distribution as failed and only tries again after a cooldown.
Acceptance:
  - [ ] Kolux installs no hooks inside any WSL distribution.
  - [ ] No setting or command offers a WSL hook relay.
Compat: —
Decision: default cut: area 18 (remote hosts, SSH and the WSL relay) was dropped by the owner on
  2026-10-05. Revive via DECISIONS.md.
Source: D-04-059

### STAT-060 · Kolux hooks on SSH hosts
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: starts an agent on a remote machine reached over SSH.
User sees: Kolux installs shell-script hooks on the remote machine, Codex trust entries included,
  so remote agents report status.
Rules: remote scripts are always the POSIX kind, even from a Windows computer; panes launched
  over SSH are never cleared by the local check for dead processes.
Acceptance:
  - [ ] Kolux writes no hook files to any remote machine.
  - [ ] `kolux agent hooks status` lists agents on this computer only.
Compat: —
Decision: default cut: area 18 (remote hosts, SSH and the WSL relay) was dropped by the owner on
  2026-10-05. Revive via DECISIONS.md.
Source: D-04-060

## Dropped by default (tier D)

- STAT-059 · Hook relay for agents running inside WSL — area 18 (remote and WSL) dropped by the
  owner on 2026-10-05; status from WSL agents is not relayed.
- STAT-060 · Kolux hooks on SSH hosts — area 18 dropped by the owner on 2026-10-05; hooks are
  installed on this computer only.

## Hidden or retired (tier H)

- STAT-057 · Activity feed of agent threads — experimental switch, off by default and forced off for
  every user; the Inbox took its place; default skip.
- STAT-058 · Attention marks for background terminals and bells — experimental switch, off by
  default; default skip.
