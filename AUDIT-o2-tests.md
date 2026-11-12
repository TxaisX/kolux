# Audit: o2-tests (`scripts/prove/`, `scripts/evidence/`, `scripts/stress/`, `tests/`)

Round 1 audit (2026-11-12). No app code or existing harness scripts were modified in Round 1; built `scripts/stress/run-all.mjs` (+ `run-all.test.mjs`) and `tests/README.md` as specified by the lane brief. A second Round 1 session added the verification pass in section 3 (measured coverage, selector-drift and structural-integrity scans).

---

## 1. Findings (by severity)

### P1 · CONFIRMED · `scripts/prove/live-common.mjs:355-370` & `144-150` — `startPlain()` and `openClaude()` use removed UI selectors
- **What is wrong**:
  1. `startPlain()` (lines 358–366) expects `section.pane.chooser select` when a newly added project opens the Launch Chooser. `src/launch/ChooserPane.tsx` replaced `<select>` dropdowns with tile buttons (`[data-testid="seat-1-agents"] [data-testid="seat-agent-terminal"]` and `[data-testid="chooser-start"]`, as seen in `scripts/evidence/smoke.mjs:242-248` and `src/launch/ChooserPane.tsx:542`). Every `startPlain()` call times out or leaves the chooser unsubmitted.
  2. `openClaude()` (lines 144–150) clicks `button.newtab` and waits for `[role="menu"][aria-label="New tab"]`. Neither exists in `src/` (`src/terminal/TerminalPane.tsx:1887` uses `data-testid="pane-new-session"` and `aria-label="New session"`).
- **The fix**: Update `startPlain()` to use `[data-testid="seat-1-agents"] [data-testid="seat-agent-terminal"]` + `[data-testid="chooser-start"]` (matching `smoke.mjs:242-248`), and update `openClaude()` to use `[data-testid="terminal-pane"].focused [data-testid="pane-new-session"]` and `aria-label="New session"`.
- **Cost**: ~0.5 day (unblocks ~60 `live-*.mjs` scripts).

### P1 · CONFIRMED · `scripts/evidence/cdp.mjs:22` & `scripts/stress/lib.mjs:335` — Hardcoded Vite port regex `/localhost:14\d\d/` breaks o2-tests ports `1500-1590`
- **What is wrong**: `cdp.mjs:22` (`pick("main")`) and `scripts/stress/lib.mjs:335` (`perfSession()`) match only `/localhost:14\d\d|tauri\.localhost/`. Any harness running on `o2-tests` slots (`1500-1590`, CDP `9350-9359`) fails with `no target matching main`.
- **The fix**: Match `process.env.VITE_PORT` / `process.env.PROVE_PORT` when set, or broaden the regex to `/localhost:\d+|tauri\.localhost/`.
- **Cost**: ~1 hour.

### P1 · CONFIRMED · `scripts/prove/live-common.mjs:19-25, 74, 247-248, 296` — Hardcoded shared `BASE`, `LOGS`, and `identifier` break parallel runs
- **What is wrong**: `live-common.mjs` hardcodes `BASE = "G:/Temp/live-v15"`, `LOGS = "G:/Temp/live-v15-logs"`, and `identifier: "com.txaisxiong.kolux.prove"` (with `suffix: ".prove"`), ignoring `PROVE_IDENTIFIER`, `PROVE_BASE`, and `PROVE_LOGS`. Under `run-all.mjs --instances 4`, parallel workers write to the same `LOGS` directory and fail `app-launch.mjs:446` suffix validation if `com.txaisxiong.kolux.o2-<n>` is passed without `.prove`.
- **The fix**: Read `PROVE_BASE`, `PROVE_LOGS`, `PROVE_IDENTIFIER`, and `PROVE_SUFFIX` from `process.env` with safe defaults, and support optional `--attach` reuse so `run-all.mjs` slots do not conflict.
- **Cost**: ~0.5 day.

### P1 · CONFIRMED · 10 `live-*.mjs` scripts and `scripts/stress/s10-git-load.mjs` target the removed Source Control sidebar (`T-644`)
- **What is wrong**: `T-644` removed Source Control from `RightSidebar.tsx:37` (`folderTabs.test.ts:19`), yet these scripts still click `[role="tab"]` with `"Source Control"` or query `.sidebar.scm` / `.scm-row`:
  - `scripts/prove/live-edit-common.mjs:34` (`openScm`), `scripts/prove/live-git-common.mjs:10-45` (`SCM`, `ensurePanel`, `scmReading`)
  - `scripts/prove/live-EDIT-027.mjs:17`, `live-EDIT-029.mjs:17`
  - `scripts/prove/live-GIT-001.mjs:15`, `live-GIT-003.mjs:16`, `live-GIT-004.mjs:14`, `live-GIT-007.mjs` (imports `run001`/`run003`), `live-GIT-037.mjs:13`, `live-GIT-038.mjs:27`
  - `scripts/stress/s10-git-load.mjs:188-192`
- **The fix**: Rewrite the git/diff live proofs around the current All Changes pane (`AllChangesPane.tsx`) and `kolux diff` CLI bridge (`scripts/stress/lib.mjs:23`), or retire tests for the removed sidebar panel.
- **Cost**: ~1.5 days.

### P1 · CONFIRMED · 9 `live-*.mjs` scripts still use removed `button.newtab` or `.sb-foot button[title^="Add a project by path"]`
- **What is wrong**:
  - Removed `button.newtab` / `aria-label="New tab"`: `scripts/prove/live-EDIT-041.mjs:47-49`, `live-TERM-023.mjs:26-28`, `live-TERM-041.mjs:22-27`, `live-VIEW-001.mjs:36-38`, `live-VIEW-017.mjs:17-19`, `live-common.mjs:145-147`.
  - Removed `.sb-foot button[title^="Add a project by path"]`: `scripts/prove/live-audit-1.mjs:72`, `live-T-544.mjs:360-361`, `live-T-640.mjs:37`, `live-T-643.mjs:40`.
  - Removed `section.pane.chooser select`: `scripts/prove/live-flood.mjs:228-230`.
- **The fix**: Centralize `openNewSession(app, agentLabel)` and `addProjectByPath(app, repo)` in `live-common.mjs` using `data-testid` selectors (`sidebar-add-project`, `add-project-by-path`, `add-project-folder-input`, `pane-new-session`, `new-session-menu`, `seat-agent-*`) and import them across all prove scripts.
- **Cost**: ~0.5 day.

### P1 · CONFIRMED · Goal 0 (Embedded Browser Removal): 10 prove scripts, 2 stress scenarios, and 1 IPC guard entry depend on the web pane
- **What is wrong**: Txais directed removing the embedded browser pane (`src/browser/` and its Rust backend). In `o2-tests`-owned files:
  - `scripts/prove/live-BROW.mjs` (entire script tests `section.pane.browser`)
  - `scripts/prove/live-browser-939.mjs`, `live-browser-954.mjs`, `live-browser-977.mjs`, `live-browser-common.mjs` (Note: `live-SET-001.mjs:7`, `live-SET-004.mjs:10`, `live-SET-027.mjs:9` import `targets`/`evidence`/`TODAY` from `live-browser-common.mjs` even though they do not test the browser!)
  - `scripts/prove/live-T-323-proxy.mjs`, `live-T-656.mjs`, `live-T-657.mjs`, `live-T-659.mjs`, `live-T-661.mjs`
  - `scripts/prove/live-checks.mjs:102-138` (`b7` tests `.pane.browser` + `browser_diagnose`)
  - `scripts/stress/s11-footprint.mjs:352-385` (phase `f`: opens 3 `section.pane.browser` tabs via `kolux-open-in-browser`) and `scripts/stress/s12-everyday.mjs:169-222` (3 hidden browser tabs)
  - `scripts/evidence/app-launch.mjs:100` & `app-launch.test.mjs:24` (`browser_download_reveal` in `IPC_BLOCK`)
- **The fix**: Once `o1-tools` removes `src/browser/` and `c3-terminal` removes Rust browser IPC: move shared `targets()`/`evidence()` helpers out of `live-browser-common.mjs` into `live-common.mjs`, delete the embedded-browser `live-*` scripts, remove phase `f` / browser tabs from `s11-footprint.mjs` and `s12-everyday.mjs`, remove `b7` from `live-checks.mjs`, and add a live check for the replacement ("open in system browser" action).
- **Cost**: ~0.5 day (after `o1-tools` / `c3-terminal` land).

### P2 · CONFIRMED · `scripts/evidence/smoke.mjs` misses priority Session & Sidebar checks (queued bug)
- **What is wrong**: Queued bug `G:\Dev\kolux-lanes\_shared\bugs\o2-tests\20261112-1100-smoke-missing-session-sidebar-flows.md` from `c1-coord`: `smoke.mjs` flows 1–5 do not test (a) starting Claude Code, Grok, Codex, OpenCode, and Terminal from New session and accepting input (stand-ins), nor (b) that a multi-session workspace shows only the folder row in the sidebar.
- **The fix**: Add Flows 6 & 7 (or integrate into `smoke.mjs` and `run-all.mjs` preset) in Round 2.
- **Cost**: ~0.5 day.

### P2 · CONFIRMED · 12 prove scripts hardcode ports `9290`/`1470`/`1492`/`1493`/`9291` or override `PROVE_PORT`/`PROVE_CDP`
- **What is wrong**:
  - `live-p0.mjs:13-14` and `live-artifacts.mjs:13-14` unconditionally overwrite `process.env.PROVE_PORT` and `process.env.PROVE_CDP`, colliding if scheduled on different slots or on `1492`/`1493` when `c1`/`o3` or another run is active.
  - `live-audit-1.mjs:24-25`, `live-SET-001.mjs:24`, `live-SET-004.mjs:59`, `live-T-647.mjs:60`, `live-T-655.mjs:65`, `live-claude-common.mjs:50-51,69-70`, `live-browser-common.mjs:54`, `live-BROW.mjs:29` hardcode `9290` or `1470` instead of reading `process.env.PROVE_CDP` / `PROVE_PORT`.
  - `live-flood.mjs:24` sets `process.env.CARGO_TARGET_DIR ||= "G:/Temp/live-verify-t5/target"`, risking cross-checkout target mismatches.
- **The fix**: Change unconditional assignments to `process.env.PROVE_PORT ||= ...` (and let `run-all.mjs` always inject slot ports), read `PROVE_PORT`/`PROVE_CDP` in all direct CDP `fetch()` calls, and drop stale `G:/Temp/live-verify-t5/target` override in `live-flood.mjs`.
- **Cost**: ~0.5 day.

### P2 · CONFIRMED · 9 prove scripts write directly into `ROOT/evidence/` and/or run unconditionally on import
- **What is wrong**: `live-962.mjs`, `live-audit-1.mjs`, `live-SET-027.mjs`, `live-T-544.mjs`, `live-T-647.mjs`, `live-T-655.mjs`, `live-T-656.mjs`, `live-T-657.mjs`, `live-T-659.mjs`, `live-T-661.mjs`, `live-BROW.mjs`, `live-browser-939/954/977.mjs` mutate `evidence/` in the git working tree on every run, and several (`live-p0.mjs`, `live-artifacts.mjs`, `live-T-640.mjs`, `live-T-643.mjs`, `live-flood.mjs`, `live-TERM-004.mjs`, etc.) execute at top-level without an `import.meta.url` main guard.
- **The fix**: Gate `ROOT/evidence/` writes behind `--write-evidence` (defaulting output to `PROVE_LOGS` / `artifacts/test-runs/`), and wrap standalone entrypoints in `isMain` guards.
- **Cost**: ~0.5 day.

### P2 · CONFIRMED · `scripts/prove/live-T-643.mjs:62` & `live-audit-1.mjs:109` use `Process.MainWindowHandle` and move windows onto `(0, 0)`
- **What is wrong**: `app-launch.mjs:47-49` documents that `Process.MainWindowHandle` points to tao's hidden `"Tao Thread Event Target"` window once minimized/hidden, and `SetWindowPos(..., 0, 0, ...)` puts the test window visibly over the user's primary monitor instead of off-screen (`-32000, -32000`).
- **The fix**: Reuse `WIN_PS` (`[V11]::AppWindow($pid)`) from `app-launch.mjs` and keep `x = -32000, y = -32000` (or use CDP `Emulation.setDeviceMetricsOverride` as `live-T-647.mjs` does).
- **Cost**: ~1 hour.

### P2 · PLAUSIBLE · `scripts/prove/live-APP-050.mjs:13` references external prebuilt `G:/Temp/live-v9/oplock-target/release/oplock-hold.exe`
- **What is wrong**: `oplock-hold` crate exists in-repo at `scripts/prove/oplock-hold/`, but `live-APP-050.mjs:13` points at a stale absolute path `G:/Temp/live-v9/oplock-target/release/oplock-hold.exe` outside the repo/slot scratch dir.
- **The fix**: Build or locate `oplock-hold.exe` inside `TEMP` (via `cargo build --manifest-path scripts/prove/oplock-hold/Cargo.toml`) if missing.
- **Cost**: ~1 hour.

### P3 · CONFIRMED · Duplicated helpers across `scripts/prove/` and `scripts/stress/`
- **What is wrong**:
  - `poll()` is defined separately in `live-edit-common.mjs:42` and re-exported/re-implemented vs `waitFor` in `app-launch.mjs:22`.
  - `checker()` is defined in `live-views-dom.mjs:33` while other scripts (`live-TERM-*`, `live-962.mjs`, `live-T-640.mjs`, `live-T-643.mjs`) each write ad-hoc `const check = ...` arrays that bypass `guardRow()` in `app-launch.mjs:178`.
  - `shot()` and `rawKey()` are duplicated across `live-common.mjs:401-434`, `live-claude-common.mjs:49-83`, and `live-browser-common.mjs:54-73`.
  - `dismissFirstRun()` is duplicated in `live-common.mjs:272` and `scripts/stress/lib.mjs:209`.
- **The fix**: Consolidate shared CDP screenshot, `rawKey`, `dismissFirstRun`, and `checker` into `app-launch.mjs` / `live-common.mjs` in Round 2.
- **Cost**: ~0.5 day.

### P3 · CONFIRMED · File size audit (none over 800 lines, 1 close)
- **What is wrong**: No file owned by `o2-tests` exceeds 800 lines (`scripts/evidence/smoke.mjs` is 766 lines; `scripts/prove/update-rig.mjs` is 686 lines; `scripts/prove/live-flood.mjs` is 659 lines). `smoke.mjs` will cross ~800 lines once flows 6–7 (queued bug) are added in Round 2.
- **The fix**: Split `smoke.mjs` flows into `scripts/evidence/smoke-flows.mjs` when adding the new session & sidebar flows in Round 2.
- **Cost**: ~2 hours.

---

## 2. `docs/guide/feature-index.md` Coverage Audit

Total rows in `docs/guide/feature-index.md`: **406**
- `internal`: **18**
- Explicitly marked `Removed` (T-568 kits): **5**
- Embedded-browser rows (slated for Goal 0 removal): **9**
- Active user-facing non-browser features: **374**

### Existing live script & card-test inventory
- `src/**/__cards__/*.test.ts`: **116** unit/component card test files
- `scripts/prove/live-*.mjs`: **106** files (**67** stand-in live checks, **15** real-Claude checks, **9** deprecated browser checks, **11** helpers, **2** installed-only checks, **2** attach subcommands)
- `scripts/stress/s*.mjs`: **14** stress scenarios (S1–S8, S10–S14, plus `run-all.mjs`)
- `scripts/evidence/smoke.mjs`: **5** smoke flows (missing session-launch & sidebar-only-folders flows)

### Coverage gaps by guide area (active user-facing features without dedicated live checks)

| Guide area | Feature rows | Live scripts touching area | Key missing live coverage (priority for Round 2) |
|---|---:|---|---|
| **Getting started** | 43 (5 removed) | `live-T-640`, `live-T-643`, `live-T-647`, `live-audit-1`, `live-team-grid` | **Launch each agent type** (Claude Code, Grok, Codex, OpenCode, Terminal) and verify input; **seat count 1 -> 2+ defaults to Own folder**; Onboarding wizard 4 screens + Skip; Getting Started guide ring & CLI check; contextual tours; File/Edit/View/Window/Help menu bar |
| **Terminals** | 33 | `live-TERM-*` (12), `live-flood`, `s1`, `s2`, `s6`, `s13`, `s14` | **No "Context used" ring in pane header** (once `c3-terminal` removes `ContextGauge`); pane resize / tab switch / flood / sleep-wake drawing integrity assertion; default shell fallback notice (`T-104-c`); multi-line paste confirmation (`T-151-b`); Ctrl+F find & Ctrl+K clear; Shift+Enter / Ctrl+click link |
| **Projects and folders** | 74 | `live-PROJ-*` (7), `live-GIT-*` (7), `live-team-grid` | **6 sessions in one workspace -> sidebar shows ONLY folder row, clicking shows 6-pane grid, restart preserves all 6**; clone repo / init plain folder as Git; project setup scripts & `.bat`/conda clean env (`T-110-a`); GitHub Tasks page / PR preview / Checks panel (`T-127`, `T-229..232`, `T-314-a`); workspace sleep & inline rename (`T-217-a`) |
| **Board, Agents and Inbox** | 83 | `live-VIEW-*` (11), `live-AUTO-011`, `live-ORCH-*` (3), `live-STAT-*` (2), `live-SUBAGENT-418`, `live-USAGE-007` | Tower screen (`T-546`); Floor timeline (`T-260`); Agents chat view & thought folding (`T-027`, `T-325..327`); Automations list filter/run/pause/delete & cron/event triggers (`T-085`, `T-086`, `T-192`); Resource Manager memory & kill (`T-037`, `T-287-b`); Skills freshness & install/update (`T-196`, `T-243`); usage 80%/95% alerts & cache countdown |
| **Settings** | 57 | `live-SET-*` (3), `live-T-323-proxy` | Settings global search (`T-246`); Shortcuts page record/add/disable/clash detection (`T-096`); Appearance light/dark/system, per-screen theme, Warp/Ghostty scheme import (`T-054`, `T-146-c`, `T-148`, `T-323`); Terminal font/cursor/scroll/bell live update (`T-144`); Notifications toggles (`T-133`); Confirmations restore card (`T-247`); Language picker (`T-210-a`); Accounts & Connect cards (`T-092`, `T-138`) |
| **Files and browser** | 26 (6 browser) | `live-EDIT-*` (7), `live-artifacts` | Markdown rich editor vs source view (`T-093-b`); Explorer create/rename/delete/copy/paste/drag (`T-094-b`, `T-094-b2`); All Changes diff view + commit box + compare-with-base (`T-033-c/g`, `T-093-d`) — replacing broken Source Control tests; line review notes & copy-with-line-numbers (`T-034`, `T-132`); open-in-system-browser replacement (Goal 0) |
| **Command line** | 39 | `live-CLI-*` (3), `live-T-659` | `kolux status` busy/stale/timeout (`T-076`); `kolux terminal show/read/send/wait/close` (`T-079-b`, `T-185-b`); `kolux worker-start/show/release/stop` (`T-089-c`, `T-129-c`); `kolux project list`, `kolux account add/list` (`T-141`); `kolux diagnostics memory` (`T-287`); typo suggestions & JSON exit codes (`T-160`, `T-197-a`) |
| **Safety** | 27 (2 browser) | `live-SAFE-*` (5), `live-p0` | UNC share & control-char path refusal (`T-060`, `T-062-a`); Explorer/All Changes path traversal fence (`T-154-b/c`); secret masking in Protected actions (`T-059-b`); diagnostic log scrubbing (`T-064-a`); workspace delete & dirty-tab guard (`T-055`, `T-057`) |
| **Troubleshooting** | 6 | `live-APP-050`, `live-APP-052`, `live-TERM-106-service` | Interrupted skill delete recovery (`T-284`); startup/background error resilience (`T-286`); sleep/wake recovery live assertion (`T-166`) |

---

## 3. Round 1 verification pass (second session, 2026-11-12)

Method: `git merge --no-edit integrate/wave-1` → `git rev-list --count lane/o2-tests..integrate/wave-1` = **0** (branch already current). Three static scans then run over the merged tree: selector/testid drift (`data-testid` + class tokens in `scripts/**` vs `src/**`), feature-index coverage, and syntax/import integrity of every harness `.mjs`. Scans lived outside the repo (`G:/Temp/o2-scan/`) because this round is audit-only.

### Baseline (measured, not eyeballed)
- Harness `.mjs` files: **160**. Syntax errors: **0**. Broken relative imports: **0** (the 6 reported hits are string literals inside test fixtures: `scripts/bundle-budget.test.mjs`, `scripts/stress/run-all.test.mjs:59,63`). So the failures below are semantic (dead selectors), not structural.
- `data-testid` in `src/`: **36 occurrences across 19 files** (~45 feature areas exist). Stable selector surface is thin; most checks lean on classes, roles and text.
- Distinct class tokens referenced by the harness: **391**; **105** of them do not appear anywhere in `src/`.
- `src` test files: **901**; feature-card tests: **116** files / **114** distinct card ids. Live checks: **106** files / **70** distinct ids. Both a card test and a live check: **24**. Card ids with no live check: **90**. Live ids with no card test: **46**.
- `scripts/evidence/smoke.mjs` still has flows 1–5 only (flow 3 already rewritten onto Explorer after T-644) → the queued smoke bug stands.
- False positive to ignore later: `seat-agent-claude` (used by `live-team-grid.mjs`) is real — `src/launch/ChooserPane.tsx:536` builds it as `seat-agent-${a.id}`.

### New findings

### P1 · CONFIRMED · `.pane-row` no longer exists — 5 live checks and a shared helper query a dead class
- **What is wrong**: the sidebar session row is `button.branch, .sess[role=button]` today (`src/projects/ProjectsPanel.tsx:243`); `pane-row` appears nowhere in `src/` (grep over all `.tsx/.css/.html`). Still queried at `scripts/prove/pane-states.mjs:8` (`".sess.pane-row[data-pane]"`), `live-ORCH-016.mjs:11` (`.pane-row[data-agent*=...]`), `live-SET-027.mjs`, `live-T-640.mjs`, `live-T-643.mjs`, `pane-states.test.mjs`. `pane-states.mjs` is imported by `live-T-544.mjs:14`, so its sidebar-row fallback never matches. Those five checks cannot pass; `pane-states.test.mjs` still passes because it only tests the pure part, which makes the dead selector look covered.
- **The fix**: replace `.pane-row[data-pane]` / `.pane-row[data-agent]` with `.sess[role=button][data-pane]` (keep `data-pane` / `data-agent` if `ProjectsPanel` still emits them — verify first), and add a static selector-drift assertion to `pane-states.test.mjs` that fails when a selector it relies on is absent from `src/`.
- **Cost**: ~2 hours.

### P2 · CONFIRMED · `run-all.mjs` under-reports selector drift (4 hardcoded patterns vs 105 dead class tokens)
- **What is wrong**: `scripts/stress/run-all.mjs:130-134` warns only on `PROVE_PORT=/PROVE_CDP=`, `9290|1470`, and `button.newtab|chooser select|Source Control|aria-label="New tab"`. The scans above put the real drift at 105 class tokens, including `.pane-row` (5 checks), `.cm-merge-b` (`live-EDIT-027.mjs`, diff view), `.sb-foot` is fine (still in `src/styles.css`). A check whose selectors are dead is reported as "no warnings", so the runner's summary overstates health.
- **The fix**: derive the pattern list from `src/` at run time — extract `data-testid` literals and `className` tokens from `src/`, then flag any selector token in a prove script that is not in that set; keep a small allowlist for CDP method names and file extensions.
- **Cost**: ~3 hours.

### P2 · CONFIRMED · Coverage is 15.8% of the feature index by id, and the card/live sets barely overlap
- **What is wrong**: of **387** user-facing rows in `docs/guide/feature-index.md`, only **61** task ids appear in any test or live check at all. Of **114** card areas, **90** have no live check; **46** live checks cover ids with no card test; only **24** ids have both. The previous section's gap table was written by hand and overstates coverage ("live-PROJ-* (7)" reads as area coverage for 74 rows).
- **The fix**: make the coverage matrix a generated artefact (one scan, committed as `tests/coverage.md`, regenerated by the runner) so "checked / passing / failing" counts in `LANE-REPORT.md` are numbers, not prose. Then work the 90 card ids without live checks in priority order (TERM-*, SESS-*, SET-*, VIEW-*, AUTO-*, ACCT-*).
- **Cost**: ~0.5 day for the generator; the checks themselves are Round 2+ work.

### P2 · CONFIRMED · Testability surface is the root cause of the whole stale-selector cluster
- **What is wrong**: 36 `data-testid` occurrences for ~45 feature areas means new UI has no stable hook, so every harness author reaches for a class name and the class gets renamed (`newtab` → `pane-new-session`, `pane-row` → `.sess`). This has now cost at least three separate fix rounds in this lane.
- **The fix (cross-lane)**: ask `c1-coord` to adopt a rule — every interactive element the guides describe gets a `data-testid`, added by the lane that owns the component, and `run-all.mjs` fails a check that depends on a non-testid selector for a clickable element. Harness side alone cannot fix this.
- **Cost**: ~1 day spread across lanes; zero for `o2-tests` beyond the checker.

### P3 · CONFIRMED · `live-common.mjs` hardcodes the same paths twice inside one file
- **What is wrong**: `BASE`/`LOGS` at `scripts/prove/live-common.mjs:24-25` and `LIVE_BASE`/`LIVE_LOGS` at `:247-248` are the same two literals under two names (`G:/Temp/live-v15`, `G:/Temp/live-v15-logs`), and both `createApp` calls (`:74`, `:296`) hardcode `identifier: "com.txaisxiong.kolux.prove"` with `suffix: ".prove"`. Fixing the env plumbing in Round 2 has to touch both copies or the halves diverge.
- **The fix**: one `env()` accessor (`PROVE_BASE`, `PROVE_LOGS`, `PROVE_IDENTIFIER`, `PROVE_SUFFIX` with defaults) referenced by both entry points, and delete `LIVE_*`.
- **Cost**: ~1 hour, inside the already-planned P1 fix.

### P3 · CONFIRMED · Proof for Round 1 (commands and last lines)
- `node node_modules/typescript/bin/tsc --noEmit` → exit 0, no output. (`npx` is broken in this shell — it resolves to `wsl.exe` — so binaries are called through `node` directly.)
- `node node_modules/vitest/vitest.mjs run scripts/stress/run-all.test.mjs scripts/evidence/app-launch.test.mjs scripts/prove/pane-states.test.mjs` → `Test Files  3 passed (3)` / `Tests  53 passed (53)`.
- `node scripts/stress/run-all.mjs --dry-run --instances 4 --out G:/Temp/o2-dryrun-r1` → `run-all: 67 queued, 39 skipped across 4 instance slot(s) (dry-run)`; summary showed slots Vite `1500-1530`, CDP `9350-9353`, identifiers `com.txaisxiong.kolux.o2-0..3`.

---

## 4. Round 2 Action Plan

1. **Fix `scripts/evidence/smoke.mjs`** (queued bug `20261112-1100`): add flows for launching all 5 session types (Claude Code, Grok, Codex, OpenCode, Terminal) with stand-ins + verifying sidebar shows only the folder row for a multi-session grid.
2. **Unblock `run-all.mjs` across all 67 stand-in checks**:
   - Fix `cdp.mjs:22` and `stress/lib.mjs:335` port matching (`1500-1590`).
   - Fix `live-common.mjs` (`startPlain` chooser tiles, `openClaude` `pane-new-session`, `PROVE_BASE`/`PROVE_LOGS`/`PROVE_IDENTIFIER` env support, `addProjectByPath` helper).
   - Fix `live-*.mjs` stale selectors (`button.newtab`, `.sb-foot`, `Source Control`) and hardcoded `9290`/`1470` ports and `ROOT/evidence/` writes.
3. **Run `node scripts/stress/run-all.mjs --instances 4` live**, add missing live checks for `o2-tests.md` priority items (6-session workspace grid + restart, 5 agent types, terminal resize/tab-switch/flood drawing, no `ContextGauge` in header) and top coverage gaps (Settings search/Shortcuts, Explorer CRUD, All Changes commit, Tower/Floor/Agents/Automations/Skills, CLI commands), and file bugs with screenshots to owning lanes.
4. **Fix the `.pane-row` dead selector** (section 3, P1) in `pane-states.mjs`, `live-ORCH-016`, `live-SET-027`, `live-T-640`, `live-T-643`, and make `pane-states.test.mjs` assert its selectors exist in `src/`.
5. **Replace the 4-pattern drift heuristic** in `run-all.mjs:130-134` with a `src/`-derived selector set, and generate `tests/coverage.md` from the feature-index scan so round reports quote counts instead of prose.

---

## 5. Round 2 (2026-11-12): what was fixed, what is left

Ledger for section 1–4. Every line was re-checked on the round-2 branch; "fixed" means the code changed and a test or a
fresh command covers it.

| Finding | Status | Where it landed |
|---|---|---|
| P1 `startPlain()` chooser `select`, `openClaude()` `button.newtab` | **fixed** | `live-common.mjs`: `TID` test-id map, chooser seat buttons + `chooser-start`, `pane-new-session` + `new-session-menu`. Added `addProjectByPath()` / `openNewSession()` helpers. |
| P1 `cdp.mjs` + `stress/lib.mjs` port regex | **fixed** | `cdp.mjs` matches `CDP_MAIN_PORT`/`PROVE_PORT`/`VITE_PORT` then any localhost port; `perfSession()` matches `localhost:\d+` |
| P1 `live-common` hardcoded `BASE`/`LOGS`/identifier | **fixed** | one `env()` reads `PROVE_PORT/CDP/BASE/LOGS/IDENTIFIER/SUFFIX`; `LIVE_BASE`/`LIVE_LOGS` now alias it; both `createApp` calls use `ENV.*`; `run-all.mjs` sets `PROVE_SUFFIX` |
| P1 Source Control live proofs (10 scripts) | **fixed (round 5)** | Six of them — `live-GIT-001`, `-003`, `-004`, `-007`, `-037`, `-040` — now carry a `// retired: <reason>` header naming T-644 and where the flow went, which `classifyProveScript` counts as retired so `run-all` stops red-rowing a screen that was removed on purpose. The coverage did not disappear with them: `live-GIT-038` (10 changed files → All Changes sections, scroll position kept) and `live-EDIT-029` (30 files, sections drawn while scrolling) drive the replacement. `--dry-run` counts them as `retired`, not `open`. |
| P1 removed `button.newtab` / add-project selectors | **fixed** (newtab, chooser) | `live-EDIT-041`, `live-TERM-023`, `live-TERM-041`, `live-VIEW-001`, `live-VIEW-017`, `live-flood`; `.sb-foot` and `live-audit-1`/`live-T-544`/`live-T-640`/`live-T-643` add-project paths **open** |
| P1 Goal 0 browser proofs and stress phases | **fixed** | nine proofs + `live-browser-common.mjs` deleted, helpers moved to `live-common.mjs`, `live-checks` b7 removed, s11 phase f and s12's three tabs removed, `run-all` category `retired-browser` |
| P1 `.pane-row` dead class (section 3) | **fixed** | `pane-states.mjs` fallback removed, `live-ORCH-016`, `live-SET-027`, `live-T-640`, `live-T-643` updated, `pane-states.test.mjs` asserts the reader's selectors exist in `src/` and that `pane-row` stays gone |
| P2 `smoke.mjs` missing Session/Sidebar flows (queued bug) | **fixed** | flows 6 and 7, stand-ins in `smoke-standins.mjs` (+6 tests), order `1,2,3,4,6,7,5` |
| P2 hardcoded `9290`/`1470`, `PROVE_PORT=` overrides | **fixed** | `live-SET-004`, `live-T-647`, `live-T-655`, `live-audit-1` read the env; `live-p0` and `live-artifacts` use `||=` |
| P2 prove scripts writing `ROOT/evidence/` on import | **partial** | `evidence()` now honours `PROVE_EVIDENCE` and `PROVE_NO_EVIDENCE=1`; the main-guard wrapping of 7 entry points is **open** |
| P2 `Process.MainWindowHandle` / window at `(0,0)` | **open** | `live-T-643:62`, `live-audit-1:109` untouched |
| P2 `live-APP-050` external `oplock-hold.exe` | **open** | untouched |
| P2 `run-all` 4-pattern drift warning | **fixed** | `srcSelectorTokens()` reads `src/` once, `selectorDrift()`/`warningsFor()` flag selectors no `src/` file mentions; warnings went from 0 to 8 real ones (7 Source Control, 1 filename noise), and `.pane-row` is caught |
| P2 coverage matrix hand-written | **fixed** | `scripts/stress/coverage.mjs` generates `tests/coverage.md`: 237 user-facing guide tasks, 91 named by a test (38.4%); 113 card areas, 31 with a live check |
| P2 thin `data-testid` surface | **open (cross-lane)** | filed to `c1-coord`: the sidebar workspace row needs `data-testid`; the rule is in the new bug file |
| P3 duplicated helpers (`shot`, `rawKey`, `dismissFirstRun`, `checker`) | **partial** | `targets`/`TODAY`/`evidence` consolidated into `live-common.mjs` (the `live-browser-common` split they lived in is gone); `shot`/`rawKey` still duplicated |
| P3 `smoke.mjs` over 800 lines | **partial** | stand-ins + their tests extracted (`smoke-standins.mjs`); 809 lines now, the `--self-test` block is the next seam |
| P2 stale Vite `?raw` cache (queued bug, o3-rune) | **open** | documented in `scripts/evidence/README.md`; the `?raw` swap and the CI cache clear are others' files |
| P1 smoke setup "could not focus add-project-folder-input" (queued bug, c1-coord) | **fixed by inspection** | `focusField()` retries 5 s on the first on-screen match; suffix rule documented in `scripts/evidence/README.md`; needs a live confirm on the merged branch |

## 6. Round 4 (2026-11-12): the app finally ran — what that proved, and what it broke

The worktree got a Rust build (`cargo build --bins`, 4 m 17 s, 6.2 GB target) and the harness ran for real for the
first time. Two things came out of it: a P0 in this lane's own harness that no amount of reading had found, and the
three goal-0 latency numbers.

| Finding | Severity | Status | Detail |
|---|---|---|---|
| `TID` used 13x in `scripts/prove/live-common.mjs`, declared nowhere | **P0** | **fixed** | `startPlain()` threw `ReferenceError: TID is not defined` on its first line, so **every live proof in the wave would have failed at start-up** the moment anyone launched the app. The round-2 table above claimed this map was added; it was not in the file. Now a real `export const TID` map with the `src/` line each id comes from, plus `scripts/harness-imports.test.mjs` (4 tests) which fails on a name used as a namespace but never declared or imported. Proof the rule catches it: the same rule run over `git show d35a70d0:scripts/prove/live-common.mjs` reports `UNDECLARED TID`, and over the fixed file it is clean. |
| 41 proofs run their body at module level (7 were named in round 1) | P2 | **closed as a rule** | Only an *imported* proof can hurt: importing one for a helper launches an app. `live-SESS-004`, `live-SESS-018`, `live-GIT-001`, `live-GIT-004` are the imported ones and all four have the `pathToFileURL(process.argv[1])` guard. The new test makes that a rule: an imported proof that calls `startPlain`/`startProve` must carry the guard. |
| `Process.MainWindowHandle` in `scripts/evidence/shot.ps1:20`, `type.ps1:62` | P2 | **fixed** | Both now enumerate windows for the pid and take class `Tauri Window` + title `Kolux`, with `MainWindowHandle` kept only as a fallback. Discovery also had to change: the harness parks the window at `-32000,-32000`, so `MainWindowTitle` is empty and the old `Where MainWindowTitle -like "Kolux*"` found nothing — the process is now found by name too. **Proven live:** `shot.ps1 -Out G:/Temp/o2-shot-test.png -ProcessId 28380` → `saved … (1416 x 889) pid 28380`, and without `-ProcessId` → `saved … (1936 x 1048) pid 28380`. `type.ps1` shares the code and parses, but was not exercised: it posts input into whatever app is in front, and this lane will not do that to a run in progress. |
| No latency check existed (Goal 0, item 7) | P1 (goal 0) | **built** | `scripts/prove/live-latency.mjs`, run through `run-all --only latency`. In-page `performance.now()` from the real DOM event to the thing the user sees, so the CDP transport is outside both ends. Round-4 numbers (this PC, five other lanes running, four runs): keystroke → character **3.2-4.8 ms** median, max 8.3 warm (target 16, PASS); click → visible response **6.6-10.1 ms** median (target 50, PASS); new session → ready prompt **612-1645 ms** (target 300, **FAIL**), split into Kolux's own part (pane drawn) 156-375 ms and the shell's own start 647-1270 ms. Filed to `c2-agents`: `_shared/bugs/c2-agents/20261112-1155-new-session-latency-1050ms.md`. |
| `run-all` leaves the app running when a check's start-up times out | P2 | **fixed (round 5)** | Root cause was in `app-launch.closeApp()`: it threw when the app did not exit within 30 s of the close request, so the teardown after it (dev tree, vite, temp-folder processes) never ran, and every caller wraps the call in `.catch(() => {})`. It now ends this run's own app tree (`taskkill /PID app.pid /T /F`) in that case. `run-all` additionally sweeps after every check (`endSlotOrphans`): the slot's app is found by this slot's `--remote-debugging-port` in its WebView2 command line and the nearest `kolux.exe` ancestor, plus a `node.exe` still listening on the slot's Vite port — never by name, so an app the run did not start cannot match. Pure parts unit-tested (fixture table with another slot's app, an installed app, a browser on the same port, a webview with a dead parent). Proven live: a real app left running on CDP 9350 → unused-slot sweep `[]` and app still alive → slot sweep `[40544]` → `gone`. |
| Stale Vite `?raw` cache (queued bug 20261112-1118) | P2 | **workaround + detector** | `npx vitest run --no-fsModuleCache` is the one-flag workaround (vitest 5.1.0); `scripts/raw-cache-probe.test.mjs` is the detector (a `?raw` import must equal `readFileSync` of the same file). **Could not reproduce** the reported failure with a warm single-file cache, so this is insurance, not a confirmed fix; the `?raw` → `node:fs` swaps stay with the owning lanes. |

Still open in this lane, in the order worth doing:

1. **P2** `live-APP-050` still needs `G:/Temp/live-v9/oplock-target/release/oplock-hold.exe`, a prebuilt binary outside the
   repo, while `scripts/prove/oplock-hold/` holds its source. Build it in-repo (release) and point `HOLDER` at
   `scripts/prove/oplock-hold/target/release/oplock-hold.exe`; ~10 min plus one build.
2. **P3** `shot`/`rawKey` duplicated across proofs — `ctx.shot()`/`ctx.rawKey()` exist in `live-common.mjs`; each script
   that rolls its own should import them. Mechanical, ~20 scripts.
3. **P3** `smoke.mjs` 809 lines: the `--self-test` block is the next clean seam.
4. **Cross-lane** thin `data-testid` surface: the sidebar workspace row still has no test id, so proofs match `.sb-main`.
