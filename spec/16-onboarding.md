# 16 · Onboarding & guidance

This area covers how a newcomer gets going and how Kolux teaches its own features. The guided first
run is a four-screen card (welcome, connect an AI, pick a folder or sample data, choose a starter
kit) that ends in a short callout tour of the live grid; older profiles are never pushed through it,
and it can be reopened from the sidebar help menu. The Setup Guide is a dialog of eight steps that
tick only when the real thing exists, reached from Help, from a sidebar checklist entry and from a
help-menu item; a four-item newcomer checklist was designed but cannot be reached at 0.15.0. Explore
Kolux is a walk through five workflows with animated pictures and setup cards on each stop. At
launch an existing user gets at most one feature tip. Contextual tours anchor callouts to real
controls the first time a new profile meets them. First successes and feature use are recorded on
the machine only. Newcomer screens follow a plain-language rule enforced by a jargon check, and a
GitHub star prompt asks for a star at a few chosen moments. Other code hosts and trackers, computer
use, the remote-browser tour and the settings section are cut. No card here is P0: nothing in this
area is named as daily use.

Tier counts: P0 0 · P1 19 · P2 13 · H 5 · X 1 · D 4
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 06 Usage & limits · 07 Accounts, sign-in & keys · 08 Orchestration · 09 Automations · 11 Git, source control & review · 13 Browser pane & computer use · 15 Skills, plugins & starter kits · 17 Settings, appearance & input · 19 App lifecycle & operations · 20 The `kolux` CLI · 21 H — retired, hidden, removed, dev-only

## Cards

### ONB-001 · Guided first run is a four-screen card floating over the app
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: starts Kolux for the very first time with a brand-new profile.
User sees: a centred card on top of the app, which is dimmed and slightly blurred behind it. The
  card carries the Kolux mark, four progress bars with a counter such as one of four, a big heading
  and a one-line subheading for the screen in view, a body that scrolls, and a footer holding that
  screen's buttons.
Rules: the screens always run welcome first, then connecting an AI, then the user's work, then
  picking a kit; the bar for the screen in view is wider and solid, bars for finished screens are
  mid-tone and bars still ahead are faint; hovering any bar shows that screen's heading as a
  tooltip; Ctrl+Enter (Cmd+Enter on Mac) fires the screen's main button, except when focus sits in a
  text field or an input-method composition is under way, and it does nothing while the main button
  is disabled; this chord is fixed and cannot be rebound; Back appears in the footer only from the
  second screen onward; the main button carries a small chip showing the modifier plus Return; a
  secondary button, where there is one, sits on the left; a thin strip along the top edge stays a
  drag area, so the window can still be moved; while the starter-kit setup dialog is open the wizard
  hides but keeps its place, and it comes back when that dialog closes; the card is at most about
  860 px wide and 880 px tall and shrinks with a smaller window.
Acceptance:
  - [ ] Brand-new profile → the wizard opens on the first screen and the counter shows one of four.
  - [ ] Ctrl+Enter on the first screen → second screen; the same chord while typing in a field → no
        change.
  - [ ] First screen → no Back button; on the second screen, Back → first screen.
Compat: —
Source: D-16-001

### ONB-002 · Welcome screen: three AIs at work side by side
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: reads the opening screen and clicks 'Get started'.
User sees: a heading saying several AIs can work on the user's own files at the same moment, above
  three small tiles, one each for Claude, Codex and Grok, each with a brief label of what it is busy
  with and a status dot that pulses.
Rules: the dot pulses only when the system has not asked for reduced motion; all three tiles are
  always drawn; 'Get started' is never disabled and leads to the second screen.
Acceptance:
  - [ ] Reduced motion on → three tiles with still dots.
  - [ ] Click 'Get started' → the second screen shows and the progress is stored.
Compat: —
Source: D-16-002

### ONB-003 · Connect an AI screen keeps Continue locked until one AI is connected
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: signs in to an AI provider with the cards on the second screen, or clicks 'I'll do this
  later'.
User sees: the same Connect cards found elsewhere in Kolux, under a subheading promising sign-in
  with a plan the user already pays for and no terminal needed. Continue stays greyed out until some
  provider shows as connected.
Rules: Continue unlocks the moment any provider reports connected; 'I'll do this later' moves on to
  the third screen with nothing connected; the first time any AI becomes connected, the
  first-AI-connected milestone is recorded on the machine (ONB-011).
Acceptance:
  - [ ] Nothing connected → Continue disabled, and 'I'll do this later' still moves on.
  - [ ] Connect one provider → Continue unlocks without leaving the screen.
Compat: —
Source: D-16-003

### ONB-004 · Your work screen: choose a folder or use sample data
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: on the third screen clicks 'Pick a folder', or picks one of the sample datasets and
  clicks Continue (labelled 'Try with sample data').
User sees: two routes split by an "or": a folder picker that leaves the wizard for the usual Add
  Project flow, and a list of sample cards, each with an icon next to its title, with the
  spreadsheet-analysis sample already chosen.
Rules: only starter kits that come with sample data are offered as samples, and the
  spreadsheet-analysis kit is the default; Continue turns the chosen sample into a workspace; while
  that happens Continue shows as busy and cannot be clicked; if the sample cannot be created, the
  wizard stays on the third screen and no workspace is set; creating the sample also suppresses the
  launch-agents window that normally pops up for a new workspace, and pre-selects the matching kit
  on the fourth screen; 'Pick a folder' hands over to Add Project, and since T-674 (DT-C110) onboarding
  is recorded as completed only once a project is actually added; cancelling Add Project leaves it
  unfinished and Help › Onboarding brings the wizard back.
Acceptance:
  - [ ] Reach the third screen → the spreadsheet sample is already selected.
  - [ ] Continue with a sample → the fourth screen opens with that sample's kit selected and no
        extra launch window.
  - [ ] 'Pick a folder' → the wizard closes as completed and the Add Project dialog opens.
  - [x] 'Pick a folder', then cancel Add Project → setup is not recorded as completed and Help ›
        Onboarding reopens the wizard; add a project instead → it is recorded completed. (T-674; evidence/T-674.txt)
Compat: —
Source: D-16-004

### ONB-005 · Choose a kit screen starts a kit or one plain session
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: on the fourth screen chooses a kit card and clicks 'Start kit', or clicks 'Just open a
  session'; may also flip the switch for being told when an AI finishes.
User sees: kit cards listing their seat roles, a switch, on at first, asking for a ping whenever an
  AI finishes, and then either an immediate launch or the kit setup dialog.
Rules: the kit that matches the chosen sample is pre-selected, otherwise the first kit in the
  catalogue; 'Start kit' launches straight away, skipping the setup dialog, only when the sample
  workspace already fills in all the inputs the kit needs and some agent is ready to use; in every
  other case (no workspace yet, a real folder, or no agent) the setup dialog opens; 'Just open a
  session' starts a single session with an empty prompt, using the first available agent, in the
  project's main copy rather than a separate worktree; with no workspace it leads to picking a folder
  (T-612); since T-674 (DT-C110), with no agent installed the last button is 'Pick a folder' and
  says why, and a session request that finds no agent says that nothing started instead of doing
  nothing; the ping switch is the app-wide notifications setting, so flipping
  it here flips it everywhere; a successful launch by either route records onboarding as completed
  and begins the grid tour (ONB-012).
Acceptance:
  - [ ] Sample workspace and an agent available → 'Start kit' launches with no dialog and the wizard
        closes.
  - [ ] No agent installed → 'Start kit' opens the setup dialog and 'Just open a session' does
        nothing.
  - [ ] Turn the ping switch off → Settings shows notifications off.
  - [x] No agent installed → the last button reads 'Pick a folder' with a line saying why; installing
        an agent from the Connect screen counts at once. (T-674; evidence/T-674.txt)
Compat: —
Source: D-16-005

### ONB-006 · Leaving the wizard asks first and says how to return
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: presses Escape, or clicks outside the wizard card.
User sees: a small dialog asking whether to skip setup and pointing to the place in Help where setup
  can be picked up again, with 'Skip' and 'No, keep going'.
Rules: only a primary-button click outside every onboarding surface raises the question; clicks on
  the card, in nested dialogs or drop-down menus (the sound picker, for one), and clicks with any
  other mouse button are ignored; Escape while the question is already showing does not open a
  second copy; Skip closes onboarding as dismissed, starts no tour, and marks the sidebar checklist
  dismissed; 'No, keep going' puts the user back on the screen they were on; the pointer must name
  the real way back, the help menu's Onboarding item (ONB-009); at 0.15.0 it names Explore Kolux
  instead, which neither reopens the wizard nor replays the grid tour.
Acceptance:
  - [ ] Escape on the second screen → the question appears; 'No, keep going' → still on the second
        screen.
  - [ ] Right-click outside the card → nothing happens.
  - [ ] Skip → the wizard closes and no tour follows.
Compat: —
Source: D-16-006

### ONB-007 · Wizard progress and outcome are kept, and a failed save can be retried
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: moves between screens, quits partway through, or finishes.
User sees: after a relaunch the wizard picks up on the screen it had reached; once finished or
  skipped it never returns. If storing the close fails, an error toast says the progress could not
  be kept, and the user can try once more.
Rules: every step forward stores the last completed screen, and the move goes ahead even if storing
  fails; closing stores when it closed and whether the outcome was completed or dismissed; a
  completed close counts the last screen as done; closing is latched: a second close while the first
  is still being stored does nothing, and a failed store frees it again so another attempt is
  possible; a completed close asks the star prompt (ONB-037) to show its onboarding-finished toast
  straight afterwards.
Acceptance:
  - [ ] Reach the third screen, quit, relaunch → the wizard opens on the third screen.
  - [ ] Finish with 'Just open a session', relaunch → no wizard.
  - [ ] Force the close to fail to store → error toast; clicking the same button again retries.
Compat: The profile holds onboarding data the importer must bring across: which wizard version it
  belongs to, when it closed, whether it was completed or dismissed, the last completed screen, the
  checklist ticks and the milestone times.
Source: D-16-007

### ONB-008 · Only new profiles get the wizard; older progress carries forward
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: updates Kolux from an older version, or starts with a profile that already exists.
User sees: people who already used Kolux are never pushed through the new wizard; someone partway
  through an older wizard either resumes at the matching screen or starts again at screen one.
Rules: a profile with no onboarding record at all is treated as already completed; progress saved by
  the version that had a view-choice screen after the welcome moves back by one past that screen,
  while progress from the version without it is kept unchanged; any unfinished progress from the
  older five-step wizard restarts at screen one, even when it had been dismissed; older versions
  keep their own fallbacks: a completed record with enough steps maps to the last screen, and
  unfinished progress is capped; progress is held within the four screens, and the stored version is
  raised to the current one on load; a missing close time is filled in when an outcome is present.
Acceptance:
  - [ ] Profile with no onboarding record → no wizard.
  - [ ] Progress saved beyond the old view-choice screen → the wizard resumes on the same visible
        screen.
  - [ ] Unfinished progress from the five-step wizard → the wizard opens on screen one.
Compat: The importer must bring over onboarding progress and outcome so that imported users are not
  onboarded a second time.
Source: D-16-008

### ONB-010 · The first folder added after onboarding starts the default agent
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: adds a first project folder straight after onboarding, through 'Pick a folder' or after
  skipping while no project existed.
User sees: a session running the user's saved default agent opens in that folder with no further
  clicks.
Rules: the saved default agent is used; when the default is a blank terminal, a blank terminal
  opens; when the default is left on automatic, no agent is guessed; defaults set to chat open as
  chat, terminal defaults open as a terminal; after a skipped run this happens only if no project
  had been added yet, and never when a project already existed or onboarding itself had added one.
Acceptance:
  - [ ] Default agent set, onboarding skipped with no projects, a folder added → that agent starts
        in it.
  - [ ] Add a second project later → no agent starts on its own.
Compat: —
Source: D-16-010

### ONB-012 · Grid tour runs once when the first run ends
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: ends onboarding by launching a kit or a plain session.
User sees: a tour of three callouts laid over the running grid, explaining what a session is, where
  its status shows (spinning, yellow, green), and where results get gathered.
Rules: it starts only after a finish by kit or by plain session, and only once; finishing by Skip or
  by the folder picker does not start it; it follows the same overlay, skip and progress rules as
  every contextual tour (ONB-031); at 0.15.0 nothing replays it, Explore Kolux included.
Acceptance:
  - [ ] Finish with 'Just open a session' → the tour points at the terminal, then the sidebar, then
        the kit results.
  - [ ] Skip onboarding → no tour.
Compat: —
Source: D-16-012

### ONB-036 · Plain words on newcomer paths, guarded against jargon
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: reads onboarding, Add Project, the dialog for a folder without git, the launcher, sidebar
  labels, Connect cards and error toasts.
User sees: everyday words first, with the exact technical term available on hover.
Rules: visible text on these paths may not use any of: repo, clone, checkout, worktree, shell, CLI,
  PTY; product names such as PowerShell, GitHub and Git Bash remain allowed; hover and explanation
  text may carry the technical term; one shared glossary pairs each technical term with its plain
  word and also supplies the Connect-card text; an automated check scans the text shown on the
  in-scope screens, and a banned word found there breaks the build.
Acceptance:
  - [ ] Search the visible text of newcomer screens → none of the banned words.
  - [ ] Hover a plain label → the technical term appears.
Compat: —
Source: D-16-036

### ONB-014 · Setup Guide dialog with a progress ring and a list of steps
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens Help › 'Getting Started with Kolux', the checklist entry in the sidebar, or
  'Milestones' in the sidebar help menu.
User sees: a dialog with a ring showing core steps done out of the total, a step list split into a
  Setup group followed by a numbered parallel-work group, and the chosen step's action panel on the
  right; a crossed-out-eye button removes the checklist from the sidebar.
Rules: there are eight steps: Multi-task, Use Kolux's browser, notifications, default agent, Enable
  Kolux CLI, Connect integrations, Automate workspace setup, and Start work in multiple repos; it
  opens on the first unfinished step, looking in the Setup group first and then in parallel work; a
  caller can ask for one particular step, and the guide moves on once that step is done; the
  'Milestones' item in the help menu is there only while core steps remain, and it shows a small
  progress ring; the content stays in place through the closing animation, and reopening during it
  cancels the teardown; step names and descriptions come in English and Korean.
Acceptance:
  - [ ] Open from Help → the first unfinished step is selected.
  - [ ] Finish every core step → 'Milestones' leaves the help menu.
  - [ ] Close and reopen fast → no flash of empty content.
Compat: —
Source: D-16-014

### ONB-017 · Enable Kolux CLI step installs the CLI and agent skills
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: ticks the capabilities to set up (the CLI, and skills such as orchestration and browser
  use) and runs setup.
User sees: a list of capabilities where missing ones start ticked and ready ones start unticked; a
  short explanation of what registering the CLI means, shown before install; a small terminal inside
  the panel with the install command already typed at its prompt, waiting for Enter; and a command
  the user can copy.
Rules: all setup items begin switched on, so setup on the first launch can run right away; the
  chosen skills install with one combined command; choosing orchestration alone never touches
  browser or desktop-control setup; on Windows with WSL, commands go through the selected WSL
  distro; if that environment needs repair they fall back to the Windows host, and whichever
  environment was chosen at the start stays for the whole run (owner to confirm: area 18 cuts WSL
  execution, so this WSL routing may go while the host path stays); a copied command is written for
  the target shell, and a failed copy shows a warning; if PATH cannot be read from the registry, a
  warning shows and PATH is left alone; on macOS a Full Disk Access prompt appears only for states
  the user can fix, refreshes when Kolux regains focus, opens the system setting, and never appears
  on other systems; clearing every tick clears the setup markers; the inline terminal opens in the
  user's shell, waits until a prompt is visible (or, when no prompt text can be read, until the
  terminal has been open a short while), then types the setup command without running it; a short
  note beneath says to press Enter; it stops waiting for a prompt after a capped number of checks,
  about fifty, rather than polling forever; if the shell the terminal lands in changes, for example
  from a WSL distro to the host, the command is reshaped for that shell and typed again; one
  terminal never receives the same command twice; when the setup shell exits, installed skills are
  detected again so the step can tick; exits from any other terminal are ignored; when the setup
  panel goes away its terminal is closed, so no installer keeps running unseen.
Acceptance:
  - [ ] CLI installed, skills missing → only the skills start ticked.
  - [ ] Broken WSL distro → setup runs on the Windows host.
  - [ ] Windows → no Full Disk Access prompt.
  - [ ] Open the CLI step → the inline terminal shows the install command at the prompt, not yet
        run; press Enter → it runs, and when the shell exits the step checks again and ticks if the
        skills are now present.
Compat: —
Source: D-16-017

### ONB-022 · Explore Kolux workflow tour
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens Help › 'Explore Kolux' and steps through workflows with Continue or with the rail
  on the left.
User sees: a large dialog that presents itself as a short walk through one workflow at a time: a
  rail of five workflows (workspaces, tasks, agents, workbench, review), each with an animated
  picture, a short caption, a link to the docs, and Optional or Completed markers.
Rules: agents has the sub-stops statuses, usage and orchestration; workbench has terminal, editor
  and browser; review has notes, PR view and ship; Continue visits the sub-stops before going to the
  next workflow, and answers the same Ctrl/Cmd+Enter chord as the wizard; the rail responds to the
  up and down arrow keys, Home and End, and stops at either end; the Tasks stop shows the unified
  task text without leaving the walkthrough.
Acceptance:
  - [ ] Help › 'Explore Kolux' → the dialog opens on workspaces with the rail showing.
  - [ ] On agents, Continue → statuses, usage, orchestration, then workbench.
  - [ ] Focus the rail and press End → the last workflow is selected.
Compat: —
Source: D-16-022

### ONB-027 · Startup tips: one per launch, in a set order
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens Kolux as someone who has used it before.
User sees: at most one small tip dialog at launch: the CLI tip first, the command-palette tip on a
  later launch, then nothing more.
Rules: newer tips come before older ones; tips already seen, and tips for features already in use,
  are skipped; no tip appears while onboarding is showing, or later in that same session; a tip
  waits until saved interface state is ready, settings and onboarding have loaded, no modal is open
  and the CLI install status is known; the CLI tip is skipped when the CLI is unsupported, or
  installed and on PATH; installed but missing from PATH still counts as not done; if reading the
  CLI status fails, the CLI is treated as installed; a tip counts as seen the moment it appears; a
  tip already showing stays open after being marked seen and closes only when the user responds;
  seen tips are stored once, and tip entries from older data that are no longer known are dropped on
  load.
Acceptance:
  - [ ] Existing user without the CLI → CLI tip at launch; next launch → palette tip; next launch →
        no tip.
  - [ ] First-time user → no tip during onboarding or later in that session.
Compat: Which tips have been seen is data the importer should bring across.
Source: D-16-027

### ONB-028 · CLI tip installs the CLI and skills
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks 'Install CLI & Skills' in the CLI tip.
User sees: a tip naming concrete things the CLI makes possible, an install button with an inline
  setup terminal, and an outcome of either installed or needs attention.
Rules: the outcome is installed only after registration finishes cleanly; it is needs attention when
  install did not finish cleanly or the launcher is installed but missing from PATH; on Windows with
  a broken WSL environment, setup runs on the host instead; the tip's inline terminal acts like the
  Setup Guide's CLI step (ONB-017): the command is typed at the prompt and runs only when the user
  presses Enter.
Acceptance:
  - [ ] Install succeeds and the CLI is on PATH → installed.
  - [ ] Installed but not on PATH → needs attention.
Compat: —
Source: D-16-028

### ONB-031 · Contextual tour overlay: callouts with Back, Next, Skip and Done
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: follows a tour that appears beside a real control.
User sees: a floating panel attached to its target, holding the step text, progress dots and a step
  label, Back, Next and Skip buttons, Done on the last step, and optionally a pulsing ring around
  the target.
Rules: one-step tours show no step label, and Back is hidden on the first visible step; some steps
  swap Next for an action button, or hide it when the real control is what the user should click;
  Escape acts as Skip before any page shortcut gets it, and does nothing when no panel is showing;
  the panel tracks its target as layout changes, re-measures cheaply, and works inside dialogs and
  side sheets; steps whose target is missing are skipped, and progress counts only the steps that
  show; tour text is translated; while the app window is hidden the panel stops its regular
  re-measure, and measures again as soon as the window is visible; a target that keeps moving for
  several frames, or moves without any layout event, is still tracked; the panel sits on the step's
  preferred side of the target with an arrow pointing to it; when no side has room it stays within
  the window or dialog, covering the target if it has to.
Acceptance:
  - [ ] Escape during a tour → it ends as skipped and does not come back.
  - [ ] Resize the window → the panel stays attached to its target.
Compat: —
Source: D-16-031

### ONB-032 · Contextual tours appear once, only for new profiles, when the target is ready
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: reaches a feature for the first time.
User sees: a tour on the first visit only, provided this profile began with onboarding; explicit
  replay buttons can run a tour at any time.
Rules: whether a profile gets automatic tours is decided once: profiles that had onboarding on first
  load qualify, and existing profiles never get automatic tours; no tour before onboarding has
  loaded, and none while it is showing; a tour begins only after the saved list of seen tours has
  loaded and its first target is visible and measurable; hidden copies of the target are passed
  over; if measuring fails the tour does not start and is not marked seen; no tour starts on top of
  a confirmation dialog; only the workspace-creation tour may run over its own composer; skipping or
  finishing marks the tour seen once; a stale dismissal meant for another tour is ignored; if the
  feature that owns a tour is switched off, the tour is held back unless it was deliberately
  detached; a forced request from a button keeps retrying until the target appears, stops if another
  tour starts or the user moves elsewhere, and is able to hold off until a different tour has
  finished; a tour waiting for its first target gives up after a capped number of attempts, about
  twenty, instead of watching forever; at most one tour starts by itself per app session; a tour
  cancelled before it ever showed gives that slot back, while one that did show keeps it used; a
  replay button ignores both the per-session limit and the seen list.
Acceptance:
  - [ ] Existing profile updates → no automatic tours.
  - [ ] New profile opens the browser pane → the browser tour once; second visit → none.
  - [ ] Replay button with every tour already seen → the tour runs.
  - [ ] A tour whose target never renders → after the retry cap nothing is still waiting and no tour
        shows.
  - [ ] Two surfaces with unseen tours in one session → only the first starts on its own; the second
        waits for the next launch, though its replay button still opens it now.
Compat: The seen-tour list, and whether the profile qualifies for automatic tours, are data the
  importer should bring across.
Source: D-16-032

### ONB-033 · Catalogue of contextual tours
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: meets each surface for the first time.
User sees: short tours for: the board (plan, then move cards through lanes to done); running agents
  in parallel (split a pane, then start another task); the browser pane (grab, annotate, stay logged
  in by importing cookies); tasks (source, filter, start from a row); automations (create one, then
  see results); the floating workspace (works across every project, has a scratchpad); workspace
  creation (choose a project, name new work or reuse existing work, pick an agent); and the grid
  tour after onboarding (ONB-012).
Rules: running the split command carries the parallel-agents tour past its split step; the tour
  opens the sidebar if the create button is hidden, and cancels if that button is missing; that tour
  is offered only on an active workspace terminal tab, and only to people who have never split a
  pane; its first step has a 'Split terminal' button that splits the current tab side by side; with
  no active tab the button does nothing; opening the workspace composer from anywhere other than
  that tour's create step hands nothing off to a tour; the browser tour's cookie step waits until
  its menu row can be measured, falling back from a hint button to the row in the overflow menu; its
  progress always counts three steps, even while the cookie step's target is not yet visible; the
  floating-workspace tour falls back to the panel itself when its list is empty; the
  workspace-creation tour hands over into the composer; turning on automatic naming from the first
  message clears a generated name, while turning it off keeps the name; the tasks tour points first
  at a row's start-work action and only after that at the toolbar controls.
Acceptance:
  - [ ] Split a pane during the parallel-agents tour → the tour moves to the create-workspace step.
  - [ ] Tour entries saved by an older version that no longer exist → dropped on load.
  - [ ] A profile that has split a pane before opens a new workspace → no parallel-agents tour.
Compat: —
Source: D-16-033

### ONB-009 · Reopen the wizard from the sidebar help menu
Tier: P2 · Pushed: 6 · State at 0.15.0: live-unverified
User does: opens the help menu in the sidebar and clicks 'Onboarding'.
User sees: the guided first run starts again on screen one.
Rules: reopening wipes the close time, the outcome and the progress but leaves the rest of the
  checklist state alone, clearing only its dismissed mark; clicks less than half a second apart
  count as one.
Acceptance:
  - [ ] After finishing onboarding, click 'Onboarding' in the help menu → the wizard is back on
        screen one.
  - [ ] Double-click the item fast → the wizard opens once.
Compat: —
Source: D-16-009

### ONB-011 · First-success milestones are recorded locally and appear in diagnostics
Tier: P2 · Pushed: 6 · State at 0.15.0: live-unverified
User does: connects a first AI, launches a first kit, opens first results; later copies the terminal
  diagnostics.
User sees: nothing while working; the copied diagnostics list when each first milestone happened.
Rules: there are three milestones: the first time an AI is connected, the first kit launch, and the
  first time results are opened; each is written once, at its first occurrence, and never
  overwritten; an absent value means it has not happened yet; milestones never leave the machine;
  they are shown nowhere else; a line in the About box was planned but never built.
Acceptance:
  - [ ] Connect an AI, then connect again later → the milestone keeps the earlier time.
  - [ ] Launch a kit, then copy terminal diagnostics → the kit-launch time is listed.
Compat: Milestone times belong to the onboarding data the importer must bring across.
Source: D-16-011

### ONB-015 · Setup Guide steps tick from real state, not from clicks
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: works as usual while the guide ticks steps off as they become true.
User sees: a tick appears only once the thing it stands for really exists.
Rules: Multi-task is done once a real workspace exists besides the main checkout; neither a
  placeholder nor two main checkouts count; Browser is done once a page other than a blank one has
  been shown; Multiple repos is done from the lasting count of git projects, two or more;
  Integrations is done when any supported provider is connected, and not while its checks are still
  pending; CLI and capabilities is done only when the required skills and permissions are in place;
  a desktop-control capability that is unavailable never holds it back, and merely starting setup
  does not count; for the setup-script step, readiness resets when its inputs change, late answers
  from an older check are ignored, and a check that fails settles as having no script; old profiles
  that had finished the earlier steps, or had saved the legacy setupChecklist off, count as complete
  under the legacy rule everywhere (since T-674, DT-C110, hiding the checklist is saved separately and
  does not count), while a failed status read is never taken as completion; a retired
  split-terminal step no longer counts toward progress.
Acceptance:
  - [ ] Only the main checkout exists → Multi-task unticked; create one workspace → ticked.
  - [ ] Open a blank browser tab → Browser unticked; load a page → ticked.
  - [x] Hide the sidebar checklist with steps unfinished → the Setup Guide still shows them unticked.
        (T-674; evidence/T-674.txt)
Compat: —
Source: D-16-015

### ONB-016 · Setup Guide actions for workspaces, notifications and the default agent
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the action panel of the selected step.
User sees: Multi-task opens the new-workspace composer with a short tour; the notifications step
  offers sound choices and, on macOS, a permission card; the default-agent step shows an agent
  picker plus a fold-out list of fallback agents; the setup-script step offers to automate workspace
  setup.
Rules: actions that need a project ask for one first; creating a workspace uses the active git
  project, failing that the first git project, and folders without git never qualify; a composer
  request left over from before a close and reopen is ignored, and tour retries fire only on the
  screen they expect; the macOS permission card stays hidden until the delivery check answers:
  delivered reads as enabled, pending as awaiting, a first refusal as a dialog not yet answered and
  a later refusal as blocked; the card is hidden where notifications are not supported; non-system
  sounds get no volume slider, and the old per-source notification switches are gone; the fallback
  list sits behind a summary toggle whose label says show while folded and hide while open.
Acceptance:
  - [ ] Only a non-git folder added → Multi-task asks for a git project.
  - [ ] macOS with notifications denied earlier → the card reads as blocked.
Compat: —
Source: D-16-016

### ONB-018 · Connect integrations step: GitHub review and tasks
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: connects GitHub from the Connect integrations step.
User sees: a review step and a task-source step; once GitHub is connected both resolve, and the task
  step folds into a summary naming the connected source.
Rules: the review step is active first; the task step waits, folded but openable; a connected code
  host completes the task step only once review is connected and the tracker checks have finished; a
  cached sign-in does not show as connected while its checks are stale or failed, and a failed token
  sign-in does not count as ready for review; the rebuild keeps GitHub only (ONB-019 covers the
  other providers).
Acceptance:
  - [ ] Nothing connected → review active, tasks waiting.
  - [ ] Connect GitHub → both steps done and GitHub named in the summary.
Compat: —
Source: D-16-018

### ONB-020 · Sidebar onboarding checklist entry
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: notices a checklist entry in the left sidebar after onboarding, then clicks it or chooses
  'Hide from sidebar'.
User sees: a compact entry with progress that opens the Setup Guide, plus a hide option.
Rules: hiding is remembered, since T-674 (DT-C110) as its own setting that marks no step done; on every load the entry is treated as dismissed once onboarding has
  ever closed, so in practice it is visible only in the session where onboarding closed; the
  newcomer variant is reserved for newcomer profiles and cannot be reached at 0.15.0 (ONB-013); a
  finished setup never makes the entry flash up while capability checks are still loading; only an
  explicit hide counts as hidden when saved state loads.
Acceptance:
  - [ ] Finish onboarding → entry visible; relaunch → entry gone.
  - [ ] 'Hide from sidebar' → the entry goes and stays gone.
  - [ ] Relaunch with every step done and slow capability checks → the entry never shows, not even
        for a moment.
  - [x] 'Hide from sidebar' → saved as setupChecklistHidden; the entry stays gone and no step turns
        ticked. (T-674; evidence/T-674.txt)
Compat: —
Source: D-16-020

### ONB-023 · Explore Kolux marks a stop complete only after a visit and real setup
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: visits workflows and sub-stops, configures things, and reopens the tour later.
User sees: ticks only on stops that were visited and, where setup is part of the stop, really
  configured; the ticks survive a reopen.
Rules: nothing is ticked in advance just because it is already configured; the user has to visit it;
  Tasks completes after a visit plus a connected task source; orchestration needs a visit plus the
  orchestration skill detected; browser needs the browser-use skill; once complete, a stop or
  workflow stays complete even if detection later says unavailable; visits come back on reopen, and
  unknown or repeated entries are dropped; visit state is kept in browser-side storage on this
  machine, not in the profile, so moving to another profile by importing loses it; the rebuild
  should decide whether it belongs in the profile.
Acceptance:
  - [ ] Configure GitHub, open the tour → Tasks stays unticked until visited.
  - [ ] Complete review, reopen → still ticked.
Compat: —
Source: D-16-023

### ONB-024 · Explore Kolux stops carry their own setup cards
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: changes a setting from within a tour stop.
User sees: setup right on the stop: tasks shows provider rows; agent statuses shows a keep-PC-awake
  card; usage shows connected accounts; the orchestration and browser stops show a skill setup card
  with an inline terminal; PR view shows GitHub; ship shows the AI commit message and PR text
  settings.
Rules: keep-awake moves from off to its automatic mode, and either of its on modes can be switched
  off; usage counts as connected through managed accounts or through the provider's own default
  rate-limit data, even before live quota arrives; inline setup terminals are shorter inside
  onboarding than in the tour.
Acceptance:
  - [ ] Keep-awake off → the card's switch turns on automatic mode.
  - [ ] Codex signed in outside Kolux → the usage stop shows connected.
Compat: —
Source: D-16-024

### ONB-025 · Explore Kolux animations respect visibility and platform
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: watches a tour stop, switches away and comes back.
User sees: looping demos (rotating workspace cards, a workbench run queue, a cycle of agent
  statuses, a browser storyboard) that pause while hidden and carry on from the same point; shortcut
  labels match the platform.
Rules: hidden demos pause and resume without jumping ahead; on Windows the workbench and browser
  demos show Ctrl-style shortcuts; the browser demo keeps a fixed storyboard order and loop length.
Acceptance:
  - [ ] Hide the window mid-rotation, come back → the same card carries on.
  - [ ] On Windows → no Cmd symbols in the demos.
Compat: —
Source: D-16-025

### ONB-029 · Command palette tip with a one-time demo
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: sees the palette tip and clicks 'Got it'.
User sees: a dialog with a tip badge, a title carrying the live palette shortcut as key chips, a
  short demo of typing into the palette that brings up a create-workspace row, and a note on how to
  change the binding.
Rules: the key chips follow the user's binding; an unassigned binding falls back to the default, and
  double-tap bindings show without plus signs; the demo plays once and stops; with reduced motion it
  shows the final state and runs no timers; the tip is only an acknowledgement, not an action.
Acceptance:
  - [ ] Rebind the palette → the tip title shows the new keys.
  - [ ] Reduced motion on → the demo shows its end state without moving.
Compat: —
Source: D-16-029

### ONB-037 · GitHub star prompt: when it shows
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: uses Kolux: launches many agents, gets a task finished, or completes onboarding.
User sees: a card asking for a star on GitHub after enough agents or after a finished task, or a
  toast just after onboarding completes.
Rules: the threshold is 35 agents launched since a baseline taken for the current app version; each
  update resets the baseline unless the user already completed the prompt; 'Later' starts a
  three-day cooldown and doubles the next threshold; the finished-task moment fires once per app
  version, after a prompted session completes without interruption and once other live agents and
  typing have been quiet for about a second; the onboarding-complete prompt is a toast that replaces
  any threshold card on screen; if a check is under way it waits behind it; if the user has already
  starred, nothing shows and any card on screen is hidden; prompts never show during a cooldown,
  after completion, or when no window can take them, though a forced show skips the cooldown; a
  finished-task moment that comes during a cooldown is spent for that app version and does not show
  later in it, while one that finds no window to show in is not spent; a dismissal counts only while
  a prompt is on screen and only once per prompt, so stray or repeated dismissals neither restart
  the cooldown nor double the threshold again.
Acceptance:
  - [ ] Launch 35 agents in a new version → the card shows.
  - [ ] 'Later' → nothing for three days, and after that only once 70 more agents have launched.
  - [ ] Finish onboarding → the star toast appears.
Compat: Star-prompt state (the baseline, the next threshold, the cooldown, whether it was completed)
  is data the importer should bring across.
Source: D-16-037

### ONB-038 · GitHub star prompt: starring and its states
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks 'Star on GitHub', 'Later' or 'Dismiss' in the card or toast, or uses the star
  button in Settings › General or on the landing screen.
User sees: the star is placed directly through the user's GitHub sign-in, with a busy state and then
  a thank-you; when direct starring cannot be done, an 'Open GitHub' button opens the repository
  page instead.
Rules: success is shown only after the direct star has worked; if the star state cannot be checked,
  the browser fallback is offered, and a failed direct star switches to the fallback; while busy,
  Dismiss and closing are disabled; duplicate stars in flight are ignored, and an attempt that threw
  can be tried again; replacing or hiding the toast does not count as the user dismissing it; the
  landing-screen star changes at once, before confirmation arrives; if the user dismisses while a
  direct star is still running and it then fails, the cooldown stays and the prompt does not return.
Acceptance:
  - [ ] Signed in to GitHub → 'Star on GitHub' → busy → thank-you.
  - [ ] Not signed in → 'Open GitHub' opens the repository in the browser.
Compat: —
Source: D-16-038

### ONB-042 · Kolux remembers on this machine which features each profile has used
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: uses features as part of normal work: opens the board, the palette, the browser pane,
  Tasks or Automations, splits a pane, creates a workspace, sets up a skill, and so on.
User sees: nothing directly, but guidance adapts: setup steps tick from real use, tours for a
  feature stop offering themselves once that feature is familiar, and one-time hints reach only
  people who used a control at its old place before it moved.
Rules: for a fixed list of roughly forty features the profile keeps the time of first use and a
  running use count; nothing is recorded until saved interface state has loaded, so earlier uses are
  not counted; counts only go up, and a save that finishes late never overwrites a newer count; on
  load, entries for unknown features and damaged entries are dropped without notice; opening a
  surface that has a tour counts as using that feature; has-used checks feed the browser setup step,
  the legacy split-pane credit in the Setup Guide, the parallel-agents tour gate, the moved-control
  hint, and tips that a feature use makes pointless; the record stays on the machine, and its
  usage-band telemetry is compiled off.
Acceptance:
  - [ ] New profile: show a non-blank page in the browser pane → the Setup Guide's browser step
        ticks and stays ticked after a restart.
  - [ ] Split a terminal pane once, then open a new workspace → no parallel-agents tour.
  - [ ] Add an unknown feature name to the stored record → it is ignored on load and nothing errors.
Compat: —
Source: D-16-042

### ONB-013 · Newcomer setup checklist with four plain first-success items
Tier: H · Pushed: 6 · State at 0.15.0: half-done
User does: opens the setup checklist as a newcomer.
User sees: as designed, a short checklist (connect an AI, run a kit, open results, run on your own
  file) and a single toast once all four are done.
Rules: items are worked out from connection state and the milestones (ONB-011), and the list counts
  as done only when it is ready and all four are ticked; the all-done toast fires once per profile,
  not once per launch, and never on a redraw; the checklist always points at the first unticked item
  in a fixed order (connect an AI, run a kit, open results, run on your own file); once all four are
  ticked there is no next item; gate defect at 0.15.0: the checklist is tied to an older stored
  onboarding version, but every profile is moved to the current version on load and new profiles
  start there, so nobody ever sees it and the general eight-step Setup Guide shows instead.
Acceptance:
  - [ ] If built: a new profile that finishes onboarding sees the four-item list; finishing all four
        shows one toast, which never repeats.
  - [ ] If built: with the first two items ticked → the checklist points at open results.
Compat: —
Decision: H: default build. This is the newcomer path the business-user frame designed; at 0.15.0 it
  cannot be reached only because of a version-gate mismatch.
Source: D-16-013

### ONB-030 · Voice dictation tip
Tier: H · Pushed: — · State at 0.15.0: retired 2026-10-05
User does: would have learned about desktop voice dictation from a launch tip.
User sees: nothing now; the tip's entry is still accepted when read from older data, but it is never
  saved or shown.
Rules: retired together with desktop voice and dictation.
Acceptance:
  - [ ] The rebuild shows no dictation tip.
  - [ ] Older saved data that lists the dictation tip loads without error.
Compat: —
Decision: H: default skip
Source: D-16-030

### ONB-035 · Development builds hold back first-run education
Tier: H · Pushed: — · State at 0.15.0: dev-only
User does: runs a development build.
User sees: no onboarding, no tips and no automatic tours, unless a developer environment variable
  turns them on.
Rules: onboarding is closed, every tip and tour is marked seen, and automatic tours are off;
  end-to-end test data folders and the opt-in variable keep the education on.
Acceptance:
  - [ ] Development build without the opt-in → no wizard, tip or automatic tour.
  - [ ] If built: with the opt-in set → a new profile sees the wizard.
Compat: A developer-only environment variable switches first-run education back on in development
  builds.
Decision: H: default skip
Source: D-16-035

### ONB-039 · Telemetry events for onboarding, tours, tips and the star prompt
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: nothing visible.
User sees: nothing; events exist for onboarding steps, the Setup Guide, how deep the user went in
  the feature wall, tips, tours and star outcomes, but telemetry is compiled off.
Rules: the payloads were privacy-safe and only counted chosen items and depth.
Acceptance:
  - [ ] The rebuild sends no onboarding, tour, tip or star events.
  - [ ] If ever built: an event carries only counts and depth, never file names or typed text.
Compat: —
Decision: H: default skip
Source: D-16-039

### ONB-041 · Retired first-run screens
Tier: H · Pushed: — · State at 0.15.0: retired 2026-10-04
User does: would have picked an agent, theme, integrations, Windows terminal type and notifications
  in the older five-step wizard, or a default view in a later version.
User sees: nothing now; those choices live in Settings and the Setup Guide.
Rules: the guided first run replaced the five-step wizard on 2026-09-28; the default-view screen was
  removed on 2026-10-04.
Acceptance:
  - [ ] The first run has exactly four screens, and none asks for a theme, a terminal type or a
        default view.
  - [ ] Each retired choice can still be made from Settings or the Setup Guide.
Compat: —
Decision: H: default skip
Source: D-16-041

### ONB-026 · Feature tile recordings and other tools' names in their captions
Tier: X · Pushed: 10 · State at 0.15.0: live-unverified
User does: looks at the media tiles that show off the product.
User sees: twelve animated tiles with poster frames, recorded before Kolux existed, whose captions
  name other products (a terminal and an editor by brand, and a list of agent CLIs).
Rules: each tile has an animation, a poster image and a record of when it was made; one tile shows
  remote workspaces, which belong to the dropped remote area; these recordings and captions are not
  the owner's own; the rebuild replaces them with recordings of Kolux RS and its own captions, and
  drops the remote-workspaces tile with area 18.
Acceptance:
  - [ ] Replacement tiles are recorded from Kolux RS itself, and no caption names another product's
        brand.
  - [ ] No tile shows remote workspaces.
Compat: —
Source: D-16-026

### ONB-019 · Other code hosts and trackers in the setup guide and Explore Kolux
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: would connect GitLab, Linear or Jira from the integrations step or from the Tasks stop of
  Explore Kolux.
User sees: provider rows for those services, with trackers listed ahead of code hosts.
Rules: trackers came before code hosts, and a tracker connected first completed the task step by
  itself.
Acceptance:
  - [ ] The integrations step and the Tasks stop offer GitHub only.
  - [ ] If revived: a tracker connected first completes the task step on its own.
Compat: —
Decision: default cut: the owner dropped Jira, Linear, GitLab, Bitbucket, Gitea and Azure DevOps
  (table 1b); GitHub stays. Revive via DECISIONS.md.
Source: D-16-019

### ONB-021 · Onboarding checklist section in Settings
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: would open Settings and choose the onboarding checklist section.
User sees: the Setup Guide's content embedded as a settings page.
Rules: the guide keeps its own dialog and Help entry; only the settings section goes.
Acceptance:
  - [ ] Settings has no onboarding checklist section.
  - [ ] The Setup Guide still opens from Help (ONB-014).
Compat: —
Decision: default cut: the owner removed the setup-guide settings section (table 1b); the guide
  keeps its own view. Revive via DECISIONS.md.
Source: D-16-021

### ONB-034 · Hosted-browser tour for remote setups
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: would be led to the setting for a browser hosted on the client side.
User sees: a tour that opened the hosted-browser settings for remote workspaces.
Rules: it belongs to the remote and hosts area.
Acceptance:
  - [ ] No tour leads to a hosted-browser setting.
  - [ ] If revived with area 18: the tour opens the hosted-browser setting for a remote workspace.
Compat: —
Decision: default cut: the owner dropped area 18 (remote and hosts). Revive via DECISIONS.md.
Source: D-16-034

### ONB-040 · Computer Use setup inside the guide and the capabilities step
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: would turn on desktop control for agents from setup.
User sees: a Computer Use option ticked in advance while permissions still needed setting up, with a
  warning when the macOS helper app was missing.
Rules: builds without it left the option unticked, and it never held back completion.
Acceptance:
  - [ ] The capabilities list offers no Computer Use option.
  - [ ] If revived: an unavailable build leaves it unticked and setup still completes.
Compat: —
Decision: default cut: the owner dropped computer use (table 1b). Revive via DECISIONS.md.
Source: D-16-040

## Dropped by default (tier D)

- ONB-019 · Other code hosts and trackers in the setup guide and Explore Kolux — the owner dropped
  every code host and tracker except GitHub (table 1b).
- ONB-021 · Onboarding checklist section in Settings — table 1b removes the settings section; the
  Setup Guide keeps its own dialog.
- ONB-034 · Hosted-browser tour for remote setups — goes with area 18, remote and hosts.
- ONB-040 · Computer Use setup inside the guide and the capabilities step — computer use is cut by
  the owner (table 1b).

## Hidden or retired (tier H)

- ONB-013 · Newcomer setup checklist with four plain first-success items · half-done at 0.15.0
  (unreachable because of a version gate) · default build
- ONB-030 · Voice dictation tip · retired 2026-10-05 with desktop voice and dictation · default skip
- ONB-035 · Development builds hold back first-run education · dev-only (development builds; a
  developer variable opts back in) · default skip
- ONB-039 · Telemetry events for onboarding, tours, tips and the star prompt · hidden (telemetry
  compiled off) · default skip
- ONB-041 · Retired first-run screens · retired 2026-10-04 (five-step wizard replaced 2026-09-28;
  default-view screen removed 2026-10-04) · default skip
