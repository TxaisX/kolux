# LANE-REPORT c1-coord

NOTE: this file is deliberately NOT committed on integrate/wave-1. Committing it would put a
LANE-REPORT.md on the integration branch and every lane's round-start merge would hit an
add/add conflict with its own report. It persists on disk in this worktree. See AUDIT-c1-coord.md #0.

## Status (plain words)
Round 1 done: coordinator audit written, baseline gate green on the starting code, bugs routed.
Lane merges are paused until Txais picks a fix for the LANE-REPORT.md collision.

## Done this round (round 1, 2026-11-12)
- AUDIT-c1-coord.md written and committed (12 findings, P0 1, P1 2, P2 5, P3 4).
- Baseline gate on integrate/wave-1 = main 2029d743 (no lane merged: see below). Logs in G:\Dev\kolux-lanes\_shared\logs\c1-gate\.
  - `npx tsc --noEmit` -> `tsc exit 0`
  - `pnpm check` -> `plan-check: OK` ... `check exit 0` (first attempt at 10:46 died with 0xC0000142 under load; re-run passed)
  - `npx vitest run` -> `Test Files 1 failed | 916 passed (917)`, `Tests 1 failed | 6800 passed (6801)`. Failure: src/terminal/outputFlood.test.ts 48 MB parse timed out 5010 ms. Re-run alone: `Tests 2 passed (2)`. Load flake.
  - `cargo test --manifest-path src-tauri/Cargo.toml` -> `test result: FAILED. 3160 passed; 1 failed; 7 ignored` (tools::tests::row961 ... got Hung). Re-run alone: `test result: ok. 2 passed; 0 failed`. Load flake.
  - Bug filed to c3-terminal: 20261112-1130-load-sensitive-timing-tests.md.
- Live smoke: `node scripts/evidence/smoke.mjs --port 1430 --cdp 9341 --identifier com.txaisxiong.kolux.c1.smoke --offscreen` -> `zero panes after launch: PASS`, `PASS close ... survivors 0`, flows 1-5 FAIL in setup (`could not focus add-project-folder-input`), `smoke: 0/4 flows passed`. Evidence: evidence/smoke-2029d743.txt (not committed). Bug P1 filed to o2-tests. Also P2 to o2-tests: smoke.mjs lacks the New session (Claude/Grok/Terminal) and sidebar-folder-only flows.
- Identifier note: smoke.mjs refuses identifiers not ending in ".smoke"; use com.txaisxiong.kolux.c1.smoke.
- Lane merges: NOT done. o2-tests and o3-rune each have 1 commit, both adding LANE-REPORT.md at root -> add/add collision (AUDIT #0). c2-agents, c3-terminal, o1-tools: 0 commits at time of check.
- Bug routing: i18n-onpackloaded -> c3-terminal. Kept: browser-removal docs/gates (2 bugs, do after o1-tools' removal lands), two-sessions-one-worktree (harness, Txais). Note in _shared/bugs/c1-coord/README-routing-r1.md.
- WAVE-STATUS.md written for Txais.

## Next round
1. If Txais approved the fix for AUDIT #0: apply it, then merge each lane branch one at a time and run the full gate alone on the merged branch.
2. Combine every AUDIT-<lane>.md into docs/research/kolux-audit-2026-11-12.md (summary table, P0/P1 list, refactor plan per area, out of scope). Commit.
3. Own fixes: PLAN.md mojibake (AUDIT #4), claim unowned paths in DECISIONS (AUDIT #1); after the web pane removal merges: DECISIONS row, CHANGELOG line, BROW cards retired, README line, glossary-check / privacy-audit paths.

## For the coordinator
- DECISIONS rows to add when the work lands: web pane retired (Txais 2026-11-12, supersedes OD-18/BROW-*); native terminal path (after c3's recommendation); "Context used" ring removed (c3); ownership of unowned paths (AUDIT #1).
- CHANGELOG lines: none yet (no user-visible change this round).
