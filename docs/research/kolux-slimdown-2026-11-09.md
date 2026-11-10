# Kolux slimdown, 2026-11-09

Goal (Txais): make Kolux much lighter on RAM, CPU and GPU without losing quality or speed.

## Outcome

| What you do | Before | After |
|---|---|---|
| Minimise Kolux with 12 terminals open | 544 MB in use, 13 % of a core | 226 MB, 5 % |
| Leave 12 terminals idle on screen | 14 % of a core | 7.5 % |
| 12 terminals + 3 browser tabs in the background (window on screen) | about 700 MB in use, 14 to 18 % CPU | about 560 MB, 5 to 8 % |
| First-run wizard or a tour left open | GPU process at 21 % of a core | 0.3 % |
| 1 or 6 idle terminals | 4.3 % / 8.9 % CPU | 3.8 % / 5.4 % |
| 6 terminals streaming output | about 59 to 73 % CPU | 25 % (overnight round 3) |
| Typing in a terminal while 8 others flood output | echo p95 2.7 s | 0.1 s (round 3) |
| An idle Claude Code session in a tab you are not looking at | about 0.9 GB each | 0 while asleep, if Agent sleep is on (round 3, off by default) |

Release builds, median of 3 runs, same machine, before = `70d06457`, after = `fc333a52` (the product code
has not changed since). "In use" is working set: the memory Windows actually keeps in RAM for Kolux.
Private memory (what Kolux has reserved) stayed roughly flat; the savings come from Kolux handing pages back
while out of sight and from cutting idle work.

### Where the 3.85 GB goes (measured on the owner's PC, 2026-11-09 evening)

The installed Kolux and every process it started, read with `Win32_Process`, no process touched:

| Part | Processes | Private MB | In use (WS) MB |
|---|---|---|---|
| Claude Code sessions in Kolux terminals | 3 | 2,761 | 1,170 |
| Kolux web view | 6 | 509 | 337 |
| Kolux window + terminal service | 2 | 172 | 192 |
| Shells (PowerShell, cmd, conhost) | 7 | 131 | 158 |
| **Total** | 18 | **3,574** | 1,858 |

So the 3.85 GB is about 80 % agents: each Claude Code session holds about 0.9 GB of its own, which Kolux does
not control. Kolux's own share is about 0.68 GB reserved and 0.53 GB in use. The remaining large lever
is agent hibernation (TERM-123 / HID-028: put a session idle for 30 minutes to sleep and resume it when
opened), which the spec marks "H: default skip"; reviving it is the owner's call.

## What changed

Round 1 (merged earlier on 2026-11-09):

- **Back end:** one process snapshot per foreground poll, terminal history written outside the registry
  lock, a 1 MB line-log budget, the output pump buffer shrinks when idle, a settings parse cache, and the
  Windows segment heap turned on in the app manifest.
- **Token scan:** reads only new log lines and saves every 5 minutes; the publish watcher checks only busy files.
- **Front end:** scrollback follows the memory profile, title updates are paced, hidden panes give back their
  GPU context, startup loads only the screens it needs, and the cursor stops blinking after 5 s idle.
- **Web view:** the main view is told when it is out of sight, its memory drops to low after a minute hidden,
  background browser tabs sleep after a minute, and terminal output stays fast while minimised.
- **Approved items:** renderer heap ceiling 1.5 / 2 GiB; Mermaid 12 (see the major-upgrades report).

Round 2:

- **Idle pulse rest (DT-C239):** the wizard's "at work" dots and a tour's highlight ring stop pulsing after
  10 s with no input and wake on the next input. Idle GPU process: 20.8 % to 0.3 % of a core (1 pane) and
  22.0 % to 0.07 % (6 panes).
- **Fair benchmark:** S11 now runs release builds, repeats with medians (`--repeat`), compares two runs
  (`--compare`), seeds the first-run wizard closed and checks that it stays closed, measures 70 s minimised
  at 12 panes, and adds a phase with 3 browser tabs in the background on a LAN page (loopback pages are
  exempt from tab sleep, so they would not show it).
- **Benchmark window fix:** once Kolux is minimised, Windows' "main window handle" for the process points
  at tao's hidden event window, so the benchmark's restore never reached the app. The helpers now find the
  visible window titled "Kolux".

Round 3 (overnight, 2026-11-09 to 11-10, each lane reviewed independently before merge):

- **Streaming output (DT-C243):** terminal output crosses to the web view once per 16 ms frame window for
  every pane together, not once per chunk, and a trickle is acknowledged every 250 ms instead of every 50 ms.
  The profile showed the cost was the message traffic (about 120 script calls and 97 acknowledgements a second),
  not Rust or drawing. S11 phase c, release, 3 runs each: 59.4 % to 25.1 % of a core; renderer 21.3 to 9.1 %,
  web view browser 15.2 to 3.9 %. S2 flood: typing echo p95 2,706 ms to 97 ms, 8 floods finish in 110 s
  instead of 415 s. A lone chunk after quiet still goes at once; no wakeups when nothing prints.
- **Agent sleep (TERM-123, HID-028, DT-C242), off by default:** Settings > General > Experimental. A finished
  agent pane that is out of sight, untouched and idle for the chosen delay (30 minutes, 5 to 240) saves its
  session, ends only its own process tree and shows Wake, which resumes that session. It never sleeps a pane
  that is working, waiting on the user, running background tasks, visible, or typed into since its turn
  finished. Two review rounds found and fixed: the opening prompt re-sent on Wake, a failed Wake restarting
  the task, unsent text in the agent's own prompt, and a stale decision; the Rust side re-checks everything.
  The live sleep and wake with a signed-in agent is not yet proven in the running app (no scratch login).
- **Follow-ups:** the items marked [fixed] under Left over.

## Findings

| Finding | Status |
|---|---|
| A fresh profile left the first-run wizard open, and its pulsing dots alone cost 20+ % of a core in the GPU process, skewing every idle number | Fixed: pulse rest in the app, and the benchmark seeds the wizard closed |
| Background browser tabs looked like +31 MB of graphics memory and +49 MB reserved memory | Not a Kolux problem: the benchmark's restore went to the wrong window, so that phase ran minimised. Measured correctly (fixed harness, 2 to 3 runs each), new vs old: graphics +5 to 7 MB, reserved memory +0 to 3 MB, memory in use 140 to 150 MB lower, CPU about half |
| Restoring Kolux from the taskbar after a long minimise | Works: the window comes back visible and memory returns to normal |
| Busy terminals (streaming output) | Unchanged; the cost is the terminal renderer doing real work |

## Left over

Marked [fixed] below: done in the perf-followups lane on 2026-11-09.

- [fixed] `scripts/evidence/app-launch.mjs` used the main window handle when it moved the window and when it sent
  close; same trap as above. Both now find the visible "Tauri Window" titled "Kolux" of the app's pid, with the
  helper shared with `scripts/stress/lib.mjs` (one definition, in `app-launch.mjs`).
- [fixed] Pulse-rest review notes (P3): tests now cover cancel, the 2 s fallback and the hook wiring; the tour ring
  wakes when the tour moves on by itself; no stale resting frame on a new run; the input listeners are passive;
  the comment and DT-C239 wording are tighter.
- [fixed] TourPanel ran an animation-frame loop for as long as a tour was open; it now rests after 30 calm frames
  and wakes on resize, scroll, layout changes, transitions and input (`src/onboarding/followLoop.ts`).
- Optional: about 3 % of a core in the GPU process was seen once while minimised right after opening tabs.
  Not reproduced under the fixed benchmark; card it only if it shows up again.
- GitHub reports one moderate Dependabot alert: the Linux-only glib crate, which cannot move until the
  Tauri GTK stack does.
- [fixed] From the round 1 token-scan review (P3, plausible): the stored Codex usage keys hashed a JSON value's
  printed form, whose key order depends on serde_json's `preserve_order` feature. The key now writes the running
  total in Codex's own field order (unknown fields after, by name), so it no longer depends on the feature and
  equals the stored keys for real Codex logs; a test pins one key.

- [fixed in round 4, DT-C244] Large output floods raised memory: S2 (8 panes x 50 MB) peaks about +3 GB and holds +1.5 GB 10 s
  later (before round 3: +4.2 / +2.4 GB; it was already failing on 2026-10-25). The scrollback and history path
  is the next lever.
- Agent sleep: prove the live sleep and wake with a signed-in agent (a dev build has a 20-second test delay).

## Round 4: output floods (DT-C244)

S2 (eight panes x 50 MB) failed on memory: about +2.3 to +2.9 GB at the peak and +1.4 GB ten seconds later. Measured per process, only the web view renderer grew, and inside it the page's JS heap climbed at the rate of the base64 output (about 12 MB a second, to 1.4 GB) and was freed only by a forced full collection. Every Tauri event runs in the page as a new script with the batch written into it as text, and the web view kept those strings. Output now reaches each page through one IPC channel that every reader of the page shares; a large batch arrives as a fetched response the page parses, and the event is used only while no page has subscribed. S2 (release) now passes: peak +573 MB (bar 1024), ten seconds after +96 MB (bar 512), renderer peak 719 MB instead of 2451 MB, JS heap peak 176 MB instead of 1414 MB, typing latency under the flood p95 168 ms (bar 250), all eight floods finish in 106 s and show their last line. A review then moved each terminal's end note onto the same channel after its last output (a large last batch is fetched, so an exit sent as an event could overtake it), dropped closed web views' channels by label, and serialized each message once; S2 on that code: peak +497 MB, ten seconds after +97 MB, renderer peak 666 MB, JS heap peak 219 MB, echo p95 168 ms, floods 104 s, 8 of 8 last lines. Evidence: `evidence/stress-s2-b687223d.txt` (final), `evidence/stress-s2-4e1ba06d.txt` (first fix); the before figures are in DT-C244.

## Round 5: garbage under an output flood (DT-C245)

With Round 4's memory fixed, the page's main thread is still about 95% busy for the whole S2 flood and makes about 1.7 GB of short-lived objects every 20 s. S2 now measures this itself (main-thread task, script, layout and style time; a 20 s allocation sample by function). The panes in S2 draw with the DOM renderer only because the harness turns GPU drawing off so it can read pane text back; with `S2_GPU=1` all nine panes draw with WebGL, as a user's do, and the churn is about the same (1.8 GB per 20 s). Three app-side sources were cut: each output chunk is decoded once for every reader of the page instead of once per reader, with the engine's own base64 decode; the ports item turns a chunk into text only when it holds a `:`; and xterm's whole-screen selection redraw on every scroll runs only while something is selected. Result (S2 release, DOM panes, before -> after): allocations 1682 -> 1568 MB per 20 s (about -7%), typing latency under the flood p95 160 -> 162 ms (max 265 -> 190), floods 108 -> 100 s, renderer peak 809 -> 745 MB, page busy 95% -> 96%. That is under the 20% bar, so the round stopped there: most of the churn is inside xterm itself (building DOM rows or resolving WebGL cell colours, viewport sync, copying buffer lines) and in the per-chunk base64 text. The remaining lever is to send output as raw bytes instead of base64 text in JSON, a change to the Rust side of the output channel. Evidence: `evidence/stress-s2-flood-churn-3f076954.txt`.

## Round 6: raw bytes on the output channel (DT-C246)

Round 5 left one lever: the output itself crossed to the page as base64 text inside JSON, which the page parsed and decoded for every batch. Now the window process frames each batch as plain bytes (a small header per chunk: terminal id, pane key, generation, seq, length) and sends it as a raw channel body; the page gets one ArrayBuffer per batch and each chunk's bytes are a view over it, shared by every reader. The end note stays a JSON message on the same channel, which keeps its place after the last output because Tauri numbers a channel's messages; the event fallback (no page subscribed yet) still carries base64, and every reader handles both shapes. Measured against main on the same PC, back to back (S2 release, DOM panes, before -> after): typing latency under the flood p95 182 -> 132 ms, floods 100 -> 92 s, app peak +485 -> +339 MB, ten seconds after +118 -> +80 MB, renderer peak 648/599 -> 501/451 MB, page JS heap peak 248 -> 124 MB, 8 of 8 END lines, 0 errors. What did not move: allocations per 20 s (1494 -> 1577 MB; about -4% per MB of output, since the flood ran faster) and main-thread busy time (96 -> 94%). The JSON parse and base64 decode left the top allocation sites, but the frame decoder's one object and one byte view per chunk took part of their place, and the rest of the churn is xterm's row building, scroll and viewport sync. That is under the round's 15% stop rule, so the round ends with the memory and latency gains and this evidence. An independent review then found two holes, both fixed before the merge: the page read a raw body only as an ArrayBuffer, but once Tauri has fallen back to postMessage (it does after one failed fetch, for the page's life) a raw body arrives as a plain array of numbers, so every frame of 1 KB or more would have been dropped in silence; now a number array and a view are read too. And a chunk's bytes being a view over its batch means that whoever holds the chunk holds the whole batch: a hidden pane trickling small chunks while another pane floods could pin hundreds of 192 KB buffers, as could the startup gate that holds output until the first prompt. Those two now keep a copy of a small chunk (less than a quarter of its buffer); a shown pane's chunks stay views, since it draws them within a frame, and a first cut that copied every small chunk showed why: 88 MB per 20 s of copies in the profile, one copy of about every byte of the flood, for no memory gain. Three small things went with it: a frame with bytes left after its last chunk is refused like a short one, the frame is built only when a reader is there to take it, and two dead base64 helpers are gone. Re-measured with the fixes (same S2): echo p95 145 ms (p50 100), floods 90 s, app peak +329 MB, ten seconds after +76 MB, renderer peak 498/450 MB, allocations 1590 MB per 20 s, 96% busy, 8 of 8, 0 errors: the same picture as before the fixes, within run-to-run noise. Evidence: `evidence/stress-s2-raw-out-8ba349e5.txt` (three runs: main, lane, lane with the fixes).

## Round 7: final footprint and agent-sleep proof

Two things were never measured on the merged code: the whole app's footprint, and agent sleep working live. Both are now measured on release builds of the code before the slimdown (70d06457) and the final main (92185e2e), back to back on the same PC, each scenario three fresh launches with the median reported.

**Window and web view (S11, before -> final, working set / private MB).** Idle with one shell: 451 / 252 -> 449 / 254. Six idle shells: 473 / 275 -> 469 / 273. Six panes printing about 20 lines a second: 534 / 329 -> 519 / 311, and the app's CPU 59 -> 28% of one core. Twelve panes, window minimised: 543 / 336 -> 237 / 314. Twelve idle panes: 535 / 331 -> 534 / 332. Twelve panes plus three browser tabs hidden behind a terminal tab: 730 / 405 -> 383 / 404. The gains are in working set (memory Windows keeps resident for the app): the app now gives memory back when it is minimised or a browser tab is hidden. Private bytes (memory the app has committed) barely move in these light scenarios: rounds 4 to 6 cut the memory that output floods build up (S2), and an ordinary day has no flood.

**Everyday, shells included (new S12).** Six PowerShell panes, each printing one short line every 2 s, three hidden browser tabs, the window on screen, then minimised for 2 minutes. "Kolux total" counts the app plus the shells and their console hosts. It leaves out what runs inside the panes (here six small node tickers, about 271 / 120 MB). Window shown: 1167 / 705 -> 1164 / 702 MB, of which app 679 / 366 -> 677 / 364, shells 440 / 329 (about 73 / 55 MB per PowerShell), console hosts 48 / 8. Minimised: 1179 / 713 -> 1008 / 699 MB, the drop being the renderer's working set (325 -> 153 MB). Per role, shown: window 44 / 17 -> 43 / 14, web view browser 146 / 56 -> 147 / 57, renderers 316 / 162 -> 313 / 159, GPU 96 / 107 -> 98 / 111, utility 63 / 21 -> 63 / 21. So on a normal day Kolux's own cost is about 1.0 to 1.2 GB working set and 0.7 GB private for six terminals, and PowerShell is about 40% of the working set and almost half the private bytes. Agent CLIs running inside the panes come on top of that and are not counted here; how much of the 3.85 GB first observed they were is not measured. The page reported visibilityState "visible" while minimised in both builds; the renderer still trimmed its working set.

**Agent sleep, live (new S13, release build, sleep on at 5 minutes).** Claude Code was replaced by a stand-in (`scripts/prove/agent-sleep-standin.cjs`): a node script started through the Claude command setting that holds 600 MB, runs every hook Kolux installed (SessionStart, UserPromptSubmit, then Stop, or PreToolUse for a turn that never ends) and prints its session id. It uses no network and no account. Four stand-in panes were folded into one cell with Move to Tab: A (finished, behind a tab, untouched), D (finished, then text typed without Enter), B (busy: a tool still running), and V (finished, the tab in front). A slept 6.1 minutes after its turn finished (5-minute delay, 60-second check): the placeholder showed, its process was gone, and the app's process tree fell from 3218 / 2853 MB to 2567 / 2214 MB, 639 MB of private bytes for A's 622. Wake started it again as `claude ... --resume <A's own session id>`; Kolux heard the resume hook, and the process held its 647 MB again. V, D and B stayed awake through 8 minutes. All 12 hook runs exited 0.

Three findings came out of it:
- **Move to Tab restarts the agent.** Moving a Claude pane into another cell (and dragging its tab there) ended the agent and started a fresh session without `--resume`, though the pane menu says the program keeps running. With real Claude Code that drops the conversation from the pane. All 4 panes restarted, in each of 4 runs.
- **Leaving a finished agent's tab can stop it from ever sleeping.** Kolux counts every write to a pane's terminal as typing (TERM-123). That likely includes the focus-in and focus-out reports xterm sends when the focus moves, because ConPTY turns focus reporting on at start. In a run where A finished before the harness's last tab switch, A never slept, and the sleep check refused with "the pane was typed into after the agent finished", though nothing was typed into A (`evidence/stress-s13-92185e2e-early-finish.txt`). With A finishing after the last click, it slept. So agent sleep currently works for an agent that finishes while you are elsewhere, and not for one you watched finish and then switched away from. The exact bytes are not yet isolated; the fix would be to not count terminal replies or focus reports as typing.
- **Panes take the user's registry environment.** portable-pty builds each pane's environment from the Windows user and machine environment in the registry, laid over the app's own. A `CLAUDE_CONFIG_DIR` set there therefore wins over the one Kolux was started with, so a scratch run that starts Claude reaches the real config folder. S13 now sets the scratch folder in the Claude env option, and the stand-in refuses any config folder outside its scratch run. Other stress scenarios that start agents need the same.

What the stand-in leaves unproven: that real Claude Code sends the same hooks in the same order; that `claude --resume <id>` restores a real conversation; how much a real idle session holds, and so how much sleep frees; and how the window behaves with real agents' output.

## Round 8: terminal replies are not typing (DT-C247)

Round 7's second finding, isolated and fixed. Kolux kept one "last typed into" time per terminal and set it on every write to the PTY. xterm writes more than the user's keys: when a program turns focus reporting on (ConPTY does so at start), every focus change sends a focus-in or focus-out report, and a program's cursor-position, device-attributes, mode and colour queries get their answers the same way. So the click away from a finished agent's pane was "typing after the agent finished", agent sleep refused that pane for good, and its quiet timer restarted at every focus change. Only an agent that finished while the user was elsewhere could sleep.

Bytes alone cannot tell a reply from a key (the cursor-position answer `ESC [ 1;2 R` is Shift+F3), so the pane tells them apart at the source: xterm's core raises its user-input event right before onData for keys, pastes, composed text and mouse reports, and not for its own answers. The pane reads that mark and sends an answer as an automatic write, which reaches the program unchanged but counts as neither typing for sleep nor as "the user typed" for the limit-stop resume and the command line's send. The same bytes reach the program in the same order as before; terminal behaviour (typing, paste, IME, mouse, focus-dependent programs) is untouched. The window's own "unsent draft" rule reads the chat message box, not terminal writes, and was never affected.

**S13, release build, the watched-then-left case (new).** A's turn finishes with its tab in front, the run then switches to D's tab and types a draft there, then to V's tab, and leaves it. On the lane's release build (`evidence/stress-s13-85858f08.txt`, 1489 s) A's turn finished at +935 s with its tab in front and the focus left it 20 s later; A slept 6.4 min after the finish (poll granularity 15 s), its stand-in process was gone, and the app tree fell from 21 processes, 3233 MB working set / 2877 MB private to 18 processes, 2565 / 2213 MB (-664 MB private; A had held 647 / 623 MB). V (finished, in the tab in front), D (finished, then a draft typed without Enter) and B (busy, a tool call running) were still alive 9 min after A finished. Wake started Claude again with `--resume` and A's own session id (resumed true, SessionStart resume hook exit 0), and the woken agent held its memory again. 13 of 14 checks passed; the one failure is the pre-existing TERM-016 check (Move to Tab restarts the agents as fresh sessions), which belongs to the tab-move lane and was failing before this lane. The harness no longer needs its `--late` delay (A and V finishing after the last click), which had hidden the bug.

**Harness safety.** Every stress profile now pins `CLAUDE_CONFIG_DIR` and `CODEX_HOME` in the agent env settings to the run's scratch folders (lib.mjs seedProfile), not only S13, since a pane's environment takes the user's registry values over the app's.
## Round 9: pane moves keep the program (DT-C248)

**Why Move to Tab restarted the agent.** The grid draws one element per cell, keyed by the cell's group, and the panes inside it, keyed by pane. A pane whose group changes (Move to Tab, a tab dragged onto another cell or onto a tab there, a cell folded into another, Split Right / Down on a tab's menu, and dragging the first tab of a strip along its own strip, which renumbers the cell) therefore moves to a different parent element, which React cannot do: it unmounts the pane and mounts a new one with the same key. The unmount reaped the pane's terminal, the mount asked the terminal service for the pane's terminal, found none, and started a fresh one. The service already had what was needed: it keeps each pane's terminal by pane key for a window reload (APP-052) and a transcript of its output on disk (TERM-106), and a reloaded pane replays that transcript and attaches to the running terminal.

**Fix.** Before the window applies a layout that changes a pane's cell, it hands the pane's key over (`src/terminal/handover.ts`). The unmounting pane leaves its terminal running, and the new mount of that key takes the hand-over: it replays the saved output into its new view and attaches to the same terminal, the reload path. The PTY, the process and the agent's session are the same ones, so no `--resume` fallback was needed on any in-window move. A key is handed over only when its cell really changes, and a close takes the mark back, so a closed tab still reaps its terminal. All four layout paths (Move to Tab, tab drops, cell drops, Split out of a tab) use the same two lines.

**Review fixes.** The first cut sent the program no size after the attach (the size observer fired during the replay, while the terminal id was still unknown, and the resize bailed); the new view now sends its size once, when the terminal is bound. A moved shell tab re-armed its startup command (the dev-server tab's command, Open in terminal's `cd` would have run again at the next prompt); a moved pane types none. The mount reported an idle identity for a program still running, which the window read as the prompt coming back and muted the hooks of an agent started by hand in a shell tab; a moved pane now starts from the identity the window last heard, and still reports the real return. A reattach that timed out on a move dropped the tab and orphaned the process; it keeps the tab with Try again, as a restored tab does. The hand-over mark is taken when the new mount binds its terminal, not when it mounts, so the dev double mount and a second move during the first attach pass it on instead of attaching blank or reaping the terminal. Unacknowledged bytes are flushed before the hand-over. And output printed during the move was drawn twice, once as it arrived and again inside the replay: the running terminal now hands the new mount its snapshot (ORCH-057: newest output with the count it covers, through a new `terminal_live_history` command), the mount holds the chunks that arrive while it replays and drops the ones the snapshot already holds by count; the saved history file is used only when no terminal runs for the pane.

**Second review fixes.** Three leaks the first review's fixes left. The count floor a moved pane took from the running terminal's snapshot was the pane's, not the terminal's: a terminal started in the same view afterwards (Restart, Enter after an ended program, a reattach that answered fresh) counts its output from zero, so every chunk it printed was dropped until it had out-printed the old terminal and the shell stayed blank; the floor is now kept per terminal id, which `terminal_live_history` names. A pane moved while its spawn was still on its way (the folder check, the shell search or an account's sign-in before the registry lock can take a while) left two terminals: the new view saw no terminal yet, asked for its own, and the older start's answer came back to a view already gone, which could not kill it without killing a moved pane's terminal too. Every start for a pane key now takes a ticket when it is asked for; the older start is refused at the registry lock, before any process, whatever order the two reach it in, and the newest start ends a terminal an older one left mapped to the key, so one terminal runs per pane and it is the newest view's. The refused start's view is gone, so it fails nothing: a start error for a view already unmounted no longer drops the tab the new view shows. And a tab closed before its moved or restored pane had bound its terminal had no id to kill by, so the terminal ran on; the close now ends what still runs for the key (new `terminal_reap_pane`) from the close itself, because the key leaves the layout there and no later mount can own that terminal, while the unmount cannot tell a close apart from the dev double mount or a second move, whose next mount takes the terminal. Smaller: a pane kept with Try again no longer queues output without limit while it waits.

**Third review fixes.** `Terminals::spawn` took the terminal an older start had left mapped to the pane key out of the registry before it spawned the new process, so a start that failed at the spawn returned with the registry lock held and dropped what it had taken: a PTY closed under the lock (the Row 784 hazard) and a service terminal dropped without being ended, so it leaked. The take now comes once the new session exists, right before it is registered, and the end comes after the lock is let go, so a failed start leaves the older terminal running; a source-order test pins it (spawn needs a running app, so there is no unit test of the path itself). Smaller: a closed pane's start ticket is dropped with its terminal, and Try again fetches the running terminal's snapshot, sets the count floor and redraws it before it binds, so what the terminal printed while the tab waited is shown.

**Measured (new S14, release build, `evidence/stress-s14-85858f08.txt`).** Four stand-in Claude panes and one PowerShell pane, each in a cell of its own, then Move to Tab on two of them, one tab dropped on another cell's tab, one tab dropped on another cell's body, and Move to Tab on the shell: 0 stand-in restarts (S13 on main: 4 of 4 per run), all four stand-in processes alive at the end, every moved pane still showing its session banner in the expected cell, the shell's process unchanged and a command typed into it after the move answered. 7 of 7 checks pass. What S14 does not cover: real Claude Code's redraw after the replay (a stand-in prints and waits), and a move made within the first moments of a pane's start (the terminal is still being started; that pane restarts as before). Still open: a pane asleep, an editor or a browser is handed over like any other key (harmless, nothing takes it, and a close cancels it).

## Evidence

- `evidence/stress-s11-70d06457-release-before.{txt,json}`, `evidence/stress-s11-fc333a52-release-after.{txt,json}`,
  `evidence/stress-s11-release-compare.txt` (the phase f "after" column in that file was measured with the
  broken restore; use the Findings row above for f).
- `evidence/perf-idle/` for the pulse rest.
- `evidence/stress-s11-a6352702-stream-compare.md`, `evidence/stress-s2-*` and `evidence/T-817.txt` for round 3.
- `evidence/stress-s2-flood-churn-3f076954.txt` for round 5.
- `evidence/stress-s2-raw-out-8ba349e5.txt` for round 6 (main and lane, back to back).
- Round 7: `evidence/stress-s11-70d06457-r7-before.{txt,json}`, `evidence/stress-s11-92185e2e-r7-final.{txt,json}`,
  `evidence/stress-s12-70d06457-r7-before.{txt,json}`, `evidence/stress-s12-92185e2e-r7-final.{txt,json}`
  (the before/after compare is at the end of each final file), `evidence/stress-s13-92185e2e.txt` (agent sleep and
  wake) and `evidence/stress-s13-92185e2e-early-finish.txt` (the run where A never slept).
- Round 8: `evidence/stress-s13-85858f08.txt` (the watched-then-left case sleeping and waking on the lane build).
- Round 9: `evidence/stress-s14-85858f08.txt` (pane moves, 0 restarts, first cut) and `evidence/stress-s14-f0d2384e.txt` (same run on the review fixes: 0 restarts, 7 of 7), `evidence/stress-s14-1d837961.txt` (same run after main with DT-C247 was merged in: 0 restarts, 7 of 7), `evidence/stress-s14-73586f78.txt` (same run on the second review's fixes: 0 restarts, 7 of 7).
