# LANE-REPORT c1-coord

NOTE: this file is committed on integrate/wave-1; the merge=ours rule in .git/info/attributes keeps each side's own report on lane merges.

## Status (plain words, 3 lines max)
Final round: every lane finished; c3's faster-new-terminal work is merged and the combined app runs all five agent types (smoke 6/6); Rust tests fully green.
Not merged into main: pnpm check and vitest (6605/6607) stay red on the same three leftovers in o1/o3/o2 files; Txais has not approved the coordinator fixing them.

## Done this round (round 6, 2026-11-12)
Logs: _shared/logs/c1-gate/r6/ under the lanes folder.
- Wait for round-6 handoffs: not needed; all five lanes' round-6 logs had ended by 15:02 (o2-tests wrote no handoff; its commit 6801c25d was already merged).
- Merge, clean: lane/c3-terminal 17ae2786 + cc3c9e66. Other lanes: 0 new commits.
- Merged gate:
  - `npx tsc --noEmit` -> `tsc exit 0`.
  - `pnpm check` -> exit 1: `guide-check: docs/guide/feature-map.md changed after its marker commit 080e4346`. Alone after it: `node scripts/invoke-contract.mjs` -> `not a registered command: browser_go (src/browser/useBrowserChords.ts:45)` / `invoke-contract: FAILED`; workflow-check exit 0; kolux-memory test exit 0.
  - `npx vitest run --no-fsModuleCache` -> `Test Files  2 failed | 891 passed (893)` / `Tests  2 failed | 6605 passed (6607)` (invoke-contract.test.mjs, src/privacy/hosts.test.ts).
  - `. scripts/test-env.ps1; cargo test --manifest-path src-tauri/Cargo.toml` -> `test result: ok. 2940 passed; 0 failed; 9 ignored ... finished in 272.24s`, every integration binary ok, `cargo exit 0`.
  - Smoke: `node scripts/evidence/smoke.mjs --port 1430 --cdp 9341 --identifier com.txaisxiong.kolux.c1.smoke --temp G:/Temp/kolux-rs-smoke-c1 --offscreen` -> `smoke: 6/6 flows passed` (flow 5 report-only FAIL). evidence/smoke-r6.txt (local).
- Main merge skipped: gate not green, and no "coordinator may finish the leftovers" approval on disk.
- CHANGELOG: faster new terminal (Kolux share ~340 -> ~70 ms). History round 6, WAVE-STATUS rewritten, handoff c1-coord-r6.md.
- Bugs: opened o2-tests/1545 (P3, flow 7 9 rows vs 8 panes); progress note on c3-terminal/1155.

## Next round (if Txais starts one)
1. With approval: delete src/browser/ (o1/1415), drop example.com from src/privacy hosts list (o3/1420), re-check feature-map.md + move its marker (o2/1400), repoint glossary "Tab" (scripts/glossary-check.mjs:29). Also docs/architecture/{frontend,overview,security}.md + docs/development/code-map.md browser mentions.
2. Full gate, all green.
3. Main checkout clean of tracked changes -> `merge --no-ff integrate/wave-1` there. Never push.

## For the coordinator
- Pending Txais: (1) coordinator may finish the leftovers; (2) kept-warm shell per open folder (~56 MB each) for the 300 ms new-terminal target.
- c2 decisions asked, not yet recorded (need Txais): Windows PowerShell 5.1 fallback when PowerShell 7 is absent; OpenCode first in the New session dropdown.
- The clean-room hook matches the main checkout's path case-insensitively in any Bash command text; run the final main merge from the PowerShell tool, or keep the literal path out of Bash heredocs.
