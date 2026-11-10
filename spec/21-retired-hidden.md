# 21 · H — retired, hidden, removed, dev-only

This area is the register of what Kolux once did and no longer does, what it still does only behind
a switch that starts off, what appears only in development builds, and the other companies'
artwork the app ships with. Each entry is short on purpose: it names the behaviour so the owner can
decide whether to bring it back, records when and why it went, and says what the rebuild must still
tolerate (mostly old saved settings that should be ignored without fuss). Nothing here is built by
default. The one exception is the quiet handling of retired settings in old profiles, which the
normal startup path depends on. The X cards list bundled third-party logos and art that the rebuild
replaces with the owner's own.

Tier counts: P0 0 · P1 0 · P2 0 · H 36 · X 6 · D 3
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 07 Accounts, sign-in & keys · 08 Orchestration · 11 Git, source control & review · 12 Editor & files · 14 Native chat · 15 Skills, plugins & starter kits · 17 Settings, appearance & input · 18 Remote & hosts (dropped) · 19 App lifecycle & operations · 20 The kolux CLI

## Cards

### HID-001 · Every terminal in its own desktop window (0.6.0), rolled back 2026-09-15
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-09-15
User does: opened a new terminal session in version 0.6.0.
User sees: the session came up in a separate desktop window rather than as a pane of the main
  window.
Rules: rolled back in 0.7.0 because those separate windows failed once people actually used them,
  and sessions went back to being panes in the main window; the old build still carries the window
  but nothing opens it and startup no longer brings such windows back, so it sits idle.
Acceptance:
  - [ ] Open a new session in a default build → it appears as a pane in the main window, never as a
        new desktop window.
  - [ ] Quit and relaunch with several sessions open → no extra one-terminal windows come back.
Compat: —
Decision: H: default skip
Source: D-21-001

### HID-010 · Agent Dashboard as a separate desktop window, plus its open-mode setting (retired 2026-10-05)
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-10-05
User does: set the Agent Dashboard to open as its own window.
User sees: the dashboard could open as a separate desktop window instead of a drawer inside the
  app.
Rules: retired in favour of the in-app drawer; the window page and the open-mode setting were
  deleted; the drawer's on/off switch still carries the old window's name, which misleads; the old
  window's saved size and position are still kept with the interface state.
Acceptance:
  - [ ] Default build → the dashboard never opens as a separate desktop window.
  - [ ] Load an old profile that chose the window mode → it loads cleanly and the choice is ignored.
Compat: old profiles may hold the retired open-mode choice and a saved size and position for the old
  dashboard window; both are ignored.
Decision: H: default skip
Source: D-21-010

### HID-011 · Agent Map, retired 2026-10-05
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-10-05
User does: looked at the agents laid out as a map in the dashboard window.
User sees: a map of nodes showed each agent's status, a short flash when an agent had just finished
  and a tally of agents gone quiet, narrowed by agent and by time window.
Rules: only the separate dashboard window used it, so it left with that window; its filtering logic
  lives on solely to narrow the drawer's board; its checks for node status, flashes, the quiet tally
  and the time filter are still in the old project.
Acceptance:
  - [ ] Default build → no map view of agents exists anywhere.
  - [ ] If revived: an agent finishes → its node flashes briefly; shrinking the time window hides
        finishes that fall outside it.
Compat: —
Decision: H: default skip
Source: D-21-011

### HID-020 · Agent Dashboard drawer, off by default behind an experimental switch
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: turns on the experimental dashboard switch, then opens the drawer from its sidebar entry
  or with its toggle command.
User sees: a drawer holding a kanban of agents in Needs You, Working and Done columns, with an
  optional Idle column, and a read-only Runs view of orchestration runs; Escape shuts it.
Rules: off by default, behind a switch still named after the retired dashboard window; with the
  switch off, running the toggle command has no effect and the shortcut list leaves that command
  out, so a user who tries the key concludes it is broken; the Runs view refreshes and pages
  through runs but cannot start or route work; an open improvement item asks for a multi-agent
  control tower that is on from the start.
Acceptance:
  - [ ] Default build → no dashboard drawer and no sidebar entry for it.
  - [ ] If revived: switch it on and run dashboard.toggle → the drawer opens; press Escape → it
        closes.
Compat: the keybinding id dashboard.toggle exists with no default key; old profiles may hold the
  drawer switch under its window-era name.
Decision: H: default skip
Source: D-21-020

### HID-021 · Agent Dashboard kanban board (hidden with the drawer)
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: scans the board, searches it and narrows it by agent or by repo.
User sees: three default columns in a set order, the card that moved last at the top of its column,
  a None placeholder in an empty column and the repo's icon on every card.
Rules: Ctrl+K puts the cursor in the board's search box; the Idle column shows only when turned on;
  relative times stop ticking while the board is out of sight; an open terminal panel stays open
  when its agent changes column, and opening one marks that agent as seen.
Acceptance:
  - [ ] Default build → the board is absent.
  - [ ] If revived: an agent goes from Working to Done → its card lands at the top of Done; any
        column left empty reads None.
Compat: —
Decision: H: default skip
Source: D-21-021

### HID-022 · Agent Dashboard card and host badge (hidden with the drawer)
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: reads a card to learn what an agent is up to.
User sees: every card leads with the conversation's name and carries the repo icon, a question mark
  when the agent is asking something, the saved SSH host, review details and a list of subagents
  that unfolds.
Rules: a Done card the user has not looked at is tinted green and reads as Idle once acknowledged;
  a host badge names an SSH host or a paired Kolux host and is left off for agents on this machine.
Acceptance:
  - [ ] Default build → no dashboard cards exist.
  - [ ] If revived: a card for an agent on this machine has no host badge; an agent waiting on an
        answer shows a question mark.
Compat: —
Decision: H: default skip
Source: D-21-022

### HID-023 · Agent Dashboard terminal preview panel (hidden with the drawer)
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: clicks a card to open that agent's terminal beside the board, and types into it.
User sees: a panel next to the board, which does not block the board, holds the agent's live
  terminal and takes typing and paste.
Rules: layers opened inside the panel get Escape before the panel does; paste uses each system's own
  route (Ctrl+V on Windows, a Shift combination on Linux, Cmd+V through the app menu on macOS);
  right-click pastes or copies depending on the setting, and a big paste is fed in pieces;
  input-method composition, kitty keyboard sequences, Option dead keys and Ctrl+Backspace word
  delete behave as they do in a main pane; opening replays the terminal's last saved screen; a
  notice that the pane closed shows only for terminals that can be watched; the panel registers its
  own size claim so it and a main pane do not fight over the terminal's size.
Acceptance:
  - [ ] Default build → no preview panel exists.
  - [ ] If revived: open the panel while the same terminal is also in a main pane → the terminal
        settles on one size and stops resizing back and forth.
Compat: —
Decision: H: default skip
Source: D-21-023

### HID-026 · Activity view, off by default and unreachable
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: nothing in the shipped app leads to it.
User sees: an early Activity page that the Agents tab later grew out of.
Rules: profiles made before the Agents tab became standard are switched off once, at load; the page
  still exists but no shipped control opens it; a one-time note in the sidebar tells former users
  that their agents now live in the sidebar.
Acceptance:
  - [ ] Default build → no Activity page anywhere.
  - [ ] Load an old profile with Activity switched on → it loads cleanly and nothing extra appears.
Compat: old profiles may hold the Activity switch and a one-time reset marker for it; both are
  ignored.
Decision: H: default skip
Source: D-21-026

### HID-027 · Terminal attention highlight, off by default
Tier: H · Pushed: 3 · State at 0.15.0: hidden
User does: turns on terminal attention under Settings › Experimental.
User sees: a pane lights up after a terminal bell or when its agent finishes, and stays lit until
  the user does something in it.
Rules: experimental; the unseen-Done glow in the new pane header (area 03) meets most of the same
  need.
Acceptance:
  - [ ] Default build → Settings offers no separate experimental attention switch.
  - [ ] Let an agent finish in an unfocused pane → the pane header's unseen-Done glow from area 03
        appears instead.
Compat: old profiles may hold the attention switch; it is ignored.
Decision: H: default skip
Source: D-21-027

### HID-005 · Kolux Account cloud sign-in and its settings page (hidden 2026-09-28, removed 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-10-05
User does: went to the Kolux Account page in Settings to sign in.
User sees: a settings page offered sign-in to a cloud service run by Kolux, which unlocked the cloud
  features.
Rules: hidden in 0.12.0 because the cloud address was a stand-in with no service behind it; the page
  went in the 2026-10-05 trim, so there is no longer any place to sign out of a Kolux account;
  development builds still preview the cloud sign-in in Dev Tools and in the sidebar account
  switcher when two cloud environment variables are present; making it real is an open
  improvement item.
Acceptance:
  - [ ] Default build → Settings has no Kolux Account page and nothing offers a Kolux account
        sign-in.
  - [ ] Release build started with cloud environment variables set → still no cloud sign-in shows.
Compat: two environment variables (the cloud address and a client id) mattered only to development
  builds; release builds ignore them.
Decision: H: default skip
Source: D-21-005

### HID-017 · Claude and Codex usage block on the status bar, removed 2026-10-05
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-10-05
User does: checked account usage, or changed account, from the status bar.
User sees: the left end of the status bar showed usage, a popover listing the accounts, switchers
  for Claude and Codex accounts and a refresh button.
Rules: the owner wanted usage in a single place, top right; it now lives in the top-bar pill and in
  each pane header; it was taken out of every look, old and new alike.
Acceptance:
  - [ ] Default build, any look → the status bar shows no usage figures and no account switcher.
  - [ ] Usage still appears in the top-right pill and in each pane header.
Compat: —
Decision: H: default skip
Source: D-21-017

### HID-035 · Profiles: local or cloud-linked, switching, moving projects (dev-only)
Tier: H · Pushed: 4 · State at 0.15.0: dev-only
User does: nothing in the shipped app creates, switches or moves profiles.
User sees: separate profiles, each with its own settings and accounts, made locally or tied to a
  Kolux Cloud organisation, with switching between them and moving a project from one to another.
Rules: the machinery behind it exists, but the app only reads the list of profiles at startup;
  cloud-linked profiles also manage organisation members and invitations, which rely on the defunct
  cloud.
Acceptance:
  - [ ] Default build → no profile switcher and no way to create a profile.
  - [ ] Start the app → it runs on one set of settings and accounts with no profile prompt.
Compat: —
Decision: H: default skip
Source: D-21-035

### HID-002 · Sidebar Search, Floor and Agent grid entries and the title-bar view switch, removed 2026-09-22
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-09-22
User does: used the left sidebar or the title bar to move between views.
User sees: the sidebar listed Search, Floor and Agent grid entries, and the title bar carried a
  three-way Inbox · Floor · Code switch.
Rules: removed to calm down the sidebar and title bar; at the same time the stock keys for Inbox
  (Ctrl+Shift+1) and Floor (Ctrl+Shift+2) were unassigned, while Code kept Ctrl+Shift+3; the pages
  themselves and their saved state stayed in the app.
Acceptance:
  - [ ] Default build → the sidebar has no Search, Floor or Agent grid entry and the title bar has no
        view switch.
  - [ ] Press Ctrl+Shift+3 → the Code view opens; Ctrl+Shift+1 and Ctrl+Shift+2 do nothing until
        the user binds them.
Compat: the keybinding ids view.inbox and view.floor stay valid with no default key; view.code keeps
  Mod+Shift+3; a keybindings file that binds any of them must still load.
Decision: H: default skip
Source: D-21-002

### HID-014 · Swarm pane footer, removed 2026-10-05
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-10-05
User does: watched a Swarm terminal pane and replied to its prompts from a strip beneath it.
User sees: below each Swarm pane, a strip repeated the agent's newest output line, showed Done, and
  offered approve, deny and answer buttons.
Rules: the strip's message box went first, since replies are typed straight into the terminal; the
  owner then took the whole strip away; the Board keeps its own allow and deny buttons for
  permission requests.
Acceptance:
  - [ ] Default build → nothing sits beneath a Swarm pane.
  - [ ] Raise a permission request → the Board still shows allow and deny buttons for it.
Compat: —
Decision: H: default skip
Source: D-21-014

### HID-015 · Message box under each grid pane, removed 2026-10-05
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-10-05
User does: typed a message into a box under a pane of the terminal grid.
User sees: every grid pane had a message box beneath it, with a hint that Tab jumps between panes.
Rules: redundant, because keystrokes already go straight to the terminal and the Agents view has a
  composer of its own.
Acceptance:
  - [ ] Default build → grid panes have no message box beneath them.
  - [ ] Click into a pane and type → the text reaches that terminal directly.
Compat: —
Decision: H: default skip
Source: D-21-015

### HID-045 · Shared message box under a workspace's panes, with an agent chooser, removed 2026-09-15
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-09-15
User does: typed into the single box docked beneath a workspace's panes, chose which running agent
  should receive the text, and flipped a chip so the next agent started there would not stop for
  permission prompts.
User sees: in 0.5.0, one box per workspace with an agent chip listing the agents running there, an
  on/off permission chip, the branch name and a send arrow; a toast said the text reached the named
  agent or that sending failed.
Rules: the box aimed at exactly one chosen agent, never the whole workspace, by default the focused
  pane's agent and otherwise the first agent able to take text; an agent joined the chooser only
  once it signalled it was ready, the box stayed greyed out while no agent ran, and sending needed
  non-blank text; Enter sent, Shift+Enter added a line, Tab in an empty box stepped to the next
  agent, and Escape put the cursor back in the terminal; unsent drafts were kept per agent until a
  reload; the permission chip stored a per-workspace choice layered over the global default and
  changed only agents launched afterwards, never one already running; the box was taken out that
  same night in the sidebar trim, once every session had its own pane and typing into the pane
  already reached the agent; the stored per-workspace permission choice outlived it and is still
  applied at launch (see VIEW-054), though no visible control sets it any more; the dialog that
  creates a new workspace is a different thing and stays.
Acceptance:
  - [ ] Default build → nothing sits beneath a workspace's panes for messaging agents.
  - [ ] With a skip-permissions choice already stored for one workspace, launch an agent there → it
        starts without permission prompts; a second workspace follows the global default.
Compat: a per-workspace permission choice saved by builds of this era still loads and applies at
  the next launch in that workspace; a malformed entry is dropped on load.
Decision: H: default skip
Source: D-21-045

### HID-016 · Sessions minus/plus stepper, removed 2026-10-05
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-10-05
User does: pressed minus or plus to change how many session panes the grid showed.
User sees: a small minus/plus control set the number of session panes.
Rules: removed with the clean look; the shortcuts that add and remove a pane, and the confirmation
  shown before a pane is removed, stay.
Acceptance:
  - [ ] Default build → no minus/plus pane counter anywhere.
  - [ ] Use the remove-pane shortcut on a running session → a confirmation comes up first.
Compat: —
Decision: H: default skip
Source: D-21-016

### HID-029 · New worktree card style, off by default
Tier: H · Pushed: 7 · State at 0.15.0: hidden
User does: turns on the new card style under Settings › Experimental.
User sees: worktree cards in the sidebar switch to a different layout, with a preview on the
  settings page.
Rules: experimental and never made the standard look.
Acceptance:
  - [ ] Default build → worktree cards come in one layout only, with no style switch.
  - [ ] If revived: turn the style on → the settings preview and the sidebar both show the other
        layout.
Compat: old profiles may hold the card-style switch; it is ignored.
Decision: H: default skip
Source: D-21-029

### HID-018 · In-app nudges, removed 2026-10-05
Tier: H · Pushed: 8 · State at 0.15.0: retired 2026-10-05
User does: saw an in-app nudge and closed it.
User sees: from time to time an in-app nudge appeared that could be closed, and the app remembered
  which ones had been closed.
Rules: removed in the originality clean-up together with its close and reset actions and the stored
  list of closed nudges; the settings format still accepts the old nudge entries so that mixed
  versions keep getting along.
Acceptance:
  - [ ] Default build → no nudge ever appears.
  - [ ] Load an old profile with records of closed nudges → it loads cleanly and the records are
        ignored.
Compat: old stored nudge records are accepted and ignored.
Decision: H: default skip
Source: D-21-018

### HID-019 · Update-available toast, swapped 2026-10-06 for a ready-to-restart toast
Tier: H · Pushed: 8 · State at 0.15.0: retired 2026-10-06
User does: waited for a newer version to be offered.
User sees: a toast said a newer version existed before it had been downloaded.
Rules: replaced by a toast in the bottom-left corner that appears once the new version is
  downloaded and ready, with a restart button; update checks run every 30 minutes.
Acceptance:
  - [ ] Default build → no toast appears while an update is still downloading.
  - [ ] An update finishes downloading → a bottom-left toast offers a restart.
Compat: —
Decision: H: default skip
Source: D-21-019

### HID-036 · Retired settings quietly dropped when an old profile loads
Tier: H · Pushed: 9 · State at 0.15.0: live-unverified
User does: starts Kolux with a profile written by an older version.
User sees: settings that were retired simply disappear from the profile when it loads, with no
  message.
Rules: the clean-up runs on every settings change, on every load and while secrets are handled;
  three settings were retired at the 2026-09-10 fork (terminal scrollback size in bytes, GitHub
  attribution, the agents sidebar) and the rest followed the OpenCode, dashboard window, artifact,
  skill-sharing and relay removals; the rebuild meets this by ignoring any saved setting it does
  not recognise.
Acceptance:
  - [ ] Load a profile carrying every retired setting → the app starts with no message, and the
        retired settings are absent the next time settings are saved.
  - [ ] Change any setting afterwards → none of the retired ones comes back.
Compat: retired settings to discard: scrollback size in bytes, GitHub attribution, agents sidebar,
  OpenCode sign-in cookie, OpenCode workspace id, dashboard open mode, artifact sharing, artifacts
  on/off, artifacts button, skip the artifact delete confirmation, skill sharing, phone-pairing
  connection mode.
Decision: H: default build — an imported old Kolux profile must load with these settings ignored,
  neither failing nor bringing them back.
Source: D-21-036

### HID-006 · Phone pairing through a cloud relay (hidden 2026-09-28, removed 2026-10-05)
Tier: H · Pushed: 10 · State at 0.15.0: retired 2026-10-05
User does: picked the relay option while pairing a phone.
User sees: a phone could pair through a cloud relay and so reach the desktop from any network.
Rules: hidden in 0.12.0 because no relay service existed, so pairing quietly stayed on the same
  network whatever the saved choice; deleted in the originality clean-up so the project reads as its
  own; same-network pairing stayed; the list of pairing addresses now reports no relay.
Acceptance:
  - [ ] Default build → no relay option anywhere.
  - [ ] Load an old profile with a saved relay preference → it loads cleanly and the preference is
        ignored.
Compat: old profiles may hold the phone-pairing connection-mode choice; it is dropped on load.
Decision: H: default skip
Source: D-21-006

### HID-007 · Cloud artifact sharing (hidden 2026-09-28, removed 2026-10-05)
Tier: H · Pushed: 10 · State at 0.15.0: retired 2026-10-05
User does: opened Artifacts from the sidebar or from its settings page to publish files and look
  after their shared links.
User sees: an Artifacts entry in the sidebar and a settings page let a signed-in user publish
  artifacts to a Kolux cloud host and manage the links.
Rules: hidden in 0.12.0 because the host was a stand-in; removed in the originality clean-up; the
  separate, local Artifacts library that arrived on 2026-10-06 belongs to area 05 and is not this
  feature; old profiles lose the sharing settings at load.
Acceptance:
  - [ ] Default build → nothing offers to publish an artifact to a cloud host.
  - [ ] Load an old profile carrying the four sharing settings → it loads cleanly and they are gone.
Compat: four retired settings (sharing on/off, artifacts on/off, the sidebar button, skipping the
  delete confirmation) are dropped on load.
Decision: H: default skip
Source: D-21-007

### HID-008 · Sharing skills by link (hidden 2026-09-28, removed 2026-10-05)
Tier: H · Pushed: 10 · State at 0.15.0: retired 2026-10-05
User does: published a skill bundle, or installed one that someone shared as a link.
User sees: skill bundles could be published to Kolux Cloud and installed by anyone holding the
  link, with no account needed on the receiving end.
Rules: hidden in 0.12.0 behind a not-available notice because cloud sign-in had no service; removed
  in the originality clean-up; local skills stay (area 15); the old checks for recovering a failed
  install were lost with it.
Acceptance:
  - [ ] Default build → the Skills page offers no publish and no install-from-link.
  - [ ] Load an old profile with skill sharing switched on → it loads cleanly and the switch is
        ignored.
Compat: the retired skill-sharing switch is dropped on load.
Decision: H: default skip
Source: D-21-008

### HID-009 · Phone app store links and QR pairing, retired 2026-09-29
Tier: H · Pushed: 10 · State at 0.15.0: retired 2026-09-29
User does: opened the Mobile page to install the phone app and pair it.
User sees: the Mobile page linked to App Store, TestFlight and Android package downloads and offered
  pairing by scanning a QR code.
Rules: the links led to the upstream project's apps and a broken Android download, so the page now
  says the phone app is not ready yet; QR pairing was retired on the Mobile page and in Settings,
  while removing a device that is already paired stayed; links to a Kolux-owned app remain an open
  improvement item.
Acceptance:
  - [ ] Default build → no App Store, TestFlight or Android download link anywhere.
  - [ ] Default build → no QR pairing code is shown anywhere.
Compat: —
Decision: H: default skip
Source: D-21-009

### HID-037 · The Nightshift name, retired with the rename to Kolux on 2026-09-22
Tier: H · Pushed: 10 · State at 0.15.0: retired 2026-09-22
User does: upgraded from Nightshift to Kolux.
User sees: on first launch the old app-data folder and the settings folder in the home directory
  moved over to Kolux, the installer uninstalled Nightshift, and an aperture icon took the moon's
  place.
Rules: old stored setting names and browser-storage prefixes were carried across once; repos still
  fall back to the Nightshift-named setup file, settings folder and plugin manifest when the Kolux
  ones are missing.
Acceptance:
  - [ ] Default build → the Nightshift name, folders and moon icon appear nowhere.
  - [ ] Open a repo that has only the Nightshift-named setup file → the rebuild treats it as a repo
        with no setup file unless this card is revived.
Compat: Nightshift-era names exist for the repo setup file (the old-name twin of kolux.yaml), the
  repo settings folder, the plugin manifest and the settings folder in the home directory.
Decision: H: default skip
Source: D-21-037

### HID-003 · Floor and Agent grid pages with no way in (since 2026-09-22)
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: has no route to either page from the shipped app; Floor opens only once the user gives
  its command a key.
User sees: two whole-window overviews of the running agents that still exist in the app but are cut
  off from navigation.
Rules: cut off when their sidebar entries and default keys went on 2026-09-22; the Floor command,
  once bound, still switches to Floor; nothing at all reaches Agent grid.
Acceptance:
  - [ ] Default build → no click anywhere opens Floor or Agent grid.
  - [ ] If revived: bind view.floor in the keybindings file and press the key → Floor opens.
Compat: —
Decision: H: default skip
Source: D-21-003

### HID-004 · OpenCode support, removed 2026-09-23
Tier: H · Pushed: — · State at 0.15.0: retired 2026-09-23
User does: started OpenCode as an agent and kept an eye on its usage.
User sees: OpenCode could be launched like the other agents, with settings of its own, an OpenCode
  Go usage readout in the status bar, past-session history and a plugin that reported its status.
Rules: the owner dropped it to concentrate on agents from the big model labs; its orchestration
  address, its lookup on the system path, its pet and its translated strings went too, while MiMo
  Code stays; with old and new versions mixed, an OpenCode agent opens as an ordinary terminal
  instead; loading an old profile throws away the OpenCode sign-in cookie and workspace id, and a
  one-time clean-up, marked so it never repeats, deletes leftover hook, overlay and usage files
  without following folder junctions.
Acceptance:
  - [ ] Default build → OpenCode appears in no launcher or agent list.
  - [ ] Restore a saved session whose agent was OpenCode → it opens as a plain terminal with no
        error.
Compat: old profiles may hold an OpenCode sign-in cookie and workspace id, both dropped on load; a
  saved session naming OpenCode as its agent opens as a plain terminal.
Decision: H: default skip
Source: D-21-004

### HID-012 · Desktop voice dictation, removed 2026-10-05
Tier: H · Pushed: — · State at 0.15.0: retired 2026-10-05
User does: held a push-to-talk key and spoke to fill the focused input.
User sees: dictation on the desktop turned speech into text, with push-to-talk, a microphone picker
  and a test box on a Voice settings page.
Rules: removed in the 2026-10-05 trim; an earlier removal on 2026-09-28 was overtaken when 0.12.0
  kept dictation and improved it; phone dictation still leaned on the desktop's speech engine; the
  desktop can no longer store the OpenAI speech key.
Acceptance:
  - [ ] Default build → no Voice settings page and no push-to-talk key.
  - [ ] Load saved feature-tip records that mention the dictation tips → they are accepted without
        error.
Compat: the dictation feature-tip names stay valid when they turn up in saved or incoming records.
Decision: H: default skip
Source: D-21-012

### HID-013 · Input settings page, removed 2026-10-05
Tier: H · Pushed: — · State at 0.15.0: retired 2026-10-05
User does: opened the Input page in Settings to change how input behaves.
User sees: a page of its own for input choices such as pasting with the middle mouse button.
Rules: removed in the 2026-10-05 trim; middle-click paste moved to the terminal settings page.
Acceptance:
  - [ ] Default build → Settings has no Input page.
  - [ ] Open Terminal & sessions in Settings → the middle-click paste choice is there.
Compat: —
Decision: H: default skip
Source: D-21-013

### HID-024 · Native chat and structured native chat, off by default
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: turns on native chat under Settings › Experimental.
User sees: agent conversations show as a chat surface drawn by the app instead of the raw terminal.
Rules: both switches start off, and the owner counts native chat among the flagged-off features;
  the structured kind is a second switch that works on its own; area 14 holds the full detail.
Acceptance:
  - [ ] Default build → no native chat switch is offered.
  - [ ] If revived: turn on the first switch only → the structured kind stays off.
Compat: old profiles may hold the two chat switches; they are ignored unless area 14 is revived.
Decision: H: default skip
Source: D-21-024

### HID-025 · Pet, off by default
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: turns on the pet, then picks a character from the pet menu on the status bar or uploads
  a picture.
User sees: an animated pet floats in the bottom-right corner and can be hidden from the status bar.
Rules: with the switch off the pet layer is not loaded at all; uploads take PNG, APNG, GIF, WebP,
  JPG and SVG pictures; both built-in characters are third-party themed art (see HID-042).
Acceptance:
  - [ ] Default build → no pet and no pet menu.
  - [ ] If revived: upload an animated GIF → it becomes the pet; hide it from the status bar → it
        goes away.
Compat: old profiles may hold the pet switch; it is ignored.
Decision: H: default skip
Source: D-21-025

### HID-028 · Agent sleep (hibernation), off by default
Tier: H · Pushed: — · State at 0.15.0: hidden · State now: experimental, off by default (T-817)
User does: turns on "Agent sleep" in Settings > General > Experimental and sets how many idle
  minutes to wait.
User sees: agents left idle past the chosen delay (30 minutes unless changed) are put to sleep to
  free up memory; the pane shows a placeholder with Wake (TERM-123 has the rules).
Rules: experimental switch (`agentSleep`, only a saved true is on); the delay (`agentSleepIdleMinutes`)
  is held between 5 and 240 minutes: below 5 saves as 5, above 240 as 240, missing reads as 30; the
  Rust side holds the delay the window sends between the same bounds before it checks the terminal
  and the status row against it. A development build may read a test-only `agentSleepTestFast` key
  (20-second delay, on both sides) so the sleep can be watched; a release build never reads it, so
  users cannot go below 5 minutes.
Acceptance:
  - [x] Fresh profile → agent sleep is off and an agent idle for longer than 30 minutes keeps
        running. (T-817: `sleepOn({})` is false and no timer is set while off,
        `src/sleep/agentSleep.test.ts`; `cargo test --lib t817` "switch is off on a fresh profile")
  - [x] If revived: enter a delay below the lower bound → the saved delay is raised to that bound.
        (T-817: `clampIdleMinutes(4)` is 5 and `minutesFromText("3")` saves 5, the box then shows
        the stored 5; `src/sleep/agentSleep.test.ts`, `src/settings/ExperimentalCard.tsx`)
Compat: old profiles may hold the sleep switch under its old key; it is ignored (the new key has
  another name, so it is never read; tested in both languages).
Decision: Txais 2026-11-09, DT-C242: build it, off by default (was H: default skip)
Source: D-21-028

### HID-033 · Hidden experimental group: terminal drawing diagnostics
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: Option-clicks the title of the Experimental page to reveal a hidden group for this run of
  the app, then arms the drawing diagnostics.
User sees: once armed, Ctrl-click (Cmd-click on a Mac) on a pane starts a short burst of sampling,
  and Shift+Ctrl-click writes that pane's captured evidence to disk.
Rules: the reveal lasts only until the app restarts; it exists to chase terminal drawing bugs and is
  not meant for everyday users.
Acceptance:
  - [ ] Default build → no hidden group and no diagnostic clicks on panes.
  - [ ] If revived: reveal the group, restart the app → the group is hidden again.
Compat: —
Decision: H: default skip
Source: D-21-033

### HID-034 · Dev Tools settings page (development builds only)
Tier: H · Pushed: — · State at 0.15.0: dev-only
User does: opens Settings in a development build.
User sees: a Dev Tools page that checks the native action layout, fires sample toasts and
  notifications, and previews the cloud sign-in.
Rules: shown only when the build is a development build.
Acceptance:
  - [ ] Release build → Settings has no Dev Tools page.
  - [ ] If revived, in a development build → the page fires a sample toast on request.
Compat: —
Decision: H: default skip
Source: D-21-034

### HID-038 · Per-agent rows on sidebar worktree cards, left as dead code (retired on or before 2026-09-22)
Tier: H · Pushed: — · State at 0.15.0: retired 2026-09-22
User does: looked at a worktree card in the sidebar.
User sees: the card once listed every agent running in that worktree.
Rules: replaced twice over by rows per session; nothing of it is still used apart from one scrolling
  detail; its four checks remain in the old project; it was retired on or before 2026-09-22, the
  exact date is unknown.
Acceptance:
  - [ ] Default build → sidebar worktree cards list sessions, with no separate per-agent list.
  - [ ] Run two agents in one worktree → each shows as its own session row (area 05).
Compat: —
Decision: H: default skip
Source: D-21-038

### HID-039 · Bundled agent maker logos (29 images plus an OpenClaude logo)
Tier: X · Pushed: 10 · State at 0.15.0: live
User does: opens the launcher or a list of agents.
User sees: every agent wears its maker's own logo, from Copilot, Cursor, Gemini, Devin, Qwen and
  others.
Rules: these are other companies' logos shipped inside the app; the rebuild replaces them with the
  owner's own icons.
Acceptance:
  - [ ] Open the launcher → every agent icon is the owner's own artwork.
  - [ ] Look through the images bundled with the app → none of the makers' logos are present.
Compat: —
Source: D-21-039

### HID-040 · Redrawn provider marks (Claude, OpenAI, Gemini, MiniMax and others)
Tier: X · Pushed: 10 · State at 0.15.0: live
User does: looks at the status bar or a list of agents.
User sees: marks for Claude, OpenAI, Gemini, MiniMax, Droid, Pi, Omp, Kilo, Aider and Copilot are
  drawn as built-in vector icons, plus a shipped MiniMax picture.
Rules: these redraw third-party marks and are not the owner's art; the rebuild replaces them with
  the owner's own icons.
Acceptance:
  - [ ] Show the status bar and an agent list → no provider's own mark appears.
  - [ ] Look through the built-in icon set → each provider has an owner-made icon.
Compat: —
Source: D-21-040

### HID-041 · Agent icons fetched live from Google's favicon service
Tier: X · Pushed: 10 · State at 0.15.0: live
User does: sees an agent that has no bundled icon.
User sees: the icon is downloaded while the app runs, from a Google favicon service, using the
  agent's website address.
Rules: a call to a third party that the app's published privacy list does not mention; the
  rebuild uses the owner's own icons and never fetches icons at run time.
Acceptance:
  - [ ] Show an agent that lacks a bundled icon while watching network traffic → no icon request
        leaves the machine.
  - [ ] That agent shows a neutral owner-made icon instead.
Compat: —
Source: D-21-041

### HID-042 · Pet character art (Claudino and Gremlin)
Tier: X · Pushed: 10 · State at 0.15.0: live
User does: turns on the pet and picks a built-in character.
User sees: the two built-in pets are a Claude-themed wizard and a gremlin.
Rules: third-party themed art that ships with the experimental pet; the rebuild replaces it with the
  owner's own art if the pet is ever revived.
Acceptance:
  - [ ] Look through the images bundled with the app → neither character is present.
  - [ ] If the pet is revived → its built-in characters are the owner's own.
Compat: —
Source: D-21-042

### HID-043 · Shell, editor and terminal-app logos
Tier: X · Pushed: 10 · State at 0.15.0: live
User does: picks a shell for a new tab, opens a folder in another editor, or imports a terminal
  theme.
User sees: PowerShell, cmd, WSL and Git for Windows logos in the shell picker; VS Code, Cursor and
  Zed icons in the open-in menu; Ghostty and Warp logos in theme import.
Rules: all of them are other products' logos; the rebuild replaces them with the owner's own icons.
Acceptance:
  - [ ] Open the shell picker, the open-in menu and theme import → every icon is owner-made.
  - [ ] Each entry still names its product in plain text so the user can tell them apart.
Compat: —
Source: D-21-043

### HID-044 · Integration and phone-platform logos (GitHub, GitLab, Jira, Linear, iOS, Android)
Tier: X · Pushed: 10 · State at 0.15.0: live
User does: opens task, integration or Mobile screens.
User sees: GitHub, GitLab, Jira and Linear logos mark the integrations, and iOS and Android marks
  appear on the Mobile page.
Rules: GitHub stays as an integration while GitLab, Jira, Linear and the phone page leave with their
  dropped features; whatever mark remains is replaced with the owner's own icon.
Acceptance:
  - [ ] Open the GitHub task screens → the integration mark is owner-made.
  - [ ] Look through the images bundled with the app → no GitLab, Jira, Linear, iOS or Android mark
        is present.
Compat: —
Source: D-21-044

### HID-030 · Ephemeral VMs switch (off by default)
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: turns on ephemeral VMs under Settings › Experimental.
User sees: agents can run inside throwaway virtual machines built from recipes.
Rules: the switch starts off; the feature belongs to remote and hosts.
Acceptance:
  - [ ] Default build → no virtual machine option anywhere.
  - [ ] Load an old profile with the switch on → it loads cleanly and the switch is ignored.
Compat: —
Decision: default cut: ephemeral VM recipes go with area 18 (remote & hosts), dropped by the owner
  2026-10-05. Revive via DECISIONS.md.
Source: D-21-030

### HID-031 · Experimental mobile switch and the Kolux Mobile button (off by default)
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: turns on the mobile switch, or the mobile button from the View menu.
User sees: a Kolux Mobile button and an entry under View › Appearance open the phone companion page.
Rules: both start off; there is no Kolux-owned phone app yet.
Acceptance:
  - [ ] Default build → no Kolux Mobile button and no phone entry in the View menu.
  - [ ] Load an old profile with either switch on → it loads cleanly and both are ignored.
Compat: —
Decision: default cut: the phone companion goes with area 18 (remote & hosts), dropped by the
  owner 2026-10-05. Revive via DECISIONS.md.
Source: D-21-031

### HID-032 · Plugin system switch and developer plugin folders (off by default)
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: turns on the plugin system and lists local plugin folders.
User sees: a plugin runtime loads plugins, including developer plugins from the folders listed.
Rules: the switch starts off.
Acceptance:
  - [ ] Default build → no plugin switch and no plugin folder list.
  - [ ] Load an old profile with plugins switched on and folders listed → it loads cleanly and
        nothing is loaded from those folders.
Compat: —
Decision: default cut: plugin marketplace and runtime (table 1b). Revive via DECISIONS.md.
Source: D-21-032

## Dropped by default (tier D)

- HID-030 · Ephemeral VMs switch · ephemeral VM recipes leave with area 18 (remote & hosts), owner
  cut 2026-10-05; revive via DECISIONS.md.
- HID-031 · Experimental mobile switch and the Kolux Mobile button · the phone companion leaves with
  area 18, owner cut 2026-10-05; revive via DECISIONS.md.
- HID-032 · Plugin system switch and developer plugin folders · plugin marketplace and runtime cut
  in table 1b; revive via DECISIONS.md.

## Hidden or retired (tier H)

- HID-001 · Every terminal in its own desktop window · rolled back 2026-09-15 · default skip
- HID-010 · Agent Dashboard as a separate desktop window · retired 2026-10-05 · default skip
- HID-011 · Agent Map · retired 2026-10-05 · default skip
- HID-020 · Agent Dashboard drawer · experimental switch, off by default · default skip
- HID-021 · Agent Dashboard kanban board · hidden with the drawer · default skip
- HID-022 · Agent Dashboard card and host badge · hidden with the drawer · default skip
- HID-023 · Agent Dashboard terminal preview panel · hidden with the drawer · default skip
- HID-026 · Activity view · switch off by default, no way in · default skip
- HID-027 · Terminal attention highlight · experimental switch, off by default · default skip
- HID-005 · Kolux Account cloud sign-in · hidden 2026-09-28, removed 2026-10-05 · default skip
- HID-017 · Status-bar usage block · removed 2026-10-05 · default skip
- HID-035 · Profiles · development builds only · default skip
- HID-002 · Sidebar view entries and title-bar view switch · removed 2026-09-22 · default skip
- HID-014 · Swarm pane footer · removed 2026-10-05 · default skip
- HID-015 · Message box under each grid pane · removed 2026-10-05 · default skip
- HID-045 · Shared message box under a workspace's panes · removed 2026-09-15 · default skip
- HID-016 · Sessions minus/plus stepper · removed 2026-10-05 · default skip
- HID-029 · New worktree card style · experimental switch, off by default · default skip
- HID-018 · In-app nudges · removed 2026-10-05 · default skip
- HID-019 · Update-available toast · replaced 2026-10-06 · default skip
- HID-036 · Retired settings dropped on load · in use since the 2026-09-10 fork · default build
- HID-006 · Phone pairing through a cloud relay · hidden 2026-09-28, removed 2026-10-05 · default
  skip
- HID-007 · Cloud artifact sharing · hidden 2026-09-28, removed 2026-10-05 · default skip
- HID-008 · Sharing skills by link · hidden 2026-09-28, removed 2026-10-05 · default skip
- HID-009 · Phone app store links and QR pairing · retired 2026-09-29 · default skip
- HID-037 · The Nightshift name · retired 2026-09-22 · default skip
- HID-003 · Floor and Agent grid pages · unreachable since 2026-09-22 · default skip
- HID-004 · OpenCode support · removed 2026-09-23 · default skip
- HID-012 · Desktop voice dictation · removed 2026-10-05 · default skip
- HID-013 · Input settings page · removed 2026-10-05 · default skip
- HID-024 · Native chat and structured native chat · two switches, off by default · default skip
- HID-025 · Pet · switch off by default · default skip
- HID-028 · Agent sleep · experimental switch, off by default · default skip
- HID-033 · Hidden terminal drawing diagnostics · unlocked per run, off by default · default skip
- HID-034 · Dev Tools settings page · development builds only · default skip
- HID-038 · Per-agent rows on sidebar worktree cards · retired 2026-09-22 (on or before) · default skip
