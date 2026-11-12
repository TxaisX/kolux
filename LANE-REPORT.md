# LANE-REPORT: c3-terminal

## Status (plain words, 3 lines max)
New agent sessions now start inside the user's own PowerShell (or login shell), as if the user typed `claude`; Kolux no longer runs the agent program directly.
The embedded web pane is gone from both the screens and the Rust core (about 14,000 lines less); updates, project icons, the Tower window, PDF export and HTML preview kept.
New terminal start (about 1 s against a 300 ms target) is measured but not yet fixed: first job next round.

## Done this round (round 5)
Merged integrate/wave-1 first (it now has o1-tools 30830263 and c2-agents 2d4bd3cc). Queue: 11 files; 9 fixed and moved to done/, 1 already fixed last round (1200), 1 open (1155 latency).

1. **Agents start through the user's shell** (2cb2e273, bug 1600). terminal.rs Terminals::spawn takes `agent_settings` and wraps a
   credited agent with `crate::agents::agent_shell::via_shell`, falling back to program_command; pty_service.rs's program fallback does the
   same with `a["settings"]`. (c) Mark.program / started() already report the logical program; (d) start failures already reach kolux.log.
   Proof: `cargo test --lib -- agent_shell terminal:: pty_service` -> `test result: ok. 100 passed; 0 failed; 1 ignored`; clippy --lib clean on both files.
2. **Start-up gate tests** (fea2fb3c, bugs 1240, 1242). main.slowStart's language mock lacked `locale`/`onLanguageChange` (the pack preload
   reads them), so start() threw; app code unchanged. wave3 F4 now matches the sidebar's fixed `<h2 className="sb-heading">Folders</h2>`.
   src/tower/entry.test.ts has the same mock gap: c2-agents' file, bug filed (c2-agents/20261112-1700-tower-entry-stub-createElement.md).
3. **Web pane, frontend side** (f642b4c2, bugs 1215, 1105-status, 1220, 1241; 58 files, +250/-380). openInBrowser -> openExternal;
   notePrinted moved to src/terminal/printedAddresses.ts; "browser" pane kind, 8 browser actions + scope, chords, page ring, browserOpen,
   .pane.browser CSS removed; entry kind browser -> web (c2's newTabEntryRun.ts + test, as agreed in bug 1220); space copy now
   "In use: a tab is open or an agent is running".
4. **Web pane, Rust side** (HEAD commit, bugs 1105-backend, 1143, 1601; 42 files, +1538/-13692). 23 pane modules and the browser CLI verbs
   deleted. Kept: net.rs (URL policy + HTTP client for update.rs and web_icon.rs), webview_args.rs, webview_engine.rs (app crash watch, PDF
   print), tower_window.rs, pdf_export.rs, html_preview.rs, engine_crash.rs. Command names unchanged, so no frontend change needed.
   Proof: `cargo test --lib` -> 2937 passed, 2 failed before the CLI test fix; after: `cargo test --lib cli::` -> `165 passed; 0 failed`;
   `cargo test --test '*'` -> every file ok except cards_10 (34 fail on its scratch-home guard: "no .kolux-rs-scratch marker", environment,
   not code); `cargo clippy --all-targets` -> no warnings; `node scripts/invoke-contract.mjs` -> only failure is src/browser/useBrowserChords.ts
   (o1-tools' leftover folder, to be deleted).
   Behaviour note: an HTML preview's relative CSS/images now get 403 (the "Allow folder" button was in the pane) -> bug to o1-tools 1830.

Proof (frontend, run fresh at end of round):
- `npx tsc --noEmit` -> 1 error, `src/settings/shortcutRows.ts(9,102): 'browser' does not exist in type 'Record<Scope, string>'` (o1-tools'
  file; my removal of the browser key scope exposes it; bug o1-tools/20261112-1730 has the one-line fix).
- `npx vitest run src/terminal src/shell src/chrome src/keys src/status src/look src/sleep src/space src/lazy src/launch src/main.slowStart.test.ts`
  -> `Test Files 282 passed (282)  Tests 1739 passed (1739)`

Investigated, not fixed: bug 1155 (new terminal ~1.05 s; Kolux part 156-352 ms, shell start 647-698 ms). TerminalPane registers its event
listeners together (Promise.all, TerminalPane.tsx ~938) before terminal_spawn, so that is not the delay. Needs a live profile of split ->
mount -> xterm open/WebGL context -> spawn.

## Next round
1. Bug 1155: profile the new-pane path live (o2's `node scripts/stress/run-all.mjs --instances 1 --only latency`), cut Kolux's part, and
   propose a kept-warm shell (one pre-started pty per folder) to Txais as the way to 300 ms with a real PowerShell profile.
2. Native terminal: settle whether the engine draws on screen (screen capture, not PrintWindow), then the 1621x873 size after overlays.
3. Retitle zoom.in/out/reset ("Zoom Browser In" ...) if they now zoom the window; 8-pane GPU measurement; next TerminalPane split.

## For the coordinator
- Merge order: o1-tools must apply bug 20261112-1730 (drop `browser` from shortcutRows AREAS + test ids, repoint scm/ports/editor
  imports) in the same rotation, or tsc is red after merging lane/c3-terminal. Then src/browser/ can be deleted.
- c2-agents: the agent-shell wrap (a)/(b) landed in 2cb2e273; (c)/(d) already held. tower/entry.test.ts needs the language mock fix (bug 1700).
- CHANGELOG: "Agents now start inside your own shell, the same as typing `claude` yourself." / "The built-in web pane is gone; web
  addresses open in your own browser." / "Kolux's core is about 14,000 lines smaller."
- DECISIONS rows: "2026-11-12: agent panes run the user's shell, which starts the agent (agents::agent_shell::via_shell in Terminals::spawn)."
  "2026-11-12: web pane Rust side removed; net.rs keeps the update/icon HTTP client; Tower window, PDF export and HTML preview keep their command names."
- Decision for Txais (via o1-tools bug 1830): HTML preview should auto-allow its own folder, or show the document only.
- Evidence local only: test output above; no screenshots this round (no visual change).
