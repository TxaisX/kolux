# 02 · Sessions & launching

This area covers every way a user starts an AI coding agent or a plain terminal in Kolux. It
decides which agents are offered (only those really installed, out of a catalogue of about 35),
what the plus menu and the create menu on the tab bar contain, how an empty chooser pane works,
and how the New session page and the older launch dialog let the user pick a shape (Solo, Pair,
Workbench, Swarm) with roles, a session count, and whether every agent works in a worktree of its
own. It
also covers per-seat agent and model choices, saved lineups and the last-used lineup, how the
opening prompt reaches an agent, how sessions come back after a quit, the side doors that start an
agent from a failing check, an issue or another agent's conversation, and the new workspace
composer. The custom-agent builder is cut by default.

Tier counts: P0 14 · P1 25 · P2 2 · H 3 · X 1 · D 6

Related areas: 01 Projects, repos & worktrees · 03 Terminals & panes · 04 Agent status, hooks &
notifications · 05 Views & navigation · 06 Usage & limits · 07 Accounts, sign-in & keys ·
08 Orchestration · 10 Plan review & protected actions · 11 Git, source control & review ·
12 Editor & files · 13 Browser pane & computer use · 14 Native chat · 15 Skills, plugins & starter
kits · 16 Onboarding & guidance · 17 Settings, appearance & input · 18 Remote & hosts (dropped) ·
19 App lifecycle & operations · 21 Hidden, retired, removed

## Cards

### SESS-001 · Launch choices list only agents that are really installed
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: installs one or more agent command-line tools, then opens any screen or menu that
  starts a session.
User sees: only agents whose program is actually on this machine can be started; the remainder of
  the catalogue (about 35 agents) is either kept out of sight or marked as not installed.
Rules: an agent counts as installed only when a program that can actually run is found; a folder
  or an ordinary file bearing the agent's name does not count; when Kolux is opened from the
  desktop with a short search path, it first reads the search path the user's shell would use and
  also looks in each agent's usual install location; an agent found two ways appears once; if the
  lookup itself fails, the agent counts as missing; detection walks the search path directly
  instead of spawning a separate lookup process per agent; Mistral Vibe is detected by its short
  command name and an older second entry for it is merged in; agents installed through a Node
  version manager are found under that manager's default version, else its newest version, and
  also when the program sits outside the version folder; on Windows, agents installed as
  command-script shims are run through the command shell so they start like any other program;
  the catalogue has 34 visible agents, and menus that fall back to catalogue order use this
  numbering: 1 Claude Code · 2 OpenClaude · 3 Codex · 4 Autohand Code · 5 Ante · 6 Trae ·
  7 MiMo Code · 8 Pi · 9 OMP · 10 Prime Agent · 11 Gemini CLI · 12 Antigravity · 13 Aider ·
  14 Goose · 15 Amp · 16 Kilo Code · 17 Kiro · 18 Crush (from Charm) · 19 Auggie · 20 Cline ·
  21 Codebuff · 22 Command Code · 23 Continue · 24 Cursor · 25 Droid · 26 Kimi · 27 Mistral Vibe ·
  28 Qwen Code · 29 Rovo Dev · 30 Hermes · 31 OpenClaw · 32 GitHub Copilot · 33 Grok ·
  34 Devin; a hidden 35th entry, Claude Agent Teams (SESS-042), sits right after Claude Code.
  (Kolux, T-007-a-fix: on Windows "the search path the user's shell would use" is the machine
  Path then the user Path from the registry, expanded; on macOS and Linux the process PATH plus
  the usual install folders stand for it, DT-C10.)
Acceptance:
  - [x] Install only Claude Code and Codex, open the plus menu → exactly those two agents are offered. (cards; evidence/cards-SESS-001.txt)
  - [x] Launch Kolux from the Start menu while an agent exists only in its default install location → that agent is still offered. (cards; evidence/cards-SESS-001.txt)
  - [x] Put a non-executable file named after an agent on the search path → that agent is not offered. (cards; evidence/cards-SESS-001.txt)
Compat: every agent keeps a stable id; settings, saved shapes and per-agent shortcut ids refer to
  agents by it.
Source: D-02-001

### SESS-004 · One click on the plus menu starts an agent in a new pane
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: clicks the plus button on the tab bar and chooses an agent.
User sees: the grid splits to make a fresh pane and the agent starts inside it; the default agent
  is listed first with its keyboard shortcut beside it.
Rules: the menu lists only agents that are detected and switched on, the default first and the
  rest in catalogue order; each launch gets a fresh pane and never takes over a pane already in
  use; one item opens agent settings; when an agent is set to open as chat (a flag that is off by
  default), a temporary starting row shows until it is ready.
Acceptance:
  - [x] Click plus, then Claude Code → a new pane appears with Claude Code running in it. (cards live; evidence/cards-SESS-004.txt)
  - [x] Make Codex the default → Codex moves to the top of the plus menu with its shortcut shown. (cards; evidence/cards-SESS-004.txt)
Compat: —
Source: D-02-004

### SESS-007 · An empty pane asks what to run
Tier: P0 · Pushed: 1 · State at 0.15.0: live
User does: adds a pane, or picks Choose agent, and arrives at a pane where nothing runs yet.
User sees: a chooser showing the session's number, one group of choices for which AI (or a plain
  terminal; custom agents are cut), then a separate model row; Start stays greyed out until both
  picks are made.
Rules: an AI cannot start until a model is picked explicitly, and the model row asks for one until
  then; a plain terminal needs no model; a pick that stops being detected is cleared rather than
  swapped for something else; the chooser can be closed unless it is the grid's only pane; the AI
  group and the model group each behave as their own radio group for keyboard and screen-reader
  users; the verification on record predates the empty-pick rule, so the rebuild verifies that
  rule afresh.
Acceptance:
  - [x] Open a chooser pane and pick Claude Code with no model → Start is disabled; pick a model → Start becomes enabled. (cards; evidence/cards-SESS-007.txt)
  - [x] Pick Terminal → Start is enabled at once. (cards; evidence/cards-SESS-007.txt)
  - [x] Leave a chooser as the grid's only pane → it has no close button. (cards live; evidence/cards-SESS-007.txt)
Compat: —
Source: D-02-007

### SESS-013 · Choose how many sessions to start
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: sets a session count before launching.
User sees: quick-pick count buttons and a field for any number; the seat list grows or shrinks to
  match.
Rules: the older dialog offers 1 through 12 plus "More…" for any number, never below 1; the New
  session page offers 1, 2, 3, 4, 6 and 8 (the rebuild should settle on one set); new seats arrive
  empty and never copy another seat's agent; shrinking removes seats from the bottom; one launch holds
  at most 24 seats (each may make a worktree), and growing the lineup past 8 asks first (DT-C116).
Acceptance:
  - [x] Set the count to 3 → three empty seats; set it to 2 → the third seat goes and the first two are untouched. (cards; evidence/cards-SESS-013.txt)
  - [x] Enter 15 in the free field → Kolux asks once, then fifteen seats appear; 500 gives 24. (cards; evidence/T-680.txt)
Compat: —
Source: D-02-013

### SESS-015 · Every seat needs an AI and a model the user chose; nothing is guessed
Tier: P0 · Pushed: 1 · State at 0.15.0: live
User does: completes each seat in the lineup, perhaps with "Same for all".
User sees: every seat begins blank; a short caption makes clear that Kolux will not choose on the
  user's behalf; launch stays disabled until each seat is finished; Same for all copies the first
  finished seat into the others.
Rules: switching a seat's agent resets its model to that agent's own list; the Same for all
  button stays greyed out until at least one seat is complete; choices that are no longer available are cleared, never
  replaced; a seat may be a plain terminal instead of an AI, and then it has no model step; the
  verification on record predates this blank-seat rule, so the rebuild verifies it afresh.
Acceptance:
  - [x] Open the launch screen with 3 seats → all are blank and launch is disabled. (cards; evidence/cards-SESS-015.txt)
  - [x] Finish seat 1, click Same for all → seats 2 and 3 copy it and launch becomes enabled. (cards; evidence/cards-SESS-015.txt)
Compat: —
Source: D-02-015

### SESS-024 · Launched sessions land one per pane, titled by seat
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: clicks launch on a lineup with several seats.
User sees: a toast says how many sessions are starting; each gets its own pane and the grid
  re-tiles; a seat's job title becomes its tab title, and tabs without one read Terminal N.
Rules: a seat's title wins over any title the agent sets later; a pane whose session fails to
  start is removed rather than left blank; a kit launch reuses a single untouched idle tab instead
  of leaving it behind, and no other kind of launch does this; an untouched tab means a freshly
  opened shell tab that was never renamed, has no agent attached and is not midway through
  choosing one; with no project folder an error toast explains why, and if nothing started at all
  a toast says so; the lineup is remembered only if at least one agent seat started.
Acceptance:
  - [x] Launch 4 seats → 4 panes in a re-tiled grid, each tab named after its seat. (cards live; evidence/cards-SESS-024.txt)
  - [x] Make one seat fail to start → 3 panes and no blank one. (cards; evidence/cards-SESS-024.txt)
Compat: —
Source: D-02-024

### SESS-014 · Separate copy per agent, or one shared folder
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: picks "Separate copy for each AI" or "Same folder for all" before launching.
User sees: in a git project with two or more seats, separate copies is already selected; picking
  the shared folder brings up a warning that several agents would be editing the same files, plus
  a one-click fix labelled "Give each its own copy" that switches back.
Rules: the default is one copy per seat for 2+ seats in a git project, and the shared folder for a
  single seat or a folder outside git; outside git the separate-copy option is disabled with a
  short explanation; plain terminal seats always open in the current folder, whichever option is
  chosen.
Acceptance:
  - [x] Open the launch screen with 3 seats in a git project → separate copies is selected. (cards; evidence/cards-SESS-014.txt)
  - [x] Switch to the shared folder → a warning with a fix button appears; click the fix → separate copies is selected again. (cards; evidence/cards-SESS-014.txt)
  - [x] Open the launch screen on a folder outside git → the separate-copy option is disabled and explained. (cards; evidence/cards-SESS-014.txt)
Compat: —
Source: D-02-014

### SESS-023 · Each launched agent gets its own worktree with a creature name
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: launches several agent seats with separate copies chosen.
User sees: each agent opens in a brand-new worktree carrying a generated, creature-style name; the
  worktrees are made in the background so the screen stays responsive.
Rules: a generated name never repeats a current or retired worktree name; each seat brings its own
  model, effort and options and always starts as a terminal session; the count picker, up to 24 seats
  a launch, is the only limit on how many seats launch.
Acceptance:
  - [x] Launch 3 Codex seats with separate copies → 3 new worktrees with different names, one agent in each. (cards; evidence/cards-SESS-023.txt)
  - [x] Launch again in the same project → none of the new names repeats an earlier one. (cards; evidence/cards-SESS-023.txt)
Compat: —
Source: D-02-023

### SESS-027 · Agents start in their own no-prompt approval mode by default
Tier: P0 · Pushed: 5 · State at 0.15.0: live
User does: starts any supported agent without custom arguments.
User sees: each agent runs in the mode where it does not stop to ask for approval: Claude Code in
  auto permission mode (since 2026-10-05), Codex with both approvals and sandbox bypassed, Gemini
  CLI in yolo mode, Aider answering yes to everything, Goose in auto mode.
Rules: default arguments the user sets replace the built-in ones; an argument an agent does not
  accept is removed (Kilo Code); Goose receives its mode through an environment variable rather
  than a flag.
Acceptance:
  - [x] Start Claude Code from the plus menu → its process runs in auto permission mode. (cards; evidence/cards-SESS-027.txt)
  - [x] Give Codex custom default arguments → those are used instead of the built-in ones. (cards; evidence/cards-SESS-027.txt)
Compat: the built-in no-prompt switches, spelled exactly as each agent's own command line
  expects them: for Claude Code, `--permission-mode` with the value auto; for Codex,
  `--sandbox` with the value workspace-write and `--ask-for-approval` with the value never (DT-C46:
  sandboxed, never asks; the bypass flag is never used); for Gemini CLI, `--yolo`; for Aider,
  `--yes-always`; for Goose, its mode environment variable given the value auto (the variable's
  exact name waits on a firewall allowlist entry).
Source: D-02-027

### SESS-018 · The New session page takes over the workspace instead of a dialog
Tier: P0 · Pushed: 7 · State at 0.15.0: live-unverified
User does: starts a new session on the new look (or the clean grid layout).
User sees: a full-page sheet headed New session showing the project and its path, with sections
  for saved teams, how many sessions, what runs in each, a link to add more agents, and the files
  choice; its footer names the first seat still incomplete and holds Cancel plus a launch button
  showing its shortcut.
Rules: the page belongs to the new look, while the older look keeps the dialog (SESS-019); the
  count and the files choice start from this project's previous launch, but seats still start
  blank; Ctrl+Enter (Cmd+Enter on Mac) launches only when every seat is complete; Escape closes
  the page; the add-agents link opens AI connections in Settings and must not name retired agents
  such as OpenCode.
Acceptance:
  - [x] Open New session → a full-page sheet fills the workspace area. (cards live; evidence/cards-SESS-018.txt)
  - [x] With one blank seat, press Ctrl+Enter → nothing starts and the footer names that seat. (cards; evidence/cards-SESS-018.txt)
  - [x] Press Escape → the page closes. (cards; evidence/cards-SESS-018.txt)
Compat: —
Source: D-02-018

### SESS-030 · Agent sessions resume after a quit or a crash
Tier: P0 · Pushed: 9 · State at 0.15.0: live-unverified
User does: quits Kolux (or it is killed) with agents running, then reopens the worktree.
User sees: each sleeping session picks up in its pane with its conversation intact, through the
  agent's own resume command; the tab list and the panes agree.
Rules: works for every agent that can resume, among them Claude Code, Codex, Devin, Copilot and
  Kimi; a resume never runs twice and does not pull focus away from where the user is working;
  resuming Claude Code never lands in its interactive pick-a-session screen by accident; on
  Windows the resume command is quoted correctly for the shell; restored sessions and tabs are
  matched up so nothing is doubled or lost. (Kolux, T-066: the session id comes from the agent's
  own hook events and is kept in the saved layout; Claude Code and Codex are wired, the others in the
  catalogue come back at their prompt until T-066-b; a resume starts on the agent's standing start
  line, so its permission mode and the user's own arguments return with it.)
Acceptance:
  - [x] Run Claude Code, quit, reopen → the same conversation carries on in the same pane. (cards live; evidence/cards-SESS-030.txt)
  - [x] Kill Kolux during a session and reopen → the session resumes. (cards live; evidence/cards-SESS-030.txt)
  - [x] On Windows, with a project path that contains spaces → resume still starts. (cards; evidence/cards-SESS-030.txt)
Compat: —
Source: D-02-030

### SESS-012 · Launch shapes Solo, Pair, Workbench and Swarm assign roles
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: chooses a shape while launching several sessions together.
User sees: Solo is one builder; Pair is a builder plus a reviewer; Workbench is a scout, a builder
  and a reviewer; Swarm is a scout, two builders, a tester and a reviewer; Custom carries no roles.
  Every seat shows its role, and the role's short brief goes ahead of the shared task.
Rules: the four roles are builder, reviewer, scout and tester, each with its own brief; seats
  beyond the number of roles wrap round to the first role again; dropping the count below the
  shape's number of roles turns the shape into Custom, while raising it keeps the shape; a seat's
  first message puts the role's brief first and the shared task after it, or sends the brief by
  itself when no task was typed;
  the whole lineup is visible for review before anything starts.
Acceptance:
  - [x] Pick Swarm → five seats labelled scout, builder, builder, tester, reviewer. (cards; evidence/cards-SESS-012.txt)
  - [x] Pick Workbench, then change the count to 2 → the shape reads Custom. (cards; evidence/cards-SESS-012.txt)
  - [x] Launch Pair with a task → each session's first prompt begins with its role brief, then the task. (cards; evidence/cards-SESS-012.txt)
Compat: —
Source: D-02-012

### SESS-025 · Agents launched side by side get a rules block and keep a handoff note
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: launches a shape with two or more seats.
User sees: every agent's opening prompt holds the task followed by a short rules block: other
  agents are working alongside it, it must stay inside its own worktree, it must keep a handoff
  note current after each change, and it must check how it uses any library against up-to-date
  documentation before claiming it is done.
Rules: the rules block is left out wherever the prompt is shown back to the user; the handoff note
  exists before the first change; a single-seat launch gets no rules block.
Acceptance:
  - [ ] Launch Pair with a task → each agent writes its handoff note before editing anything, and the
        prompt shown to the user holds the short role brief and the task, with no rules block.
        (Reworded per Txais 2026-10-28 decisions file, A; still open: REAL-AGENT.)
  - [x] Launch Solo with a task → the agent's opening prompt carries no rules block. (cards; evidence/cards-SESS-025.txt)
Compat: one handoff note per worktree, a markdown file kept in the project's hidden Kolux folder
  and named after the worktree.
Source: D-02-025

### SESS-051 · Each catalogue agent's program, start line and opening-prompt route
Tier: P0 · Pushed: 1 · State at 0.15.0: live-unverified
User does: starts any catalogue agent from any launch route, with or without an opening prompt.
User sees: that agent's own program opens in the pane on its interactive screen, the prompt
  arrives by the route that agent accepts, and the pane is credited to the agent while its
  program is in front.
Rules: one program name per agent decides that it is installed and also marks it as running in
  the foreground: Claude Code claude · OpenClaude openclaude · Codex codex · Autohand Code
  autohand · Ante ante · Trae traecli · MiMo Code mimo · Pi pi · OMP omp · Prime Agent
  prime-agent · Gemini CLI gemini · Antigravity agy · Aider aider · Goose goose · Amp amp ·
  Kilo Code kilo · Kiro kiro-cli · Crush crush · Auggie auggie · Cline cline · Codebuff codebuff ·
  Command Code command-code · Continue cn · Cursor cursor-agent · Droid droid · Kimi kimi ·
  Mistral Vibe vibe · Qwen Code qwen · Rovo Dev rovo · Hermes hermes · OpenClaw openclaw ·
  GitHub Copilot copilot · Grok grok · Devin devin; second names that count too are kimi-code
  for Kimi (the name its launcher turns into) and mistral-vibe for Mistral Vibe (older
  installs); Trae is looked up as traecli because an unrelated open-source tool ships a program
  with a near-identical name, Continue as cn because the plain word is a shell keyword, and
  Command Code by its full name because its short alias clashes with the Windows command shell;
  Claude Agent Teams (hidden, SESS-042) counts as installed only when a kolux command (release,
  development or Linux-renamed) and claude are both present, starts through
  `kolux claude-teams`, and has claude as its foreground program, yet a running claude is always
  credited to Claude Code itself; foreground matching ignores letter case, the folder part and
  Windows program endings, and also accepts the first word of the agent's start line, Codex and
  Grok builds whose names begin with the agent's name and a dash, and agents run through a
  script interpreter, recognised by their own entry script.
  Fixed start arguments: Kiro starts with its chat subcommand and `--tui`, landing directly on
  its chat screen; Command Code starts with `--trust` so its first-run folder question cannot
  swallow the prompt; Hermes starts with `--tui`, its full-screen interface rather than its plain
  line mode; every other agent starts as the bare program, plus the user's default arguments and
  per-seat model choices (SESS-028, SESS-029).
  Opening prompt, per agent: as a trailing argument for Claude Code, OpenClaude, Codex, Trae, Pi,
  OMP, Prime Agent, Command Code, Cursor, Droid and Grok (for Trae, Prime Agent and Grok an
  end-of-options double dash goes before the prompt, so a prompt beginning with a dash or reading
  like one of their subcommands is still taken as the task; Codex's start line is sent only once
  the pane's shell is ready); behind `--prompt` for MiMo Code; behind `--prompt-interactive`,
  submitted while the session stays open, for Gemini CLI and Antigravity; behind GitHub
  Copilot's interactive switch (the one-letter form of `--interactive`), because its plain prompt
  option quits once the task is done and would end the pane's session; through Hermes's own query
  option (its chat subcommand with `--query` and `--tui`), where Hermes itself waits for its
  input box and submits once, the prompt is handed over so that tools Hermes later runs never see
  it, the user's own Hermes arguments are kept but any query or interface-mode arguments the user
  set give way to Kolux's, and a start line plus prompt past about 24,000 characters is refused
  and reported (SESS-005); typed in once the agent is ready (SESS-032) for Autohand Code, Ante,
  Aider, Goose, Amp, Kilo Code, Kiro, Crush, Auggie, Cline, Codebuff, Continue, Kimi, Mistral
  Vibe, Qwen Code, Rovo Dev, OpenClaw, Devin and Claude Agent Teams, where Ante and Devin take
  this route on purpose, since Ante's own prompt option runs once and quits and Devin's start-up
  prompt submits instantly; a blank or spaces-only prompt counts as none, and the agent starts on
  its plain start line with nothing added.
  (Kolux, T-008-b-fix: "while its program is in front" is decided without a foreground poll:
  an agent Kolux starts is the pane's own program and is credited for its whole run; an agent
  typed into a shell is credited through its hooks when it has them, else not at all; DT-C11.)
Acceptance:
  - [x] Install Antigravity, Continue and Cursor only under agy, cn and cursor-agent → all three are offered; a program called plain kiro does not make Kiro count. (cards; evidence/cards-SESS-051.txt)
  - [x] Launch Grok with a prompt that begins with a double dash → Grok works on it as the task instead of reading it as an option. (cards; evidence/cards-SESS-051.txt)
  - [x] Launch GitHub Copilot with a prompt → it works the prompt and the session stays open in the pane. (cards; evidence/cards-SESS-051.txt)
  - [x] Launch Gemini CLI with a prompt → the prompt is submitted at start and the session stays interactive. (cards; evidence/cards-SESS-051.txt)
  - [x] Launch Aider with a prompt → Aider starts bare and the prompt is typed in once, after it is ready. (cards; evidence/cards-SESS-051.txt)
  - [x] Launch Kiro → it opens directly on its chat screen. (cards; evidence/cards-SESS-051.txt)
  - [x] Launch Hermes with and without a prompt → both open its full-screen interface; with a prompt, Hermes submits it exactly once. (cards; evidence/cards-SESS-051.txt)
  - [x] Run Kimi so its process shows as kimi-code → the pane is still credited to Kimi. (cards; evidence/cards-SESS-051.txt)
Compat: —
Source: D-02-051

### SESS-002 · Refresh agents finds a fresh install without a restart
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: installs an agent while the launch screen is open, then clicks "Refresh agents".
User sees: the newly installed agent becomes available on the spot; a seat whose agent has
  disappeared is emptied rather than handed a different agent.
Rules: one refresh triggers one detection pass; until the first pass finishes, no agent is marked
  not installed; a pass that errored looks different from one that found nothing, and launching
  stays blocked until a pass succeeds; a seat that loses its agent is left empty, never refilled
  with another one.
Acceptance:
  - [ ] With the launch screen open, install Gemini CLI and click Refresh agents → Gemini CLI can be chosen.
  - [ ] Uninstall the agent chosen for seat 2 and refresh → seat 2 is blank and launch stays disabled until it is filled.
Compat: —
Source: D-02-002

### SESS-003 · Turn individual agents off so launch menus skip them
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: turns some installed agents off, from "Hide agents" in the agent list or from Agents
  settings.
User sees: agents that are off vanish from the plus menu, the chooser pane, every dropdown and
  every launch seat; turning one back on brings it back.
Rules: choice lists leave out agents that are off and agents that are missing alike; when all
  installed agents are off, the plus menu says none are enabled and offers a way to agent
  settings; an agent that is off cannot be the default.
Acceptance:
  - [ ] Turn Codex off → it no longer appears in the plus menu or the chooser pane.
  - [ ] Turn all agents off → the plus menu shows an empty-state line with an item that opens agent settings.
Compat: the importer carries the user's list of turned-off agents.
Source: D-02-003

### SESS-006 · The create menu offers shells, an agent chooser, a browser and markdown
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens the create menu on the tab bar.
User sees: one new-terminal item per installed shell, "Choose agent..." (which opens the chooser
  pane), a browser tab, a new markdown file, and opening an existing markdown file.
Rules: choosing an agent from here opens an empty chooser pane and starts nothing; the mobile
  emulator entry left with area 18 (SESS-049).
Acceptance:
  - [ ] Open the create menu and pick Choose agent → a new pane asks what to run and nothing has started.
  - [ ] On a machine with two shells installed → the create menu shows a new-terminal item for each.
Compat: —
Source: D-02-006

### SESS-008 · Shortcuts add chooser panes or close sessions
Tier: P1 · Pushed: 1 · State at 0.15.0: live
User does: presses the add-session or remove-session shortcut (the on-screen stepper was removed
  on 2026-10-05).
User sees: adding opens new chooser panes with nothing started; removing closes chooser panes
  without asking, and asks first before closing a session that is running.
Rules: a grid holds between 1 and 12 panes; chooser panes close with no prompt; closing a running
  session asks at most once per press; neither shortcut has a default binding.
Acceptance:
  - [ ] Bind the add-session shortcut and press it twice → two new chooser panes appear.
  - [ ] With one running session and one chooser pane, press remove → the chooser closes silently; press again → a confirmation appears.
Compat: keybinding ids sessions.add and sessions.remove, both unbound by default.
Source: D-02-008

### SESS-010 · Choose a default agent
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: clicks "Set as default" on an agent row, or picks a default in Agents settings.
User sees: that row now shows it is the current default; the agent heads the plus menu and is the
  one the new-agent shortcut opens.
Rules: there is no default on a fresh install, so lists follow catalogue order; an agent that is
  uninstalled or switched off is not offered as the default.
Acceptance:
  - [ ] Make Grok the default → its row is marked as the current default and the new-agent shortcut opens Grok.
  - [ ] Turn Grok off → it is no longer offered as a default choice.
Compat: the importer carries the default agent (blank by default).
Source: D-02-010

### SESS-011 · Shortcuts open a new agent tab, a terminal or the workspace composer
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: presses the new-agent, a per-agent, the new-terminal or the new-workspace shortcut.
User sees: the default agent, that particular agent, a terminal, or the new workspace composer
  opens, respectively.
Rules: the shortcut for the default agent is bound out of the box only on Mac (Cmd+Alt+T) and
  is unbound on Windows and Linux; every catalogue agent has its own open-in-a-new-tab command,
  unbound by default; new terminal is Mod+T; create workspace is Mod+N or Mod+Shift+N.
Acceptance:
  - [ ] On Mac press Cmd+Alt+T → the default agent opens in a new tab.
  - [ ] On Windows, open the shortcut editor → the new-agent command is listed with no binding.
Compat: keybinding command ids a user may already have bound: workspace.create; the new-agent
  command in the tab group (one plain id, plus one per agent formed by adding a dot and that
  agent's stable id); and the new-terminal command in the tab group. Both tab ids are camel-cased,
  so their exact spelling is added here once the firewall allowlist accepts them.
Source: D-02-011

### SESS-016 · Effort, fast mode and role label per seat
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: changes a seat's options in the lineup.
User sees: an effort picker and a fast-mode checkbox show up when the chosen model supports them;
  the role label sits on the seat; a seat with no model option shows as using the default model.
Rules: options show only for models that advertise them; each seat holds its own model, effort and
  options independently of the others.
Acceptance:
  - [ ] Choose Claude Code with a model that has effort levels → the effort picker appears on that seat and no other.
  - [ ] Give a second seat a model without effort levels → that seat shows no effort picker.
Compat: —
Source: D-02-016

### SESS-021 · Use last lineup brings back this project's previous launch when asked
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: clicks "Use last lineup" on the launch screen.
User sees: the button lists the agents it remembers; clicking it puts back the shape, the files
  choice and every seat's agent and model.
Rules: remembered per project, and only once at least one agent seat has really started; never
  applied without the click; options and the prompt are not remembered; the button is hidden when
  none of the remembered agents is available any more.
Acceptance:
  - [ ] Launch Codex and Claude Code in project A, then reopen the launch screen → the button names both; click it → both seats are filled.
  - [ ] Open the launch screen in project B → there is no such button.
Compat: —
Source: D-02-021

### SESS-028 · Per-agent command, default arguments and environment
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: in Agents settings, overrides an agent's command or its default arguments, or adds
  environment variables for it.
User sees: every later launch of that agent uses the override.
Rules: overrides are per agent and blank by default; default arguments take the place of that
  agent's built-in permission flags.
Acceptance:
  - [ ] Point Aider's command at a wrapper script → the next Aider launch runs the wrapper.
  - [ ] Add an environment variable for Codex → the next Codex session starts with it set.
Compat: the importer carries each agent's command override, default arguments and default
  environment.
Source: D-02-028

### SESS-029 · Each agent's model list, discovered live for some
Tier: P1 · Pushed: 1 · State at 0.15.0: live-unverified
User does: opens the model choices for Claude Code, Codex, Gemini CLI, Cursor or Grok.
User sees: a model list with readable names; for Claude Code, Grok and Cursor the list comes from
  asking the installed program which models it has right now; effort levels appear wherever a
  model supports them.
Rules: Claude Code with nothing picked uses its top model at high effort, unless the user's own
  arguments already name a model or an effort; for Grok the discovered list replaces the built-in
  one, and Grok is given the model flag first and then effort, up to extra-high; when no friendly
  name exists, the label is built from the model id; an agent whose model was never picked starts
  with no model flag; a discovered model is dropped only if the agent itself marks it disabled,
  while banner text, mixed line endings and repeated entries in its listing are ignored; a listing
  in an unexpected format yields no discovered models at all, never a partial or guessed list; an
  effort choice the user never touched stays at the model's own default (high for Grok) and never
  raises itself; a model the user picked always beats a built-in default model.
Acceptance:
  - [ ] Install a Grok version that adds a model → the new model shows in Grok's list without updating Kolux.
  - [ ] Make an agent's model listing come back in an unexpected format → the list holds no discovered models, never a partial one.
Compat: —
Source: D-02-029
Amended 2026-10-12 (DT-R67): Claude Code publishes no model-listing command, so its list stays built in; Grok and Cursor are asked.

### SESS-035 · New workspace composer: pick the project
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: opens the new workspace composer and chooses a project.
User sees: a searchable project list split into Recent and Projects, an "Add project" entry, and
  the typed letters highlighted within each match.
Rules: recent projects come first, then match quality decides; projects sharing a name show
  enough of their path to tell them apart, with long text shortened in the middle; Enter takes
  the highlighted project, and Escape closes only the list, not the composer.
Acceptance:
  - [ ] With two projects both named api → both show, each with a different path hint.
  - [ ] Type part of a name → matching letters are highlighted and the best match leads.
Compat: —
Source: D-02-035

### SESS-036 · The workspace name can come from a branch or a GitHub item
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: types a name, or picks an existing branch or a GitHub issue or pull request, in the
  name field.
User sees: suggestions drawn from branches and from GitHub; choosing one fills in the name; emoji
  shortcodes turn into emoji; a name that reduces to nothing once cleaned up becomes workspace.
Rules: pasting a GitHub link resolves it to that item; Enter during input-method composition does
  not submit; Shift+Enter in the note adds a new line rather than submitting; overlong lookup text
  is refused; GitHub items are looked up in the chosen project's own repository without asking
  which repository.
Acceptance:
  - [ ] Type an existing branch's name → it is suggested; pick it → the workspace uses that branch.
  - [ ] Paste a GitHub issue link → the issue appears and its title seeds the name.
Compat: —
Source: D-02-036

### SESS-037 · Composer parent worktree and Advanced options
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: picks a parent worktree and opens Advanced in the composer.
User sees: a parent picker reading "No parent" until one is chosen; Advanced holds the branch
  name, an option to reuse an existing branch, the setup policy and whether to wait for setup to
  finish; an optional note field grows with its text.
Rules: no parent by default; reusing a branch checks out the existing one rather than making a new
  branch; the branch-name field appears only for git projects; Enter in the parent picker with an
  empty search resets the parent to none.
Acceptance:
  - [ ] Open the composer → the parent reads No parent; open Advanced → branch name, reuse and setup options show.
  - [ ] Choose a parent, clear the search and press Enter in the parent picker → the parent goes back to No parent.
Compat: —
Source: D-02-037

### SESS-038 · Create workspace, Create more, and what guards them
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: clicks "Create workspace", or ticks "Create more" to make several one after another.
User sees: Create stays disabled until the form is valid; with Create more ticked the composer
  stays open and drops the linked GitHub item, ready for the next one; when the composer opens,
  focus lands in the right field.
Rules: Enter submits only from fields where submitting makes sense; switching project keeps a
  tracker link that is not bound to a repository but drops a GitHub item that belongs to the old
  repository; long project names stay inside the cross-project dialog; a failed worktree creation
  is retried according to policy, and cancelling mid-submit leaves no half-built workspace.
Acceptance:
  - [ ] Tick Create more and create one → the composer stays open with the linked item cleared.
  - [ ] Link a GitHub issue, then switch project → the link is cleared.
Compat: —
Source: D-02-038

### SESS-022 · Warning before launching close to a usage limit
Tier: P1 · Pushed: 4 · State at 0.15.0: live-unverified
User does: opens the launch screen while some provider has used 80 % or more of a usage window.
User sees: a warning line for each affected provider that blocks nothing; it names the agent when
  one seat is affected or gives a seat count when several are, plus an estimated reset time when
  Kolux knows it.
Rules: the session window is checked first, then the weekly one, then the monthly one; the warning
  never stops a launch; no line shows while every relevant window is under 80 %.
Acceptance:
  - [ ] With Claude at 85 % of its session window, open the launch screen with 3 Claude seats → one warning line counts 3 sessions and gives a reset time.
  - [ ] Choose an agent whose session window is at 40 % → no warning line.
Compat: —
Source: D-02-022

### SESS-026 · Setup scripts and hook trust are settled before any agent starts
Tier: P1 · Pushed: 5 · State at 0.15.0: live-unverified
User does: launches agents in a project that has a setup script or repo hooks.
User sees: Kolux asks the user to trust the project's setup before it runs; by default the setup
  runs in a new tab; a project set to ask about setup for each workspace cannot be bulk-launched,
  and Kolux says so.
Rules: the default setup mode is a new tab; a bulk launch refuses a project that asks per
  workspace, with an error toast.
Acceptance:
  - [ ] Launch two seats in a project whose setup script is not yet trusted → a trust prompt appears before any agent starts.
  - [ ] Set a project to ask about setup for each workspace, then bulk-launch → an error toast appears and nothing starts.
Compat: the importer carries the launch mode for setup scripts (new tab by default).
Source: D-02-026

### SESS-017 · Featured agent cards show what is missing and how to set it up
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: looks over the agent grid on the launch screen.
User sees: Claude Code, Codex and Grok cards come first and the rest are folded away; a featured
  agent that is not installed is greyed out and carries a set-up link pointing to AI connections;
  any agent can link out to its own documentation.
Rules: nothing is labelled not installed while detection is still running; with no agents found at
  all, an empty state says no AI programs have been found yet; the set-up link opens Settings at
  AI connections; for the keyboard, the agent cards and the plain-terminal option form a single
  choice group with one tab stop, and once the choice is made outside the cards they leave the
  tab order.
Acceptance:
  - [ ] Without Grok installed → the Grok card is disabled with a set-up link; clicking it opens AI connections in Settings.
  - [ ] While detection is still running → no card reads not installed.
Compat: —
Source: D-02-017

### SESS-019 · The older launch dialog with starter kits and a folded Advanced section
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: opens the launch dialog on the older look.
User sees: a row of starter kits with a see-all link into the kit gallery, an optional prompt sent
  to every session, and an Advanced section (shape, count, files choice) that folds away once a
  kit is chosen; the footer counts the sessions and flags any seat still lacking an AI.
Rules: with no kit chosen, the advanced controls sit in the open; launch stays disabled until each
  seat has an AI.
Acceptance:
  - [ ] Choose a kit → Advanced folds; clear the kit → shape, count and files choice are visible.
  - [ ] Leave one seat without an AI → launch is disabled and the footer says so.
Compat: —
Source: D-02-019

### SESS-009 · Agent dropdown leads with three featured agents and searches the rest
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: opens an agent dropdown, then types or clicks "Show more agents".
User sees: Claude Code, Codex and Grok at the top, every other agent folded behind a show-more
  toggle; typing reaches any agent, folded or not; at the bottom sit a blank-terminal row and
  "Manage agents".
Rules: if none of the three featured agents is installed, the full list shows unfolded; the list
  folds again each time it reopens; search ranks a match on the shown name above an alias match,
  then initials, then command names; typing terminal or shell brings up the blank-terminal row; an
  overly long search string is ignored so the list stays quick; agent icons ship inside the app
  and are never downloaded.
Acceptance:
  - [ ] Open the dropdown → only Claude Code, Codex and Grok are visible; type aid → Aider shows.
  - [ ] Type shell → the blank-terminal row is offered.
Compat: —
Source: D-02-009

### SESS-005 · The user hears about an agent that will not start
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: starts an agent whose launch command cannot be put together, or whose process never
  shows up.
User sees: an error toast naming the agent that failed; if no terminal process has appeared after
  roughly five seconds, a warning toast reports it.
Rules: a launch command that cannot be built is reported immediately, with the agent's name; the
  five-second check fires only when there is no process at all, not when the agent is merely slow
  to paint; both empty states (no agents found, none switched on) offer a way to agent settings.
Acceptance:
  - [ ] Override an agent's command to point at a program that does not exist, then launch it → a failure toast appears within about five seconds.
  - [ ] Remove every agent → the plus menu shows the no-agents line instead of an empty list.
Compat: —
Source: D-02-005

### SESS-032 · The opening prompt reaches the agent exactly once, or the user is told
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: launches an agent with a prompt.
User sees: the prompt goes in as soon as the agent is ready for input; if it cannot be delivered,
  a toast says it was not sent.
Rules: delivery waits until the agent can take input; one prompt is never delivered twice; each
  agent takes its opening prompt in its own way: as a command-line argument, through a prompt
  flag, through its own start-up question (Hermes), or typed in after it starts; a typed prompt
  goes in as one pasted block so its line breaks stay inside the prompt, and is submitted as a
  separate step; on Windows the pause before submitting grows with the prompt's length; for agents
  started behind an interpreter wrapper, the prompt is typed only once the real agent is running,
  never into the bare shell.
Acceptance:
  - [ ] Launch a slow-starting agent with a prompt → the prompt appears once, after the agent is ready.
  - [ ] Launch with a multi-line prompt → it arrives as one prompt with its line breaks intact and is submitted once.
Compat: —
Source: D-02-032

### SESS-020 · Save a lineup as a shape or team and use it again
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: clicks "Save as team" on the New session page (or the save-as-shape action in the
  dialog), names it, and picks it later.
User sees: the saved lineup sits alongside the built-in shapes; its menu can rename or delete it,
  and the toast after a delete offers to undo.
Rules: saving is disabled until each seat has an AI; a saved lineup keeps every seat's agent,
  model, options and role; restoring never puts in a different AI, so a seat whose agent is
  unavailable comes back blank; a name clash, compared without regard to case, gets a rising
  number appended; limits are 40 saved shapes, 60-character names, 12 seats and a 4000-character
  prompt; renaming to a blank name does nothing, and a rename touches only that shape.
Acceptance:
  - [ ] Save a Pair lineup as Review crew → it shows in the shape list; pick it → both seats fill back in.
  - [ ] Delete it → a toast with Undo appears; Undo → it returns.
Compat: the importer carries saved shapes: the name, each seat's agent, model, options and role,
  the files choice and the optional prompt.
Source: D-02-020

### SESS-031 · Carry a conversation over to a different agent
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: chooses to continue the current session in another agent.
User sees: a dialog for choosing the target agent; the new session starts with the earlier
  conversation's transcript as context.
Rules: the dialog pre-selects the source agent if it is still available, otherwise the saved
  default, otherwise the first available agent; the new session opens in the same workspace and
  folder; an unavailable target means nothing launches; a failed hand-over of the prompt is
  reported apart from a failed launch; the context passed along is a trimmed transcript, not the
  raw log.
Acceptance:
  - [ ] From a Claude Code session, continue in Codex → Codex opens with the earlier conversation as its context.
  - [ ] Pick a target agent that has just been uninstalled → nothing launches.
Compat: —
Source: D-02-031

### SESS-033 · Start an agent to fix failing checks
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: clicks the fix action beside failing pull-request checks.
User sees: an agent session starts in that worktree with the failing checks as its task.
Rules: if the worktree no longer exists, no agent is switched on, or the saved arguments are
  invalid, nothing starts and an error is shown; a launch that errors out does not take terminal
  focus.
Acceptance:
  - [ ] On a worktree with a failing check, click fix → a new agent pane opens with the failure details.
  - [ ] Turn every agent off, then click fix → nothing launches and an error appears.
Compat: —
Source: D-02-033

### SESS-034 · Start an agent directly from an issue
Tier: P1 · Pushed: 11 · State at 0.15.0: live-unverified
User does: starts work on a GitHub issue or pull request from its row.
User sees: a worktree is created for the item and an agent starts there with the item as its
  opening prompt.
Rules: a pull request checks out its own branch and puts its short number in the workspace name,
  while an issue link that merely looks like a pull request stays an issue; bad per-launch
  arguments are rejected before any workspace is made; a saved agent that is switched off is never
  launched; trackers other than GitHub are cut (SESS-046).
Acceptance:
  - [ ] Start work on an issue → a new worktree with an agent running and the issue as its prompt.
  - [ ] Start work on a pull request → the worktree is on that pull request's branch and its name includes the number.
Compat: —
Source: D-02-034

### SESS-040 · Busy spinners and tab titles credit the agent that was launched
Tier: P2 · Pushed: 3 · State at 0.15.0: live-unverified
User does: runs an agent and watches the worktree's busy dot and the tab title.
User sees: both are credited to the agent launched there, based on the terminal title that agent
  sets.
Rules: title patterns are recognised for MiMo, Pi-style agents and Cursor; the named agent is
  claimed only when the dot and the row agree.
Acceptance:
  - [ ] Launch Cursor's agent → its tab and the worktree dot show Cursor as working.
  - [ ] Launch MiMo Code → the tab and the dot credit MiMo while it works.
Compat: —
Source: D-02-040

### SESS-039 · Open a worktree in an outside editor
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: chooses to open the current worktree in VS Code, a JetBrains IDE, NeoVim or another
  editor.
User sees: that editor opens on the worktree's folder.
Rules: JetBrains launchers are located beside their install; command-line editors on Windows are
  started through the shell properly; NeoVim opens in a console window; the Remote-SSH variant is
  cut (SESS-047).
Acceptance:
  - [ ] Open in VS Code → VS Code opens on the worktree folder.
  - [ ] Open in NeoVim → a console window opens with NeoVim on the folder.
Compat: —
Source: D-02-039

### SESS-041 · Agents opening as native chat rather than a terminal
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: turns on the experimental flag that opens agents as chat, then starts Claude Code or
  Codex.
User sees: the session shows as a chat view instead of a raw terminal; if the chat runtime turns
  it down, a terminal is used instead.
Rules: the flag is off by default, so every launch route ends in a terminal; explicit chat
  requests and the adoption guard matter only with the flag on; the chat runtime's own machinery
  belongs to area 14.
Acceptance:
  - [ ] Default build: start Claude Code or Codex from any launch route → it opens in a terminal.
  - [ ] Only if revived: with the flag on, a refused chat start falls back to a terminal.
Compat: —
Decision: H: default skip
Source: D-02-041

### SESS-042 · Claude Agent Teams launch option
Tier: H · Pushed: 11 · State at 0.15.0: hidden
User does: switches on Agent Teams mode and launches Claude Code.
User sees: Claude Code starts as a team lead that can spawn teammates.
Rules: off by default; offered only when both the kolux command and Claude Code are installed, and
  never on native Windows or WSL; the kolux shim on its own does not count.
Acceptance:
  - [ ] Default build: no Agent Teams entry appears in any launch list.
  - [ ] Only if revived: on native Windows the entry is never offered.
Compat: —
Decision: H: default skip
Source: D-02-042

### SESS-043 · OpenCode taken out of the catalogue
Tier: H · Pushed: — · State at 0.15.0: retired 2026-09-23
User does: had picked OpenCode as an agent before it was removed.
User sees: old OpenCode picks are quietly cleared instead of breaking a launch.
Rules: a stored pick of the retired agent is migrated away, never launched.
Acceptance:
  - [ ] Import settings whose default agent is OpenCode → Kolux starts normally and OpenCode is offered nowhere.
  - [ ] Restore a saved lineup with an OpenCode seat → that seat comes back blank.
Compat: —
Decision: H: default skip
Source: D-02-043

### SESS-044 · Third-party agent logos in pickers
Tier: X · Pushed: — · State at 0.15.0: live-unverified
User does: looks at any agent list.
User sees: every agent row and card shows that vendor's logo.
Rules: these logos are vendor trademarks shipped inside the app; the rebuild needs its own or
  properly licensed marks.
Acceptance:
  - [ ] Every catalogue agent shows an icon that ships with the app.
  - [ ] No icon in the rebuild is a vendor mark used without a licence.
Compat: —
Source: D-02-044

### SESS-045 · Custom agent builder and custom agents as launch seats
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: builds a named agent from a template with its own instructions and picks it as a seat
  under Your agents.
User sees: the custom agent starts on its underlying AI with its instructions put first and a rule
  about a results folder.
Rules: limits were 100 agents, 60-character names and 4000-character instructions; each custom
  agent had a change scope (ask before every change, results folder only, or any file), and only
  that last one, any file, kept the agent's no-prompt approval mode; the department-agents plan
  wants a successor.
Acceptance:
  - [ ] Default build: no Your agents section appears in any chooser or lineup.
  - [ ] Default build: Settings has no page for building custom agents.
Compat: —
Decision: default cut: the Your agents settings section was cut (table 1b); the department-agents
  plan wants a successor. Revive via DECISIONS.md.
Source: D-02-045

### SESS-046 · GitLab, Linear and Jira sources in the workspace composer
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: seeds a new workspace from a GitLab issue, a Linear issue or a Jira ticket.
User sees: the item resolves in the name field and is linked to the workspace.
Rules: GitHub sources remain (SESS-036).
Acceptance:
  - [ ] Default build: pasting a GitLab, Linear or Jira link into the name field does not link an item.
  - [ ] Default build: GitHub links still resolve as in SESS-036.
Compat: —
Decision: default cut: providers other than GitHub left with the Linear and integrations settings
  sections. Revive via DECISIONS.md.
Source: D-02-046

### SESS-047 · Remote run targets, project location on a host, and the Remote-SSH editor
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: picks an SSH host or VM as the place to run, sets or clones the project's location
  there, or opens a remote worktree in VS Code over Remote-SSH.
User sees: agents launch on the remote machine and receive their opening prompt there.
Rules: all of this belongs to area 18.
Acceptance:
  - [ ] Default build: the launch screen offers no run target other than this computer.
  - [ ] Default build: the open-in-editor choices have no Remote-SSH entry.
Compat: —
Decision: default cut: remote hosts (area 18) dropped as a whole. Revive via DECISIONS.md.
Source: D-02-047

### SESS-048 · Running agents inside WSL
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: sets an agent to run inside a WSL distribution.
User sees: Kolux finds the agent inside that distribution and starts it there.
Rules: part of area 18.
Acceptance:
  - [ ] Default build: agent settings have no WSL run option.
  - [ ] Default build: detection looks only at the host machine (SESS-001).
Compat: —
Decision: default cut: WSL execution went with area 18. Revive via DECISIONS.md.
Source: D-02-048

### SESS-049 · Mobile emulator tab and coordinated simulator launches
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: picks a new mobile emulator from the create menu.
User sees: an iOS or Android emulator pane opens, and launches are coordinated so two never
  collide.
Rules: part of area 18.
Acceptance:
  - [ ] Default build: the create menu has no mobile emulator item.
  - [ ] Default build: no emulator pane can be opened from any menu.
Compat: —
Decision: default cut: the emulator pane went with area 18. Revive via DECISIONS.md.
Source: D-02-049

### SESS-050 · Sparse checkout while preparing a launched worktree
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: launches into a project set up for sparse checkout.
User sees: the new worktree holds only the configured folders.
Rules: per-repo sparse checkout is one of the cut repo settings.
Acceptance:
  - [ ] Default build: a launched worktree is a full checkout.
  - [ ] Default build: the per-repo page has no sparse checkout setting.
Compat: —
Decision: default cut: sparse checkout cut with the per-repo settings. Revive via DECISIONS.md.
Source: D-02-050

## Dropped by default (tier D)

- SESS-045 · Custom agent builder and custom launch seats · the Your agents settings section was cut; the department-agents plan wants a successor.
- SESS-046 · GitLab, Linear and Jira sources in the composer · providers other than GitHub were cut.
- SESS-047 · Remote run targets and the Remote-SSH editor · area 18 dropped.
- SESS-048 · Running agents inside WSL · area 18 dropped.
- SESS-049 · Mobile emulator tab · area 18 dropped.
- SESS-050 · Sparse checkout for launched worktrees · cut with the per-repo settings.

## Hidden or retired (tier H)

- SESS-041 · Agents opening as native chat · flag off by default · H: default skip.
- SESS-042 · Claude Agent Teams launch option · mode off by default · H: default skip.
- SESS-043 · OpenCode in the catalogue · retired 2026-09-23 · H: default skip.
