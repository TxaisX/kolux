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

<!-- shared: resolver -->

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

<!-- shared: no-guessing -->
