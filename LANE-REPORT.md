# LANE-REPORT: c3-terminal

## Status (plain words, 3 lines max)
With the native terminal setting on, the engine window now steps aside when a menu or dialog opens over the pane and comes back after.
Clicking a session row in the sidebar can now focus that pane once c2-agents adds its half (the shell side is in).
Open question found: round 3's "engine draws the prompt" screenshot may have been xterm's text, not the engine's (see Done 2).

## Done this round (round 4)
Merged integrate/wave-1 first (katex/vite/crate bumps, round-1 audit report). Queue read: 7 files.

1. **Sidebar session row focuses its pane, shell side** (a1255a15, bug 20261112-1200). Sidebar.tsx passes
   `onFocusPane={act.focusPane}` (openPane). projectsProps.ts declares `FocusPane = { onFocusPane?: (key) => void }`
   and lists `onFocusPane: "same"`, so this compiles before AND after c2-agents adds the prop to ProjectsPanel.
   Also fixed a tsc error from the merge: remove.test.ts node:fs import now carries the same @ts-expect-error as the
   other source-reading tests.
2. **Native terminal step 2** (df8b9f9e, b83a2885).
   - nativeView.ts `overlayOver()`: an open `[role=menu|dialog|alertdialog|listbox]` or `.menu` overlapping the pane,
     or anything else on top of the pane's centre (sheet, full-page screen), hides the engine window; it returns when
     the overlay goes. `body[data-native]` is now on / under / off.
   - `onShown` tells the pane when the engine draws; the pane then counts as hidden for its GPU slot (parkWhenHidden
     gives the WebGL context back after the usual 30 s).
   - Live proof, `node artifacts/c3-round4/live4.mjs on` (vite 1450, CDP 9430, com.txaisxiong.kolux.c3-0.smoke,
     log artifacts/c3-round4/live4-on.log):
     `MENU_OPEN true` / `MENU_NATIVE_STATE ["under"]` / `HwndTerminalClass vis=False`;
     after removal `AFTER_NATIVE_STATE ["on"]` / `HwndTerminalClass vis=True`.
   - **Finding:** I also hid xterm under the engine (CSS visibility) to save painting. The capture then showed a BLANK
     pane (artifacts/c3-round4/r4-native.png), where round 3's capture showed the PowerShell prompt. So either the engine
     draws nothing visible, or PrintWindow (shot.ps1) cannot capture the engine's DirectX surface. Not known which.
     I took the CSS rule back out (b83a2885) so the setting never shows a blank pane. Round 3's claim "prompt drawn by
     the WT engine" is unproven until this is settled.
   - Also seen: after the overlay test the engine window measured 1621x873 while the pane layout had changed to 6
     panes in the capture; needs a second look next round.
3. **Refactor** (e6f8f65a): the pane's link wiring (term-N handles, web/file links, OSC 8, link click, link-menu
   right-click, ~105 lines) moved from TerminalPane.tsx's mount effect to `paneLinks.ts` `wireLinks()`, cleanup returned.
   TerminalPane.tsx 2172 -> 2073 lines. PaneMenu.test T-710 now reads paneLinks.ts for the moved line.

Checked, nothing to do:
- "Context used" ring (top work 2): already gone; UsageReadout.tsx header says removed 2026-11-12; no ContextGauge left.
- GPU drawing (top work 3): panes already default to WebGL with a clean fallback (renderer.ts attachRenderer:
  WebGL2 not software -> GPU; context loss -> DOM; 12-context pool, park after 30 s hidden). The 8-pane CPU/GPU/frame
  measurement is still not done.

Blocked (unchanged): browser Rust removal and repointing my src/browser imports both need o1-tools' commit 30830263
(adds src/open/openExternal.ts) merged into integrate/wave-1; it is not there yet. Agent-shell wrap (a)/(b) needs
c2's agent_shell.rs (2d4bd3cc) merged; also not there yet.

Proof:
- `npx tsc --noEmit` -> no output (clean)
- `npx vitest run src/terminal src/shell src/chrome src/keys src/status src/look src/sleep` ->
  `Test Files 246 passed (246)  Tests 1517 passed (1517)`
- `npx vitest run src/settings/__cards__/SET-001-005.test.ts src/settings/__cards__/SET-028.test.ts` -> `12 passed`
- No Rust touched this round.

## Next round
1. Settle whether the engine draws on screen: capture with a screen copy (CopyFromScreen/DXGI), not PrintWindow, or
   type into the pane and read the engine's buffer. If it draws, hide xterm under it (one CSS line, see b83a2885). If not,
   look at z-order against WebView2's own child window and at the feed path. Then the 1621x873 size after the overlay.
2. As soon as integrate/wave-1 has o1-tools' 30830263 and c2's 2d4bd3cc: repoint the browser imports
   (list in bug 20261112-1215), cut browser*.rs down per bugs 1143/1601, and land agent-shell wrap (a)/(b).
3. 8-pane GPU measurement (CPU %, GPU %, frame time, keystroke-to-screen), then the next TerminalPane split.

## For the coordinator
- Please merge lane/o1-tools 30830263 and lane/c2-agents 2d4bd3cc into integrate/wave-1; three of my queued bugs wait on them.
- Reply to c2-agents (bug 20261112-1200): shell side landed in a1255a15. ProjectsPanel can now add
  `onFocusPane?: (key: number) => void` to its Props and call it from openSession; projectsProps already lists it.
- CHANGELOG (experimental): "With the native terminal setting on, menus and dialogs now show over terminal panes."
- DECISIONS row: "2026-11-12: native terminal is unproven on screen; xterm keeps painting under the engine until a
  screen capture shows the engine's own text."
- Evidence is in artifacts/c3-round4/ (local, not committed).
