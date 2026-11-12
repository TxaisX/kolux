# Lane Report — o3-rune

- **Status (plain words, 3 lines max)**:
  Round 5 finished requirement f: the spike now goes further than "one file changes the theme" — a single pane can have its own shell, colours, palette and font size while the rest of the grid keeps the shared setup, and all of it is re-read live.
  Error messages now name the field *and* the line, and there is a written `prefs/README.md` a user can follow field by field.
  Small screens: 45 test files / 329 tests pass; `tsc` has exactly one error left, in `o1-tools`' Shortcuts file, filed to their queue. Recommendation unchanged: **no-go on Rune for this wave**.

## Done this round (proof quoted)

1. **Read the briefs, merged the wave, checked the queue.** `git merge --no-edit integrate/wave-1` → clean merge (no conflicts). `_shared/bugs/o3-rune/` was empty: nothing queued. Read `c1-coord-r2.md` and `o1-tools-r3.md`; nothing in them needs this lane.

2. **Per-pane overrides — requirement f, the last piece.** New `pane_overrides` list in `src/prefs.rs` (1-based pane number, `theme` / `font` / `shell` per pane), resolved into one `Look` per pane (`Resolved.looks`) and drawn per pane in `src/main.rs` (`PaneLook`: style, cell metrics, palette, ink, accent).
   - Proof: `evidence/r5-pane-overrides.png` — one dark window where pane 2 runs `cmd.exe` at 12 pt in a purple tint and pane 4 is a full light-on-paper palette at 15 pt, while panes 1 and 3 keep the shared midnight theme.
   - Proof it is not a picture: `evidence/r5-pane-overrides-tree.json` (element tree at t=8 s) gives every card the same row box — `pane-0 [12,12,703,416]`, `pane-1 [725,12,703,416]`, `pane-2 [12,438,703,416]`, `pane-3 [725,438,703,416]` — so a bigger font in one pane changes its cell grid, not the frame.
   - Shell per pane: `Prefs::shell_for(i)` picks the pane's own `shell` or the grid's; `spawn_panes` spawns each pane from its own answer.

3. **Errors that name the field and the line.** `from_json` now appends `(line N)` to every rule we check ourselves, by finding the field's key in the text; serde's own shape errors keep their built-in `at line N column M`. An override problem names the pane instead (`pane_overrides[pane=2]…`), which is more precise than a line in a list.
   - Proof, live in the running window (`evidence/prefs-reload.ps1` → `evidence/prefs-reload.txt`):
     ```
     PREFS_RELOAD file=evidence/_live-prefs.json panes=4 columns=2 theme=midnight-plus-two font=13/18 shell=kolux-default gap=10 overrides=2
     PREFS_ERROR theme.cursor_bg colour "#nope" must be #rrggbb, not 4 digits (line 3)
     PREFS_ERROR pane_overrides[0].pane must be 1..2 (1-based), not 7 (line 1)
     PREFS_ERROR prefs: invalid type: string "three", expected usize at line 1 column 30
     PREFS_RELOAD file=evidence/_live-prefs.json panes=4 columns=2 theme=midnight-plus-two font=13/18 shell=kolux-default gap=10 overrides=2
     ```
     (4-pane dark → 3-pane light → 4 panes with 2 overrides, all while running → broken colour → override pointing at a missing pane → shape error → fixed again.)

4. **`prefs/README.md` — a file a user can actually follow.** Every key in every section, its default, what it changes; the ANSI order spelled out; the three example files named by what they show; how to check an edit headlessly with `--snap`; and what each error shape means.

5. **Re-rendered both round-4 setups and diffed them.** New `evidence/render-prefs.ps1` (three files → three PNGs) and `evidence/diff-png.ps1` (pixel count, max channel delta, diff image):
   ```
   DIFF prefs-daylight.png vs r5-daylight.png: 0/5184000 px changed (0%), max channel delta 0
   DIFF prefs-midnight.png vs r5-midnight.png: 811/5184000 px changed (0.016%), max channel delta 153
   ```
   The daylight setup is pixel-identical to round 4. The midnight difference is 811 px in one box, x 850..919, y 1742..1758 (2× image) — the live byte counter in the status bar (`744 B`), not styling. Renders are deterministic: two runs produced byte-identical files.

6. **Small screens.** `npx vitest run` over the whole owned area is green, and the round-1 audit leftovers are confirmed closed in the tree (the `?raw` source-text rows already read from disk, `refresh.ts` deletes a stopped runner from `states`, `pricing.ts` resolves through an index + cache).
   - **One cross-lane break found and filed, not touched:** `npx tsc --noEmit` reports exactly one error on the merged tree — `src/settings/shortcutRows.ts(9,102): error TS2353 … 'browser' does not exist in type 'Record<Scope, string>'` (o1-tools' file still lists a `browser` area after the web pane was removed). Bug: `_shared/bugs/o1-tools/20261112-1251-shortcutrows-browser-scope.md`.

**Proof, run fresh at the end of the round:**
```
node node_modules/typescript/bin/tsc --noEmit
src/settings/shortcutRows.ts(9,102): error TS2353 ... (the filed o1-tools bug: 1 error, nothing in this lane's files)

node node_modules/vitest/vitest.mjs run src/usage src/insights src/notify src/i18n src/privacy src/feedback src/update
 Test Files  45 passed (45)
      Tests  329 passed (329)

cd spikes/rune-terminal && cargo test
 test result: ok. 10 passed; 0 failed; 0 ignored
 (7 round-4 tests + 3 new: per-pane override, override pointing nowhere, error names the line)

cd spikes/rune-terminal && cargo clippy
 warning: `rune-terminal` (bin) generated 2 warnings   [both pre-existing: `arg_value(&args, …)`]
 cd spikes/rune-terminal && cargo build --release
    Finished `release` profile [optimized] target(s)
```

## Rune spike: the numbers (release build, this PC)

Rune pinned at rev `c9ae2f6e`, real ConPTY shells, Windows/DX12. Memory figures from round 4 (windowed runs sample the real window for 60–180 s; the headless path is not quoted as a shipped figure).

| | 1 pane | 4 panes | 8 panes |
|---|---|---|---|
| Frame CPU, p50 (ms) | 0.419 | 0.462 | **0.524** |
| Window working set at rest, windowed | **108.8 MB** | ~108 MB | **107.9 MB** |
| Shells, 2 processes each (MB) | 16.6 | 66 | 132 |
| Window CPU at rest, % of 16 cores | 0.03 | 0.03 | **0.06** |
| Keystroke → echo back (ms p50) | — | — | **2.21** |
| GPU, % summed engines | unmeasured | unmeasured | unmeasured |

Round 4 closed the open risk: the 3 MB/s idle growth was **headless-only** (the same app in a real window is flat at 108 MB for 3 minutes at any pane count). The GPU column stays out: the Windows GPU counter sums every engine instance and reads ~100 % for an idle window, so it is measuring the counter, not the app. A proper per-engine or PresentMon number is a round-6 decision, not a blocker.

**How far user customization can go, updated with per-pane overrides:**

| | Rune (spike, working) | Kolux today (WebView2 + React) |
|---|---|---|
| Layout / pane arrangement | JSON file, applied live (`panes`, `columns`, `gap`, `outer_pad`) | code + CSS; user cannot change it |
| Theme and ANSI palette | 27 colours in the file, hot-swapped | shipped CSS variables; no user file |
| Per-pane shell, theme, palette, font | in the file (`pane_overrides`), hot-swapped | not exposed at all |
| Font, cell size, padding | in the file, measured or forced | xterm options, not exposed |
| Key bindings | Rune chords in the file | fixed |
| Error handling for a bad file | names the field and the line, keeps the last good setup | n/a (no user file) |
| How far it could go | anything the app reads from the file; Rune's `--script`/variables show a high ceiling at no per-feature cost | needs a settings screen, IPC, persistence and a restart for most of it |

## Rune: three paths, one recommendation

| | Kolux today (WebView2 + xterm.js) | Rune at the pinned rev |
|---|---|---|
| Window cost | web view alone 509 MB private / 337 MB in use across 6 processes (`docs/research/kolux-slimdown-2026-11-09.md:30`); whole app 226 MB in use with 12 terminals (line 9) | **108 MB windowed for any pane count**, + ~16 MB per shell |
| Frame cost | not published in this area | 0.52 ms CPU p50 for 8 panes |
| Keystroke to screen | echo p95 0.1 s under an 8-pane flood | echo p50 2.2 ms |
| Terminal features | xterm 6.0: ligatures, fit, search, links, kitty keys, OSC 52, IME | selection and IME only; the rest is new code on our side |
| Testing | Playwright + DOM tests | `--snap`, `--tree`, `--script`, deterministic clock — every number here was taken that way |
| Risk | stable | pre-release `dev` rev; no tagged release; headless renderer leaks |

- **Path 1 — Rune for the terminal grid only.** 8-12 weeks, high risk: we write the VT/terminal feature set, and two renderers in one window (native wgpu surface plus WebView2) is undocumented on both sides.
- **Path 2 — the whole UI on Rune, screen by screen.** 5-9 months, very high risk: 1,738 `.ts`/`.tsx` files, 181,328 lines to rebuild.
- **Path 3 — stay on WebView2 + WebGL and take goal 0's wins.** 0 weeks to keep; goal 0 already removes the 509 MB web view.

**Go / no-go: still no-go on Rune for this wave.** What round 5 adds is that the *user-customization* argument — the reason Txais pointed at Rune — is now demonstrated rather than asserted: layout, theme, palette, per-pane shell/ink/font and keys all come from one file with live reload and loud errors, and that file is written by us in an afternoon. It does not move the decision: every terminal feature is still ours to write, the two-renderer integration is undocumented, and Rune ships no tagged release. **Revisit if** the native-terminal path stalls, Rune ships a grid widget or a WebView2 coexistence recipe, or Rune tags a release.

**Issue drafts to add** (Txais files these; Rune takes no PRs): the round-2 six and round-4 three still stand (headless memory growth, `ESC[6n`, `GridRow` base ink). Nothing new this round.

## Next round (round 6, the proposal round)

1. **Final proposal in this file** (requirement d): keep the three paths, fold in rounds 2-5 numbers, and add a one-page "what a user can change today vs on Rune" section built from `prefs/README.md`.
2. **Decide the GPU column permanently:** per-engine counters done properly, or delete the row and say why in one line.
3. **Scrollback, if it fits:** Rune's `.virtualize` + `.growth` against a 10k-line buffer, measured — the last capability question in the comparison.

## For the coordinator

- **CHANGELOG lines (user-visible):** none. Everything changed is inside the spike (`spikes/rune-terminal/`, never wired into the app).
- **Decisions to record:** the preferences schema is now the reference for "how far a user could shape Kolux on Rune": global sections (`layout`, `theme`, `font`, `shell`, `keys`) plus a per-pane `pane_overrides` list. Rune remains **no-go for this wave**; round 5 strengthens the customization argument, not the engineering case.
- **Cross-lane:** filed `o1-tools/20261112-1251-shortcutrows-browser-scope.md` (P1: one `tsc` error, `browser` still in `AREAS`). Still open from round 2: `c3-terminal/20261112-1112-i18n-onpackloaded-subscribers.md` and `c3-terminal/20261112-1105-remove-embedded-browser-status-refs.md`.
- **Worktree state:** committed are `spikes/rune-terminal/src/{prefs,main}.rs`, `prefs/README.md`, `prefs/pane-overrides.json`, `evidence/{render-prefs.ps1,diff-png.ps1,prefs-reload.ps1,prefs-reload.txt,r5-*.png,r5-pane-overrides-tree.json}`. `spikes/rune-terminal/target/` stays gitignored. No files outside this lane's ownership were edited.