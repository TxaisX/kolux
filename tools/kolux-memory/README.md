# Kolux memory

A local record of what every Kolux agent worked on, rebuilt from sources that already exist on
this machine. It answers questions that otherwise die with a session: what did this agent do, what
was tried and failed, which card did a commit touch, and what is still open.

**It is not a shared database.** Every machine builds its own file. The database is written outside
the repository and is never committed. The tool is the portable part.

## Quick start

```powershell
cd <your clone of kolux-rs>
node tools/kolux-memory/cli.mjs build --github
node tools/kolux-memory/cli.mjs status
node tools/kolux-memory/cli.mjs resume
node tools/kolux-memory/cli.mjs record --agent memory-scout --title "Built the memory database (PR #36 open)" --status done --detail "PR #36" --evidence "PR #36"
node tools/kolux-memory/cli.mjs items --agent memory-scout
```

`resume` prints a handoff brief: the scoreboard, open P0 cards, failures on open cards, recorded
work, the last three days of sessions/commits/PRs/releases, and the agents that did the work. Run it
at the start of a session. Run `build` again at the end so the next session sees the result.
`record` writes one completed item to a local ledger beside the database; a rebuild replays it, so
the record survives the cache being replaced.

## Where the data comes from

| Source | Default | What it contributes |
|---|---|---|
| Agent session store | `~/.local/share/opencode/opencode.db` | Sessions, user/assistant text, tool calls, agents, models, cost |
| Kolux repo | `G:\Dev\kolux-rs` | 2,900+ commits, worktrees, `spec/` cards, `evidence/` files, `docs/` |
| Vault | `G:\Dev\Projects\Txais Brain` | Kolux project notes, syntheses, `.kolux/handoffs/` |
| Local work ledger | `<db folder>\work-items.jsonl` | Completed items written with `record`; replayed on every build |
| GitHub (optional, `--github`) | `TxaisX/kolux` via `gh` | Pull requests and releases |

Defaults can be overridden with `--sessions`, `--repo`, `--vault`, `--db`, or the environment
variables `KOLUX_MEMORY_SESSIONS`, `KOLUX_MEMORY_REPO`, `KOLUX_MEMORY_VAULT`, `KOLUX_MEMORY_DB`.

The default database is
`%APPDATA%\com.txaisxiong.kolux-rs\memory\kolux-memory.db`. A test or a second profile can point
`--db` somewhere else. Nothing in the repo is modified by a build.

## What is stored

| Table | Rows on the author's machine | Purpose |
|---|---|---|
| `sessions` | 59 | one row per agent session, with agent, model, directory, cost, token counts |
| `messages` | 1,348 | user and assistant text only; reasoning blocks are dropped |
| `tools` | 10,600+ | tool name, status, input and output preview |
| `commits` | 2,944 | every commit on every branch, with author, files, insertions |
| `prs`, `releases` | 36, 3 | optional GitHub enrichment |
| `cards` | 1,264 | every spec card, tier, boxes, pass/open |
| `evidence` | 2,530 | every evidence file, the card/task it names, PASS/FAIL |
| `documents` | 58+ | Kolux project notes, syntheses, repo docs, handoffs |
| `agents` | roles and models | who worked, how much, last seen |
| `work_items` | the ledger | completed items recorded with `record`, newest first |
| `events` | merged | sessions, commits, PRs, releases, docs, evidence and recorded work on one timeline |
| `search` | FTS5 | full-text search across messages, tools, commits, evidence and docs |

The database is a cache, not a source of truth, except the work ledger: recorded items are replayed on every build. Delete the database and rebuild at any time; delete the ledger and only recorded items are lost.

## Commands

```
build [--github] [--no-git] [--db path] [--sessions path] [--repo path] [--vault path]
status
search "words" [--limit n]
timeline [--days n] [--kind session|commit|pr|release|evidence|doc]
session <id prefix or title>
agent <role or model>
card <CARD-ID>
record --title "what was done" [--agent name] [--status done] [--detail text] [--evidence path]
items [--agent name] [--limit n]
resume [--md path]
export [--md path]
```

Examples:

```powershell
node tools/kolux-memory/cli.mjs search "first load"
node tools/kolux-memory/cli.mjs card BROW-008
node tools/kolux-memory/cli.mjs timeline --days 2 --kind commit
node tools/kolux-memory/cli.mjs agent deepseek
node tools/kolux-memory/cli.mjs resume --md .\resume.md
```

## Privacy

- Local file, local build. The tool makes no network call unless `--github` is passed.
- Reasoning blocks are not stored.
- Credential-shaped strings in stored text are replaced with `[redacted]`: API keys, GitHub
  tokens, Slack tokens, AWS keys, private key blocks, bearer tokens and `key=value` secrets.
- The database still contains the text agents wrote, so treat it like the session store it came
  from. Do not commit it, paste it into an issue, or sync it to a shared drive.
- `--github` calls `gh`, which uses the machine's own GitHub login.

## Design

- One transaction per build, `journal_mode = memory`, then rename into place. A build over 59
  sessions, 2,940 commits and 2,530 evidence files takes about 7 seconds.
- Rebuilds are idempotent; the temp file is discarded if a build fails.
- The work ledger is append-only JSONL beside the database. `record` inserts into the live database
  and appends to the ledger; every build replays the ledger, so a record survives a rebuild and a
  deleted cache.
- Sources are opened read-only. A missing source produces a smaller database, never a crash.
- Tests use a synthetic machine: `node --test tools/kolux-memory/test.mjs` (5 tests, including a
  record, a rebuild and a query back).

## Limits

- Only the local OpenCode session store is read. A Claude Code or Codex session that never went
  through this store is not in the database; add an adapter when one is needed.
- GitHub is optional because a fresh machine may have no `gh` login.
- The DB grows with tool output. The author's is about 70 MB for 10,000 tool calls; clip more in
  `lib.mjs` if that matters on a smaller machine.
