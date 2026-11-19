# 21 · H — retired, hidden, removed, dev-only

This area is the register of what Kolux once did and no longer does, what it still does only behind
a switch that starts off, what appears only in development builds, and the other companies'
artwork the app ships with. Each entry is short on purpose: it names the behaviour so the owner can
decide whether to bring it back, records when and why it went, and says what the rebuild must still
tolerate (mostly old saved settings that should be ignored without fuss). Nothing here is built by
default. The one exception is the quiet handling of retired settings in old profiles, which the
normal startup path depends on. The X cards list bundled third-party logos and art that the rebuild
replaces with the owner's own.

Tier counts: P0 0 · P1 0 · P2 0 · H 567 · X 6 · D 57
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
  applied at launch (see VIEW 054), though no visible control sets it any more; the dialog that
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
Rules: experimental switch (only a saved true is on); the delay
  is held between 5 and 240 minutes: below 5 saves as 5, above 240 as 240, missing reads as 30; the
  Rust side holds the delay the window sends between the same bounds before it checks the terminal
  and the status row against it. A development build may read a test-only fast key
  (20-second delay, on both sides) so the sleep can be watched; a release build never reads it, so
  users cannot go below 5 minutes.
Acceptance:
  - [x] Fresh profile → agent sleep is off and an agent idle for longer than 30 minutes keeps
        running. (T-817: an empty profile reads as off and no timer is set while off,
        agent sleep unit tests; Rust tests t817 "switch is off on a fresh profile")
  - [x] If revived: enter a delay below the lower bound → the saved delay is raised to that bound.
        (T-817: a delay of 4 is held at 5 and typing 3 saves 5, the box then shows the stored 5;
        agent sleep unit tests)
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

## Retired in the 2026-11-19 slim-down

These entries were moved here from the other spec areas when about half of Kolux was retired. Each
keeps its card ID and title and says in one line what it did for the user. All of it is kept at the
classic-final tag, nothing here is built any more, and no other area depends on it.

### PROJ-077 · kolux worktree create and remove
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user creates or removes workspaces from a terminal or from an orchestrating agent.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-030 · Open an existing branch or pull request as a workspace
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user picks an existing branch or a pull request when creating a workspace.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-033 · A project setup script runs when a workspace is created
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user sets a setup script on the per-project page or in kolux.yaml, then creates a workspace.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-037 · Create a workspace straight from a GitHub issue or pull request
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user pastes an issue or pull request URL into the palette, or uses the CLI's issue flag.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-042 · Show or hide individual worktrees, with defaults for new projects
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the worktree visibility dialog for a project.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-044 · Kolux tells its own worktrees apart from external and scratch ones
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user has worktrees made by Kolux, by hand and by agent tools in the same repository.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-034 · kolux.yaml shares setup, issue command and tabs with the whole team
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user commits a kolux.yaml file at the root of the repository.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-085 · Workspace board: lanes by status
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the workspace board and drags cards between lanes.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-078 · kolux worktree list, show, current and set
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user looks up or edits workspaces from the CLI.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-079 · kolux worktree changes and kolux worktree overlap
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user asks which files a workspace has changed, or which workspaces touch the same files.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-012 · Scan a parent folder for the repositories inside it
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user picks a folder that is not a repository itself but holds several.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-013 · Import found repositories as one group or as separate projects
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user ticks repositories in the checklist and says whether to group them.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-014 · Project groups organise the sidebar
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user creates, renames and nests project groups and moves projects into them.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-015 · Delete a project group, with or without its projects
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user deletes a project group.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-071 · Delete many workspaces at once
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user selects several rows and deletes them.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-076 · Forget a workspace locally without touching disk
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user chooses forget on a workspace whose folder or project is gone.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-083 · Space view: what each workspace costs on disk
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Space view.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-084 · Workspace statuses form a workflow
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user moves a workspace to a status, or edits the list of statuses.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-035 · Sidebar card that suggests adding a setup script
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user works in a project that has no setup script in effect.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-036 · Linked issues can start with a per-project issue command
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user creates a workspace linked to a GitHub issue in a project that has an issue command.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-018 · Projects pick up an icon from the repository
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user adds a project.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-069 · Repositories are tidied quietly in the background
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user leaves Kolux idle.
Retired 2026-11-19; kept at the classic-final tag.

### PROJ-088 · Friendly local addresses for each workspace's dev server
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user turns on workspace localhost labels.
Retired 2026-11-19; kept at the classic-final tag.

### SESS-026 · Setup scripts and hook trust are settled before any agent starts
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user launches agents in a project that has a setup script or repo hooks.
Retired 2026-11-19; kept at the classic-final tag.

### SESS-032 · The opening prompt reaches the agent exactly once, or the user is told
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user launches an agent with a prompt.
Retired 2026-11-19; kept at the classic-final tag.

### SESS-031 · Carry a conversation over to a different agent
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user chooses to continue the current session in another agent.
Retired 2026-11-19; kept at the classic-final tag.

### TERM-125 · Terminal commands in the CLI
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux terminal commands from a shell or agent.
Retired 2026-11-19; kept at the classic-final tag.

### TERM-099 · Import settings from Ghostty
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user imports an existing Ghostty config.
Retired 2026-11-19; kept at the classic-final tag.

### TERM-100 · Import Warp themes
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user imports a theme from Warp.
Retired 2026-11-19; kept at the classic-final tag.

### TERM-121 · Setup script runs in its own tab
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user creates a worktree whose repo has a setup script.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-008 · Codex status, with hook trust handled for the user
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Codex in a pane and approves or answers what it asks.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-050 · Inbox of what needs you, what is running and what finished today
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks the bell button labelled 'Inbox' in the top bar, then steps through the items with the arrow keys.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-003 · kolux agent hooks commands
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs the agent hooks commands from any shell to check, enable, disable or prepare the hooks.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-009 · Gemini CLI status
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Gemini CLI in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-010 · Antigravity status
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Antigravity in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-011 · Amp status through a Kolux plugin
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Amp in a pane and sometimes cancels a turn.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-012 · Cursor Agent status
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Cursor Agent in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-013 · Droid status
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Factory's Droid in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-014 · Command Code status from tool events and its transcript
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Command Code in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-015 · Kimi status in a marked block of its settings
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Kimi in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-016 · Hermes status through a switched-on plugin
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Hermes in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-017 · Copilot CLI status
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs GitHub Copilot CLI in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-018 · Grok status, with its hook settings removed at quit
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Grok in a pane, quits Kolux, or edits or empties Grok's hook settings by hand.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-061 · Grok questions show needs you with the question
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Grok in a pane and gets asked a question by it.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-019 · Devin status in its commented settings file
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Devin CLI in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-020 · MiMo Code status through a plugin in a separate home
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs MiMo Code in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-021 · Pi and OMP status and titles through Kolux extensions
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Pi or OMP in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### STAT-056 · Repository scripts need the user's trust before running
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user opens a repository whose kolux.yaml defines setup scripts or default tab commands.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-026 · Open a session's live terminal inside its Board card
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user expands a card to see its terminal, then closes it.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-037 · Worktree palette: jump anywhere
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+J (Mac) or Mod+Shift+J (Windows, Linux) and types.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-016 · One line per session says what the agent is doing
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user scans the Agents rail.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-017 · Fixed status words on the Agents screen
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user reads a session's status label.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-023 · Board columns and card status chips
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user opens Board.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-025 · Approve or deny from a Board card
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks approve or deny on a card that needs permission.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-040 · Palette rows show live agent state and age
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the palette while agents run.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-047 · Jump to the next session that needs you
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+Shift+J (Mac) or Mod+J (Windows, Linux).
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-008 · Weekly usage pill in the top right
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user glances at the top-right corner.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-018 · Usage line on the Agents screen
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user looks at the selected session's usage line.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-001 · Three workspace screens: Agents, Board and Terminals
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks Agents, Board or Terminals in the screen switch in the top bar.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-002 · Cycle the workspace screen from the keyboard
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+Alt+V, or picks a screen from View > Workspace View.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-003 · Full-width top bar with search hint and inbox bell
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user in the new look, glances up at the top bar and clicks its search hint or its bell.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-004 · No worktree sidebar on Agents and Board
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user switches between the three screens in the new look.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-015 · Agents screen lists sessions by saved agent
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Agents screen.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-019 · Chat, terminal and composer for the selected session
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user selects a session on the Agents screen, types in its composer, or flips the Show terminal switch.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-021 · Add a session from the Agents screen
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks + on an agent group, clicks New session on the empty rail, or sees the empty state on a fresh profile.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-024 · Board shows every terminal session in order
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user opens Board with several tabs and splits.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-050 · Left sidebar: show, hide, resize and focus
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+B, drags the sidebar edge, or presses Mod+Shift+0.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-051 · Sidebar card lists projects and their sessions
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user looks at the left sidebar in the new look and clicks a row.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-005 · The app reopens on the screen and page you left
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user leaves Kolux on a screen or a full page (for example Tasks), quits and restarts.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-107 · Saving the workspace when Kolux quits
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user quits Kolux with work open.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-020 · Hand one agent's result to another agent
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user from a finished session, chooses to send its result to another session.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-012 · Artifacts library
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Artifacts page, adds a file with Add artifact, types in the search box, selects an item, or removes one.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-036 · Add or remove sessions by shortcut
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user binds and presses the add-session or remove-session command.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-097 · Keep the computer awake while agents run
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user uses the keep-awake item in the status bar.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-108 · Terminals keep their scroll position across view switches
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user switches worktree or screen while an agent streams output, then comes back.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-014 · Space view: disk use per worktree and bulk delete
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Space page (Mod+Alt+S, T-746), sorts or searches the table, ticks rows and deletes.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-038 · Palette ranking
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user types a query in the palette.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-041 · Filter the palette by repository
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user adds filter chips in the palette.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-042 · Create a worktree and run quick actions from the palette
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user types a name with no match and picks the create row, or types an action word.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-046 · Move between worktrees by keyboard
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+Alt+Left or Right, Mod+Shift+Up or Down, or Mod+1 to Mod+9.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-048 · Delete-workspace and rename-tab shortcuts
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+Shift+Backspace or Mod+R.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-053 · Show or hide sleeping workspaces
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user toggles sleeping workspaces in the sidebar or with a bound shortcut.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-068 · Branch summary against the base branch
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user looks at the top of Source Control.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-076 · Folder workspaces: attached worktrees and PR checks
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user opens a folder workspace that spans several repos.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-112 · Import setup scripts from other tools' configs
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user adds a repo that already has a workspace setup config from another tool.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-073 · Checks panel for the current pull request
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Checks tab.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-075 · PR comments as cards in the sidebar
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user reads pull request comments in the sidebar, reacts, resolves, or queues a thread for the agent.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-084 · Session rows show prompt, latest turn, sub-agents and worktree
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user reads or expands a session row.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-088 · Find the live pane a past session is running in
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user opens a session that is still running.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-093 · Tab titles follow session names
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs an agent whose session gets a title.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-054 · Per-worktree skip-permissions override
Tier: D
What it did: the user sets or clears the skip-permissions mode for one worktree.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-067 · Discard changes with confirmation
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user discards a file or all changes in a section.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-089 · Delete, reveal or open a past session's files
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user deletes a session from its row menu, opens its raw log, reveals the file or copies its path.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-099 · Kill a terminal session from the Resource Manager
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks kill on a session row, or uses Manage Sessions.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-116 · Confirmation prompts: Enter, Escape and don't ask again
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user is asked to confirm an important or destructive action, such as deleting or discarding.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-006 · Each workspace screen can have its own theme
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user picks a theme override for one of the three screens.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-009 · Full-page views open over the workspace
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user opens Tasks, Automations, Skills, Artifacts, Space, Inbox, Floor or Settings;.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-056 · Right sidebar: open, close, width and remembered tab
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+L, drags its edge, or switches tabs and restarts.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-057 · Right sidebar tab strip
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks the tab icons at the top of the right sidebar, or presses a panel shortcut.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-086 · Resume a past session as chat
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user chooses to resume a session in chat.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-096 · Status bar: show, hide and choose items
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user toggles View > Appearance > Show Status Bar, or right-clicks the bar.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-100 · Skill and app update progress in the status bar
Tier: H · Pushed: 8 · State at 0.15.0: retired 2026-11-19
What it did: the user updates bundled skills, or lets Kolux download an app update.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-007 · Screen and sidebar preferences stay in step across windows
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user changes the workspace screen or the sleeping-workspaces toggle in one Kolux window.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-027 · Large workspace boards stay smooth
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the sidebar's workspace board, which sorts worktrees into status lanes, with many lanes or cards.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-066 · Push failures explain themselves
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user pushes and the push fails.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-080 · Agents tab: past sessions for this workspace
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Agents tab in the right sidebar and chooses workspace, project or all.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-081 · Search, filter and group past sessions
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user types in the session search, picks agents, or changes grouping.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-082 · Session list view options persist
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user changes sort, grouping, agents shown or history depth, or resets them.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-083 · Session list refreshes without stealing keystrokes
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user returns to the tab, presses refresh, or starts an agent in Kolux.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-085 · Resume a past session in a terminal
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks resume, drags a session into a pane, or copies the resume command.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-091 · Session history reads many agents' transcripts
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user uses several agent CLIs over time.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-095 · Handoff note autosaves
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user writes in a workspace's handoff note.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-098 · Resource Manager: memory and CPU per worktree
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks the resource item in the status bar, then a session row.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-011 · Automations and Skills pages
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user turns on the Automations or Skills title-bar button, or opens either page.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-069 · Ask an agent to fix things from Source Control
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user chooses an agent action such as resolving conflicts.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-087 · Continue a session with another agent
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user chooses to continue a past session with the same or a different agent.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-010 · Tasks page button and shortcut
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks the Tasks button in the title bar, or a bound shortcut.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-043 · Find pull requests and checks from the palette
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user types a pull request number or title in the palette.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-059 · Explorer file tree
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user browses the worktree's files in the Explorer tab, or narrows them with the name filter.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-060 · Explorer file operations
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user renames inline, deletes, undoes, copies a path, or drags files.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-061 · Search in files from the right sidebar
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+Shift+F or flips the Explorer to its search view, types a query, clicks a result.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-062 · Source Control: changed files list
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens Source Control.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-063 · Open a changed file's diff
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks a changed file, or modifier-clicks it, or right-clicks it.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-064 · Commit box with saved drafts and AI message
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user writes a commit message or asks for one to be generated, then commits.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-065 · One main git button that changes with the state
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks the main Source Control button or opens its dropdown.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-070 · Create or link a pull request from the sidebar
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user starts a pull request from Source Control, or links an existing one.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-071 · Git history in the sidebar
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens the git history list.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-074 · Start a pull request from Checks
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user starts a review from the Checks panel;.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-078 · Ports in the status bar
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks the ports item in the status bar.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-105 · Link popover: choose where a link opens
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks a link in Kolux.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-109 · Keyboard layouts, Option as Alt and key protocols
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user types in terminals on a non-US layout, on a Mac with Option, in a full-screen program, or through an input method.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-110 · Clipboard size limits and terminal copy
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user copies large text or images, or lets a terminal program copy.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-013 · Floor timeline of agent activity
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Floor page and picks a range of 15 minutes, 60 minutes or today.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-111 · First-run notification permission
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user starts Kolux for the first time on a Mac.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-114 · Onboarding checklist and setup guide in the sidebar
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user adds a first project, or skips onboarding and opens a folder.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-052 · Left sidebar tint
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user chooses a sidebar appearance mode, tint colour and opacity.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-090 · Scan notices in the session list
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the list when something blocked or limited the scan.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-092 · Session scans run in the background and survive restarts
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the list on a machine with thousands of sessions.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-115 · The shell avoids needless redraws
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user works with many tabs and agents.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-039 · Palette list caps and focus return
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user searches something that matches many items, then closes the palette or picks a row.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-072 · Send or clear review notes
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user sends the review notes written on diffs to the agent, or clears them.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-106 · View, Help and Appearance menus
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user uses the app menus, including View > Appearance.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-113 · Markdown view preferences
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a Markdown file and switches preview, contents panel or frontmatter.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-117 · Hover-only buttons stay visible on touch screens
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user uses Kolux on a touch screen or pen, where nothing can hover.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-118 · Select changed files and stage or unstage them together
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user right-clicks a changed file in Source Control, or extends a selection of changed files, then uses the bar that appears under the list.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-034 · Agent Grid page (retired 2026-09-22)
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user used to switch the sidebar to an agent grid.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-029 · Agent Dashboard drawer
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user with the experimental dashboard setting on, opens the drawer (also from a bound shortcut), and launches or types to agents from its cards.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-031 · Separate dashboard window and the Agent Map (retired 2026-10-05)
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user used to pop the dashboard into its own window or see agents on a map.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-033 · Activity page
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user turns on the Activity experiment and opens the page.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-101 · Restart stale Codex sessions from the status bar (retired 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user notices the Codex restart item after a Codex account change.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-102 · Provider usage chips in the status bar (retired 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user used to read Claude, Codex and other providers' usage in the status bar.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-028 · Swarm pane footer and terminal-grid message bar (retired 2026-10-05)
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user used to answer, approve or deny, or type to an agent from a strip under each terminal pane.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-030 · Read-only Runs view in the dashboard
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user with the dashboard on, opens its Runs tab.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-032 · Desktop pet that reacts to agents
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user turns on the pet experiment.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-049 · Switch a tab between chat and terminal
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user toggles a tab's mode.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-104 · Third-party provider logos in usage UI
Tier: H · Pushed: 10 · State at 0.15.0: retired 2026-11-19
What it did: the user sees provider marks next to usage items.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-022 · Custom-agent builder from the Agents screen
Tier: D
What it did: the user clicks + beside the agents heading or the empty-state call to build an agent.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-035 · Kolux Mobile page and title-bar button
Tier: D
What it did: the user turns on the Kolux Mobile button and opens the page.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-044 · Plugin actions in the palette
Tier: D
What it did: the user searches for an action a plugin added.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-045 · Host badges and host-qualified rows in the palette
Tier: D
What it did: the user uses the palette with more than one machine connected.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-055 · Workspace host scope in the sidebar
Tier: D
What it did: the user chooses which machines' workspaces the sidebar shows and in what order.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-058 · Plugin panels in the right sidebar
Tier: D
What it did: the user opens a tab a plugin added to the right sidebar.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-077 · GitLab merge requests in the Checks panel
Tier: D
What it did: the user opens Checks on a GitLab branch.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-079 · Ports tab for remote repositories
Tier: D
What it did: the user opens the Ports tab on an SSH repository.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-094 · Past sessions on remote machines
Tier: D
What it did: the user browses or resumes sessions stored on an SSH host, WSL or a paired runtime.
Retired 2026-11-19; kept at the classic-final tag.

### VIEW-103 · Remote host status in the status bar
Tier: D
What it did: the user looks at the Remote Hosts item.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-002 · Board cards carry a compact session meter
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Board and looks at the card for one session.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-003 · Agent tabs carry a tiny context ring
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user glances along the tab strip.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-004 · Agents view shows rings per session and a plan footer
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Agents view and picks an agent.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-005 · How the meters work out context and plan figures
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user reads any meter, ring or header percentage.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-006 · Claude, Agent Teams and Codex are held to a 200k window by default
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user starts Claude, Claude Agent Teams or Codex;.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-007 · Claude carries on by itself once a limit resets (opt-in)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user turns on resume-after-limit in the Claude part of the AI connections page, then leaves a Claude session that runs into its usage limit.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-008 · Weekly usage pill at the top right
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user looks at the top right corner of the window.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-021 · Claude plan figures read safely from several sources
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user uses Claude through a browser sign-in, a long-lived token, or a sign-in managed outside Kolux.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-022 · Codex plan figures read without opening a session
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user uses Codex with one or more signed-in accounts.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-001 · Each agent pane header carries a context ring and a percentage
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user looks at the header of an agent pane.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-023 · Usage figures refresh on a timer and ride out errors
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user leaves Kolux open, comes back to its window, or presses a refresh button.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-009 · Alerts at 80% and 95% of a usage window
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user carries on working while an account's usage rises.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-010 · Launch dialogs warn when an account is nearly spent
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Launch agents dialog or a starter-kit setup and chooses agents.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-011 · Stats & Usage page with Kolux activity counts
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user opens Settings and chooses the Stats & Usage page, or types usage into the command palette.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-012 · Usage analytics opens on a combined overview
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user scrolls to usage analytics on the Usage page and uses the provider picker (Overview, Claude, Codex, Grok).
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-013 · Token tracking is opt-in for each provider
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user turns Claude or Codex token tracking on or off from its panel or from the overview.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-014 · Claude and Codex token analytics panels
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user picks Claude or Codex in the provider picker and changes the range and scope filters.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-015 · Estimated cost from each model's published prices
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user reads the estimated cost on the overview, a provider panel or a share card.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-018 · Grok credits panel
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user picks Grok in the usage analytics picker.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-016 · Claude log scan counts each turn once
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user uses Claude as usual, forking and resuming sessions too, then opens Claude analytics.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-017 · Codex log scan counts each token event once
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user uses Codex both through Kolux and on its own, then opens Codex analytics.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-019 · Share a usage card as a picture or a post
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks Share on the Claude or Codex panel.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-024 · Reset times count down live
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user hovers the usage pill or reads a reset time in a usage line.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-025 · Choose whether usage reads as used or left
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user in Appearance, under the status bar section, sets Usage percentages to Used or Remaining.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-026 · Gemini and Antigravity quota reading
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user opts in to letting Kolux use the Gemini CLI sign-in for usage, then works with Gemini or Antigravity.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-027 · Kimi and MiniMax quota reading
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user signs in to Kimi, or saves a MiniMax browser cookie or API key along with region, group and model choices.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-028 · Resource Manager lists terminals picked up after a reload
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Resource Manager after Kolux reconnected to terminals that outlived a window reload.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-029 · Status-bar usage segments and account bars (retired 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user used to read usage from the status bar.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-030 · Usage overview dialog (no way to open it since 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user used to open a usage overview from the status bar.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-031 · Forecast of when a usage window runs out (off screen since 2026-10-05)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user used to hover a provider's usage in the status bar.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-032 · Notice that the usage percentages changed meaning
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user upgraded from a version that showed usage the other way round.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-020 · X logo on the post-sharing button
Tier: H · Pushed: 10 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the share dialog.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-033 · Usage reading and auto-resume for WSL, SSH and mobile
Tier: D
What it did: the user runs agents inside WSL or over SSH, or follows usage from the phone app.
Retired 2026-11-19; kept at the classic-final tag.

### USAGE-034 · Every agent pane header shows the full usage readout
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user looks at the header of any Claude agent pane (every screen, not just Agents).
Retired 2026-11-19; kept at the classic-final tag.

### ACCT-003 · A missing agent tool installs from its Connect card
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks "Install" on the card of an agent that is not on the machine.
Retired 2026-11-19; kept at the classic-final tag.

### ACCT-008 · Grok connects by its CLI login, a device code or a pasted xAI key
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks "Connect" on the Grok card, or picks "Sign in with a code" or "Use an xAI API key".
Retired 2026-11-19; kept at the classic-final tag.

### ACCT-034 · Model routing tiers per provider for workers
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user opens model routing in the Agents settings, chooses a provider, and sets a model and an effort level for each tier.
Retired 2026-11-19; kept at the classic-final tag.

### ACCT-027 · The Grok section shows the CLI sign-in and credit use
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Grok section, or clicks "Refresh usage".
Retired 2026-11-19; kept at the classic-final tag.

### ACCT-031 · kolux account add and kolux account list
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user runs the account commands in a terminal on the machine where Kolux is running.
Retired 2026-11-19; kept at the classic-final tag.

### ACCT-022 · Choose which Codex folder past sessions come from
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user sets the Codex home that session history is read from, or clicks "Reset".
Retired 2026-11-19; kept at the classic-final tag.

### ACCT-028 · MiniMax credentials for usage tracking
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user pastes a MiniMax session cookie or API key, chooses the endpoint, and may override the group id or the model names.
Retired 2026-11-19; kept at the classic-final tag.

### ACCT-029 · Use Gemini CLI credentials (experimental)
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user switches on the experimental setting for Gemini CLI credentials.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-016 · One command starts a worker agent in a worktree of its own
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user from a coordinator agent, runs kolux orchestration worker-start with a task (or the text of a new one) and an agent, optionally choosing a tier, a model or where the worker is placed.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-007 · An idle agent gets a one-line pointer typed in when mail arrives
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user leaves a coordinator or worker sitting idle while another agent writes to it.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-015 · Workers report done and send heartbeats
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user a worker sends a done report with an outcome of succeeded or failed, or sends a heartbeat.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-020 · See a worker's live state, including when it waits on a person
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration worker-show --dispatch <id>.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-021 · Read what a worker has written, from its transcript or its terminal
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs worker-read for a dispatch, optionally choosing the source, a cursor and a limit.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-012 · Changing a task's state, with guards that keep tasks and workers in step
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user runs task-update with a task id, a new state and an optional result.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-022 · Stop a worker and keep its worktree
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration worker-stop --dispatch <id>.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-001 · A coordinator opens a Run and its terminal becomes the Run's home
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user from inside an agent terminal, runs kolux orchestration run-create --objective <text>.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-002 · Switch between, inspect and list Runs from the coordinator terminal
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs run-use, run-current, run-list or run-show.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-003 · Send typed mail to a Run, a worker, a terminal or a group
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration send --subject <s> with an optional recipient, body and message kind.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-005 · check reads the mailbox oldest batch first and repeats it until acknowledged
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration check, perhaps with options to acknowledge, peek, show unread or all, filter by kind, or wait.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-006 · Answer a message, and browse recent mail
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs reply with a message id and a body, or inbox with an optional row limit and the full option.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-010 · Tasks can wait on each other and become ready when their dependencies finish
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration task-create --spec <text>, perhaps with dependencies, a title, a display name or a parent task.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-011 · List a Run's tasks, filtered or compact
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs task-list, perhaps filtering by status, showing ready tasks only, asking for the compact form, or naming a Run.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-013 · Hand a task to an agent terminal that already exists
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration dispatch --task <id> --to <handle>, perhaps with the inject, dry-run or return-brief options.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-014 · A worker's brief tells it how to report, ask and stay in touch
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user dispatches or starts a worker and looks at what it was told.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-018 · Choose a worker's model by work tier instead of by name
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs worker-start with a tier of major, deep, build or light.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-026 · List workers by terminal state to see what can be cleaned up
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs worker-list, optionally for one Run or one terminal state, with a page size of 1 to 100 and a cursor.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-037 · Coordinators see which workers need attention
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user reads worker-show or worker-read across a set of workers.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-040 · kolux worktree ps sums up orchestration across worktrees
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux worktree ps, optionally with a row limit.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-056 · Open agent prompts are noticed even with no hook reporting them
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user runs an agent that stops at an approval menu, a trust screen or a question.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-066 · A worker's agent row is named after its task, not its brief
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user starts workers from a coordinator, then looks at the agent rows in the Agents view or on the Board.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-023 · Abandon a worker's dispatch without touching processes or files
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration worker-abandon --dispatch <id>.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-032 · Workers cannot spawn further workers past a depth cap
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user a worker tries worker-start or dispatch to bring in another worker.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-033 · One Run cannot see or change another Run's work
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user two coordinators each run their own Run on one machine.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-036 · Typing into a worker's terminal takes it over
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks into a worker's tab and types.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-067 · Worker report commands carry a secret dispatch pass that output reads hide
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user starts a worker, lets it report back, and reads its output from the coordinator.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-008 · Waiting mail outlives a restart without repeating keystrokes
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user quits Kolux, or the daemon dies, while mail is waiting for an agent, then opens Kolux again.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-017 · A failed worker start says what happened and how to recover
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user runs worker-start and something goes wrong: setup fails, the agent never comes up, or time runs out.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-024 · Release a finished worker's terminal after saving its output
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration worker-release --dispatch <id> once the worker has settled.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-025 · Keep a settled worker's terminal open on purpose
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration worker-retain --dispatch <id>.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-027 · The coordinator hears when a worker's terminal dies
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user nothing;.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-030 · Retrying a command after a timeout never does the work twice
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user adds a retry request id to a command that changes something, or asks about a request after a dropped connection.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-034 · The orchestration store is private and upgrades in place
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user upgrades Kolux, or another user on the computer looks in the data folder.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-038 · In-flight workers come back inspectable after a restart
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user quits or crashes Kolux while workers are starting, running or stopping, then opens it again.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-039 · Finished worker tabs stay after a restart and do not wake by themselves
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user leaves a finished worker's tab open, restarts Kolux, then clicks the tab.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-053 · The background daemon starts once and checks it can run terminals
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user launches Kolux, or a second copy tries to start.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-054 · The command line reaches the open app through a local channel
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user runs any kolux command while Kolux is open.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-055 · Prompts typed into agents land exactly once
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user dispatches with inject, starts a worker, or queues several prompts quickly.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-058 · Removing a worktree stops its processes first
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user deletes a worktree that still has terminals or workers.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-004 · Group addresses fan one message out to several agents
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user sends to @all, @idle, @worktree:<id> or an agent-kind group such as @claude.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-009 · Delivered mail reads as a banner with sender, priority and a reply hint
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user reads mail in its text form, or watches an agent receive mail typed into it.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-019 · Give a worker a model and effort by name
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs worker-start with a model and, optionally, an effort level.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-028 · Decision gates hold a task until the coordinator decides
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs gate-create with a task, a question and optional choices, later gate-resolve with a resolution, and gate-list.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-029 · A worker asks the coordinator a question and waits for the answer
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user a worker runs kolux orchestration ask --question <text>, perhaps with choices and a timeout.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-031 · Reset orchestration state by scope
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration reset with the tasks, messages or all scope.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-041 · Start Claude Agent Teams inside a Kolux terminal
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user picks Claude Agent Teams in the agent picker, or runs kolux claude-teams with any Claude arguments in a Kolux terminal.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-065 · Every orchestration command speaks JSON for scripts and agents
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user adds --json to any orchestration command.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-042 · Agent Teams teammates open as real side-by-side panes
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Agent Teams in native-panes mode and the leader starts teammates.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-060 · Session tab inventory the command line and agents can read
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user asks the runtime which session tabs exist.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-035 · A task that keeps failing is no longer handed out
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user dispatches a task that fails over and over.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-057 · Many viewers follow one terminal without drifting apart
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user has a terminal open while both the command line and the app read it.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-059 · Closing a terminal retires it everywhere
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user closes a terminal tab or pane.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-043 · Kolux checks whether each agent has the orchestration skill
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user looks at which agents know how to use Kolux orchestration.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-061 · Runtime browser commands for agents
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user an agent drives the built-in browser through the runtime.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-062 · Runtime file commands for agents
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user an agent or the app reads, renames or lists files through the runtime.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-063 · Runtime git and GitHub calls
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user the app or an agent asks the runtime for git or GitHub data.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-064 · Runtime calls for past sessions and automations
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user the app lists past agent sessions or automations through the runtime.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-045 · Read-only Runs view in the agent dashboard
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user turns on the experimental agent dashboard and opens its Runs tab.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-048 · Taking over a coordinator Run left by an older Kolux
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user runs run-use on an old Run with the take-over option, in the live coordinator terminal.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-046 · Retired coordinator-start and coordinator-stop commands
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux orchestration coordinator-start (also reachable as kolux orchestration run) or kolux orchestration coordinator-stop (also kolux orchestration run-stop).
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-047 · Retired background coordinator that worked through a task graph on its own
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user can reach it only through an internal runtime call;.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-049 · Workers as structured chat sessions instead of terminals
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user with structured native chat set as the default, starts a worker.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-044 · Orchestration settings page
Tier: D
What it did: the user opened the Orchestration page in Settings.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-050 · Workers on remote servers
Tier: D
What it did: the user passed a remote server to worker-start, or asked worker-list to include remote workers.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-051 · Remote and mobile runtime connections
Tier: D
What it did: the user connected a phone or another computer to the runtime over the network.
Retired 2026-11-19; kept at the classic-final tag.

### ORCH-052 · Linear, Jira and GitLab calls through the runtime
Tier: D
What it did: the user let agents read or write Linear, Jira or GitLab issues through Kolux.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-013 · Numbered run history for each automation
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user opens an automation's Runs tab and selects a run.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-012 · Every run ends with a truthful status
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user checks on a run started by the timetable, by an event or by Run Now.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-001 · Launch an agent with a saved prompt on a timetable
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user makes an automation from a prompt, an agent and a timetable (every hour, every day, Monday to Friday, once a week, or a custom cron or RRULE line), with a time of day, a weekday where it applies, and a timezone.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-004 · Event triggers: pull request opened, checks failed, agent finished
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user switches the trigger from Schedule to Event and picks one of three happenings: a pull request is opened from a workspace branch, a pull request's checks fail, or an agent working in that project completes.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-005 · One dialog to create or edit an automation
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks New Automation, or Edit on an existing one, gives it a name, writes the prompt, chooses the agent, project and workspace, and saves.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-011 · Runs launch in the background and never take focus
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user carries on working in another worktree while an automation run begins.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-016 · Automations list with sorting, filters and search
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Automations page.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-019 · Run now, pause, edit or delete an automation
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user uses Run Now, the pause/resume switch, Edit or Delete on an automation.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-010 · Choose whether per-run worktrees run the project setup
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user for an automation that makes a new worktree every run, in a project that has a setup step (a kolux.yaml in the repo or a setup script saved in the project's settings), decides whether each new worktree should run it.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-015 · Runs dashboard across every automation
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks Runs in the Automations toolbar.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-014 · Saved run output with token and cost figures
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user opens a finished run.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-007 · Grace window for runs missed while Kolux was away
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user picks how late a missed run may still go: no grace, 30 minutes, or 1, 3, 12, 24 or 48 hours.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-021 · History keeps the newest 100 runs
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user leaves an automation running over a long period.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-022 · Runs refuse cleanly when the target is not ready
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user has an automation whose project or worktree has been removed, whose setup is out of date, or whose agent account needs signing in again.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-002 · Custom cron field that checks itself as you type
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user switches the timetable picker to Custom and types a cron line, or goes back to one of the presets.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-003 · Time picker with AM and PM
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user sets the time of day an automation should go.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-006 · Starter templates for a first automation
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user opens Automations before making any, or opens the template chooser from the editor's header.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-008 · A precheck command gates each run
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user enters a shell command to run ahead of the agent and chooses a time limit of 1, 2, 5 or 10 minutes.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-009 · Keep one agent session across runs
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user switches on session reuse for an automation that runs in an existing worktree.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-017 · Keyboard control of the list and the detail view
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user uses the arrow keys, Enter and Escape on the Automations page.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-018 · Automation overview with a collapsible prompt
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user selects an automation and reads its Overview tab.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-020 · The kolux automations command group
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux automations with list, show, create, edit, remove, run or runs from a terminal.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-025 · Hermes and OpenClaw cron jobs in the same list
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user has Hermes or OpenClaw installed on this computer and opens Automations, or picks Hermes in the Kolux or Hermes switch of the create dialog.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-023 · Automations row in the sidebar, off by default
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user switches on the Automations button from the Appearance submenu of the View menu or from Appearance settings, or hides it again from the sidebar row's right-click menu.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-024 · Hide or tag worktrees made by automations
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user turns on the sidebar filter that hides worktrees created by automations, or adds the Automation property to worktree cards.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-026 · Automations on SSH hosts and paired servers
Tier: D
What it did: the user chooses a remote host for an automation, filters the list by host, or moves an automation to another host.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-027 · Hermes and OpenClaw jobs on remote hosts
Tier: D
What it did: the user views or manages Hermes or OpenClaw cron jobs that live on an SSH host or a paired server.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-028 · Linear, Jira and GitLab as automation sources
Tier: D
What it did: the user attaches a Linear issue to an automation as source context, or expects GitLab pipelines to fire the checks-failed event.
Retired 2026-11-19; kept at the classic-final tag.

### AUTO-029 · Automations section in Settings
Tier: D
What it did: the user opens Settings and goes to the Automations section.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-023 · New worktrees are pre-trusted so an agent's first prompt is not lost
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user launches Claude Code, Codex, Cursor or Copilot in a freshly made worktree with a starting prompt.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-024 · A batch of Claude worktrees is trusted in one write before any agent starts
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user starts several Claude Code agents together, each in its own new worktree.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-001 · Pane header offers a plan-review button while Claude waits for plan approval
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user lets Claude Code work in plan mode until it asks permission to leave plan mode, then glances at that pane's header.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-002 · The review sheet breaks the plan into sections that each take comments
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the review sheet, reads the plan, comments on any section, and may write an overall note at the bottom.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-003 · Approving from the sheet lets Claude carry out the plan
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks Approve in the review sheet.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-004 · Request changes returns the plan to Claude with the user's comments
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user writes one or more section comments or an overall note, then clicks Request changes.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-009 · Claude stops and asks before running a protected shell command
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user runs a Claude Code session in a Kolux pane, and Claude tries a command that matches a protected rule.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-010 · Built-in rules protect git history: force-push to main and discarding uncommitted work
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user has Claude run git commands in a worktree.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-011 · Built-in rule: pause before dropping or emptying database objects
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user has Claude send destructive SQL through a database client.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-012 · Built-in rules protect live services: Stripe, infrastructure and production deploys
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user has Claude run payment, infrastructure or deployment tools.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-013 · Built-in rule: pause before a recursive delete that reaches outside the workspace
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user has Claude run a recursive delete in Bash, cmd or PowerShell.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-014 · Protected commands are still caught when wrapped, chained, nested or encoded
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user has Claude run a dangerous command tucked inside a wrapper program, a chain, or another shell.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-015 · The Protected actions section on the Safety page
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user opens Settings, then Safety, then Protected actions.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-019 · Secrets inside paused commands are masked before they are kept or shown
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user looks at the recent attempts after Claude tried a command that held a key or a password.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-021 · Paths on other machines are refused before any file access
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks or hovers a link to a path on another computer in a markdown preview or in terminal output, or something asks Kolux to open, check or grant access to such a path.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-022 · Clicking a link to a program reveals it in its folder instead of running it
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user uses the open-in-another-app click on a file link that points at a script, an installer or a shortcut.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-005 · Unsent comments are kept when the sheet closes and reopens
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user writes comments, closes the sheet without sending, and reopens it later.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-006 · A very long plan is cut down in the sheet, with a pointer to the terminal
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the review sheet for a very long plan.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-007 · The sheet turns read-only once Claude stops waiting on that plan
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user leaves the sheet open while the plan prompt is answered in the terminal, or while Claude moves on.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-016 · Users add their own protected rules by prefix, text or regular expression
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user in the Protected actions section, types an optional name, picks a match type (command starts with, contains text, or regular expression), enters a pattern such as npm publish, and clicks Add rule.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-017 · Protected rules can differ per project, and each scope can be reset
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user picks a project in the scope picker of the Protected actions section, switches or adds rules there, or clicks Reset to defaults.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-018 · A recent-attempts list shows what was paused and how it ended
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user scrolls to the recent attempts in the Protected actions section, and may click Clear.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-020 · The installed Claude hook can only make Claude ask, and keeps the settings file private
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user runs Claude Code with the Kolux hooks installed, whether Kolux is running, closed, crashed or unreachable.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-025 · Kolux asks before running a repository's shared kolux.yaml scripts
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user creates or removes a workspace, or launches one tied to an issue, in a repository whose committed kolux.yaml defines a script.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-026 · Stored secrets stay sealed by the system keyring, with no plain-text fallback
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user saves a proxy address, a search session link, a Claude token or a Grok key in Kolux, including at a moment when the system keyring is unavailable.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-027 · The floating workspace opens only in folders the user picked
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user chooses a folder for the floating workspace terminal through the folder picker.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-028 · Saved settings come back valid after a restart
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user changes the notification sound, editor auto-save or terminal theme settings, then restarts Kolux.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-008 · Plan review opened from a native-chat approval card
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user in the native chat view, clicks the review-plan action on an approval card.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-030 · Folder trust and secret recovery for repositories on SSH hosts
Tier: D
What it did: the user creates a worktree in a repository on an SSH host and launches an agent there.
Retired 2026-11-19; kept at the classic-final tag.

### SAFE-029 · Protected actions for agents on SSH hosts and in WSL
Tier: D
What it did: the user runs Claude on a remote host or inside WSL through the Kolux relay.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-041 · Gather review notes and send them to the agent
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the notes section of Source Control and sends the notes to the workspace's agent, or copies them.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-068 · Worktree changes and overlap from the CLI
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux worktree changes or kolux worktree overlap, optionally for a chosen worktree and with JSON output.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-029 · Checks panel shows CI results and hands failures to AI
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens Checks in the right sidebar of a workspace that has a PR.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-030 · Read and answer PR review comments in Kolux
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user reads PR comments in the Checks panel;.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-032 · PR merge conflicts are explained, with Resolve with AI
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens Checks for a PR that GitHub reports as conflicting.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-043 · Tasks page lists GitHub issues and pull requests
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens Tasks, picks repositories, and chooses a preset (all open, mine, assigned, needs review and others) or types a GitHub search query.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-046 · Create a GitHub issue from Tasks
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks new issue, chooses the repository, enters a title, an optional Markdown description, labels and assignees, and creates it.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-047 · Close, reopen and comment on issues
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user closes an issue as completed, not planned, or a duplicate of another number;.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-050 · Issue and PR preview dialog
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks an item in Tasks.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-051 · Full pull request page
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a PR from Tasks.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-014 · Filter the changes and act on a file from its menu
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user types in the panel's filter box, or right-clicks a changed file.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-019 · Source Control AI actions tuned per action and per repository
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user edits the AI recipes for the commit, PR, branch-name and fix actions (agent, extra CLI arguments, or a command template) and sets per-repository overrides.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-034 · Stacked pull requests
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user works on a branch built on top of another PR's branch.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-056 · GitHub Projects as an editable table
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user picks a GitHub Project (pinned, recent, by browsing, or by pasting a URL or an owner and number) and opens one of its views.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-057 · GitHub Projects roadmap timeline
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a project view laid out as a roadmap.
Retired 2026-11-19; kept at the classic-final tag.

### GIT-069 · Open changed files from the CLI
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux file open-changed with a mode.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-041 · Open in Code and Answer in Code jump to the agent's pane
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user picks an item in the Inbox (or a lane on the Floor, or a needs-you entry in the sidebar) and clicks Open in Code, or presses Enter.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-044 · Projects stored in WSL open and save like local ones again
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user on Windows, opens a project that lives inside WSL (reached through the wsl$ or wsl.localhost network path) and edits, searches and watches its files.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-045 · File access stays inside your projects and refuses other computers' shares
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user opens, saves or follows links to files, including paths an agent printed in a terminal.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-053 · Opening a file in its system app never runs a program
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks a file link that Kolux passes to the operating system (from a terminal or a note), or opens a finished browser download.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-003 · Banner when a file you have open is changed on disk by an agent
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user has unsaved edits in a tab while an agent or some other program rewrites the same file.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-001 · Edit a file in a tab and save it
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a file (from the explorer, Quick Open, a link in a terminal, or the command line), types in it, and presses Mod+S.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-012 · Markdown opens in a rich editor, with source and preview views
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a markdown file, switches between rich, source and preview, presses Mod+Shift+V, or starts a new note with Mod+Shift+M.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-027 · Single-file diff tab: inline or side by side, step through changes
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a changed file's diff from source control or with kolux file diff, and moves through the changes with F7 and Shift+F7.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-029 · All Changes: every changed file in one scrolling view
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens All Changes for a worktree to read every changed file in a single scroll.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-033 · Explorer tree with mouse and keyboard
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens the explorer (Mod+Shift+E) and moves through the worktree's folders with mouse or keys.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-034 · Explorer file operations: create, rename, copy, delete, undo, drop in
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user creates, renames, copies, deletes or drags files in the explorer, drops files in from the desktop, and presses Mod+Z after a slip.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-036 · Quick Open a file by name with Mod+P
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+P and types part of a file name.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-040 · Per-workspace handoff note that can be given to an agent
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Handoff section in the right sidebar, writes a note, and may click Hand to agent… to pass it on.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-047 · Worktree switcher search in the Mod+J palette
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the worktree palette and types.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-007 · Copy a selection together with its path and line numbers
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user selects some lines and presses Mod+Alt+C, or copies a reference to a single line.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-020 · Review notes on a file, sent to an agent
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user selects text in a note or a code file, presses Mod+Shift+A, writes a comment, then uses the Send menu.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-002 · Autosave, off by default, writes edits after a short pause
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user switches autosave on in settings and carries on editing without pressing Mod+S.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-004 · Open tabs and unsaved drafts come back after a quit or crash
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user quits Kolux, or it crashes, with editor tabs open and some of them unsaved, then starts it again.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-019 · Rich editing leaves the untouched parts of a note byte-for-byte
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user changes one paragraph of a note in rich view and saves.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-028 · Very large diffs ask before they draw
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the diff of a very big or heavily changed file.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-032 · Renaming or moving a file keeps its tab and unsaved edits
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user renames a file, or drags it to another folder in the explorer, while it is open with unsaved edits.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-046 · Saves are all-or-nothing, and big or binary files are handled safely
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user saves files, or opens very large or binary ones.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-005 · Find and replace inside a code file
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+F in a code editor, or the replace shortcut (Mod+Alt+F on macOS, Mod+H on other systems).
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-009 · Merge conflicts are coloured and can be stepped through
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a file that still holds conflict markers after a merge or a rebase.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-013 · Rich markdown editing: slash menu, tables, lists, code blocks, toggles
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user types a slash in the rich editor, builds a table, writes lists and code blocks.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-014 · Links in notes: web links, [[note]] links and line anchors
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user Mod-clicks a link in a note, types [[ to link another note, or follows a link that points at a line in a file.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-015 · Images in notes: show local pictures, paste or insert new ones
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a note that points at local images, or pastes a screenshot into the rich editor.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-016 · Contents panel, diagrams and maths in notes
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens the contents panel beside a long note, or writes a diagram block or maths.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-017 · Find and replace in markdown preview and rich view
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+F, or the replace shortcut, in a markdown preview or rich tab.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-021 · Image viewer with zoom
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens an image file (PNG, JPEG and similar) and zooms with Ctrl or Cmd plus the scroll wheel.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-022 · PDF viewer keeps its zoom and position
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a PDF, zooms and scrolls, switches to another tab and comes back.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-030 · CI check details tab with Fix with AI
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a CI check from a pull request's list of checks.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-031 · Editor tab header, closing tabs, and untitled files
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user reads or copies the path in a tab's header, opens the real file from a diff, and closes tabs one by one or all together with Mod+Alt+W.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-035 · Explorer toolbar, name filter, row menus and live refresh
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user uses the explorer's toolbar and context menu, or types into its name filter.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-037 · Search file contents across a worktree with Mod+Shift+F
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens search, types some text, and sets options and include or exclude patterns.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-039 · Desktop drops land where they are dropped
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user drags files or folders from the operating system onto different parts of Kolux.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-042 · kolux file opens a file, a diff, or every changed file
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux file open, kolux file diff or kolux file open-changed in a terminal inside a worktree.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-043 · Open a worktree or folder in another editor or the file manager
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user uses the Open in menu on a worktree, or the explorer's overflow menu.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-054 · A new markdown note starts untitled and is named on its first save
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+Shift+M (or chooses new markdown from the Mod+J palette), types, then saves.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-056 · Every file tab has a view switch, including a Changes view of uncommitted edits
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a worktree file and flips the small view switch in the tab header, for instance to Changes while an agent is editing it.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-057 · Formatting toolbar above the rich markdown editor
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a note in rich view and clicks a toolbar button instead of typing markdown or using the slash menu.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-008 · Huge pastes keep the window responsive or are turned away
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user pastes a very large block into the code editor or the rich markdown editor, or uses Paste from the context menu.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-006 · Word wrap, editor font, zoom and minimap
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user presses Alt+Z, picks an editor font, zooms, or turns on the minimap.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-010 · Colouring for Astro, Svelte, Vue, Nim and JSON Lines files
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens an Astro, Svelte, Vue, Nim or JSON Lines file.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-011 · File-type icons and natural name order
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user browses files in the explorer, in tabs or in search results.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-018 · Export a note to PDF
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user picks PDF export from a markdown tab's actions menu.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-023 · CSV and TSV files shown as a table
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a CSV or TSV file.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-024 · Jupyter notebooks: edit cells and run Python
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a notebook, edits, adds, deletes or reorders cells, and runs a Python cell.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-025 · Preview an HTML file in the built-in browser
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens an HTML file, or its diff against the working tree, and asks for a preview.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-026 · Follow a growing log file live
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks View Log on a session row in AI Vault.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-038 · Search the worktree for what is selected in the editor
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user selects text, or rests the caret on a word, and starts a file search.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-048 · Search in the repository and base-branch pickers
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user types into the repository picker or the base-branch picker.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-049 · Settings search stays responsive
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+F on the settings screen and types.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-050 · Project picture taken from an icon file in the repository
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user adds a project whose repository holds a favicon or logo image.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-055 · New notes can start from the repository's own templates
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user keeps markdown templates in the repository's templates folder for Kolux, then creates a new note.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-051 · Editing, searching and downloading files on remote hosts
Tier: D
What it did: the user opened, searched, watched and downloaded files in an SSH or remote-runtime worktree.
Retired 2026-11-19; kept at the classic-final tag.

### EDIT-052 · Simulator palette search
Tier: D
What it did: the user searched the list of iOS and Android simulators to open one in a pane.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-001 · Open a browser tab next to the terminals
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user in a worktree, presses Mod+Shift+B or uses the new-tab control to add a browser tab.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-002 · Browser pages survive switching away and back
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user leaves a browser tab for a terminal, another browser tab or another worktree, then returns.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-003 · Address bar goes to a site or searches the web
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user types or pastes into the address bar and presses Enter, or presses Mod+L to jump there.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-005 · Back, forward, reload and stop
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user uses the toolbar arrows and the reload button, or their shortcuts.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-051 · The agent page-control endpoint answers only Kolux's own tools
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user nothing;.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-008 · Pages that fail to load get a recovery overlay
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user opens an address that cannot load (server down, bad certificate, unknown host).
Retired 2026-11-19; kept at the classic-final tag.

### BROW-009 · Crashed pages recover by themselves
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user carries on working while the process behind a page crashes or disappears.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-015 · Popups open in a small window that shows only the origin
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user uses a site that opens a popup, such as a sign-in through another service or a payment window.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-024 · Trust a self-signed certificate on a local dev server
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user opens a local development server that uses a self-signed HTTPS certificate and approves it from the failure overlay.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-029 · Importing cookies never brings Google sign-ins
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user imports cookies from a browser that is signed in to Google.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-031 · Passkey account chooser
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user signs in with a passkey on a site where more than one account is available.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-036 · Grabbed page details are scrubbed of secrets
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user grabs or annotates an element on a page that holds tokens or keys.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-040 · Document previews are fenced to their folder
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user previews a document that refers to nearby files, links outward or tries to download.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-020 · Browser tabs come back after a restart
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user quits Kolux with browser tabs open, then starts it again.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-021 · Hidden worktrees give back browser memory
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user works across many worktrees that each have browser pages open.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-037 · Annotate page elements and send the notes to an agent
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks Annotate page element, picks elements, writes a comment and an intent for each, then sends them from the send menu.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-042 · Agents drive the worktree's visible browser tab
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user lets an agent in a worktree run kolux browser commands.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-046 · CLI: navigate, wait, snapshot and capture pages
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux goto, kolux back, kolux forward, kolux reload, kolux wait, kolux eval, kolux scroll, kolux snapshot, kolux screenshot, kolux full-screenshot or kolux pdf.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-047 · CLI: act on page elements
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs element commands such as kolux click, kolux fill, kolux type, kolux select, kolux hover, kolux drag, kolux upload, kolux find, kolux get, kolux is or kolux mouse.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-004 · Address bar suggests pages from history
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user begins typing in the address bar.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-007 · Find in page
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+F in a browser tab, types, then presses Enter or Shift+Enter.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-012 · Each browser tab keeps its own zoom
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user uses the zoom shortcuts, or Ctrl plus the scroll wheel (Cmd plus the wheel on Mac) over a page, and Mod+0 to reset.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-013 · Downloads land in the Downloads folder without overwriting
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks a download link on a page.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-014 · New-window links open as Kolux browser tabs
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks a link that asks for a new window, middle-clicks a link, or clicks it with Mod held.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-017 · Right-click menu inside pages
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user right-clicks inside a page, on selected text or on a link.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-018 · App shortcuts still work while focus is inside a page
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user presses Kolux shortcuts while typing or clicking inside a web page.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-019 · Close and reopen browser tabs
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user presses Mod+W on a browser tab, then Mod+Shift+T.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-022 · The jump palette finds open browser pages
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens the jump palette and types part of a page title or site name.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-025 · Google sign-in works inside the pane
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user signs in to Google, or uses a site's sign-in-with-Google button, inside a browser tab.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-027 · Browser session profiles keep logins apart
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens the toolbar menu and picks a profile, or chooses New Profile….
Retired 2026-11-19; kept at the classic-final tag.

### BROW-028 · Bring cookies over from installed browsers or a file
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user toolbar menu → Import Cookies → From a named browser (choosing that browser's profile when it has several) or From File….
Retired 2026-11-19; kept at the classic-final tag.

### BROW-033 · Browser traffic follows the configured HTTP proxy
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user sets an HTTP proxy address and, optionally, a list of hosts that bypass it.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-034 · Viewport presets for phone, tablet and laptop
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user toolbar menu → Viewport Size → picks a preset, or Default.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-035 · Grab a page element to hand to the AI
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks Grab page element (or presses Mod+C with nothing selected), moves over the page and clicks an element.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-038 · Draw on a page screenshot
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks Draw on screenshot and marks up the page with Pen, Highlighter, Arrow, Rectangle, Ellipse or Text, choosing colour, line thickness and font size.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-039 · Preview a worktree's HTML documents in a browser tab
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens an HTML document from the worktree as a preview.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-044 · CLI: list, switch, create and close browser tabs
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux tab commands from a terminal.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-045 · CLI: manage browser session profiles
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux tab profile commands.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-048 · CLI: read and change cookies and web storage
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux cookie or kolux storage commands.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-049 · CLI: intercept requests and read console and network logs
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux intercept, kolux capture, kolux console or kolux network.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-050 · CLI: emulate devices, answer dialogs, use the clipboard
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux viewport, kolux geolocation, kolux set, kolux clipboard or kolux dialog.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-053 · Keep the computer awake while agents run
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user picks On, Off or Auto for keeping the computer awake (in Agents settings).
Retired 2026-11-19; kept at the classic-final tag.

### BROW-067 · Preview a workspace's running dev server in a browser tab
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user starts a dev server from a workspace terminal, then clicks the globe-shaped Preview button in the focused split's toolbar, or picks another address from the small arrow menu beside it.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-016 · Runaway pages cannot flood the user with tabs
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks something on a page that tries to open windows in a loop.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-032 · Site permission requests in the pane
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user uses a site that asks for pointer lock, storage access, the camera or the microphone.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-006 · Address bar folds up in a narrow pane
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user narrows a browser pane until the toolbar no longer fits.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-011 · Loading pages match the app theme
Tier: H · Pushed: 7 · State at 0.15.0: retired 2026-11-19
What it did: the user opens a page while a dark theme is active.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-010 · Pages are checked again after the computer wakes
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user puts the computer to sleep with browser tabs open, then wakes it.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-043 · Leftover browser helper processes are cleaned up
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user quits Kolux, or it crashes, after agents have been driving browser tabs.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-023 · Tabs show the site icon and page title
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user browses from page to page and site to site.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-026 · Sites fall back to popup sign-in when FedCM is off
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user signs in on a site that would otherwise use the browser's built-in identity prompt.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-030 · A hint in the toolbar offers to bring logins over
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a browser tab before ever bringing cookies over.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-041 · Turn a document preview into a web page and back
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks the document chip, types a web address and presses Enter;.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-052 · Drags pass across browser pages
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user drags a tab, a split or a file across a browser pane.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-054 · Browser settings page
Tier: D
What it did: the user opened Settings → Browser, or Browser Settings… from the toolbar menu.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-055 · Browser pages hosted on a paired desktop client
Tier: D
What it did: the user opened browser tabs in a worktree that ran on a paired remote runtime.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-056 · Browser pages streamed to web and phone clients
Tier: D
What it did: the user watched or drove a desktop browser tab from the web client or a phone.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-057 · Browser traffic routed through SSH, WSL and remote hosts
Tier: D
What it did: the user browsed from a worktree that lived on an SSH machine, inside WSL or on a remote runtime.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-058 · Browser tabs inside web-runtime sessions
Tier: D
What it did: the user opened browser tabs in a headless-served session from the web client.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-059 · Remote runtime folder browser with Windows drives
Tier: D
What it did: the user browsed folders on a remote runtime, Windows drive letters included.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-060 · Open an address on the paired client from the CLI
Tier: D
What it did: the user ran kolux open-url --url <url> in a remote terminal.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-061 · Custom network address for runtime pairing
Tier: D
What it did: the user typed a custom address while generating a runtime pairing.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-062 · Computer use: agents control desktop apps
Tier: D
What it did: the user let an agent run kolux computer commands.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-063 · Computer Use settings section
Tier: D
What it did: the user opened Settings → Computer Use.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-064 · Mac permission setup for computer use
Tier: D
What it did: the user granted Accessibility and Screen Recording to Kolux's helper app on a Mac.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-065 · Desktop control helpers for Mac, Windows and Linux
Tier: D
What it did: the user used computer use on any platform.
Retired 2026-11-19; kept at the classic-final tag.

### BROW-066 · Computer-use recovery guidance and key-chord checks
Tier: D
What it did: the user hit a computer-use error, or sent a key chord.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-035 · Pages Claude publishes are kept in Kolux automatically
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user lets a Claude Code session publish an HTML page through Claude's Artifact tool.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-036 · Artifacts library page and offline viewer
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens Artifacts from the sidebar, searches, selects an entry, adds a page from a file, or removes one.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-001 · Six ready-made starter kits for common business jobs
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user browses the starter kits to choose a job for a small team of AIs to do on the user's own files.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-002 · Starter kit gallery and its entry points
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the kit gallery from the kit block on the start screen, from the starter-kits row of the launch dialog (which has a link to see them all), or from the newcomer setup checklist.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-003 · Kit roles go to the AIs the user has connected
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user opens a kit with some mix of Claude, Codex and Grok connected.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-004 · Kit setup dialog gathers inputs and stops bad files
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user fills in a kit's inputs (types or pastes a path, uses Browse, drops a file onto the field, or types text), then presses Start kit.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-005 · Try a kit on bundled sample data, and recall past inputs
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks Try with sample data in a kit's setup, or opens a kit already run before.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-006 · Starting a kit opens one titled session per role
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user presses Start kit.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-007 · Every kit seat works under the same plain rules
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user starts a kit and reads what each AI was told.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-008 · A waiting kit role starts once the role it depends on is done
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user starts a kit with a dependent role, such as a checker, and lets it run.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-009 · Kit results strip above the session grid
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user works in a project where a kit is running or has run.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-010 · Each kit role row says what its AI is up to
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user unfolds the kit strip while the kit is running.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-011 · Rescue a stuck kit role: move it, sign in, or restart
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user sees a role stopped by a usage limit, a sign-in problem or an exit, and uses the action on its row.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-012 · Preview or open a kit's result files
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks Preview or Open beside a file of a role that is done.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-013 · Collect a kit's results into one dated folder with a summary page
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user clicks Collect results.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-014 · Kit run record and recent kit runs
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user comes back to the kit gallery after running kits.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-015 · Kits run only in local projects or the samples folder
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user tries to use a kit in a remote workspace or in some arbitrary folder.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-022 · Delete skills safely from the Skills page
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user picks Delete skills, chooses skills, and confirms.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-024 · Nudge when an installed Kolux skill falls behind
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs a Kolux version newer than the Kolux skills installed for their AIs.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-026 · Update stale Kolux skills in the background
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user opens the update dialog from the notice or the freshness pill and presses Update.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-028 · Install a Kolux skill for your AIs from inside Kolux
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user where a feature needs a skill (the CLI settings, the orchestration pane or its floating dialog, browser use), clicks Install or Update.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-029 · Kolux's own skills, matched to the app version
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user installs or reads one of the skills that ship with Kolux.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-030 · The skills list and get commands print the bundled guides
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux skills list, or kolux skills get with a topic.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-031 · The skills install and update commands
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux skills install or kolux skills update in a terminal.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-017 · Skills page lists every skill the AIs can see
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Skills page, searches, and filters by AI or by where a skill comes from.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-018 · Sidebar Skills button, off by default
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user turns on the Skills button, then uses it to open the Skills page, or right-clicks it to hide it.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-021 · Where Kolux finds skills
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens the Skills page with skills installed for different AIs in different places.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-016 · Kits tick off first-run milestones and carry a tour anchor
Tier: H · Pushed: 6 · State at 0.15.0: retired 2026-11-19
What it did: the user launches a first kit, then opens or collects its results.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-023 · An interrupted skill delete is undone or completed on restart
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user quits Kolux, or it crashes, while skills are being deleted, then opens it again.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-025 · Skill freshness pill
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user looks at a Kolux skill's setup panel, for example in the orchestration pane.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-027 · Status bar shows a running skill update
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user starts a skill update and closes the dialog.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-020 · Skill row actions and skill details
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user uses the actions on a skill row or opens its details.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-034 · Install a shared skill bundle with a choice per clash
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user would install a packaged bundle of skills from a file, deciding for each clashing name whether to keep the local copy.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-019 · Skills settings section
Tier: D
What it did: the user opens the Skills section in Settings.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-032 · Bundled skills for cut features
Tier: D
What it did: the user installs the skill for computer use, the iOS or Android emulator, Linear tickets, or per-workspace environment recipes.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-033 · Skills on remote hosts
Tier: D
What it did: the user opens the Skills page while connected to a remote host.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-037 · Plugins settings: install, enable, consent to and remove plugins
Tier: D
What it did: the user opens the Plugins section in Settings (experimental, desktop only) and installs a plugin from a local folder or a git URL.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-038 · Plugin marketplace
Tier: D
What it did: the user browses a marketplace of plugins and installs one.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-039 · Plugin runtime: workers, panels, commands and keybindings
Tier: D
What it did: the user uses an installed plugin's panel, command or shortcut.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-040 · Plugin content packs: language packs, VM recipes, launch packs
Tier: D
What it did: the user installs a plugin that adds a language, a VM recipe or launch content.
Retired 2026-11-19; kept at the classic-final tag.

### SKILL-041 · Plugin safety: secrets, storage caps, audit log, remote revocation
Tier: D
What it did: the user runs plugins that keep data or secrets.
Retired 2026-11-19; kept at the classic-final tag.

### ONB-017 · Enable Kolux CLI step installs the CLI and agent skills
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user ticks the capabilities to set up (the CLI, and skills such as orchestration and browser use) and runs setup.
Retired 2026-11-19; kept at the classic-final tag.

### ONB-028 · CLI tip installs the CLI and skills
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks 'Install CLI & Skills' in the CLI tip.
Retired 2026-11-19; kept at the classic-final tag.

### ONB-037 · GitHub star prompt: when it shows
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user uses Kolux: launches many agents, gets a task finished, or completes onboarding.
Retired 2026-11-19; kept at the classic-final tag.

### ONB-038 · GitHub star prompt: starring and its states
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks 'Star on GitHub', 'Later' or 'Dismiss' in the card or toast, or uses the star button in Settings › General or on the landing screen.
Retired 2026-11-19; kept at the classic-final tag.

### SET-028 · Model and effort per tier for orchestration workers
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user on the Agents page, picks a provider, then a model and an effort level for each worker tier.
Retired 2026-11-19; kept at the classic-final tag.

### SET-008 · Shortcuts page lists every command with its keys
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens Shortcuts, picks a filter, or types in its search box.
Retired 2026-11-19; kept at the classic-final tag.

### SET-009 · Record, add, disable or reset a shortcut
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user clicks a command's chord and presses new keys, or uses add another, remove, disable or reset on its row.
Retired 2026-11-19; kept at the classic-final tag.

### SET-010 · Clashing shortcuts are flagged, scope by scope
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user records a chord another command already uses, or edits the file by hand so that two commands collide.
Retired 2026-11-19; kept at the classic-final tag.

### SET-011 · Shortcuts live in a file the user owns: ~/.kolux/keybindings.json
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user edits ~/.kolux/keybindings.json by hand, or lets the Shortcuts page change it.
Retired 2026-11-19; kept at the classic-final tag.

### SET-012 · Open, reveal or reload the keybindings file from Settings
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens the file menu on the Shortcuts page.
Retired 2026-11-19; kept at the classic-final tag.

### SET-024 · Bring in terminal schemes from Warp and Ghostty
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user imports a Warp theme file, or imports from an existing Ghostty configuration.
Retired 2026-11-19; kept at the classic-final tag.

### SET-055 · Orchestration settings page
Tier: D
What it did: the user tuned orchestration knobs such as how deep workers may nest.
Retired 2026-11-19; kept at the classic-final tag.

### APP-004 · Settings and data from the app's former name carry over on first launch
Tier: H · Pushed: 10 · State at 0.15.0: retired 2026-11-19
What it did: the user installs this version over an install that still used the old product name.
Retired 2026-11-19; kept at the classic-final tag.

### APP-057 · kolux status reports whether the app and its runtime are ready
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user runs the status command.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-018 · kolux worktree create, with an optional agent started inside
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux worktree create with a name and, if wanted, a repo, a base branch, an agent with a first prompt, a GitHub issue number, a comment and a choice about setup scripts.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-012 · kolux status tells whether the app is up
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux status, often from a script.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-007 · kolux works in every Kolux terminal with no setup
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user types kolux, or an agent does, in any terminal pane that Kolux opened.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-030 · Orchestration runs: start one, bind to one, look one up
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user a coordinator agent, or the user, starts an orchestration run with an objective, attaches the current terminal to a run that already exists, asks which run is attached, lists runs or shows one.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-031 · Orchestration messages: send and reply
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user an agent sends a typed message to a run's mailbox, a dispatch, a terminal or a group, or answers a question by its message id.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-032 · Orchestration inbox: check and inbox
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user an agent reads its mailbox once, peeks at it, acknowledges what it read, or blocks until something new arrives;.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-033 · Orchestration ask: a question that waits for its answer, and can be resumed
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user a worker puts a question, optionally with choices, to a coordinator or a person and waits for the reply.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-034 · Orchestration tasks and dispatch
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user a coordinator creates tasks with dependencies, lists and updates them, sends a task to a worker terminal, and previews the opening text the worker will receive.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-035 · Orchestration worker-start launches a worker, with model routing
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user a coordinator starts a worker for a new or existing task, in a new or existing worktree, choosing agent, model, effort or a routing tier if it wants to.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-036 · Orchestration workers: list, show, read, stop, abandon, release and retain
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user a coordinator lists its workers, looks at one, reads its transcript, or stops, abandons, releases or keeps a worker.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-011 · kolux open starts the app or brings it to the front
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux open.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-023 · kolux terminal list and show
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user lists terminals (for one worktree or all, with an optional limit) or shows one by its handle.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-026 · kolux terminal create, split, rename and switch (also focus)
Tier: H · Pushed: 1 · State at 0.15.0: retired 2026-11-19
What it did: the user opens a new terminal in a worktree with an optional startup command and title, splits an existing terminal, renames one, or brings one into view.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-009 · Selectors for repos, worktrees and terminals, with the current folder as default
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user names a repo, worktree or terminal on a command, or leaves it out and runs the command from inside a worktree's folder.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-015 · kolux repo: list, add, show, base ref and ref search
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user lists repos, adds a folder as a repo, shows one, sets its default base ref, or searches its refs.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-016 · kolux project list
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux project list.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-017 · kolux worktree list, show, current and ps
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user lists worktrees (optionally for one repo, with a cap on rows), shows one, asks which worktree the current folder belongs to, or lists live sessions across worktrees.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-019 · kolux worktree set: rename, link, comment, board status and lineage
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux worktree set on a worktree to give it a new display name, issue, comment, board status or parent.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-021 · kolux worktree changes and overlap: what a worktree touched and who else touches it
Tier: H · Pushed: 2 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux worktree changes or kolux worktree overlap, for the current worktree unless told otherwise.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-024 · kolux terminal read: output history or the screen as it looks now
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user reads a terminal's output by its handle, paging with a cursor, or asks for the rendered screen instead.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-025 · kolux terminal send and wait
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user types text into a terminal, optionally pressing Enter or sending an interrupt, or waits for a terminal to exit or for its agent to go idle.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-040 · kolux agent hooks: status, on, off and prepare-codex
Tier: H · Pushed: 3 · State at 0.15.0: retired 2026-11-19
What it did: the user checks whether the agent status hooks are installed, switches them on or off, or prepares the trusted hook setup Codex needs.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-014 · kolux account add and account list
Tier: H · Pushed: 4 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux account add, optionally choosing the provider, to sign in one more account, or kolux account list to see them all.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-003 · Typos are caught before the app is contacted, with safe suggestions
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user misspells a command word or a flag.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-020 · kolux worktree rm, also reachable as remove and delete
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux worktree rm on a worktree, possibly with --force or --run-hooks.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-039 · Who is calling: caller identity for orchestration
Tier: H · Pushed: 5 · State at 0.15.0: retired 2026-11-19
What it did: the user runs orchestration commands from an agent terminal, a structured chat session or a shell outside Kolux.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-006 · Windows: the kolux.cmd shim and the kolux.exe launcher
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user calls kolux on Windows from cmd, PowerShell or an agent, sometimes with message bodies that run over several lines.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-010 · Which commands need the app to be running
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user runs a kolux command while the app may or may not be open.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-027 · kolux terminal close, with the old stop kept as a hidden alias
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user closes one terminal by its handle, its whole tab, or every terminal in a worktree.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-038 · Safe retry after a lost result: the retry flag, request-show and reset
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user re-runs an orchestration change whose outcome was lost (say, a dropped connection), checks what became of a request, or resets orchestration state.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-004 · JSON output and structured errors
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user adds --json to a command, usually from a script or an agent.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-005 · Exit codes
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user calls kolux from a script or an agent and looks at the exit status.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-013 · kolux claude-teams runs Claude Code agent teams in Kolux panes
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux claude-teams followed by any arguments meant for Claude Code.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-028 · kolux automations list, show and runs
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user lists scheduled automations, shows one, or lists one's past runs.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-029 · kolux automations create, edit, remove and run
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user creates or edits a scheduled agent run with a name, schedule, prompt, provider and target;.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-037 · Orchestration decision gates
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user a coordinator opens a gate that holds until a decision is made, resolves it, or lists gates.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-042 · kolux agent-context: a machine-readable map of every command
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user an agent runs kolux agent-context --json to learn the CLI.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-043 · kolux skills list and get: the agent guides bundled with the CLI
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user lists the skill guides that ship with this CLI version, or prints one in short form, in full, or one of its references.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-044 · kolux skills install and update
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user installs or updates Kolux skills into the coding agents found on this machine, globally or for the current project, or previews the command first.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-001 · Help on every level of the command tree, plus a version flag
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux with nothing after it, adds --help to any group or command, types kolux help followed by a command path, or asks for kolux --version.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-002 · Argument grammar: flags, values, aliases and bare arguments
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user types a command with its flags in whatever order, giving values after a space or joined with an equals sign, using an alias, or ending with a bare argument.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-008 · Register or remove the kolux command for the whole system
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user uses the CLI section in Settings to make kolux available in terminals outside Kolux, or to take it away again.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-022 · kolux file open, diff and open-changed
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user opens a file in the Kolux editor, opens a diff for a file, or opens every changed file of a worktree.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-045 · Browser tabs and profiles (kolux tab)
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user lists, shows, creates, switches or closes Kolux browser tabs, and manages the browser profiles the tabs use.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-046 · Browser page interaction through snapshot references (kolux snapshot, click, fill and more)
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user an agent drives a browser tab: it navigates, takes an accessibility snapshot, then clicks, types into or fills elements using the references the snapshot gave out.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-047 · Browser state, emulation and capture (kolux cookie, storage, set, screenshot and more)
Tier: H · Pushed: — · State at 0.15.0: retired 2026-11-19
What it did: the user reads or sets cookies and local or session storage;.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-041 · kolux diagnostics memory
Tier: H · Pushed: 9 · State at 0.15.0: retired 2026-11-19
What it did: the user runs kolux diagnostics memory.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-048 · Retired orchestration coordinator-start and coordinator-stop
Tier: H · Pushed: 11 · State at 0.15.0: retired 2026-11-19
What it did: the user runs orchestration coordinator-start or its alias orchestration run, or coordinator-stop or its alias run-stop.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-049 · kolux serve: headless server
Tier: D
What it did: the user runs kolux serve to start Kolux with no window, optionally printing pairing or recipe details.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-050 · Remote targeting: pairing codes, environments, hosts and opening links on a paired client
Tier: D
What it did: the user aims commands at another Kolux with the pairing-code or environment flags or their environment variables, manages saved environments, lists hosts, names a runtime host explicitly, or opens a link on the paired client.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-051 · kolux project host setups
Tier: D
What it did: the user lists, creates, updates or deletes a project's host setups, or sets a project up on another machine, either from a folder already there or by cloning.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-052 · kolux inside WSL distros
Tier: D
What it did: the user uses kolux from a WSL shell after Kolux has registered a launcher inside the distro.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-053 · kolux vm recipe doctor
Tier: D
What it did: the user checks an ephemeral VM recipe or does a trial provisioning of one.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-054 · kolux emulator
Tier: D
What it did: the user drives the mobile emulator pane: gestures, logs and the like.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-055 · kolux computer: controlling desktop apps
Tier: D
What it did: the user lists desktop apps and windows, reads an app's state, and clicks, types or presses keys in desktop apps.
Retired 2026-11-19; kept at the classic-final tag.

### CLI-056 · kolux linear, and Linear issue links on worktrees
Tier: D
What it did: the user reads and edits Linear issues from the CLI, or links a Linear issue while creating or editing a worktree.
Retired 2026-11-19; kept at the classic-final tag.

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
