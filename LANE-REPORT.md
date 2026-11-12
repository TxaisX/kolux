# LANE-REPORT: c3-terminal

## Status (plain words, 3 lines max)
The pane header no longer shows the dead "Context used" ring and percentage.
Kolux can now draw a pane with the real Windows Terminal engine, behind a setting that is off by default;
it is built and unit-tested but not yet seen working in the live app.

## Done this round (round 2)
Round 1 ended before writing its reports (no AUDIT, no NATIVE-TERMINAL.md, no LANE-REPORT). Its spike in
spikes/native-terminal had run and succeeded, so this round wrote the recommendation from that evidence.

1. **Removed "Context used"** (brief item 2). ContextGauge deleted from UsageReadout.tsx, the `context` prop
   removed from TerminalPane, Pane.tsx and terminalProps.ts, its CSS removed, contextGauge.test.ts and the
   USAGE-001 card test deleted, TERM-019 card now checks the header's token readout. Tokens, plan figures and
   cost (USAGE-034) kept: they are fed by the same status-line reading, which the card meter also uses.
   - `npx tsc --noEmit` -> no output (clean)
   - `npx vitest run src/terminal src/shell/window src/look` -> `Test Files 137 passed (137)  Tests 911 passed (911)`
2. **NATIVE-TERMINAL.md** written: options (a) reparent WT/conhost, (b) WT XAML control, (c) our ConPTY +
   WT engine (HwndTerminal). Recommendation: (c).
3. **Native terminal, first build (behind `terminalNative`, default off)** (goal 0).
   - Rust `src-tauri/src/terminal/native_view.rs`: loads Microsoft.Terminal.Control.dll at run time, one
     child window per pane over the web view, output teed from the output batcher, typing back to the
     session, session resized to the engine's grid. Commands `native_term_available/attach/place/detach`
     registered in lib.rs. Cargo.toml: windows-sys feature `Win32_System_LibraryLoader` added.
   - Pane `src/terminal/nativeView.ts` (+ test): follows the pane body's size/position, hides with the
     pane, detaches on unmount, falls back to xterm when the engine is missing. Wired in TerminalPane.
   - Setting `terminalNative` in inputPrefs.ts.
   - `cargo test --lib native_view` -> `test result: ok. 3 passed; 0 failed`
   - `cargo clippy --lib` -> no warnings in native_view (and no errors)
   - `npx vitest run src/terminal src/shell/window` -> 126 of 127 files passed while a Rust build ran in
     parallel; the one failure (outputFlood.test.ts, a 48 MB timing test) passed alone:
     `npx vitest run src/terminal/outputFlood.test.ts` -> `Tests 2 passed (2)`
   - **Not yet proven live.** A harness run (vite 1450, CDP 9343, com.txaisxiong.kolux.c3.smoke) launched
     the app with the setting on, but the fresh profile opened with no terminal pane (`.pane-body` count 0),
     so nothing was attached. No before/after screenshot yet.
4. **GPU drawing** (brief item 3): checked, not changed. Panes already use WebGL by default
   (TerminalPane.tsx attachRenderer + inputPrefs preferGpu: WebGL2 unless the GPU is a software renderer),
   with a DOM fallback and context-loss handling in renderer.ts. Measurement with 8 panes not done.
5. Bug files sent to o1-tools: the settings toggle for `terminalNative`; the hand-off for removing the
   browser's Rust side once src/browser/ is gone.

## Next round
1. Live proof of the native terminal: harness run that opens a shell pane (cdp: new tab), then capture.
   Probe script draft at G:\Temp\c3-native\probe.ps1 (its Add-Type failed: fix the C# lambdas for the
   PowerShell 5 compiler, or use shot.ps1 with the main window's pid). Engine DLL for the run:
   `KOLUX_TERMINAL_CONTROL_DLL=spikes/native-terminal/_pkg/x/runtimes/win-x64/native/Microsoft.Terminal.Control.dll`
   (the 300 MB `_pkg` is local only, not committed).
2. Native terminal step 2: skip xterm drawing for native panes (that is where the memory saving comes from),
   hide the native view under menus/dialogs, theme/font via TerminalSetTheme.
3. Terminal visual bugs (brief item 1) with the stress generators; then the audit round 1 never wrote,
   then splitting TerminalPane.tsx (2,170 lines).

## For the coordinator
- CHANGELOG: "The pane header no longer shows the 'Context used' ring and percentage, which never received a
  real figure. Token, plan and cost figures stay."
- CHANGELOG (when proven): "Experimental: draw terminal panes with the Windows Terminal engine (setting
  terminalNative)."
- DECISIONS row: "2026-11-12: USAGE-001 (header context ring) removed at Txais's direction: it never picked up a
  real figure. USAGE-034 readout kept."
- DECISIONS row: "2026-11-12: native terminal path = keep Kolux's ConPTY, draw with Microsoft.Terminal.Control.dll
  (HwndTerminal) in child windows, behind terminalNative, default off (NATIVE-TERMINAL.md)."
- Dependency to decide: shipping Microsoft.Terminal.Control.dll (MIT, NuGet CI.Microsoft.Terminal.Wpf
  1.25.260303002, about 2-3 MB per arch) in the bundle plus a THIRD-PARTY-NOTICES entry.
- Feature cards: USAGE-001 card test deleted; feature-index entry for USAGE-001 should be marked removed.
