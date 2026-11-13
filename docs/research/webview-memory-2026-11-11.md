# Kolux host memory: the WebView2 tree (2026-11-11)

What Kolux itself holds (kolux.exe plus its msedgewebview2.exe tree), what each lever below saves, and what the
status bar now shows. Agents and pane shells are out of scope: they are the same in Kolux and in Windows Terminal.

## How it was measured

- Scenario `S15` (`node scripts/stress/run.mjs S15 --repeat 2 --tag before|after`), new in this study:
  `scripts/stress/s15-host-memory.mjs`. The debug dev build (`pnpm tauri dev`), a scratch profile and identifier,
  an off-screen window, the shipped default renderer (`terminalGpu: "auto"`, WebGL). Panes run plain PowerShell;
  each prints 1500 truecolour lines with bold, box drawing and agent symbols, so the glyph atlas and scrollback are
  not empty.
- Private bytes per process (`PrivateMemorySize64`), walking `Win32_Process.ParentProcessId` from kolux.exe and
  labelling each web view process by its `--type=` (`scripts/stress/footprint-sample.ps1`, through `footprint()` in
  `scripts/stress/lib.mjs`). 2 s samples over a 30 s window (8 s for the early samples), median of 2 runs.
- Phases: **a** 1 window, 2 panes side by side. **b** 4 panes: a new tab in each cell, so 2 panes sit on hidden
  tabs (early sample 10 s after the hide, main sample 40 s after, past the 30 s GPU give-back). **c** the same 4
  panes, window minimized (early sample 10 s after, main sample 75 s after, past the 60 s memory-LOW point).
- Evidence: `evidence/stress-s15-53a9beb2-before.{txt,json}`, `evidence/stress-s15-53a9beb2-after.{txt,json}`.
  "Before" is HEAD 53a9beb2 unchanged. "After" is HEAD plus the trial below (minimized-window parking) and the new
  status-bar figure. The parking trial was then reverted, so the shipped "after" equals "before" in memory.

Dev-build caveat: the renderer loads unminified modules from the vite dev server, so its private bytes
(about 180 MB here) run higher than a release build (69.7 MB renderer, 253.7 MB total for 1 idle pane in
`evidence/stress-s11-92185e2e-r7-final.txt`). The before/after deltas are what matter; absolute release figures
are lower.

## Before and after (private MB, median of 2 runs)

| Process | a) 2 panes before | a) after | b) 4 panes, 2 hidden, before | b) after | c) minimized before | c) after (parking trial) |
|---|---:|---:|---:|---:|---:|---:|
| kolux.exe (window) | 14.4 | 14.4 | 15.4 | 15.4 | 15.1 | 15.2 |
| browser | 42.0 | 42.4 | 41.4 | 41.7 | 44.6 | 44.9 |
| renderer | 178.5 | 178.8 | 185.9 | 186.3 | 185.6 | 190.5 |
| gpu | 125.8 | 120.7 | 129.1 | 125.9 | 111.0 | 101.5 |
| utility (2) | 23.2 | 23.5 | 22.8 | 22.9 | 22.7 | 22.9 |
| crashpad | 3.2 | 3.2 | 3.0 | 3.0 | 2.9 | 2.9 |
| **total** | **387.1** | **382.9** | **397.6** | **395.2** | **382.0** | **378.0** |
| working set total | 590.1 | 590.1 | 598.5 | 599.4 | 245.3 | 248.4 |
| GPU dedicated (VRAM) | 58.9 | 55.0 | 61.3 | 58.8 | 46.8 | 39.4 |

Phases a and b had no change in the app code that affects memory between the two runs (the status-bar figure is
read every 2 s; the parking trial only acts while the page is hidden). Their 2 to 5 MB spread is the run-to-run
noise floor.

The levers already in the app, seen within one run (the "before" run):

| Step | Total private | GPU private | Working set |
|---|---:|---:|---:|
| b early: 2 panes just hidden on tabs (WebGL still held, 9 canvases) | 426.3 | 149.4 | 610.6 |
| b: 40 s later, hidden panes gave their WebGL back (5 canvases) | 397.6 (-28.7) | 129.1 (-20.3) | 598.5 |
| c early: minimized 10 s (web view set invisible) | 383.4 (-14.2) | 111.5 (-17.6) | 607.4 |
| c: minimized 75 s (memory target LOW) | 382.0 (-1.4) | 111.0 | 245.3 (-362) |

## Levers

1. **GPU contexts for panes on hidden tabs (DT-C229, `src/terminal/renderer.ts`): already shipped, kept.** A pane
   hidden for 30 s gives its WebGL context back; live contexts are capped at 12. Measured: -28.7 MB private for 2
   hidden panes (-20.3 MB GPU process, -7.8 MB renderer), about 14 MB per hidden pane.
   **Trial: also park the panes on the shown tab when the window is minimized: rejected.** Measured (after, phase
   c): GPU process -9.5 MB and VRAM -7.4 MB, but the renderer +4.9 MB (the parked panes draw with DOM rows), net
   -4.0 MB total private, inside the 2 to 5 MB noise floor. Every restore after 30 s minimized would also re-create
   WebGL contexts outside the layout effect that keeps a tab switch flicker-free. Not worth the risk. Reverted.
   Fewer texture atlases: no lever. The atlas is already shared across terminals with the same font and theme
   (xterm 6 / addon-webgl 0.19); each WebGL context uploads its own copy, which the parking above already frees.
2. **WebView2 `MemoryUsageTargetLevel` (DT-C236, `src-tauri/src/webview_power.rs`): already shipped, kept.** On
   minimize or tray hide the controller is set invisible at once (-17.6 MB GPU process, -14.2 MB total), and after
   60 s the target level goes LOW, NORMAL again on restore. LOW trims the **working set** by 362 MB (607 to 245 MB)
   but leaves private bytes unchanged (-1.4 MB): Windows pages the memory out rather than freeing it. Nothing to add.
3. **Scrollback (`profile_for`, `src-tauri/src/terminal.rs`; ACCT-059, DT-C228): unchanged.** A 32 GB machine is
   in the "large" profile: 10000 rows per pane. Cost: about 12 bytes per cell, so about 1.4 KB per 120-column row,
   about 14 MB per pane only once its scrollback is full. An idle or short-lived pane costs far less. Windows
   Terminal's default is 9001 rows, so 10000 is not oversized.
4. **WebView2 browser arguments: none added.**
   - `--in-process-gpu`: rejected. It merges the GPU process into the browser, which loses GPU crash isolation, and
     the safe-graphics recovery (APP-043) depends on a separate GPU process.
   - `--enable-low-end-device-mode`: rejected. It lowers rendering quality (reduced colour depth for tiles, no
     smooth animations), a visible regression.
   - A lower `--max-old-space-size` (DT-C233): rejected. It is a ceiling, not usage: the JS heap is 76 to 90 MB
     here against a 2048 MB ceiling, so lowering it saves nothing and risks out-of-memory crashes on big outputs.
   - `--renderer-process-limit` and similar: no saving with one page.

## The status-bar figure (changed)

Before, the status bar showed kolux.exe's working set only (about 57 MB of a 590 MB host), so it undercounted
about 7x. Now `process_memory` (`src-tauri/src/sysmem.rs`) sums on Windows the **private bytes** of kolux.exe plus
every msedgewebview2.exe below it (one Toolhelp snapshot, then one memory query per process; 8 processes every
2 s, only while the window is visible). The pane shells and agents are other children of kolux.exe and are left
out. macOS and Linux keep the old working-set figure. The tooltip now reads "Memory Kolux itself holds right now:
its window and web view, not the agents or shells in the panes. Click for every session's memory and CPU".

Measured against the tree walk (after run, end of each window vs the window's median): a) 374.3 / 370.4 vs
382.9 MB; b) 395.1 / 396.6 vs 395.2 MB; c) 379.4 / 377.1 vs 378.0 MB. It matches within 3 percent. The gap in
phase a is the point-in-time read against the 30 s median.

A separate figure for the agents and shells was not added: the Resource Manager behind the same button already
shows memory and CPU per session (APP-054).

## What is left

- The renderer is the largest single process (about 180 MB in the dev build, about 70 MB in release). The JS heap
  is 76 to 90 MB with 2 to 4 panes. A heap profile of a long-running release build with agents is the next step to
  find out what in the page holds it (scrollback buffers, React trees, the xterm DOM and canvases).
- The GPU process baseline (about 100 to 125 MB private, 40 to 60 MB VRAM) is fixed cost for any WebGL page in
  WebView2. Only the DOM renderer avoids it, at a cost in drawing speed. That trade belongs to the owner.
- The user's own Kolux showed a 215 MB GPU process with agent panes, against 101 to 129 MB here with plain shells.
  The cause is not known. Possibly agent output fills more atlas pages per context (up to 64 MB each). Measuring S15
  with real agent output in the panes would tell.
- Windows Terminal (about 77 MB) draws with Direct3D in one process with no web view. Kolux cannot reach that
  figure without replacing the web view. The levers above cover what a web view allows.
