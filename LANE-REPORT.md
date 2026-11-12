# Lane o1-tools — Round 2 Report

## Status

The web pane is gone: 68 files deleted, and every address the app or an agent shows now opens in the
user's own browser. A local try no longer means an installer: `pnpm local` builds and starts Kolux in
minutes beside the installed copy, with its own settings. Round 1's audit and measurements are in
`AUDIT-o1-tools.md`; this file is round 2.

## Done this round

### 1. Goal 0, my half: the web pane is deleted

Commit `30830263` — "Remove the web pane: web addresses now open in the user's own browser (goal 0)".

- Deleted from `src/browser/`: the pane and everything that only served it (address bar, drawing,
  grab/annotate, cookies, downloads, history, menus, chords, zoom, tips, site chrome, its CSS) plus
  all 8 feature cards. 68 files, ~13k lines.
- `notePdf.ts` (+ test) moved to `src/editor/`, where its only caller lives (Markdown note PDF export,
  EDIT-018).
- New `src/open/openExternal.ts`: one wrapper around `open_external`. Ports, Checks review links, the
  HTML preview, chat links and (through the shim) the terminal's link path all use it.
- Settings: "Open links in Kolux" and the terminal's "Open web links in the Kolux browser" are gone,
  with their search entries, the `browserSearchSessionUrl` secret key and the two Privacy rows that
  named the pane.
- Six small helpers stay only because c3-terminal's window shell still imports them
  (`openIn.ts` rewritten to open the system browser, `pages.ts`, `preview.ts`, `useBrowserChords.ts`,
  `address.ts`, `chord.ts`) and `BrowserPane.tsx` is a 40-line stub that draws "open in your browser"
  with no web view, no browser IPC and nothing warm. c3-terminal has the exact list:
  `_shared/bugs/c3-terminal/20261112-1215-browser-pane-gone-repoint-last-imports.md`.

Proof:
- `npx tsc --noEmit` → exit 0, no output.
- `npx vitest run src/browser src/ports src/scm` → `Test Files 49 passed (49) · Tests 408 passed (408)`.
- `npx vitest run src/settings src/editor src/chat` → `Test Files 245 (2 failed) → fixed → re-run
  Test Files 37 passed (37) · Tests 390 passed (390)` on the changed files. (The two failures were
  my own assertions naming the deleted pane: `src/settings/privacy.test.ts:78` and
  `src/editor/t756.test.ts`, both updated.)
- `pnpm check` → license-check OK, plan-check OK, glossary-check OK (61 labels), workflow-check OK,
  invoke-contract OK (761 calls by name; 806 before the pane's commands went), memory tests pass.
  **guide-check fails**: `docs/guide/files-and-browser.md` still lists four deleted files. That file is
  c1-coord's, filed as `_shared/bugs/c1-coord/20261112-1218-web-pane-gone-docs-cards-and-ownership.md`.
- `grep -rn 'invoke("browser' src | grep -v src/browser/` → one line, `browser_preview` in
  `src/editor/htmlPreview.ts:15` (EDIT-025, keep). So the webview commands are safe to remove on the
  Rust side.

### 2. The fast local loop

- `scripts/local-run.mjs` + `"local"` in package.json `scripts` + `docs/dev-loop.md`.
- `pnpm local` = `npx tauri build --no-bundle --no-sign --ci --config <temp config>`, with the release
  profile's expensive parts switched off through cargo's environment overrides (thin LTO, 16 codegen
  units, opt-level 2, not stripped, incremental), the identifier `com.txaisxiong.kolux.local`, and the
  name "Kolux Local". It then starts the exe it built and prints where that app's settings live.
- No Cargo.toml edit is needed: the overrides are environment variables, so this does not wait on
  c3-terminal's `[profile.local]` and cannot conflict with it.
- Measured: **9 m 54 s** cold (empty target), **3 m 35 s** warm, against 19 m 55 s for
  the shipped release profile and 30-45 min for an installer. Logs: `evidence/local-build-cold.log` (594 s), `evidence/local-build-warm.log` (216 s).

### 3. Queued bugs

| Bug | Result |
|---|---|
| `20261112-1152-lexical-053-type-args` | **fixed** (`ca2ec548`): no type arguments on `getFirstChild`/`getChildAtIndex`; `$isElementNode` narrows instead. The 0.52 → 0.53 bump can land. |
| `20261112-1102-outbound-browser-pane-rows` | **fixed**: both Privacy rows rewritten; the pane is no longer named anywhere in Settings. |
| `20261112-1131-browser-rust-removal-handshake` | **done**: c3-terminal has the import list, and the one remaining `browser_*` invoke is `browser_preview`. |
| `20261112-1140-entry-url-and-space-copy` | **my half fixed**: the entry box's address opens in the system browser. The kind rename and the space copy are c2's and c3's; forwarded. |
| `20261112-1601-keep-browser-tower-rs` | **confirmed, no action needed**: already in c3's keep-list bug. |
| `20261112-1602-browser-pane-callers-in-c2` | **my half done**: the three files c2 does not own are forwarded to their owner, c3-terminal. |
| `20261112-1130-native-terminal-toggle` | **deferred, with reason**: the setting it writes is still only on `lane/c3-terminal`. A switch for a key nothing reads is the exact lie N-44 found. Next round, once that setting has merged. |

Files moved to `_shared/bugs/done/` with a `fixed-by:` line: six of the seven.

## Next round

1. **`src/browser/` gone for real**: c3-terminal's import switch (filed), then delete the six shims, the
   stub and its tests. Watch for their "remove the Rust browser modules" PR and keep the four keep-list
   modules (net.rs, tower, pdf, preview).
2. **The native-terminal switch** in Settings > Terminal, once `terminalNative` has merged; file the
   glossary label to o3-rune.
3. **The three worst live bugs in my screens** that do not depend on anyone else: N-03 (every open
   editor tab re-stamps its file on disk every 2 s), N-07 (right-click shows no menu outside an input,
   so no Copy in the preview, chat or diff cards), N-16 (the Checks tab frozen on a single status read).

## For the coordinator

- **CHANGELOG lines:**
  - "Web pages now open in your own browser. Kolux no longer draws web pages itself, which uses far
    less memory and lets you run more agents at once."
  - "A local build command (`pnpm local`) builds and starts Kolux in a few minutes, with no installer
    and without touching your installed copy."
- **DECISIONS row requested:** retire the embedded browser pane (Txais 2026-11-12); links open in the
  system browser; native terminals are the focus. Evidence:
  `docs/research/kolux-slimdown-2026-11-09.md` (web view ≈ 509 MB across 6 processes).
- **Ownership:** register `src/open/` (one file, `openExternal.ts`) as o1-tools' for this wave. It was
  asked for in round 1 and not answered; five of my files and the terminal's link path use it.
- **spec/ cards:** BROW-001, 002, 003, 005, 008, 009 and BROW-051 are still counted as passing P0 cards
  and their tests were deleted with the pane. Move them to "Hidden and retired (H)", and drop "browser
  tabs" from README.md:43.
- **gate now:** `pnpm check` is red on `guide-check` only, in c1's `docs/guide/files-and-browser.md`,
  until the four dead markers there are removed. Filed. `tsc`, vitest on my areas, plan-check,
  glossary-check, workflow-check, invoke-contract and the memory tests pass.
