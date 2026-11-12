# LANE-REPORT: c3-terminal

## Status (plain words, 3 lines max)
A new terminal now appears in about 70 ms instead of 340 ms of Kolux's own time (whole start 992 -> 775 ms; the rest is PowerShell starting).
Grok and OpenCode panes can now carry their own label (the last two lines are c2-agents' file, bug filed); the language-pack test no longer needs jsdom.
Still short of 300 ms: only a kept-warm shell gets there, and that is Txais's call (costs ~56 MB per open folder).

## Done this round (round 6)
Merged integrate/wave-1 first (clean). Queue: 3 files; 2 fixed and moved to done/, 1 (1155) cut by 268 ms and left open for a decision.
Note: the merge brought c2-agents' LANE-REPORT.md over this file (the integrate branch carries one); restored this lane's own from 19d996a3.

1. **New terminal latency, Kolux's part** (17ae2786, bug 1155). Timed with temporary in-page marks (removed): ~72 ms of Kolux's
   part was making the new pane's WebGL context before its first frame and before terminal_spawn (dev StrictMode paid it twice).
   renderer.ts `attachRenderer(..., startPlain)` + `afterPaint()`: the pane starts plain, WebGL loads after the first paint.
   Proof, live check on lane ports (PROVE_PORT=1450 PROVE_CDP=9430, scripts/prove/live-latency.mjs plus marks), dev build, same PC:
   before `new-session sample: 991.9 ms; Kolux's own part (pane drawn): 336.5 ms; shell's part: 655.4 ms`
   after  `new-session sample: 775.3 ms; Kolux's own part (pane drawn): 68.8 ms; shell's part: 706.5 ms`
   and `SUMMARY keystroke 3.7 ms (target 16) | click 4.6 ms (target 50)`; the "gpu" mark showed WebGL loaded ~122 ms after the click.
   (One run under 100 % CPU from other lanes read 1778.7 ms total / keystroke 29 ms; discarded as load, rerun above.)
   Tests: two new renderer.test.ts cases (startPlain loads nothing until wake; GPU off stays plain).
2. **Grok/OpenCode panes read as shell** (6fa43c7a, bug 1320, c3 half). `Agent` gains "grok" | "opencode"; layout restore
   (layout.ts AGENTS) now accepts every Agent (copilot/cursor panes were dropped on restore before). The pane is still built as
   "shell" until c2 widens src/launch/paneMark.ts: bug c2-agents/20261112-1900-panemark-grok-opencode.md (two lines, given).
3. **usePackLoaded test without jsdom** (6fa43c7a, bug 1410): mounts on src/tasks/fakeDom.ts. `npx vitest run src/shell/usePackLoaded.test.ts` -> 1 passed.
4. **Shortcut titles** (48b9bb41): zoom.in/out/reset read "Zoom In" / "Zoom Out" / "Reset Zoom" (were "...Browser..."); ids unchanged.
5. Checked: o3's two "still open" bugs (1112 i18n, 1105 status refs) were already fixed and in done/.

Proof (fresh, end of round):
- `npx tsc --noEmit` -> exit 0, no errors.
- `npx vitest run src/terminal src/shell src/chrome src/keys src/status src/look src/sleep src/space src/lazy src/main.slowStart.test.ts`
  -> `Test Files 254 passed (254)  Tests 1562 passed (1562)`
- No Rust touched this round.

## Next round (after the wave)
1. Txais decision: kept-warm shell for the 300 ms target (one pre-started PowerShell per open folder, measured 56 MB private /
   74 MB working set). If yes: reuse the APP-052 reattach path (`terminal_attach` -> `back.kind === "attached"`) for a claimed warm pty.
2. Native terminal, goal 0 item 8: wire `TerminalSetTheme` (theme, font, DPI) in src-tauri/src/terminal/native_view.rs and take the
   two-theme screenshots; then skip xterm drawing for native panes (NATIVE-TERMINAL.md "Still to do").
3. 8-pane GPU measurement (read `engtype_3D` only: o3's GPU-counter note), then the next TerminalPane.tsx split.

## For the coordinator
- LANE-REPORT.md: integrate/wave-1 carries c2-agents' report; merging it overwrote this lane's. Keep each lane's own when merging.
- CHANGELOG: "New terminals appear faster: Kolux's own share of opening one dropped from about a third of a second to under a tenth."
  / "Grok and OpenCode panes are labelled as themselves." (the second only once c2's paneMark.ts change lands)
- DECISIONS row: "2026-11-12: a new terminal pane starts on the plain renderer and loads WebGL after its first paint (bug 1155)."
- Decision for Txais: kept-warm shell to reach 300 ms (cost ~56 MB per open folder) or accept ~700-800 ms with a real PowerShell.
- c2-agents: bug 20261112-1900 (paneMark.ts grok/opencode) completes smoke flow 6.
