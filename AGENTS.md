# Agent notes

## Two repositories, one folder (2026-11-11)

`origin` is `TxaisX/kolux`, the public repository: the product's code and tests, the user and development docs, the releases and the app's update feed. Everything in it is public, so never commit secrets, real tokens or private personal data. `.kolux/` and `artifacts/` stay local.

The build record is private. The plan, the state and decision logs, the loop's rules, the behaviour spec and its provenance log, the proof files and screenshots, the cycle reports and audits, and the one-off proof and stress scripts live in the Hive, a private companion repository. `scripts/hive.mjs` lays it over this checkout: its git data sits in `.hive/` and its files sit at the paths they always had, so the tools find them.

- `node scripts/hive.mjs attach` once per checkout; `status`, `add`, `commit`, `push` and `pull` after that. `node scripts/hive.mjs paths` lists what the Hive holds.
- A change that touches both sides (code, plus its evidence file and its decision row) is two commits: `git` for the public side, `node scripts/hive.mjs` for the Hive.
- Never `git add -f` a Hive path. The public `.gitignore` lists every one of them and `scripts/hive.test.mjs` fails if one is tracked here.
- Without the Hive attached (a fresh clone, a cloud session), the plan check and the guide check report that they were skipped; everything else builds and tests the same. Do not recreate Hive files here to make a check run.

## Token and spend ledger

The token and spend ledger is `docs/history/token-usage-ledger.md`, a local file that is never committed. Its script, `scripts/token-report.py`, is a Hive file.

With the Hive attached, after a substantial agent task, refresh the ledger and mention the updated totals in the final response:

```powershell
python scripts/token-report.py --write
```

At minimum, report the all-time token total, the API-equivalent cost, and the recorded pay-per-token spend. The report reads local Claude Code, Codex, and OpenCode logs. Claude Code and Codex figures are API-list equivalents; the OpenCode line is recorded provider spend. If a new session from the owner's notes workspace is clearly Kolux work, add its 8-character session id to `TX_KOLUX_SESSIONS` in `scripts/token-report.py`.

Without the Hive attached there is no ledger to refresh: say so in one line and carry on.
