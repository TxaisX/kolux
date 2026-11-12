# Lane Report — `o2-tests`

- **Status (plain words, 3 lines max)**:
  Round 1 audit complete and parallel live-test runner (`scripts/stress/run-all.mjs`) built with Windows runner guide (`tests/README.md`).
  No live apps were launched yet; dry-run classified all 106 `live-*.mjs` scripts (67 stand-in candidates, 39 skipped by default) across 4 isolated slots.
  Identified two P0 harness blockers (`cdp.mjs` rejecting ports `1500-1590`, `live-common.mjs` using removed chooser/new-tab selectors) to fix first in Round 2.

- **Done this round**:
  - Audited `scripts/prove/`, `scripts/evidence/`, `scripts/stress/`, and `docs/guide/feature-index.md` coverage in `AUDIT-o2-tests.md` (17 findings: 2 P0, 8 P1, 5 P2, 2 P3; 406 feature-index rows mapped, 9 Goal-0 browser scripts + `s11`/`s12` browser phases flagged).
  - Built `scripts/stress/run-all.mjs` (parallel `--instances 1..10` across `o2-tests` slots Vite `1500-1590` / CDP `9350-9359` / `com.txaisxiong.kolux.o2-<n>`, stand-in `.cmd` agents, single-slot warmup via `app-launch.mjs`, writes `artifacts/test-runs/<date-time>/summary.md` + `summary.json`) and unit tests `scripts/stress/run-all.test.mjs`.
  - Wrote `tests/README.md` documenting Windows VM / CI runner requirements for headless execution (not configured).
  - Feature-index & check counts: 406 feature-index rows (18 internal, 5 removed, 9 browser, 374 active user-facing); 106 `live-*.mjs` scripts discovered (67 stand-in queued, 15 real-Claude skipped, 9 browser skipped, 11 helpers skipped, 2 attach skipped, 2 installed skipped); 0 live checks executed this round (audit-only round).
  - Newly filed bugs: 1 (`G:/Dev/kolux-lanes/_shared/bugs/c1-coord/20261112-1105-root-scripts-depend-on-embedded-browser.md` — P2 for `scripts/glossary-check.mjs:29` and `scripts/privacy-audit.test.mjs:26,42,59,123`). Queued bug `G:/Dev/kolux-lanes/_shared/bugs/o2-tests/20261112-1100-smoke-missing-session-sidebar-flows.md` read and scheduled first for Round 2.
  - Proof:
    - `npx tsc --noEmit` -> exit 0 (no output)
    - `npx vitest run scripts/evidence/app-launch.test.mjs scripts/smoke-testids.test.mjs scripts/prove/pane-states.test.mjs scripts/stress/run-all.test.mjs` -> `Test Files  4 passed (4)`, `Tests  81 passed (81)`
    - `node scripts/evidence/smoke.mjs --self-test --temp G:/Temp/o2-smoke-selftest` -> `smoke self-test: 13/13 passed`
    - `node scripts/stress/run-all.mjs --dry-run --instances 4 --out G:/Temp/o2-dryrun-test` -> `run-all: 67 queued, 39 skipped across 4 instance slot(s) (dry-run)`

- **Next round**:
  1. Fix queued bug `20261112-1100-smoke-missing-session-sidebar-flows.md` in `scripts/evidence/smoke.mjs` (add stand-in New-session-all-agents and sidebar-folder-only flows) and update `scripts/smoke-testids.test.mjs`.
  2. Fix the P0/P1 harness blockers (`cdp.mjs` port regex for `1500-1590`, `live-common.mjs` chooser/new-tab selectors and `PROVE_*` env isolation, hardcoded `9290`/`1470` ports, and stale `Source Control` / `.sb-foot` selectors).
  3. Run `node scripts/stress/run-all.mjs --instances 4`, add missing priority + `feature-index.md` checks, and file bug files with screenshots to owning lanes.

- **For the coordinator**:
  - Request: add `artifacts/` to root `.gitignore` (mentioned in `AGENTS.md` as local-only, currently not listed in `.gitignore`), so `artifacts/test-runs/<date-time>/summary.md` written by `scripts/stress/run-all.mjs` never dirties `git status`.
  - Goal 0 note (outside `o2-tests` ownership): `scripts/glossary-check.mjs:29` (`src/browser/BrowserPane.tsx`) and `scripts/privacy-audit.test.mjs:26,42,59,123` (`src-tauri/src/browser.rs`) reference embedded-browser files and will need updating when `src/browser/` and `browser.rs` are removed.
