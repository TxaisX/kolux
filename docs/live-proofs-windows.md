# Live proofs on Windows: the run list

**Results are being filled in as they are run: see `docs/live-proofs-results-2026-10-31.md` and the raw
lines in `evidence/live-installed-2026-10-31.txt`.** Already proven on this PC (do not redo): A-2 (the
consent line and the switch, on a genuinely fresh profile), B-1 (VIEW-002 box 1, the screen chord) and
C-13 box 1 (APP-070, three minutes of a live session with no analytics connection). A-1 now **passes** on
0.1.3 (both halves); it failed on 0.1.2, exactly as the old note predicted. D-1 is still to run.

For Txais. This list holds every check that only a person at a Windows PC can do: the 20 P0 cards that are not yet
passing, and the tasks whose code is done but whose live proof is still pending. Each item says what to set up, what
to press, what should happen, and what counts as a fail. Tick the box when you have run it and write what you saw on
the Result line, even if it was a pass. "Skip" is a fine answer: write why.

Where the sources do not say clearly how to run something, the item says **Unclear** and names the source, instead
of guessing. Items marked **Needs** call for something you may not have; skip them if you don't.

How the list was made: the plan checker's output (kept in evidence/live-proofs-list.txt), the card text in the
spec, the PLAN.md line, and the evidence file for each item.

## Before you start

Have these ready:

- [ ] The Windows PC, with about 5 hours. Split it into two sittings if you like: stop after Part B.
- [ ] The newest Kolux RS installer, and the one before it, both from the Releases page of TxaisX/kolux-rs on
      GitHub (Part D installs the older one twice).
- [ ] Claude Code installed and signed in (your test account is fine).
- [ ] Optional, for the Codex and Gemini items: Codex CLI and Gemini CLI installed and signed in. Codex needs an
      OpenAI sign-in (it may need a paid plan). Gemini CLI needs a Google sign-in.
- [ ] A small test project folder that is a Git repository and holds nothing you care about.
- [ ] A screen recorder that can record at 60 frames a second, and a video player that can step one frame at a
      time (for item C-10). Windows Game Bar can record at 60 fps if you set that in Settings > Gaming > Captures.
- [ ] Optional: a network monitor that lists every connection a program makes (Windows Resource Monitor, on its
      Network tab, does this).
- [ ] Optional: WSL with an Ubuntu distribution installed (for item B-8).

31 items to run, plus 12 listed at the end that cannot be run now. Total time: about 5 hours, including up to an
hour of waiting for updates to download in Part D.

Some items cannot be run now. They are listed at the end, under "Not runnable yet", so you can see why.

---

## Part A: a fresh install (about 45 minutes)

### A-1 · T-594 · Installing puts the kolux command on your PATH
**Install anyway; tick A-1 only after the cli-path fix lands.** On the first run (2026-10-31) your PATH was 1,815
characters long, and kolux was not on the saved PATH outside Kolux. Do the steps and write what you see, but leave the
box empty until the integrator says the fix is in and a re-run passes.

- [x] Run — **PASS on 0.1.3** (2026-10-31): the installer left the 1,815-character Path alone, the app added
      `<install>\bin` once at its next start, every earlier entry survived, a new terminal resolved `kolux` to
      0.1.3, and a second install over the top did not double the entry. Evidence: `evidence/live-A-1-T-594.txt`.
- Set up: no Kolux RS installed.
- Press: run the newest installer. When it ends, open a new Windows Terminal or PowerShell window (not one that was
  already open) and type `kolux --version`.
- Should happen: the installer's details say it added Kolux's folder to your PATH. `kolux --version` prints the
  Kolux RS version. In Start > "Edit environment variables for your account", the Path entry for your account shows
  the Kolux RS bin folder once, and every entry you had before is still there.
- Then: run the same installer again over the top. The bin folder is still listed only once.
- Fail if: `kolux` is not found in a new terminal; the bin folder is listed twice; any of your old Path entries is
  missing or changed.
- Result: ______________________________________________

### A-2 · T-608 · First launch asks one line of consent for status hooks
- [ ] Run
- Set up: the fresh install from A-1 (a profile that has never run Kolux RS).
- Press: start Kolux RS. Go through the first-run screens. On the Connect screen, look for the line "Kolux will add
  its status hooks to each AI's settings, so it can show you which one needs you." with a switch beside it. Leave
  the switch on and press Continue.
- Should happen: the line is there and the switch starts on. After Continue, Claude's own settings file gains
  Kolux's hook entries (you do not need to open it; status working in Part C proves it).
- Fail if: no consent line; the switch starts off; Kolux status never shows for Claude later in Part C.
- Optional second half: on a profile whose switch was turned off, Claude's settings file must stay exactly as it
  was. This needs a second fresh profile; skip it if you have none.
- Result: ______________________________________________

### A-3 · T-612 · The first-run wizard always finishes
- [ ] Run
- Set up: still on the first-run screens (or a fresh profile).
- Press: Continue on the "Your work" screen, then "Open a session".
- Should happen: with no project yet, "Add Project" opens and asks for a folder. Pick your test project. Claude
  starts in that folder.
- Fail if: the wizard gets stuck; "Open a session" does nothing; Claude starts somewhere else.
- Result: ______________________________________________

### A-4 · STAT-008 box 1 · Codex never asks you to trust Kolux's hooks
**Needs** Codex CLI installed and signed in. Do this soon after the fresh install, before anything else changes
Codex's settings.

- [ ] Run
- Set up: the fresh profile, your test project open.
- Press: start a Codex session in a pane, then send it a short prompt (for example "say hello").
- Should happen: Codex never asks whether to trust Kolux's hooks. The pane's status changes on that first prompt
  (to working, then done).
- Fail if: Codex shows a hook-trust question; the status does not move on the first prompt.
- Result: ______________________________________________

### A-5 · STAT-001 box 3 · Codex and Gemini report status with no setup
**Needs** Codex CLI and Gemini CLI, each signed in. Do it straight after A-4.

- [ ] Run
- Set up: the fresh profile; you have set nothing up for either tool by hand.
- Press: in one pane start Codex and send a prompt; make it ask permission for something (for example ask it to
  create a file). Repeat in another pane with Gemini CLI.
- Should happen: each pane shows working within about a second of sending, done once the reply ends, and needs you
  when the agent asks permission.
- Fail if: either agent's pane stays on one status, or you had to set anything up first.
- Result (Codex): ______________________ Result (Gemini): ______________________

---

## Part B: one workspace, no agent needed (about 80 minutes)

Have your test project open in Kolux RS. Only B-9 uses an agent (one Claude pane).

### B-1 · VIEW-002 box 1 · Ctrl+Alt+V cycles all four screens
- [ ] Run
- Set up: the new look (top bar showing), on the Agents screen.
- Press: Ctrl+Alt+V four times, looking after each press.
- Should happen: Board, then Terminals, then Tower, then back to Agents.
- Fail if: any step is skipped, out of order, or nothing happens.
- Result: ______________________________________________

### B-2 · T-610 · Every screen can be reached from the palette
- [ ] Run
- Press: open the palette with Ctrl+Shift+J. Type and pick each of these in turn: "Show Floor", "Show Space",
  "Show Workspace Statuses", "Show Artifacts", "Show Skills".
- Should happen: each one opens its own page.
- Fail if: any is missing from the palette or opens nothing.
- Result: ______________________________________________

### B-3 · T-611 · The palette's Commands section runs actions
- [ ] Run
- Press, in the palette (Ctrl+Shift+J):
  1. Type "floor", pick Commands: Show Floor → the Floor page opens.
  2. "Show Checks" → the Checks tab opens.
  3. "Rename worktree" → the sidebar's rename field appears on the workspace in front.
  4. Collapse the sidebar, go to the Board, run "Rename worktree" again → the sidebar opens and shows the rename
     field. Press Escape. Switch workspace and open the sidebar → no rename field appears by itself.
  5. Turn "Terminal first" on, click into a terminal, then run "Show Inbox" from the palette → the Inbox opens.
- Fail if: any step does nothing, or a rename field appears on its own in step 4.
- Result: ______________________________________________

### B-4 · T-565 · Escape closes only the box in front
- [ ] Run
- Press: click into a terminal, press Ctrl+, to open Settings, press Escape.
- Should happen: Settings closes, the terminal has the keyboard again, and nothing is typed into the terminal. No
  focus ring shows around the Settings page.
- Then: open Settings > Usage > Share, press Escape → only the Share card closes. Open Settings > General > Send
  feedback, press Escape → only the feedback box closes; a second Escape closes Settings.
- Fail if: Escape closes too much or too little, or the terminal receives the key.
- Result: ______________________________________________

### B-5 · CLI-011 box 2 · kolux open brings a minimised Kolux to the front
- [ ] Run
- Set up: Kolux RS running, then minimise it.
- Press: in an ordinary terminal outside Kolux, type `kolux open`.
- Should happen: the Kolux RS window comes back to the front.
- Fail if: the window stays minimised, or a second copy of Kolux starts.
- Result: ______________________________________________

### B-6 · T-586 · Links after Chinese text and emoji click in the right place
- [ ] Run
- Set up: a terminal pane. Print a line holding a Chinese sentence and a check-mark emoji followed by a web address;
  do the same with a file path with a line number. (Copy any Chinese sentence from the web and paste it with an
  address after it, for example by echoing it.)
- Press: hover over the address, then Ctrl+click it. Make the window narrow so an address after Chinese text wraps
  onto two lines, and Ctrl+click it.
- Should happen: the underline sits exactly under the address; Ctrl+click opens the whole address, even when it
  wraps.
- Fail if: the underline is shifted, the click opens nothing, or a wrapped address opens cut in half.
- Result: ______________________________________________

### B-7 · BROW-008 box 2 · A broken certificate gets its own message
- [ ] Run
- Press: in a Kolux browser tab, open a public site with a broken certificate. One public test site for this is
  expired.badssl.com.
- Should happen: an overlay explains it is a certificate problem, offers Retry, and gives **no** advice about
  starting a local server.
- Fail if: the page loads anyway, the overlay talks about a local server, or there is no overlay.
- Result: ______________________________________________

### B-8 · EDIT-044 · A project inside WSL works like a local one
**Needs** WSL with an Ubuntu distribution. Skip if you don't have it.

- [ ] Run
- Set up: in File Explorer, find your Ubuntu home folder under the network place "wsl.localhost".
- Press: add a project from that folder. Open a file, edit it, save it. Search for a word in it. Then delete a file
  from the project.
- Should happen: the explorer lists the files; the save sticks; search finds the word. The deleted file is gone for
  good and does **not** show up in the Windows Recycle Bin (Kolux should warn you it is permanent).
- Fail if: files don't list, the save fails, search finds nothing, or the deleted file is in the Recycle Bin.
- Result: ______________________________________________

### B-9 · APP-052, T-566, T-612 · Three relaunches: terminals, restored chips and the Tip card
This needs the installed build (not a test copy). About 25 minutes. One set of three relaunches covers three
checks; on each launch, look at the panes **before** you press any key or click anything.

Already done for APP-052: both of its boxes (the marker after three relaunches, and the kill of the terminal
service) passed on the installed build on 2026-10-28, run by `node scripts/prove/live-T-544.mjs`
(evidence/T-544.txt lines 30-79), and are ticked in the spec. The two APP-052 items below are only for a repeat on a
newer release; the T-566 and T-612 items still need this run.

- Set up: a plain terminal pane where you type a word you will recognise (for example `echo MARKER-ONE`), one or two
  other panes with some output, and one Claude pane (Claude signed in).
- Press: quit Kolux, start it again. Do this three times. Tip cards appear on early launches; make sure a Tip is
  showing on at least one of them (relaunch again if none shows).

- [ ] APP-052 box 1: the marker survives
- Should happen: after every launch, MARKER-ONE is still visible in that pane.
- Fail if: the marker is gone after any launch, or the pane comes back empty.
- Result: ______________________________________________

- [ ] T-566: every restored pane shows its chip
- Should happen: every pane that came back shows its "restored" chip, on every launch.
- Fail if: any restored pane, on any launch, has its output back but no chip.
- The other half (each pane's key matching the saved layout) cannot be seen by hand; it waits for the prover fix in
  STATE.md.
- Result: ______________________________________________

- [ ] T-612: Escape and the Tip card (on a launch where a Tip shows)
- Press: open the palette (Ctrl+Shift+J), then press Escape. Should happen: both the palette and the Tip close.
- Press: on a later launch with a Tip showing, ask the Claude pane for something, click into it while it is working,
  and press Escape. Should happen: the Tip closes and Claude is interrupted as usual.
- Fail if: the palette or the Tip stays open; the Tip stays open after the Escape in the Claude pane; Claude is not
  interrupted.
- Result: ______________________________________________

- [ ] Box 2: kill the terminal service
- Set up: type `echo MARKER-TWO` in the pane.
- Press: open Task Manager, Details tab. Right-click a column heading, choose "Select columns", tick "Command line".
  Find the kolux-rs.exe whose command line holds "--terminal-service" and End task on it. Then quit Kolux and start
  it again.
- Should happen: the pane comes back showing its saved history (MARKER-TWO), with a new shell below it.
- Fail if: the history is lost, or typing goes into the wrong pane afterwards.
- Result: ______________________________________________

---

## Part C: with an agent running (about 85 minutes)

Claude Code signed in, your test project open. Start the network monitor now if you have one: it is for C-13.

### C-1 · TERM-030 box 2 · Ctrl+J jumps to the session that needs you
The Mac half (Cmd+Shift+J) **needs** a Mac; skip that half.

- [ ] Run
- Set up: two Claude panes, each waiting on you (ask each to do something that needs your permission). Click into
  a third pane.
- Press: Ctrl+J, then Ctrl+J again.
- Should happen: focus jumps to the first waiting pane, then the second.
- Fail if: focus does not move, or lands on a pane that is not waiting.
- Result: ______________________________________________

### C-2 · T-608 · A Claude started by hand shows "Needs you" everywhere
- [ ] Run
- Set up: open a plain terminal pane (not a Claude launch). Type `claude` and press Enter.
- Press: ask it to do something that needs a permission.
- Should happen: "Needs you" shows on the Board, the Tower, the Inbox, the needs strip, the bell and the sidebar row,
  all at once. Then quit Claude: back at the prompt, it is on none of them.
- Fail if: any of those places misses it, or it stays there after Claude has quit.
- Result: ______________________________________________

### C-3 · T-609 · "Review changes" from a finished agent
- [ ] Run
- Set up: ask Claude to make a small change to a file, and let it finish.
- Press: on the Board, find its card under Done and press "Review changes". Then do the same from the Inbox's
  "Done today" row.
- Should happen: the Terminals screen opens on that workspace with its All Changes tab in front, both times.
- Fail if: the button is missing, or it opens the wrong workspace or tab.
- Result: ______________________________________________

### C-4 · SESS-025 box 1 · Agents side by side keep a handoff note
- [ ] Run
- Set up: your test project.
- Press: launch the Pair shape with a short task (for example "add a line to the README").
- Should happen: before either agent edits any file, each one fills in its own handoff note. The notes are in your
  project folder, in the hidden folder .kolux, then handoffs (you must turn on "Hidden items" in File Explorer's View
  menu to see it). The prompt Kolux shows you holds a short role brief and the task, with no rules block.
- **Unclear:** the card does not say exactly where Kolux shows the prompt back to you. Look at the pane and its Board
  card.
- Fail if: an agent edits a file before its note has any content; the prompt shown to you holds a rules block.
- Result: ______________________________________________

### C-5 · T-604 · A hidden force-push still asks you first
- [ ] Run
- Set up: a Claude pane in a throwaway Git repository with **no remote**, so nothing could be pushed even by mistake.
- Press: ask Claude to run, as one command, a comment line followed by a force-push to main (for example a line
  "# Let's publish the fix" and then "git push --force origin main" on the next line). Press **Deny** when asked.
- Should happen: Kolux shows its "Force-push to main" ask before anything runs.
- Fail if: the command runs without the ask.
- The second half (a 1 MB command still gets the ask) is **unclear** for a manual run: the evidence does not say how
  to make one by hand. Skip it.
- Result: ______________________________________________

### C-6 · T-585 · Stopping a sub-agent does not leave the pane "working"
- [ ] Run
- Press: ask Claude for a task that starts a sub-agent. While the sub-agent runs, press Esc. Then send a new prompt
  and let it finish.
- Should happen: the pane ends on Done.
- Fail if: the pane stays on Working after the reply ends.
- Result: ______________________________________________

### C-7 · T-618 · A new tab never picks up a closed tab's status
- [ ] Run
- Press: open a Claude tab, let it ask you a question, then close that tab. Open a few other tabs. Quit Kolux and
  start it again. Open new tabs until one gets the closed tab's number.
- Should happen: that new tab shows no status, and it is not listed under "Sessions that need you".
- Fail if: it shows the old tab's "needs you" status.
- Result: ______________________________________________

### C-8 · T-584 · Hooks install when Claude's settings hold an empty Stop list
Optional: this means editing a file by hand.

- [ ] Run
- Set up: quit Kolux. Open the file settings.json in the .claude folder of your user folder, in Notepad. Inside its
  "hooks" section, add an empty "Stop" list. If you are not sure how, skip this item.
- Press: start Kolux and switch status hooks on (if they are already on, turn them off and on in Settings).
- Should happen: hooks install without an error, and Claude panes show status as before.
- Fail if: an error appears, or Claude status stops working.
- Result: ______________________________________________

### C-9 · T-605 · Opening prompts never pass through the old Windows command shell
**Needs** Gemini CLI installed by Kolux, and a GitHub repository where you can open an issue.

- [ ] Run
- Set up: open an issue whose title contains `" & calc` (a double quote, a space, an ampersand, then the word calc).
- Press: start Gemini from that issue in Kolux, with a prompt of several lines.
- Should happen: no Calculator window opens, and Gemini shows every line of the prompt. In Task Manager the pane's
  program is node.exe. Repeat with a user folder whose name holds a space if you have one.
- Fail if: Calculator opens, or any line of the prompt is missing.
- Result: ______________________________________________

### C-10 · SET-004 box 1 · No wrong-theme flash at startup
**Needs** a 60 fps screen recorder and a player that steps frame by frame.

- [ ] Run
- Set up: in Settings > Appearance, choose Dark, the Cobalt theme and an app font that is not the default (for
  example Georgia). Quit Kolux.
- Press: start recording at 60 fps, start Kolux, stop recording once it has loaded.
- Should happen: stepping through frame by frame, the very first Kolux frame is already dark Cobalt in your font. No
  light frame, and nothing changes once loading finishes.
- Note from the card: the bare window background before the interface loads follows Windows' own light or dark
  setting. That is a known gap, not a fail.
- Fail if: any light frame, or the font or colours change after the interface appears.
- Result: ______________________________________________

### C-11 · T-606 · AI commit messages ignore the project's own Claude settings
**Unclear for a manual run.** The steps need a project whose Claude settings run a hook that writes a marker file
and start a test server (evidence/T-606.txt). That setup has to be prepared by an engineer. The second half
**needs** GitHub Copilot installed through npm (a paid GitHub plan).

- [ ] Run (once the setup is prepared)
- Press: in Source Control, click "write commit message" with Claude as the writer.
- Should happen: the message is written; no marker file appears; no server starts. With Copilot as the writer, the
  message is written (before the fix it failed with "batch file arguments are invalid").
- Fail if: no message, a marker file appears, or Copilot fails with that error.
- Result: ______________________________________________

### C-12 · T-607 · A web page cannot frame Kolux's own screen
**Unclear for a manual run.** The steps need a local test page that frames Kolux's own address and a public page
side by side, and a developer tool to look inside the frame (evidence/T-607.txt). An engineer has to prepare the
page.

- [ ] Run (once the page is prepared)
- Press: open the test page in a Kolux browser tab; then open it again from a sign-in pop-up.
- Should happen: the frame of Kolux's own address stays empty; the public page's frame (example.com) shows.
- Fail if: the Kolux frame shows any part of Kolux.
- Result: ______________________________________________

### C-13 · APP-070 boxes 1 and 2 · Kolux sends nothing about your work
**Needs** a network monitor (box 1) and a tool that can read the contents of encrypted requests (box 2).

- [ ] Box 1: watch the session
- Press: after the agent items above, look at the monitor's list for both kolux-rs.exe and msedgewebview2.exe
  (not the agent programs, which talk to their own companies).
- Should happen: every connection goes to one of the destinations listed in Settings > General > Privacy. None goes
  to an analytics or telemetry host.
- Fail if: any destination is not on that list.
- Result: ______________________________________________

- [ ] Box 2: a unique marker leaves nothing behind
- Press: type a made-up word (for example ZEBRA-4471) in a terminal and in the editor.
- Should happen: the word appears in no outgoing request.
- **Unclear for a manual run:** reading the contents of requests needs a traffic-inspection tool and know-how; the
  evidence (evidence/cards-APP-070.txt) gives no steps. Ask for help or skip.
- Result: ______________________________________________

---

## Part D: uninstall, update and restart (about 90 minutes, mostly waiting)

### D-1 · T-594 (uninstall half) · Uninstalling takes kolux off your PATH
**Run it anyway; tick D-1 only after the cli-path fix lands**, together with A-1.

- [ ] Run
- Press: uninstall Kolux RS from Windows Settings > Apps. Open a new terminal and type `kolux --version`.
- Should happen: the Kolux RS bin folder is gone from your account's Path; every other entry is still there, in the
  same order; `kolux` is no longer found.
- Fail if: the entry is still there, or any other entry was changed or removed.
- Result: ______________________________________________

### D-2 · APP-025 box 2 · A downloaded update installs on a plain quit
- [ ] Run
- Set up: uninstall Kolux RS first if you skipped D-1. Install the release **before** the newest one. Start it and check Help > About Kolux RS shows that older
  version. Open your test project with a couple of panes arranged the way you like (D-3 uses this).
- Press: keep working until the small pop-up in the bottom-left corner says "Kolux RS (version) is ready", with
  "Restart to update". It can take up to 30 minutes. Do **not** click it. Quit Kolux the ordinary way. Start it again.
- Should happen: Help > About Kolux RS now shows the newer version.
- Fail if: the pop-up never appears; Kolux restarts by itself before you quit; after the quit and relaunch the old
  version still runs.
- Result: ______________________________________________

### D-3 · APP-048 box 2 · Your layout and sessions survive the update
- [ ] Run (straight after D-2)
- Should happen: the same projects, layout, sessions and settings as before the update.
- "Previous release" here means the last Kolux RS release.
- Fail if: anything you set up before D-2 is gone or moved.
- Carrying an old Kolux 0.15.0 profile across is a separate decision (evidence/cards-APP-048.txt), not part of this
  check.
- Result: ______________________________________________

---

### D-4 · T-592 · "Restart to update" brings Kolux back on the new version
- [ ] Run
- Set up: this needs a newer release than the one installed. Uninstall Kolux RS, install the release before the
  newest one again, start it, and check Help > About Kolux RS shows the older version.
- Press: wait for the bottom-left pop-up "Kolux RS (version) is ready" (up to 30 minutes), then click "Restart to
  update".
- Should happen: Kolux closes, the update installs, and Kolux comes back by itself. Help > About Kolux RS shows the
  newer version.
- Fail if: Kolux closes and stays closed, or comes back on the old version.
- Result: ______________________________________________

---

## Not runnable yet

These are still open but cannot be run now. They are listed so nothing is forgotten.

- **APP-059 box 1** (every ship to main publishes a release) and **APP-060 box 1** (tests run in four parts on every
  push). Not applicable: releases ship from your PC (DT-R40); GitHub CI is not used (your decision of 2026-10-31,
  because checks run before code reaches the repo).
- **CLI-007 box 2** (inside a Kolux pane, kolux is Kolux RS's own copy even with an older kolux registered). It needs
  an older kolux registered for the whole machine, and the old Kolux has been removed.
- **T-592, the safe-graphics restarts** (Restart in safe graphics, and trying hardware graphics again, each bring
  Kolux back). Those choices only appear after graphics crashes, so they cannot be reached on purpose.

- **TERM-068 box 2** (switching panes while the clipboard is being read cancels the paste). **Unclear:** the
  clipboard read is too quick to switch panes during it by hand, and evidence/cards-TERM-068.txt says the Edit-menu
  paste has no such check yet, so it would fail today.
- **SAFE-004 box 3** (feedback still arrives after about 3 seconds when a pane's status never updates). **Unclear:**
  there is no way to freeze a pane's status by hand; evidence/cards-SAFE-004.txt gives no steps.
- **USAGE-021 box 3** (Kolux waits when the usage service says slow down). Kolux asks no usage service at all today
  (DT-C14), so there is nothing to slow down. This waits on T-547.
- **EDIT-053 box 2** (an extensionless program on Linux is shown, not run). **Needs** a Linux computer.
- **TERM-030 box 2, Mac half** (Cmd+Shift+J). **Needs** a Mac.
- **T-597** (a slow start never wipes the saved tabs). It needs a test copy of Kolux built to start slowly on
  purpose (evidence/T-597.txt); it cannot be done on the installed app.
- **T-583** (an automation with a slow pre-check while a protected command in another pane still asks). **Unclear:**
  the sources give no way to make a pre-check slow by hand.
- **T-594 step 5** (installing when your Windows environment settings have a blank default value). It needs the
  Registry Editor. Leave it to the integrator.

## Not in this list

PLAN.md also marks 234 older tasks "live proof pending (batched)". Those were ticked done in earlier cycles,
and their live checks were batched. They are not in this run list; ask if you want them added.
