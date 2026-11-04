# Building from source

Kolux RS is a Tauri 2 app with a React and TypeScript front end and a Rust core. The same repository builds the desktop app, the background terminal service, the release CLI, and the NSIS installer.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Windows | 11 x64 | The tested target. Windows 10 is not verified end to end. |
| Git | Current | Worktrees and source control. |
| Node.js | 24 | CI pins Node 24. |
| pnpm | 12 | CI pins pnpm 12. |
| Rust | 1.90 or newer | Stable MSVC toolchain. `rust-version` in `src-tauri/Cargo.toml` is 1.90. |
| Visual Studio | 2022 Build Tools | The Desktop development with C++ workload, including the MSVC linker and Windows SDK. |
| WebView2 | Evergreen runtime | Windows 11 includes it. The installer can fetch it if it is missing. |

The Tauri CLI is installed as a project dependency, so `pnpm tauri` works without a global install.

## First run

```powershell
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts Vite through `beforeDevCommand` and then opens the Tauri window. Vite serves on `http://localhost:1420` with `strictPort`, so a second dev server fails instead of moving to another port. When `TAURI_DEV_HOST` is set, HMR uses port 1421.

The first Rust build takes several minutes. Later builds reuse `src-tauri/target`.

## The development loop

| Task | Command |
|---|---|
| Front end only, in a browser | `pnpm dev` |
| Full desktop app | `pnpm tauri dev` |
| Type-check and build the front end | `pnpm build` |
| Run the front-end tests | `pnpm test` |
| Run the gate scripts | `pnpm check` |
| Run the Rust tests | `. .\scripts\test-env.ps1` then `cargo test` |
| Lint Rust | `cargo clippy --all-targets -- -D warnings` |
| Check Rust dependencies | `cargo deny check` |
| Build the installer | `pnpm tauri build` |

`pnpm build` runs `tsc` and then `vite build`. The output goes to `dist/`. `pnpm tauri build` runs that build through `beforeBuildCommand` and then bundles the desktop app.

## Build outputs

| Output | Path |
|---|---|
| Front-end bundle | `dist/` |
| Desktop executable | `src-tauri/target/release/kolux-rs.exe` |
| NSIS installer | `src-tauri/target/release/bundle/nsis/Kolux RS_<version>_x64-setup.exe` |
| Release CLI | `src-tauri/target/release/kolux.exe` when built with `--features release-cli` |
| CLI shim | `src-tauri/cli/kolux.cmd` |

The installer is per-user. It installs under the user's local app data, adds `<install>\bin` to the user PATH, and removes exactly that entry at uninstall. If the user's PATH is longer than NSIS can hold, the installer leaves it alone and writes `kolux-path-pending.txt`; the app adds the entry on its first start (`src-tauri/installer-hooks.nsh:3-16`).

## Development and release differences

A development build is not a release build with a different title. The differences are deliberate:

- **CLI binary.** The `kolux` binary is gated on the `release-cli` feature and is built only by the release script, so a development build never puts a `kolux` on the panes' search path that shadows the installed one (`src-tauri/Cargo.toml:21-30`).
- **CSP.** Development uses the policy in `vite.config.ts`, which allows the Vite client and HMR socket. Release uses the policy in `src-tauri/tauri.conf.json`. `scripts/csp.test.mjs` keeps them in step.
- **Update key.** The release checkout gets a generated `src-tauri/release.conf.json` with the public key. The in-tree config has an empty updater key, so a development build does not accidentally accept release updates.
- **Test fakes.** `test-fakes` is a dev-dependency feature. A release build never sees the fake PTY or fake terminal constructors.
- **Release profile.** `codegen-units = 1`, LTO, `opt-level = 3`, `panic = "abort"`, and `strip = true` (`src-tauri/Cargo.toml:75-80`).

## Environment variables

| Variable | Use |
|---|---|
| `TAURI_DEV_HOST` | Expose the dev server on another host and enable HMR on 1421. |
| `KOLUX_APP_DIR` | Point a development run at a different profile folder. |
| `KOLUX_USER_DATA_PATH` | Point the CLI at a different app data folder. |
| `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` | Pass browser arguments, for example a remote debugging port for the smoke and evidence scripts. |
| `KRS_SCRATCH_ROOT` | Reuse a specific scratch root for the Rust tests. |
| `CARGO_BUILD_JOBS` | Limit parallel Rust build jobs on a busy machine. |
| `VITEST_MAX_WORKERS` | Override the two-worker Vitest cap. |

The release script uses its own variables (`KOLUX_RELEASE_KEY`, `KOLUX_RELEASE_CHECKOUT`, and others). See [Releasing](releasing.md).

## Common problems

**Port 1420 is already in use.** Stop the other Vite or Tauri development server. The port is strict on purpose so the Tauri config and the CSP cannot point at different servers.

**The window does not appear after a quit.** WebView2 can hold the profile folder for a moment. The app waits up to 3 seconds and retries the window build. If it still fails, close any leftover `msedgewebview2.exe` processes that belong to the app and start again.

**The Rust build fails at link time.** Install the Visual Studio 2022 C++ workload and the Windows SDK, then open a new terminal so the environment is refreshed.

**An agent does not start.** Check that its CLI is installed and on PATH, or install it from Settings, Agents. The pane error names the program it could not find.

**The installer warns about an unknown publisher.** The current installer is not Authenticode-signed. That is expected in the alpha. The update manifest is signed separately.

## Working on the installer

The NSIS hooks live in `src-tauri/installer-hooks.nsh`. They handle the PATH entry, the long-PATH hand-off, and the uninstall cleanup. The release script builds the installer with `pnpm tauri build --bundles nsis`.

If you change the installer, test three cases:

1. a fresh install on a machine with a short PATH;
2. an install over the top of an existing copy, with the bin entry already present;
3. an uninstall that removes exactly the Kolux entry and leaves every other entry alone.

The long-PATH path is the one that usually breaks. It is also the one that matters on a developer machine.
