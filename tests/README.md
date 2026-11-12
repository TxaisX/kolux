# Kolux Live Test Runner (`scripts/stress/run-all.mjs`)

Requirements for running the parallel live test suite (`node scripts/stress/run-all.mjs [--instances 4]`) on a Windows VM or self-hosted Windows CI runner headless (without touching a user's real profile, real AI sign-ins, or AI quota).

> **Note:** This document specifies the runner requirements only. It does not configure a VM or CI workflow.

## 1. Host OS and Desktop Session

- **OS**: Windows 10/11 or Windows Server 2022+ (x64). Kolux uses Windows ConPTY (`portable-pty`) and WebView2, so Linux/macOS runners cannot execute the live Windows suite.
- **Interactive desktop session (critical for WebView2 + `PrintWindow`)**:
  - Do **not** run as a non-interactive Session 0 Windows Service. WebView2 (`msedgewebview2.exe`) and Win32 window enumeration (`app-launch.mjs` `WIN_PS`) require an interactive Window Station / Desktop (`WinSta0\Default`).
  - Use an auto-logged-on runner user (or scheduled task / runner agent running in the logged-in user session, with screen lock / sleep disabled).
  - The harness moves Kolux windows off-screen (`-32000, -32000`) at runtime (`--offscreen` behavior in `scripts/evidence/app-launch.mjs`), so the desktop stays unobstructed even on a single virtual monitor.
- **Display & scaling**: At least one virtual display adapter (e.g. Windows Basic Display / Hyper-V / VDD) at `1920x1080` or larger so 100% / 125% DPI responsive checks have real viewport width.

## 2. Installed Toolchain & Runtimes

- **Microsoft Edge WebView2 Runtime** (Evergreen, system-wide or per-user; pre-installed on Windows 11, must be installed on Windows Server / fresh Windows 10 VMs).
- **Rust toolchain**: `stable` MSVC (`x86_64-pc-windows-msvc`) with `cargo`, `rustc`, and Visual Studio C++ Build Tools (MSVC linker + Windows SDK).
- **Node.js**: `>= 24` (matches `package.json` `engines.node`).
- **pnpm**: `12.x` (`corepack enable` or `pnpm/action-setup` v6+).
- **Git for Windows**: `git` on `PATH` (used by `run-all.mjs`, `live-common.mjs`, and Kolux's workspace/git flows).
- **PowerShell**: `powershell.exe` (Windows PowerShell 5.1, built-in) for `app-launch.mjs` Win32 process tree / window placement / `WIN_PS` helpers.
- **Optional media tools**: `ffmpeg` on `PATH` only if running `live-artifacts.mjs` (which generates a scratch `.mp4` test fixture).

## 3. Port, Identifier, and Disk Isolation

- **Reserved port & CDP slots** (`o2-tests` pool, up to `--instances 10`):
  - Vite dev server ports: `1500, 1510, 1520, ..., 1590` (`1500 + slot * 10`).
  - WebView2 CDP ports: `9350, 9351, 9352, ..., 9359` (`9350 + slot`).
  - App identifiers: `com.txaisxiong.kolux.o2-0` .. `com.txaisxiong.kolux.o2-9`.
- **No firewall popups**: Allow `node.exe` and `kolux.exe` on `127.0.0.1` loopback (or pre-allow in Windows Defender Firewall) so `--strictPort` Vite servers and WebView2 CDP sockets never block on a UAC/firewall prompt.
- **Scratch disk space**:
  - `G:\Temp\o2-run-all` (or pass `--temp <drive>:\Temp\o2-run-all`): ~2-5 GB free for per-slot scratch profiles, throwaway git repos, and WebView2 user-data directories.
  - Cargo build target (`src-tauri/target` or `CARGO_TARGET_DIR`): ~8-12 GB free for the debug `kolux.exe` build.
- **No real AI CLI quota or credentials**:
  - `run-all.mjs` generates scratch `.cmd` stand-ins (`claude.cmd`, `codex.cmd`, `grok.cmd`, `opencode.cmd`), prepends them to `PATH`, strips `KOLUX_*`, `CLAUDE_CODE_*`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `ANTHROPIC_*` from child environments, and skips `real-claude` checks unless `--include-real-claude` is explicitly passed.
  - Because `app-launch.mjs` isolates `USERPROFILE`, `HOME`, `APPDATA`, `LOCALAPPDATA`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `KOLUX_KEYBINDINGS_HOME`, and `TEMP`/`TMP` per slot, nothing touches real user profiles or real keybindings.
  - **Caveat (Windows user registry `PATH` / env)**: Kolux resolves agent CLIs from the machine/user registry `PATH` before the process `PATH` unless overridden in `settings.json` (`agentOptions.<id>.command`). On a clean CI VM, do not install real `claude`/`codex`/`grok` binaries globally—or ensure tests seed `agentOptions.<id>.command` pointing at the scratch stand-in.

## 4. Resource Sizing for Parallel `--instances 4`

- **CPU**: 8+ vCPUs recommended for `--instances 4` (each instance runs 1 `kolux.exe` + ~4-5 `msedgewebview2.exe` processes + Vite + ConPTY shells).
- **RAM**: 16 GB minimum, 32 GB recommended for `--instances 4` (expect ~600-900 MB per running Kolux + WebView2 instance, plus ~2 GB peak during initial `cargo build`).
- **Warmup before parallel fan-out**: `run-all.mjs` runs a single-slot warmup (or reuses an existing `src-tauri/target/debug/kolux.exe`) before starting the 4 parallel workers so Cargo does not contend on the `target/` file lock across 4 simultaneous builds.

## 5. Running and Reading Output

```powershell
# Preview classification and slot assignments without launching apps:
node scripts/stress/run-all.mjs --dry-run --instances 4

# Run all stand-in live checks across 4 isolated app instances:
node scripts/stress/run-all.mjs --instances 4

# Run a filtered subset (e.g. session and terminal checks) across 2 instances:
node scripts/stress/run-all.mjs --instances 2 --only SESS,TERM
```

Results are written to:

- `artifacts/test-runs/<date-time>/summary.md` (human-readable pass/fail table, timings, screenshot links, failure excerpts, skipped checks)
- `artifacts/test-runs/<date-time>/summary.json` (machine-readable report)
- `artifacts/test-runs/<date-time>/logs/<check>.log`
- `artifacts/test-runs/<date-time>/screenshots/<check>__<shot>.png`

## 6. Coverage and selector drift (added round 2, 2026-11-12)

```powershell
# Regenerate tests/coverage.md: which guide tasks any test names, and which feature-card areas have a live check.
node scripts/stress/coverage.mjs
```

`run-all.mjs` reads `src/` once per run and compares every check's selectors against the classes and `data-testid`
values the app really declares (`srcSelectorTokens` / `selectorDrift`). A check whose selector matches nothing in
`src/` shows a `selector(s) no src/ file mentions` warning in the summary instead of a clean row. That is how the dead
`.pane-row` class was caught: five checks queried it for three rounds, all of them silently unmatched.

Checks that drive the embedded browser pane are retired: the pane is gone (Goal 0, Txais 2026-11-12), and a script that
still queries `section.pane.browser` is classified `retired-browser` and never runs.

## 7. The two smoke flows this runner does not cover (`scripts/evidence/smoke.mjs`)

`smoke.mjs` is the fast end-to-end gate, and it now has seven flows. Flow 6 starts every agent type from the New
session menu (Claude Code, Codex, Grok, OpenCode through stand-ins in `scripts/evidence/smoke-standins.mjs`, then a
blank terminal) and proves each pane took input by reading back a line it echoed to a file. Flow 7 puts six or more
sessions in one workspace and asserts the sidebar keeps one folder row (and no `.pane-row`), that clicking the row
brings the grid back, and that a restart keeps every pane.

```powershell
# The two session/sidebar flows only, on this lane's own ports and identifier:
node scripts/evidence/smoke.mjs --only 6,7 --port 1500 --cdp 9350 --identifier com.txaisxiong.kolux.o2-smoke --temp G:/Temp/o2-smoke
```

## 8. Retired checks (added round 3, 2026-11-12)

When the screen a live check drove is gone, do not delete the file and do not leave it running red: put
`// retired: <why>` as the **first line** of the script. `classifyProveScript()` (`scripts/stress/run-all.mjs`) then
files it as `retired`, `shouldRun()` never runs it, and the summary lists it under "Skipped checks" with the reason.
The marker only counts in the header (first 800 characters), so a check that merely mentions the word stays live.

Seven proofs are retired this way, all because T-644 removed the right-sidebar Source Control panel they drove:
`live-GIT-001`, `live-GIT-003`, `live-GIT-004`, `live-GIT-007`, `live-GIT-037`, `live-GIT-040`, `live-EDIT-027`.
The replacement surface is All Changes: open it with `openAllChanges(app)` from `scripts/prove/live-edit-common.mjs`
(the project row's menu → "Review changes") and count changed files with `acCount(app)`, as `live-EDIT-029` and
`live-GIT-038` now do. Rewriting the seven onto All Changes is queued for round 4, with a running app.

## 9. The feature map (`docs/guide/feature-map.md`, added round 3)

Goal 0, item 6. The map lists every control by screen with what it should do, what it does now, a verdict and its
proof. `scripts/feature-map.test.mjs` keeps it honest: the three mapped screens must stay, and every
`data-testid="…"` the map quotes must still be declared in `src/`. Run it with the rest of the harness tests:

```powershell
node node_modules/vitest/vitest.mjs run scripts/
```

## 10. `?raw` contract tests and the Vite cache (added round 3, workaround round 4)

`tests/raw-contract-imports.md` lists all 75 test files that assert on source text read through Vite's `?raw`,
grouped by area with the owning lane. Those transforms are cached, so a stale entry can fail a correct file or pass a
changed one. **Run `npx vitest run --no-fsModuleCache`** (round 4: one flag, no file deletion) until every area reads its
file with `node:fs` (queued bug `20261112-1118`; the CI half is filed to `c1-coord`). `scripts/raw-cache-probe.test.mjs`
is the detector: it fails if a `?raw` import ever disagrees with the same file read from disk.

## 11. The harness tests itself (added round 4)

Three test files keep the harness from rotting the way the app used to:

- `scripts/harness-imports.test.mjs` — every named import from a local module is really exported, every relative import
  resolves, no shared constant is used without being declared or imported (this catches the round-4 `TID` bug that would
  have failed every live proof), and a proof that another proof imports must carry its `pathToFileURL(process.argv[1])`
  main guard so importing it cannot launch an app.
- `scripts/feature-map.test.mjs` — the map's sections and verdict legend survive, and every `data-testid` it quotes still
  exists in `src/`.
- `scripts/raw-cache-probe.test.mjs` — see section 10.

## 12. Latency (Goal 0, item 7, added round 4)

`scripts/prove/live-latency.mjs` measures the three targets in the running app (keystroke → character < 16 ms, click →
visible response < 50 ms, new session → ready prompt < 300 ms). It is a normal `live-*.mjs`, so the runner picks it up:

```powershell
node scripts/stress/run-all.mjs --instances 1 --only latency --timeout 20 --out G:/Temp/o2-latency
```

Samples are taken in the page with `performance.now()`, so they measure Kolux's path, not the harness's. Read the log
(`logs/live-latency.log`) for every sample, not just the median, and rerun on a quiet machine before believing a
regression: a shared PC moves these numbers by 2-3x. The current numbers live in `docs/guide/feature-map.md`, section 4.
