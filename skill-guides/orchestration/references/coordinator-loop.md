# Coordinator loop

Load this reference for expanded DAG waves, per-invocation launch preferences,
same-terminal reuse, or review ownership. The compact guide remains the source
of truth for the loop order and completion boundary.

## Ready waves

Create independent Tasks before the first wait. Encode only real dependencies,
then use the ready view as external memory:

```text
KOLUX orchestration task-create --spec "<dependent work>" --deps <json_array> --json
KOLUX orchestration task-list --ready --brief --json
```

`--brief` collapses whitespace and caps echoed specs at 160 characters;
`spec_truncated` identifies shortened rows. Omit it when full specs are needed or
when an older CLI rejects the flag. A nested worker must respect
`nested_worker_depth_exceeded`; creating another Run does not reset depth.

## Launch preferences

Providers never mix: a worker always runs on the coordinator's own agent
(Claude, Codex, ...), never a different one. Tiers pick among that provider's
own models — they never change which provider runs.

Classify every task into a routing tier and pass `--tier`; Kolux resolves it to
a model and effort from the user's own Settings > Agents > Model routing for
the coordinator's own provider, so cheap work lands on cheap models without
the coordinator naming one:

- `major` — building something big or changing a system as a whole: plan and final review.
- `deep` — planning, review, hard bugs, architecture.
- `build` — implementing features and multi-file refactors.
- `light` — mechanical work: renames, lint fixes, test scaffolding, search/summarize, docs.

```text
KOLUX orchestration worker-start --task <task_id> --worktree current --tier build --json
```

If the user explicitly named a model, that wins: use `--agent`/`--model`/
`--effort` instead of `--tier` for that launch, and never start the worker on
another provider than the coordinator's own. `--tier` cannot combine with
`--model`, `--effort`, or `--terminal`. `--agent` may still accompany `--tier`,
but only to restate the coordinator's own agent, or to supply one when the
coordinator's agent cannot be detected — never to route to a different
provider. `--effort` requires `--model`; neither combines with `--terminal`. A
connected worker server must advertise launch-preference (or tier-routing)
support before Kolux forwards the resolved fields.

Before starting a worker for a small task, consider doing it yourself instead:
every worker pays a fixed startup cost to load its system prompt, skills, and
MCP servers, so a one-line rename or a quick lookup is often cheaper done
directly than dispatched.

Compare `launch.requested` with `launch.effective`; never claim a model or
effort from requested arguments alone.

## Reuse after settlement

Choose the terminal's next owner before acknowledging the Delivery. When the
same exact agent has immediate follow-up work, recover the proven handle and
transfer cleanup ownership to the new Dispatch:

```text
KOLUX orchestration worker-show --dispatch <dispatch_id> --json
KOLUX orchestration worker-start --task <next_task_id> --terminal <agent_terminal_handle> --json
```

Otherwise explicitly retain or release the settled worker. Do not leave it live
only to inspect output; archived output remains available through `worker-read`.

## Review ownership

A review-only `worker_done` authorizes synthesis of findings, not coordinator
file edits. Dispatch or hand off fixes unless the user explicitly assigned them
to the coordinator. If the user's plan names a next owner, post-review fixes and
PR preparation remain with that owner; the coordinator routes and synthesizes.
