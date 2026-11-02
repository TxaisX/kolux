# 19 · App lifecycle & operations

This area is about how Kolux starts, stays up, saves itself, updates itself and gets released. Only
one copy runs at a time; its window appears quickly even when the background terminal service is
slow; it has a tray icon, a standard menu bar and a settings-and-help menu in the sidebar footer.
Updates come from the owner's public releases repository on GitHub: the app looks quietly every 30
minutes, downloads on its own, shows the release notes in an update card and installs when the
user restarts or quits. Crash reports and Send Feedback turn into pre-filled GitHub issues that the
user submits from their own browser; usage telemetry is switched off when the app is built, and the
app sends no usage data. Everything the user sets up is saved as they go and survives quits,
updates, a damaged state file and a replaced terminal service (each run of that service carries a
generation number so input never goes astray). Recovery paths cover interface crashes, graphics
crashes and failed installs. The Resource Manager and `kolux diagnostics memory` show memory per
session, and `kolux status` and `kolux open` tell scripts whether the app is ready. On the owner's
side, one ship command commits and lands work on main, every ship to main publishes a numbered
Windows release, CI runs in four shards, and packaged builds are smoke-tested before they go out.
Linux and macOS paths, extra update channels, local-build switching, the hang watchdog and
development-copy behaviour are tier H; headless serve, remote reconnection and WSL start-up work
went with area 18.

Tier counts: P0 13 · P1 28 · P2 13 · H 13 · X 0 · D 3
Related areas: 01 Projects, repos & worktrees · 02 Sessions & launching · 03 Terminals & panes · 04 Agent status, hooks & notifications · 05 Views & navigation · 06 Usage & limits · 07 Accounts, sign-in & keys · 10 Plan review & protected actions · 11 Git, source control & review · 12 Editor & files · 13 Browser pane & computer use · 16 Onboarding & guidance · 17 Settings, appearance & input · 18 Remote & hosts (dropped) · 20 The `kolux` CLI · 21 H — retired, hidden, removed, dev-only

## Cards

### APP-054 · Resource Manager: memory per session, with a way to end one
Tier: P0 · Pushed: 3 · State at 0.15.0: live-unverified
User does: opens the Resource Manager from the status bar, reads the figures, then ends a session or
  restarts the terminal service.
User sees: memory and CPU for the app itself, for every session grouped under its worktree, and for
  terminals that belong to no worktree, plus how much memory the computer has free; ending anything
  asks for confirmation first.
Rules: a process tree is counted under one terminal only, so a subtree already counted for another
  terminal is never added twice; terminals with no worktree sit in a group of their own; free host
  memory follows each system's own measure (memory pressure on macOS, available memory on Linux);
  ending a session that is not shown in any pane leaves every other session alone; when the app's
  own process row is missing, its working-set figure stands in; CPU figures are clamped to the
  machine's total core capacity, so a bad sample never shows an impossible percentage.
Acceptance:
  - [x] Open the popover with three sessions running → three session rows, each with a memory figure. (cards; evidence/cards-APP-054.txt)
  - [x] Confirm ending one of them → only that session stops; the other two keep running. (cards; evidence/cards-APP-054.txt)
Compat: —
Source: D-19-054

### APP-041 · Diagnostic logs stay on the computer and are scrubbed before sharing
Tier: P0 · Pushed: 5 · State at 0.15.0: live-unverified
User does: copies terminal diagnostics, or attaches logs to a crash report.
User sees: a useful log bundle on the clipboard in which API keys, passwords, tokens, credentials
  inside web addresses and values from environment files have been masked.
Rules: logs go to local files that rotate, can be read only by the user, and are capped in total
  size; the bundle carries the terminal service's own start-and-stop log; masking covers key-value
  pairs, secrets passed on a command line, environment-style lines, credentials in addresses and a
  list of known secret key names, and masking text that is already masked changes nothing; the user
  can create a review copy, open it and throw it away before sharing; writing a diagnostic record
  can never make the action it records fail.
  (Kolux RS, T-064-a: the terminals run inside the app, so the "terminal service" log is the app's own
  log file in the profile logs folder (app start and exit, each session's start and end, what background passes refused;
  never a session's output or arguments); files move aside past 512 KB and the oldest go past 2 MB in
  all; the logs folder inherits the profile folder's user-only permission (ACCT-009); the copy, the
  review copy and its discard live in Settings > General > Diagnostics.)
Acceptance:
  - [x] Run a command containing a fake API key, then copy diagnostics → the key is absent from the
        clipboard text. (cards; evidence/cards-APP-041.txt)
  - [x] Produce logs past the size cap → the oldest files are deleted and the total stays below the cap. (cards; evidence/cards-APP-041.txt)
Compat: —
Source: D-19-041

### APP-070 · The user's work stays on the computer and the app sends no usage data
Tier: P0 · Pushed: 5 · State at 0.15.0: live-unverified
User does: uses Kolux as normal: types in terminals, opens files, saves keys, runs agents, sends
  feedback.
User sees: nothing about their work is sent anywhere on the app's behalf; feedback and crash reports
  open in the user's own browser for them to submit; the privacy statement names every outbound
  connection the app makes.
Rules: there is no usage telemetry, analytics or diagnostic upload, and the build has no server to
  receive any; typed input, opened files, terminal output, projects, settings and saved credentials
  live only in the local profile folder; each agent CLI talks straight to the company behind it,
  signed in with that tool's account, and the app neither relays nor records that traffic; the app's own connections are
  limited to GitHub Releases (update checks, downloads, release notes), the git remotes and GitHub
  account the user set up, AI providers the user connected (using the user's credentials), and
  sites the user opens in the browser pane; Send Feedback and Report Crash submit nothing
  themselves, the browser does it after the user has read the text.
  (Kolux RS, T-064-b: the statement sits in Settings > General > Privacy with the whole list of connections,
  including the WebView2 runtime's own startup checks to Microsoft, which belong to the Edge engine the
  window runs in and which the app cannot switch off (DT-C25); a privacy audit test fails the
  build on any network client the list does not cover; the feedback link itself is here, the message box is
  the Send Feedback card's task.)
Acceptance:
  - [ ] Watch a normal session with a network monitor → every connection goes to one of the listed
        destinations; none goes to an analytics or telemetry host.
  - [ ] Type a unique marker in a terminal and in the editor → the marker appears in no outgoing request.
  - [x] Use Send Feedback → a pre-filled issue page opens in the browser and the app makes no request
        of its own. (cards; evidence/cards-APP-070.txt)
Compat: —
Source: D-19-070

### APP-024 · Quiet update checks on start-up and then every half hour
Tier: P0 · Pushed: 8 · State at 0.15.0: live
User does: leaves the app open.
User sees: no sign of checking; a newly published version is picked up within about half an hour.
Rules: at launch a check runs only if the previous one is older than the interval, otherwise the app
  waits out the remainder, and from then on it checks every 30 minutes; the source is the owner's
  public releases repository on GitHub, which holds installers and nothing else; checks set off by
  the window gaining focus are merged so they never pile up; after a failed check the app tries
  again in about an hour, doubling the wait each time up to six hours; while offline it stays
  silent and checks within about a minute of the connection coming back; on waking from sleep it
  checks if the last check is out of date; a check that stalls is dropped after a timeout;
  background checks never show an error; signature checking on Windows is never switched off;
  development and unpackaged copies never update themselves.
Acceptance:
  - [x] Publish a release with the app open → within 30 minutes the update has downloaded with no click. (cards; evidence/cards-APP-024.txt)
  - [x] Cut the network for an hour → no error appears; restore it → a check runs within about a minute. (cards; evidence/cards-APP-024.txt)
Compat: the update feed is the GitHub releases of TxaisX/kolux-releases, which carry the update
  manifest that installed 0.15.0 copies read.
  Amended 2026-10-09 (OD-20, DT-R01): Kolux RS reads its own feed, the GitHub releases of TxaisX/kolux-rs-releases, with a signed Tauri update manifest; the old feed is not touched.
Source: D-19-024

### APP-025 · A downloaded update waits behind a small ready pop-up and installs on restart or quit
Tier: P0 · Pushed: 8 · State at 0.15.0: live
User does: carries on working after an update finished downloading in the background.
User sees: a small pop-up in the bottom-left corner saying the new version is ready, with Restart to
  update and a close control; ignoring it is fine, because the update installs the next time the
  app quits.
Rules: the download starts by itself; the pop-up appears once per version per launch and stays until
  the user acts on it or closes it; it stays silent if the update card is on screen for that same
  update; it goes away if the update stops being ready; the app never restarts itself to update,
  only on the user's click or quit.
Acceptance:
  - [x] Let an update download in the background → the pop-up appears once; close it → it does not
        come back this launch. (cards; evidence/cards-APP-025.txt)
  - [ ] Quit without clicking anything → the next launch runs the new version.
Compat: —
Source: D-19-025

### APP-026 · The update card follows a requested check from start to finish
Tier: P0 · Pushed: 8 · State at 0.15.0: live
User does: clicks Check for Updates.
User sees: a card that moves through checking, up to date (then fades), update available,
  downloading with progress, ready with Restart to update, or an error with a next step.
Rules: only checks the user asked for, and download errors, bring up the card, never background
  checks; a version the user dismissed stays hidden until a newer one is published; the card can be
  collapsed and every change of phase reopens it; after downloading it waits for the user's Restart
  click and never installs on its own; Escape collapses the card, Enter runs its main action, and
  the reduced-motion preference turns its animation off; clicking again during a running check does
  not start a second one; a check that never reaches the updater times out and says so; the first
  time an update is offered or downloading, a small dismissible tip above the card reassures the
  user that running terminal sessions carry on, and it is gone for good once dismissed or once a
  download starts; a check requested while a quiet background check is already running takes that
  check over, so its result shows in the card.
Acceptance:
  - [x] On the newest version, click Check for Updates → the card reports up to date and closes itself. (cards; evidence/cards-APP-026.txt)
  - [x] With an update offered, dismiss the card → it stays away for that version; publish a newer
        one → it returns. (cards; evidence/cards-APP-026.txt)
Compat: —
Source: D-19-026

### APP-027 · Release notes inside the update card
Tier: P0 · Pushed: 8 · State at 0.15.0: live
User does: sees an offered or downloaded update in the card.
User sees: a short list of what changed in that version, drawn from the release's notes.
Rules: notes are fetched from the public release page with no sign-in; headings and empty lines are
  removed and the list is cut to a few lines; any failure (offline, release not found) just leaves
  the notes out and never holds up the update; the notes stay visible through the available,
  downloading, ready and error phases and are cleared when a new check begins.
Acceptance:
  - [x] Publish a release whose notes have five bullets → the card lists them. (cards; evidence/cards-APP-027.txt)
  - [x] Go offline before the notes load → the card appears without notes and the update still installs. (cards; evidence/cards-APP-027.txt)
Compat: —
  Amended 2026-10-09 (DT-R02): the notes come from the signed manifest's notes field (the release's notes copied in at publish time), not from a second fetch of the release page.
Source: D-19-027

### APP-058 · One ship command commits, syncs and lands work on main
Tier: P0 · Pushed: 8 · State at 0.15.0: live
User does: runs the ship command from a worktree, optionally aimed at main.
User sees: the changes committed with a message written by AI, merged with the latest remote and
  pushed; aiming at main also starts a release in the background.
Rules: remote changes come in by merge, never by rebase, and a conflict stops everything with nothing
  pushed; the user can supply their own message in place of the AI one (this is how version-bump
  commits are made); options cover skipping the release, merging a named branch, a dry run, and
  choosing the model that writes the message.
Acceptance:
  - [x] Ship a change to main → a commit lands on main, is pushed, and the location of the release
        job's log is printed. (cards; evidence/cards-APP-058.txt)
  - [x] Ship while the remote holds a conflicting change → the command stops and the remote is untouched. (cards; evidence/cards-APP-058.txt)
Compat: at 0.15.0 the command runs from the project's own package scripts and takes `--main`,
  `--no-release`, `--merge` with a branch name, `--dry-run`, `--model` with a model id, and
  `--message` with text.
Source: D-19-058

### APP-059 · Every ship to main publishes a release by itself
Tier: P0 · Pushed: 8 · State at 0.15.0: live
User does: ships to main.
User sees: a few minutes later a new numbered release appears in the public releases repository,
  and installed copies pick it up.
Rules: the release is built in a separate checkout kept only for releases, never in anyone's working
  folder, so the shipped worktree can be deleted at once; one build runs at a time, and a ship that
  lands during a build queues exactly one more build from the newest main; a build lock older than
  three hours, or held by a process that has died, counts as stale; the new version is one patch
  above whichever is higher, the project's version or the latest release, and the installed app,
  the update manifest and the CLI all report that same version; each release carries the Windows
  installer, its block map and the update manifest; the release notes list the subject line of
  each commit since the previous release, 30 at most, plus a hidden marker of the source commit so
  that a main which was already released is skipped; when a release fails, the failure goes to the
  log and the ship itself still succeeds; there are
  two rehearsal modes, print-only, and build plus smoke test without publishing; version numbers
  are 0.x.y, with x going up for a new capability and y for improvements, and 1.0 never happens
  without the owner; there is no rollback inside the app, and only Windows builds are released.
Acceptance:
  - [x] Ship to main → a release one patch higher appears with the three files and notes listing the
        shipped commits. (release v0.1.3; evidence/APP-059-release-013.txt)
  - [x] Ship twice in quick succession → exactly two builds run, one after the other, never side by side. (cards; evidence/cards-APP-059.txt)
Compat: `kolux --version` prints the release version; an environment variable can point the release
  job at a different build checkout; the release job takes `--dry-run` and `--no-publish`.
  Amended 2026-10-09 (DT-R07, DT-R09): a release carries the Windows installer, its signature file and the update manifest, the signature taking the block map's place; the version is set only in the release checkout and never committed.
Source: D-19-059

### APP-060 · CI on main runs in four shards and gates releases
Tier: P0 · Pushed: 8 · State at 0.15.0: live
User does: pushes to main.
User sees: the test suite runs split into four parts and reports pass or fail.
Rules: a release built through CI will not publish unless CI passed for that exact commit, and it
  waits up to 30 minutes for a run still in the queue; the reason for any refusal is written to the
  job summary; CI can also be started for a branch that is pushed but not yet merged to main.
Acceptance:
  - [ ] Push a commit → four shards run and the result is green only when all four pass.
  - [x] Attempt a CI release for a commit with a failed CI run → it is refused and the reason is shown. (cards; evidence/cards-APP-060.txt)
Compat: —
Source: D-19-060

### APP-048 · Everything the user set up is saved as they go and survives quits and updates
Tier: P0 · Pushed: 9 · State at 0.15.0: live
User does: arranges projects, sessions and settings, then quits, updates or restarts.
User sees: the same projects, layout, sessions and settings at the next launch.
Rules: saves are atomic (written to a fresh file, then swapped in) and happen away from the interface
  thread; unchanged state is not written again, while any real change, secrets included, always is;
  older saved formats and keys are upgraded when loaded, and retired settings are deleted; brief
  database lock contention is retried, and read-only opens keep working while another writer is
  active; a session saved by the previous production version restores after upgrading; the profile
  folder and its private files are limited to the current user, Windows included; a settings file
  with some bad entries keeps the good ones, drops the rest and writes the repaired copy back; after
  an upgrade, an install that predates the new workspace screens and never picked one keeps opening
  on the terminal grid, a fresh install gets the new default, an explicit choice is never
  overridden, and a saved file that cannot be read counts as an existing install.
Acceptance:
  - [x] Change a setting and kill the process two seconds later → the setting is there on relaunch. (cards; evidence/cards-APP-048.txt)
  - [ ] Upgrade from the previous release → layout and sessions are identical.
Compat: the layout, projects, sessions and settings saved in a 0.15.0 profile must carry over into
  the rebuild.
Source: D-19-048

### APP-050 · Quitting writes one final save without freezing
Tier: P0 · Pushed: 9 · State at 0.15.0: live
User does: quits, or restarts to update.
User sees: the app closes promptly, and everything up to the moment of quitting is there next time.
Rules: the final save works as a single barrier: any save in flight finishes first and nothing can
  queue another after it; nothing on the way out waits on the disk synchronously, so a stalled drive
  cannot freeze the app; the quit deadline caps a save that gets stuck; usage statistics close off
  live agents before the final write; leftover temporary files are cleared before the final write;
  if the profile drive rejects writes, quitting carries on instead of failing.
Acceptance:
  - [x] Change the layout and quit at once → the change is back on relaunch. (cards; evidence/cards-APP-050.txt)
  - [x] Simulate a stalled profile drive → the app still exits within the quit deadline. (cards live; evidence/cards-APP-050.txt)
Compat: —
Source: D-19-050

### APP-052 · Terminals survive app restarts and a replaced terminal service
Tier: P0 · Pushed: 9 · State at 0.15.0: live
User does: quits and relaunches, updates, or the background terminal service is killed or swapped
  for a new one.
User sees: running terminals come back with their output, and typed input never reaches the wrong
  terminal.
Rules: every run of the terminal service carries a generation number, and input always goes to the
  generation that owns the terminal; the interface waits for the service to take over existing
  terminals before recovering them, giving up at a hard limit rather than hanging; a newer app paired
  with an older service keeps working as long as the differences are additions only, and pairs that
  are not compatible are refused; events from a generation that has been replaced are dropped; this
  was checked across three quit-and-relaunch rounds and one killed service.
Acceptance:
  - [x] Print a marker in a terminal, then quit and relaunch three times → the marker is visible after
        each launch. (live; evidence/T-544.txt lines 30-67)
  - [x] Kill the terminal service and relaunch → terminals come back from their saved history. (live; evidence/T-544.txt lines 68-79)
Compat: —
Source: D-19-052

### APP-023 · The landing screen warns about missing or signed-out tools
Tier: P1 · Pushed: 6 · State at 0.15.0: live-unverified
User does: opens the app on the landing screen.
User sees: notices when Git is missing, when the GitHub CLI is missing or not signed in, or when
  agent CLIs are missing; each notice can be dismissed.
Rules: Git problems always show, GitHub CLI problems only once a project hosted on GitHub exists; the
  GitLab CLI counts as not installed when its version check fails; a dismissed notice stays
  dismissed until the set of GitHub projects changes; probes that hang are timed out, results are
  cached, and a manual refresh probes again.
Acceptance:
  - [ ] Take Git off the search path and open the landing screen → a Git notice appears.
  - [ ] Dismiss the GitHub CLI notice and restart → it stays hidden; add another GitHub project → it
        comes back.
Compat: —
Source: D-19-023

### APP-028 · A failed update install is reported at the next launch, with a retry
Tier: P1 · Pushed: 8 · State at 0.15.0: live-unverified
User does: clicks Restart to update, but the install does not take (a locked file, for instance).
User sees: at the next launch, a notice that the update did not install, naming the program that held
  the files when that is known, with Try again and Download installer; when the install worked, a
  one-time note says the app was updated and shows the notes.
Rules: each install attempt is recorded and compared with the running version at the next launch;
  records older than seven days are ignored; deliberate moves to a pinned or locally built version
  are never reported as failures; when the locking program cannot be identified the notice uses
  general wording.
Acceptance:
  - [ ] Lock an install file and restart to update → the next launch shows the failure notice with
        Try again.
  - [ ] Update successfully → the one-time updated note appears with the notes and is gone on the
        launch after that.
Compat: —
Source: D-19-028

### APP-029 · Restart to update either installs or explains why it could not
Tier: P1 · Pushed: 8 · State at 0.15.0: live-unverified
User does: clicks Restart to update.
User sees: the app saves and closes and the new version starts; if the installer cannot run, the app
  stays open and gives the real reason, such as a missing permission.
Rules: clean-up before quitting has a short time limit so the restart is not held up; a watchdog
  forces the old process out at its deadline so it never blocks the installer, and arming it again
  never moves the deadline later; if the install fails straight away the watchdog is stood down and
  the app stays usable; the cause shown is the underlying one, with paths and secrets taken out;
  clicking Restart to update again while the app is already getting ready to quit is ignored, so
  only one install runs.
Acceptance:
  - [x] Normal update → the old process is gone within the deadline and the new version is running. (evidence/T-622.txt)
  - [ ] Refuse the elevation request → the app stays open and the message names a permission problem.
Compat: —
Source: D-19-029

### APP-031 · Update download problems fix themselves or offer a fix
Tier: P1 · Pushed: 8 · State at 0.15.0: live-unverified
User does: checks for updates on a network that breaks downloads, or while a release is only half
  published.
User sees: for network protocol errors, the card offers to retry in a compatibility mode; while a
  release is being published, the app sticks with the last complete one and looks again soon.
Rules: a release whose files are not all uploaded yet is passed over for the last complete one, and
  checked again on a short cycle; a missing update manifest counts as no update, not as an error;
  late events from an earlier check never overwrite the current check's result; errors on a local
  build never send the user to a platform download page; background checks say nothing about a
  half-published feed or a missing manifest for this platform, while a check the user asked for
  explains it calmly in plain words instead of showing the raw error, and no rapid retry is queued;
  an environment variable can force the compatibility mode on or off, overriding the saved setting;
  if the newest complete release cannot be worked out, the check falls back to the repository's
  latest release.
Acceptance:
  - [ ] Publish a release with its manifest but no installer yet → no error, and the update is picked
        up once the installer is uploaded.
  - [ ] Force an HTTP/2 protocol error during a manual check → the card offers compatibility mode;
        accept → the next check succeeds.
Compat: —
Source: D-19-031

### APP-061 · Packaged builds are smoke-tested before they are published
Tier: P1 · Pushed: 8 · State at 0.15.0: half-done
User does: nothing; it runs as part of a release.
User sees: a broken build never reaches anyone, because the release stops when the packaged app fails
  its checks.
Rules: the CLI smoke test confirms the packaged CLI reports the release version, its help works, and
  the old-profile migration succeeds in an isolated profile; the terminal smoke test starts the
  packaged app hidden in a throwaway profile with its own terminal service, draws coloured output,
  copies to the clipboard and reads it back, opens 16 panes without dropping out of GPU drawing, and
  exercises WSL when it is present; at 0.15.0 only the older tag-triggered pipeline runs the
  terminal smoke test, while the automatic release runs the CLI one.
Acceptance:
  - [ ] Break the packaged CLI's version → the release stops before publishing.
  - [ ] Run the terminal smoke test on a build whose panes fall back from GPU drawing → it reports a
        failure.
Compat: —
Source: D-19-061

### APP-001 · Only one copy runs; launching again brings the open window forward
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: starts the app (shortcut, Start menu or CLI) while it is already running.
User sees: no second copy; the existing window is un-minimised if needed and brought to the front.
Rules: a second launch passes its request to the running copy and exits with an exit code of its own,
  never zero; a minimised window is restored before it is focused, and focusing is retried briefly
  when the system refuses to bring it forward; on Windows the app asks for foreground rights so the
  window really comes to the front rather than only flashing in the taskbar; a launch while the app
  runs with no window open creates one window.
Acceptance:
  - [ ] With the app open and minimised, launch it again → the same window restores and takes focus,
        and the process count does not change.
  - [ ] The second process exits within a few seconds with the duplicate-launch exit code.
Compat: —
Source: D-19-001

### APP-002 · The window appears quickly even when the terminal service is slow
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: launches the app, including straight after a reboot or an update.
User sees: the window shows promptly with the saved layout, and terminals reconnect as soon as the
  background terminal service is ready.
Rules: the terminal service and the agent-hook service start alongside window creation; if the
  terminal service is still not ready after a fixed wait, the first window opens anyway and
  terminals attach later; the gate that holds back terminal creation opens by itself at a hard limit
  rather than blocking forever; if the window never signals that it is ready, a fallback timer
  shows it anyway so the user is never left looking at nothing (Windows and Linux); saved interface
  state loads before projects and worktrees, background polling holds off until the workspace
  session has finished loading, and optional overlays are not loaded at startup; terminal reconnection waits for the
  first window's startup services; setting up the network proxy never delays the first window, it
  is held back and applied once the window exists.
Acceptance:
  - [ ] Delay the terminal service's start by 30 s → the window still appears within the startup limit
        with the saved layout, and panes fill in once the service is up.
  - [ ] Suppress the window's ready signal → the window becomes visible after the fallback delay.
Compat: —
Source: D-19-002

### APP-006 · Closing asks first when work could be lost, and quitting always finishes
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: clicks the window's close button, or quits from the menu, with sessions running.
User sees: a confirmation when something would be interrupted; once confirmed, the app saves and
  exits within a fixed time.
Rules: the window's own interface decides whether to confirm, and the confirmation is skipped only
  when that interface is gone or has crashed; an interface that is frozen but still alive is still
  asked; quitting has a deadline, so if shutdown hangs the app exits anyway after saving what it
  can; on Windows and Linux closing the last window quits, while on macOS the app keeps running
  unless a quit is already under way; closing a popped-out session window never starts the main
  window's quit sequence.
Acceptance:
  - [ ] With an agent running, click close → a confirmation appears; cancel → the window stays;
        confirm → the app exits.
  - [ ] Freeze the interface and quit → the app still exits within the quit deadline.
Compat: —
Source: D-19-006

### APP-011 · Restart, reload and update only go ahead after a safe save
Tier: P1 · Pushed: 9 · State at 0.15.0: live
User does: clicks Restart Kolux, Restart to update, or a reload.
User sees: the app saves and then restarts; if the save fails, the restart is refused and nothing
  changes.
Rules: every action that tears the app down (relaunch, quit and install, reload) first waits for a
  durable save point; a failed save point cancels the action rather than risk losing layout or
  sessions; recovery reloads after a screen failed to load reuse that same save point; if a full
  snapshot of the current state fails, the last durable save is used and the action goes ahead when
  nothing unsaved would be lost, but with unsaved editor drafts the action is refused and the drafts
  stay where they are.
Acceptance:
  - [ ] Make the save fail, click Restart Kolux → the app does not restart and reports the failure.
  - [ ] Restart normally → the restored layout matches the layout before the restart exactly.
Compat: —
Source: D-19-011

### APP-020 · Terminals find the same tools as the user's shell, including new installs
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: installs a CLI (an agent, say) and opens a new terminal or session.
User sees: the new tool is found without restarting the computer.
Rules: at startup the app reads the environment and search path of the user's login shell; on
  Windows the stored user and system path are read again, and entries added after the app started
  are kept; changing the configured shell re-reads the path for that shell, with queued changes
  collapsing to the latest one; refreshing agent detection re-reads the path before checking and
  falls back to the current path if the shell cannot start; installed copies put Node
  version-manager folders ahead of system folders on the search path, so the runtime the user chose
  wins over a system-wide one.
Acceptance:
  - [ ] Install a CLI with the app running, then open a new terminal → the CLI runs by name.
  - [ ] Install an agent and refresh agent detection → the agent is detected.
Compat: —
Source: D-19-020

### APP-021 · Broken folder permissions are detected and repaired on Windows
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: launches after an install or update left the install or profile folder with the wrong
  permissions.
User sees: the app starts as usual; when it cannot repair things, the recovery prompt points to a
  permissions problem instead of crashing over and over.
Rules: a quick check at startup confirms the user can write to the install folder and the profile
  folder; repairs touch only the user's own install; graphics-process failures caused by install
  files that cannot be read count as a permissions problem, not a GPU crash.
Acceptance:
  - [ ] Remove the user's access to a file in the install folder, then launch → access is restored and
        the app starts.
  - [ ] Make the repair impossible, then launch → the recovery prompt names a permissions problem and
        the app does not crash in a loop.
Compat: —
Source: D-19-021

### APP-039 · After a crash the app offers to report it as a GitHub issue
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: relaunches after a crash, or picks Help → Report Crash.
User sees: once, at startup, a crash report dialog with Attach recent diagnostic logs, Copy Details
  and Open on GitHub; when nothing was captured it says so.
Rules: only the newest pending report prompts, and only once, after which it is marked dismissed;
  Help → Report Crash reopens the newest report even after dismissal; attaching logs copies a
  scrubbed log bundle to the clipboard for pasting into the issue; issue titles are marked as crash
  reports; clipboard failures show a toast instead of failing quietly.
Acceptance:
  - [ ] Crash the interface process and relaunch → the dialog appears once; relaunch again → no dialog.
  - [ ] Dismiss it, then choose Help → Report Crash → the same report opens.
Compat: —
Source: D-19-039

### APP-042 · When the interface crashes or a screen fails to load, the app recovers or asks
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: keeps working while the interface process crashes, hangs during a reload, or a screen
  fails to load after an update.
User sees: the interface reloads by itself; if that fails, a prompt names the likely cause and offers
  Reload or Quit, with commands the user can copy; a screen that failed to load offers a reload
  instead of an empty area.
Rules: one automatic recovery reload, and if it never yields a page it retries once before showing
  the prompt; an error page does not count as a successful reload, and the stall budget starts over
  after the computer wakes; recovery prompts never stack and are not shown for a window that is
  already closing; repeat recoveries are counted and a circuit breaker stops reload loops; causes
  named include stalled reloads, install permission problems and graphics driver hints; before a
  recovery reload, unsaved editor buffers are backed up, and if that backup fails the reload is
  refused.
Acceptance:
  - [ ] Kill the interface process → it reloads by itself with the layout intact.
  - [ ] Make the reload hang twice → the prompt appears with Reload and Quit.
Compat: —
Source: D-19-042

### APP-043 · Repeated graphics crashes lead to safe graphics, with the user's consent
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: runs into a burst of graphics-process crashes on Windows.
User sees: a prompt offering to restart in safe graphics mode, or Keep Running; at the next launch, a
  choice between staying in safe graphics and trying hardware acceleration again.
Rules: a burst of crashes within a short window sets it off, at most once; the safe-graphics flag is saved
  before the user answers the prompt, and Keep Running removes it; on the recovered launch,
  staying in safe graphics is preselected and the choice is remembered; the flag is cleared when
  the app version changes and ignored outside Windows.
Acceptance:
  - [ ] Simulate three graphics crashes inside a minute → the restart prompt appears; accept → the app
        relaunches in safe graphics.
  - [ ] Update the app → hardware acceleration is tried again.
Compat: —
Source: D-19-043

### APP-049 · A damaged saved-state file never wipes the user's setup
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: launches after the main state file was damaged (a crash mid-write, a disk fault).
User sees: the app starts from the last good backup copy; if it cannot protect the damaged file, it
  stops saving rather than overwrite it.
Rules: the damaged file is copied to one side before anything is restored; if it can be neither
  copied aside nor read, saving is frozen for that session; a zero-byte file is treated as missing,
  not as damaged.
Acceptance:
  - [ ] Corrupt the state file and launch → the earlier setup returns from the backup copy and the
        damaged file is kept aside.
  - [ ] Make the folder read-only and corrupt the file → the app runs without overwriting it.
Compat: —
Source: D-19-049

### APP-053 · Closing a terminal or the app leaves no orphaned processes
Tier: P1 · Pushed: 9 · State at 0.15.0: live-unverified
User does: closes a terminal or kills a session.
User sees: the shell and everything it launched stop; nothing keeps running out of sight.
Rules: on Windows each terminal's processes are grouped so the whole group ends together; if the
  system refuses the grouping, the app falls back to killing the process tree; kills the app
  performs itself are logged so they are never mistaken for crashes.
Acceptance:
  - [ ] Start a long-running child process in a terminal and close it → the child is gone within seconds.
  - [ ] Kill a session the app launched → no crash prompt appears at the next launch.
Compat: —
Source: D-19-053

### APP-062 · A manual restore check proves terminals survive quits and a killed service
Tier: P1 · Pushed: 9 · State at 0.15.0: live
User does: runs the restore check against a packaged build.
User sees: pass or fail for this sequence: folder workspaces with markers in their panes survive three
  quit-and-relaunch rounds, then a killed isolated terminal service, then a cold restore.
Rules: it uses an isolated profile and kills only its own terminal service; the automatic release
  never runs it, so someone starts it by hand.
Acceptance:
  - [ ] Run the check on a good build → the markers show after all four relaunches.
  - [ ] Run it while the real app is open → the user's own terminal service and sessions are untouched.
Compat: —
Source: D-19-062

### APP-004 · Settings and data from the app's former name carry over on first launch
Tier: P1 · Pushed: 10 · State at 0.15.0: live
User does: installs this version over an install that still used the old product name.
User sees: projects, settings and history are all present; nothing has to be set up again.
Rules: the old profile folder is copied into the new one once, and repeating it changes nothing; a
  file already present in the new profile is never overwritten; files locked by another program are
  skipped rather than stopping the migration; the packaged release smoke test checks this migration
  on every release; development and test profiles never get it; small interface preferences stored
  under the former name's prefix move once to the new prefix; saved settings stored under the former
  product's names are renamed once to the current names, a value already saved under the current
  name wins, and repeating the rename changes nothing.
Acceptance:
  - [ ] Seed an old-name profile with a project and a setting, then launch → both appear; launch
        again → no duplicates.
  - [ ] Pre-create one target file with different content → it is unchanged after the migration.
Compat: the former product was called Nightshift; its whole user-data profile folder in the system's
  application-data location, matched in any letter case, is migrated into the Kolux profile folder.
Source: D-19-004

### APP-008 · Tray icon with a short menu and an attention dot
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: looks at or clicks the tray icon.
User sees: an icon in the system tray whose menu has Open Kolux and Quit; a dot appears on it when a
  bell rang or an agent finished while the window was hidden.
Rules: Windows and macOS only, Linux gets no tray icon; on Windows a left-click opens the app;
  development copies show a DEV label and the branch they run from; the dot clears once the window
  is shown.
Acceptance:
  - [ ] Hide the window and let an agent finish → the tray icon gets the dot; open the window → the
        dot clears.
  - [ ] Left-click the tray icon on Windows → the main window appears.
Compat: —
Source: D-19-008

### APP-009 · Standard menu bar: File, Edit, View, Window, Help
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the menus in the menu bar.
User sees: File (Settings, Exit); View (reload, force reload, developer tools, reset size, zoom in,
  zoom out, full screen); Window (minimise, zoom); Help (report a crash, explore the app, getting
  started, plus About and Check for Updates on Windows and Linux).
Rules: on macOS the app menu holds About, Check for Updates, Settings, Services, hide and quit in
  place of File; Help → Report Crash reopens the newest crash report even if it was dismissed; menu
  accelerators match the in-app shortcuts; every platform has an Edit menu with Undo, Redo, Cut,
  Copy, Paste and Select All, and copy, paste and select all act on whatever has focus (terminal,
  editor or text field); the View menu also holds the switch between the Agents, Board and Terminals
  screens and an Appearance submenu of sidebar and button toggles, which belong to area 05 except
  Show Titlebar App Name (see APP-012); on macOS the hiding group in the app menu runs, in order,
  Hide (Kolux itself), Hide Others (every other app's windows go while Kolux stays on screen) and
  Show All (every hidden app comes back), each the operating system's stock action with no logic
  of the app's own.
Acceptance:
  - [ ] On Windows open Help → Check for Updates is there and starts a check that shows the update card.
  - [ ] View → zoom in enlarges the interface; reset size returns it to normal.
Compat: —
Source: D-19-009

### APP-010 · Settings and Help menu in the sidebar footer
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: opens the settings and help menu at the foot of the sidebar.
User sees: Settings, plus a Help group with Docs, Changelog, GitHub, Milestones, Keyboard Shortcuts,
  Onboarding, Send Feedback, Copy terminal diagnostics, Check for Updates and Restart Kolux.
Rules: Restart Kolux shows a restarting state and relaunches after saving; Copy terminal diagnostics
  puts a scrubbed diagnostic summary on the clipboard; Docs, Changelog and GitHub open in the system
  browser.
Acceptance:
  - [ ] Choose Restart Kolux → the app relaunches with the same layout and sessions.
  - [ ] Choose Copy terminal diagnostics → the clipboard holds text with no secrets and no home-folder
        paths.
Compat: —
Source: D-19-010

### APP-013 · Zoom and tab-switch shortcuts work wherever focus sits
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: presses zoom in, zoom out or reset, Ctrl+Tab, or a tab-number shortcut while typing in a
  terminal or the editor.
User sees: the app zooms or changes tab instead of the focused terminal or editor swallowing the keys.
Rules: window-level shortcuts are caught before the page sees them; shortcuts that depend on terminal
  focus or markdown-editor focus are sent to the right surface.
Acceptance:
  - [ ] Focus a terminal and press Ctrl+Tab → the next tab becomes active and the terminal receives no
        characters.
  - [ ] Press zoom in twice, then reset → the interface zoom is back at 100 %.
Compat: —
Source: D-19-013

### APP-015 · Web addresses go to the default browser; the app window never navigates away
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: clicks a link in a terminal, a note or a dialog.
User sees: the link opens in the default browser (or in the in-app browser where that is the chosen
  route), and the app stays on its own screen.
Rules: any attempt to move the main window to an outside web address is blocked and handed to the
  browser; foreign file hosts and data addresses dressed up as the app's own pages are blocked;
  embedded preview pages load only addresses the app has allowed, and those allowances are cleared
  when the window is rebuilt; links from floating workspaces open in the app without changing the
  active worktree; holding a modifier while clicking flips the chosen route, and the system browser
  stays reachable even when links normally open inside the app.
Acceptance:
  - [ ] Click an https link in a terminal → the default browser opens it and the app window is unchanged.
  - [ ] Try to navigate the main window to an outside address by script → it is blocked.
Compat: —
Source: D-19-015

### APP-016 · The clipboard handles files, images and verified text
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: copies a file in the app to paste into another program, pastes an image into a terminal,
  or copies text.
User sees: the file pastes elsewhere as a real file; a pasted image arrives as a file the agent can
  read, with a thumbnail; copied text is exactly what was selected.
Rules: only absolute paths inside permitted local roots can go on the clipboard as files; each system
  uses its own way of putting files on the clipboard, and on Linux several tools are tried, with the
  copy reported as unsupported when none works; written text is read back and must match exactly,
  line endings included, or the copy is reported as failed; pasted images are saved to a temporary
  file that is cleaned up later.
Acceptance:
  - [ ] Copy a file from the explorer and paste it into the system file manager → the file is copied.
  - [ ] Copy several lines that use Windows line endings → the pasted text is identical byte for byte.
Compat: —
Source: D-19-016

### APP-037 · Send Feedback opens a pre-filled GitHub issue for the user to review
Tier: P1 · Pushed: — · State at 0.15.0: live
User does: chooses Send Feedback, writes a message, optionally ticks Submit anonymously, and clicks
  Open on GitHub.
User sees: the browser opens a new-issue page on the project's GitHub with the title and body filled
  in; the app itself sends nothing.
Rules: the title carries a feedback prefix and the first line of the message, cut at 80 characters,
  and empty text is refused with an error; the body adds the app version, platform, system release
  and architecture, plus the GitHub login unless anonymous is ticked; paths and secrets are scrubbed
  from the text; very long reports are trimmed to fit in a browser address, with a note saying so;
  the app makes no network request, the browser does the submitting.
Acceptance:
  - [ ] Send feedback with some text → the browser opens a new-issue page whose title begins
        [Feedback] and whose body includes the version.
  - [ ] Tick Submit anonymously → the body has no GitHub login.
Compat: issues go to the owner's public repository TxaisX/kolux, through GitHub's own new-issue page
  with the title and body passed in its address.
Source: D-19-037

### APP-055 · `kolux diagnostics memory` prints a memory snapshot
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs the memory diagnostics command, optionally asking for JSON.
User sees: memory for the app and for each managed terminal, the same figures the Resource Manager
  shows.
Rules: JSON output is machine-readable for scripts and agents; on Windows the process sweep is
  sampled efficiently and its output is parsed robustly.
Acceptance:
  - [ ] Run it with JSON while two terminals are open → valid JSON with two terminal entries.
  - [ ] Run it without JSON → the same figures as the Resource Manager, in a form a person can read.
Compat: `kolux diagnostics memory`, with `--json` for machine output.
Source: D-19-055

### APP-056 · `kolux open` starts the app and waits until it is ready
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs the open command from a terminal or a script.
User sees: the app starts or comes forward, and the command returns once the app can take further
  commands.
Rules: works whether or not the app is already running; JSON output reports readiness for scripts.
Acceptance:
  - [ ] With the app closed, run it → the app opens and the command exits successfully once the
        runtime answers.
  - [ ] With the app already open, run it → the existing window comes forward and no second copy starts.
Compat: `kolux open`, with `--json`.
Source: D-19-056

### APP-057 · `kolux status` reports whether the app and its runtime are ready
Tier: P1 · Pushed: — · State at 0.15.0: live-unverified
User does: runs the status command.
User sees: whether the app is running, whether its runtime answers, and whether its data has loaded.
Rules: JSON output is available for scripts and agents.
Acceptance:
  - [ ] With the app closed → status says it is not running; open the app → status reports ready.
  - [ ] Run it with JSON → a machine-readable answer carrying the same three facts.
Compat: `kolux status`, with `--json`.
Source: D-19-057

### APP-030 · An update whose Windows signature does not match is stopped, with no bypass
Tier: P2 · Pushed: 8 · State at 0.15.0: live-unverified
User does: receives an update whose installer is signed differently from the installed app.
User sees: a security stop card explaining the update was refused, with no button to install it
  anyway.
Rules: the refused version is never offered for install again; this applies only to signed builds,
  and current releases are unsigned, so the path is not normally reached.
Acceptance:
  - [ ] Serve a signed build an update signed by a different publisher → the security stop card
        appears with no install option.
  - [ ] Check again later → the refused version is not offered again.
Compat: —
Source: D-19-030

### APP-003 · Startup failures and stray background errors never silently kill the app
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: nothing; a fault happens during launch or while the app is running.
User sees: a fatal startup failure exits cleanly with a reason written to the log rather than leaving
  a hung process; errors in background work that are not fatal are logged and the app keeps going.
Rules: unhandled promise rejections and uncaught errors in the app's main process are logged and
  absorbed when they are not fatal; a failure before the first window exists ends the process
  rather than leaving an invisible copy holding the single-instance lock.
Acceptance:
  - [ ] Inject an unhandled rejection into a background task → the app stays open and the error is in
        the local log.
  - [ ] Inject a failure before the window opens → the process exits within seconds and a new launch
        works.
Compat: —
Source: D-19-003

### APP-017 · After sleep the window repaints, and hidden windows stop doing interface work
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: wakes the computer from sleep, or leaves the window minimised for a long time.
User sees: the window draws correctly right after waking; a minimised app uses little CPU and catches
  up the moment it is shown.
Rules: resuming from sleep repaints every window; live updates meant for hidden windows are held and
  replayed when the window is shown; interface updates are throttled so bursts do not freeze it;
  hidden windows are excused from the browser engine's heavy throttling of background timers, so
  status updates keep arriving while minimised.
Acceptance:
  - [ ] Sleep and wake the computer → no blank or stale areas in the window.
  - [ ] Minimise for 10 minutes with agents running, then restore → status shows the current state
        within one second.
Compat: —
Source: D-19-017

### APP-040 · Only real crashes are recorded, with useful context
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: nothing; processes end during normal use or shutdown.
User sees: no false crash prompts after normal quits or deliberate kills; genuine crash reports
  include the memory situation just before the crash.
Rules: exits during an expected shutdown, graphics exits at quit time, and kills the app issued
  itself are not crashes, while interface process crashes and unknown child crashes still are; only
  the newest five reports are kept, and reports from the same crash are merged with their siblings
  dismissed; crash dumps that arrive late are merged into the existing report; the report store
  survives damaged files (it starts empty) and retries saves on Windows when files are briefly
  locked; the last host memory reading before the crash is attached, and free disk space is never
  presented as proof that swap could have grown; when a crash dump exists, the report names the
  module that faulted.
Acceptance:
  - [ ] Quit normally ten times → no crash prompt.
  - [ ] Crash the interface process seven times → only five reports remain.
Compat: —
Source: D-19-040

### APP-051 · Stale worktree records are cleaned up safely
Tier: P2 · Pushed: 9 · State at 0.15.0: live-unverified
User does: deletes worktrees outside the app, or reopens the app after folders moved.
User sees: worktrees that are gone and have no sessions disappear from the saved list; worktrees with
  sessions, or on drives that cannot be reached, stay.
Rules: only records with no session and a folder confirmed missing are removed; storage that cannot
  be reached is never treated as missing; sessions are kept per host, so one machine's entries never
  overwrite another's.
Acceptance:
  - [ ] Delete a worktree folder that has no session, then relaunch → the list no longer shows it.
  - [ ] Disconnect a drive holding a worktree, then relaunch → the worktree is still listed.
Compat: —
Source: D-19-051

### APP-012 · App icon choice and window look options
Tier: P2 · Pushed: 10 · State at 0.15.0: live-unverified
User does: picks an app icon variant, turns on window background blur, or hides the app name in the
  title bar.
User sees: the taskbar or dock icon changes to the chosen variant (classic, watercolor or blue); the
  window background blurs; the title bar shows or hides the app name.
Rules: an unknown icon choice falls back to the default icon; background blur is off by default, and
  the app name in the title bar is on by default.
Acceptance:
  - [ ] Choose the blue icon → the taskbar icon changes without a restart, or at the next launch where
        the system requires one.
  - [ ] Turn the title-bar name off → the name disappears from the title bar.
Compat: —
Source: D-19-012

### APP-007 · Optional: closing the window hides the app to the tray (Windows)
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: switches on the minimise-to-tray option, then clicks the window's close button.
User sees: the window disappears but the app keeps running in the tray; the first time, a
  notification explains where it went.
Rules: off by default; the explanation is shown once only; a real quit (menu, tray Quit, system
  shutdown) is never intercepted; a Windows session ending (sign-out, shutdown) is recorded so the
  next launch knows it was not a crash.
Acceptance:
  - [ ] With the option on, click close → the window hides, the process stays alive and the tray icon
        is present; the first time only, a notification appears.
  - [ ] With the option on, choose Quit from the tray → the app exits.
Compat: —
Source: D-19-007

### APP-014 · Right-click menu in text fields with spelling suggestions and edit actions
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: right-clicks in a text box or the rich-text editor.
User sees: spelling suggestions where there are any; cut, copy and paste; table actions when the
  cursor is in a table.
Rules: there is no menu outside editable text; plain inputs get spelling and the system's edit
  actions only, and table actions appear only inside a table; suggestions still appear when
  spellcheck reports itself off but the engine offers them anyway.
Acceptance:
  - [ ] Right-click a misspelt word in a text field → suggestions are listed; pick one → the word is
        replaced.
  - [ ] Right-click plain text outside any input → no app context menu.
Compat: —
Source: D-19-014

### APP-018 · Optional: keep the computer awake while agents run
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: turns on the keep-awake option and leaves agents working.
User sees: the computer does not sleep while any agent is running; normal sleep returns once they
  stop.
Rules: off by default; macOS and Linux hold a system sleep inhibitor (on Linux it also blocks sleep on
  lid close), one at a time; if the inhibitor tool is missing the option quietly does nothing and
  logs that once; how it behaves on Windows is not confirmed.
Acceptance:
  - [ ] With the option on and an agent running → the system reports a sleep inhibitor held by the
        app; the agent stops → it is released.
  - [ ] Remove the inhibitor tool and turn the option on → nothing breaks and a single log line notes it.
Compat: —
Source: D-19-018

### APP-019 · Markdown files opened from the system open inside the app
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: double-clicks, or uses Open with on, a markdown file outside the app.
User sees: the app comes forward and shows the file in its editor, even if it was not running yet.
Rules: files requested before the window is ready are queued and handed over once it is; other file
  types are ignored; a file passed as an encoded file address (for example with spaces in its path)
  is decoded so it still opens.
Acceptance:
  - [ ] With the app closed, open a markdown file with it → the app starts with the file open in the
        editor.
  - [ ] Open a markdown file whose path contains spaces → it opens normally.
Compat: —
Source: D-19-019

### APP-022 · More memory headroom for the interface on bigger machines
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: runs many sessions on a computer with 8 GB of RAM or more.
User sees: the interface does not run out of memory as early; an environment variable can set the
  limit outright.
Rules: below 8 GB of RAM the default limit stays; an explicit value from the environment beats the
  automatic choice.
Acceptance:
  - [ ] Launch with the override set → the interface process uses that memory limit.
  - [ ] Launch on a machine with less than 8 GB and no override → the default limit is used.
Compat: at 0.15.0 one environment variable sets this limit as a number of megabytes; its exact name
  is awaiting an allowlist decision.
Source: D-19-022

### APP-032 · A network proxy can be set for the app's own traffic
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: enters a proxy address and a bypass list, optionally with a user name and password.
User sees: update checks and other app traffic go through the proxy; clearing it goes back to the
  system proxy.
Rules: explicit settings come first, then the system proxy, then proxy environment variables; proxy
  credentials are stored as a secret, survive restarts, never appear in metadata and are sent only
  to the matching proxy; changes are applied in order, and if applying one fails, requests stay
  blocked rather than slipping around the proxy; its settings section is folded, so the control
  moves to General; the bypass list names hosts that skip the proxy; if the saved proxy address
  cannot be decrypted (after a system key change, for example) it is left sealed and unused rather
  than deleted.
Acceptance:
  - [ ] Set a proxy with credentials and restart → the update check goes through the proxy using the
        credentials.
  - [ ] Clear the proxy → traffic goes direct or through the system proxy.
Compat: —
Source: D-19-032

### APP-038 · Screenshots can go with feedback and land on the clipboard for pasting
Tier: P2 · Pushed: — · State at 0.15.0: live-unverified
User does: adds screenshots to a feedback report.
User sees: up to four images attach; when the issue page opens, the first screenshot is already on
  the clipboard ready to paste, with a note of how many there are.
Rules: PNG, JPEG, WebP or GIF only, at most four images of at most 8 MB each; crash reports take no
  images and copy the scrubbed diagnostic bundle instead; an empty image is rejected the moment it
  is added, not at submit time; a file that is not really an image is rejected with a message naming
  it, gets no preview and does not count toward the limit; images added beyond the limit are all
  left out and the user is told what the limit is.
Acceptance:
  - [ ] Attach five images → the fifth is refused.
  - [ ] Attach one PNG and submit → pasting into the issue page inserts that image.
Compat: —
Source: D-19-038

### APP-045 · Usage telemetry is compiled off
Tier: H · Pushed: 5 · State at 0.15.0: hidden
User does: uses the app.
User sees: no usage data leaves the app, and the privacy statement says this build sends none.
Rules: the telemetry client is switched off when the app is built, whatever the settings say;
  consent, an install id, cohort grouping, rate limits and checks on event shape exist at 0.15.0
  but never send anything; the privacy settings section is folded under the owner cut, so there is
  no control for it.
Acceptance:
  - [ ] Run a session with a network monitor → no telemetry or analytics request is made.
  - [ ] Look for a telemetry switch in Settings → there is none.
Compat: —
Decision: H: default skip
Source: D-19-045

### APP-046 · Diagnostic upload is unavailable, and environment opt-outs refuse it
Tier: H · Pushed: 5 · State at 0.15.0: hidden
User does: looks for a diagnostic upload option, or sets an opt-out variable.
User sees: upload reported as not available in this build; opt-out variables and CI environments turn
  it off in any case.
Rules: upload addresses are checked before any upload, and bundles carry submission ids and can be
  deleted; opt-out variables leave the saved setting unchanged.
Acceptance:
  - [ ] Look for diagnostic upload → it is reported as unavailable.
  - [ ] Set the common do-not-track variable → the saved setting is unchanged and nothing is uploaded.
Compat: 0.15.0 honours the common do-not-track environment variable and two Kolux-specific opt-out
  variables (one for telemetry, one for diagnostics), each set to 1; their exact names are awaiting
  an allowlist decision.
Decision: H: default skip
Source: D-19-046

### APP-033 · Alternative update channels and modifier-click prerelease checks
Tier: H · Pushed: 8 · State at 0.15.0: hidden
User does: Shift-clicks or Ctrl-clicks Check for Updates, or switches to an hourly, daily or ad-hoc
  build channel.
User sees: a check against the release-candidate or performance prerelease feed, or a newest-first
  list of hourly or daily builds.
Rules: Shift picks the release candidate and Ctrl (Cmd on macOS) the performance prerelease, with a
  tooltip hinting at this per platform; a Shift-click during a running stable check starts a fresh
  prerelease check; builds with no file for this platform are hidden, and rate limits produce a
  message with a way forward; development channels exist on Windows and macOS only, and leaving a
  signed build for one needs a manual install; Kolux publishes a single channel, so none of these
  feeds has anything in it.
Acceptance:
  - [ ] Default build: Shift-click Check for Updates → an ordinary stable check runs.
  - [ ] Default build → no channel picker is offered anywhere.
Compat: —
Decision: H: default skip
Source: D-19-033

### APP-034 · Switching to a locally built version, and updates in unpackaged copies
Tier: H · Pushed: 8 · State at 0.15.0: dev-only
User does: a developer points the app at a locally built package, or runs an unpackaged copy and
  checks for updates.
User sees: the local build is offered like an update and installed; an unpackaged copy explains that
  it cannot install updates.
Rules: the local package must match its hash, contain no links or path escapes, and hold exactly one
  archive for this machine's architecture; it is served from a private local feed that answers only
  requests carrying a token; a local build whose saved-state or live-terminal protocol is not
  compatible is refused; choosing a local build overrides the channel modifiers, and local versions
  never link to GitHub downloads.
Acceptance:
  - [ ] Default build → there is no way to pick a local build.
  - [ ] Run an unpackaged copy and check for updates → it says it cannot install updates.
Compat: —
Decision: H: default skip
Source: D-19-034

### APP-035 · Linux-only update and launch paths
Tier: H · Pushed: 8 · State at 0.15.0: live-unverified
User does: runs the app from a Linux package or AppImage.
User sees: installs managed by a package manager report a new version without downloading it; a
  recovery card offers an install command to copy, a reveal-file action and a link to the release;
  the AppImage runs CLI commands when given one.
Rules: Enable & Restart relaunches only once, even on a double click; package-manager commands are
  built only for trusted package managers and quoted safely, and diagnostics are scrubbed; Linux
  builds are not released, so none of this reaches users today; a stale command-line registration
  left by a moved or older AppImage is repaired, after which the CLI reports as installed.
Acceptance:
  - [ ] Default build → no Linux packages are published with a release.
  - [ ] If built: on a package-managed install, a new version is reported but not downloaded.
Compat: —
Decision: H: default skip
Source: D-19-035

### APP-063 · Tag-triggered CI release pipeline
Tier: H · Pushed: 8 · State at 0.15.0: retired 2026-10-06
User does: pushes a version tag.
User sees: CI builds, creates a draft release, publishes the installer, runs both smoke tests and
  only then marks the release as latest.
Rules: the tag must equal the project version; replaced by the automatic release on every ship, and
  tagging is now discouraged because it starts paid CI.
Acceptance:
  - [ ] Default build: pushing a version tag starts no release; releases come only from the ship flow.
  - [ ] Ship to main → the release is created without any tag push.
Compat: —
Decision: H: default skip
Source: D-19-063

### APP-064 · Code-signed installers (opt-in, off)
Tier: H · Pushed: 8 · State at 0.15.0: hidden
User does: installs a release.
User sees: releases are unsigned unless signing is switched on when the app is built.
Rules: builds from before mid-September carried a signer name, so anyone still on one has to
  reinstall by hand once before automatic updates resume; signing and in-app rollback are planned but not shipped.
Acceptance:
  - [ ] Default build → the published installer is unsigned and updates still install.
  - [ ] Switch signing on at build time → the installer carries a signature.
Compat: —
Decision: H: default skip
Source: D-19-064

### APP-044 · Main-thread hang watchdog
Tier: H · Pushed: 9 · State at 0.15.0: hidden
User does: nothing; the app's main process freezes for a while.
User sees: nothing on Windows; on macOS a background watcher notes the stall and whether it cleared,
  for diagnostics only.
Rules: runs only on macOS and does nothing elsewhere; a large jump in timing is taken as system sleep,
  not a hang; one record per stall, reported only through the disabled telemetry path.
Acceptance:
  - [ ] Default build on Windows → no watcher runs and nothing is recorded.
  - [ ] If built on macOS: put the computer to sleep and wake it → no hang is recorded.
Compat: —
Decision: H: default skip
Source: D-19-044

### APP-005 · A session in its own system window that remembers its place (dormant)
Tier: H · Pushed: — · State at 0.15.0: hidden
User does: pops a session out into its own window, moves and resizes it, then closes and reopens it
  later.
User sees: a separate rounded window showing that one live session; reopening restores the same size
  and position.
Rules: one window per session at most, and asking again focuses the existing one (restoring it if
  minimised); a different session gets a different window; size and position are saved per session;
  closing one session window leaves every other window and the session itself running; a window
  only ever attaches to the terminal it was opened for, and with no terminal named it attaches to
  the tab's saved terminal; dormant at 0.15.0, because nothing in the main interface or the CLI
  opens a session window, and the rounded look from the 10-05 redesign is the pane card inside the
  grid (area 03), not this window.
Acceptance:
  - [ ] If built: pop out session A, move it, close it, pop it out again → same position and size.
  - [ ] If built: pop out A and B, close A's window → B's window and both sessions keep running.
Compat: —
Decision: H: default skip
Source: D-19-005

### APP-036 · macOS-only startup and window behaviour
Tier: H · Pushed: — · State at 0.15.0: live-unverified
User does: runs the app on macOS.
User sees: key repeat works in terminals (the press-and-hold accent popup is turned off unless the
  user set it), a notice explains repeated macOS permission prompts, Full Disk Access is detected,
  a menu-bar icon follows light and dark appearance, and maximised windows draw correctly on newer
  macOS.
Rules: an explicit user choice for press-and-hold is respected, and failures leave the choice
  undecided; the menu-bar icon can be switched off; macOS builds are not released, so none of this
  reaches users today; a terminal service left over from a macOS login session that has ended is
  retired so the next launch starts a fresh one, but only after repeated failed login checks plus a
  confirmed broken system name resolver, never on an inconclusive check, and the resolver check
  never stalls live terminals.
Acceptance:
  - [ ] Default build → no macOS packages are published with a release.
  - [ ] If built: hold a letter key in a terminal on macOS → it repeats instead of opening the accent
        popup.
Compat: —
Decision: H: default skip
Source: D-19-036

### APP-047 · Typing-latency and main-thread churn probes
Tier: H · Pushed: — · State at 0.15.0: dev-only
User does: a developer turns on performance diagnostics.
User sees: summaries of typing latency and of subprocesses started on the main thread, in the logs.
Rules: off for normal users; only sample windows and summaries are logged.
Acceptance:
  - [ ] Default build → no latency or spawn summaries appear in the logs.
  - [ ] If built: turn the probes on and type in a terminal → a latency summary appears in the log.
Compat: —
Decision: H: default skip
Source: D-19-047

### APP-065 · Development copy: lighter dev server, clean exit, DEV identity
Tier: H · Pushed: — · State at 0.15.0: dev-only
User does: a developer runs the app from source.
User sees: the dev server uses about half the memory and stops when the shell that started it dies;
  the copy is labelled DEV with its branch; first-run education is suppressed; startup timings can
  be printed by setting an environment flag.
Rules: source maps for the main process are skipped in development to save memory; the development
  parent process watches the shell that launched it and shuts down when that shell goes.
Acceptance:
  - [ ] If built: start a development copy, then close the shell that launched it → the dev server exits.
  - [ ] If built: a development copy shows a DEV label with its branch.
Compat: an environment flag turns on printed startup timings; its exact name is awaiting an allowlist
  decision.
Decision: H: default skip
Source: D-19-065

### APP-066 · Leftovers from the retired OpenCode integration are removed at startup
Tier: H · Pushed: — · State at 0.15.0: retired 2026-09-23
User does: launches after upgrading from a version that supported OpenCode.
User sees: nothing; old OpenCode files are cleaned up.
Rules: only the retired integration's own files are touched.
Acceptance:
  - [ ] Default build → no OpenCode clean-up runs.
  - [ ] If built: launch over a profile with OpenCode leftovers → they are removed and nothing else
        changes.
Compat: —
Decision: H: default skip
Source: D-19-066

### APP-067 · Headless serve mode with a virtual display
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: runs the app as a headless server for remote clients.
User sees: the app runs with no window, optionally on a virtual display, and answers remote clients.
Rules: dropped with area 18, together with the serve command.
Acceptance:
  - [ ] Default build → there is no headless mode.
  - [ ] `kolux --help` → no serve command is listed.
Compat: —
Decision: default cut: headless serve went with remote and hosts (area 18). Revive via DECISIONS.md.
Source: D-19-067

### APP-068 · Remote sessions reconnecting at startup; remote clipboard and mobile relays
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: launches with SSH workspaces open, or pastes files into a remote terminal.
User sees: SSH connections come back at startup, pasted files are staged on the remote host, and
  markdown requests are relayed to mobile.
Rules: dropped with area 18.
Acceptance:
  - [ ] Default build → no SSH reconnection runs at startup.
  - [ ] Paste a file into a terminal → it is handled on this computer; nothing is staged on a remote
        host.
Compat: —
Decision: default cut: SSH, remote clipboard staging and mobile relays went with area 18. Revive via DECISIONS.md.
Source: D-19-068

### APP-069 · WSL command reconciliation at startup
Tier: D · Pushed: — · State at 0.15.0: dropped
User does: launches with WSL projects.
User sees: startup waits for WSL tool detection, and the landing checks probe WSL.
Rules: dropped with WSL execution in area 18.
Acceptance:
  - [ ] Default build → startup does not wait on WSL tool detection.
  - [ ] Open the landing screen → its tool checks do not probe WSL.
Compat: —
Decision: default cut: WSL execution went with area 18. Revive via DECISIONS.md.
Source: D-19-069

## Dropped by default (tier D)

- APP-067 · Headless serve mode with a virtual display — headless serve went with remote and hosts
  (area 18).
- APP-068 · Remote sessions at startup, remote clipboard and mobile relays — SSH, remote clipboard
  staging and mobile relays went with area 18.
- APP-069 · WSL command reconciliation at startup — WSL execution went with area 18.

## Hidden or retired (tier H)

- APP-045 · Usage telemetry · switched off at build time · default skip
- APP-046 · Diagnostic upload and environment opt-outs · unavailable in this build · default skip
- APP-033 · Alternative update channels and modifier-click checks · feeds empty, one channel
  published · default skip
- APP-034 · Local-build switching and unpackaged-copy updates · dev-only · default skip
- APP-035 · Linux-only update and launch paths · Linux not released · default skip
- APP-063 · Tag-triggered CI release pipeline · retired 2026-10-06 · default skip
- APP-064 · Code-signed installers · signing off at build time · default skip
- APP-044 · Main-thread hang watchdog · macOS only, reports through the disabled telemetry path ·
  default skip
- APP-005 · Session in its own system window · dormant, nothing opens it · default skip
- APP-036 · macOS-only startup and window behaviour · macOS not released · default skip
- APP-047 · Typing-latency and main-thread churn probes · dev-only · default skip
- APP-065 · Development-copy behaviour · dev-only · default skip
- APP-066 · OpenCode leftovers clean-up · retired 2026-09-23 · default skip
