# 17 · Settings, appearance & input

This area covers how the user tunes Kolux, how it looks, and how it listens to the keyboard. Settings
shrinks to ten pages (General, Appearance, Accounts & keys, Agents, Terminal & sessions, Git &
worktrees, Safety, Notifications, Shortcuts and Usage) plus one small page per repository for its base
branch, setup script and worktree folder; every other old section is cut or folded in, and each one is
named by a D card below. Appearance offers a Classic colour theme or 16 hued ones fine-tuned by three
sliders, a Light, Dark or System mode, a terminal scheme that can follow the app's colours, fonts,
language and zoom, all in place before the first frame so nothing flashes at start. Shortcuts are kept
in a file the user owns, `~/.kolux/keybindings.json`; the Shortcuts page records, disables and resets
key chords, reports clashes scope by scope, and plenty of commands come without any chord. Settings save
while the user types, reach every open window, and never hand secrets to the interface.

Tier counts: P0 16 · P1 20 · P2 11 · H 4 · X 1 · D 10
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 06 Usage & limits · 07 Accounts, sign-in & keys · 08 Orchestration · 09 Automations · 10 Plan review & protected actions · 11 Git, source control & review · 12 Editor & files · 13 Browser pane & computer use · 14 Native chat · 15 Skills, plugins & starter kits · 16 Onboarding & guidance · 18 Remote & hosts (dropped) · 19 App lifecycle & operations · 20 The `kolux` CLI · 21 H — retired, hidden, removed, dev-only

## Cards

### SET-032 · Pick the folder new worktrees go into
Tier: P0 · Pushed: 2 · State at 0.15.0: live-unverified
User does: types a workspaces folder, browses to one, or sets KOLUX_WORKSPACES_DIR before starting
  the app.
User sees: each new worktree is made inside that folder, in a sub-folder per repository unless that
  nesting is switched off.
Rules: Enter keeps the typed folder and Escape puts the previous one back; text still being composed
  through an input method is never saved half-way; folders used before are offered again; the
  environment variable sets the folder without opening Settings; leaving the field sends the typed
  value again even when it equals the last attempt, so a save that failed can be retried; worktrees
  Kolux did not make stay hidden by default, and the user can change that for every repository or for
  one; that visibility is chosen per origin (made by Claude Code, made by GSD, sitting elsewhere on
  disk, and extra root folders the user adds, where a newly added root starts hidden), and changing
  the global choice never overwrites a repository's own choice.
Acceptance:
  - [x] Browse to D:/wt → the next worktree is created at D:/wt/<repo>/<name>. (cards; evidence/cards-SET-032.txt)
  - [x] Launch with KOLUX_WORKSPACES_DIR pointing at a folder → new worktrees appear in that folder. (cards; evidence/cards-SET-032.txt)
Compat: KOLUX_WORKSPACES_DIR keeps its meaning; the saved workspaces folder and the nest-per-repository
  choice carry over as they are.
Source: D-17-032

### SET-027 · Agents page: which agents, the default one, and how they start
Tier: P0 · Pushed: 3 · State at 0.15.0: live
User does: switches agents on and off, picks the default agent, and adjusts how agents are started.
User sees: everywhere else, Kolux offers only agents that are both installed and switched on; a new
  session opens with the default agent and that agent's saved options.
Rules: switching off the agent that is the default leaves no default; Refresh looks for installed
  agent CLIs again, and a search that finds nothing never wipes the saved default: it stays listed,
  labelled as saved but not found right now, Auto does not show as the selected choice, and Refresh
  stays in reach; per agent the user can override the command and set default arguments and default
  environment variables, each typed as a draft that is kept when the field loses focus; switches on the
  page are status hooks (on), automatic tab titles (off), the 200k context cap with auto-compact (on),
  and keep the computer awake while agents run (off, with the modes On, Agent for only while an agent
  is busy, and Off, plus help text describing what closing the lid does on this device under its power
  settings); Agent Permissions offers Yolo, the default, where agents start with the flags that skip
  permission prompts if their CLI has them, or Manual, where agents ask before changing things; agents
  whose launch arguments the user overrode are left alone, and a mix of both shows as Yolo; since
  2026-10-05 Claude starts in its automatic permission mode by default; at load, a saved
  prompt-skipping argument is dropped for any agent whose CLI rejects it so that agent still starts,
  while arguments an agent accepts are kept; an agent that is not signed in links to its sign-in on
  Accounts & keys, where Claude and Codex open their browser sign-in, and any other agent is launched in
  the current workspace with no prompt while the view jumps to its terminal so the user signs in there;
  that in-terminal sign-in needs an open workspace, and with none, or when the launch fails, Settings
  stays open and nothing else changes.
Acceptance:
  - [x] Switch off the agent that is the default → the page shows no default; a new session asks, or
        takes the first agent available. (cards live; evidence/cards-SET-027.txt)
  - [x] With every agent CLI gone (test stand-in; the real PATH is never changed) press Refresh → the
        saved default is still recorded, and it is used again once one CLI is back. (Reworded per Txais
        2026-10-28 decisions file, A2: test proof accepted.) (cards; evidence/cards-SET-027.txt)
Compat: the saved default agent, the list of switched-off agents, and each agent's command override,
  default arguments and default environment variables all import.
Source: D-17-027

### SET-030 · Accounts & keys flags sign-in trouble
Tier: P0 · Pushed: 4 · State at 0.15.0: live-unverified
User does: opens Accounts & keys.
User sees: every provider account states whether it is signed in and ready, with a warning when its
  sign-in is broken or its local configuration has drifted.
Rules: Claude and Codex each have warnings of their own; Codex also warns when its configuration file
  no longer agrees with what Kolux expects; rate-limit panels list only accounts that belong to the view
  on screen; limit auto-resume (Claude carries on once its limit resets) is a switch the user opts
  into, off by default; a Codex helper that quits because it was handed bad launch arguments is not
  reported as a sign-in problem.
  (Kolux RS, T-041-b: one active Claude account serves the whole window, so the limit figures on
  screen are always that account's; there is no per-view account to filter by.)
Acceptance:
  - [x] Sign Claude out from its own CLI → the page shows Claude's sign-in warning. (cards; evidence/cards-SET-030.txt)
  - [x] Turn auto-resume on and restart → it is still on. (cards; evidence/cards-SET-030.txt)
Compat: —
Source: D-17-030

### SET-001 · App colour theme: Classic or one of 16 hues
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: opens Appearance and clicks a swatch in the colour theme row.
User sees: the whole interface takes on that hue straight away, without a restart; Classic keeps the
  original neutral look.
Rules: Classic is the default and comes first, then 16 hued themes in colour-wheel order: Ember,
  Copper, Sand, Moss, Fern, Jade, Teal, Lagoon, Sky, Cobalt, Indigo, Iris, Violet, Orchid, Rose,
  Graphite; Graphite has no colour at all (a greyscale look); a theme name that is absent or unknown
  counts as Classic, both when loading and when saving; a preview beside the swatches shows the chosen
  theme, and a violet sample when no hued theme is chosen; pop-out windows share the main window's
  theme.
Acceptance:
  - [x] Fresh profile → Classic is selected; click Teal → sidebar, top bar and accent colours turn
        teal within one frame. (cards; evidence/cards-SET-001.txt)
  - [x] Save an unknown theme name in the settings and start → Classic is shown and selected. (cards; evidence/cards-SET-001.txt)
  - [x] With Rose chosen, open a pop-out window → it is Rose as well. (cards live; evidence/cards-SET-001.txt)
Compat: a saved theme imports by its name; anything other than Classic or one of the 16 hues imports
  as Classic.
Source: D-17-001

### SET-002 · Tint, saturation and depth sliders adjust the theme
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: drags the tint, saturation or depth slider below the swatches.
User sees: tint turns the hue around the colour wheel, saturation makes it stronger or weaker, depth
  makes backgrounds darker or lighter; the preview and the app follow the slider as it moves.
Rules: tint spans −180 to +180 degrees (default 0); saturation spans 0 to 160 % (default 100); depth
  spans −3 to +6 steps (default 0); all three are greyed out while Classic is chosen; a value outside
  its span is pulled to the nearest end, and a non-numeric value falls back to its default.
Acceptance:
  - [x] Choose Classic → all three sliders are disabled. (cards; evidence/cards-SET-002.txt)
  - [x] Choose Moss and drag saturation to 0 → the interface goes grey; back to 100 → Moss returns. (cards; evidence/cards-SET-002.txt)
  - [x] Save saturation 500 in the settings → the app uses 160; save a word instead → the app uses 100. (cards; evidence/cards-SET-002.txt)
Compat: saved tint, saturation and depth numbers import, clamped to these spans.
Source: D-17-002

### SET-003 · Terminal colours can follow the app theme
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: picks "Match app theme" in the terminal colour scheme picker.
User sees: the terminal's background, text colour and palette are worked out from the current app
  hue, and they change whenever the theme or its sliders change.
Rules: Match is one more entry in the same picker; the scheme catalogue, the separate light scheme
  and imported schemes all stay available; the opposite direction (app colours taken from a terminal
  scheme) was suggested once, never shipped, and is not part of this card.
Acceptance:
  - [x] Choose Match, then switch the app theme from Sky to Ember → open terminals recolour without
        being reopened. (cards; evidence/cards-SET-003.txt)
  - [x] Choose a catalogue scheme again → terminals stop following the app hue. (cards; evidence/cards-SET-003.txt)
Compat: —
Source: D-17-003

### SET-004 · Startup never flashes the wrong theme or font
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: starts the app or opens another window.
User sees: the very first frame already has the saved mode, hue and interface font; nothing
  changes once loading finishes.
Rules: mode, theme and app font are in place before any window draws for the first time; switching
  between light and dark holds off colour animation for two frames so panels do not fade from one look
  to the other; known gap: the bare window background seen before the interface loads follows the
  system's light or dark setting, not the hue.
Acceptance:
  - [ ] Save Dark, Cobalt and a non-default app font, restart, record the screen at 60 fps → the first
        frame is dark Cobalt in that font, with no light frame.
  - [x] Switch Light to Dark and back → no visible colour fade on the panels. (cards; evidence/cards-SET-004.txt)
Compat: —
Source: D-17-004

### SET-005 · Light, Dark or System mode
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: picks System, Light or Dark in the Interface section.
User sees: the app changes at once; on System it tracks the operating system and switches while
  running when the system does.
Rules: System is the default; in light mode terminals use a separate light scheme by default, and the
  user can turn that off to keep a single scheme for both modes.
Acceptance:
  - [x] Mode System, switch the operating system to dark while the app runs → the app turns dark with
        no restart. (cards; evidence/cards-SET-005.txt)
  - [x] Mode Light with the separate light scheme on → terminals use the light scheme. (cards; evidence/cards-SET-005.txt)
Compat: a saved System, Light or Dark choice imports unchanged.
Source: D-17-005

### SET-006 · Settings: ten pages plus a small page per repository
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: presses Mod+Comma, or chooses Settings from the app menu (under the app name on macOS,
  under File on Windows and Linux).
User sees: a Settings screen with a side list of pages and a list of projects; choosing a page shows
  its sections.
Rules: the pages are General, Appearance, Accounts & keys, Agents, Terminal & sessions, Git &
  worktrees, Safety, Notifications, Shortcuts and Usage, and each repository adds one small page; the
  old app had 33 fixed sections plus one per repository, and the rest are cut or folded in (see this
  area's D cards); a section that only makes sense on one platform is hidden on the others; links from
  elsewhere in the app can open Settings at a chosen page and section, waiting until the target is
  drawn and then scrolling it into view; each project appears once in the side list (grouping one
  project across several machines left with the dropped remote area); pages load the first time they
  are opened so Settings itself opens quickly; the menu entry shows the current Settings shortcut purely
  as a hint; closing Settings returns to the screen it was opened from, also when Settings is opened
  again while already showing, and opening Settings empties any search left over from before; Safety
  holds the protected-action rules (area 10) and Usage holds the stats page (area 06), and this area
  only places them in the page list. (Kolux RS, T-701: every checkbox or switch row with text beside it
  is at least 24px tall, and a click anywhere on the row ticks it.)
Acceptance:
  - [x] Press Mod+Comma → Settings opens on the last page used, or the first. (cards; evidence/cards-SET-006.txt)
  - [x] Count the pages in the side list → exactly the ten named, plus one per repository. (cards; evidence/cards-SET-006.txt)
  - [x] Follow an in-app link to the shortcut policy → Shortcuts opens, scrolled to that setting. (cards; evidence/cards-SET-006.txt)
  - [x] Measure the Show the AI actions in Source Control row, a repository's Wait for setup row and an
      agent's switch row → each is at least 24px tall. (unit + headless browser; evidence/T-701.txt)
Compat: the keybinding command id app.settings stays, with Mod+Comma as its default.
Source: D-17-006

### SET-037 · Classic or New look, and the screen that opens first
Tier: P0 · Pushed: 7 · State at 0.15.0: live
User does: picks Classic or New, and which workspace screen (Agents, Board or Terminals) opens first.
User sees: New shows the redesigned screens; Classic keeps the earlier layout.
Rules: profiles that existed before the redesign stay on Classic until the user picks New; under
  Classic the first-screen choice has no effect, shows only Terminals as selected, and greys out Agents
  and Board with a hint to switch the look to New; the View menu has a radio group for Agents, Board and
  Terminals, and Mod+Alt+V steps through them; in the rebuild these choices live in General instead of
  the old Views & sessions page.
Acceptance:
  - [x] Existing profile → Classic; choose New → the top bar with Agents, Board and Terminals appears. (cards; evidence/cards-SET-037.txt)
  - [x] Set Board as the first screen, restart with New → Board shows first. (cards; evidence/cards-SET-037.txt)
Compat: the command that steps through workspace screens keeps its old keybinding command id (written
  with a capital letter, so it is held back pending the allowlist) and Mod+Alt+V.
Source: D-17-037

### SET-028 · Model and effort per tier for orchestration workers
Tier: P0 · Pushed: 11 · State at 0.15.0: live-unverified
User does: on the Agents page, picks a provider, then a model and an effort level for each worker tier.
User sees: when a coordinator gives a task a tier, the worker runs on the same provider, using the
  model picked for that tier.
Rules: a tier left empty means the provider's default; effort choices depend on the model, so a new
  model keeps the effort if it is still offered and resets it otherwise; only providers that can route
  by tier are listed.
Acceptance:
  - [x] Give the fast tier a small model and run an orchestrated task on that tier → the worker's header
        names the small model. (cards; evidence/cards-SET-028.txt)
  - [x] Pick a model that has no effort levels → the effort picker disappears. (cards; evidence/cards-SET-028.txt)
Compat: —
Source: D-17-028

### SET-008 · Shortcuts page lists every command with its keys
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: opens Shortcuts, picks a filter, or types in its search box.
User sees: commands grouped by area with their current key chords; filters for all, modified,
  unassigned and conflicting; badges reading Modified, Unassigned, Disabled and Conflicts.
Rules: search looks at command titles, group names, extra keywords, command ids, and the chords for
  every platform; the search text is capped in size so an enormous paste cannot freeze the list; each
  row says whether the command still works while a terminal has focus or is held back by the terminal
  policy (SET-014); commands behind a feature flag that is off are left out.
Acceptance:
  - [x] Pick the Unassigned filter → only commands without a chord are listed. (cards; evidence/cards-SET-008.txt)
  - [x] Search Mod+K (or the way it is drawn on screen) → the clear-terminal command shows. (cards; evidence/cards-SET-008.txt)
Compat: —
Source: D-17-008

### SET-009 · Record, add, disable or reset a shortcut
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks a command's chord and presses new keys, or uses add another, remove, disable or
  reset on its row.
User sees: a recorder that waits for a key combination and keeps it; the row updates and the app menu
  shows the new accelerator.
Rules: Esc ends recording and changes nothing; one command may hold several chords, each replaced or
  removed on its own; removing the chord that is being recorded ends recording, while removing a
  different chord of the same command keeps recording on the one the user picked; disable leaves the
  command with no chord and remembers that; reset brings back the shipped default; tapping one modifier
  twice (Shift then Shift, say) can be recorded, and it counts only when the second press of that same
  key comes within about 300 ms with no other key between, no other modifier held, and no key repeat;
  a chord needs a modifier other than Shift, so Shift-only chords are refused, except Shift+Space for
  the terminal command that changes the system input source; every change is saved to the keybindings
  file at once, sent to every window, and used to rebuild the app menu.
Acceptance:
  - [x] Record Mod+Shift+K on a command → the row shows it with a Modified badge, and the file holds
        the entry. (cards; evidence/cards-SET-009.txt)
  - [x] Press Esc while recording → the previous chord stays. (cards; evidence/cards-SET-009.txt)
  - [x] Press reset → the default chord returns and the Modified badge goes away. (cards; evidence/cards-SET-009.txt)
Compat: —
Source: D-17-009

### SET-010 · Clashing shortcuts are flagged, scope by scope
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: records a chord another command already uses, or edits the file by hand so that two
  commands collide.
User sees: both rows get a Conflicts badge and appear under the conflicting filter; on macOS a warning
  shows when the system itself grabs the chord (Mission Control desktop switching).
Rules: collisions are judged inside a scope (global, tabs, terminal, browser, editor, file explorer,
  composer, settings), so one chord used in two scopes that never overlap is fine; colliding with a
  native menu accelerator counts; when a hand edit creates a collision, the colliding override is
  ignored and a diagnostic appears; a command with no chord never collides; the new-tab commands of
  agents switched off on the Agents page never count; a colliding row carries a short hint on how to
  fix it, worded the same whatever the number of commands involved, and shown in full rather than cut
  short; the macOS desktop-switching warning appears only when the current keyboard layout really
  produces a digit on that key, and stays quiet otherwise.
Acceptance:
  - [x] Bind Mod+P to a second global command → both rows show Conflicts. (cards; evidence/cards-SET-010.txt)
  - [x] On macOS with Ctrl+digit desktop switching on, bind Ctrl+2 → the system-capture warning shows. (cards; evidence/cards-SET-010.txt)
Compat: —
Source: D-17-010

### SET-011 · Shortcuts live in a file the user owns: `~/.kolux/keybindings.json`
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: edits `~/.kolux/keybindings.json` by hand, or lets the Shortcuts page change it.
User sees: changes in the file take effect after an edit made from the page or a manual reload; the
  file is kept through upgrades.
Rules: the file's shape is given under Compat; entries in the section for the running platform beat
  the shared map; a chord may be one string, a list of strings, or null or false for unbound on
  purpose; overrides that older builds wrote at the top level are accepted and moved into the map; a
  file that cannot be read or is invalid raises an error, the defaults are used, and the file is never
  written over; a missing file is created empty; every write lands in a temporary file first, so a
  crash never leaves half a file behind; shortcut overrides kept in the old settings are moved over once,
  and only when no file exists yet; saving from the page writes into the running platform's section and
  leaves the other platforms' sections as they are; on upgrade, users whose tab-switching keys changed
  between versions get their old chords written into the file so habits keep working; that happens
  once, is tried again at the next start if the write failed, is decided per platform (an override
  saved for another platform does not block it), leaves other overrides alone, and changes nothing the
  second time it runs.
Acceptance:
  - [x] Put terminal.clear with the value null in the keybindings map and reload → the clear-terminal
        command shows Unassigned. (cards; evidence/cards-SET-011.txt)
  - [x] Break the file's syntax and reload → an error diagnostic, the default chords work, and the
        broken file itself stays untouched. (cards; evidence/cards-SET-011.txt)
  - [x] Add a win32 section overriding a shared entry → on Windows the section's value applies. (cards; evidence/cards-SET-011.txt)
Compat: `~/.kolux/keybindings.json` keeps its shape: an optional schema reference, a version number
  of 1, a keybindings map from command id to a chord string, a list of chord strings, or null or false,
  and an optional platforms object holding darwin, linux and win32 maps of the same kind. Import keeps
  every override and the meaning of null and false.
Source: D-17-011

### SET-013 · Default chords out of the box, and the commands left without one
Tier: P0 · Pushed: — · State at 0.15.0: live-unverified
User does: uses the app on a fresh install.
User sees: core commands have chords from the start, different per platform where the system keeps
  keys for itself; many newer commands have no chord until the user gives them one.
Rules: there are 138 commands, 82 with a chord and 56 without (since T-673, DT-C109), among them one
  new-tab-with-this-agent command per supported agent, generated from the agent list; Mod stands for
  Cmd on a Mac and for Ctrl on the other two platforms; some commands have a default only on macOS
  (rename workspace, new agent tab); since T-673 rename tab, maximise floating workspace and minimise
  floating workspace have Windows and Linux chords too, and Move Focus to the Top Bar (Mod+Shift+P)
  is a chord a focused terminal passes through; Add a Session and Remove a
  Session have no chord, and Ctrl+Shift+N stays with Create worktree; command ids face the user because they key the keybindings
  file, so the rebuild keeps them.
Acceptance:
  - [x] Fresh profile on Windows → Alt+1 selects tab 1, Ctrl+Shift+J opens the palette, Mod+Shift+D
        splits right. (cards; evidence/cards-SET-013.txt)
  - [x] Fresh profile → the Unassigned filter lists the board, dashboard, tasks, inbox and floor views. (cards; evidence/cards-SET-013.txt)
  - [x] Fresh profile on Windows → Ctrl+Shift+G renames the tab, Ctrl+Shift+Backslash and Ctrl+Shift+H
        maximise and minimise the floating workspace, Ctrl+Shift+P from a terminal moves focus to the top
        bar; no two default chords clash in a shared scope on any platform. (T-673; evidence/T-673.txt)
  - [x] With a menu, the palette or a modal dialog or question up, an app chord (Ctrl+T, Ctrl+W, Ctrl+Tab,
        Ctrl+1) waits; a docked tip, the floating panel, an inline sidebar form or a pane-local sheet holds
        nothing. (T-673; evidence/T-673.txt)
Compat: default chords, macOS first and then Windows and Linux where they differ: quick open Mod+P;
  app.settings Mod+Comma; force reload Mod+Shift+R; worktree.palette Mod+J | Mod+Shift+J;
  workspace.create Mod+N | Mod+Shift+N; workspace.delete Mod+Shift+Backspace; select workspace by
  number Mod+1 to 9; sidebar.left.toggle Mod+B; sidebar.right.toggle Mod+L; zoom.in Mod+Equal,
  Mod+Shift+Plus and Mod+NumpadAdd; zoom.out Mod+Minus and Mod+NumpadSubtract; zoom.reset Mod+0; focus
  the worktree list Mod+Shift+0; previous recent tab Ctrl+Tab; select tab by number Ctrl+1 to 9 |
  Alt+1 to 9; settings.search Mod+F; split right Mod+D | Mod+Shift+D; split down Mod+Shift+D |
  Alt+Shift+D; terminal.clear Mod+K; step through workspace screens Mod+Alt+V; focus the next terminal
  that needs you Mod+Shift+J | Ctrl+J; tab.rename Mod+R | Mod+Shift+G; maximise floating workspace
  Mod+Alt+Shift+A | Mod+Shift+Backslash; minimise floating workspace Mod+Shift+H; move focus to the
  top bar Mod+Shift+P; macOS only: workspace.rename Mod+Alt+R, new agent tab Mod+Alt+T (the ports
  panel toggle went with VIEW-079). Shipped without a chord: open board,
  dashboard.toggle, view.tasks, view.inbox, view.floor, sidebar.checks.toggle, sleeping workspaces
  panel toggle, quick commands menu, send review notes, equalise pane
  sizes, set terminal title, clear pane title, switch input source, sessions.add, sessions.remove, and
  the per-agent new-tab commands. Commands named in words here have ids with capital letters; their
  exact ids are held back pending the allowlist.
Source: D-17-013

### SET-031 · Git & worktrees page: branch names and source control defaults
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: sets the branch prefix, the rename and base-branch options, and how the source control view
  starts.
User sees: a live sample of the next branch name, with a warning when the prefix would make a branch
  name git rejects.
Rules: the prefix is the git user name (default), custom text, or nothing; a prefix made only of
  slashes becomes no prefix and the page says so; by default branches get renamed after the work done
  on them; updating the local base branch before a worktree is made is off by default; Default Compare
  Base sets what each worktree's Git panel compares against, either Repository default (the default)
  or Branch upstream; the source control view opens as a list with a set group order; AI help for
  commit messages and other source control actions (which agent, what instructions) is set up here; a
  saved commit-message agent that cannot run the chosen recipe is flagged, with the agents that can
  listed; when the commit-message helper follows the default agent, its recipe editor stays usable even
  if that agent is one the helper cannot drive directly; each AI action's extra-arguments box shows a
  sample suited to the agent picked for that action, or to the default agent when the action follows
  it.
Acceptance:
  - [ ] Custom prefix tx → the sample reads tx/<name>.
  - [ ] Custom prefix containing a space → a warning shows and new branches do not use it.
Compat: —
Source: D-17-031

### SET-033 · Per-repository page: base branch, setup script, folder
Tier: P1 · Pushed: 2 · State at 0.15.0: live-unverified
User does: opens a repository from the project list in Settings.
User sees: that repository's base branch, the setup script run in each new worktree, and the folder
  its worktrees go into.
Rules: the setup script runs in a new tab by default; the same section decides whether the agent
  waits for setup to finish, and whether the local setup, the shared one stored in the repository, or
  both run, suggesting both when both exist; the repository can override whether worktrees made outside
  Kolux are shown; the page also holds the repository's display name and its icon (choosing the icon
  belongs to area 01); text fields are drafts that respect input-method composition (slowly typed
  Hangul, for example) and are not saved on blur or close when nothing was changed; each field shows the
  inherited global value until the user overrides it, and simply viewing the page writes nothing.
Acceptance:
  - [ ] Set a setup script and create a worktree → the script runs in a new tab.
  - [ ] Change the base branch to develop → the next worktree branches from develop.
Compat: —
Source: D-17-033

### SET-034 · Notifications page: which alerts, which sounds
Tier: P1 · Pushed: 3 · State at 0.15.0: live-unverified
User does: switches kinds of notification on or off, picks sounds and a volume, and presses the test
  button.
User sees: a sample notification with its sound, and a link to the system's own notification settings.
Rules: the volume governs every sound the app plays; if the system blocks notifications the page says
  so and offers that link; by default nothing is announced for the worktree that has focus.
Acceptance:
  - [ ] Press the test button → a system notification appears with the chosen sound.
  - [ ] Set the volume to 0 and test → the notification appears in silence.
Compat: —
Source: D-17-034

### SET-017 · Interface language, falling back to English
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: picks a language in the Interface section.
User sees: menus, settings and screens change language; dates, relative times and weekday names
  follow.
Rules: the choices are System (default), English, Simplified Chinese, Korean, Japanese, Spanish and
  French; System uses the operating system's language when it is one of those, and anything else,
  Traditional Chinese included, falls back to English; an unknown saved value means System; language
  packs load when needed, and any text a pack lacks appears in English; the system menus switch
  language too; sorted lists use the language's own sort order; the plain-words rule for business users
  (the jargon guard) holds in every language; product and provider names inside labels are left as
  they are; the saved language applies as soon as settings have loaded; settings search finds this
  setting by each language's own name (Français, for instance) whatever language is showing.
Acceptance:
  - [ ] Pick Japanese → menus, settings and relative times read in Japanese.
  - [ ] Operating system in Traditional Chinese, language System → the interface is in English.
Compat: a saved language choice (System or one of the six languages) imports unchanged.
Source: D-17-017

### SET-016 · Appearance page in three foldable sections
Tier: P1 · Pushed: 7 · State at 0.15.0: live
User does: opens Appearance and folds or unfolds its sections.
User sees: Interface, Terminal, and Window & Sidebar, all open at first; a folded section shows a
  one-line summary of its current values; the app icon chooser sits at the bottom.
Rules: a link to one appearance setting unfolds that section and scrolls to it, and leaves the other
  sections folded or open as they were; a search unfolds every section that holds a match.
Acceptance:
  - [ ] Fold Terminal → its header sums up the font and the scheme.
  - [ ] With Window & Sidebar folded, follow a link to the sidebar look → the section unfolds and
        scrolls to it.
Compat: —
Source: D-17-016

### SET-018 · App font and editor font
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: types or picks a font family for the interface and one for the code editor.
User sees: suggestions taken from the fonts on the machine while typing; the chosen font applies at
  once.
Rules: the installed fonts are read from the system (on Windows by asking PowerShell) only once a font
  picker is opened, with a built-in list as a fallback if that fails; names that begin with the typed
  text rank above names that merely contain it; entering a picker that already holds a font shows the
  full list, not just matches for the current value; a safe fallback list always follows the chosen
  family so text never disappears; an empty field means the default font, and an empty editor font
  means the editor uses the terminal font.
Acceptance:
  - [ ] Type Cas → installed Cascadia faces are suggested; pick one → the interface font changes.
  - [ ] Enter a font that is not installed → text is still drawn, in the fallback font.
Compat: —
Source: D-17-018

### SET-020 · Show or hide the title, toolbar buttons and status bar items
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: flips items in Window & Sidebar, or ticks them in the View menu's Appearance submenu.
User sees: the app name in the title bar, the Tasks and Automations buttons, and the status bar or
  single items on it come and go at once.
Rules: by default the app name shows, the Tasks button shows, the Automations button is hidden, and
  the status bar shows; menu ticks and settings switches always agree, and changing the Automations
  button rebuilds the menu; usage can read as amount used or amount left; the Claude and Codex usage
  items left the status bar on 2026-10-05 (usage now sits at the top right), and which status bar items
  remain still needs confirming; the submenu holds Toggle Left Sidebar, Toggle Right Sidebar and tick
  boxes for the status bar, Tasks button, Automations button and title bar app name, while its tick box
  for the mobile button went with the dropped mobile feature.
Acceptance:
  - [ ] Untick Show Tasks Button in the View menu → the button disappears and the switch in Settings
        turns off.
  - [ ] Switch Show Titlebar App Name off → the title bar shows no name.
Compat: —
Amended 2026-10-12 (DT-A6): the app name is off by default; the Automations button is on by default until the command palette exists.
Source: D-17-020

### SET-023 · Terminal colour schemes for dark and for light
Tier: P1 · Pushed: 7 · State at 0.15.0: live-unverified
User does: searches the scheme catalogue and picks one scheme for dark mode and one for light mode.
User sees: terminals change scheme along with the app's mode; pane dividers and the dimming of panes
  not in focus follow the choices.
Rules: the dark default is the app's own dark scheme; the separate light scheme is on by default and
  uses a Tango-style light palette; divider colour is set per mode and divider width starts at 3 px;
  unfocused panes dim to an adjustable opacity over a 140 ms fade; the catalogue narrows as the user
  types; custom schemes are kept in settings and tidied when loaded.
Acceptance:
  - [ ] Pick different dark and light schemes, then flip the app's mode → terminals swap schemes.
  - [ ] Focus another pane → the one left behind dims over about 140 ms.
Compat: —
Amended 2026-10-12 (DT-A7): divider width starts at 6 px with no colour, and panes not in focus start undimmed (100%).
Source: D-17-023

### SET-035 · Settings save at once, reach every window, and hide secrets
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: changes any setting with more than one window open.
User sees: the change takes effect at once in all windows and is still there after a restart.
Rules: secret values are removed before settings reach the interface, both when read and when changes
  are sent round; values are tidied on save and on load (scrollback rows, line height, custom schemes,
  proxy, app icon); settings of retired features are dropped at load, updates aimed at them are
  ignored, and their stale values vanish at the next save; older value formats are converted; settings
  are loaded before the first window draws, so no page shows defaults and then jumps; after a save each
  window takes the value that was really stored; a change made while settings are still loading wins
  over the load that arrives afterwards; a failed save is logged and does not break the page, and it
  never reverses another setting that saved fine.
Acceptance:
  - [ ] Change the terminal font in window A → window B updates without a reload.
  - [ ] Inspect the settings handed to the interface → no token or key values are present.
Compat: the old settings file is user data the importer must carry over, setting by setting.
Source: D-17-035

### SET-036 · Settings text fields never lose what was typed
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: types in a text or number field, then moves on, presses Enter, changes page or closes the
  window.
User sees: the value is saved every time; no typing is lost.
Rules: fields save after a short pause, and straight away on leaving the field, changing page or
  closing the window; a keystroke made while the previous save is still running is kept; saves queued
  in quick succession apply in order, each on top of the last stored result, so none is lost; if a save
  fails the typed text stays in the field for another try; input-method composition (Chinese, Japanese,
  Korean) is never saved half-way, and Cmd/Ctrl+Enter, which submits the current form or dialog, does
  nothing during composition; number fields that can be cleared go back to their default when emptied;
  a number field saves after the pause only once it holds a finished number in range, so a half-typed
  or out-of-range number waits and is saved, clamped, on leaving the field or closing the window;
  segmented choices that are unavailable show greyed with the reason; long option lists (fonts,
  schemes) narrow as the user types, and oversized search text in those pickers is refused before any
  filtering.
Acceptance:
  - [ ] Type a proxy address and close the window within a second → the value is there after restart.
  - [ ] Compose Japanese in a field → nothing is saved until the composition ends.
Compat: —
Source: D-17-036

### SET-007 · Search all settings
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Mod+F inside Settings, or types in the settings search box.
User sees: only matching settings remain, from every page; a page whose title matches comes first;
  folded sections open to reveal their matches.
Rules: each setting carries extra everyday search words so plain terms find technical settings; agent
  names, ids and launch commands are searchable, and a query that matches only an advanced control
  brings that control into view; while a search is active, fold toggles are disabled, and clearing the
  search restores the earlier fold state; matches ranked equal keep their order on the page; when many
  projects match, only the active page is drawn so typing stays quick; over-long search text, even a
  huge run of spaces, is refused before any trimming or matching, so a giant paste cannot freeze the
  page.
Acceptance:
  - [ ] Search font → hits from Appearance and from Terminal show, and the Appearance sections holding
        them are open.
  - [ ] Search shortcuts → the Shortcuts page ranks first.
Compat: the keybinding command id settings.search stays, defaulting to Mod+F inside Settings.
Source: D-17-007

### SET-012 · Open, reveal or reload the keybindings file from Settings
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the file menu on the Shortcuts page.
User sees: options to edit the file inside Kolux, open it in an installed editor or the default app,
  show it in the file manager, or Reload from Disk.
Rules: the editor options are the apps set up in the Open in list (SET-039); a missing file is created
  before it is opened; reload reads the file again and sends the result to every window; no automatic
  watching of the file was found, so hand edits wait for a reload.
Acceptance:
  - [ ] Change the file outside Kolux and pick Reload from Disk → the new chord shows in the list and
        in the menu.
  - [ ] Pick reveal → the file manager opens at ~/.kolux with the file selected.
Compat: —
Source: D-17-012

### SET-014 · Decide whether Kolux or the terminal gets shortcuts first
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: on Shortcuts, picks Kolux first or Terminal first.
User sees: with Kolux first (the default) app shortcuts keep working while typing in a terminal; with
  Terminal first only commands marked as safe for terminals fire, and every other chord goes to the
  program running in the terminal.
Rules: the terminal status on each Shortcuts row changes with the policy; the policy covers every
  terminal pane, the floating terminal included.
Acceptance:
  - [ ] Terminal first, focus a terminal running a full-screen text program, press Mod+P → the program
        receives it and quick open does not appear.
  - [ ] Kolux first → Mod+P opens quick open even with a terminal focused.
Compat: a saved Kolux first or Terminal first choice imports unchanged.
Source: D-17-014

### SET-015 · Tab and workspace keys suit the platform and keyboard layout
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses tab-by-number, workspace-by-number, or Ctrl+Tab.
User sees: the intended tab or workspace becomes active; Ctrl+Tab goes to the tab used last, by
  default.
Rules: tab-by-number is Ctrl+digit on macOS and Alt+digit on Windows and Linux; workspace-by-number is
  Mod+digit; Ctrl+Tab order is most recent first (default) or left to right; digit and punctuation
  chords follow the physical key, so keyboards with non-US layouts still work; window-wide shortcuts
  are handled before page focus, so they work from any panel; on new installs Mod+Shift+[ and
  Mod+Shift+] step through all tabs, and Mod+Alt+[ and Mod+Alt+] through tabs of the same kind, while
  installs upgraded from before this arrangement keep the reversed pairing they were used to (written
  into the keybindings file, see SET-011).
Acceptance:
  - [ ] On Windows press Alt+3 → the third tab is active.
  - [ ] Visit tabs 1, 3 and 2, then press Ctrl+Tab → tab 3 is active.
Compat: a saved Ctrl+Tab order imports; most recent first is the default.
Source: D-17-015

### SET-019 · Zoom the whole interface
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses Mod+= or Mod+-, presses Mod+0 to reset, uses the View menu, or uses the zoom
  control in Interface.
User sees: text and controls grow or shrink together; the level is remembered after a restart.
Rules: each step is half a zoom level, roughly 9.5 %, where a whole level is a factor of 1.2; zoom is
  held between −3 levels (roughly 58 %) and +5 levels (roughly 249 %), and reset returns to 100 % from
  anywhere; the zoom control has a reset button of its own; the View menu offers Zoom In, Zoom Out and
  Reset Size; on macOS the window buttons move to line up with the zoomed title bar.
Acceptance:
  - [ ] Press Mod+= twice → the interface is roughly 20 % larger (one whole level); restart → the
        same size.
  - [ ] Press Mod+0 → normal size.
Compat: the keybinding command ids zoom.in, zoom.out and zoom.reset stay.
Source: D-17-019

### SET-022 · Terminal text, cursor and drawing
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: changes font size, family, weight, line height, cursor, ligatures, GPU use and contrast in
  the Terminal section.
User sees: a live sample terminal on the page, and every open terminal, follow each change.
Rules: font size starts at 14 and runs from 10 to 24 in steps of 1, with typed entry and minus and plus
  buttons (minus greyed at 10, plus greyed at 24); family and the normal and bold weights are chosen
  here as well (how fonts behave inside terminals is area 03); line height starts at 1, and bad values
  are corrected on save; the cursor starts as a blinking block; ligatures and GPU acceleration start on
  automatic; a minimum-contrast mode keeps text readable on any scheme; the sample is a real terminal
  that lives only while the page is open.
Acceptance:
  - [ ] Press plus on font size → the sample and every open terminal grow by one point.
  - [ ] Set the cursor to bar with blinking off → every terminal shows a steady bar.
Compat: —
Source: D-17-022

### SET-025 · Terminal input, clipboard and scrolling
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: changes scrollback, copy and paste, mouse and keyboard options in Terminal & sessions.
User sees: terminals keep the chosen amount of history and react to the mouse and clipboard as set.
Rules: scrollback is counted in rows, values out of range are corrected, and older settings are
  converted to rows; copy on select starts off; right-click paste follows the platform's habit (on for
  Windows); middle-click paste of the primary selection starts switched on for Linux and macOS users,
  while Windows users opt in, and it moved here from the removed Input page; programs in the
  terminal may set the clipboard through the OSC 52 escape, on by default; hiding the pointer while
  typing and focus following the mouse both start off; scroll sensitivity, a fast-scroll multiplier and the scroll speed
  for full-screen text programs can be tuned; on macOS Option can act as Alt (automatic by default), and
  Japanese keyboards can turn the Yen key into a backslash (off by default).
Acceptance:
  - [ ] Set scrollback to 1000 rows → scrolling back stops after about 1000 lines.
  - [ ] Turn copy on select on → selecting text puts it on the clipboard.
Compat: —
Source: D-17-025

### SET-026 · Default shell on Windows
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: on Windows, picks the shell new terminals open in.
User sees: new terminals start in Windows PowerShell (default), PowerShell 7 if it is installed, Git
  Bash, or a WSL shell.
Rules: the setting exists only on Windows; Git Bash is listed only when it is found on the machine; a
  PowerShell version choice (automatic by default) favours the newer PowerShell when it is present; a
  WSL shell here is just a local terminal, since running agents inside WSL went with the dropped remote
  area; the old per-terminal WSL distribution choice is no longer offered on Windows.
Acceptance:
  - [ ] With pwsh installed, choose PowerShell 7 → a new tab runs pwsh.
  - [ ] On macOS → the setting is absent.
Compat: —
Source: D-17-026

### SET-029 · Install the command-line tool from Settings
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses the install or register action for the command-line tool.
User sees: the tool lands on the PATH, or a clear reason appears when the system refused or the
  install failed.
Rules: a refusal (the user cancelled an elevation prompt) and a failure get different messages; when
  the system gives no detail about a failure a general reason shows, and a reason the installer did give
  is shown exactly as given; agent skill setup panels show whether each agent's helper is installed,
  and check again when the page regains focus and once more when an install command finishes and its
  terminal exits; each panel runs its install in a terminal inside the panel, and a failed run shows
  Setup failed with the exit code, keeps the terminal on screen and offers Retry in a fresh terminal,
  with the notice cleared only after a later run succeeds; once installed the panel shows Installed and
  an Update button in place of the install label; on Windows a missing runtime choice is taken as the
  local Windows machine, and the install command offered for copying fits the default shell: shells of
  the cmd family get a form that first checks the package runner exists, Git Bash gets the plain
  command.
Acceptance:
  - [ ] Install on a machine without the tool → a new shell finds the command.
  - [ ] Cancel the system prompt → the message says it was cancelled, not that it failed.
Compat: —
Source: D-17-029

### SET-043 · Bring skipped confirmations back
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: switches back on confirmations that were dismissed with don't ask again.
User sees: deleting a worktree, or closing a terminal with a program still running, asks first once
  more.
Rules: each skipped confirmation is remembered separately; closing a pinned tab asks by default;
  General also has a direct switch for asking before an automation is deleted; Terminal & sessions also
  has a direct switch, Ask Before Closing Running Terminals, on every platform, and searching for
  confirm, close or agent finds it.
Acceptance:
  - [ ] Skip the delete-worktree prompt, then turn it back on in Settings → the next delete asks.
  - [ ] Turn Ask Before Closing Running Terminals off and close a terminal with a program running → it
        closes without asking; turn it on → the same close asks first.
Compat: —
Source: D-17-043

### SET-059 · Optional prompt-cache countdown once a Claude agent goes idle
Tier: P2 · Pushed: 4 · State at 0.15.0: live-unverified
User does: switches the cache timer on in the Agents page, picks its length, then leaves a Claude
  session idle.
User sees: the worktree's sidebar card counts down in minutes and seconds, turns yellow in the final
  minute, and at zero becomes a red icon whose tooltip explains that the next message will send the
  whole conversation again without the cache.
Rules: off by default; lengths are 5 minutes (default) and 1 hour, chosen to match the provider's cache
  lifetime; only Claude agents start it, at the moment they go idle; with several Claude tabs in one
  worktree the card shows the one nearest to running out; switching the timer off hides every countdown
  at once.
Acceptance:
  - [ ] Timer on at 5 minutes, a Claude session finishes → its card counts down from 5:00, turns yellow
        at 0:59, and at 0:00 shows a red icon with an explaining tooltip instead of numbers.
  - [ ] Two Claude tabs in one worktree go idle a minute apart → the card shows the shorter time left.
  - [ ] Switch the timer off → every countdown disappears.
Compat: —
Source: D-17-059

### SET-021 · Left sidebar look and worktree card density
Tier: P2 · Pushed: 7 · State at 0.15.0: live-unverified
User does: picks a sidebar look and a card layout in Window & Sidebar.
User sees: the left sidebar uses the standard surface, matches the terminal background, or takes a
  chosen tint; worktree cards appear as Default, Compact or Detailed.
Rules: the tinted look adds a colour picker and a strength control; pinned worktrees can also be shown
  inside their groups (off by default); git-ignored files can be shown or hidden in the file explorer
  (shown by default).
Acceptance:
  - [ ] Choose Tinted, then red at low strength → the sidebar gets a faint red wash.
  - [ ] Choose Compact → worktree cards drop their second line.
Compat: —
Source: D-17-021

### SET-042 · End every terminal session in one go
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: uses the kill-all action for terminal sessions.
User sees: every running terminal ends, and its pane closes or shows that it ended.
Rules: Manage Sessions, in the Terminal page on every platform, lists the running terminal sessions
  with Refresh and, per row, Go to terminal and Kill session; Kill all sessions asks first; only the
  terminals that existed at the click are ended, so one opened meanwhile survives; leftover background
  session state is cleaned up afterwards; the background terminal service stays up, so new terminals
  open straight away (restarting that service is SET-060); success is reported once the terminal tabs
  have closed, even when the service had no sessions left to end.
Acceptance:
  - [ ] Three terminals running, kill all → all three end, and a new terminal opens normally afterwards.
  - [ ] Open the kill-all confirmation and cancel → all three terminals keep running.
Compat: —
Source: D-17-042

### SET-060 · Restart the background terminal service
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: picks Restart daemon in Manage Sessions on the Terminal page, or in the resource usage
  popover, and confirms.
User sees: a confirmation saying every running terminal pane will be killed; after confirming, the
  panes show that their process exited and can be reopened at once, and a toast reports whether the
  restart worked.
Rules: nothing happens before the user confirms, and it cannot be undone; sessions still running under
  an older app version's protocol are kept; a failed restart shows an error pointing to the logs, and
  the app itself keeps running.
Acceptance:
  - [ ] Two terminals running → Restart daemon → confirm → both panes show their process exited;
        reopening one starts a fresh shell at once and a success toast appears.
  - [ ] Open the confirmation and cancel → every terminal keeps running.
Compat: —
Source: D-17-060

### SET-062 · macOS warns when terminal commands lose the app's permission grants
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: on macOS, updates or moves the app while the background terminal service keeps running from
  the old copy, then opens Kolux or the Manage Sessions part of Settings.
User sees: a warning that macOS permissions (Accessibility, Automation, protected files) may not apply
  to commands run in Kolux terminals, explaining that a restart of the terminal service fixes it but
  closes the running terminals; across the app it shows as a lasting notice with Open Manage Sessions
  and Dismiss.
Rules: macOS only, and only while the service is known to be running from an app copy that no longer
  exists; when Kolux cannot tell, no warning shows; the app-wide notice shows at most once per app run,
  is re-checked whenever the window comes back into focus, and is withdrawn once the problem is gone; Open
  Manage Sessions clears any settings search and opens Settings at Manage Sessions in Terminal &
  sessions; inside Manage Sessions the same warning sits above the list without the navigation button,
  and after a restart from there (SET-060) it is checked again and goes away once fixed.
Acceptance:
  - [ ] On macOS, run terminals from an old app copy, update the app and open it → one notice with
        Open Manage Sessions appears; refocusing the window does not add a second.
  - [ ] Click Open Manage Sessions → Settings opens at Manage Sessions, showing the warning without
        the navigation button.
  - [ ] Restart the terminal service from Manage Sessions → the warning disappears.
  - [ ] On Windows or Linux → this warning never appears.
Compat: —
Source: D-17-062

### SET-041 · Window, tray and app icon choices
Tier: P2 · Pushed: 10 · State at 0.15.0: live-unverified
User does: picks an app icon, and whether closing the window minimises to the tray or a menu bar icon
  shows.
User sees: the dock or taskbar icon changes; when tray minimising is on, closing the window keeps the
  app running in the tray.
Rules: three icons of the owner's own: Classic, Watercolor and Blue, with an unknown value meaning
  Classic; minimise to tray on close is off by default and turns on only from an explicitly saved on,
  so any other stored value reads as off; the macOS menu bar icon is on by default; window background
  blur is off by default.
Acceptance:
  - [ ] Pick Blue → the dock or taskbar icon turns blue without a restart.
  - [ ] Turn minimise to tray on and close the window → the app stays in the tray.
Compat: —
Source: D-17-041

### SET-024 · Bring in terminal schemes from Warp and Ghostty
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: imports a Warp theme file, or imports from an existing Ghostty configuration.
User sees: the scheme joins the custom list; before anything is applied, a preview shows what will
  change.
Rules: bringing in from Warp previews when clicked, reading Warp's own themes folder or a theme file the user
  picks; the user ticks which schemes to bring in (with a select-all), and nothing is applied when none
  is ticked; invalid files show an error and bring in nothing; the number of custom schemes is capped,
  importing beyond the cap is refused with a message, but replacing an existing scheme is allowed even
  at the cap; cancelling the file picker leaves that dialog closed; when the Ghostty configuration
  already matches the current settings the preview says so and there is nothing to apply.
Acceptance:
  - [ ] Import a valid Warp theme → a new custom scheme can be selected.
  - [ ] Import a broken file → an error shows and the list is unchanged.
Compat: Warp theme files (YAML) and the Ghostty configuration remain sources the user can bring schemes in from.
Source: D-17-024

### SET-038 · Editor and diff preferences
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: sets editor auto-save, minimap, word wrap, spellcheck and diff defaults in General.
User sees: the built-in editor and the diff views follow these choices.
Rules: auto-save is off by default and takes a delay once on; the minimap is off, word wrap is on, and
  spellcheck in rich markdown is on; diffs open inline, without word wrap and with whitespace changes
  hidden; the combined diff's file tree is hidden by default; editor word wrap and diff word wrap are
  separate choices, and changing one leaves the other alone.
Acceptance:
  - [ ] Turn auto-save on with 1000 ms → edits are saved a second after typing stops.
  - [ ] Turn whitespace display on → changes made only of whitespace appear in diffs.
Compat: —
Source: D-17-038

### SET-039 · Pick the outside apps listed under Open in
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: adds, removes or reorders apps in the Open in list, from presets or by path.
User sees: those apps appear in every Open in menu (worktrees, files, the keybindings file).
Rules: presets cover common editors; a custom entry has a name and a command, is edited as a draft, and
  is saved only when both are filled in; preset rows saved by older versions are recognised by their
  command.
Acceptance:
  - [ ] Add a preset editor → it appears in a worktree's Open in menu.
  - [ ] Remove it → it disappears from every menu.
Compat: —
Source: D-17-039

### SET-040 · Network proxy
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the proxy section and enters a proxy address and a bypass list.
User sees: Kolux's own network traffic goes through the proxy.
Rules: values are checked and tidied before use; when a proxy is already set its fields open expanded;
  applying a new draft clears earlier errors first; an HTTP/1 compatibility switch (off by default)
  helps on networks that break newer protocols; in the rebuild these settings sit in General.
Acceptance:
  - [ ] Set a proxy and check for updates → the request reaches the proxy.
  - [ ] Empty the field → traffic goes direct again.
Compat: —
Source: D-17-040

### SET-061 · The mouse wheel scrolls long pickers and menus, dialogs included
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: opens a long picker or filter menu (labels, assignees, palette filters, workspace clean-up
  filters, new-workspace sources), often from inside a dialog, and scrolls with a wheel or trackpad.
User sees: the list under the pointer scrolls; the dialog or page behind it stays still, and a footer
  fixed below the list stays put.
Rules: the wheel moves the closest part of the menu, between the pointer and the menu's edge, that can
  still scroll up or down, and when the menu itself is that part the menu scrolls; parts that scroll
  only sideways, or that clip their content without scrolling, are passed over; when nothing in the
  menu can scroll further the wheel is left alone and nothing behind the menu jumps; a control inside
  the menu that handles the wheel itself goes first.
Acceptance:
  - [ ] Open the GitHub label picker inside the item dialog with more labels than fit, then wheel down
        → the label list scrolls and the dialog stays still.
  - [ ] Open the Filters menu of workspace clean-up → the wheel scrolls the filters while the footer
        stays pinned.
  - [ ] Open a short menu that fits without scrolling → the wheel changes nothing visible.
Compat: —
Source: D-17-061

### SET-044 · Experimental flags page
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: opens Experimental and turns preview features on.
User sees: flagged features appear: pet, Activity feed, terminal attention cues, agent hibernation
  after 30 idle minutes, a new worktree card style, native chat, mobile, short-lived VMs.
Rules: every flag starts off; a hidden group holds flags not meant for everyone; in the rebuild flags
  become choices made when the app is built, not a settings page.
Acceptance:
  - [ ] Default build → Settings has no Experimental page.
  - [ ] If built → every flag starts off.
Compat: —
Decision: H: default skip
Source: D-17-044

### SET-045 · Voice, Kolux Account and Input pages are gone
Tier: H · Pushed: — · State at 0.15.0: retired 2026-10-05
User does: looks for dictation, account or input settings.
User sees: those pages are gone; the single input setting that stayed (terminal middle-click paste)
  sits in the Terminal section.
Rules: removed together with desktop dictation and the app account.
Acceptance:
  - [ ] Default build → Settings has no Voice, Kolux Account or Input page.
  - [ ] Search middle-click in Settings → the paste setting is found under Terminal & sessions.
Compat: —
Decision: H: default skip
Source: D-17-045

### SET-046 · Agent dashboard shortcut hidden while its flag is off
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: searches Shortcuts for the dashboard toggle.
User sees: nothing; the command (no chord by default) is listed only while the dashboard drawer flag
  is on.
Rules: the dashboard drawer flag is off by default.
Acceptance:
  - [ ] Default build → searching dashboard on Shortcuts finds nothing.
  - [ ] If built with the drawer on → the command is listed, without a chord.
Compat: the keybinding command id dashboard.toggle stays, with no default chord.
Decision: H: default skip
Source: D-17-046

### SET-047 · Developer settings page in development builds
Tier: H · Pushed: — · State at 0.15.0: dev-only
User does: runs a development build and opens the Dev page.
User sees: diagnostics and developer switches that release builds do not have.
Rules: never shown in a release build.
Acceptance:
  - [ ] Release build → Settings has no Dev page.
  - [ ] If built → the page appears in development builds only.
Compat: —
Decision: H: default skip
Source: D-17-047

### SET-048 · Other companies' logos on settings pages
Tier: X · Pushed: 10 · State at 0.15.0: live-unverified
User does: opens Agents, Accounts & keys, Open in, or integration settings.
User sees: logos of third-party agents, editors, browsers and code hosts beside their names.
Rules: covers agent logos, editor icons in Open in, browser icons for cookie import, and code-host
  logos.
Acceptance:
  - [ ] Every such logo is replaced by the owner's own icon or a plain text label.
  - [ ] Walk through every settings page → no third-party brand artwork remains.
Compat: —
Decision: X: replace with own icons or text labels.
Source: D-17-048

### SET-049 · Remote host, mobile and VM settings sections
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opened SSH Hosts, Remote Servers, Mobile, Mobile Emulator, VM runtimes or the runtime
  environment page.
User sees: pages for adding SSH targets, updating remote servers, pairing a phone, running emulators,
  preparing short-lived VMs and choosing a Windows or WSL project runtime.
Rules: all of these belong to the dropped remote and hosts area.
Acceptance:
  - [ ] Default build → none of these pages exist in Settings.
  - [ ] Search ssh in Settings → nothing is found.
Compat: —
Decision: default cut: area 18 (remote hosts, mobile, VMs) dropped by the owner. Revive via DECISIONS.md.
Source: D-17-049

### SET-050 · Integrations, Linear and Task Sources sections
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: connected GitLab, Bitbucket, Azure DevOps, Gitea, Jira or Linear, and chose task sources.
User sees: provider cards with connection state and setup steps, and those providers' tasks in the
  Tasks view.
Rules: GitHub stays; the Tasks page becomes GitHub-only and needs no settings section.
Acceptance:
  - [ ] Default build → Settings has no Integrations, Linear or Task Sources page.
  - [ ] Open Tasks → only GitHub items, with no source chooser.
Compat: —
Decision: default cut: code hosts and trackers other than GitHub, and the task-source settings, removed by the owner. Revive via DECISIONS.md.
Source: D-17-050

### SET-051 · macOS Permissions and Computer Use sections
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: checked macOS permission states, or set agents up to use the computer.
User sees: a macOS-only page of permission states (local network included) and a desktop-only page that
  lets agents drive the computer.
Rules: computer use goes as a feature, not just its page.
Acceptance:
  - [ ] Default build → Settings has neither page.
  - [ ] No agent can be given control of the desktop from anywhere in the app.
Compat: —
Decision: default cut: macOS permissions page and computer use removed by the owner. Revive via DECISIONS.md.
Source: D-17-051

### SET-052 · Plugins section: marketplace, installs and consent
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: browsed a plugin marketplace, installed plugins, and reviewed consent and plugin shortcuts.
User sees: a marketplace browser, a dialog to install from a source, a consent dialog previewing the
  plugin's shortcuts, a row per plugin, and plugin language packs.
Rules: the plugin system was off by default.
Acceptance:
  - [ ] Default build → Settings has no Plugins page.
  - [ ] The Shortcuts page lists no plugin commands.
Compat: —
Decision: default cut: plugin marketplace and runtime removed by the owner. Revive via DECISIONS.md.
Source: D-17-052

### SET-053 · Your agents: the custom agent builder
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: defined an agent of their own with its own command and options.
User sees: custom agents showed up beside the agents Kolux ships with.
Rules: the department-agents plan wants a successor for defining named agents.
Acceptance:
  - [ ] Default build → Settings has no Your agents page.
  - [ ] The agent pickers list only the built-in agents.
Compat: —
Decision: default cut: custom-agent builder removed by the owner; the department-agents plan wants a successor. Revive via DECISIONS.md.
Source: D-17-053

### SET-054 · Quick Commands section and menu
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: saved reusable terminal commands and ran them from a tab menu.
User sees: a list of saved commands, and a menu that sends one to the current terminal.
Rules: its keybinding shipped without a chord; select-all in its search field was Cmd+A on macOS and
  Ctrl+A elsewhere.
Acceptance:
  - [ ] Default build → Settings has no Quick Commands page.
  - [ ] Tab menus offer no saved-command list.
Compat: —
Decision: default cut: quick-commands menu removed by the owner. Revive via DECISIONS.md.
Source: D-17-054

### SET-055 · Orchestration settings page
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: tuned orchestration knobs such as how deep workers may nest.
User sees: a page of coordinator and worker options.
Rules: orchestration stays; its knobs become CLI flags and fixed defaults (nesting depth 1).
Acceptance:
  - [ ] Default build → Settings has no Orchestration page.
  - [ ] A worker cannot start workers beyond one level of nesting unless a CLI flag says otherwise.
Compat: —
Decision: default cut: settings page only; knobs become CLI flags and fixed defaults. Revive via DECISIONS.md.
Source: D-17-055

### SET-056 · Settings sections for features that keep a page of their own
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opened Browser, Floating workspace, Automations, Skills or the onboarding checklist inside
  Settings.
User sees: browser home page, link routing and cookie import; the floating terminal's folder; and the
  automation, skill and setup-progress views inside Settings.
Rules: the browser and the floating workspace keep working with fixed defaults (floating terminal on,
  starting in the home folder); Automations, Skills and the setup guide keep their own page or view.
Acceptance:
  - [ ] Default build → Settings has none of these sections.
  - [ ] Open the floating terminal → it starts in the home folder.
Compat: —
Decision: default cut: settings sections only; features keep fixed defaults or their own page. Revive via DECISIONS.md.
Source: D-17-056

### SET-057 · Advanced, Privacy and Views & sessions as pages of their own
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: opened Advanced, Privacy, Views & sessions, or the old General page.
User sees: the proxy and other advanced knobs; a statement that no usage data leaves the machine; look
  and default-screen choices.
Rules: the knobs still needed move into General or Terminal & sessions, and the privacy statement can
  sit in General; Experimental and Dev have H cards of their own.
Acceptance:
  - [ ] Default build → Settings has no Advanced, Privacy or Views & sessions page.
  - [ ] Search proxy in Settings → the proxy setting is found in General.
Compat: —
Decision: default cut: pages folded into General or Terminal & sessions by the owner. Revive via DECISIONS.md.
Source: D-17-057

### SET-058 · Per-repository extras beyond base branch, setup script and folder
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: set sparse checkout presets, worktree symlinks, fork sync, repository hooks, setups on other
  hosts, a per-repository source control AI override, or a repository icon.
User sees: extra sections on each repository's settings page.
Rules: the extras that go are worktree symlinks, sparse checkout presets, fork sync, repository hooks
  beyond the setup script, setups on other hosts, a Windows or WSL runtime choice, and an MCP
  configuration check (it listed the repository's agent MCP configuration files, flagged missing or
  broken ones, and masked values that looked secret); repository icons may still belong to the projects
  area; a per-repository source control AI override also sits on this page today, and whether it stays
  is area 11's call.
Acceptance:
  - [ ] Default build → a repository's page shows only base branch, setup script and folder (plus name
        and icon).
  - [ ] Create a worktree → no symlinks or sparse checkout are applied.
Compat: —
Decision: default cut: per-repo extras removed by the owner. Revive via DECISIONS.md.
Source: D-17-058

## Dropped by default (tier D)

- SET-049 · Remote host, mobile and VM settings sections — went with area 18 (remote hosts, mobile,
  VMs).
- SET-050 · Integrations, Linear and Task Sources sections — only GitHub stays; Tasks becomes
  GitHub-only.
- SET-051 · macOS Permissions and Computer Use sections — computer use is cut as a feature.
- SET-052 · Plugins section — plugin marketplace and runtime cut.
- SET-053 · Your agents, the custom agent builder — cut; the department-agents plan wants a successor.
- SET-054 · Quick Commands section and menu — quick-commands menu cut.
- SET-055 · Orchestration settings page — page only; knobs become CLI flags and fixed defaults.
- SET-056 · Sections for Browser, Floating workspace, Automations, Skills, setup guide — features keep
  fixed defaults or their own page.
- SET-057 · Advanced, Privacy and Views & sessions pages — folded into General or Terminal & sessions.
- SET-058 · Per-repository extras — sparse checkout, symlinks, fork sync, repository hooks, host
  setups, runtime choice and MCP check cut.

## Hidden or retired (tier H)

- SET-044 · Experimental flags page · every flag off by default · default skip
- SET-045 · Voice, Kolux Account and Input pages · retired 2026-10-05 · default skip
- SET-046 · Agent dashboard shortcut · hidden while the dashboard drawer flag is off · default skip
- SET-047 · Developer settings page · dev-only · default skip
