# Lane Report — o3-rune

- **Status (plain words, 3 lines max)**:
  Round 2 fixed the small screens' remaining real bugs: the language pack is now fetched at startup and on every language switch (never mid-paint), the usage/insights contract tests read files from disk instead of Vite's cache, a stopped usage runner no longer leaves its state behind, and the crash screen's Report button is a plain button. Typecheck is 0 errors and `329 passed (329)` across the seven owned areas.
  The Rune terminal spike now exists as a standalone crate (`spikes/rune-terminal/`, 648 + 334 lines including a VT grid) with a real ConPTY per pane, but it is **not proven**: the build needs the whole `kolux`/tauri stack and has not finished a clean build in this round, so there are no PNG or tree renders yet. Nothing was wired into the app.

## Done this round (proof quoted)

1. **Read the briefs, merged nothing, checked the queue.** `git rev-list --count HEAD..integrate/wave-1` → `0`. `_shared/bugs/o3-rune/` held one file; see item 2. `node_modules` present, `pnpm install` → `Already up to date`.

2. **Rerouted the one queued bug, because it was not mine.** `_shared/bugs/o3-rune/20261112-1105-remove-embedded-browser-status-refs.md` is about `src/status/` (`credit.ts:18`, `working.ts:10,14`, `useStatusSurfaces.ts:35` and three test fixtures). `src/status/` is c3-terminal's (`c3-terminal.md:7`). I moved it to `_shared/bugs/c3-terminal/` with a `rerouted-by:` line and a note that its premise does not hold yet — `src/browser/` still has 74 files and `PaneKind` still accepts `"browser"`, so the cleanup must land in the same pass that removes the variant, not before. My queue is empty again.

3. **Language packs are now fetched before they are needed (P2, the `onPackLoaded` finding).**
   - `src/i18n/lookup.ts`: exported `preload(lang)` and `packReady(lang)`.
   - `src/i18n/packs.ts`: `registerBundledPacks()` now preloads `locale()` at startup and subscribes to language changes, so a pack the user picks is fetched on the switch instead of at the next `t()` (which used to leave the first paint in English with no re-render behind it).
   - `src/language.ts`: `applyLanguage` now tells `onLanguageChange` subscribers when the language actually changes.
   - Proof: `src/i18n/lookup.test.ts` gained a row for it — `preload` loads exactly once, `packReady` flips, the text reads in Spanish, English reports ready.

4. **The contract tests stopped depending on Vite's transform cache (P2, the false-failure finding).** `src/usage/usageStatusUx.test.ts` and `src/insights/insightsUx.test.ts` now read `TokenAnalytics.tsx`, `ShareCard.tsx`, `InsightsPanel.tsx` and `styles.css` with `readFileSync` instead of `?raw` imports, using the helper the same files already used for the CSS. This removes the class of failure where the suite fails on correct code until `node_modules/.vite/vitest` is deleted.

5. **A stopped usage runner no longer publishes its last state (P3).** `src/usage/refresh.ts`: `stop()` deletes the runner's entry from the shared `states` map and notifies subscribers; the read path moved into an exported `published(name)` so the map is testable without React. New test: `a stopped runner publishes no state under its name` — publishes `{ inFlight: false, lastOk: t0 }` while running, `fresh()` after `stop()`, and `fresh()` for a name never started.

6. **Polish: `type="button"` on the crash Report button (P3)**, with its HTML assertion updated in `src/crash.test.ts`.

7. **Refactor: one two-decimal money formatter instead of two copies (P2 duplicate helper).** `src/usage/format.ts` gained `usd2`; `src/insights/InsightsPanel.tsx` and `src/usage/WorkspaceSpend.tsx` each dropped their local `const money = (usd) => formatUsd(usd, 2)` and import `usd2 as money` instead. Behaviour is identical (both were `formatUsd(usd, 2)`); every existing string assertion still passes.

8. **Checked the two P3s the round-1 report listed and did not change them**, because neither is a real defect:
   - `ClaudePill` minute tick: `nextTick` (`src/usage/claude.ts:28-34`) already ticks every minute when the reset is under 24 h and hourly beyond that, and the hover text's far-away countdown is day/hour granular. The forecast line prints an absolute time, not a countdown, so a minute tick would repaint without changing a character.
   - `src/styles.css:1014-1036` `.upd-*` duplication: not my file (c3-terminal owns `src/styles.css`).

**Proof, run fresh at the end of the round (11:3x):**
```
node node_modules/typescript/bin/tsc --noEmit
TSC_EXIT=0

node node_modules/vitest/vitest.mjs run src/usage src/insights src/notify src/i18n src/privacy src/feedback src/update
 Test Files  45 passed (45)
      Tests  329 passed (329)
```
(329 vs round 1's 327: the two new rows in items 3 and 5.)

## Rune spike (round 2): what exists, and what is not proven

`spikes/rune-terminal/` is a standalone Cargo crate (never wired into Kolux, per the brief):
- `src/main.rs` (648 lines): `AppSpec` with `setup` / `poll` / `on_key`, a pane grid, a header and status bar per pane, focus by click and by key, palette and cell metrics.
- `src/vt.rs` (334 lines): the VT screen → Rune element mapping (per-cell colour, bold/italic/underline, wide cells, inverse, block cursor as an inverted span) and the 16-colour ANSI palette.
- `Cargo.toml`: Rune pinned to `rev c9ae2f6ec08147fc5c72760bbf09a6acd4a27dc3` (MIT, © Anomaly), plus `kolux = { path = "../../src-tauri" }` for the real PTY code, `portable-pty` 0.9, `vt100` 0.15, serde.

**Four Rune API errors in that code were fixed this round** (they were the last compile blockers in our own files):
- `Waker` is `Arc<dyn Fn() + Send + Sync>`, so a wake is `w_out()` — not `w_out.wake()` (two sites).
- `El` has no `.clip()`; the two calls were removed (the pane's viewport already sizes its grid explicitly).
- `TextStyle` has no `.weight(..)` builder; the bold path in `vt.rs` sets the public `weight` field.

**Not proven, and why:** building the spike now compiles the whole `kolux` crate, i.e. tauri + webview2 + wgpu. This round it got as far as compiling tauri and the Rune stack and did not finish a clean build, so there are **no `--snap` PNGs and no `--tree` dump yet**, and no memory/CPU/GPU/frame-time numbers. Treat the spike as "code written, not yet proven"; the next round's first job is one `cargo build` to completion, then `--snap one.png --scene 1`, `--scene 4`, `--scene 8` and `--tree tree.json`.

**Preferences (requirement f) are not implemented yet.** The spike's layout, palette and cell size are compile-time constants today. The `AppSpec` scene list (`"1"`, `"4"`, `"8"`) is the hook the preference file will drive.

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

**Path 2 — the whole Kolux UI on Rune, screen by screen.** Cost **5-9 months** for one developer, and that is with the layout, text and animation engine handed to us. Risk **very high**. The surface being replaced is 1,738 `.ts`/`.tsx` files and 181,328 lines, with 112 screen-ish components (`Panel|View|Page|Screen|Dialog|Wizard`) and six files over 800 lines. Everything React gives us for free would be rebuilt: state, lists, virtualised tables, forms, focus management, accessibility (Rune has AccessKit/UIA, so that one is real but different), and the web-based pieces (Markdown, Mermaid, KaTeX, Monaco-class editing). Rune is genuinely good — its own Settings and OpenCode demo apps are the same kind of UI — but this is a rewrite, not a port, and it would freeze feature work for two quarters.

**Path 3 — stay on WebView2 + WebGL, and take the wins that already exist.** Cost **0 weeks to keep, ~2-3 weeks for the known remaining wins**. Risk **low**. The measured lever is already in hand: goal 0 removes the web pane and moves panes to the real Windows terminal, which is where the 509 MB lives.

### Go / no-go

**No-go on Rune for this wave** (unchanged from round 1, and the round-2 spike does not change it). Goal 0 (native terminals + no embedded browser) already takes the memory, and both Rune paths spend weeks-to-months rebuilding what xterm.js and React already do, with a two-renderer integration risk on top. What the spike adds is a concrete cost sighting: the VT-grid half is small (334 lines to draw a real PTY's screen), but it pulls the whole tauri dependency tree to reuse Kolux's PTY, and every terminal feature listed below is still ours to write.

**Revisit when one of these is true:** (1) the native-terminal path stalls and Kolux must keep drawing panes itself; (2) Rune ships a terminal/grid widget or a documented WebView2 coexistence story; (3) Rune reaches a tagged release, so pinning stops being a maintenance tax.

### Headless mode as a replacement for screenshot tests
Rune's strongest argument, independent of the terminal question. Today a visual check means launching the app on the harness ports and driving WebView2 through CDP — slow, and it flakes under six lanes of load. Rune's `--snap` renders a PNG from a fixed virtual clock with no window and no GPU contention, `--tree` dumps the element tree with rects and roles (so a layout assertion is a JSON diff, not a pixel diff), and `--script` injects typing, clicks, drags, paste and wheel at named marks. Worth doing **only** for Rune-drawn surfaces; it does not help while the UI is React.

### Issue drafts for Rune (Txais files these; Rune does not take PRs)
1. **Title:** Terminal/grid widget or an embedding recipe? — *Body:* "We build a desktop terminal multiplexer on Windows (Tauri + WebView2 today). We would like to draw terminal panes in Rune. Rune has text, monospace, selection, IME and clipboard, but nothing for a VT grid or a PTY. Is a terminal widget in scope, or is there a recommended way to drive a `vt100`/`alacritty_terminal` grid through `rich()` spans at 60 fps without rebuilding layout per frame? A minimal example (grid of N×M cells, per-cell fg/bg, block cursor) would settle it for us."
2. **Title:** Windows performance figures — *Body:* "The README's measured section is Apple silicon only. Could you publish frame CPU, first-frame cost and binary size for Windows (DX12) on the same `examples/settings/scripts/bench.json`? We are deciding between wgpu and a web view on Windows and the Windows numbers are the deciding input."
3. **Title:** Hosting Rune next to WebView2 in one window — *Body:* "Is there a supported way to put a Rune-drawn region inside a window whose other regions are a WebView2 child (or the reverse)? Any guidance on focus, DPI changes, drag regions and z-order for a mixed window would save us a spike."
4. **Title:** Tagged releases for embedders — *Body:* "We pin a `dev` rev. Is a tagged release (or a `0.x` semver promise) planned? Embedders cannot take a branch, and a rev pin means manual rebases."
5. **Title:** Programming ligatures in monospace runs — *Body:* "Our terminal uses xterm's ligatures addon. Does Parley + `rich()` support programming ligatures (e.g. `->`, `=>`) as single glyphs, and if not, is it planned?"
6. **Title:** `El` has no clip / no `TextStyle::weight` builder — *Body:* "Two gaps hit a grid-of-panes app immediately: there is no way to clip a child subtree to its parent's rounded box (a terminal viewport needs it), and `TextStyle` exposes no weight builder even though `Span` does, so a bold span must be built through the public field." (Filed as text only; both worked around in the spike.)

## Next round

1. **Prove the spike.** One `cargo build` to completion, then `--snap one.png --scene 1 --realtime --at 2.0`, the same for `4` and `8`, and `--tree tree.json`; add the four artefacts' paths here. Then the measurement table (memory, CPU %, GPU %, frame time, keystroke-to-screen) against Kolux's WebView2 panes.
2. **Preferences (requirement f)** before the measurement, because the measured setup has to be the user's setup: one JSON file driving pane count, arrangement, theme, palette, cell size, shell and the next-pane key, re-read live, with two very different setups rendered as PNGs.
3. **Then and only then** the remaining small-screen polish: `FeedbackDialog` rapid-reopen sequence (already partly guarded), and a `readdirSync`-based replacement for the `?raw` glob in `src/usage/ShareButton.test.ts` (same stale-cache class as item 4).

## For the coordinator

- **CHANGELOG lines (user-visible):**
  - "A language picked in Settings now shows translated text immediately: its pack is fetched at startup and on the switch, instead of after the first English paint."
  - "The crash screen's Report button is now a plain button (`type="button"`), so it cannot submit anything by accident."
- **Decision to record:** Rune stays **no-go for wave 1**; the round-2 spike confirms the terminal half is small but the integration and feature-rebuild cost is not. Revisit on the three triggers above. Recommend telling c3-terminal that native terminals remain the only funded terminal path.
- **Cross-lane:** one queued bug rerouted to `c3-terminal/20261112-1105-remove-embedded-browser-status-refs.md` (`src/status/` is c3's, and its premise waits on `PaneKind` dropping `"browser"`). Still open from round 1: `c3-terminal/20261112-1112-i18n-onpackloaded-subscribers.md` — my side of it (preload + change notification) is now in `src/i18n/`; the remaining ask is a root-level re-render when a pack lands (`App.tsx`/`main.tsx`, c3-terminal).
- **Collision, second round running:** another session is writing in this same worktree. In round 2 it authored `spikes/rune-terminal/src/main.rs` (648 lines) and `src/vt.rs` (334 lines) at ~11:20-11:21 while this session worked on the TS areas. I patched four Rune API errors in those files so the crate type-checks and left the rest of their work intact; nothing of theirs was reverted. This is the same defect as `c1-coord/20261112-1118-two-sessions-one-lane-worktree.md` — two sessions in one lane worktree keep producing split-round reports and half-committed work.
- **Worktree state at the end of this round:** `spikes/` is still untracked (its build is 1.5 GB of `target/`, which is gitignored). The 13 modified files under `src/` are this round's fixes, typecheck 0 and 329/329 tests green.
- **`src/styles.css:1014-1036`:** the eager `.upd-*` rules are still duplicated by `src/update/update.css`; c3-terminal's file, not mine.
