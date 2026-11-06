# Development

This section is for people building, testing, or releasing Kolux. The app is a Tauri 2 project: a React and TypeScript window, a Rust core, a separate terminal service, and a set of Node scripts for the gates and the release.

If you only want to use the app, read the [user guide](../guide/README.md).

## Quick start

You need Windows 11 x64, Git, Node.js 24, pnpm 12, Rust 1.90 or newer with the MSVC toolchain, the Visual Studio 2022 C++ build tools, and the WebView2 runtime.

```powershell
pnpm install
pnpm tauri dev
```

The first build compiles the Rust side and takes a few minutes. Vite serves the window on `http://localhost:1420`.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Vite only, no Tauri window |
| `pnpm tauri dev` | The full desktop app in development mode |
| `pnpm build` | Type-check and build the front end into `dist/` |
| `pnpm tauri build` | Build the desktop bundles, including the NSIS installer |
| `pnpm test` | Run the Vitest suite |
| `pnpm check` | Type-check plus the license, plan, workflow, invoke-contract, and memory checks |
| `pnpm smoke` | Run the five end-to-end smoke flows over the app's debugging port |
| `pnpm release` | Build, smoke-test, sign, and publish a release |
| `pnpm ship` | Commit, push, and optionally start a release |

The Rust tests need scratch home folders, so they are not run by `pnpm test`. See [Testing](testing.md).

## Where to go

| Page | What it covers |
|---|---|
| [Building](building.md) | Prerequisites, local development, build outputs, environment variables |
| [Testing](testing.md) | Vitest, Rust tests, scratch homes, the gates, CI, flaky-test policy |
| [Releasing](releasing.md) | Versioning, signing, the release script, the CI workflow, the update feed |
| [Code map](code-map.md) | The repository layout, the Rust and React module maps, where to change what |
| [Architecture](../architecture/README.md) | How the running app is put together |

## Ground rules

- **Do not skip or weaken a test to make a gate pass.** Fix the code or revert the change.
- **Run one full build at a time.** The Rust build and the tests share the same target folder; parallel full builds waste time and memory.
- **Rust integration tests run only under the scratch environment.** Do not run them against your real home folder.
- **Do not commit secrets, tokens, or personal paths.** The Diagnostics report is scrubbed; your terminal is not.
- **Do not copy code from the old Kolux app.** The rebuild has a clean-room provenance rule. Read [Contributing](../../CONTRIBUTING.md) before you paste code from anywhere.
- **No attribution lines in commits or source.** Keep the work as the project's own.

The project is source-available, not open source. Read [Contributing](../../CONTRIBUTING.md) for the contribution policy.
