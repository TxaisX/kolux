# Agent notes

## Token and spend ledger

This repo keeps a local token and spend ledger at `docs/history/token-usage-ledger.md` (gitignored, so internal cost figures are not published).

After a substantial agent task, refresh it and mention the updated totals in the final response:

```powershell
python scripts/token-report.py --write
```

At minimum, report the all-time token total, the API-equivalent cost, and the recorded pay-per-token spend. The report reads local Claude Code, Codex, and OpenCode logs. Claude Code and Codex figures are API-list equivalents; the OpenCode line is recorded provider spend. If a new Txais Brain session is clearly Kolux work, add its 8-character session id to `TX_KOLUX_SESSIONS` in `scripts/token-report.py`.

## One worktree per session (2026-11-21)

Work happens in a worktree, never in the main checkout. The main checkout is the shared memory and
the merge target.

```powershell
# start: run inside the repo (or pass -Repo), work in the folder it prints
powershell -File G:\Dev\claude-config\scripts\new-worktree.ps1 -Name <name>

# land: run inside the worktree, after the work is committed and reviewed
powershell -File G:\Dev\claude-config\scripts\new-worktree.ps1 -Finish
```

- Worktrees live in `<repo>\.worktrees\<name>` and are ignored by git (`/.worktrees/` in `.git/info/exclude`).
- `-Finish` merges the lane branch into main with `--no-ff`, removes the folder and keeps the branch. It never pushes. Run it from outside the lane: Windows cannot delete a folder a shell is sitting in, so a `-Finish` run inside the lane merges and then leaves the folder behind.
- Memory files (`AGENTS.md`, `CLAUDE.md`, `docs/`, project memory under `G:\Dev\claude-config\projects\`) are written in the main checkout, not in a worktree.
- `node scripts/worktree-status.mjs` lists every worktree still holding commits main does not have, in any checkout.

## One repository (2026-11-09)

`origin` is `TxaisX/kolux`, the public repo with the full build history, the releases and the app's update feed. Everything in git is public, so never commit secrets, real tokens or private personal data. `.kolux/` and `artifacts/` stay local. A full backup of the old private `kolux-dev` repo is in `D:\AI\Kolux`.
