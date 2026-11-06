# SPEC

The front door of the Kolux specification. Read this file every pass, pick the one area file the
task needs from the table in part 2, and open only that file.

## 0. Owner changes after 0.15.0

- **2026-11-05, one folder.** Kolux works in one folder per project. A session launch does not
  create a worktree or any other copy of the project: every seat runs in the project folder.
  SESS-014 and SESS-023 are superseded. Automations run in the project folder, and the app hides
  the new-workspace buttons, the palette create row, the issue/PR start action and the workspaces
  folder setting. The sidebar shows one selectable folder row per project; old worktree rows stay
  hidden, and clicking the folder shows every pane opened there in one grid. Work still goes through a branch and a pull request, so every change has a
  reviewable record. The agent-issued `kolux worktree create` command and the backend PR/branch
  workspace commands still exist; removing them is the next change.
- **2026-11-06, the strip.** The layout strip keeps "Layout": quick counts 1, 2, 4, 6, 9 and 12
  plus a free field for any count from 1 to 24 (one launch's most seats), so 3, 5, 7 and other
  counts no longer need a split. The Preview button and its dev-server menu are gone, as are the
  New tab button and its menu; panes and tabs are added with a pane's split or plus, the sidebar's
  New session, and the existing shortcuts. Start on a chooser opens every seat in the folder the
  chooser is in, so the whole lineup lands in the same grid.

## 1. What this is

This is the behaviour spec of Kolux as it stood at version 0.15.0: what the user does, what the user
sees, the rules that hold, and how to check each one. It was written on 2026-10-06 by a dirty-room
team that read the old app, its tests, its registries and its project records, then rewrote
everything as behaviour in fresh words; each file passed the automated firewall check before it
reached this repo, so no code, identifiers, file names or copied sentences cross over. The clean
room builds Kolux from this index, the 20 area files in the spec folder, and the companions
`PRIORITIES.md` (build order), `COMPAT.md` (contracts kept exactly) and `DECISIONS.md` (what is
hidden, retired or dropped, and its default). Read one area file per pass, never the whole set: the
files run from about 600 to 1,900 lines, so search for the card id heading you need and read around
it.

## 2. The 21 areas

Counts are the cards in each file by tier (P0 · P1 · P2 · H · X · D), recounted from the cards
themselves on 2026-10-06; they agree with the count line at the top of every file.

| No. | Area | File | What the user can do there | P0 | P1 | P2 | H | X | D | Cards |
|---|---|---|---|---|---|---|---|---|---|---|
| 01 | Projects, repos & worktrees | `spec/01-projects-worktrees.md` | Add folders and repositories as projects (pick, clone, start fresh or sweep a parent folder for repos), group them and give them icons and colours. Make, name, sort, pin, filter, move between and remove worktrees, each with its own branch and folder under the chosen workspaces folder and its own starting ref; run per-project setup and share it through kolux.yaml; jump around with the worktree palette and back and forward history; clear out stale or merged worktrees and see disk use in the Space view; do the same from the repo, project and worktree commands. | 15 | 56 | 18 | 2 | 0 | 10 | 101 |
| 02 | Sessions & launching | `spec/02-sessions-launching.md` | Start an agent or a plain terminal from the plus menu, an empty pane's chooser, the New session page or the launch dialog, with only the agents actually installed on offer. Choose a shape (Solo, Pair, Workbench, Swarm), how many seats, the role, agent and model of each seat, and whether every agent gets a worktree of its own (the default from two agents up); save lineups and get the last one back; have sessions return after a quit; start an agent from a failing check, an issue or another agent's conversation. | 14 | 25 | 2 | 3 | 1 | 6 | 51 |
| 03 | Terminals & panes | `spec/03-terminals-panes.md` | Work in a grid with one session per pane: split, resize, even out, rearrange, blow one pane up to fill the space and put it back; use tabs and tab groups; read a pane header that carries status, agent mark, name, usage, branch and a glow for work finished while away. Copy and paste (screenshots and dropped files too), type with input methods, run full-screen programs, scroll back and click links in output; keep sessions through quits and crashes; keep the computer awake while agents work; bring in Warp and Ghostty themes; drive panes with the terminal commands. | 25 | 62 | 35 | 8 | 1 | 6 | 137 |
| 04 | Agent status, hooks & notifications | `spec/04-agent-status-hooks.md` | See at a glance whether each agent is working, needs the user, has stopped and why (limit, sign-in, provider error), or is done, because Kolux installs and tends hook entries in each agent tool's settings and reads the rest from terminal titles. Get desktop notices for finished, stopped or quiet agents and for expired sign-ins, a tray dot and a taskbar badge, an Inbox of what is waiting, unread marks that clear on viewing, a shortcut to the next waiting agent and Thought rows; closing an agent ends everything it started. | 13 | 41 | 4 | 2 | 0 | 2 | 62 |
| 05 | Views & navigation | `spec/05-views-navigation.md` | Switch between the Agents, Board and Terminals screens from a full-width top bar that also holds the palette hint, the Inbox bell and the weekly usage pill; approve, deny or answer from Board cards and read finished results; open full pages for Tasks, Automations, Skills, Artifacts, Space, Inbox and the Floor timeline; jump anywhere through the worktree palette; use the left sidebar (projects, worktrees, live sessions), the right sidebar (files, search, source control, checks, past sessions with resume, the handoff note) and a status bar with keep-awake, a resource view that can end processes, ports and update progress. | 24 | 58 | 15 | 10 | 1 | 10 | 118 |
| 06 | Usage & limits | `spec/06-usage-limits.md` | Watch how much context and plan allowance each agent has spent: a ring and percentage on pane headers and tabs, a compact meter on Board cards and in the Agents view, and the weekly pill. Claude, Agent Teams and Codex are held to a 200k window so they compact early; an opt-in switch nudges a stopped Claude session once its limit window resets; alerts fire at 80% and 95%; launch dialogs warn when an account is nearly spent; the Stats & Usage page turns local Claude and Codex logs into token and cost figures beside Grok credits and a card to share as a picture. | 11 | 10 | 6 | 4 | 1 | 1 | 33 |
| 07 | Accounts, sign-in & keys | `spec/07-accounts-keys.md` | Connect Claude, Codex and Grok from one card each (install the tool, sign in, fix whatever the card flags, disconnect), keep several Claude and Codex accounts side by side, and let Kolux renew Claude sign-ins before they lapse. Every secret is sealed by the operating system and kept off logs, errors and the screen. Also here: adding and listing accounts from the command line, live model lists, routing tiers per provider, extra usage credentials, and how terminals start (shell choice, clean environment, safe start folder, startup commands, ending child processes). | 12 | 27 | 16 | 4 | 0 | 6 | 65 |
| 08 | Orchestration | `spec/08-orchestration.md` | Let one agent coordinate others from its own terminal: open a run for an objective, break it into tasks that can wait on each other, and hand them to existing terminals or to new workers that start in fresh worktrees. Agents trade typed mail that waits until read; gates and questions pause work for an answer; workers can be watched, read, stopped, abandoned, kept or released, and survive restarts. Worker models follow four tiers per provider; a one-screen summary covers all worktrees; Claude Code's Agent Teams run inside Kolux panes. Old settings knobs become flags and fixed defaults. | 17 | 31 | 10 | 5 | 0 | 4 | 67 |
| 09 | Automations | `spec/09-automations.md` | Save a prompt and an agent to run on a timetable (hourly, daily, weekdays, weekly, or a custom cron or RRULE line) or when something happens in a project (a pull request opens, its checks fail, an agent finishes). Each automation keeps a numbered history with output and cost; one dashboard lists every run; runs open in background tabs and never steal focus; long prompts fold away; the automations command group drives all of it; cron jobs from Hermes or OpenClaw on the same machine show in the list. | 8 | 15 | 2 | 0 | 0 | 4 | 29 |
| 10 | Plan review & protected actions | `spec/10-plan-review-protected.md` | Read Claude Code's plan in a side sheet before it leaves plan mode, comment on any section or on the whole, then approve it or send it back. Have Kolux stop an agent and ask first before a dangerous shell command (force-pushing main, throwing away work, dropping tables, touching live payment data, applying infrastructure, deploying to production, deleting outside the worktree), with rules, project overrides, custom patterns and a log on the Safety page. Also secret masking, pre-trusted new worktrees, consent before shared repository scripts run, and the 2026-10-04 audit findings as checks the rebuild passes from day one. | 16 | 9 | 2 | 1 | 0 | 2 | 30 |
| 11 | Git, source control & review | `spec/11-git-review.md` | Stage, discard, commit, push, pull and publish from the Source Control panel, led by one main button that offers the next sensible step, with AI help for commit messages, failed pushes and conflicts. Read changes file by file or as one scrolling view, leave review notes that reach the agent in one message, or hand the work to an agent for review before shipping. Open pull requests with AI-written text and follow CI, comments and merging in the Checks panel; list GitHub issues and pull requests on the Tasks page and start a workspace from any; edit GitHub Projects as a table. Other code hosts and trackers are dropped. | 12 | 38 | 21 | 0 | 0 | 15 | 86 |
| 12 | Editor & files | `spec/12-editor-files.md` | Open files as tabs: code with colouring, markdown with source and preview, and viewers for images, PDFs, tables, notebooks, web pages and growing logs, next to diff and check tabs. Work is protected by a banner when the file changes on disk, optional autosave, saves that land whole or not at all, and drafts that survive a crash. Browse and reshape files in the explorer, find a file by name or text by search, jump from the Inbox to the waiting agent's pane, keep a handoff note per workspace, and open files or diffs with the file command; WSL-stored projects act as local ones. | 12 | 29 | 14 | 0 | 0 | 2 | 57 |
| 13 | Browser pane & computer use | `spec/13-browser-computer.md` | Open web pages as tabs in the same split layout as terminals, to watch a dev server, read docs or sign in; pages keep their state while hidden, heal after failed loads and crashes, and return after a restart. The address bar searches and suggests from history; a toolbar menu holds separate login profiles, cookie importing and device sizes; one click previews the running dev server. Pick or mark up a page element and hand it to an agent with secrets scrubbed; agents drive the visible tab through the browser commands. Computer use is dropped. | 7 | 36 | 11 | 0 | 0 | 13 | 67 |
| 14 | Native chat | `spec/14-native-chat.md` | With experimental switches on, read and drive a Claude or Codex session (and a few others) as a conversation rather than a raw terminal: either rebuilt from the agent's own transcript while its terminal keeps running, with a flip between the two views, or run by Kolux directly with its own durable record. Every kept card is tier H, but the Agents screen already shows supported sessions as terminal-backed chat, so many cards default to build. | 0 | 0 | 0 | 41 | 0 | 3 | 44 |
| 15 | Skills, plugins & starter kits | `spec/15-skills-plugins-kits.md` | Browse every skill the connected AIs can read, wherever it lives, and search, filter, inspect or safely delete it; install and update the guides Kolux ships for its own command line, orchestration and security, which always match the app version, with a nudge when a copy falls behind. Pick one of six starter kits: a ready business job done by three titled AI seats, with sample data, a results strip and one step to gather the results. Pages Claude publishes are kept for reading offline. The plugin marketplace and runtime are dropped. | 2 | 25 | 5 | 1 | 0 | 8 | 41 |
| 16 | Onboarding & guidance | `spec/16-onboarding.md` | Go through a four-screen guided first run (welcome, connect an AI, pick a folder or sample data, choose a kit) that ends in a short tour of the grid; existing profiles are never pushed through it and anyone can reopen it. Follow an eight-step Setup Guide that ticks only what really exists, walk five workflows in Explore Kolux, get at most one tip per launch and first-time callouts on real controls, read newcomer screens kept plain by a jargon check, and see a GitHub star request at a few chosen moments. No card here is P0. | 0 | 19 | 13 | 5 | 1 | 4 | 42 |
| 17 | Settings, appearance & input | `spec/17-settings-appearance.md` | Tune Kolux through eleven Settings pages plus one small page per repository (base branch, setup script, worktree folder); every other old section is cut or folded, each named by a D card. Pick the Classic theme or one of 16 hues shaped by sliders, light, dark or system mode, a terminal scheme that can follow the app, fonts, language and zoom, all applied before the first frame. Own the shortcuts file `~/.kolux/keybindings.json`; record, disable and reset chords and see clashes on the Shortcuts page. Settings save while typing and reach every window. | 16 | 20 | 11 | 4 | 1 | 10 | 62 |
| 18 | Remote & hosts | none | Dropped by Txais on 2026-10-05: no cards. SSH hosts, remote installs of the background service, headless serving and the web client, running inside WSL, phone pages and pairing, the emulator pane and VM recipes all went. The local background service (03, 19), the local hook listener (04) and `kolux status` and `kolux open` (20) stay. See `DECISIONS.md`. | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 19 | App lifecycle & operations | `spec/19-app-lifecycle.md` | Run one copy of Kolux whose window shows fast even when the background terminal service is slow, with a tray icon, a menu bar and a help menu in the sidebar footer. It updates itself from the owner's public GitHub releases, shows the notes in an update card and installs on restart or quit; crash reports and feedback become pre-filled GitHub issues the user files; no usage data leaves the machine. Everything set up survives quits, updates, a damaged state file and a replaced terminal service; recovery covers interface and graphics crashes; memory per session can be read; scripts can ask whether the app is ready. The owner's ship and release flow lives here too. | 13 | 28 | 13 | 13 | 0 | 3 | 70 |
| 20 | The `kolux` CLI | `spec/20-cli.md` | Drive Kolux from any terminal, as a person, a script or an agent: help at every level, a version flag, one grammar for flags and values, typo suggestions, JSON output, fixed exit codes, the two Windows entry points, the command working inside and outside Kolux terminals, and selectors that name repos, worktrees and terminals. Every group kept at 0.15.0 is here: open and status, accounts, repos, projects, worktrees, files, terminals, automations, orchestration, agent hooks, diagnostics, the machine-readable command map, bundled skills and the browser. Dropped groups close the file so they can be revived on purpose. | 11 | 35 | 1 | 1 | 0 | 8 | 56 |
| 21 | H — retired, hidden, removed, dev-only | `spec/21-retired-hidden.md` | Nothing to use: this is the register of what Kolux used to do, does only behind a switch that starts off, or does only in development builds, plus other companies' artwork it ships. Each entry says what it was, when and why it went, and what the rebuild must still tolerate, mostly old saved settings to ignore quietly (the one thing built by default). The X cards name the third-party logos to replace with Txais's own. | 0 | 0 | 0 | 36 | 6 | 3 | 45 |
| | **Total** | 20 files | | **228** | **564** | **199** | **140** | **12** | **120** | **1263** |

## 3. How to read a card

Every area file opens with a paragraph on its scope, a count line, and a line naming its related
areas. Then come the cards, grouped by tier (all P0, then P1, P2, H, X, D) and not in number order.
Each file ends with two short recap lists, one line per D card and one per H card, repeating what
the full cards above already say. A card looks like this:

> **PREFIX-nnn · Short title saying what the user gets**
> Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
> User does: …
> User sees: …
> Rules: …
> Acceptance:
> \- [ ] an action → the result that proves it
> Compat: —
> Decision: (H, D and one X card only)
> Source: D-nn-nnn

| Field | What it holds |
|---|---|
| Heading | The card id (area prefix plus a three-digit number, continuous from 001 in each file) and a title in plain words. The id is what `PLAN.md` tasks cite. |
| Tier | Build class, one of six (table below). It never changes because of theme rank. |
| Pushed | The theme the card most belongs to: one of the eleven theme ids defined and ranked in `PRIORITIES.md`, or a dash for none. The number is an id, not a rank. |
| State at 0.15.0 | How the behaviour stood in the old app (vocabulary below). Background only: it does not change the tier or the build order. |
| User does | The action, in the user's terms. |
| User sees | The visible result. |
| Rules | What must always hold: limits, edge cases, ordering, what must never happen. Clauses are separated by semicolons. |
| Acceptance | A checklist, one "action → expected result" line per box. A card is done when every box passes in Kolux. |
| Compat | A dash, or a contract the rebuild keeps exactly whatever the card's tier: a `kolux` command word or flag, a hook event, a keybinding command id, a setting the importer carries. Every Compat line points into `COMPAT.md`, which holds the full surface and wins on spelling. On 29 cards (19 in area 03, 8 in area 05, 2 in area 17) the Compat line says a keybinding command id was held back; take the exact id from `COMPAT.md` section 4.3. Wherever a card calls a name an "allowlist candidate", the exact spelling is likewise in `COMPAT.md`: keybinding ids in 4.3, environment variables in 5.5, kolux.yaml keys in 5.6. |
| Decision | Only on H and D cards (and one X card). Four forms: H default skip, H default build (with the reason the live default path needs it), default cut with a reason and "Revive via" `DECISIONS.md`, and X replace with the owner's own. Every Decision line is mirrored in `DECISIONS.md`; when the two differ, `DECISIONS.md` wins. |
| Source | An opaque key of the form D-nn-nnn into the dirty room's legal record, which `LOOP.md` section 0 forbids the clean room to open. Treat it as a label; never look it up. Its leading letter says nothing about the tier. |

### Tiers

| Tier | Meaning | What the build loop does | Cards |
|---|---|---|---|
| P0 | Daily use: named in the old README's feature list, in a recent work entry dated 2026-09-22 or later, or part of a top-five theme | Built first, after the walking skeleton | 228 |
| P1 | Shipped and used, but not daily; integrations; command groups beyond the core | After every P0 | 564 |
| P2 | Present but rarely used; polish | After every P1 | 199 |
| H | Hidden behind a switch that starts off, dev-only, retired or removed | Built only where `DECISIONS.md` says build (27 cards default to build, 113 to skip) | 140 |
| X | Another company's branded asset (logos, icons, art) | Replaced with Txais's own, never copied | 12 |
| D | Dropped by Txais on 2026-10-05: all of area 18 plus the default cuts (code hosts and trackers other than GitHub, computer use, plugins, the custom-agent builder, quick commands, per-repository extras, and the settings sections behind them) | Never planned; listed by name in `DECISIONS.md` | 120 |

### States at 0.15.0

| State | Meaning | Cards |
|---|---|---|
| live | A work entry dated 2026-10-05 or 10-06, or a recorded check, saw it working | 122 |
| live-unverified | Shipped, but no record of anyone checking it | 905 |
| hidden | Behind a switch that starts off | 57 |
| dev-only | Shows only in development builds | 9 |
| retired, with a date | Taken out on that date (one card, HID-038, uses the latest possible date; its Rules say the exact date is unknown) | 45 |
| dropped | Cut by Txais; always a D card | 120 |
| half-done | Started but not finished in the old app | 5 |

### Themes

The Pushed numbers are fixed ids; `PRIORITIES.md` names them, ranks them for build order and says
why. At the time of writing the rank order was 1, 2, 3, 4, 7, 5, 9, 11, 8, 6, 10; if this line and
`PRIORITIES.md` ever differ, `PRIORITIES.md` wins.

| Id | Theme | Cards (all tiers) | of which P0 |
|---|---|---|---|
| 1 | Session-per-pane terminal grid | 65 | 20 |
| 2 | Isolation: one worktree per agent | 62 | 21 |
| 3 | Knowing what each agent is doing | 141 | 42 |
| 4 | Accounts, sign-in and usage limits | 64 | 22 |
| 5 | Safety and trust | 68 | 21 |
| 6 | Business-user frame | 44 | 4 |
| 7 | Redesign and the new look | 61 | 24 |
| 8 | Release, update and CI pipeline | 20 | 7 |
| 9 | Reliability and no lost work | 155 | 20 |
| 10 | Identity and originality | 22 | 0 |
| 11 | Orchestration and automations | 101 | 31 |
| none | Dash on the Pushed line | 460 | 16 |

## 4. Card ids and cross-area conventions

### Id prefix per area

- 01 Projects, repos & worktrees: PROJ-001 to PROJ-101
- 02 Sessions & launching: SESS-001 to SESS-051
- 03 Terminals & panes: TERM-001 to TERM-137
- 04 Agent status, hooks & notifications: STAT-001 to STAT-062
- 05 Views & navigation: VIEW-001 to VIEW-118
- 06 Usage & limits: USAGE-001 to USAGE-033
- 07 Accounts, sign-in & keys: ACCT-001 to ACCT-065
- 08 Orchestration: ORCH-001 to ORCH-067
- 09 Automations: AUTO-001 to AUTO-029
- 10 Plan review & protected actions: SAFE-001 to SAFE-030
- 11 Git, source control & review: GIT-001 to GIT-086
- 12 Editor & files: EDIT-001 to EDIT-057
- 13 Browser pane & computer use: BROW-001 to BROW-067
- 14 Native chat: CHAT-001 to CHAT-044
- 15 Skills, plugins & starter kits: SKILL-001 to SKILL-041
- 16 Onboarding & guidance: ONB-001 to ONB-042
- 17 Settings, appearance & input: SET-001 to SET-062
- 18 Remote & hosts: no prefix, no cards
- 19 App lifecycle & operations: APP-001 to APP-070
- 20 The `kolux` CLI: CLI-001 to CLI-056
- 21 Retired, hidden, removed, dev-only: HID-001 to HID-045

### Where overlapping features were filed

The general rule: a behaviour that straddles areas was carded in the area that held most of its
evidence, and the other areas name it in their related-areas line. Build each behaviour once, to
the owning card, and make sure the other cards' acceptance checks pass too. The area files say this
about specific overlaps:

- **Keep the computer awake** (On, Off, Auto): carded in areas 03, 05, 13 and 19 (TERM-122,
  VIEW-097, BROW-053, APP-018); area 03 owns it.
- **Consent before a repository's shared setup scripts run:** SAFE-025 (area 10) and STAT-056
  (area 04) are the same prompt.
- **Artifacts library:** carded in area 15 because its checks live there (SKILL-035 keeps the pages
  Claude publishes, SKILL-036 is the page and offline viewer); area 05 lists it as a view
  (VIEW-012). The old cloud sharing of artifacts is a different, removed feature (HID-007).
- **Native chat:** the chat machinery is area 14. Area 02 holds only the launch route behind the
  switch; the Agents screen in area 05 already shows terminal-backed chat, which is why many area 14
  cards default to build; area 21 records the two switches, which old profiles may still carry.
- **Settings:** area 17 owns the page list and where things sit. The protected-action rules on the
  Safety page are area 10, the stats page under Usage is area 06, choosing a repository icon is area
  01, fonts inside terminals are area 03, and whether the per-repository source control AI override
  stays is area 11's call.
- **Waiting and attention:** how a waiting state is set and cleared is area 04; area 03 draws it in
  the pane header and owns the unseen-Done glow; area 10's plan review button relies on area 04's
  waiting state.
- **Terminal start-up** (shell choice, clean environment, safe start folder, startup commands,
  ending child processes) was filed under area 07 because its checks were.
- **Menus:** the menu bar and the View menu are area 19; the sidebar and button toggles in its
  Appearance submenu belong to area 05, except the title-bar app name (APP-012).
- **Profiles:** switching between several profiles is dev-only (area 07, H); keeping the one default
  profile's data safe is area 19.
- **Orchestration settings page (cut):** the worker depth cap becomes a default plus a flag
  (ORCH-032), the skill check moves to area 15, and model routing already sits on the Agents page.
- **Starter-kit milestones:** area 15 records them; the newcomer checklist that ticks them is area 16.
- **Update progress in the status bar:** carded in area 15 (SKILL-027) and listed in area 05
  (VIEW-100).
- **WSL:** paths stored in WSL are handled as local again since 2026-10-06 (area 12); running
  commands inside WSL went with area 18.
- **Account restart offer** after switching accounts stays in area 07, though area 05 shows it on
  panes.
- **Linear:** the cut is recorded in both area 11 (GIT-078) and area 20 (CLI-056).
- **SAFE-028** (saved settings come back valid after a restart) is filed in area 10 but says it most
  likely belongs with areas 17, 03 and 12.

Overlaps visible from the card titles, with no note in the files (same build-once rule):

- **Jump to the next session that needs you:** TERM-030, STAT-051 and VIEW-047 describe one
  keybinding command.
- **Usage display:** the weekly pill is VIEW-008 and USAGE-008; the pane-header usage is TERM-019
  and USAGE-001. Area 06 says how the figures are worked out (USAGE-005); area 03 lays out the
  header.
- **No orphaned processes:** ACCT-051, STAT-054 and APP-053 state the same rule from the terminal,
  agent and app side.
- **`kolux` command groups** have a card in their feature area and another in area 20: worktree
  (PROJ-077 to 079, CLI-017 to 021), repo and project (PROJ-010 and 011, CLI-015 and 016), account
  (ACCT-031, CLI-014), terminal (TERM-125, CLI-023 to 027), orchestration (the ORCH cards, CLI-030 to
  039), automations (AUTO-020, CLI-028 and 029), file (EDIT-042, CLI-022), skills (SKILL-030 and 031,
  CLI-043 and 044), and open, status and diagnostics (APP-055 to 057, CLI-011, 012 and 041). The
  feature area says what the command does for the user; area 20 and `COMPAT.md` fix the words,
  flags, output and exit codes.
- **Dropped features keep their name where they showed:** things that went with area 18 or the
  settings cuts still have a D card in the area where the user met them (for example PROJ-097 to
  099, CLI-049 to 054), so the dropped list is complete by name.

**"Table 1b"** in a card means the owner's settings cut list in `DECISIONS.md` section 4.3 (the ten
settings pages that stay and the sections that go).

## 5. Companion files

| File | Job |
|---|---|
| `PRIORITIES.md` | Defines and ranks the eleven themes behind the Pushed numbers, gives the release timeline and where 0.15.0 stood, and sets the build-order rules. |
| `COMPAT.md` | The outside contracts kept exactly: `kolux` command words and flags, hook events per agent, the keybindings file and its command ids, what the importer carries, agent names. |
| `DECISIONS.md` | Every hidden, retired or dropped item with its default (build or skip for H, stay cut or revive for D); Txais's calls there override any Decision line in a card. |
| `PROVENANCE.md` | Where each area came from (source types and dates), plus a dated line for every new source a pass uses; the evidence that the work is original. |
| `LOOP.md` | The build loop's standing instructions: the clean-room rule, the fixed stack, the phases and what one pass does. |
| `STATE.md` | The loop's progress for Txais: status, phase, budget, next task, decisions made for him, and what needs him. |
| `PLAN.md` | The ordered task list the loop builds from, one pass per task, each naming its card ids and acceptance checks. |
