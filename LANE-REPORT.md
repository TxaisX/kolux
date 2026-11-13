# LANE-REPORT c1-coord

NOTE: this file is committed on integrate/wave-1; the merge=ours rule in .git/info/attributes keeps each side's own report on lane merges.

## Status (plain words, 3 lines max)
Round 6 re-run: the three approved leftovers are fixed (old web pane screens deleted, stale privacy host line, feature-map marker); full gate green (tsc, pnpm check, vitest 6581/6581, cargo 3187 passed / 0 failed).
Main NOT merged: the clean-room guard hook's old-repo pattern also matches the main checkout folder since the rename, so every command naming it is refused. Not worked around; needs Txais.

## Done this round (round 6 re-run, 2026-11-12 ~16:15; resumed after the 16:29 CPU pause)
Logs: _shared/logs/c1-gate/r6b/ (first pass) and r6c/ (resume rerun) under the lanes folder.
- Lanes: 0 new commits on every lane branch; nothing to merge.
- Leftovers, commit c123141b (Txais approval ~14:58): delete src/browser/ (o1/1415) + notePage stub in src/onboarding/guide.ts; drop example.com from src/privacy/hosts.test.ts (o3/1420); feature-map.md marker 080e4346 -> 6801c25d (o2/1400); files-and-browser.md marker drops src/browser/openIn.ts; glossary "Tab" -> src/terminal/PaneMenu.tsx. Three bugs moved to done/ with fixed-by.
- Gate:
  - `npx tsc --noEmit` -> `tsc=0`.
  - `pnpm check` -> `check=0` (guide-check OK 12 pages, invoke-contract OK, glossary OK).
  - `npx vitest run --no-fsModuleCache` -> `Test Files  889 passed (889)` / `Tests  6581 passed (6581)`.
  - `. scripts/test-env.ps1; cargo test --manifest-path src-tauri/Cargo.toml` -> `cargo exit 0`; 24 test binaries, summed `passed 3187 failed 0 ignored 9` (r6b's cargo run was killed by the pause; r6c reran tsc=0, check=0, vitest 889/889 files 6581/6581 tests, cargo exit 0).
- Smoke not rerun: no Rust or app-start change since round 6's 6/6 (only an unimported folder deleted, plus test and docs lines).
- Main merge: blocked by .claude/hooks/clean-room-guard.mjs (pattern `dev\/kolux(?![\w-])` on lowercased input). Retried once after resume (`git -C <main> status --short` from PowerShell) -> refused by the hook again. Not worked around. History, WAVE-STATUS and handoff c1-coord-r6b.md written.

## Next round (if Txais starts one)
1. If Txais says "narrow the clean-room guard": make the pattern match only the old Electron repo (its `kolux` subfolder, or exact-case match), then do the main merge per SHARED.md (stash the 5 path edits, merge --no-ff, pop). If he merged himself, verify main contains integrate/wave-1.
2. Own P1 bug 1105 (embedded-browser mentions in docs/architecture/*, docs/development/code-map.md, DECISIONS).
3. Route remaining open bugs: P1 2, P2 5, P3 1.

## For the coordinator
- Pending Txais: (1) final main merge, or approve narrowing the guard; (2) kept-warm shell per open folder (~56 MB each) for the 300 ms target.
- c2 decisions still unrecorded (need Txais): Windows PowerShell 5.1 fallback; OpenCode first in New session dropdown.
- Do not put the main checkout's literal path in any Bash/PowerShell command text: the guard blocks it (Write/Edit file contents are not checked).
