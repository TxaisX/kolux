# Lane Report — o3-rune

- **Status (plain words, 3 lines max)**:
  Round 1 audit is done and the six audit fixes that were sitting uncommitted in this worktree are verified green (typecheck 0 errors, 327 area tests pass). Rune was read end to end: it has no terminal support at all, but it does have IME, clipboard, selection, monospace text and a full headless snapshot/tree/script harness. Recommendation is **no-go on Rune for this wave** — native Windows terminals (goal 0) buy the same memory win sooner and cheaper; the numbers and three paths are below.

## Done this round (proof quoted)

1. **Read the briefs, merged nothing, checked the bug queue.** `git rev-list --count lane/o3-rune..integrate/wave-1` → `0` (nothing to merge). `G:\Dev\kolux-lanes\_shared\bugs\o3-rune\` → empty. `node_modules` present.

2. **Verified the tree this round inherited.** Six audit fixes (P1 Claude `resetsAt` ms→s, P2 `hosts.test.ts` wording, P2 stale `onboarding.connect.wait` in 5 packs, P2 `pricing.ts` index + memo, P3 `lookup.ts` pack retry, P3 unmount guards) were uncommitted in the worktree when this round started; they were written by an earlier session in this lane, not by this audit.
   - `node node_modules/typescript/bin/tsc --noEmit` → `TSC_EXIT=0`
   - `node node_modules/vitest/vitest.mjs run src/usage src/insights src/notify src/i18n src/privacy src/feedback src/update` → `Tests  327 passed (327)` / `Test Files  45 passed (45)`, exit 0

3. **Fixed the one thing that was actually broken in the tests:** two source-text assertions in `src/usage/usageStatusUx.test.ts` still expected the pre-guard source. Updated to `.finally(() => mounted.current && setLoading(false))` and to the `if (!alive) return;` guard in the scope `catch`. That file then passed on its own: `Test Files 1 passed (1)` / `Tests 9 passed (9)`.

4. **Found and diagnosed a false test failure** (not a code bug): the 45-worker suite failed twice on correct code because Vite served a stale cached transform of the `?raw` import. Proof: `Get-FileHash` on `TokenAnalytics.tsx` unchanged across 20 s with the expected text present; single-file run passed; after `Remove-Item node_modules\.vite\vitest -Recurse -Force` the full area suite passed (`Tests 327 passed (327)`). Filed to o2-tests.

5. **Extended `AUDIT-o3-rune.md`** with section 2a (Rune capability check), 2b (the cache finding) and section 3 (status of every round-1 finding against the current tree).

6. **Filed two bugs:** `_shared\bugs\c1-coord\20261112-1118-two-sessions-one-lane-worktree.md` (two agent sessions were editing this lane's worktree at the same time — see below) and `_shared\bugs\o2-tests\20261112-1118-stale-vite-cache-fails-source-text-tests.md`.

**Not done, on purpose:** no `spikes/rune-terminal/` code. Round 1 is audit-only, and the brief says do not wire Rune into the app this wave.

## Rune: the numbers, three paths, one recommendation

### What was read (not measured)
`https://github.com/anomalyco/rune` at `dev` rev `c9ae2f6ec08147fc5c72760bbf09a6acd4a27dc3`, cloned read-only to `G:\Dev\rune-ref`. 18 crates, MIT, © Anomaly.

### Side by side

| | Kolux today (WebView2 + xterm.js) | Rune at the pinned rev |
|---|---|---|
| Terminal panes | xterm 6.0 + WebGL, ligatures, fit; 170 files in `src/terminal/` | **none.** No PTY, no VT/ANSI parser, no terminal widget: 0 matches in 1,572 `.rs`/`.toml` files |
| Web view cost | **509 MB private / 337 MB working set across 6 processes** (measured, `docs/research/kolux-slimdown-2026-11-09.md:30`); whole app 544 MB with 12 terminals (line 9) | no web view at all; Rune's own published binary is 10.9 MB (9.3 stripped) — *their* number, macOS |
| Frame cost | not published for the terminal path in this area | Rune's own: 0.13 ms mean / 0.29 ms p95 CPU per frame, 174 instances, one draw call (Apple silicon, headless 2×) — **no Windows figure exists** |
| Windows renderer | Chromium's | wgpu DX12 (`render.rs:584-616`), DirectWrite / Windfoil / ClearType text |
| IME | Chromium | yes (`Ime::Commit`, `ime_cursor`) |
| Clipboard | yes | yes (text, CF_HTML on Windows, PNG) |
| Selection / search / links / kitty keys / OSC 52 | yes, all shipped and tested | selection yes; the rest would be new code on our side |
| Headless testing | Playwright against the web view, plus DOM tests | `--snap`, `--tree`, `--script`, `--frames`, `--trace`, `--video`, deterministic virtual clock, `headless_run()` readable in-process |
| API stability | Chromium/Tauri, stable | pre-release `dev` branch; pinning a rev means manual updates forever |

### The three paths

**Path 1 — Rune for the terminal grid only.** Cost **8-12 weeks** to something shippable, and that is the optimistic case. Risk **high**. Reasons: (a) Rune has no terminal, so we write the VT parser, scrollback with reflow, selection, search, links, mouse reporting, kitty keyboard protocol, OSC 52 and IME plumbing — every one of those exists and is tested in `src/terminal/` today; (b) the harder problem is not the terminal, it is **two renderers in one window**: a Rune pane is a native wgpu surface and the rest of Kolux is WebView2, and neither framework documents hosting the other, so the likely outcome is a second top-level window with its own focus, drag, z-order and DPI behaviour; (c) pre-release API churn on a pinned rev. This path is only worth it if the terminal must stay inside Kolux's window *and* native terminals are rejected.

**Path 2 — the whole Kolux UI on Rune, screen by screen.** Cost **5-9 months** for one developer, and that is with the layout, text and animation engine handed to us. Risk **very high**. The surface being replaced is 1,738 `.ts`/`.tsx` files and 181,328 lines, with 112 screen-ish components (`Panel|View|Page|Screen|Dialog|Wizard`) and six files over 800 lines (`ProjectsPanel.tsx` 2,872, `TerminalPane.tsx` 2,169, `BrowserPane.tsx` 1,385 — and that one is being deleted, `SourceControlPanel.tsx` 1,368). Everything React gives us for free would be rebuilt: state, lists, virtualised tables, forms, focus management, accessibility (Rune has AccessKit/UIA, so that one is real but different), and the web-based pieces (Markdown, Mermaid, KaTeX, Monaco-class editing) that currently come from the web ecosystem. Rune is genuinely good — its own Settings and OpenCode demo apps are the same kind of UI — but this is a rewrite, not a port, and it would freeze feature work for two quarters.

**Path 3 — stay on WebView2 + WebGL, and take the wins that already exist.** Cost **0 weeks to keep, ~2-3 weeks for the known remaining wins**. Risk **low**. The measured lever is already in hand: goal 0 removes the web pane and moves panes to the real Windows terminal, which is where the 509 MB lives. Rune would replace that web view with something lighter, but native terminals remove the need for Kolux to draw terminals at all, which is the same win for a fraction of the work.

### Go / no-go

**No-go on Rune for this wave.** Not because Rune is bad — it is the most interesting native UI framework available to us, and its headless tooling is better than anything we have — but because goal 0 (native terminals + no embedded browser) already takes the memory, and both Rune paths spend weeks-to-months rebuilding what xterm.js and React already do, with a two-renderer integration risk on top.

**Revisit when one of these is true:** (1) the native-terminal path stalls and Kolux must keep drawing panes itself; (2) Rune ships a terminal/grid widget or a documented WebView2 coexistence story; (3) Rune reaches a tagged release, so pinning stops being a maintenance tax.

### What would need rebuilding, if we ever take path 1
VT/ANSI parser and grid; scrollback with reflow; selection and copy; find; link detection, safety check and the link menu; paste (including screenshot paste); mouse reporting; kitty keyboard protocol; OSC 52; shell marks and prompt tracking; session fork/reattach; pane grid layout, drag-resize and tab drag; per-pane status readouts; themes/palette; ligatures (xterm addon today).

### Headless mode as a replacement for screenshot tests
This is Rune's strongest argument and it is independent of the terminal question. Today a visual check means launching the app on the harness ports and driving WebView2 through CDP — slow, and it flakes under six lanes of load. Rune's `--snap` renders a PNG from a fixed virtual clock with no window and no GPU contention, `--tree` dumps the element tree with rects and roles (so a layout assertion is a JSON diff, not a pixel diff), and `--script` injects typing, clicks, drags, paste and wheel at named marks. If any surface moves to Rune, its regression tests get deterministic and about a second each. Worth doing **only** for Rune-drawn surfaces; it does not help while the UI is React.

### Issue drafts for Rune (Txais files these; Rune does not take PRs)
1. **Title:** Terminal/grid widget or an embedding recipe? — *Body:* "We build a desktop terminal multiplexer on Windows (Tauri + WebView2 today). We would like to draw terminal panes in Rune. Rune has text, monospace, selection, IME and clipboard, but nothing for a VT grid or a PTY. Is a terminal widget in scope, or is there a recommended way to drive a `vt100`/`alacritty_terminal` grid through `rich()` spans at 60 fps without rebuilding layout per frame? A minimal example (grid of N×M cells, per-cell fg/bg, block cursor) would settle it for us."
2. **Title:** Windows performance figures — *Body:* "The README's measured section is Apple silicon only. Could you publish frame CPU, first-frame cost and binary size for Windows (DX12) on the same `examples/settings/scripts/bench.json`? We are deciding between wgpu and a web view on Windows and the Windows numbers are the deciding input."
3. **Title:** Hosting Rune next to WebView2 in one window — *Body:* "Is there a supported way to put a Rune-drawn region inside a window whose other regions are a WebView2 child (or the reverse: WebView2 inside a Rune window)? Any guidance on focus, DPI changes, drag regions and z-order for a mixed window would save us a spike."
4. **Title:** Tagged releases for embedders — *Body:* "We pin a `dev` rev. Is a tagged release (or a `0.x` semver promise) planned? Embedders cannot take a branch, and a rev pin means manual rebases."
5. **Title:** Programming ligatures in monospace runs — *Body:* "Our terminal uses xterm's ligatures addon. Does Parley + `rich()` support programming ligatures (e.g. `->`, `=>`) as single glyphs, and if not, is it planned?"

## Next round

1. Commit the six verified fixes if they are still uncommitted when round 2 starts (they were another session's in-flight work this round), then fix the remaining P2s: i18n preload (the `onPackLoaded` bug is filed to c1-coord), duplicated `src/usage/` + `src/insights/` helpers, and the `?raw` → `readFileSync` swap in this area's contract tests.
2. Do not build `spikes/rune-terminal/` as a product spike; if the coordinator still wants the measurement, build the smallest honest one — one window, 8 panes of `vt100` output, `--snap` + `--tree` — and stop at the numbers. Budget 3 days, not a week.
3. P3 polish: `ClaudePill` minute tick, `type="button"` where still missing, `refresh.ts` `states` cleanup.

## For the coordinator

- **CHANGELOG:** nothing user-visible this round (audit + tests only).
- **Decision to record:** Rune is **no-go for wave 1**; keep WebView2 + WebGL and put the memory effort into goal 0 (native terminals, no embedded browser). Revisit on the three triggers above. My recommendation is to tell c3-terminal that Rune is not a competing path, so its native-terminal research is the only terminal path being funded.
- **Cross-lane:** two bug files filed — `c1-coord/20261112-1118-two-sessions-one-lane-worktree.md` and `o2-tests/20261112-1118-stale-vite-cache-fails-source-text-tests.md`.
- **Collision this round:** a second agent session was live in `G:\Dev\kolux-lanes\o3-rune` while this round ran (it wrote `src/usage/pricing.ts`, `Activity.tsx`, `UpdateCenterView.tsx`, `TokenAnalytics.tsx` and filed a c1-coord bug at 11:12). I did not revert or commit its files; the six fixes it wrote are verified green above. If the wave re-runs round 1, that is why. Fix in the harness is in the bug file (per-lane lock file + round number on disk).
- **Uncommitted by design:** the 13 source/test files that session changed are still uncommitted in the worktree; only `AUDIT-o3-rune.md`, `LANE-REPORT.md` and the two bug files are mine this round.
- **`src/styles.css:1014-1036`:** the eager `.upd-*` rules are still duplicated by `src/update/update.css`; not mine to edit.
