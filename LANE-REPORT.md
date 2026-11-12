# LANE-REPORT c2-agents

NOTE: this file is deliberately NOT committed on integrate/wave-1. Committing it would put a
LANE-REPORT.md on the integration branch and every lane's round-start merge would hit an
add/add conflict with its own report. It persists on disk in this worktree. See AUDIT-c1-coord.md #0.

## Status (plain words, 3 lines max)
Four lanes merged clean (c3 had nothing committed). Type check green; live smoke 6/6 (was 4/6); Rust tests fully green for the first time (integration tests need scratch homes).
Still red: pnpm check on one feature-map marker (o2) and vitest exit 1 from one jsdom test that cannot start (c3), though all 6604 tests pass.

## Done this round (round 4, 2026-11-12)
Logs: G:\Dev\kolux-lanes\_shared\logs\c1-gate4\n- Merges, all clean: lane/c2-agents, lane/o1-tools e1cbed90, lane/o2-tests f613f6e3, lane/o3-rune 06ee585d. lane/c3-terminal: 0 new commits.
- Merged gate on 06ee585d:
  - `npx tsc --noEmit` -> `tsc exit 0`.
  - `pnpm check` -> exit 1: `guide-check: docs/guide/feature-map.md changed after its marker commit 080e4346` (P2 o2-tests/20261112-1400). Other steps OK.
  - `npx vitest run --no-fsModuleCache` -> `Test Files  892 passed (892)` / `Tests  6604 passed (6604)` / exit 1: `Cannot find package 'jsdom'` for src/shell/usePackLoaded.test.ts; alone: same (P1 c3-terminal/20261112-1410).
  - `cargo test --manifest-path src-tauri/Cargo.toml` -> lib `test result: ok. 3183 passed; 0 failed; 9 ignored`; cards_10 `34 failed` (no scratch home). Re-run `. .\scripts	est-env.ps1; cargo test ... --test '*'` -> exit 0, 20 binaries, 247 passed, 0 failed (cargo-tests-scratch.txt).
  - Smoke: `node scripts/evidence/smoke.mjs --port 1430 --cdp 9341 --identifier com.txaisxiong.kolux.c1.smoke --temp G:/Temp/kolux-rs-smoke-c1 --offscreen` -> `smoke: 6/6 flows passed` (flow 5 report-only FAIL on savedLayout). evidence/smoke-r4.txt (local).
- DECISIONS DT-C277 (o2 harness conventions). CHANGELOG: 3 lines (Floor/Tower pause while hidden; Settings search no longer reads pages; shortcut list filter).
- Bugs: closed o2-tests/1331 (flow 6 Grok) to done/; opened o2-tests/1400, c3-terminal/1410; routing note _shared/bugs/c1-coord/README-routing-r4.md.
- History round 4, WAVE-STATUS rewritten, handoff _shared/handoff/c1-coord-r4.md.

## Next round
1. Re-merge; confirm o2's marker move and c3's jsdom fix turn check and vitest green. Run cargo under scripts/test-env.ps1 (whole run, not just --test '*').
2. When c3 commits the browser_*.rs deletion: drop privacy-audit browser.rs rows + app070 test, repoint glossary "Tab", keep browser_tower.rs, clear COMPAT.md/docs/architecture; close the two 1105 bugs.
3. Round 6 is the final merge into main (only after a fully green gate, never push). Record Txais's answers if he replies.

## For the coordinator
- Txais decisions pending (WAVE-STATUS): Rune no-go recommended; lane lock in the launcher; external skills text.
- c2 decisions asked, not yet recorded (need Txais): agents start through Windows PowerShell 5.1 when PowerShell 7 is absent; should OpenCode lead the New session dropdown.
- Flow 7 in smoke-r4 said "9 sessions ... clicking the folder shows 8 panes" yet passed: ask o2 whether the flow should require equal counts.
