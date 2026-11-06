<p align="center">
  <img src="design/icon/kolux-mark.svg" width="72" height="72" alt="Kolux">
</p>

<h1 align="center">Kolux</h1>

<p align="center">
  <strong>Run many AI coding agents side by side.</strong><br>
  Each one gets its own terminal. From two agents up, each gets its own Git worktree by default.
</p>

<p align="center">
  <a href="https://github.com/TxaisX/kolux/releases/latest">Download the latest build</a> ·
  <a href="docs/guide/README.md">User guide</a> ·
  <a href="docs/STATUS.md">Status</a> ·
  <a href="https://github.com/TxaisX/kolux/issues">Issues</a>
</p>

<p align="center">
  <a href="https://github.com/TxaisX/kolux/actions/workflows/ci.yml"><img src="https://github.com/TxaisX/kolux/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="https://github.com/TxaisX/kolux/releases/latest"><img src="https://img.shields.io/github/v/release/TxaisX/kolux?label=release" alt="Latest release"></a>
</p>

Kolux is a Windows desktop app for people who run several AI coding agents at once. It starts Claude Code, Codex, Gemini CLI, and 30+ other agent CLIs in a grid of real terminal panes. When you launch two or more agents, each gets its own Git worktree by default, so they can work on the same project without editing the same files.

> **Early alpha.** Kolux is built and used daily on Windows 11, but it has not been tested by outside users yet. Keep your work in Git, expect breaking changes, and report what breaks. [Status](docs/STATUS.md) lists what is verified and what is still open.

## What it does

- **Parallel agents without shared checkouts.** Launch a Solo, Pair, Workbench, or Swarm lineup. From two agents up, each seat gets its own worktree by default; a shared folder is one click away.
- **One window.** Terminals, browser tabs, an editor, diffs, and source control sit in the same split layout.
- **Status at a glance.** Claude Code, Codex, Gemini CLI, and other agents report their own state through hooks. Working, needs you, stopped, and done use one vocabulary across the pane, Board, Inbox, tray dot, and notifications.
- **Usage and limits.** Token and cost figures come from local Claude and Codex logs. Weekly plan limits show on the pill and pane gauges where the provider reports them.
- **Review and ship.** Stage, commit, push, open a pull request, and follow checks without leaving the app.
- **Local first.** No telemetry. Keys are sealed with Windows DPAPI. The app talks to GitHub (Releases and API), your Git remotes, and the AI providers you connect; the full list is in Settings, General, Privacy.

## Install

1. Open the [latest release](https://github.com/TxaisX/kolux/releases/latest) and download `Kolux.RS_<version>_x64-setup.exe`.
2. Run the installer. It installs for your Windows user and adds the `kolux` command to your PATH.
3. Open Kolux. The first-run setup asks you to connect an AI, pick a project folder, and start a session.

> The installer file keeps its `Kolux.RS_…` name for one more release while the install identity moves; the app it installs is Kolux.

The current installer is not Authenticode-signed, so Windows SmartScreen may warn on first run. Choose **More info**, then **Run anyway**, after checking that the file came from this repository's Releases page. The update manifest is signed separately.

## Requirements

- Windows 11 x64 is the tested target. Windows 10 is not yet verified end to end.
- The WebView2 runtime. Windows 11 includes it; the installer can fetch it if it is missing.
- Git, for worktrees and source control.
- At least one agent CLI. Kolux can install some agents for you; others you install first.
- Node.js for agents that are distributed through npm. Kolux reports when the installed Node is too old.

## First run

On first launch, a four-step dialog asks you to connect at least one AI, choose a project folder or skip, and open a session. You can reopen it later from Help, Onboarding. The [getting started guide](docs/guide/getting-started.md) walks through each step and the top bar.

## How it works

Kolux is a Tauri 2 app. The window is React and TypeScript; the core is Rust. Each pane is a real PTY running your shell or agent, and a background terminal service lets panes outlive the window. Agents report status through hooks that Kolux installs in the agent's own settings, or through a plugin or extension where the agent supports one. Reports go to a loopback listener that requires a per-run token. There is no Kolux server.

Worktrees are ordinary Git worktrees. You can inspect, commit, or remove them with any Git tool.

## Privacy

Kolux has no telemetry, analytics, or crash upload. Your projects, settings, terminal output, and keys stay on your computer. Keys and managed sign-ins are sealed with Windows DPAPI at current-user scope. Feedback and crash reports open a pre-filled GitHub issue in your browser; nothing is sent until you submit it.

The full list of outbound connections is in Settings, General, Privacy and in the [safety guide](docs/guide/safety.md).

## Documentation

| Read | For |
|---|---|
| [User guide](docs/guide/README.md) | The full guide: setup, terminals, projects, source control, settings, CLI |
| [Getting started](docs/guide/getting-started.md) | First launch, the top bar, your first agent |
| [Status](docs/STATUS.md) | What is verified, what is missing, and what alpha means here |
| [Glossary](docs/GLOSSARY.md) | The words the app uses |
| [Safety](docs/guide/safety.md) | What Kolux guards and what it leaves to you |
| [Security policy](SECURITY.md) | How to report a vulnerability privately |
| [Architecture](docs/architecture/overview.md) | Processes, local doors, data, trust boundaries |
| [Architecture infographic](docs/architecture/architecture.svg) | The one-page visual map |
| [Development](docs/development/README.md) | Building, testing, releasing, code map |
| [Troubleshooting](docs/guide/troubleshooting.md) | Fix common problems and produce a safe report |
| [Command line](docs/guide/command-line.md) | Drive Kolux from a shell |
| [Feature index](docs/guide/feature-index.md) | Find a feature by name |

The [documentation home](docs/README.md) has the full index.

## Project

Kolux is in early alpha. The latest build is 0.1.8 (6 November 2026). The update feed is this repository's Releases page; installed copies check it automatically. Known gaps and verification status are in [Status](docs/STATUS.md).

Bug reports and feature requests go to [Issues](https://github.com/TxaisX/kolux/issues). If you want to propose a code change, open an issue first so we can agree on scope; read [CONTRIBUTING.md](CONTRIBUTING.md) before you start.

## Build from source

Requirements: Node.js 24, pnpm 12, Rust 1.90 or newer, the Tauri Windows prerequisites (WebView2 and the MSVC build tools), and Git.

```powershell
pnpm install
pnpm tauri dev
```

Build the installer with `pnpm tauri build`. Run the front-end tests with `pnpm test`. The Rust integration tests need scratch home folders, so run them under the provided environment:

```powershell
. .\scripts\test-env.ps1
cargo test
```

CI runs the full gate on every pull request and every push to `main`.

The full development docs are in [docs/development](docs/development/README.md): [building](docs/development/building.md), [testing](docs/development/testing.md), [releasing](docs/development/releasing.md), and the [code map](docs/development/code-map.md).

## License

Kolux is source-available. Copyright (c) 2026 Txais Xiong. All rights reserved. See [LICENSE](LICENSE). The source is public so you can read and review it; it is not open source.

Kolux is an independent project and is not affiliated with or endorsed by Anthropic, OpenAI, Google, GitHub, Microsoft, or the other agent vendors it can run.
