---
name: kolux-cli
description: >-
  Operate Kolux-managed worktrees, folder contexts, terminals, repos, automations, artifacts,
  skill sharing, worktree comments, and Kolux's embedded browser through the `kolux` CLI. Use
  when the user says "$kolux-cli", "Kolux worktree", "child worktree", "spawn codex/claude in a
  worktree", "read/wait/send Kolux terminal", "hand this off to another Kolux worktree/agent",
  "Kolux browser", "kolux artifacts", or "share skills". Not for a session handoff note
  (the /handoff skill) or for in-process subagents. Prefer it over raw git
  worktree, ad hoc PTYs, or Computer Use when Kolux state is involved. Use Computer Use only
  for external windows or desktop UI that needs OS-level control, and Playwright or CDP for
  external pages.
---

# Kolux CLI

This discovery stub loads the version-matched guide from the Kolux executable used for this session.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `KOLUX_CLI_COMMAND` environment variable is set, use its value. Kolux exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `KOLUX_DEV_REPO_ROOT`, use `kolux-dev`.
- Otherwise, on Linux outside a Kolux-managed terminal, use `kolux-ide`. Never run bare
  `kolux` there — outside Kolux's terminals it normally resolves to the
  GNOME Orca screen reader (`/usr/bin/orca`) and starts speech on the user's machine.
- Otherwise, use `kolux`.

Below, `KOLUX` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `KOLUX` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Kolux build.

## Load the version-matched guide before running Kolux commands

```text
KOLUX skills get kolux-cli
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Kolux is not running, start it with `KOLUX open --json`
and retry. If `skills get` is unknown, explain that updating Kolux restores the guide; use
`--help` for read-only discovery and do not guess unsupported commands.
