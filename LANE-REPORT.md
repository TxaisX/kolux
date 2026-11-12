# LANE-REPORT c1-coord

NOTE: this file is deliberately NOT committed on integrate/wave-1. Committing it would put a
LANE-REPORT.md on the integration branch and every lane's round-start merge would hit an
add/add conflict with its own report. It persists on disk in this worktree. See AUDIT-c1-coord.md #0.

## Status (plain words, 3 lines max)
The web pane's Rust side is merged and the combined app still starts and runs all five agent types (smoke 6/6); Rust tests fully pass.
Still red: pnpm check (feature-map marker, o2; src/browser still calling removed browser_go, o1) and vitest 6602/6604 (same browser_go + stale example.com in o3's hosts test).

## Done this round (round 5, 2026-11-12)
Logs: G:\Dev\kolux-lanes\_shared\logs\c1-gate5- Merges, clean: lane/c3-terminal 4446d52d + 19d996a3 (eee9c39d), then 6fa43c7a + 48b9bb41 (e86e8e28). c2-agents, o1-tools, o2-tests, o3-rune: 0 new commits.
- Gate fixes in unowned gate files: scripts/privacy-audit.test.mjs browser.rs -> net.rs (`npx vitest run scripts/privacy-audit.test.mjs` -> `Tests  5 passed (5)`); docs/guide/safety.md browser-tab section -> project icons, marker moved (guide-check now fails only on feature-map.md); COMPAT.md retirement note.
- Merged gate:
  - `npx tsc --noEmit` -> `tsc exit 0` (eee9c39d and again on e86e8e28).
  - `pnpm check` -> exit 1: `guide-check: docs/guide/feature-map.md changed after its marker commit 080e4346`. Steps after it, run alone: `invoke-contract: FAILED` (`not a registered command: browser_go (src/browser/useBrowserChords.ts:28)`), workflow-check exit 0.
  - `npx vitest run --no-fsModuleCache` -> `Test Files  2 failed | 890 passed (892)` / `Tests  2 failed | 6602 passed (6604)` (invoke-contract.test.mjs, src/privacy/hosts.test.ts; hosts fails alone too). After the second c3 merge: `npx vitest run src/shell src/terminal/layout src/keys src/chrome` -> `Tests  524 passed (524)`.
  - `. .\scripts	est-env.ps1; cargo test --manifest-path src-tauri/Cargo.toml` -> `test result: FAILED. 2939 passed; 1 failed; 9 ignored ... finished in 518.31s`; the failure `status::tests::p81_a_deny_settle...` alone -> `test result: ok. 1 passed`. `cargo test ... --test '*'` -> 20 binaries, 247 passed, 0 failed, `cargo exit 0`.
  - Smoke: `node scripts/evidence/smoke.mjs --port 1430 --cdp 9341 --identifier com.txaisxiong.kolux.c1.smoke --temp G:/Temp/kolux-rs-smoke-c1 --offscreen` -> `smoke: 6/6 flows passed` (flow 5 report-only FAIL savedLayout). evidence/smoke-r5.txt (local).
- Kept c3's merge rather than reverting: the two red tests are stale references to code goal 0 told c3 to delete.
- DECISIONS DT-C278 (privacy pin follows code to net.rs), DT-C279 (Txais 14:10: Rune no-go, lane lock, skill text). CHANGELOG: kolux CLI web commands removed.
- Bugs: opened o1-tools/1415 (delete src/browser/), o3-rune/1420 (example.com line); closed c1-coord/1118 (lane lock, Txais); progress notes on c1-coord/1105 x2.
- History round 5, WAVE-STATUS rewritten (Txais's three answers moved to "Recorded"), handoff _shared/handoff/c1-coord-r5.md.

## Next round (6, final)
1. Re-merge every lane. Wait for every other lane's round-6 handoff (check every 5 min, up to 90 min; c3 runs behind). Full gate.
2. If o1 has not deleted src/browser/ or o3 has not dropped the example.com line, and Txais approved ("coordinator may finish the leftovers"), apply them; then repoint glossary "Tab" (scripts/glossary-check.mjs:29) off src/browser/BrowserPane.tsx. Also clear docs/architecture/{frontend,overview,security}.md + docs/development/code-map.md browser mentions.
3. Only with a fully green gate: `git -C G:\Dev\kolux merge --no-ff integrate/wave-1` (main checkout must have no tracked changes). Never push. Say in WAVE-STATUS which lane was left out, if any.

## For the coordinator
- Pending Txais decision: whether c1 may finish other lanes' leftovers in round 6 so the main merge can happen.
- c2 decisions asked, not yet recorded (need Txais): agents start through Windows PowerShell 5.1 when PowerShell 7 is absent; should OpenCode lead the New session dropdown.
- Cargo lib under load takes ~9 min: run it with a background limit over 10 min.
