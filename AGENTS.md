# Agent notes

## Token and spend ledger

This repo keeps a local token and spend ledger at `docs/history/token-usage-ledger.md` (gitignored, so internal cost figures are not published).

After a substantial agent task, refresh it and mention the updated totals in the final response:

```powershell
python scripts/token-report.py --write
```

At minimum, report the all-time token total, the API-equivalent cost, and the recorded pay-per-token spend. The report reads local Claude Code, Codex, and OpenCode logs. Claude Code and Codex figures are API-list equivalents; the OpenCode line is recorded provider spend. If a new Txais Brain session is clearly Kolux work, add its 8-character session id to `TX_KOLUX_SESSIONS` in `scripts/token-report.py`.

## Private dev repo, clean public repo (2026-11-09)

`origin` is the private repo `TxaisX/kolux-dev`; push work, lanes and cloud-session branches there. `public` is `TxaisX/kolux` (public source plus the update feed). Never push a branch to `public`. The only way onto it is `node scripts/export-public.mjs --push`, which publishes a clean copy of `main` without the planning files, evidence, audits, `.claude/` and this file. Release order: `docs/development/releasing.md` "Two repositories". GitHub Actions is off on the private repo to save minutes; CI runs on the public export.
