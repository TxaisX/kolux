# Lane Report — o3-rune

- **Status (plain words, 3 lines max)**:
  Closed all Round 1 audit findings (P1 Claude `resetsAt` ms-vs-seconds unit fix, P2 i18n pack wording & retry, P2 Privacy `127.0.0.1` note, P2 `pricing.ts` index memoization, P2 usage/insights helper dedup, P3 unmount/sequence guards and `type="button"`).
  Built and verified the standalone `spikes/rune-terminal/` prototype on pinned Rune (`c9ae2f6e`) + `kolux_lib::pty` + `vt100`, proving 1/4/8-pane headless PNGs + element trees and measuring 8 live PowerShell panes side-by-side against Kolux WebView2 + WebGL.
  Recommendation: **No-go on Rune for this wave** (stay on WebView2 + WebGL + Goal 0's native-terminal / no-web-pane slimdown); headless memory growth does not occur in a real windowed run (flat at ~108–110 MB WS), but terminal feature parity and dual-renderer complexity still outweigh the ~470 MB RAM win.

## Done this round

1. **Audit fixes & refactor (owned TypeScript/TSX screens)**
   - Fixed P1 Claude `resetsAt` ms-vs-seconds mismatch in `src/usage/launchWarn.ts:46` and added regression assertion in `src/usage/launchWarn.test.ts` (commit `eaa65b8a`).
   - Updated `src/privacy/hosts.test.ts:63` (`127.0.0.1` reason) for Goal 0, fixed stale `onboarding.connect.wait` across all 5 language packs (`es`, `fr`, `ja`, `ko`, `zh-CN`), cleared `pending` on failed pack loads in `src/i18n/lookup.ts`, added `WeakMap` index + regex caching to `src/usage/pricing.ts`, and added unmount/sequence guards + `type="button"` in `Activity`, `TokenAnalytics`, `UpdateCenterView`, and `FeedbackDialog` (commit `eaa65b8a`).
   - Filed cross-lane bug `G:\Dev\kolux-lanes\_shared\bugs\c1-coord\20261112-1112-i18n-onpackloaded-subscribers.md` for zero production subscribers on `onPackLoaded`.
   - Extracted shared usage/insights formatters to `src/usage/format.ts` and `anyTracked` / `dueForScan` / `folderName` to `src/usage/tokens.ts` (commit `44a44d16`).
   - Proof (fresh at end of round):
     - `pnpm exec tsc --noEmit` → exit 0 (0 errors)
     - `pnpm exec vitest run src/usage src/insights src/notify src/i18n src/privacy src/feedback src/update` → `Test Files  45 passed (45)` / `Tests  329 passed (329)`

2. **Rune terminal spike (`spikes/rune-terminal/`, NOT wired into Kolux)**
   - Pinned `rune` at `dev` rev `c9ae2f6ec08147fc5c72760bbf09a6acd4a27dc3` (`MIT, © Anomaly`), reusing `kolux_lib::pty::{PtySession, shell_commands, fresh_terminal_path, write_shared}` via path dependency + `vt100` + Rune's `rune::grid` (`GridRow` per-row hash caching, 256/RGB colors, bold/italic/underline, wide glyphs, cursor block, click-to-focus, `on_layout` resize).
   - Added unit test in `spikes/rune-terminal/src/vt.rs` (`sync_rows_reuses_unchanged_rows_and_tracks_colors_wide_cells_and_cursor`): `cargo test --manifest-path spikes/rune-terminal/Cargo.toml` → `1 passed; 0 failed`.
   - Headless proof (1, 4, 8 real `powershell.exe` ConPTY panes with ANSI16/TrueColor/Underline + cursor + element trees):
     - `spikes/rune-terminal/evidence/pane-1.png` & `tree-1.json` (184×45)
     - `spikes/rune-terminal/evidence/pane-4.png` & `tree-4.json` (90×21)
     - `spikes/rune-terminal/evidence/pane-8.png` & `tree-8.json` (90×9)

## Rune vs Kolux WebView2 + WebGL: 8-pane live benchmark (this PC, 16 logical cores)

Measured live with 8 real PowerShell PTY panes on the same machine (`WorkingSet64`, `PrivateMemorySize64`, `TotalProcessorTime`, `\GPU Process Memory(*)`, `\GPU Engine(*)\Utilization Percentage`, plus active frame & keystroke-to-screen probes):

| Metric (8 real PowerShell panes) | Kolux WebView2 + WebGL (`dev` build, `terminalGpu: "auto"`) | Rune spike (`spikes/rune-terminal` `--release`, windowed) | Delta |
|---|---|---|---|
| **App memory — Working Set** | **580.4 MB** across 7 processes (`window` 59.4, `wv-browser` 122.8, `renderer` 212.7, `gpu-process` 106.8, `utility`×2 65.6, `crashpad` 13.1) | **109.7 MB** idle / **134.3 MB** active (1 process; flat over time in windowed runs) | **−470.7 MB (−81%)** |
| **App memory — Private Bytes** | **370.9 MB** | **133.0 MB** idle / **140.5 MB** active | **−237.9 MB (−64%)** |
| **App CPU % (idle 8 panes)** | **7.33%** of 1 core (`0.46%` of 16-core PC) | **2.21%** of 1 core (`0.14%` of PC); active 60 Hz probes: **11.78%** of 1 core | **−70% idle CPU** |
| **GPU % & GPU memory** | **0.005%** GPU engine (`55.2 MB` dedicated, `59.8 MB` committed, `4.0 MB` shared) | **0.00%** GPU engine (`42.9 MB` dedicated, `76.1 MB` committed) | ~Equal dedicated VRAM; no separate GPU process |
| **Frame time** | `rAF` interval `p50 = 6.10 ms`, `p95 = 6.20 ms`, `max = 10.71 ms` | Active frame `p50 = 0.45 ms`, `p95 = 17.09 ms` (0 frames drawn at rest) | Sub-ms frame CPU |
| **Keystroke-to-screen (20 probes)** | `p50 = 58.32 ms`, `p95 = 145.66 ms`, `max = 383.60 ms` (CDP key → output bus → `rAF` WebGL frame) | `p50 = 24.25 ms`, `p95 = 44.66 ms`, `max = 786.35 ms` (cold 1st-key PSReadLine warmup; `write_shared` → PTY echo → `vt100` → view frame) | **2.4× faster p50**, **3.3× faster p95** |
| **OS handles / threads** | 7 processes, 250 threads, 3,627 handles | 1 process, 45 threads, 597 handles | **6× fewer threads & handles** |

Note on the earlier headless idle-growth question: our windowed release run (`109.7 MB` WS) and `evidence/sample-window-8.csv` (`107.9 MB` WS flat across 40+ seconds) confirm the `~2.5 MB/s` working-set climb happens **only** in Rune's headless `--snap`/`--realtime` offscreen loop, not in a real desktop window.

## Proposal: three paths (cost, risk, rebuilds, testing, recommendation)

| Path | Cost | Risk | What changes / needs rebuilding |
|---|---|---|---|
| **(1) Rune for the terminal grid only** (companion/child wgpu window or native HWND over WebView2) | **8–12 weeks** | **High** | Must rebuild all xterm.js features not in `vt100` + `rune::grid`: scrollback virtualization, mouse/word/line/block selection + clipboard copy, clickable URL/file-path detection, find-in-terminal, IME composition wiring, Kitty keyboard / OSC 52 / `ESC[6n` replies, plus keeping two window/GPU hosts synchronized on resize, focus, z-order, and DPI changes. |
| **(2) Whole Kolux UI on Rune, screen by screen** | **22–36 weeks (~6–9 months)** | **Very high** | Rebuilds **~1,700 TS/TSX files**: App shell/sidebar/topbar/splitter (4–5w, `rune_kit::shell` covers ~60%), Terminal grid + xterm features (8–12w), Board/Tower/Inbox/Floor/Switcher (4–6w), Chat/AgentStart/Launch (3–4w), Editor + Split Diff + Mermaid/KaTeX (4–6w — `rune_kit::diff`/Markdown help, no full code editor), Usage/Insights charts + Settings/Onboarding/Updates/Feedback/Tray/Shortcuts (4–6w), plus porting Tauri IPC/updater/deep-links/single-instance to pure Rust and carrying Rune's 4 `[patch.crates-io]` vendor forks. |
| **(3) Stay on WebView2 + WebGL** (with Goal 0: native Windows Terminal panes + embedded browser removed) | **0 weeks** for UI rewrite (native terminal work already scoped in `c3-terminal`) | **Low** | Zero rewrite. Removing `src/browser/` eliminates WebView2's heaviest multi-process web-tab overhead (~509 MB reserved across 6 processes from the 2026-11-09 slimdown study), while `c3-terminal`'s native terminal direction gives real Windows Terminal/ConPTY rendering without maintaining a custom VT UI stack. |

- **How Rune's headless mode could replace screenshot tests**:
  Rune's `--snap <png>`, `--tree <json>`, `--script <json>`, and `Runtime` unit tests run deterministically on a virtual clock with zero WebView2 startup, zero port collisions, and zero CDP flakiness (~5–9 s for 95 frames vs 30–60 s launching `pnpm tauri dev`). In Path (2), headless `--snap` + `--tree` would cleanly replace Playwright/CDP layout & screenshot suites (`scripts/evidence/`). In Paths (1) or (3), Kolux still ships WebView2 for the app chrome, so WebView2 CDP tests remain necessary for the HTML UI.

- **Recommendation: NO-GO on Rune for this wave.**
  Even though the live 8-pane benchmark confirms Rune's native grid saves **~471 MB working set (81%)**, **70% idle CPU**, and cuts **keystroke-to-screen p95 by 3.3×**, Kolux has already chosen Goal 0 (native Windows Terminal panes + removing the embedded browser pane). Path (1) duplicates `c3-terminal`'s native terminal investment with 8–12 weeks of xterm-parity engineering and fragile WebView2-plus-wgpu window coordination, while Path (2) is a multi-quarter full-app rewrite on an un-tagged `dev` dependency. Revisit only if native terminals hit a hard Windows blocker or Rune tags a stable release with a complete terminal widget.

## Drafted Rune issues (Txais files issues; Rune does not take PRs)

1. **Title:** `default` feature (`accessibility`) fails downstream git builds without `vendor/accesskit_windows` `[patch.crates-io]`
   - **Body:** Adding `rune = { git = "https://github.com/anomalyco/rune", rev = "c9ae2f6ec08147fc5c72760bbf09a6acd4a27dc3" }` in a standalone Cargo package outside the Rune workspace fails to build unless the app also copies Rune's `[patch.crates-io]` overrides (or disables default features via `default-features = false, features = ["embedded-fonts", "svg"]`, which turns off Windows UI Automation accessibility). Could the `accesskit_windows` heading/landmark additions be upstreamed or gated behind an opt-in feature so `rune` builds out-of-the-box with accessibility enabled?
2. **Title:** `rune::grid`: built-in cell hit-testing, mouse selection, and scrollback helpers
   - **Body:** `rune::grid` + `GridRow` works well for fast monospace rendering (`0.45 ms` p50 frame time across 8 live PTY panes on Windows/DX12), and `GridRow::reading()` already feeds accessibility. To build a production terminal pane without every app reimplementing geometry math, `rune::grid` lacks built-in point-to-`(row, col)` hit-testing, drag selection ranges (character/word/line + clipboard copy), and scrollback offset support.
3. **Title:** Headless `--snap`/`--realtime` offscreen loop leaks ~2.5 MB/s working set while windowed runs stay flat
   - **Body:** In a real Windows DX12 window with 8 live PTY panes, `rune` holds a flat `108–110 MB` working set over 40+ s. In headless `--snap`/`--realtime` runs over 30–40 s, working set grows steadily at `~2.5 MB/s` even when the scene is idle (`--no-pty` / `--bare` behavior). Repro: run any app with `--realtime --frames 2400` and sample `WorkingSet64` once per second.

## Next round

1. Clean up/integrate round 3/4 spike artifacts (`spikes/rune-terminal/evidence/sample.ps1`, `sample-*.csv`) with the coordinator if needed; no remaining code work in `o3-rune` owned TS/TSX files.
2. Follow up on `G:\Dev\kolux-lanes\_shared\bugs\c1-coord\20261112-1112-i18n-onpackloaded-subscribers.md` once root app shell (`App.tsx`/`main.tsx`) owner picks it up.

## For the coordinator

- **CHANGELOG lines:** None for the shipped app from the Rune spike (`spikes/rune-terminal/` is isolated and not wired into Kolux). Internal small-screen bug fixes and helper refactor landed on `lane/o3-rune` (`eaa65b8a`, `44a44d16`).
- **Decision to record:** **No-go on Rune for this wave**, backed by live 8-pane comparison (`109.7 MB` WS / `2.21%` 1-core CPU / `24.25 ms` key p50 on Rune vs `580.4 MB` WS / `7.33%` 1-core CPU / `58.32 ms` key p50 on Kolux WebView2 + WebGL). Headless idle growth was verified to be headless-only (`sample-window-8.csv` and `bench-rune-idle.ps1` stay flat at `108–110 MB`).
- **Cross-lane:** Open bug `G:\Dev\kolux-lanes\_shared\bugs\c1-coord\20261112-1112-i18n-onpackloaded-subscribers.md` (`onPackLoaded` has zero production subscribers).
- **Note on shared worktree:** Left the concurrent session's uncommitted `spikes/rune-terminal/evidence/sample.ps1`, `sample-*.csv`, and `spikes/rune-terminal/src/main.rs` (`--no-pty`/`--bare`) unstaged and untouched when committing my files.
