# Agent notes

## Token and spend ledger

This repo keeps a local token and spend ledger at `docs/history/token-usage-ledger.md` (gitignored, so internal cost figures are not published).

After a substantial agent task, refresh it and mention the updated totals in the final response:

```powershell
python scripts/token-report.py --write
```

At minimum, report the all-time token total, the API-equivalent cost, and the recorded pay-per-token spend. The report reads local Claude Code, Codex, and OpenCode logs. Claude Code and Codex figures are API-list equivalents; the OpenCode line is recorded provider spend. If a new Txais Brain session is clearly Kolux work, add its 8-character session id to `TX_KOLUX_SESSIONS` in `scripts/token-report.py`.
