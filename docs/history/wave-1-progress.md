# Wave 1 progress

The permanent record of the Kolux wave (six lanes in parallel worktrees, merged by c1-coord into
`integrate/wave-1`). One dated section per coordinator round. Never rewrite an earlier section.

## Round 1 (2026-11-12, audit)

- Every lane audited its area (AUDIT-<lane>.md); c3-terminal's round 1 ended before it wrote one.
- c1-coord: AUDIT-c1-coord.md (12 findings). Baseline gate on main 2029d743: tsc 0, pnpm check 0,
  vitest 6800/6801 and cargo 3160/3161 (one load flake each, passed alone). Smoke 0/4 (the harness
  could not focus the add-project input; filed to o2-tests).
- Merging paused: every lane commits LANE-REPORT.md at the root, so the second merge collides.

## Round 2 (2026-11-12, coordinator)

### Decisions
- Txais approved the LANE-REPORT.md merge rule (~12:20): `merge.ours.driver true` and
  `LANE-REPORT.md merge=ours` in the shared `.git/info/attributes`. Each branch keeps its own report.
- DT-C275: remove the embedded browser, agents use the system browser, native terminal is the
  focus. PLAN.md section 10 "Native terminals, no web pane", tasks T-818 to T-823.
- Gate red after the merge (below), but no lane merge was reverted. The failures are stale test
  contracts left behind by the planned web pane removal, the sidebar rewrite and the language-pack
  preload, not broken features. Reverting the merges would undo goal-0 work and make the next
  re-merge harder (git skips reverted commits). Each cause is filed as a P1 to its owner.

### Dependency changes (before merging lanes)
| Group | Change | Result |
|---|---|---|
| npm patch/minor | marked 18.1.3 -> 18.2.0, @vitejs/plugin-react 6.2.1 -> 6.3.0, vite 8.3.6 -> 8.3.8 (rolldown 1.2.16 -> 1.2.19), cytoscape 3.34.4 -> 3.35.0 | kept: tsc 0, check 0, vitest 6801/6801 |
| katex | 0.18.11 -> 0.19.0 (0.18.11 deprecated upstream) | kept: tsc 0, check 0, src/editor 1257/1257, vite build 0, then full vitest 6801/6801 |
| lexical + @lexical/* | 0.52 -> 0.53 | held at ^0.52.0: first try broke tsc in src/editor; after o1-tools fixed the types, 21 editor tests still fail (Markdown round-trip). Bug with o1-tools |
| cargo update | wry 0.57.1 -> 0.57.2 (adds dom_query, html5ever 0.40, selectors 0.41, phf 0.14 and friends), tauri-plugin-notification 2.8.0 -> 2.8.1, zip 9.5.0 -> 9.5.1, rustls-pki-types 1.15.1 -> 1.16.0, jiff 0.2.41 -> 0.2.43, jiff-core 0.1.4 -> 0.1.5, sqlite-wasm-rs 0.6.2 -> 0.6.3, crc32fast 1.5.4 -> 1.5.5, errno 0.3.14 -> 0.3.15, const-oid 0.10.2 -> 0.10.3 | kept: cargo test 3160/3161, the one failure (row961, known load flake) passed alone |

Smoke on the updated (pre-merge) build: 4/4 flows passed; flow 5 (report-only) fails on a
savedLayout difference in settings.json after relaunch.

### Merges
All five lane branches merged into integrate/wave-1 with no conflict, in order c2-agents, c3-terminal,
o1-tools, o2-tests, o3-rune.

### What each lane shipped (as merged)
- c2-agents: agents start through the user's shell (agent_shell module), start failures logged to
  kolux.log; sidebar shows workspace folders and their sessions, never worktrees; seat chooser
  switches to own folders when going from 1 to 2 seats; embedded browser removed from onboarding and
  launch copy; three scm commands moved off the async workers.
- c3-terminal: native terminal step 1, panes drawn by the Windows Terminal engine behind the
  terminalNative setting (off by default; engine window placement, steps aside under menus and
  dialogs); "Context used" ring removed; language packs load before the first frame; sidebar session
  rows focus their pane (onFocusPane); terminal link wiring moved out of TerminalPane; a
  cargo [profile.local] for fast release-like builds.
- o1-tools: the web pane is removed (68 files, about 13k lines, 8 feature cards); web addresses open
  in the system browser through one openExternal helper; a few shims remain until c3 repoints their
  imports; `pnpm local` to try a change in minutes beside the installed app; editor typed for
  Lexical 0.53.
- o2-tests: smoke harness fixed (add-project focus), new flows for every agent type and the one-row
  sidebar; embedded-browser proofs retired; feature map started (37 controls, 3 latency targets);
  latency measured in the running app; window finder by pid/class/title.
- o3-rune: audit findings closed (Claude resetsAt ms vs seconds, i18n, privacy, pricing); shared
  usage formatters; Rune spike: 8 live panes, about 81% less working set and 3.3x better
  keystroke p95 than the current panes, but the lane recommends no-go for this wave.

### Gate on the merged branch
- `npx tsc --noEmit`: exit 0.
- `pnpm check`: exit 1. guide-check: docs/guide/feature-map.md has no verified marker (P1 to
  o2-tests). The browser guide page listed deleted files; c1-coord rewrote its browser sections and
  moved its marker. Every other check (license, plan, glossary, workflow, invoke contract, memory
  tool) passes.
- `npx vitest run` (after deleting node_modules/.vite): 11 failed | 6564 passed (6575), 6 files,
  all reproduce alone. Filed P1s: main.slowStart and tower/entry after the pack preload (c3),
  browser.grabElement action and the dialog table after the web pane removal (c3), wave3 sidebar
  heading contract (c3), raw-cache-probe CRLF fixture (o2).
- `cargo test`: 3181 passed, 1 failed, 8 ignored. The failure (row1031, pty service ends a refused
  service by pid) passed alone (3 passed); a load flake like row961, not filed.

### Bugs
- Routed: sidebar workspace row test id -> c2-agents; onboarding "New workspace" step -> c2-agents
  (owns src/onboarding); sidebar session click wiring -> c3-terminal (owns src/shell).
- Closed: full-suite Vite cache (c1 deletes node_modules/.vite before every merged full run).
- Opened by c1-coord: 4 P1 to c3-terminal and o2-tests (gate), 1 P1 feature-map marker to o2-tests,
  1 P3 Lexical 0.53 to o1-tools.

### Docs
- docs/research/kolux-audit-2026-11-12.md: the round 1 audits combined (161 findings: 2 P0, 29 P1,
  63 P2, 67 P3; the terminal area has no audit).
- CHANGELOG: seven user-facing lines from the lanes plus one "Under the hood" line for the
  dependency updates.
- Handoff note written for the lanes (gate owners, Lexical hold, delete node_modules/.vite first).

## Round 3 (2026-11-12, coordinator)

### Merges
All five lane branches merged into integrate/wave-1 with no conflict, in order c2-agents (8d97512f),
c3-terminal (b4b3de62), o1-tools (67cc47b7), o2-tests (3968453f), o3-rune (93e9e24f).

### What each lane shipped (as merged)
- c2-agents: agents start inside the user's own shell (Terminals::spawn wraps them, 2cb2e273); one
  agent start reads the search path once (67 ms -> 18 ms, e3fd1fb4); projects.rs tests moved to
  projects_tests.rs (6921 -> 3323 lines); sidebar workspace row test id; onboarding step and language
  redraw fixes.
- c3-terminal: the web pane's last frontend wiring removed (browser scope, actions, chords, CSS;
  f642b4c2); pane link wiring moved to paneLinks.ts; native terminal steps aside for menus and
  dialogs, xterm keeps painting until the engine's own drawing is proven; three stale contract tests
  from round 2 fixed.
- o1-tools: Lexical 0.53 escape fix (mdExport.ts), Settings > Terminal native engine switch,
  `pnpm local`, audit fixes N-04/N-06/N-07/N-16/N-17 (preview, explorer, right-click copy, checks,
  ports).
- o2-tests: live controls proof (four controls), cleanup of a failed check's app and vite.
- o3-rune: spike prefs file (layout, theme, palette, shell, keys) with live reload; the idle memory
  growth is headless-only. Still recommends no-go for this wave.

### Dependency changes
| Group | Change | Result |
|---|---|---|
| lexical + @lexical/* | 0.52.0 -> 0.53.0 (99b4d2ac) | kept: tsc only fails on an unrelated merge error (below); `npx vitest run src/editor` 1264/1264 |

### Decisions
- The seven web-pane P0 cards (BROW-001, 002, 003, 005, 008, 009, 051) moved to tier H, "retired
  2026-11-12". plan-check now lets a card whose State says retired keep its finished plan tasks as
  history (a skipped H card still may not be planned); P0 total 228 -> 221 (7016988c).
- src/open/ granted to o1-tools (shared "open in the system browser" wrapper), recorded in its brief.
- No merge reverted: the red items below are one-line follow-ups in o1-tools' own files, and
  reverting c3's merge would undo the web pane removal.

### Gate on the merged branch (logs: _shared/logs/c1-gate/r3/)
- `npx tsc --noEmit`: 1 error, src/settings/shortcutRows.ts(9): `browser` is no longer a shortcut
  scope (c3 removed it; o1's area list still names it). P1 to o1-tools.
- `pnpm check`: stops at that tsc error. Steps run one by one: license, plan, glossary, workflow,
  invoke-contract OK; guide-check: feature-map.md marker missing (o2's fix is written but not yet
  committed); kolux-memory pass.
- `npx vitest run --no-fsModuleCache`: 886 files, 7 failed / 6570 passed. Alone: shortcutRows x3
  (same cause, o1), nowin-spawns (scripts/local-run.mjs spawns without windowsHide, o1),
  raw-cache-probe CRLF (o2, fix written not committed); plan-check x2 were my own mid-run edit and
  pass now (11/11).
- `cargo test`: 3182 passed, 1 failed (row965 hung-probe, load); alone 3 passed. Load flake, not filed.
- Smoke (own temp folder): 4/6 flows. Flow 6 (Grok pane did not appear in 30 s) filed to o2 to
  re-run with its pending first-run-dialog fix; flow 7 asserts the retired "folder row only" rule,
  o2's pending change moves it to folder + session rows. The default smoke temp folder is shared by
  every lane and its cleanup ended processes it did not start: P2 to o2.

### Bugs
Opened: o1-tools x2 (shortcutRows browser scope + its tests; local-run windowsHide), o2-tests x2
(smoke shared temp folder; flow 6 Grok). Closed: lexical 0.53 bump, web-pane cards and ownership.
Open after this round: P0 1, P1 7, P2 4.

## Round 4 (2026-11-12, coordinator)

Other lanes have run ahead to their round 6; this is the coordinator's fourth rotation.

### Merges (all clean)
lane/c2-agents (11 commits), lane/o1-tools (23), lane/o2-tests (1), lane/o3-rune (3) into
integrate/wave-1, ending at 06ee585d. lane/c3-terminal had no new commits (its worktree holds the
Rust browser_*.rs deletions staged but uncommitted).

### What each lane shipped
- c2-agents: Floor page and Tower window pause while hidden and catch up when shown; ProjectsPanel's
  PR poll moved to src/projects/usePrPoll.ts (same calls); scm tests split into scm_tests.rs.
- o1-tools: Settings search no longer runs each page's mount-time reads (new `SearchRun` context +
  `useSearching()` in src/settings/search.ts); NumberField / NumberDraftField replace duplicate
  number boxes; six dead exports and pickers.ts removed; shortcutRows `browser` scope gone (tsc green).
- o2-tests: smoke flows 6 and 7 pass live (new pane found by newest data-key; first-run dialog closed
  via corner close -> Skip); CDP right-click helper; live-APP-050 builds its own oplock holder.
- o3-rune: 10,000-row scrollback probe (~59 fps, ~0.11 ms CPU a frame, 121 MB); GPU measured per
  engine (3D under 1 %). Final recommendation: Rune no-go for this wave.
- c3-terminal: nothing committed since round 3.

### Gate on 06ee585d (logs: _shared/logs/c1-gate/r4/)
- `npx tsc --noEmit` -> exit 0.
- `pnpm check` -> exit 1 at guide-check only: feature-map.md edited after its marker 080e4346
  (P2 to o2-tests). license, plan, glossary, workflow, invoke-contract pass.
- `npx vitest run --no-fsModuleCache` -> `Test Files 892 passed (892)`, `Tests 6604 passed (6604)`,
  exit 1 on one unhandled error: src/shell/usePackLoaded.test.ts needs jsdom, which is not installed
  (P1 to c3-terminal; fails alone too).
- `cargo test` -> lib `3183 passed; 0 failed; 9 ignored`; cards_10 34 failed on the real-home guard
  because the run lacked scratch homes. Re-run under `. scripts/test-env.ps1` with `--test '*'`:
  20 binaries, 247 passed, 0 failed. Round 3's cargo run stopped at the lib binary and never reached
  the integration tests, so this is the first full Rust pass of the wave. Use test-env from now on.
- Smoke (`--port 1430 --cdp 9341 --temp G:/Temp/kolux-rs-smoke-c1 --offscreen`):
  `smoke: 6/6 flows passed` (flow 5 report-only, still FAIL on savedLayout bytes until T-184).

### Decisions
DT-C277: harness conventions from o2-tests (cleanup by debug port, retire a proof by header, find a
new pane by data-key, first-run dialog closed via Skip).

### Bugs
Opened: o2-tests/1400 (feature-map marker), c3-terminal/1410 (usePackLoaded jsdom).
Closed: o2-tests/1331 (smoke flow 6 Grok). Open after this round: P0 1, P1 5, P2 6.

## Round 5 (2026-11-12, coordinator)

### Merges into integrate/wave-1
- lane/c3-terminal (clean, twice): 4446d52d removes the web pane's Rust side (23 browser_*.rs modules,
  the `kolux browser` CLI verbs; icon/update HTTP client and URL policy kept in net.rs, WebView2 args in
  webview_args.rs, crash watch + PDF print in webview_engine.rs; renamed browser_tower->tower_window,
  browser_pdf->pdf_export, browser_preview->html_preview, browser_crash->engine_crash, command names
  unchanged). Then 6fa43c7a (pane Agent type gains grok and opencode; usePackLoaded test on fakeDom,
  closes bug 1410) and 48b9bb41 (zoom shortcut titles drop "Browser").
- c2-agents, o1-tools, o2-tests, o3-rune: no new commits since round 4 (c2, o1 and o3 wrote round-6
  handoffs: Settings `useSearching()` guard, `usePrPoll`, Rune final no-go numbers).

### Coordinator fixes (gate files nobody else owns)
- scripts/privacy-audit.test.mjs: the icon-client allow + pin moved browser.rs -> net.rs with identical
  counts; the page-script XMLHttpRequest exemption dropped with the page script (DT-C278).
- docs/guide/safety.md: "Browser tabs: what pages may do" replaced by "Project icons from the web";
  marker repointed (browser.rs -> net.rs, web_icon.rs) and moved.
- COMPAT.md: a "Retired 2026-11-12 (DT-C275)" note over the browser contracts (CLI verbs, BROW-* rows,
  browser shortcuts). Tables kept as history.

### Gate (logs: _shared/logs/c1-gate/r5/)
- `npx tsc --noEmit` -> exit 0 (also after the second c3 merge).
- `pnpm check` -> exit 1 at guide-check: feature-map.md marker (o2-tests/1400, open since round 4).
  Run alone after it: invoke-contract FAILED, `browser_go` still invoked from src/browser/useBrowserChords.ts
  (P1 o1-tools/1415: delete src/browser/). workflow-check and kolux-memory tests pass.
- `npx vitest run --no-fsModuleCache` -> `Test Files 2 failed | 890 passed (892)`,
  `Tests 2 failed | 6602 passed (6604)`: invoke-contract.test.mjs (same browser_go cause) and
  src/privacy/hosts.test.ts (stale `example.com` placeholder; P1 o3-rune/1420). The round-4 jsdom
  load error is gone.
- `cargo test` under `. scripts/test-env.ps1`: lib `2939 passed; 1 failed; 9 ignored` in 518 s on a
  loaded PC; the failure (status::p81_a_deny_settle...) passes alone. `--test '*'`: 20 binaries,
  247 passed, 0 failed. Lib count fell from 3183 with the browser modules' tests.
- Merge kept, not reverted: both red tests are stale references in other lanes' files to code goal 0
  told c3 to delete; reverting would undo the web pane removal.
- Smoke (`--port 1430 --cdp 9341 --temp G:/Temp/kolux-rs-smoke-c1 --offscreen`) on e86e8e28:
  `smoke: 6/6 flows passed` (flow 5 report-only, savedLayout bytes until T-184). Flow 6: Claude Code,
  Codex, Grok, OpenCode and a blank terminal all took input. evidence/smoke-r5.txt (local).

### Decisions
DT-C278: the privacy audit's icon-client pin follows the code from browser.rs to net.rs.

### Bugs
Opened: o1-tools/1415 (delete src/browser/; invoke-contract red), o3-rune/1420 (hosts.test.ts stale
example.com). Seen closed by lanes this round: c3-terminal/1320 (Grok/OpenCode pane type, c3 half;
paneMark half filed to c2 as 1900), c3-terminal/1410 (jsdom). Progress noted on c1-coord/1105 x2.
Open after this round: P0 0, P1 4, P2 6 (lane-lock bug closed by Txais).
Noted: the external kolux-cli and computer-use skill descriptions now say Kolux has no built-in browser.
Txais decided (~14:10), recorded as DT-C279: Rune no-go for this wave (spike and findings kept;
re-measure after the native terminal is proven); lane lock added to lane-loop.ps1; external skill
text no longer mentions a built-in browser.

## Round 6 (2026-11-12, coordinator, final round)

### Merges into integrate/wave-1
- All five lanes had finished round 6 when this round began (15:02), so no wait was needed. o2-tests
  wrote no round-6 handoff note; its round-6 commit 6801c25d (smoke flows 6 and 7 pass, two audit P2s
  closed) was already merged.
- lane/c3-terminal (clean): 17ae2786 (a new pane starts on the plain renderer and loads WebGL after
  its first paint; Kolux's part of opening a new terminal 336.5 -> 68.8 ms live; the remaining ~700 ms
  is Windows PowerShell 5.1 starting) and cc3c9e66 (c3 lane report).
- c2-agents, o1-tools, o2-tests, o3-rune: no new commits since round 5.
- The LANE-REPORT.md keep-own-report rule held: integrate/wave-1 still carries c1-coord's report. c3's
  "integrate carries c2's report" note traces to b3acc348 (13:14), before the rule was in force.

### Gate (logs: _shared/logs/c1-gate/r6/)
- `npx tsc --noEmit` -> exit 0.
- `pnpm check` -> exit 1 at guide-check (feature-map.md marker, o2-tests/1400). Run alone after it:
  invoke-contract FAILED (`browser_go` from src/browser/useBrowserChords.ts:45, o1-tools/1415);
  workflow-check and kolux-memory tests pass.
- `npx vitest run --no-fsModuleCache` -> `Test Files 2 failed | 891 passed (893)`,
  `Tests 2 failed | 6605 passed (6607)`: invoke-contract.test.mjs and src/privacy/hosts.test.ts
  (o3-rune/1420), the same two as round 5.
- `cargo test` under `. scripts/test-env.ps1` -> lib `2940 passed; 0 failed; 9 ignored` (272 s, quiet
  PC), every integration binary ok, `cargo exit 0`.
- Smoke (`--port 1430 --cdp 9341 --temp G:/Temp/kolux-rs-smoke-c1 --offscreen`): `smoke: 6/6 flows
  passed` (flow 5 report-only until T-184). Flow 7 read 9 session rows vs 8 panes: P3 filed to o2-tests.

### Main not merged
The final merge into main needs a fully green gate. Three leftovers keep it red, each in another lane's
files: delete src/browser/ (o1-tools/1415), drop `example.com` from the privacy hosts list
(o3-rune/1420), re-check feature-map.md and move its marker (o2-tests/1400); then repoint glossary
"Tab" off src/browser/BrowserPane.tsx. Txais was asked in round 5 whether the coordinator may finish
them ("coordinator may finish the leftovers"); no answer was on disk, so they stay with their lanes and
main was not touched. About 15 minutes of work once approved, then rerun the gate and run the
`merge --no-ff integrate/wave-1` in the main checkout.

### Bugs
Opened: o2-tests/1545 (P3, smoke flow 7 rows vs panes). Progress noted on c3-terminal/1155 (Kolux's
part fixed; PowerShell start remains; kept-warm shell is Txais's call). Open after this round: P0 0,
P1 4, P2 6, P3 1.

### Changelog
A new terminal shows up faster (Kolux's share about 340 -> 70 ms).

## 2026-11-12, coordinator round 6 re-run (leftovers approved)

Txais approved "coordinator may finish the leftovers" (~14:58) and asked for one re-run of round 6
(~16:12). No lane had new commits since round 6 (0 ahead on every lane branch).

### Leftovers done by the coordinator (commit c123141b)
- o1-tools (bug 1415): deleted src/browser/ (11 files); it still called the removed `browser_go`
  command. Also dropped the `notePage` stub in src/onboarding/guide.ts (c2 file, kept only for it).
- o3-rune (bug 1420): dropped `example.com` from NOT_A_CONNECTION in src/privacy/hosts.test.ts.
- o2-tests (bug 1400): feature-map.md marker 080e4346 -> 6801c25d (its last edit commit).
- Found on the way: docs/guide/files-and-browser.md marker named src/browser/openIn.ts; dropped it
  (page text already describes the system browser). scripts/glossary-check.mjs "Tab" repointed to
  src/terminal/PaneMenu.tsx ("Move to Tab").

### Gate (logs: _shared/logs/c1-gate/r6b/)
- `npx tsc --noEmit` -> exit 0.
- `pnpm check` -> exit 0 (guide-check OK 12 pages, invoke-contract OK, glossary OK).
- `npx vitest run --no-fsModuleCache` -> `Test Files 889 passed (889)`, `Tests 6581 passed (6581)`.
- cargo: the first run was killed by Txais's 16:29 CPU pause. Resume rerun (logs r6c/): tsc exit 0, pnpm check exit 0,
  vitest 889/889 files 6581/6581 tests, `cargo test` exit 0 (24 binaries, 3187 passed, 0 failed, 9 ignored).

### Main merge
Blocked by the clean-room guard hook (.claude/hooks/clean-room-guard.mjs): its first pattern was
written for the old Electron repo and, matched case-insensitively, also matches the main
checkout's own folder after the 2026-11-11 rename (kolux-rs -> kolux). Every Bash and PowerShell
call naming the main checkout is refused. The coordinator did not work around the hook.
Retried once after the resume (Txais ~16:35 "resume and complete"); refused again.
Needs Txais: run the merge himself, or approve narrowing the hook.

### Bugs
Closed: o1-tools/1415, o3-rune/1420, o2-tests/1400. Open: P0 0, P1 2, P2 5, P3 1.
