# Status

Last updated: 10 November 2026. Current build: 0.1.11.

Kolux is in early alpha. This page says what is verified, what is usable but unverified, and what is not there yet. It is the honest complement to the user guide.

## Platform

| Platform | Status |
|---|---|
| Windows 11 x64 | Tested. This is where daily use and the live verification runs happen. |
| Windows 10 x64 | It should run, but it is not verified end to end. Terminal reflow on older ConPTY builds is the main known risk. |
| macOS, Linux | Not available. |

## What is verified

- CI runs on every pull request and every push to `main`: TypeScript, four front-end test shards, Rust tests, clippy, cargo-deny, the license check, the invoke contract, and the bundle budget.
- A release is published only after CI passes for that exact commit. The update manifest is signed, and installed copies verify the signature before they install.
- The project's P0 acceptance suite is at 208 of 228 cards. The open cards are mostly live-proof checks, not missing features. The ones that affect users are listed below.
- No telemetry. A network watch of a normal session found only loopback traffic from the app and WebView2's own startup checks.
- The installed build has been used daily on Windows 11 through the 0.1.x releases.
- Build 0.1.11 is stricter about folders you downloaded: it does not push into local repositories or run programs named in a folder's own git config unless you trust the folder, and it marks a workspace as trusted for Claude or Codex only when its code is on your own `origin` branches. The [changelog](../CHANGELOG.md) has the wording users see.
- Build 0.1.11 is lighter while you are not looking at it. With 12 terminals open and the window minimised it keeps 226 MB in memory and uses 5 % of one processor core, down from 544 MB and 13 %, measured on release builds on the project's test PC. The [footprint report](research/kolux-slimdown-2026-11-09.md) has every run. Its round 3 and later gains (streaming output, typing while other panes flood) are on `main` and not in a release yet.

## Known gaps in the alpha

- **No outside testers yet.** Every report so far comes from the author's own PC, so problems that only show on another machine have not been found. The README says how to [help test the alpha](../README.md#help-test-the-alpha).
- **The installer is not Authenticode-signed.** Windows SmartScreen warns on first run (More info, then Run anyway), and a Windows 11 PC with Smart App Control on can block it outright. Signing waits on a certificate identity. The update manifest is signed separately.
- **The "Install CLI & Skills" step cannot fetch the published skills yet.** The skills repository is not public. The `kolux` command itself installs and works.
- **Quit-to-install updates are not yet proven end to end.** When the app offers an update, use **Restart to update** rather than relying on quit.
- **Codex and Gemini status on a fresh machine is not yet proven** without manual setup. Claude Code is the most tested path.
- **Windows 10 terminal reflow is unverified.** Windows 11 is the tested target.
- **Some agent integrations are status-only.** A few agents have no public hook format, so Kolux falls back to reading the terminal title.
- **Kolux is not a sandbox.** It protects your files and your work in progress, but the agents you run have the permissions you give them. Read [Safety](guide/safety.md) before running agents on work you cannot afford to lose.
- **macOS and Linux are not available.**

## What alpha means here

- Breaking changes are allowed between 0.1.x builds.
- There is no support SLA.
- Saved formats may change. Keep projects in Git so your work is never trapped in the app.
- Feedback is read, but not every request will be built.

## How to report a problem

Open an [issue](https://github.com/TxaisX/kolux/issues) with:

- the version, from Help, About;
- your Windows version;
- what you did, what you expected, and what happened;
- a diagnostics report from Settings, General, Diagnostics, **Copy diagnostics**. It masks keys, tokens, and passwords. **Write a review copy and open it** lets you read the report before you share it.

If the problem involves a terminal, the pane menu also has **Copy terminal diagnostics**.

For a security problem, do not open a public issue. Follow the [security policy](../SECURITY.md).
