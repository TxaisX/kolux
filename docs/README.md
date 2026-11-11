# Kolux documentation

This folder is the public documentation for Kolux. It has two audiences: people using the app, and people who want to understand how it is built.

If you are new, read [Getting started](guide/getting-started.md). If you want to know what works today, read [Status](STATUS.md).

## Use Kolux

| Page | What it covers |
|---|---|
| [Getting started](guide/getting-started.md) | First launch, setup, the top bar, your first agent |
| [Terminals](guide/terminals.md) | Panes, splits, tabs, layouts, paste, shortcuts |
| [Board, Agents and Inbox](guide/board-agents-inbox.md) | Session states, approvals, the Tower and the Floor |
| [Projects and folders](guide/projects-and-worktrees.md) | Projects, folders, review and commit |
| [Files and browser](guide/files-and-browser.md) | The editor, diffs, previews, the browser pane |
| [Settings](guide/settings.md) | Appearance, terminal, notifications, shortcuts, agents |
| [Safety](guide/safety.md) | What Kolux guards, what it warns about, and what it leaves to you |
| [Command line](guide/command-line.md) | The `kolux` command and every command group |
| [Troubleshooting](guide/troubleshooting.md) | Common problems and the diagnostics report |
| [Feature index](guide/feature-index.md) | Every feature, by name |

## Reference

| Page | What it covers |
|---|---|
| [Status](STATUS.md) | What is verified, what is missing, and what alpha means here |
| [Glossary](GLOSSARY.md) | The words the app uses: project, workspace, seat, pane, Model routing, and the rest |
| [Safety](guide/safety.md) | The security model in plain words |
| [Privacy](guide/settings.md#privacy) | Every outbound connection the app makes |
| [Security policy](../SECURITY.md) | Private vulnerability reporting |
| [Build from source](../README.md#build-from-source) | Prerequisites and the development loop |

## How it is built

| Page | What it covers |
|---|---|
| [Architecture overview](architecture/overview.md) | Processes, runtime topology, startup, terminal lifecycle, local doors, updates |
| [Architecture infographic](architecture/architecture.svg) | The one-page visual version |
| [Data and storage](architecture/data.md) | The profile, the SQLite store, settings, the vault, recovery |
| [Security model](architecture/security.md) | Trust boundaries, the file fence, protected commands, web isolation, update trust |
| [Frontend](architecture/frontend.md) | The React shell, state flow, terminal grid, editor, styling |
| [Building](development/building.md) | Prerequisites, local development, build outputs |
| [Testing](development/testing.md) | Vitest, Rust tests, scratch homes, gates, CI |
| [Releasing](development/releasing.md) | Versioning, signing, the release script, the update feed |
| [Code map](development/code-map.md) | The repository layout and where to change what |

The source starting points are also stable:

- `src-tauri/src/lib.rs` registers the Rust commands and starts the app.
- `src-tauri/src/terminal.rs` and `src-tauri/src/pty_service.rs` hold the terminal service; `src-tauri/src/pty.rs` is the PTY layer.
- `src-tauri/src/hooks.rs` holds the loopback listener that agents report to.
- `src/` is the React window.

Two build documents are public:

| File | What it is |
|---|---|
| [`live-proofs-windows.md`](live-proofs-windows.md) | The live verification run sheet for Windows |
| [`research/kolux-slimdown-2026-11-09.md`](research/kolux-slimdown-2026-11-09.md) | The footprint report: memory and processor use, measured before and after |

The rest of the build record (the plan, the decisions, the behaviour specification and its provenance log, the proof files, the cycle reports and audits) is kept in a private companion repository. `scripts/hive.mjs` lays it over a checkout for the people who have access to it.

## Documentation status

The user guide, architecture set, and development set are in place. The next pieces are a supported-agents matrix, fresh screenshots, and a user-facing changelog. If a page is missing or wrong, open an issue on the repository.
