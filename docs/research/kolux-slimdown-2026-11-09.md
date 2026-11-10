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
| 6 terminals streaming output | about 73 % CPU | about 75 % (unchanged, within noise) |

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

## Evidence

- `evidence/stress-s11-70d06457-release-before.{txt,json}`, `evidence/stress-s11-fc333a52-release-after.{txt,json}`,
  `evidence/stress-s11-release-compare.txt` (the phase f "after" column in that file was measured with the
  broken restore; use the Findings row above for f).
- `evidence/perf-idle/` for the pulse rest.
