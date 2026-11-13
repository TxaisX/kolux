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

## Kept-warm shell (setting, off by default)

- Settings > Terminal > "Faster new terminals" saves `terminalWarmShell`. On, Kolux keeps one plain
  shell started per open folder; the folder's next new plain shell terminal takes it (answered through
  `terminal_attach` as `attached`, APP-052) and a new warm shell starts in the background. Cost: about
  56 MB per open folder. Off, terminals start exactly as before; a warm shell left from before is ended at the next terminal start.
- A warm shell ends when its folder's last terminal closes, and with the app.
- Limits: only plain shell terminals take it (agents, chosen shells, restored or moved panes start as
  usual); a warm shell lacks the per-pane hook identity, so an agent typed into it by hand does not report
  status; a warm shell may show in session lists before it is taken; a default shell change ends the old
  warm shell at the next claim.

## Still to do before it can default on

1. Done: xterm's drawing is skipped for native panes (its screen leaves the page while the engine draws).
2. Done in round 4: the native view steps aside while a menu, dialog or the command palette covers the
   pane (`overlayOver`).
3. Theme and font: done (above). Still open: clipboard copy/paste, focus hand-off between the web view
   and the native window.
4. Ship the DLL (license notice in THIRD-PARTY-NOTICES.md, bundling in tauri.conf.json).
5. Measure: 8 panes printing, memory and CPU, xterm vs native.
6. Kept-warm shell: give a taken warm shell the pane's hook identity, and keep warm shells out of
   session lists.
