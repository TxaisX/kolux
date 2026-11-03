# 09 · Automations

An automation is a saved prompt plus an agent that Kolux launches by itself, either on a timetable
(every hour, every day, Monday to Friday, once a week, or a custom cron or RRULE line) or when
something happens in a project (a pull request is opened, its checks go red, an agent finishes).
Each automation keeps a numbered history of its runs with the saved output and the usage each one
cost, and a runs dashboard lists every run from every automation in one table. Runs open in
background tabs so they never pull focus away from what the user is doing. The overview shows the
prompt, folding long ones behind an expand control. The whole feature can also be driven from a
terminal through the `kolux automations` command group. Cron jobs belonging to Hermes or OpenClaw
installed on this computer sit in the same list. How the page is reached in the new Agents, Board
and Terminals screens is not settled: at 0.15.0 it opens from an optional sidebar row or the View
menu.

Tier counts: P0 8 · P1 15 · P2 2 · H 0 · X 0 · D 4
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 06 Usage & limits · 07 Accounts, sign-in & keys · 11 Git, source control & review · 17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations · 20 The `kolux` CLI

## Cards

### AUTO-013 · Numbered run history for each automation
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens an automation's Runs tab and selects a run.
User sees: a numbered list giving how each run started, when, and its status; View run opens the
  live terminal if it still exists, or offers Resume workspace; runs whose worktree is gone still
  open from their saved output; failed runs offer Rerun; collapsed rows show how many times they
  occurred and the latest time.
Rules: numbering is per automation, starts at 1 and only goes up; skipped runs, and runs that never
  got a workspace, show their details only; each run stores its worktree's name, so history still
  reads right after the worktree is deleted; Rerun appears only on a failed run of an automation
  that still exists, and a quick rerun result is held as pending for a moment so the user notices
  it; if history fails to load the tab says so and offers a way to recover, never a count of zero;
  Up and Down step through runs and Enter opens one, Down with nothing selected picks the first run,
  and keys pressed with a modifier held or during text composition are ignored; View run opens a
  live terminal only while that terminal still belongs to the run, never a pane that now shows
  something else.
Acceptance:
  - [x] Delete a run's worktree → View run shows the saved output with a note that it is a snapshot. (cards; evidence/cards-AUTO-013.txt)
  - [x] A run fails → Rerun shows; delete the automation → Rerun is gone. (cards; evidence/cards-AUTO-013.txt)
  - [x] Make history fail to load → an error with a recovery action, not an empty list. (cards; evidence/cards-AUTO-013.txt)
Compat: —
Source: D-09-013

### AUTO-012 · Every run ends with a truthful status
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: checks on a run started by the timetable, by an event or by Run Now.
User sees: the run steps through pending, dispatching and dispatched to completed, or stops as
  skipped with a cause (precheck, missed, unavailable, sign-in needed) or as failed to dispatch.
Rules: a finish reported at a session boundary, an old idle state, or a ready prompt already on
  screen at launch never counts as done; if the pane stays in the state it had before launch, the
  run is marked failed rather than completed; when Kolux cannot be sure a run was lost it leaves it
  dispatched, and a genuine finish later still completes it; after a restart, tracked runs
  reconnect, and any that cannot be found are closed after a short settling period; the same refusal
  repeated for the same due time collapses into one entry with a counter.
Acceptance:
  - [x] Kill the agent before it starts working → the run reads failed, not completed. (cards; evidence/cards-AUTO-012.txt)
  - [x] Restart Kolux while a run is still going → tracking continues and the run completes when the
        agent finishes. (cards; evidence/cards-AUTO-012.txt)
  - [x] An every-five-minutes automation whose project is gone for an hour → one collapsed skipped
        entry, not twelve. (cards; evidence/cards-AUTO-012.txt)
Compat: carried-over run history must keep each run's status (the four progress states, the four
  skip causes, and failed to dispatch) and how it was started (timetable, by hand, or event).
Source: D-09-012

### AUTO-001 · Launch an agent with a saved prompt on a timetable
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: makes an automation from a prompt, an agent and a timetable (every hour, every day,
  Monday to Friday, once a week, or a custom cron or RRULE line), with a time of day, a weekday
  where it applies, and a timezone.
User sees: at each due moment Kolux starts the agent with that prompt without being asked, and the
  automation always displays when it will go next.
Rules: the hourly option goes at the chosen minute of every hour, daily at the chosen clock time,
  the weekday option Monday through Friday and never on Saturday or Sunday, and weekly on the picked
  day, with days numbered from Sunday as 0; custom takes a standard five-field cron line or an
  RRULE, and a line that is malformed, can never come true or is too long is rejected when saving; a
  valid but rare date such as 29 February still yields an upcoming run; extra spaces or tabs inside
  a pasted cron line are treated as plain separators; each preset is kept as its cron equivalent,
  and a valid line that matches no preset is labelled custom; the timetable is described in a
  friendly sentence that reads the same whatever the machine's locale, and a stored timetable that
  cannot be parsed falls back to a neutral label while the page keeps working; Kolux looks for due
  automations about once a minute, and the clock never starts a paused automation or one that waits
  for events; upcoming times are worked out in the IANA timezone saved with the automation; in a
  custom line a day field that covers every day (for example */1) counts as no limit, so only the
  other day field narrows the runs, and weekday 7 is read as Sunday.
Acceptance:
  - [x] On a Friday afternoon save a weekday automation at 09:00 → the upcoming run reads Monday
        09:00. (cards; evidence/cards-AUTO-001.txt)
  - [x] Enter a cron line with 61 in the minute field → saving is blocked with a validation message. (cards; evidence/cards-AUTO-001.txt)
  - [x] Save a cron line that only matches 29 February → an upcoming run in the next leap year is
        shown. (cards; evidence/cards-AUTO-001.txt)
  - [x] Pause the automation → nothing launches at its due time; resume it → the following due time
        fires. (cards; evidence/cards-AUTO-001.txt)
Compat: the command line takes the same timetable values (hourly, daily, weekdays, weekly, a
  five-field cron line or an RRULE) through `--trigger` or its alias `--schedule`, with `--time` as
  HH:MM, `--day` from 0 to 6 where Sunday is 0, and `--timezone` taking an IANA zone name.
Source: D-09-001

### AUTO-004 · Event triggers: pull request opened, checks failed, agent finished
Tier: P0 · Pushed: 11 · State at 0.15.0: live
User does: switches the trigger from Schedule to Event and picks one of three happenings: a pull
  request is opened from a workspace branch, a pull request's checks fail, or an agent working in
  that project completes.
User sees: when it happens in the automation's repo a run begins, with a one-line description of the
  happening (and a link when there is one) appended to the prompt; the run carries an event marker
  whose tooltip says which event it was.
Rules: a run starts only for automations that are switched on and whose repo and event type both
  match; the first review state Kolux learns about a branch is treated as a starting point and
  nothing fires until it changes, so opening Kolux never sets off a burst of runs; pull request
  opened fires on the step from no pull request to an open one, drafts included; checks failed fires
  on the step from pending to failing, and checks that stay red do not fire again; agent finished
  counts only an ordinary completion inside a workspace and ignores interrupted ones, completions
  reported at a session boundary, and restored rows that were never confirmed; each distinct event
  launches at most one run per automation, and once an event has started a run the automation
  ignores further events for five minutes; panes opened by an automation run never set off an
  automation, so no automation can trigger itself; the precheck runs ahead of event-started runs
  exactly as it does ahead of timed ones; review events are seen only while Kolux is already polling
  that branch (for instance because its card is on screen or the checks panel is open): a new pull
  request can take up to about 15 minutes to be spotted, a change in checks about a minute, and
  anything that happens while Kolux is shut is missed; the run lands in the workspace configured on
  the automation, not in the worktree where the event came from; going back to Schedule throws away
  the saved event and works out the upcoming run afresh, so an old time is not mistaken for a missed
  one; Hermes jobs never offer Event; automations made before events existed open unchanged and stay
  on their timetable.
Acceptance:
  - [x] Open a draft pull request from a workspace branch → within the detection window exactly one
        run begins and its prompt ends with the event description. (cards; evidence/cards-AUTO-004.txt)
  - [x] Cause the same kind of event twice inside five minutes → a single run. (cards; evidence/cards-AUTO-004.txt)
  - [x] Let an agent that an automation launched complete → no agent-finished automation starts. (cards; evidence/cards-AUTO-004.txt)
  - [x] Restart Kolux while a pull request is already open → no run. (cards; evidence/cards-AUTO-004.txt)
Compat: carried-over automations must keep whether they are timed or event-driven and which of the
  three events each one listens for.
Source: D-09-004

### AUTO-005 · One dialog to create or edit an automation
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: clicks New Automation, or Edit on an existing one, gives it a name, writes the prompt,
  chooses the agent, project and workspace, and saves.
User sees: a dialog with a roomy prompt editor and a column of settings beside it; after saving, the
  automation is in the list straight away with its upcoming run, and a note at the bottom explains
  it will keep going until paused.
Rules: workspace options are an existing worktree, or a brand-new worktree for every run cut from a
  chosen base, where the base starts as the project's default branch and clearing it goes back to
  that branch; the preselected workspace is the project's main worktree, or failing that its first
  one; the prompt editor wraps long lines, keeps its undo history and has a find bar, and Escape
  shuts the find bar before it shuts the dialog; Edit fetches the latest saved copy before the
  dialog appears, so nobody edits an outdated version; sending the same create twice leaves one
  automation; saving is refused, rather than guessed at, while Kolux cannot yet read the project's
  setup; closing with any changed field (Escape, Cancel or the dark area) first asks "Discard your
  changes?", the dark area closes the dialog only when the press and the release both landed on
  it, and Escape still shuts the find bar before it asks; a worktree list that cannot be read shows
  the real reason with Try again, and Save's hint says to use it.
Acceptance:
  - [x] Create an automation → it is listed at once without a refresh. (cards; evidence/cards-AUTO-005.txt)
  - [x] Double-click the save button → only one automation exists. (cards; evidence/cards-AUTO-005.txt)
  - [x] Open find in the prompt editor and press Escape → find shuts and the dialog stays; press
        Escape again → the dialog shuts. (cards; evidence/cards-AUTO-005.txt)
  - [ ] Change the agent or the timetable, then press Escape, Cancel or click the dark area → "Discard
        your changes?" asks first; press on the dialog and release on the dark area → it stays open.
        (unit tests: evidence/T-671.txt)
  - [ ] The worktree list cannot be read → the reason shows with Try again and Save says to use it.
        (unit tests: evidence/T-671.txt)
Compat: on the command line, create and edit take `--name`, `--prompt`, `--provider` (codex, claude
  or gemini), `--repo` (an id:, name: or path: selector), `--workspace`, `--workspace-mode`
  (existing or new-per-run), `--base-branch`, and `--enabled` or `--disabled`.
Source: D-09-005

### AUTO-011 · Runs launch in the background and never take focus
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: carries on working in another worktree while an automation run begins.
User sees: the run's agent, along with any setup or default tabs, opens out of sight in its target
  worktree; focus stays put; visiting that worktree later shows everything printed so far; the run's
  own tab shuts by itself when the agent exits, unless the user clicked or typed in it.
Rules: a new worktree made for a run is prepared and launched without switching to it; when a
  background tab is first shown it replays what it has already printed; the self-closing happens
  once, and only to a tab that the run itself opened; runs still going when Kolux restarts reconnect
  to their terminal.
Acceptance:
  - [x] A timed run starts while the user types in another worktree → focus and keystrokes are
        untouched. (cards live; evidence/cards-AUTO-011.txt)
  - [x] Open the run's worktree → all the startup output is there. (cards live; evidence/cards-AUTO-011.txt)
  - [x] Type in the run's tab, then let the agent exit → the tab stays open. (cards; evidence/cards-AUTO-011.txt)
Compat: —
Source: D-09-011

### AUTO-016 · Automations list with sorting, filters and search
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: opens the Automations page.
User sees: a table of automations giving name, timetable or trigger, agent, project, last run
  (status and how long ago) and upcoming run; the header row and first column stay fixed while
  scrolling; a toolbar with refresh, Runs and New Automation; a quick-actions menu on every row.
Rules: names sort the way people count, so 2 comes before 10, and sorting by last run puts the
  newest first with never-run automations at the end; filters cover switched on or paused, the last
  run's result, and several agents at once; search looks at name, project, worktree, agent and the
  first 2,048 characters of the prompt, ignores case and extra spaces, and rejects absurdly long
  queries; the search box has focus when the page opens and keeps its text across a refresh; opening
  a row's quick-actions menu does not select that row; nothing created yet, nothing matching, and a
  failed load each get their own empty state, and a failed load offers Retry and never claims the
  list is empty; a refresh that fails keeps the rows already shown and says what failed in a note
  on every view of the page, a failed Hermes and OpenClaw ask and a failed list read told together;
  a row's quick-actions menu closes on Escape or a click outside it; with no project added, the
  toolbar and the empty state offer Add a project, which opens the sidebar's Add Project dialog;
  the toolbar has a Close button, and Refresh shows busy while it runs; Hermes and OpenClaw jobs are sorted, searched and filtered in the same table;
  opening the page selects the first automation and loads its overview and runs, and picking another
  loads that one's runs; run status and usage update in the open page as runs progress, with no
  refresh needed.
Acceptance:
  - [x] Search for a word that appears only inside a prompt → that automation shows. (cards; evidence/cards-AUTO-016.txt)
  - [x] Sort by last run → never-run automations are at the bottom. (cards; evidence/cards-AUTO-016.txt)
  - [x] Force a load failure → an error with Retry, not a nothing-created message. (cards; evidence/cards-AUTO-016.txt)
  - [ ] A refresh fails while rows are showing → the rows stay and a note says what failed.
        (unit tests: evidence/T-671.txt)
  - [ ] Open a row's menu, then press Escape or click outside it → the menu closes. (unit tests: evidence/T-671.txt)
  - [ ] No project added → Add a project is offered in the toolbar and the empty state and opens the
        Add Project dialog. (unit tests: evidence/T-671.txt)
Compat: —
Source: D-09-016

### AUTO-019 · Run now, pause, edit or delete an automation
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: uses Run Now, the pause/resume switch, Edit or Delete on an automation.
User sees: Run Now begins a run immediately and shows it as queued; pausing stops future runs until
  resumed; Delete asks to confirm, then removes the automation together with its run history; the
  list refreshes after every change.
Rules: Run Now ignores the timetable and the precheck and is logged as a manual run; it is refused
  while the same automation still has a run pending, dispatching or dispatched, naming that run (a
  dispatched run counts only while it has a terminal, or for two minutes after it was dispatched,
  when it is "still starting"), so two clicks cannot start two runs, and the button is off and reads
  Starting while the ask is on its way; the opened automation page shows the last action's note and
  the delete confirmation and has Edit and Delete in its header; the delete confirmation for a
  Hermes or OpenClaw job says it is removed from that tool and that Kolux keeps no history for it;
  the delete confirmation can be switched off, and out of the box it is on, so Kolux always asks;
  after a run the upcoming time is shown again.
Acceptance:
  - [x] Click Run Now on a paused automation → a manual run appears in history. (cards; evidence/cards-AUTO-019.txt)
  - [x] Delete with confirmation on → a confirm step shows; switch confirmation off → the next
        delete happens at once. (cards; evidence/cards-AUTO-019.txt)
  - [x] Pause → nothing runs at the next due time. (cards; evidence/cards-AUTO-019.txt)
  - [ ] Click Run Now twice while the automation is running → the second is refused naming the first
        run and no second run is made. (unit tests: evidence/T-671.txt)
  - [ ] Click Run Now → the button reads Starting and is off until the ask returns. (unit tests: evidence/T-671.txt)
  - [ ] Open an automation and run it, then delete it → the note and the confirmation show on the
        opened page, whose header has Edit and Delete. (unit tests: evidence/T-671.txt)
  - [ ] Delete a Hermes job → the confirmation says it is removed from Hermes and Kolux keeps no
        history for it. (unit tests: evidence/T-671.txt)
Compat: —
Source: D-09-019

### AUTO-010 · Choose whether per-run worktrees run the project setup
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: for an automation that makes a new worktree every run, in a project that has a setup step
  (a kolux.yaml in the repo or a setup script saved in the project's settings), decides whether each
  new worktree should run it.
User sees: the option is there only when such a setup exists; each run's worktree then runs or skips
  the setup as chosen.
Rules: hidden for existing-worktree automations and for Hermes or OpenClaw jobs; a setup saved in
  the project's settings wins over the one in the repo; older automations with no stored choice
  behave as skip; a setup that fails does not stop the agent from launching, and an existing
  worktree never runs setup again.
Acceptance:
  - [ ] Project with a kolux.yaml setup and a new worktree per run → the setup option shows.
  - [ ] Project with no setup at all → no setup option.
Compat: —
Source: D-09-010

### AUTO-015 · Runs dashboard across every automation
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: clicks Runs in the Automations toolbar.
User sees: one table of runs from all automations with the automation, how it started, start time
  and status; a search box; a status filter (in progress, successful, failed, skipped); tiles
  counting successes and failures over the last 24 hours and 7 days; a Refresh button; rows arriving
  in batches of 100; clicking a run opens it as a full page with a breadcrumb back to Runs and then
  to Automations.
Rules: runs dated in the future are left out of the 24-hour and 7-day tiles; if loading more rows
  fails the user keeps their place; a history of 10,000 runs scrolls smoothly because only rows on
  screen are drawn; event-started runs carry a tooltip naming the event; with no runs at all the
  table says so plainly, while a runs read that fails says so with its reason and Retry and never
  "No runs yet" with zero counts; each run row holds a button that opens the run, so the keyboard
  reaches it; leaving after loading extra rows and coming back starts again from the
  newest runs.
Acceptance:
  - [ ] Open the dashboard, open a run, click the breadcrumb → the dashboard; click again →
        Automations.
  - [ ] Filter to failed → only failed runs are listed.
  - [ ] The runs read fails → the dashboard says the runs could not be read, with the reason and
        Retry. (unit tests: evidence/T-671.txt)
  - [ ] Tab to a run row's button and press Enter → the run opens. (unit tests: evidence/T-671.txt)
Compat: —
Source: D-09-015

### AUTO-014 · Saved run output with token and cost figures
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: opens a finished run.
User sees: the most recent saved output as plain text, with the tokens and spend for that run; the
  automation's row adds usage up across its runs.
Rules: saved output has terminal control codes stripped and, past the size limit, keeps the most
  recent text; when the agent's transcript is available it is preferred over raw screen redraws;
  usage is attached only when it can be matched to the run, and an unknown cost reads unavailable
  rather than zero; agents that keep no local usage record are marked unsupported without raising
  errors.
Acceptance:
  - [ ] A Codex run with progress bars → the saved output has no escape-code clutter.
  - [ ] An agent that stores no usage → usage reads unavailable, not 0.
Compat: —
Source: D-09-014

### AUTO-007 · Grace window for runs missed while Kolux was away
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: picks how late a missed run may still go: no grace, 30 minutes, or 1, 3, 12, 24 or 48
  hours.
User sees: if Kolux was shut or the computer asleep at the due moment and it comes back inside the
  window, the run starts late; past the window, history gains one skipped entry stating Kolux was
  not available, and the timetable carries on.
Rules: only the most recent overdue time is considered, and a pile of missed runs is never replayed;
  the skipped entry is logged even with no grace, so a gap always shows.
Acceptance:
  - [ ] Hourly automation with 30 minutes of grace: quit Kolux over a due time and reopen 20 minutes
        later → one late run.
  - [ ] No grace, Kolux shut for three hours → a single skipped entry and no runs.
Compat: `--missed-run-grace-minutes` on create and edit.
Source: D-09-007

### AUTO-021 · History keeps the newest 100 runs
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: leaves an automation running over a long period.
User sees: history holds the 100 most recent runs; older finished ones fall away while the numbering
  keeps climbing.
Rules: a run still in progress is never removed, even beyond the cap; run numbers are never handed
  out twice after pruning, and old runs that lack a number are given one; a saved run history that
  has grown too large is cut down when Kolux loads it.
Acceptance:
  - [ ] Run an automation 105 times → runs 6 to 105 remain and the next one is number 106.
  - [ ] A run that is in progress when the cap is reached still finishes and stays listed.
Compat: —
Source: D-09-021

### AUTO-022 · Runs refuse cleanly when the target is not ready
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: has an automation whose project or worktree has been removed, whose setup is out of date,
  or whose agent account needs signing in again.
User sees: the automation shows what is wrong; Run Now is blocked and gives the reason; timed
  occurrences are logged as skipped (unavailable, or sign-in needed) rather than failing quietly.
Rules: a refused Run Now never leaves a half-started run behind; the reason names what is missing:
  the project, the worktree, the setup or the sign-in.
Acceptance:
  - [ ] Delete the automation's worktree and click Run Now → a blocking message names the missing
        worktree and no run is created.
  - [ ] Let a due time pass with the project removed → one skipped entry marked unavailable.
Compat: —
Source: D-09-022

### AUTO-002 · Custom cron field that checks itself as you type
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: switches the timetable picker to Custom and types a cron line, or goes back to one of the
  presets.
User sees: a line under the field reports whether the entry is valid and spells out its meaning in
  words; five small chips name the fields; weekday and day-of-month pickers use names in the
  interface language.
Rules: choosing Custom fills the field with the cron line for whatever timetable was chosen before;
  going to a preset and back to Custom brings back what the user had typed; the chips and weekday
  names follow the interface language; the custom panel holds only the field, the five chips and the
  status line, with no quick-start presets.
Acceptance:
  - [ ] Choose weekly, Tuesday, 10:30, then Custom → the field holds the cron line for Tuesday at
        10:30.
  - [ ] Type gibberish into the field → the status line marks it invalid and saving is blocked.
  - [ ] Change the interface language → the chips and weekday names change with it.
Compat: —
Source: D-09-002

### AUTO-003 · Time picker with AM and PM
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: sets the time of day an automation should go.
User sees: an hour box and a minute box beside an AM/PM choice; with an hourly timetable only the
  minute box remains.
Rules: the time is kept in 24-hour form, so 12:05 AM becomes 00:05 and 12:00 PM is midday; a new
  automation starts at 09:00; out-of-range digits snap to the nearest allowed value when the box
  loses focus, and a box left empty takes its smallest value; the arrow keys nudge the value up or
  down.
Acceptance:
  - [ ] Enter 1:30 PM → 13:30 is saved.
  - [ ] Pick hourly → just one box, for minutes, is visible.
  - [ ] Type 75 into the minute box and tab out → the box shows 59.
Compat: —
Source: D-09-003

### AUTO-006 · Starter templates for a first automation
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: opens Automations before making any, or opens the template chooser from the editor's
  header.
User sees: four ready-made starting points (a weekday audit of the repo, a weekly check that a
  release is ready, a daily review, and an hourly upkeep pass), each filling in name, prompt,
  timetable and grace window, plus a start-from-blank choice.
Rules: the weekday audit goes Monday to Friday at 09:00 with 12 hours of grace; the release check
  goes on Thursdays at 14:00 with 24 hours of grace; the daily review goes at 16:30 with 3 hours of
  grace; the hourly upkeep goes at a quarter past each hour with 30 minutes of grace; choosing a
  template only fills in the form, and nothing is stored until the user saves; the templates are
  not offered when editing a saved automation, where picking one would overwrite it.
Acceptance:
  - [ ] With no automations yet → four template cards and a blank choice appear.
  - [ ] Edit a saved automation → no template cards are offered. (unit tests: evidence/T-671.txt)
  - [ ] Choose the hourly upkeep template → the form reads hourly at minute 15 with 30 minutes of
        grace, and nothing is saved.
Compat: —
Source: D-09-006

### AUTO-008 · A precheck command gates each run
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: enters a shell command to run ahead of the agent and chooses a time limit of 1, 2, 5 or
  10 minutes.
User sees: a zero exit code lets the run go on; any other exit code, or running out of time, logs
  the run as skipped by the precheck along with the exit status number and the command's printed
  output.
Rules: the command runs in the target repo ahead of timed and event-started runs, never ahead of Run
  Now; with no choice made the limit is 60 seconds, and it can never exceed 10 minutes; up to 4,000
  characters of printed output are kept; no precheck runs while the project's setup is out of date;
  Hermes jobs have no precheck.
Acceptance:
  - [ ] Precheck exits with 1 → history shows a precheck skip with exit code 1 and the printed
        output.
  - [ ] Click Run Now on that automation → the agent launches and the precheck does not run.
  - [ ] Precheck sleeps beyond its limit → the run is logged as timed out.
Compat: `--precheck` and `--precheck-timeout`.
Source: D-09-008

### AUTO-009 · Keep one agent session across runs
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: switches on session reuse for an automation that runs in an existing worktree.
User sees: rather than opening a new tab, the next run types its prompt into the agent session that
  the last finished run left open.
Rules: offered only in existing-worktree mode, and runs that get a new worktree always open a new
  session; reuse needs that session to be alive and idle, started by the same automation in the same
  worktree, and still in the very same pane, otherwise a new session is launched.
Acceptance:
  - [ ] Reuse on, two runs with the session left idle in between → the second run arrives in the
        same tab.
  - [ ] Close that tab before the next due time → the next run opens a new one.
Compat: `--reuse-session` and `--fresh-session`.
Source: D-09-009

### AUTO-017 · Keyboard control of the list and the detail view
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: uses the arrow keys, Enter and Escape on the Automations page.
User sees: Up and Down move the selection, from the list or from the search box, and Enter opens the
  chosen automation; Left and Right switch between the Overview and Runs tabs; Escape goes from
  detail back to the list and then closes the page.
Rules: arrows and Escape do nothing while the user types in a field, while focus is inside a dialog,
  a menu or a list pop-up, or while a modifier is held; Escape closes the page only when no dialog
  or overlay is on top of it, and on the Runs dashboard it goes back to Automations and on a run
  page back to Runs, under the same conditions; when the selected row vanishes, focus moves to a neighbouring row
  instead of getting lost; Enter or Space on a focused row opens it, a key pressed on a control
  within the row acts on that control alone, and clicks inside a row's pop-up menu never count as
  clicks on the row.
Acceptance:
  - [ ] With a dialog open over the page, press Escape → only the dialog closes.
  - [ ] On a run page press Escape → Runs; press Escape again → Automations. (unit tests: evidence/T-671.txt)
  - [ ] Delete the selected automation → focus moves to a row next to it.
Compat: —
Source: D-09-017

### AUTO-018 · Automation overview with a collapsible prompt
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: selects an automation and reads its Overview tab.
User sees: the timetable or trigger, upcoming run, worktree, agent, run count and usage, plus a
  simple paused marker when paused; a short prompt is shown in full, while a long one is folded
  behind an expand control.
Rules: the expand control works from the keyboard and keeps focus afterwards, and the prompt text
  can be selected; shrinking the window until the prompt no longer fits brings the expand control
  up; the run count never shows zero when history failed to load; background refreshes leave the
  prompt open or folded as it was and keep focus on the expand control; a breadcrumb reads
  Automations followed by the automation's name as the current page, and clicking Automations goes
  back to the list.
Acceptance:
  - [ ] A very long prompt in a narrow window → the expand control is visible; use it → the whole
        prompt can be read.
  - [ ] Make history fail to load → the run count reads unknown, not 0.
Compat: —
Source: D-09-018

### AUTO-020 · The kolux automations command group
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: runs `kolux automations` with list, show, create, edit, remove, run or runs from a
  terminal.
User sees: human-readable output, or JSON when `--json` is passed; create and edit accept the same
  settings as the dialog; remove deletes the automation along with its history; run starts a run
  immediately unless that automation is still running, when it is refused as Run Now is; runs prints history for every automation or for just one.
Rules: without `--repo` the repo is taken from the Kolux worktree that holds the current folder;
  with `--workspace` the automation uses that existing worktree, and without it every run gets a new
  worktree; session reuse is accepted only for existing-worktree automations; every subcommand
  answers `--help`; create and edit accept the full flag set listed under Compat; create requires
  `--trigger`, and since no flag sets an event trigger, event automations can only be made in the
  dialog; remove deletes straight away with no confirmation question; show, edit, remove, run and
  runs take the automation id either as a bare argument or through `--id`.
Acceptance:
  - [ ] `kolux automations create --name Nightly --prompt 'audit' --trigger daily --time 02:00 --json`
        → prints the new id with an upcoming run at 02:00.
  - [ ] `kolux automations remove <id>` → the automation and its history vanish from list and runs.
  - [ ] `kolux automations run <id>` while that automation is still running → refused, naming the run
        in progress, and no second run is made. (unit tests: evidence/T-671.txt)
Compat: subcommands list, show (id), create, edit (id), remove (id), run (id), runs (optionally
  `--id`); flags `--json`, `--help`, `--id`, `--name`, `--prompt`, `--provider` (codex, claude or
  gemini), `--precheck`, `--precheck-timeout`, `--repo` (id:, name: or path: selector),
  `--workspace`, `--workspace-mode` (existing or new-per-run), `--base-branch`, `--trigger` with
  alias `--schedule`, `--time` HH:MM, `--day` 0 to 6, `--timezone`, `--enabled` or `--disabled`,
  `--missed-run-grace-minutes`, and `--reuse-session` or `--fresh-session`.
Source: D-09-020

### AUTO-025 · Hermes and OpenClaw cron jobs in the same list
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: has Hermes or OpenClaw installed on this computer and opens Automations, or picks Hermes
  in the Kolux or Hermes switch of the create dialog.
User sees: that tool's cron jobs appear in the list marked as running on this computer, each with a
  pause/resume switch; Hermes jobs can be run, edited, deleted and created from Kolux; OpenClaw jobs
  can be run and deleted but not edited; Hermes run history is read from its cron output and split
  into titled sections.
Rules: Hermes jobs need a cron timetable and offer no agent, session reuse, event trigger or
  precheck choices; a warning shows when the tool's command cannot be found on the PATH; jobs from
  these tools are not part of the agent filter; Kolux reads log files only from inside the tool's
  own home folder; their job lists are cached and reload on Refresh, the Kolux list finishes loading
  even if one of their probes hangs, and their probes run a few at a time and hold back while
  Kolux's own automation work is busy.
Acceptance:
  - [ ] With Hermes installed, create a Hermes automation → a Hermes cron job exists and shows in
        the list.
  - [ ] Pause an OpenClaw job from Kolux → OpenClaw reports it paused, and no Edit action is
        offered.
Compat: —
Source: D-09-025

### AUTO-023 · Automations row in the sidebar, off by default
Tier: P2 · Pushed: 11 · State at 0.15.0: live-unverified
User does: switches on the Automations button from the Appearance submenu of the View menu or from
  Appearance settings, or hides it again from the sidebar row's right-click menu.
User sees: an Automations row in the sidebar that opens the Automations page.
Rules: the button is off on a fresh install; the menu tick, the settings switch and the right-click
  hide all control one shared setting.
Acceptance:
  - [ ] Fresh install → no Automations row; tick the menu item → the row appears and opens the page.
  - [ ] Right-click the row and hide it → the menu item is unticked.
Compat: —
Source: D-09-023

### AUTO-024 · Hide or tag worktrees made by automations
Tier: P2 · Pushed: 11 · State at 0.15.0: live-unverified
User does: turns on the sidebar filter that hides worktrees created by automations, or adds the
  Automation property to worktree cards.
User sees: worktrees created by runs drop out of the sidebar, or wear an Automation tag on their
  card.
Rules: jumping to such a worktree, for example through View run, turns the hiding filter off so the
  worktree can be seen.
Acceptance:
  - [ ] Filter on, then View run on a run that made its own worktree → the filter switches off and
        the worktree shows.
  - [ ] Add the Automation property to cards → a worktree made by a run carries the tag and one made
        by hand does not.
Compat: —
Source: D-09-024

### AUTO-026 · Automations on SSH hosts and paired servers
Tier: D · Pushed: 11 · State at 0.15.0: dropped
User does: chooses a remote host for an automation, filters the list by host, or moves an automation
  to another host.
User sees: automations from many hosts in one list with host badges, health and repair actions,
  handling for orphaned automations, and runs launched by a headless remote Kolux.
Rules: the cut covers the host picker and host filter, the host catalogue and its diagnostics, owner
  fencing, orphaned automations, taking automations back over SSH, moving between hosts, headless
  dispatch, and the `--pairing-code`, `--environment` and `--project` with `--host` flags.
Acceptance:
  - [ ] The create dialog offers no host picker, and the list has no host filter or host badges.
  - [ ] `kolux automations create --help` lists no host or pairing flags.
Compat: —
Decision: default cut: area 18 (SSH hosts, paired servers, headless serve) is dropped, so
  automations run on this computer only. Revive via DECISIONS.md.
Source: D-09-026

### AUTO-027 · Hermes and OpenClaw jobs on remote hosts
Tier: D · Pushed: 11 · State at 0.15.0: dropped
User does: views or manages Hermes or OpenClaw cron jobs that live on an SSH host or a paired
  server.
User sees: remote jobs grouped per host, with their run history fetched through the relay.
Rules: probing remote hosts, scoping jobs per host and paging through remote run history all leave
  with area 18.
Acceptance:
  - [ ] Only Hermes and OpenClaw jobs on this computer appear in the list.
  - [ ] No host grouping and no remote run history are offered.
Compat: —
Decision: default cut: remote hosts and the relay belong to area 18, which is dropped; only Hermes
  and OpenClaw on this computer stay. Revive via DECISIONS.md.
Source: D-09-027

### AUTO-028 · Linear, Jira and GitLab as automation sources
Tier: D · Pushed: 11 · State at 0.15.0: dropped
User does: attaches a Linear issue to an automation as source context, or expects GitLab pipelines
  to fire the checks-failed event.
User sees: the automation shows the linked issue as its source; GitLab merge requests and pipelines
  count as review events.
Rules: the cut includes the `--source-context` flag and the Linear source display; Linear and Jira
  event triggers were never built, because they would have needed a poller.
Acceptance:
  - [ ] Review events fire only for GitHub pull requests and their checks.
  - [ ] `kolux automations create --help` lists no source-context flag.
Compat: —
Decision: default cut: table 1b cuts the Linear, Jira and GitLab integrations, so review events and
  source context are GitHub-only. Revive via DECISIONS.md.
Source: D-09-028

### AUTO-029 · Automations section in Settings
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opens Settings and goes to the Automations section.
User sees: the sidebar-button switch, a three-step explanation of how automations work, and a button
  that opens the Automations page.
Rules: the Automations page itself stays, and the sidebar-button switch already lives in Appearance
  and the View menu as well.
Acceptance:
  - [ ] Settings has no Automations section.
  - [ ] The sidebar-button switch is still reachable from Appearance settings and from the View
        menu.
Compat: —
Decision: default cut: table 1b removes the automations settings section; the feature keeps its own
  page and the switch stays under Appearance. Revive via DECISIONS.md.
Source: D-09-029

## Dropped by default (tier D)

- AUTO-026 · Automations on SSH hosts and paired servers — area 18 (remote hosts) is dropped;
  automations run on this computer only.
- AUTO-027 · Hermes and OpenClaw jobs on remote hosts — remote hosts and the relay go with area 18;
  local Hermes and OpenClaw stay.
- AUTO-028 · Linear, Jira and GitLab as automation sources — table 1b cuts Linear, Jira and GitLab;
  review events stay GitHub-only.
- AUTO-029 · Automations section in Settings — table 1b removes the section; the page and the
  Appearance switch stay.

## Hidden or retired (tier H)

None: no card in this area is tier H.
