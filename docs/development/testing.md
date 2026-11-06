# Testing

Kolux has two test suites and a set of gate scripts. The front-end suite runs fast and in parallel. The Rust suite runs real PTYs, real Git repositories, and real files, so it needs a scratch home.

## Front-end tests

Vitest is configured inside `vite.config.ts`, not a separate file:

- include: `src/**/*.test.ts` and `scripts/**/*.test.mjs`;
- `maxWorkers: 2`, because the machine is shared with live agents;
- no browser environment by default, so most component tests render with `react-dom/server` or a small DOM harness.

Run them with:

```powershell
pnpm test
```

CI splits the suite into four shards:

```powershell
pnpm exec vitest run --shard=1/4
```

The shard count and the exact flag are enforced by `scripts/workflow-check.mjs`, so do not change one without the other.

## Rust tests

The Rust suite has two layers:

- **Unit tests** in `#[cfg(test)]` modules beside the code. They cover parsers, path rules, state transitions, and the pure logic in each module.
- **Integration tests** in `src-tauri/tests/cards_*.rs`, one file per spec area, plus `cards_19_diag.rs` and the Windows-only `shim.rs`. They drive real files, real Git, and real PTYs.

The integration tests refuse to run unless the home folders point at a scratch root. The guard is in `src-tauri/tests/scratch_root/mod.rs`; it checks `USERPROFILE`, `HOME`, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME` for a `.kolux-rs-scratch` marker.

Use the provided environment:

```powershell
. .\scripts\test-env.ps1
cargo test
```

On Linux or macOS:

```bash
. ./scripts/test-env.sh
cargo test
```

The script redirects `USERPROFILE`, `HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `TEMP`, and `TMP` under a scratch folder. It deliberately leaves `APPDATA`, `LOCALAPPDATA`, `CARGO_HOME`, and `RUSTUP_HOME` alone, so the real Claude and Codex settings are never touched while the Rust toolchain still works.

`KRS_SCRATCH_ROOT` reuses a specific root instead of nesting a new one under the redirected temp folder.

## Test fakes

Some tests need a terminal without a real process. The `test-fakes` feature exposes `Terminals::fake_session` and `PtySession::fake`; a release build never sees them. The crate uses itself as a dev-dependency with the feature enabled, so integration tests can reach the fakes without a flag (`src-tauri/Cargo.toml:71-73`).

## Gates

`pnpm check` runs the fast, deterministic checks:

| Gate | What it protects |
|---|---|
| `tsc` | The TypeScript types |
| `license-check` | Every npm package has an allowed license |
| `plan-check` | `PLAN.md` covers the spec cards according to their tiers, and the `STATE.md` counters are current |
| `workflow-check` | The CI workflow keeps its four shards, release gate, and result job |
| `invoke-contract` | Every `invoke("name")` in `src/` is registered in `lib.rs` |
| memory tests | The local memory tool still works |

`bundle-budget` is CI-only because it needs a `vite build`. It enforces the 1,490,000-byte first-load JavaScript ceiling.

The Rust gates are separate:

```powershell
cargo clippy --all-targets -- -D warnings
cargo deny check
```

`cargo deny` checks the Rust license allow-list, denies wildcard dependencies, and enforces the advisory policy in `deny.toml`. The spec firewall (`scripts/firewall-check.ps1 -Baseline`) checks that the clean-room spec prose stays code-free.

The docs builder is a manual gate today:

```powershell
node scripts/docs/build.mjs --check
```

It fails if an opted-in Markdown page has a stale HTML twin. It is not wired into `pnpm check` or CI yet.

## Smoke tests

`pnpm smoke` runs five end-to-end flows over the app's WebView2 debugging port. It launches the packaged app, drives the real window, and checks the result. The smoke script is in `scripts/evidence/smoke.mjs`; the release script runs it before signing.

## CI

`.github/workflows/ci.yml` has four jobs:

| Job | Runner | What it runs |
|---|---|---|
| `test` | Ubuntu, four shards | Vitest |
| `checks` | Ubuntu | tsc, license, plan, workflow, invoke-contract, Vite build, bundle budget |
| `rust` | Windows | Rust tests under scratch homes, clippy, cargo-deny, spec firewall |
| `bundle` | Windows, on dispatch or tag | NSIS installer build, artifact upload |
| `result` | Ubuntu | Fails if a required job failed |

The result job uses `always()` so a skipped or failed dependency cannot produce a green run.

## Flaky tests

The rule is: wait for the event you are checking, never widen a fixed timeout. A flaky required check blocks merges. Four named flakes (K1 to K4) were fixed by waiting on the real event, not by increasing a sleep. Do not mark a failing test as skipped or loosen its assertion to get a green run.

## Evidence

Visible changes need a screenshot from the app's own window, not the desktop. The evidence scripts use the WebView2 debugging port and save into `evidence/<task-id>.png` or `evidence/<task-id>.txt`.

A spec card is not done because the code compiles. It is done when its acceptance boxes are ticked with evidence. Live proofs that need the installed build are listed in `docs/live-proofs-windows.md`.

## Adding a test

- **Front end:** colocate `*.test.ts` beside the module. Name the test after the behaviour or the card id. For spec cards, use a `__cards__` folder when the test is a direct proof of an acceptance box.
- **Rust unit:** put the test in the module's `#[cfg(test)]` block. Use temp directories, never the real profile.
- **Rust integration:** add it to the matching `src-tauri/tests/cards_NN.rs` file. If it touches an agent home, go through `scratch_root` and add the fixture under `src-tauri/tests/fixtures/`.
- **A new gate:** add a `scripts/*.test.mjs` for the rule itself, then wire the gate into `pnpm check` or CI. Do not add a gate that only checks a string in a file if a behavioural test can check the result.

Write the failing test first. If the test passes before the change, it is not proving the change.
