# Lane Report — `o2-tests`

- **Status (plain words, 3 lines max)**:
  Round 1 (audit only) is done: the audit now has measured coverage numbers instead of hand-written guesses, and the parallel live-test runner + Windows runner guide exist.
  Measured: 15.8% of the 387 user-facing feature-index rows are mentioned by any test, 90 of 114 feature-card areas have no live check, and the app exposes only 36 `data-testid` hooks for ~45 areas.
  Found a new P1: the sidebar class `pane-row` no longer exists in the app, so five live checks (and the shared `pane-states.mjs` helper) can never pass, while their unit test still goes green.

- **Done this round**:
  - Read `SHARED.md`, `o2-tests.md`, this report and the queued bug; merged `integrate/wave-1` (0 commits ahead — branch already current).
  - Ran three static scans over the merged tree (kept outside the repo at `G:/Temp/o2-scan/`, audit-only round): selector/testid drift, feature-index coverage, and syntax/import integrity.
  - Appended section 3 "Round 1 verification pass" to `AUDIT-o2-tests.md`: 6 new findings (1 P1, 3 P2, 2 P3) plus the measured baseline, and extended the Round 2 plan to 5 items.
  - New P1 finding: `.pane-row` is gone from `src/` (rows are `.sess[role=button]`, `src/projects/ProjectsPanel.tsx:243`) but still queried by `scripts/prove/pane-states.mjs:8` (used by `live-T-544.mjs:14`), `live-ORCH-016.mjs:11`, `live-SET-027.mjs`, `live-T-640.mjs`, `live-T-643.mjs`.
  - New P2 findings: `run-all.mjs:130-134` drift warning is a 4-pattern regex against 105 real dead class tokens; coverage matrix must be generated, not hand-written; the thin testid surface (36 hooks) is the root cause of repeated selector breakage; `live-common.mjs` hardcodes the same `BASE`/`LOGS`/identifier twice (`:24-25` vs `:247-248`, `:74` vs `:296`).
  - Confirmed the queued bug still stands: `scripts/evidence/smoke.mjs` has flows 1–5 only, no New-session-all-agents flow and no sidebar-shows-only-the-folder-row flow.
  - No new bug files filed: every finding is inside `o2-tests`-owned harness code. The one cross-lane need is a testid rule, listed under "For the coordinator".
  - Proof:
    - `node node_modules/typescript/bin/tsc --noEmit` -> exit 0 (no output)
    - `node node_modules/vitest/vitest.mjs run scripts/stress/run-all.test.mjs scripts/evidence/app-launch.test.mjs scripts/prove/pane-states.test.mjs` -> `Test Files  3 passed (3)`, `Tests  53 passed (53)`
    - `node scripts/stress/run-all.mjs --dry-run --instances 4 --out G:/Temp/o2-dryrun-r1` -> `run-all: 67 queued, 39 skipped across 4 instance slot(s) (dry-run)`
    - Scan outputs: 160 harness `.mjs`, 0 syntax errors, 0 real broken imports; 391 harness class tokens, 105 absent from `src/`; 405 feature-index rows (387 external), 61 mentioned in any test (15.8%); 114 card ids / 70 live ids / 24 both; 90 card ids with no live check.

- **Next round**:
  1. Fix the queued bug `20261112-1100-smoke-missing-session-sidebar-flows.md` in `scripts/evidence/smoke.mjs` (stand-in New-session-all-agents flow + sidebar-folder-only-row flow) and update `scripts/smoke-testids.test.mjs`.
  2. Fix the P0/P1 harness blockers together, since they share one seam: `cdp.mjs:22` + `stress/lib.mjs:335` port regex for `1500-1590`, `live-common.mjs` env plumbing (`PROVE_BASE`/`PROVE_LOGS`/`PROVE_IDENTIFIER`, both copies), chooser/new-session selectors, the `.pane-row` cluster, and the hardcoded `9290`/`1470` ports.
  3. Replace the 4-pattern drift warning with a `src/`-derived selector set, generate `tests/coverage.md`, then run `node scripts/stress/run-all.mjs --instances 4` live and file failures with screenshots to owning lanes.

- **For the coordinator**:
  - CHANGELOG (if it ever needs a line): none — this round changed only lane-owned docs.
  - Decision to record: live checks should target `data-testid` hooks, not class names. Proposed rule: the lane that owns a component adds a `data-testid` for every element a guide tells the user to click; `o2-tests` fails checks that click on a bare class selector.
  - Request (still open from the first Round 1 session): add `artifacts/` to root `.gitignore`; `scripts/stress/run-all.mjs` writes `artifacts/test-runs/<date-time>/` and `AGENTS.md` calls that folder local-only.
  - Goal 0 note (outside `o2-tests` ownership): `scripts/glossary-check.mjs:29` and `scripts/privacy-audit.test.mjs:26,42,59,123` reference `src/browser/BrowserPane.tsx` / `src-tauri/src/browser.rs` and will break when those are removed.
  - Environment note for other lanes: in this lane's shell `npx` resolved to `wsl.exe` and failed ("Windows Subsystem for Linux has no installed distributions"); calling binaries as `node node_modules/<pkg>/...` worked. Worth checking before a lane trusts an `npx` result.
