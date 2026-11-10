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

## Evidence

- `evidence/stress-s11-70d06457-release-before.{txt,json}`, `evidence/stress-s11-fc333a52-release-after.{txt,json}`,
  `evidence/stress-s11-release-compare.txt` (the phase f "after" column in that file was measured with the
  broken restore; use the Findings row above for f).
- `evidence/perf-idle/` for the pulse rest.
- `evidence/stress-s11-a6352702-stream-compare.md`, `evidence/stress-s2-*` and `evidence/T-817.txt` for round 3.
