---
name: orchestration
description: >-
  Coordinate supervised Kolux workers: threaded messages, blocking ask/reply,
  task dispatch, worker_done/escalation waits, task DAGs, decision gates,
  coordinator loops, and decomposing work across agents. Use `kolux-cli` for full
  ownership handoffs — "hand off", "handoff", "handover", "give this to another
  agent", "another worktree" — unless asked to supervise, monitor, or coordinate
  a DAG, and for terminal control, lightweight terminal prompts, shell commands,
  Kolux worktree management, and reading or waiting on terminals. Use Computer
  Use for external browser windows, webviews, Kolux app UI, or desktop UI outside
  Kolux's embedded browser only when the task requires OS/window-level control
  such as focus, menus, dialogs, coordinates, or screenshots. Use `kolux-cli` for
  Kolux's embedded pages and a page-automation tool such as Playwright or CDP for
  external pages.
---

# Kolux Orchestration

This file is a discovery stub, not the usage guide. The full, version-matched Kolux
orchestration reference is served by the `kolux` binary itself — kept out of this file on
purpose so it can never drift from the binary that will actually run your commands.

Engage Kolux orchestration whenever you need structured multi-agent coordination: threaded
messages, blocking ask/reply flows, task dispatch, worker_done/escalation waits, task DAGs,
decision gates, coordinator loops, or decomposing work across agents. Use the kolux-cli skill
instead for full ownership handoffs ("hand off", "handoff", "handover", "give this to
another agent", "another worktree") when the user did not ask to supervise, monitor, wait
for results, or coordinate a DAG — and for ordinary terminal control, shell commands,
worktree management, and the built-in browser. Coordination requires real Kolux runtime
state; never substitute a non-Kolux subagent tool.

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
KOLUX skills get orchestration
```

That prints the compact, version-matched guide for the exact binary that will handle your
next commands. It covers the normal local coordinator loop. For a conditional action gate
such as remote placement, uncertain release recovery, or expanded DAG work, load only the
reference that gate names with
`KOLUX skills get orchestration --reference references/<file>.md`
(`--references` lists the names). If that binary rejects `--reference`, run
`KOLUX skills get orchestration --full` and read the named bundled reference before acting.

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Kolux is not running, start it with `KOLUX open --json`
and retry. If `skills get` is unknown, explain that updating Kolux restores the guide; use
`--help` for read-only discovery and do not guess unsupported commands.
