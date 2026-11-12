# Lane Report — o3-rune

- **Status (plain words, 3 lines max)**:
  Round 4 closed the spike's open risk: the memory growth was Rune's **headless** render path. In a real window the app is flat — 108 MB for 1 pane and for 8, unchanged over 3 minutes — so the shipped numbers now rest on a measurement, not an estimate.
  The spike now runs entirely from one user-editable preferences file (panes, arrangement, theme, ANSI palette, cell size, shell, key bindings), re-read live while it runs: swap the file and the window changes theme and pane count without a restart, and a broken file says why and keeps the last good setup.
  Small screens: `tsc` clean, 329 tests passing, one stale embedded-browser reference removed. Recommendation is unchanged: **no-go on Rune for this wave**.

## Done this round (proof quoted)

1. **Read the briefs, merged the wave, checked the queue.** `git merge --no-edit integrate/wave-1` → `Merge made by the 'ort' strategy.` (6 files, incl. `docs/research/kolux-audit-2026-11-12.md`). `_shared/bugs/o3-rune/` is empty: nothing queued for me.

2. **Answered the round-3 open risk: the idle growth is headless-only.** Same binary, same 8 real ConPTY panes, sampled once a second by `evidence/sample.ps1`:

   | run | window | first sample | last sample | slope |
   |---|---|---|---|---|
   | **windowed**, 8 panes | 60 s | 107.9 MB | 107.9 MB | **0.0 MB/s** |
   | **windowed**, 1 pane | 60 s | 108.8 MB | 108.8 MB | **0.0 MB/s** |
   | **windowed**, 8 panes | 180 s | 151.1 MB | 151.1 MB | **0.0 MB/s** |
   | headless `--snap --at 60`, 8 panes | 60 s | 205.1 MB | 383.8 MB | 3.0 MB/s |
   | headless, 8 panes, `--no-pty` | 60 s | 205 MB | 393.4 MB | 3.1 MB/s |
   | headless, 8 panes, `--fps 30` | 60 s | — | 388.6 MB | 3.0 MB/s |
   | headless, `--bare` (no poll, no panes) | 60 s | 170.6 MB | 182.7 MB | 0.23 MB/s |

   - **It is not the terminal.** `--no-pty` (new flag: a static grid, no shells, no pty threads) grows at the same 3 MB/s as 8 live shells.
   - **It is not per-frame work.** The same 60 s at `--fps 30` (1,801 frames, confirmed in the log: `rune: 151 frames at 30 fps` for a 5 s probe) reaches the same peak as 60 fps. The growth tracks wall time, not frames.
   - **It is not this app's frame code.** A `--bare` app (no poll hook, no panes, one text row) grows 0.23 MB/s; a full grid grows 3 MB/s, so the extra is inside Rune's forced-render path scaled by what it draws.
   - Committed evidence: `evidence/sample-window-8.csv`, `sample-window-1.csv`, `sample-window-8-180s.csv`, `sample-headless-8.csv`, `sample-headless-8-nopty.csv`, `sample-headless-8-fps30.csv`, `sample-headless-bare.csv`.
   - **Consequence:** the honest at-rest figure is the windowed one. The 225 MB quoted in round 3 was headless and should not be used for a shipped app.

3. **Fixed a defect in the sampler itself.** `sample.ps1 -Windowed` called `$p.WaitForExit()` before its `Stop-Process`, so a windowed run hung the script forever. Now it stops the process it started, then reads the samples: `samples 110  cores 16`.

4. **Preferences (requirement f): one file, live.** New `src/prefs.rs` (+ `prefs/midnight-focus.json`, `prefs/daylight-reading.json`):
   - `layout` (panes, columns, gap, outer pad, header on/off, status bar on/off, banner), `theme` (11 named colours + all 16 ANSI colours as `#rrggbb`), `font` (size, line height, cell width override, padding), `shell` (program, args, env — empty means Kolux's own shell chain), `keys` (chords in Rune's own syntax).
   - **Loud on typos, safe on breakage:** `deny_unknown_fields` names the bad key; a bad colour names the field; a broken file leaves the last good preferences running, shows the error in the status bar and recovers when the file is fixed.
   - **Live reload:** a mtime watcher ticked 2.5×/s (an idle window gets no poll otherwise), applied without restart, respawning panes only when the count changes.
   - **Proof, two very different setups:** `evidence/prefs-midnight.png` (4 panes 2×2, dark, blue accent, headers + status bar, 13 pt) and `evidence/prefs-daylight.png` (3 panes across, paper theme, no headers, no status bar, 15/22 pt, 18 px gaps, orange cursor, its own light ANSI palette). The light render is also what caught the grid-ink bug below.
   - **Proof, live reload while running** (`evidence/prefs-reload.ps1` → `evidence/prefs-reload.log`):
     ```
     PREFS_RELOAD file=evidence/_live-prefs.json panes=3 columns=3 theme=daylight-paper font=15/22 shell=powershell.exe gap=18
     PREFS_ERROR prefs: invalid type: string "three", expected usize at line 1 column 30
     PREFS_RELOAD file=evidence/_live-prefs.json panes=3 columns=3 theme=daylight-paper font=15/22 shell=powershell.exe gap=18
     ```
     (4-pane dark window → swapped to 3-pane light while running → broken file reported → fixed and applied again.)
   - **Six unit tests** for the parts that must not rot: defaults + typo rejection, hex parsing, bad colour/chord naming the field, grid maths, bindings from the file, and the watcher firing exactly once per rewrite.

5. **Fixed a real bug the light theme exposed (P2, spike).** Plain (uncoloured) cells drew in the window's default ink, so a light theme rendered near-invisible pale-on-pale text: `GridRow::new` takes no base colour and `Cx::foreground` never reaches a grid's rows (`crates/rune/src/runtime/commit/flatten.rs:299-311` only inks a node's own text). Fixed in `src/vt.rs` by giving every run a span with its resolved colour. Before: pale text on paper; after: `evidence/prefs-daylight.png` shows dark ink, cyan/yellow ANSI and a magenta underline on the light palette.

6. **Small screens.** `src/insights/model.ts:49` still described the removed embedded browser pane in a comment ("shells, seat choosers and browser/editor tabs left out"); it now reads "editor tabs". Re-checked the round-1 audit leftovers: `launchWarn.test.ts:35-37` does feed millisecond `resetsAt` values (`at(14) * 1000` → seconds), so that missing-test item is closed. Nothing else in the queue or the audit remains open for this area.

**Proof, run fresh at the end of the round:**
```
node node_modules/typescript/bin/tsc --noEmit
(no output)                     → exit 0

node node_modules/vitest/vitest.mjs run src/usage src/insights src/notify src/i18n src/privacy src/feedback src/update
 Test Files  45 passed (45)
      Tests  329 passed (329)

cd spikes/rune-terminal && cargo test
 test result: ok. 7 passed; 0 failed
 (6 new prefs tests + the existing vt row-cache test)

cd spikes/rune-terminal && cargo build --release
    Finished `release` profile [optimized]
```

## Rune spike: the numbers (round 4, release build, this PC)

All runs on `--release`, Rune pinned at rev `c9ae2f6e`, real ConPTY shells, Windows/DX12.

| | 1 pane | 4 panes | 8 panes |
|---|---|---|---|
| Frame CPU, p50 (ms) | 0.419 | 0.462 | **0.524** |
| Window working set at rest, windowed | **108.8 MB** | ~108 MB | **107.9 MB** |
| Window working set, headless | 225 MB | 225 MB | 225 MB (growing) |
| Shells, 2 processes each (MB) | 16.6 | 66 | 132 |
| Window CPU at rest, % of 16 cores | 0.03 | 0.03 | **0.06** |
| Keystroke → echo back (ms p50) | — | — | **2.21** |
| GPU, % summed engines | unmeasured | unmeasured | unmeasured |

The GPU column is dropped this round: the counter read ~100 % for a 1-pane window doing nothing, which is the counter, not the app (`win32_perfformatteddata_gpuperformancecounters_gpuengine` sums every engine instance). A frame-time p95 of 146 ms showed up in one render this round; that was six lanes building on the same PC at the time, not a stable figure.

**Two renderers' worth of user customization, for the proposal (requirement f):**

| | Rune (spike, working) | Kolux today (WebView2 + React) |
|---|---|---|
| Layout / pane arrangement | JSON file, applied live (`layout.panes`, `columns`, `gap`) | code + CSS; user cannot change it |
| Theme and ANSI palette | 27 colours in the file, hot-swapped | shipped CSS variables; no user file |
| Font, cell size, padding | in the file, measured or forced | xterm options, not exposed |
| Shell per pane | in the file (`program`, `args`, `env`) | not exposed |
| Key bindings | Rune chords in the file | fixed |
| How far it could go | anything the app reads from the file — Rune's own `--script`/variables show the ceiling is high, and it costs us nothing per feature | needs a settings screen, IPC, persistence and a restart for most of it |

## Rune: three paths, one recommendation (numbers refreshed)

| | Kolux today (WebView2 + xterm.js) | Rune at the pinned rev |
|---|---|---|
| Window cost | web view alone 509 MB private / 337 MB in use across 6 processes (`docs/research/kolux-slimdown-2026-11-09.md:30`); whole app 226 MB in use with 12 terminals (line 9) | **108 MB windowed for any pane count**, + ~16 MB per shell |
| Frame cost | not published in this area | 0.52 ms CPU p50 for 8 panes |
| Keystroke to screen | echo p95 0.1 s under an 8-pane flood | echo p50 2.2 ms |
| Terminal features | xterm 6.0: ligatures, fit, search, links, kitty keys, OSC 52, IME | selection and IME only; the rest is new code on our side |
| Testing | Playwright + DOM tests | `--snap`, `--tree`, `--script`, deterministic clock — how every number above was taken |
| Risk | stable | pre-release `dev` rev; no tagged release; headless renderer leaks (below) |

- **Path 1 — Rune for the terminal grid only.** 8-12 weeks, high risk: we write the VT/terminal feature set, and two renderers in one window (native wgpu surface plus WebView2) is undocumented on both sides.
- **Path 2 — the whole UI on Rune, screen by screen.** 5-9 months, very high risk: 1,738 `.ts`/`.tsx` files, 181,328 lines to rebuild.
- **Path 3 — stay on WebView2 + WebGL and take goal 0's wins.** 0 weeks to keep; goal 0 already removes the 509 MB web view.

**Go / no-go: still no-go on Rune for this wave.** Round 4 improves the case for Path 1's *cost* (108 MB windowed, flat, 0.52 ms/frame) and removes the memory caveat entirely, but the parts that decide it have not moved: every terminal feature is ours to write, the two-renderer integration is undocumented, Rune ships no tagged release, and its headless renderer still leaks. **Revisit if** the native-terminal path stalls, Rune ships a grid widget or a WebView2 coexistence recipe, or Rune tags a release.

**Issue drafts to add** (Txais files these; Rune takes no PRs): the round-2 six stand, plus:

7. **Headless/forced render grows memory while idle** — *Body:* "`--snap`/`--realtime` sessions grow working set ~3 MB/s while nothing draws and no input arrives: linear over 60 s (205 → 384 MB, 8 panes), identical at `--fps 30` and 60, so it tracks wall time rather than frames; a bare app (no poll, one text row) grows only 0.2 MB/s, so it scales with what the frame draws. A windowed run of the same app is flat (108 MB over 3 minutes), so it is the headless path only. Repro: any app, `--realtime --at 60`, sample `WorkingSet64` once a second."
8. **A terminal must answer `ESC[6n`** — *Body:* "Does the grid story include replying to the console host's cursor-position query? On Windows a ConPTY program sends `ESC[6n` before its prompt and waits for `ESC[row;colR`; without it every pane stays blank. Worth a line in the docs."
9. **`GridRow` has no base ink, and `Cx::foreground` does not reach it** — *Body:* "A row built with `GridRow::new` and no spans draws in the window's default white; `Cx::foreground` inks a node's own `TextSpec` (`runtime/commit/flatten.rs`, `take_foreground`) but not a grid's rows, so a theme with light backgrounds renders unreadable text unless every run gets an explicit span. A `GridRow::new(..).color(c)` (or rows taking the window foreground) would make theming a two-line change instead of a span per run."

## Next round

1. **Preferences polish (finish requirement f for round 5):** per-pane overrides (a pane with its own shell or theme), a written `prefs/README.md` a user can follow, and validation messages that name the line as well as the field. Re-render both setups and diff against round 4's PNGs.
2. **A GPU number worth quoting**: per-engine `GPU Engine` counters done properly, or PresentMon, or leave the column out permanently.
3. **Scrollback on a Rune grid** (the last capability question left in the proposal): Rune's `.virtualize` + `.growth` against a 10k-line buffer, measured, since every terminal needs it and it is the one place pane cost could stop being flat.

## For the coordinator

- **CHANGELOG lines (user-visible):** none. Everything changed is inside the spike (`spikes/rune-terminal/`, never wired into the app) plus one stale comment in `src/insights/model.ts`.
- **Decision to record:** the round-3 "Rune grows while idle" risk is **closed as headless-only** (windowed is flat over 3 minutes, 108 MB at any pane count). Rune stays **no-go for this wave**; the memory caveat is gone from the comparison, the terminal-feature and release-maturity risks are not.
- **Cross-lane:** nothing new. Still open from round 2: `c3-terminal/20261112-1112-i18n-onpackloaded-subscribers.md` and `c3-terminal/20261112-1105-remove-embedded-browser-status-refs.md`.
- **Untouched files in this worktree:** `spikes/rune-terminal/evidence/pane-{1,4,8}.png` and `tree-{1,4,8}.json` (11:46, not mine — they predate this round and no `rune-terminal` process is running now) and `spikes/rune-terminal/target/` (gitignored). The other session that was writing here in round 3 shows no sign of activity this round.
- **Worktree state at the end of this round:** committed are `src/prefs.rs`, the pref-driven `src/main.rs` and `src/vt.rs`, `prefs/*.json`, the new evidence (PNGs, CSVs, `prefs-reload.ps1`/`.log`, the `sample.ps1` fixes), and `src/insights/model.ts`.
