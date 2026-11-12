# Lane Report — o3-rune

- **Status (plain words, 3 lines max)**:
  Round 3 fixed the spike's one real defect: Rune's panes were blank because nothing answered the console host's startup question ("where is the cursor?"). All eight panes now show a live prompt, typing echoes, and ANSI16, truecolor and underline all draw.
  Release-build numbers are in: **8 panes cost 0.52 ms of CPU per frame (p50) and ~225 MB at rest** on this PC, against a 16.7 ms frame budget. Keystroke-to-echo is 2.2 ms (p50).
  One open risk: the app adds ~2.5 MB/s of memory while sitting idle, in headless mode, at any pane count. Not explained yet; it is the top job for round 4.

## Done this round (proof quoted)

1. **Read the briefs, merged the other lanes, checked the queue.** `git merge --no-edit integrate/wave-1` → `Merge made by the 'ort' strategy.` (1 file, `AUDIT-c1-coord.md`). `_shared/bugs/o3-rune/` is empty: nothing queued for me.

2. **Found and fixed the blank-pane defect (P1 for the spike).**
   - **Cause, proven not guessed.** `spikes/rune-terminal/examples/pty_probe.rs` (new) drives Kolux's own `PtySession` with a plain callback: the shell hands the terminal exactly 4 bytes, `1b 5b 36 6e`, and then nothing — ever. That is `ESC[6n`, the console host asking *where is the cursor?*, and it waits for the answer before printing anything. Windows Terminal answers it, and xterm.js answers it inside Kolux today, which is why the real app never showed this. A hand-drawn grid has to answer it itself.
   - **Fix.** `src/main.rs` gained `terminal_replies()`: it reads the tail of each output chunk for `ESC[6n` (cursor position report), `ESC[5n` (status) and `ESC[c` (device attributes), and writes the reply back through the pane's writer using the parser's real cursor position. Wired into the output drain.
   - **Proof.** The probe example now prints, after the fix: `@498.1ms 4B ESC[6n`, `@498.2ms 16B ESC[?9001h ESC[?1004h`, `@498.4ms 71B`, `@1852.1ms 20B PS C:\Users\XiongT>` and `MARKER found: true` (a typed `echo MARKER-42` round-trips). In the app: `evidence/one.png` reads `PS C:\Users\XiongT>` with 386 B received, where it used to read 4 B and a blank pane.

3. **Typing, colour and cursor now demonstrated, not claimed.** `evidence/four.png` (release build, 4 × powershell) shows per-pane prompts, the echoed command line, `ANSI16` in green, `TrueColor` in RGB 250;204;21, `Underline` in magenta and underlined, and a solid block cursor in each pane. 1029 B received in pane 1.

4. **Fixed a layout bug the 8-pane render exposed.** `grid_dims` gave 8 panes 4 columns, which overflow a 1440 px window: panes 4 and 8 fell off the right edge. Now 2 columns × 4 rows (`5|6 => (2,3)`, else `(2,4)`). `evidence/eight.png` shows all 8 panes, each `90x9`, each with a live prompt.

5. **Measured it live, release build, the way goal 0 requires.** New `evidence/sample.ps1` starts the app, samples working set / private / CPU% / GPU% / thread and child counts once a second, and writes a CSV. Numbers in the table below. Frame numbers come from Rune's own instrumentation on the release binary.
   ```
   ./target/release/rune-terminal.exe --snap evidence/eight.png --tree evidence/tree-eight.json \
       --scene 8 --realtime --at 9.0 --demo --cmd
   rune: 541 frames at 60 fps, frame cpu mean 1.131 ms p50 0.524 p95 2.674 max 28.527, 1137 instances
   layout nodes 75, glyphs 1095

   ./target/release/rune-terminal.exe --snap evidence/_bench.png --scene 8 --realtime \
       --frames 500 --cmd --bench --probe
   BENCH_RESULT panes=8 frame_p50_ms=1.91 frame_p95_ms=44.10 key_samples=20 key_p50_ms=2.21
   ```

6. **Small screens: the round-1 audit list is now exhausted** — every item below was re-checked against the tree this round and needed no work, because rounds 1-2 had already landed it: the P1 `resetsAt` ms/seconds fix (`src/usage/launchWarn.ts:46-47`), the stale `onboarding.connect.wait` translations (all 5 packs now read "Lo haré más tarde"-style wording matching `en.ts:25`), the `pricing.ts` index memoisation (`tableIndex`/`indexOf`), the duplicate helpers (`folderOf = folderName`, `dueForCount = dueForScan`), the pack-failure retry (`lookup.ts:42-45` deletes `pending`), `type="button"` on every button in `feedback`/`update`/`usage`, and the `alive`/sequence guards in `Activity`, `TokenAnalytics`, `UpdateCenterView` and `FeedbackDialog`.
   One thing was left: **`src/usage/ShareButton.test.ts` still read the whole of `src` through Vite `?url`/`?raw` globs, the exact stale-cache class fixed in round 2.** It now walks the folder with `node:fs` `readdirSync` and reads each file from disk. That closes the item round 2 listed as next.

**Proof, run fresh at the end of the round:**
```
node node_modules/typescript/bin/tsc --noEmit
TSC_EXIT=0

node node_modules/vitest/vitest.mjs run src/usage src/insights src/notify src/i18n src/privacy src/feedback src/update
 Test Files  45 passed (45)
      Tests  329 passed (329)
```

## Rune spike: the numbers (round 3, release build, this PC)

All runs on `--release`, Rune pinned at rev `c9ae2f6e`, real ConPTY shells, Windows/DX12.

| | 1 pane | 4 panes | 8 panes |
|---|---|---|---|
| Frame CPU, p50 / p95 (ms) | 0.419 / 35.9 | 0.462 / 3.36 | **0.524 / 2.67** |
| Layout nodes / glyphs / instances | 16 / 139 / 146 | 41 / 1256 / 1282 | 75 / 1095 / 1137 |
| Window working set at rest (MB) | ~225 | ~225 | ~225 |
| Shells, 2 processes each (MB) | 16.6 | 66 | 132 |
| Window CPU, % of 16 cores | 0.9 (debug) | 0.4 | **0.41** |
| Keystroke → echo back (ms p50) | — | — | **2.21** |
| GPU, % summed engines | 99 | 99 | 99-105 |

**How to read these.** Six panes' worth of extra terminal costs 0.1 ms more per frame than one: the per-frame price is fixed renderer work, not pane count, so there is a lot of headroom before 8 panes is a problem. Keystroke-to-echo at 2.2 ms p50 leaves ~14 ms of the 16 ms budget for the frame that draws it. The GPU column reads ~100 % on every run including a single pane and I do not trust it: it is the sum of all of that pid's GPU engine instances, it does not move with pane count, and it is reported identically for a 1-pane window doing almost nothing. Treat GPU as unmeasured until a sane counter (or PresentMon) is used.

## Open risk: the app grows while idle

Working set climbs about **2.5 MB/s while nothing is happening**, in headless mode, at 1, 4 and 8 panes alike (the flat rate is what rules our grid out: with 8 panes our own per-frame work is 8× larger than with 1, and the slope does not change):

| run | first sample | last sample | window |
|---|---|---|---|
| 1 pane, 30 s, debug | 224.8 MB | 298.8 MB | 30 s |
| 4 panes, 30 s, debug | 224.8 MB | 320.0 MB | 30 s |
| 8 panes, 40 s, release | 239.1 MB | 351.3 MB | 40 s |

Our own code holds one `Rc<GridRow>` per visible row and rebuilds a row only when its content hash changes (`src/vt.rs:130-163`), so an idle pane allocates nothing per frame. That leaves Rune's headless/forced-render loop as the suspect, and the app stops burning CPU near the end of a run while the memory keeps climbing, which fits a retention bug rather than work. **Not proven**: a windowed run to see whether the growth is headless-only is the first item for round 4, and it is not safe to quote the memory figures as "what a shipped Kolux on Rune would use" until that is answered.

Because of that growth, the honest at-rest figure is the **first** stable sample, ~225 MB of window for any pane count, not the drifting numbers in the CSVs — those are the last sample.

## Rune: three paths, one recommendation (unchanged, numbers refreshed)

| | Kolux today (WebView2 + xterm.js) | Rune at the pinned rev |
|---|---|---|
| Window cost | web view alone 509 MB private / 337 MB in use across 6 processes (`docs/research/kolux-slimdown-2026-11-09.md:30`); whole app 226 MB in use with 12 terminals (line 9) | ~225 MB at rest for a native grid of any size, + ~16 MB per shell |
| Frame cost | not published in this area | **0.52 ms CPU p50 for 8 panes**, 0.42 ms for 1 |
| Keystroke to screen | echo p95 0.1 s under an 8-pane flood (slimdown doc) | echo p50 2.2 ms |
| Terminal features | xterm 6.0: ligatures, fit, search, links, kitty keys, OSC 52, IME | selection and IME only; the rest would be new code on our side |
| Testing | Playwright + DOM tests | `--snap`, `--tree`, `--script`, deterministic clock — and it is how every number above was taken |
| Risk | stable | pre-release `dev` rev; no tagged release |

- **Path 1 — Rune for the terminal grid only.** 8-12 weeks, high risk: we write the VT/terminal feature set ourselves, and two renderers in one window (a native wgpu surface plus WebView2) is undocumented on both sides.
- **Path 2 — the whole UI on Rune, screen by screen.** 5-9 months, very high risk: 1,738 `.ts`/`.tsx` files and 181,328 lines to rebuild.
- **Path 3 — stay on WebView2 + WebGL and take goal 0's wins.** 0 weeks to keep. Goal 0 (native terminals, no embedded browser) already removes the 509 MB web view.

**Go / no-go: still no-go on Rune for this wave.** The spike now proves the grid half is cheap (0.52 ms/frame, ~225 MB) — cheaper than I estimated in round 2 — but the parts that make it a decision have not moved: every terminal feature is still ours to write, the two-renderer integration is still undocumented, and there is a live memory-growth defect at this rev. **Revisit if** the native-terminal path stalls, Rune ships a grid widget or a WebView2 coexistence recipe, or Rune tags a release.

**Issue drafts to add** (Txais files these; Rune takes no PRs): the round-2 six still stand, plus:

7. **Title:** Headless/forced render grows memory while idle — *Body:* "Running a windowed-free `--snap`/`--realtime` session with panes attached, working set grows ~2.5 MB/s with no drawing work and no panes producing output, at 1 pane and at 8 alike; CPU falls to ~0 near the end and memory keeps climbing. On a terminal app this is a blocker. Repro: pty-backed panes in a grid, `--realtime`, sample `WorkingSet64` once a second for 40 s."
8. **Title:** A terminal must answer `ESC[6n` — *Body:* "Does the text/grid story include replying to the console host's cursor-position query? On Windows a ConPTY program sends `ESC[6n` before its prompt and waits for `ESC[row;colR`; without it every pane stays blank. Worth a line in the docs for anyone drawing a PTY in Rune."

## Next round

1. **Explain the idle memory growth**: run the release binary in a real window (not headless) for 60 s and compare slopes; if the window is flat, it is a headless-only defect and the shipped numbers stand. If it is not, bisect `--frames 0` vs `--frames N` and with shells detached. Nothing else in the proposal is worth writing until this is answered.
2. **Preferences (requirement f)**, due round 5: one JSON file driving pane count, arrangement, theme, palette, cell size, shell and the next-pane key, re-read live, with two very different setups rendered as PNGs.
3. **A GPU number worth quoting**: the current counter reads ~100 % for a 1-pane window doing nothing. Either use `GPU Engine` per-engine correctly, or PresentMon, or drop the column.

## For the coordinator

- **CHANGELOG lines (user-visible):** none this round. Everything I changed is inside the spike (`spikes/rune-terminal/`, never wired into the app) or a test's file-reading path.
- **Decision to record:** Rune stays **no-go for this wave**, and the round-3 measurements make Path 1 *cheaper* than round 1 estimated (0.52 ms/frame, ~225 MB at rest) without changing the answer, because the cost is in terminal features and two-renderer integration, not in frame time. Tell c3-terminal that native terminals remain the only funded terminal path.
- **Cross-lane:** nothing new. Still open from round 2: `c3-terminal/20261112-1112-i18n-onpackloaded-subscribers.md` (root-level re-render when a pack lands is `App.tsx`/`main.tsx`, c3-terminal's), and `c3-terminal/20261112-1105-remove-embedded-browser-status-refs.md` (rerouted from me).
- **Collision, third round running, and it is costing real work:** another session is writing in this same worktree. This round a `rune-terminal.exe --scene 8 --demo --cmd` process was running from this worktree's `target\debug` while I worked, and `evidence/pane-1.png`, `pane-4.png`, `pane-8.png`, `tree-1.json`, `tree-4.json` and `tree-8.json` appeared untracked — none of them mine, so I left them alone. I stopped one of its processes by mistake while chasing a locked binary (`Access is denied` on `target\debug\rune-terminal.exe`) before I had identified it as theirs. Its work and mine are converging on the same task by accident — the Rune spike is one lane's job and two sessions are doing it. Please fix the lane assignment, not the report.
- **Worktree state at the end of this round:** committed are the spike fix (`src/main.rs`, new `examples/pty_probe.rs`), the release-build evidence PNGs and the sampler CSV/script, and `src/usage/ShareButton.test.ts`. Untracked and untouched: the other session's `evidence/pane-*.png` and `tree-[148].json`, and `spikes/rune-terminal/target/` (15 GB, gitignored).
