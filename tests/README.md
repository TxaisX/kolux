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
