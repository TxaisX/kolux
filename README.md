<p align="center">
  <img src="design/icon/kolux-mark.svg" width="72" height="72" alt="Kolux">
</p>

<h1 align="center">Kolux</h1>

<p align="center">
  <strong>Run many AI coding agents side by side.</strong><br>
  Each one gets its own terminal, all in your project's folder.
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

Kolux is a Windows desktop app for people who run several AI coding agents at once. It starts Claude Code, Codex, Gemini CLI, and 30+ other agent CLIs in a grid of real terminal panes. Kolux works in one folder per project: every agent you launch there works in that same folder, and Kolux makes no extra copies. Give each agent a different part of the job, because two agents editing the same file can overwrite each other.

> **Early alpha.** Kolux is built and used daily on Windows 11, but it has not been tested by outside users yet. Keep your work in Git, expect breaking changes, and report what breaks. [Status](docs/STATUS.md) lists what is verified and what is still open.

## What it does

- **Parallel agents in one folder.** Launch a Solo, Pair, Workbench, or Swarm lineup. Every seat works in your project's folder, and the chooser warns that several AIs will edit the same files, so split the work between them.
- **One window.** Terminals, browser tabs, an editor, and diffs sit in the same split layout.
- **Status at a glance.** Claude Code, Codex, Gemini CLI, and other agents report their own state through hooks. Working, needs you, stopped, and done use one vocabulary across the pane, Board, Inbox, tray dot, and notifications.
- **Usage and limits.** Token and cost figures come from local Claude and Codex logs. Weekly plan limits show on the pill and pane gauges where the provider reports them.
- **Review and ship.** When an agent finishes, press **Review changes** on its Board card or Inbox row. That opens All Changes, where you read every changed file, then stage, commit, push, and pull. Pull-request checks show in the right panel's Checks tab.
- **Local first.** No telemetry. Keys are sealed with Windows DPAPI. The app talks to GitHub (Releases and API), your Git remotes, and the AI providers you connect; the full list is in Settings, General, Privacy.

## Install

1. Open the [latest release](https://github.com/TxaisX/kolux/releases/latest) and download `Kolux.RS_<version>_x64-setup.exe`.
2. Run the installer. It installs for your Windows user and adds the `kolux` command to your PATH.
3. Open Kolux. The first-run setup asks you to connect an AI, pick a project folder, and start a session.

> The installer file keeps its `Kolux.RS_…` name for one more release while the install identity moves; the app it installs is Kolux.

**The installer is not code-signed yet.** Kolux is a free alpha and has no Windows code-signing certificate, so Windows treats the installer as from an unknown publisher. What you will see:

- **SmartScreen ("Windows protected your PC").** Choose **More info**, then **Run anyway**, after checking that you downloaded the file from this repository's Releases page. Right-click the file, open **Properties**, and the **Digital Signatures** tab will be absent; that is expected until signing arrives.
- **Smart App Control.** If Windows 11 has Smart App Control turned on, it can block an unsigned installer with no Run anyway button. Kolux cannot be installed on that PC until the installer is signed; Windows does not offer a one-off exception.
- **Updates are still checked.** The update manifest carries its own signature, and an installed Kolux verifies it before installing an update.

## Requirements

- Windows 11 x64 is the tested target. Windows 10 is not yet verified end to end.
- The WebView2 runtime. Windows 11 includes it; the installer can fetch it if it is missing.
- Git, for the changes view and for committing, pushing, and pull requests.
- At least one agent CLI. Kolux can install some agents for you; others you install first.
- Node.js for agents that are distributed through npm. If an agent's install fails because Node.js is too old, Kolux says which version the agent needs and how to update.

## First run

On first launch, a four-step dialog asks you to connect at least one AI, choose a project folder or skip, and open a session. You can reopen it later from Help, Onboarding. The [getting started guide](docs/guide/getting-started.md) walks through each step and the top bar.

## How it works

Kolux is a Tauri 2 app. The window is React and TypeScript; the core is Rust. Each pane is a real PTY running your shell or agent, and a background terminal service lets panes outlive the window. Agents report status through hooks that Kolux installs in the agent's own settings, or through a plugin or extension where the agent supports one. Reports go to a loopback listener that requires a per-run token. There is no Kolux server.

## Privacy

Kolux has no telemetry, analytics, or crash upload. Your projects, settings, terminal output, and keys stay on your computer. Keys and managed sign-ins are sealed with Windows DPAPI at current-user scope. Feedback and crash reports open a pre-filled GitHub issue in your browser; nothing is sent until you submit it.

The full list of outbound connections is in Settings, General, Privacy and in the [safety guide](docs/guide/safety.md).

## Documentation

| Read | For |
|---|---|
| [User guide](docs/guide/README.md) | The full guide: setup, terminals, projects, reviewing changes, settings, CLI |
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

Kolux is in early alpha. The latest build is 0.1.9 (6 November 2026). The update feed is this repository's Releases page; installed copies check it automatically. Known gaps and verification status are in [Status](docs/STATUS.md).

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
