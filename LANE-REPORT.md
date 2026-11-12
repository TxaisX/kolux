# LANE-REPORT c1-coord

Committed on integrate/wave-1 since round 2: the LANE-REPORT.md merge=ours rule is active
(shared .git/info/attributes + merge.ours.driver true), so every branch keeps its own report.

## Status (plain words, 3 lines max)
All five lanes are merged into integrate/wave-1 (no conflicts). Dependencies updated (Lexical held at 0.52).
New direction recorded (PLAN section 10, DT-C275); round 1 audits combined into one report.
Gate on the merged branch: tsc green; pnpm check 1 failure; vitest 11 failures; cargo 3181/3182 (1 load flake, passed alone). All failures filed as P1s.

## Done this round (round 2, 2026-11-12)
Logs: G:\Dev\kolux-lanes\_shared\logs\c1-gate\r2\
- Dependencies (before merging), one commit each:
  - npm patch/minor 48ef9310: marked 18.2.0, @vitejs/plugin-react 6.3.0, vite 8.3.8, cytoscape 3.35.0. `npx tsc --noEmit` -> `tsc exit 0`; `pnpm check` -> `check exit 0`; `npx vitest run` -> `Tests  6801 passed (6801)`.
  - katex 0.19.0 cafc2ba3: tsc 0, check 0, `npx vitest run src/editor` -> `Tests  1257 passed (1257)`, vite build 0; later full run `Tests  6801 passed (6801)`, `Test Files  917 passed (917)`.
  - Lexical 0.53: NOT taken. Try 1: tsc errors in src/editor. Try 2 after o1's ca2ec548: tsc 0 but `npx vitest run src/editor` -> `Tests  21 failed | 1243 passed (1264)` (Markdown round-trip). Pinned ^0.52.0; bug o1-tools/20261112-1152-lexical-053-markdown-roundtrip.md.
  - cargo update a8f5f58d (wry 0.57.2 and 10 more): `cargo test` -> `test result: FAILED. 3160 passed; 1 failed` (row961 load flake); alone -> `test result: ok. 2 passed; 0 failed`.
- Smoke on the updated build (pre-merge): `node scripts/evidence/smoke.mjs --port 1430 --cdp 9341 --identifier com.txaisxiong.kolux.c1.smoke --offscreen` -> `smoke: 4/4 flows passed (flow 5 report-only ...: FAIL)`. Evidence: evidence/smoke-r2.txt (local).
- PLAN.md section 10 "Native terminals, no web pane (Txais, 2026-11-12)", T-818..T-823; DECISIONS DT-C275 (web pane removed, system browser, native terminal) and DT-C276 (native terminal unproven on screen, xterm keeps painting under it). `node scripts/plan-check.mjs` -> `plan-check: OK`.
- docs/research/kolux-audit-2026-11-12.md (combined audits: 161 findings, 2 P0, 29 P1, 63 P2, 67 P3; c3 has no audit).
- Merges: lane/c2-agents b527ecd5, lane/c3-terminal db0be909, lane/o1-tools dc47caf1, lane/o2-tests 4856f95a, lane/o3-rune db6464e2. All clean.
- Guide fix: docs/guide/files-and-browser.md browser sections replaced with "Web pages" (opens the user's browser); marker moved (two commits). `node scripts/guide-check.mjs` now only reports feature-map.md.
- Merged gate:
  - `npx tsc --noEmit` -> `tsc exit 0`
  - `pnpm check` -> `check exit 1` (guide-check: docs/guide/feature-map.md has no marker; P1 to o2-tests). workflow-check OK, invoke-contract OK, kolux-memory 5/5 run separately.
  - `npx vitest run` (node_modules/.vite deleted first) -> `Test Files  6 failed | 879 passed (885)`, `Tests  11 failed | 6564 passed (6575)`; all 11 reproduce alone. P1s: c3 x3 (main.slowStart+tower/entry after f800b575; browser.grabElement + reach dialog table after o1's removal; wave3 sidebar heading contract), o2 x1 (raw-cache-probe CRLF).
  - `cargo test --manifest-path src-tauri/Cargo.toml` -> `test result: FAILED. 3181 passed; 1 failed; 8 ignored` (row1031 pty service, load); alone `--lib row1031` -> `test result: ok. 3 passed; 0 failed`. Treated as a load flake, not filed.
  - No merge reverted (reason in docs/history/wave-1-progress.md, round 2 Decisions).
- Bugs routed: workspace-row test id -> c2; onboarding New workspace step -> c2; sidebar session click -> c3 (owns src/shell; c3 already shipped onFocusPane, can close). Closed: full-suite vite cache (done/).
- CHANGELOG: 7 user-facing lines from the lanes + one dependency line. docs/history/wave-1-progress.md started (rounds 1 and 2). WAVE-STATUS.md rewritten.

## Next round
1. Re-merge every lane, re-run the full gate; check the 5 gate P1s are closed (feature-map marker, raw-cache CRLF, 3 c3 contract bugs).
2. Web pane leftovers in my queue: 20261112-1218-web-pane-gone-docs-cards-and-ownership.md, 1105 docs/decisions/gates and root scripts (README, BROW cards retired in DECISIONS, glossary/privacy-audit paths, claim unowned paths from AUDIT #1).
3. Retry Lexical 0.53 when o1-tools says src/editor passes on it; record Txais's Rune go/no-go if he answers (o3 recommends no-go).

## For the coordinator
- Rune decision pending Txais (WAVE-STATUS). Do not write a DECISIONS row until he answers.
- Lanes are already rounds ahead of c1 (o2 at round 5): they merge integrate at their round start, so the 11 stale tests reach them now; the P1s explain why.
