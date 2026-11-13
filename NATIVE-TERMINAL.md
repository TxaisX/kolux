# Native terminal for Kolux panes (lane c3-terminal)

Goal (Txais, 2026-11-12): draw panes with Windows' own terminal engine instead of xterm.js inside the
web view, so Kolux uses less memory and the PC can run more agents at once.

Round 1 ran the spike but ended before this write-up; round 2 wrote it from the spike's evidence and
started the build.

## The three options

| | (a) Reparent a real Windows Terminal / conhost window | (b) Host the Windows Terminal XAML control (TermControl) | (c) Keep our ConPTY, draw with the WT engine (HwndTerminal) |
|---|---|---|---|
| What the user sees | A real WT window inside each pane, with its own tabs, title bar remnants, own settings | WT's exact control in each pane | WT's exact text drawing (DirectX/Atlas engine) in each pane; Kolux's header, tabs and splits unchanged |
| Who owns the session | WT or conhost. Kolux loses the output stream: no sleep/wake, restore, chat view, hooks on output, search, idle detection | Kolux, through a connection object | Kolux, unchanged (pty.rs, terminal service) |
| Tabs, splits | Fight WT's own tabs; splits need one WT process per pane | Work | Work: one child window per pane, placed by Kolux |
| Focus | Cross-process focus, Alt-Tab and foreground rules break it | XAML Islands focus handoff is known to be fragile | Same-process child window: plain Win32 focus |
| Resize, DPI, multi-monitor | Cross-process SetParent is unsupported for WT (a packaged XAML app); DPI mismatch across processes | Works, but brings WinUI/XAML Islands and the Windows App SDK runtime | Spike: resize 900x480 -> 560x300 gave 100x25 -> 62x15 cols/rows; DPI 144 re-laid to 40x10 |
| Copy/paste | WT's own | WT's own | Engine does selection; clipboard hookup still to do |
| Memory | Highest: a WT process (about 70-100 MB) per pane | High: XAML runtime in-process | Spike: about 48 MB working set for the engine and ConPTY together |
| Effort | 5-8 days and still broken by design | 15-20 days | 6-10 days to a shippable setting |
| Risk | Very high (unsupported API use, loses Kolux's core features) | High (XAML Islands in a Tauri process, packaging) | Medium: the "airspace" rule (below) and an engine DLL to ship |

## Recommendation

**Option (c): keep Kolux's own ConPTY sessions and draw each pane with the Windows Terminal engine
(`Microsoft.Terminal.Control.dll`, MIT licensed, from the `CI.Microsoft.Terminal.Wpf` NuGet package)
in a native child window placed over the pane.** It is the only option that keeps every Kolux session
feature (sleep/wake, restore, hooks, chat view, idle detection) while drawing with the real Windows
engine. Tradeoff: web UI drawn over a pane (menus, dialogs, toasts) sits under the native window
("airspace": a native window always covers the web view below it), so those must hide the native
view or move out of the pane area.

## Spike evidence (spikes/native-terminal, round 1)

Run: `powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File spikes\native-terminal\run-spike-c.ps1`
(the 300 MB NuGet unpack under `_pkg/` is not committed; fetch `CI.Microsoft.Terminal.Wpf` 1.25.260303002).

- `CreateTerminal` inside a plain window: ok, class `HwndTerminalClass`.
- Our ConPTY running cmd.exe, output fed through `TerminalSendOutput`: colours, truecolor, bold,
  underline, reverse, box drawing, CJK and emoji drawn (`out/c1-initial.png`, `out/c2b-unicode.png`).
- Typing: keys posted to the engine came back through the write callback as win32-input-mode
  sequences and reached the program (`echo via-api` ran; `out/c2-after-input.png`).
- Resize and DPI: `out/c3-resized.png`, `out/c4-dpi144.png`.
- Clean up: `DestroyTerminal`, `ClosePseudoConsole`; no child processes left.

## Round 2 build (behind a setting, off by default)

- Rust: `src-tauri/src/terminal/native_view.rs` loads the engine at run time (`KOLUX_TERMINAL_CONTROL_DLL`,
  else beside `Kolux.exe`), makes one child window of the main window per pane, tees each pane's output
  batch into it, sends what is typed back to the session, and fits the session to the engine's grid.
  Commands: `native_term_available`, `native_term_attach`, `native_term_place`, `native_term_detach`.
- Pane: `src/terminal/nativeView.ts` keeps the native window on the pane body (resize, layout moves,
  hidden tabs) and falls back to xterm when the engine is missing.
- Setting: `terminalNative: true` in settings turns it on. The toggle on the settings page is owned by
  another lane (bug filed).

## Look and drawing (fu/native-style)

- The engine draws with the pane's own look: the active terminal theme (background, foreground, cursor,
  selection, the 16 ANSI colours), the terminal font family and size, and the cursor shape and blink, sent
  with `native_term_attach` and again with `native_term_place` on a theme or text change
  (`nativeLook` in `src/terminal/nativeView.ts`, `TerminalSetTheme` in `native_view.rs`). Colours Windows
  cannot take (see-through ones) are laid over the background. Font size goes in points (CSS px x 0.75).
- DPI: the engine is told the window's DPI at attach and again when it changes (`TerminalDpiChanged`).
- xterm stops drawing under a native pane: its screen leaves the page while the engine draws and comes
  back (refitted) when the engine steps aside, so a menu over the pane still shows the same lines. xterm
  keeps the engine's grid size.
- A new native view starts from the session's saved tail and then takes only output newer than it, so
  an attach never shows a blank pane and no chunk is drawn twice.
- The font size goes to the engine as a 32-bit int. The engine's PDB gives `TerminalSetTheme(void*,
  _TerminalTheme, const wchar_t*, int fontSize, int newDpi)` (the WPF control declares it `short`); passed as
  an i16 its upper half was whatever the register held. On GitHub's windows-latest runner, `native_term_place`
  for a 1289 x 834 pane with a 10 pt look answered a 16 x 5 grid before the fix (commit 34dabba0, run
  https://github.com/TxaisX/kolux/actions/runs/43366064099, `NATIVE-looks.json` in its artifact) and 161 x 55
  after it (commit 4cf73213, run https://github.com/TxaisX/kolux/actions/runs/43370612797, same file). The
  theme struct and the other entry points match the PDB.
- The engine's answers to the cursor question (ESC [ row ; col R) stay out of the session. xterm takes the
  same output and answers it already; the second answer reached PowerShell as F3 ("search for the next key
  typed"), so the first line typed into a native pane lost its first letter.

### Screenshots (taken on GitHub's windows-latest runner)

A pane drawn by the engine in the Kolux dark look, then the light look after the switch; the 16 console
colours as backgrounds come from Kolux's table. Commit 4cf73213, 2026-11-13, run
https://github.com/TxaisX/kolux/actions/runs/43370612797: `scripts/prove/live-native-look.mjs` drove the
debug app over CDP, and the window was captured with `scripts/evidence/shot.ps1` (PrintWindow, which also
captures the engine's child window; a CDP page capture cannot see it). Windows Server 2025, 1920 x 1080 at
96 DPI, engine `CI.Microsoft.Terminal.Wpf` 1.25.260303002.

- `evidence/NATIVE-TERMINAL-dark-native-pane.png`
- `evidence/NATIVE-TERMINAL-light-native-pane.png`

## Kept-warm shell (setting, off by default)

- Settings > Terminal > "Faster new terminals" saves `terminalWarmShell`. On, Kolux keeps one plain
  shell started per open folder; the folder's next new plain shell terminal takes it (answered through
  `terminal_attach` as `attached`, APP-052) and a new warm shell starts in the background. Cost: one more
  shell (and its console host) running per open folder; its memory has not been measured yet (below). Off,
  terminals start exactly as before, and switching it off ends the warm shells when the settings are saved
  (one still starting is called off).
- A warm shell ends when its folder's last terminal closes, and with the app.
- A pane takes a warm shell only when the shell was started from exactly what a new plain terminal would run
  now: the same commands with every variable a pane gets (the default shell and its fallbacks, the TERM-120
  PATH read fresh from the registry and the T-182 stored Path, the per-worktree history setting, the user's
  variables), all but the session's own names (`Plan` in `terminal.rs`). Anything changed since it started (a
  tool installed, a setting switched) ends the warm shell, and the pane starts its own.
- Its hooks carry their own identity from the start: the pane key `hooks::WARM_PANE` (no pane has it) with the
  warm shell's terminal id and a token minted for both. The pane that takes it is noted against that terminal id,
  and from then on its reports (status, status line) are that pane's; a protected command typed into an agent
  there is asked about (SAFE-009) as in any pane. The pane is told the shell it runs, so its header, icon and
  file drops are that shell's, and the warm shell's output so far goes into the pane's history file.
- Not with the background terminal service (`KOLUX_TERMINAL_SERVICE=1`): a warm shell would run in the
  service, outlive the app with no pane and show in the service's session lists, so the setting does nothing
  there.
- On Windows the console host asks where the cursor is (ESC [6n) before the shell draws anything, and waits
  for a terminal's answer. A warm shell has no pane, so Kolux answers it (top left, as a blank screen
  would) before it offers the shell; one that does not ask within 10 s is ended instead of offered. The
  pane that takes it leaves every terminal query out of the snapshot it draws (`stripQueries.ts`): that answered
  question, and any other query the shell printed before a pane was there, which nobody answered then and
  which xterm would answer on the redraw, typing the answer at the prompt. Before this, every warm
  shell sat at the question until a pane took it, and the setting made new terminals slower (below).

### New terminal, warm shell off vs on (measured on GitHub's windows-latest runner)

Not the owner's PC: a cloud runner (Windows Server 2025, image windows-2025-vs2026 20261103.298.1,
WebView2 156.0.4314.58), PowerShell 7 as the default shell, a debug build. Method
(`scripts/prove/live-warm-shell.mjs`, run by a temporary workflow): one app launch per setting; in a pane's
New session menu, "Blank terminal" is pressed 5 times, each new pane closed again and 6 s left before the
next press. Each time is `performance.now()` in the page from the press to the new pane's xterm buffer
holding a line ending in `>`. Each run is tagged by the backend calls its pane made: "attached" means
`terminal_attach` answered it with the folder's warm shell and no `terminal_spawn` followed; "spawned"
means it started its own shell with `terminal_spawn`.

Commit 4cf73213, 2026-11-13, run https://github.com/TxaisX/kolux/actions/runs/43370612797:

| run | off: to prompt | off: path | on: to prompt | on: path |
|---|---|---|---|---|
| 1 | 1588.6 ms | spawned | 270.5 ms | attached |
| 2 | 1632.3 ms | spawned | 303.0 ms | attached |
| 3 | 2641.2 ms | spawned | 221.1 ms | attached |
| 4 | 1710.2 ms | spawned | 270.2 ms | attached |
| 5 | 1600.9 ms | spawned | 283.9 ms | attached |
| median | **1632.3 ms** | | **270.5 ms** | |

The runner varies from run to run: the same check on commit 90ac9724 (warm shell fix in, native cursor
fix not yet) gave medians of 908.7 ms off and 170.8 ms on (on: 133.2 to 244.8 ms, all attached;
https://github.com/TxaisX/kolux/actions/runs/43368955947). The setting's label says "about 0.3 s" from these
runs: measured before the review fixes below, and for a new terminal opened at least 6 s after the one before it
in the same folder, as every run here was. After each take
the folder's next warm shell starts, and a new terminal that comes before it is ready starts its own shell (as
fast as with the setting off). How short that gap can be was not measured.

These runs are from before the review fixes below (commit 0986abe0 and after). A pane now also works out, before
it takes the warm shell, what a fresh start would run (a registry read of the PATH and a shell search, which a
fresh start does too) to compare the two, so the "on" times may be a little longer. The live check was extended
to time that and to read the identity, the memory and the switch-off (see Running the live checks); its re-run
on the runner is pending, so there are no numbers from after the fixes yet.

Before the fix (commit 34dabba0, https://github.com/TxaisX/kolux/actions/runs/43366064099), every
"on" run took the warm shell and was still slower, because the warm shell had not reached its prompt:

| run | off: to prompt | off: path | on: to prompt | on: path |
|---|---|---|---|---|
| 1 | 1149.1 ms | spawned | 1256.0 ms | attached |
| 2 | 1332.7 ms | spawned | 2110.6 ms | attached |
| 3 | 1122.0 ms | spawned | 5156.3 ms | attached |
| 4 | 1140.2 ms | spawned | 3234.8 ms | attached |
| 5 | 1215.1 ms | spawned | 2707.0 ms | attached |
| median | 1149.1 ms | | 2707.0 ms | |

What one warm shell costs in memory has not been measured: the label used to say "about 56 MB per open
folder", a figure nothing here measured, so it now says what runs instead ("each open folder keeps one more
shell running"). The extended live check measures it (the processes that end when the setting is switched off,
the warm shell and its console host, with their working sets).

### Running the live checks

`node scripts/prove/live-warm-shell.mjs` and `NATIVE_TERMINAL_DLL=<path to Microsoft.Terminal.Control.dll>
node scripts/prove/live-native-look.mjs`, with the usual `PROVE_*` variables. Where the WebView2 ignores
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` (156.0.4314.58 on the runner did, and also the same flag as a
WebView2 policy), set `PROVE_CDP_IN_CONFIG=1` so the debugging port goes in through the window config.
`PROVE_BUILD_MINUTES` shortens the wait for the page on a machine that built the app beforehand.
`live-warm-shell.mjs` also, with the setting on and untimed: prints `KOLUX_HOOK_IDENTITY` in the first pane that
took a warm shell (it must name pane key 4294967295 and the terminal the pane was handed), checks every taken pane
was told its shell, and `MEM_ROUNDS` times (default 3) switches the setting off and reads which processes ended
and their working sets, with the Resource Manager's figure for the warm shell's session beside them; switching
off must end exactly the warm shell's session within 3 s. The temporary workflow that ran it on the runner is in
commit a4a99647 (`.github/workflows/tmp-warm-shell.yml`).
- Limits: only plain shell terminals take it (agents, chosen shells, restored or moved panes start as
  usual); a warm shell is listed with the folder's terminals in this window's own lists (the Resource Manager
  counts its memory) before a pane takes it; none runs under the background terminal service.

## Still to do before it can default on

1. Done: xterm's drawing is skipped for native panes (its screen leaves the page while the engine draws).
2. Done in round 4: the native view steps aside while a menu, dialog or the command palette covers the
   pane (`overlayOver`).
3. Theme and font: done (above). Still open: clipboard copy/paste, focus hand-off between the web view
   and the native window.
4. Ship the DLL (license notice in THIRD-PARTY-NOTICES.md, bundling in tauri.conf.json).
5. Measure: 8 panes printing, memory and CPU, xterm vs native.
6. Kept-warm shell: done, a taken warm shell's hooks report for its pane and none runs under the terminal
   service. Still open: time it and measure its memory on Windows after the review fixes (the live check is
   ready; the run is pending).
