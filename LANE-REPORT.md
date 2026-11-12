# LANE-REPORT: c3-terminal

## Status (plain words, 3 lines max)
The Windows Terminal engine now draws a live Kolux pane in the right place (setting on); setting off is unchanged xterm.
Seven queued bugs fixed: language packs redraw, timing tests, sidebar polling, remove-session shortcut, agent start logging, local build profile.
Browser Rust removal and the agent-shell wrap (a)/(b) are still blocked on o1-tools and c2-agents.

## Done this round (round 3)
Merged integrate/wave-1 first (d2c26cd0).

1. **Native terminal proven live** (goal 0). Harness run `node G:/Temp/c3-native/live.mjs on|off`
   (vite 1450/1451, CDP 9430/9431, com.txaisxiong.kolux.c3-{0,1}.smoke, fresh git repo, Terminal pane).
   - Bug found and fixed (d198659e): TerminalTriggerResize calls SetWindowPos(hwnd,0,0,w,h), so the engine
     window jumped to the main window's top-left. `fit()` in native_view.rs now resizes first, then places.
   - After the fix: HwndTerminalClass child at client 298,134 801x721 = pane BODY_RECT 298,134 801x721.
   - Setting on: `NATIVE_STATE "[\"on\"]"`, screenshot artifacts/c3-round3/native-on.png (PowerShell prompt
     drawn by the WT engine). Before the fix: artifacts/c3-round3/native-on-corner-bug.png.
   - Setting off: `NATIVE_STATE "[]"`, artifacts/c3-round3/native-off.png (same pane in xterm).
   - Status-bar memory, one sample each: 92.6 MB on vs 59.3 MB off. xterm still runs under the native view,
     so the saving needs step 2.
   - Pane marks `body[data-native]` = on/off for probes (8119d4a7).
   - `cargo test --lib native_view` -> `test result: ok. 3 passed; 0 failed`
2. **Language packs redraw** (f800b575): `usePackLoaded()` hook used by TopBar and AsleepPane; main.tsx waits
   up to 300 ms for the pack before first paint. Test usePackLoaded.test.ts. Wizard part filed to c2-agents
   (20261112-1700-wizard-usepackloaded.md).
3. **Timing tests**: outputFlood 48 MB test 30 s budget (2c3164f6); tools row961 30 s deadline (de862747).
4. **Agent start** (a4900dba): failed starts written to kolux.log ("terminal start failed (label): error",
   SUPERSEDED skipped); `started()` reports the program asked for, not the shell carrying it. That is items
   (c) and (d) of agent-shell-wrap-hook. Tests `started_names_the_program_asked_for_not_the_shell_that_carries_it`,
   `a_failed_start_has_a_log_line_and_a_superseded_one_does_not`.
5. **Right sidebar** (f51d6e16): Agents and Checks panels stop polling behind a full-page screen.
6. **Remove-session shortcut** (a4671921): honours "Stop without asking" via removePlan.
7. **[profile.local]** (fac2b824): thin LTO, 16 codegen units, incremental. Not yet timed with a build.

Proof:
- `npx tsc --noEmit` -> no output (clean)
- `npx vitest run src/terminal src/shell src/sleep src/chrome src/look` -> `Test Files 204 passed (204)  Tests 1243 passed (1243)`
- `npx vitest run src/terminal/remove.test.ts src/shell/window src/terminal/__cards__` -> `46 passed, 142 tests passed`
- `cargo test --lib` -> `test result: ok. 3166 passed; 0 failed`
- `cargo test` integration: tests/cards_10.rs safe009-safe015 fail because tests/scratch_root requires
  USERPROFILE to point at a scratch root (environmental, not touched this round).
- `cargo clippy --lib` -> no warnings, no errors

Bug files moved to _shared/bugs/done/: i18n packs, timing tests, right sidebar, remove-started-session, local profile.

## Next round
1. Native terminal step 2: skip xterm drawing for native panes (the memory saving), hide the native window
   under menus/dialogs/full-page screens, theme and font via TerminalSetTheme, focus and keyboard routing.
2. Browser Rust removal once o1-tools merges src/browser/ removal: keep the net helpers (net.rs, move
   tower_window_open), the tower window, pdf and preview.
3. Agent-shell wrap (a)/(b) once c2's agent_shell.rs exists; then terminal visual bugs and the 8-pane GPU measurement.

## For the coordinator
- CHANGELOG: "Interface text in other languages now appears without needing a restart."
- CHANGELOG: "Removing a session from the keyboard now respects 'Stop without asking'."
- CHANGELOG (experimental): "Terminal panes can be drawn by the Windows Terminal engine (setting terminalNative, off by default)."
- DECISIONS row: "2026-11-12: native view is positioned after TerminalTriggerResize because the engine moves its window to (0,0)."
- Reply to c2-agents on agent-shell-wrap-hook: (c) logging and (d) logical program name landed in a4900dba; (a)/(b) wait for agent_shell.rs.
- Still to decide: shipping Microsoft.Terminal.Control.dll (MIT) in the bundle plus THIRD-PARTY-NOTICES. Today it loads only from KOLUX_TERMINAL_CONTROL_DLL.
- Screenshots are in artifacts/c3-round3/ (local, not committed).
