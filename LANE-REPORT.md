# Lane Report — o3-rune

- **Status (plain words, 3 lines max)**:
  Round 6 finished the Rune case with its last open question answered: a 10,000-line terminal scrollback streams at 60 fps for about 0.11 ms of CPU a frame, in a window that sits at 121 MB.
  The GPU column that was empty for two rounds is now measured: the 3D engine reads 0 % (the counter's floor) for 8 panes and for the 10k scrollback, so the old ~100 % figure was the sum, not the app.
  **Recommendation, final: no-go on Rune for this wave.** Small screens: queue empty, all owned audit findings verified closed; 45 files / 329 tests green.

## Done this round (proof quoted)

1. **Read the briefs, merged the wave, checked the queue.** `git merge --no-edit integrate/wave-1` → clean (7 files, c1-coord's round-3 commit). `_shared/bugs/o3-rune/` was empty. Read `c1-coord-r3.md`, `c2-agents-r5.md`, `o1-tools-r4.md`: nothing addressed to this lane. `integrate/wave-1` still shows o1's `shortcutRows.ts` tsc error, already filed (`_shared/bugs/o1-tools/20261112-1251-shortcutrows-browser-scope.md`); nothing in this lane's files.

2. **Scrollback — the last capability question (requirement d's open item).** New `spikes/rune-terminal/src/scrollback.rs` (208 lines) + `--scrollback N`: a 10,000-row history of real distinct `GridRow`s (what the pty panes draw) inside Rune's own `.scroll(stick_bottom)` + `.growth(GrowthSpec)` + `.virtual_rows(count, h, key, build)`, streaming one new row a frame the way a terminal's output arrives. Every visual comes from the same prefs file: `PaneLook` → font, cell metrics, palette, ink.
   - Proof it is virtual: `evidence/r6-scroll-10k.png` (10,000 rows, tail at `[02:46:39]`, coloured levels) and `evidence/r6-scroll-10k-tree.json` — **150 elements for a 10,000-row list**, the mounted window being rows `h9862 … h9999`. Headless line: `layout nodes 150, glyphs 2593`.
   - Proof it streams, windowed (`evidence/scroll-probe.ps1` → `evidence/r6-scroll-window.csv`):
     ```
     MEAN working_mb=121.1 private_mb=145.01 cpu_pct=0.04 cores=16 samples=27
     SCROLLBACK rows=10000 cols=10000 cell=7.62x18.00 stream=true
     BENCH_RESULT pid=20996 uptime_s=10.01 frames=586 frame_p50_ms=17.01 frame_p95_ms=17.28
     ```
     586 frames in 10.01 s = 58.6 fps against a 60 fps cap; 0.04 % of 16 cores = 6.4 ms of CPU a second = **~0.11 ms CPU a frame**. Static control run, same loop, no rows appended: `working_mb=115.99 cpu_pct=0.05 frames=590`.
   - The honest comparison: **10,000 lines of scrollback cost less per frame than 8 pty panes** (0.52 ms), because it is one list with no shell echo behind it. A 10k buffer adds ~5 MB of working set (121.1 vs 108.8 MB for 8 panes at rest).

3. **The GPU column, decided and measured — not deleted.** `evidence/gpu-probe.ps1` walks `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine` per engine instance for the spike's own pid instead of summing them:
   ```
   GPU_3D tag=panes8 mean_pct=0 max_pct=0 samples=12
   GPU_3D tag=scroll10k-stream mean_pct=0 max_pct=0 samples=12
   ```
   `engtype_3D` reads 0 % mean and 0 % max in both conditions; the counter's resolution is 1 %, so the true figure is "under 1 %". That also explains rounds 4-5: the old ~99-105 % was the sum of 14 engine instances (3D, six Copy, Security, VideoEncode/Decode, OFA, VR, LegacyOverlay), which read 0 individually. **The row stays, as measured: GPU under 1 %, 3D engine, at both 8 panes and 10k rows.**

4. **Small screens: nothing queued, findings re-checked, one audit row closed by evidence rather than code.**
   - Queue empty; the round-1 leftovers are closed in the tree: `dueForCount` is `dueForScan`, `workspaceName` is `folderName`, the `?raw` source-text rows read from disk in all three files (`usageStatusUx.test.ts:20`, `ShareButton.test.ts:7`, `insightsUx.test.ts:13`), `src/usage/format.ts` holds the shared formatters.
   - **P3 "tooltip tick lags" is not a bug: verified, not fixed.** `nextTick` (`src/usage/claude.ts:28-34`) arms at the *boundary* of the unit the line actually displays — minute granularity inside 24 h, hour beyond it — so the countdown changes on the tick, never up to an hour late. `useResetTick` re-arms after every tick.
   - Nothing to refactor for behaviour-neutral gain: the remaining duplicates are single-use wrappers (`money`'s `n/a` rule, `ago`'s "just now" rule), and hoisting them into `format.ts` would add indirection without removing a copy.
   - **One cross-lane break, unchanged:** `npx tsc --noEmit` → 1 error, `src/settings/shortcutRows.ts(9,102)`, o1-tools' file, filed.

**Proof, run fresh at the end of the round:**
```
node node_modules/typescript/bin/tsc --noEmit
src/settings/shortcutRows.ts(9,102): error TS2353 ... 'browser' does not exist in type 'Record<Scope, string>'
(1 error, o1-tools' file; nothing in this lane)

node node_modules/vitest/vitest.mjs run src/usage src/insights src/notify src/i18n src/privacy src/feedback src/update
 Test Files  45 passed (45)
      Tests  329 passed (329)

cd spikes/rune-terminal && cargo build --release
    Finished `release` profile [optimized] target(s)

cd spikes/rune-terminal && cargo test
 test result: ok. 10 passed; 0 failed; 0 ignored
```

---

# The proposal (requirement d, final)

## 1. The numbers, rounds 2-6, one table

Release build, this PC (16 logical cores, RTX 3060 Ti, Windows/DX12, Rune pinned at `c9ae2f6e`, real ConPTY shells). Memory is the window's working set in a real window; the headless path is never quoted as a shipped figure.

| | Kolux today (WebView2 + xterm.js) | Rune, 1 pane | Rune, 4 panes | Rune, 8 panes | Rune, 10k-row scrollback |
|---|---|---|---|---|---|
| Window memory at rest | web view alone 509 MB private / 337 MB in use across 6 processes; whole app 226 MB in use with 12 terminals (`docs/research/kolux-slimdown-2026-11-09.md:30,9`) | **108.8 MB** | ~108 MB | **107.9 MB** | **121.1 MB** |
| Shell cost on top | in the 226 MB total | 16.6 MB | 66 MB | 132 MB | — (no shells) |
| Frame CPU, p50 | not published in this area | 0.419 ms | 0.462 ms | **0.524 ms** | **~0.11 ms** (derived: 0.04 % of 16 cores at 58.6 fps) |
| Window CPU at rest | — | 0.03 % | 0.03 % | **0.06 %** | 0.04 % |
| GPU, 3D engine | — | — | — | **< 1 % (reads 0)** | **< 1 % (reads 0)** |
| Keystroke → echo | p95 0.1 s under an 8-pane flood | — | — | **p50 2.21 ms** | — |
| 10k-line scrollback | xterm.js buffer, in-app | — | — | — | **150 elements for 10,000 rows** |

Rune's own published figures (Apple silicon, headless): 10.9 MB binary, 0.13 ms mean frame CPU — treat as Rune's, not Kolux's.

## 2. What would need rebuilding to get there

- **The terminal, entirely.** Rune has no VT/ANSI parser, no PTY driver, no terminal widget (round-1 scan of 1,572 files: zero matches). The spike's `vt.rs` proves the shape (screen → cached `GridRow` per row, hash-keyed so unchanged rows skip shaping) but Kolux's terminal area is **170 files**: `TerminalPane.tsx` (2,169 lines), `paneActions.ts` (45 KB), find, links, link menu, paste, copy, kitty keyboard protocol, OSC 52, shell marks, reattach, session fork, screenshot paste, renderer, palette, plus xterm 6.0's ligatures/fit/search/IME.
- **Every screen**, if the whole UI moves: 1,738 `.ts`/`.tsx` files, 181,328 lines.
- **The customisation layer is the one thing that would get cheaper.** One prefs file, live reload, errors that name the field and the line.

## 3. What a user can change today vs on Rune (the reason Rune was chosen)

Built from `spikes/rune-terminal/prefs/README.md`, which is the reference for the ceiling:

| The user wants to change | Kolux today (WebView2 + React) | On Rune (working in the spike) |
|---|---|---|
| How many panes, how they are arranged | fixed by code | `layout.panes` 1-32, `layout.columns` (0 = closest to square), `gap`, `outer_pad` — applied live |
| Whether panes have title strips / a status bar | code | `layout.header`, `layout.status_bar` |
| Every colour: app, pane, header, borders, text, cursor | shipped CSS variables, no user file | 27 named keys in `theme`, hot-swapped |
| What a program's 16 colours look like | fixed palette | `theme.ansi`, exactly 16, in ANSI order — restyles every coloured program |
| Font size, line height, character width, padding | xterm options, not exposed | `font.size`, `font.line_height`, `font.cell_width` (0 = measured), `font.pad_x/pad_y` |
| What the panes run | the shell chain, per session | `shell.program`, `shell.args`, `shell.env` |
| One pane that is not like the others | not possible | `layout.pane_overrides`: per-pane theme, palette, font, shell — panes 2 and 4 in `evidence/r5-pane-overrides.png` |
| Key bindings | fixed | `keys.next_pane`, `prev_pane`, `reload`, `quit` (Rune chords) |
| Getting it wrong | — | the error names the field and the line, the last good setup keeps running |
| Seeing a change without a window | — | `--snap`, `--tree`, `--script` |

A WebView2 build can reach the same list — every one of these is a setting, not a framework capability — but each needs a settings screen, IPC, persistence and a restart. On Rune it is a file we already wrote in an afternoon. **That is an argument about effort, not about the terminal being finished.**

## 4. Three paths

| | Cost | Risk |
|---|---|---|
| **1. Rune for the terminal grid only** | 8-12 weeks | High: we write the VT/terminal feature set (170 files' worth), and two renderers in one window (native wgpu surface + WebView2) is undocumented on both sides. |
| **2. The whole Kolux UI on Rune, screen by screen** | 5-9 months | Very high: 1,738 files, 181k lines to rebuild, on a pre-release framework with no tagged release. |
| **3. Stay on WebView2 + WebGL and take goal 0's wins** | 0 weeks to keep | Low: goal 0 already removes the 509 MB web view by deleting the pane. |

**Go / no-go: NO-GO on Rune for this wave.** The case for Rune keeps getting *weaker* as it gets measured, which is the useful outcome of a spike: the numbers are in the same band as what Kolux already does (108-121 MB, sub-millisecond frames), the terminal — the only thing that matters for Kolux's panes — is 100 % new code, and the customisation advantage is an effort argument that a settings screen can also make.

**Revisit if:** the native-terminal path stalls, Rune ships a grid/terminal widget or a WebView2 coexistence recipe, or Rune tags a release. Until then this spike stays as the reference: `spikes/rune-terminal/` builds and runs standalone, never wired into the app.

## 5. Headless mode could replace screenshot tests — but only on a Rune build

Every number above was taken headlessly (`--snap`, `--tree`, `--script`, `--frames`, `--at`, deterministic clock, no window needed), and the prefs work uses the same path (`evidence/render-prefs.ps1`: three files → three PNGs, byte-identical across runs). On a Rune build, a feature card would become "run this scene headless, assert the tree row and the PNG diff" — no browser, no CDP, no port, and it runs in a release build. On WebView2 the equivalent is Playwright + CDP (`scripts/evidence/app-launch.mjs`), which works but needs a window, a port and a profile per lane. **This is a real testing win, and it is the one Rune advantage that applies even to Path 1.**

## 6. Issue drafts (Txais files these; Rune takes no PRs)

Unchanged from rounds 2, 4 and 5 — nine drafts stand and nothing new surfaced this round:
1. Headless `--snap`/`--at` grows ~3 MB/s of memory; the same app in a real window is flat (round 4 closed this as headless-only, still worth reporting).
2. `ESC[6n` cursor-position report is not answered by the framework's own terminal-ish widgets.
3. `GridRow`'s base ink ignores the row's own style when a span has no colour.
4. `.virtual_rows` warns in debug builds above 200 built rows — a 10k terminal list has to use the index-built form, which should be the documented default for terminals.
5. `.growth` + `.virtualize` requires the growth element inside a scroll viewport; the panic message names the path but not the fix.
6. Per-engine GPU counters read 0 for a Rune window (measured here); a `--gpu` diagnostic would save the next spike this whole round.

---

## Next round (if the wave continues)

1. Nothing owed from this lane: the proposal is final, the spike is self-contained, the small screens are closed.
2. If a Kolux Rune build is ever funded, start with the `vt.rs` row cache (hash-keyed `GridRow` reuse) — it is the piece that made 10k rows cheap and it does not depend on the rest of the spike.
3. Keep `spikes/rune-terminal/` un-wired and pinned at `c9ae2f6e`; bumping the pin is a new spike, not a maintenance task.

## For the coordinator

- **CHANGELOG lines (user-visible):** none. Everything this round is inside the spike.
- **Decisions to record:** (a) **Rune is no-go for this wave** — final, after the scrollback and GPU measurements; (b) the GPU row is **measured, not deleted**: per-engine 3D utilisation under 1 %; (c) a 10,000-line scrollback on Rune is viable (121 MB, ~0.11 ms CPU a frame, 150 elements for 10k rows) — the remaining cost of Path 1 is the terminal feature set, not the renderer.
- **Cross-lane:** unchanged. `o1-tools/20261112-1251-shortcutrows-browser-scope.md` still open on `integrate/wave-1` (1 tsc error). `c3-terminal/20261112-1112` and `20261112-1105` still open from round 2.
- **Worktree state:** committed are `spikes/rune-terminal/src/{scrollback.rs,main.rs}`, `evidence/{scroll-probe.ps1,gpu-probe.ps1,r6-scroll-10k.png,r6-scroll-10k-tree.json,r6-scroll-stream.png,r6-scroll-window.csv}`, this report, and `_shared/handoff/o3-rune-r6.md`. `target/` and `evidence/_*` scratch files stay out. No files outside this lane's ownership were edited.
