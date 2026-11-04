# Code map

This page is the map of the repository. It names the files that matter for common changes, so you do not have to read 200 Rust modules to find the one you want.

## Root

| Path | What it is |
|---|---|
| `README.md` | The public front door |
| `LICENSE` | Source-available, all rights reserved |
| `SECURITY.md` | Private vulnerability reporting |
| `CONTRIBUTING.md` | Issue-first contribution policy and clean-room rule |
| `package.json` | Front-end dependencies and scripts |
| `pnpm-lock.yaml` | Locked Node dependencies |
| `vite.config.ts` | Vite, Vitest, dev CSP, port 1420 |
| `tsconfig.json` | TypeScript config |
| `deny.toml` | Rust dependency and license policy |
| `src/` | The React window |
| `src-tauri/` | The Rust core, the Tauri config, the installer assets |
| `scripts/` | Gates, tests, release, evidence, proofs |
| `spec/` | The behaviour specification |
| `docs/` | Public user, architecture, and development docs, plus the build record |
| `evidence/` | Per-task proof output and screenshots |

## Rust

The crate is `kolux-rs`, library `kolux_rs_lib`, in `src-tauri/`.

| Module | Responsibility |
|---|---|
| `src/main.rs` | Process dispatch: terminal service, uninstall PATH repair, agent install, desktop app |
| `src/lib.rs` | Tauri setup, command registration, startup, exit, background loops |
| `src/bin/kolux.rs` | The shipped `kolux` CLI binary, gated on `release-cli` |
| `src/bin/kolux-dev.rs` | The development CLI binary |
| `src/cli/` | Parser, command group handlers, local CLI server, `cli_register` |
| `src/terminal.rs` | Window-side terminal registry, `terminal_*` commands, reattach, generations |
| `src/pty.rs` | PTY layer, shell discovery, `portable-pty` session |
| `src/pty_service.rs` | The detached terminal service and its endpoint file |
| `src/pty_link.rs` | Window-side TCP link, attach, flow control |
| `src/pty_pump.rs` | Output pumping and back-pressure |
| `src/hooks.rs` | Agent hook listener, status mapping, protected-command answer |
| `src/agent_hooks/` | Per-agent hook installers, backups, removal, saved events |
| `src/state.rs` | SQLite store, settings file, atomic writes |
| `src/secrets.rs` | DPAPI sealing, vault, secret settings, profile ACL |
| `src/fence.rs` | File access rules and single-file grants |
| `src/protected.rs` | Built-in protected-command rules and parser |
| `src/protected_custom.rs` | User rules, project scopes, masking |
| `src/update.rs` | Update check, download, signature verification, install |
| `src/resources/update_guard.rs` | Authenticode publisher check |
| `src/resources/recovery.rs` | Crash recovery, database backup, safe graphics, permissions |
| `src/browser*.rs` | Browser engine, child webviews, preview, profiles, popups |
| `src/scm*.rs`, `src/git.rs` | Source control, diffs, pull requests, checks |
| `src/orchestration.rs`, `src/orchestration/` | Workers, tasks, mail, gates |
| `src/automations.rs`, `src/automations/` | Timetables, event triggers, runs |
| `src/artifacts.rs` | Artifact library and viewer scheme |
| `src/skills/` | Skill scan, install, delete |
| `src/claude_accounts.rs`, `src/codex_accounts.rs` | Managed sign-ins and homes |
| `src-tauri/capabilities/` | Tauri capability files |
| `src-tauri/installer-hooks.nsh` | PATH add/remove and the long-PATH hand-off |

The command table is the `generate_handler![...]` block in `src/lib.rs`. If you add a command, register it there or `scripts/invoke-contract.mjs` will fail.

## React

The window is in `src/`.

| Path | Responsibility |
|---|---|
| `src/main.tsx` | Boot, cached appearance, settings race, layout restore |
| `src/App.tsx` | Builds the `WindowBag` and renders `WindowView` |
| `src/shell/` | Window state, layout, panes, `WindowView`, save coordination |
| `src/chrome/` | Top bar, status bar, sidebar frame, icons, screen switcher |
| `src/terminal/` | Grid, tabs, xterm pane, reattach, renderer, layout save |
| `src/status/` | Agent status, notifications, restored rows, status surfaces |
| `src/board/` | Board lanes, cards, one status vocabulary |
| `src/agents/` | Agents rail and Tower figures |
| `src/tower/` | Tower screen and its own window |
| `src/floor/` | Activity timeline |
| `src/tasks/` | GitHub issues and pull requests |
| `src/automations/` | Automation list, dialog, runs |
| `src/skills/` | Skills page and installs |
| `src/artifacts/` | Artifact page and viewer |
| `src/settings/` | Settings pages, registry, save plumbing, sync |
| `src/onboarding/` | First-run wizard, guides, tours, help |
| `src/editor/` | CodeMirror, Lexical, preview, PDF, diffs, explorer |
| `src/browser/` | Browser pane, toolbar, child webview |
| `src/scm/` | Source control, checks, review notes |
| `src/projects/` | Projects, workspaces, CLI bridge |
| `src/sessions/` | Past sessions and resume |
| `src/usage/` | Plan limits, pills, token analytics |
| `src/update/` | Update center and schedule |
| `src/recovery/` | Heartbeat and crash boundary |
| `src/lazy/` | Deferred pages and pane bodies |
| `src/theme.ts` | Theme tokens, modes, first-frame cache |
| `src/styles.css` | The main stylesheet |

If you add a screen, update the screen union in `src/chrome/TopBar.tsx`, the page table in `src/settings/pages.ts` or `src/chrome/useScreens.tsx`, and the persistence in `src/shell/useWindowSave.ts`.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/plan-check.mjs` | PLAN.md coverage and STATE.md counters |
| `scripts/license-check.mjs` | npm license allow-list |
| `scripts/workflow-check.mjs` | CI workflow promises |
| `scripts/invoke-contract.mjs` | Every `invoke()` has a Rust command |
| `scripts/bundle-budget.mjs` | First-load JavaScript ceiling |
| `scripts/firewall-check.ps1` | Clean-room spec firewall |
| `scripts/test-env.ps1` / `.sh` | Scratch homes for Rust tests |
| `scripts/release.mjs` | Build, smoke, sign, publish |
| `scripts/ship.mjs` | Commit, merge, push, start a release |
| `scripts/ci-gate.mjs` | Wait for CI on the exact commit |
| `scripts/docs/build.mjs` | Markdown to self-contained HTML twins |
| `scripts/evidence/` | Smoke, CDP, screenshots, proof helpers |
| `scripts/prove/` | Live proof harnesses per card |
| `scripts/stress/` | Load and stress scenarios |

## Spec and records

| Path | What it is |
|---|---|
| `SPEC.md` | The behaviour spec index |
| `spec/01...21-*.md` | The 20 area files |
| `COMPAT.md` | Contracts kept from the old app |
| `PRIORITIES.md` | Build order and theme ranks |
| `PLAN.md` | The ordered task list and card coverage |
| `STATE.md` | Current counters, what works, open decisions |
| `DECISIONS.md` | Defaults, strikes, and choices the build follows |
| `PROVENANCE.md` | Clean-room source log |
| `evidence/` | Per-task proof output |
| `docs/live-proofs-windows.md` | The installed-build proof run sheet |

These are build records. Read `PLAN.md` and `DECISIONS.md` before changing behaviour that a card already defines. Do not rewrite them to make a change look approved.

## Where to change what

| Change | Start here |
|---|---|
| New Tauri command | Rust module, `src/lib.rs` `generate_handler!`, TypeScript wrapper |
| New screen | `src/chrome/TopBar.tsx`, `src/shell/useWindowSave.ts`, page table |
| New pane kind | `src/shell/window/Pane.tsx`, `src/lazy/panes.tsx` |
| New agent | `src-tauri/src/agents.rs` CATALOGUE, `agent_hooks/`, install page, status mapping |
| New setting | `src/settings/pages.ts`, settings registry, `useAppSettings`, Rust settings reader |
| New file operation | `src-tauri/src/fence.rs` first, then `files.rs`; never bypass the fence |
| New local endpoint | Loopback bind, random token, document it in `docs/architecture/security.md` |
| New release step | `scripts/release.mjs`, `.github/workflows/release.yml`, tests |
| New UI copy | Check `src/plainWords.test.ts` if the text is on a newcomer screen |

## Generated or exact-byte files

Do not hand-edit these:

- `dist/`, `node_modules/`, `src-tauri/target/`;
- `src-tauri/gen/schemas/` (generated Tauri schemas);
- `src-tauri/release.conf.json` (generated in the release checkout);
- `public/pdfjs/**` (copied files must stay byte-exact);
- `src/editor/__fixtures__/*` (exact line endings on purpose);
- any `docs/**/*.html` twin generated by `scripts/docs/build.mjs`.

`pnpm-lock.yaml` and `Cargo.lock` are tracked. Change them through pnpm or Cargo, not by hand.

## Conventions

- Match the style of the file you are editing. The code comments are dense and explain why, not what.
- Keep user-facing error messages in plain words. The plain-words test fails the build on banned jargon in newcomer screens.
- Colocate tests with the module. Use a `__cards__` folder only for a direct spec-card proof.
- Do not add a dependency for a small job the standard library or an existing crate already does.
- Do not add attribution lines to commits, comments, or UI.
- Never weaken a test to pass a gate.
