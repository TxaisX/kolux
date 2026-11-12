# Kolux wave 1 audit, round 1 (combined)

Date: 2026-11-12. Written by c1-coord from the round 1 audit files of the wave (base 2029d743 for c2-agents).

Combines: AUDIT-c1-coord.md, AUDIT-c2-agents.md, AUDIT-o1-tools.md, AUDIT-o2-tests.md, AUDIT-o3-rune.md (each read
from its lane branch or worktree).

**Missing: the terminal area (c3-terminal) has no round 1 audit.** Its round 1 ended before it wrote AUDIT, NATIVE-TERMINAL
or LANE-REPORT (stated in its LANE-REPORT.md, written in round 2). The rows below for "c3-terminal" are therefore empty. The
terminal, shell, keys, status, chrome and look code, plus every Rust file c2-agents does not own, has had no audit. Only
incidental findings that other lanes made inside c3 files are collected in section 5.

Conventions: P0 crash or data loss or silent loss of a core function, P1 feature broken, P2 wrong or ugly with workaround,
P3 polish. CONFIRMED means traced or run by the auditor, PLAUSIBLE means read only. Severity and status are the audits' own.
Line numbers are as the audits gave them (c2-agents at 2029d743; others at their branch heads on 2026-11-12), so they may
have moved.

## 1. Summary

Counted from the audit files, one finding per table row or heading.

| Lane / area | P0 | P1 | P2 | P3 | Total | CONFIRMED |
|---|---:|---:|---:|---:|---:|---:|
| c1-coord (wave process, ownership map, PLAN/README/DECISIONS) | 1 | 2 | 5 | 4 | 12 | 11 |
| c2-agents (launch, sidebar, projects, git/scm/github, onboarding, board) | 0 | 7 | 13 | 17 | 37 | 29 |
| c3-terminal (terminal, shell, keys, status, most of src-tauri) | n/a | n/a | n/a | n/a | n/a (no audit) | n/a |
| o1-tools (settings, editor, scm UI, ports, artifacts, chat, automations, skills, build loop, web pane removal) | 1 | 12 | 31 | 38 | 82 | 79 |
| o2-tests (scripts/prove, evidence, stress, tests) | 0 | 7 | 8 | 4 | 19 | 18 |
| o3-rune (usage, insights, notify, i18n, privacy, feedback, update, Rune spike) | 0 | 1 | 6 | 4 | 11 | 8 |
| **Total** | **2** | **29** | **63** | **67** | **161** | **145** |

Count notes:
- o1-tools: its own section 4.8 says P0 1, P1 7, P2 15, P3 20, but that covers only the second pass (L-, H-, N- ids, 63
  findings) and lists nine P1 ids while saying seven; counting the same ids gives P0 1, P1 10, P2 21, P3 31. The table above
  counts the whole file: 19 F- findings, 5 L-, 5 H-, 53 N- = 82. F-01 and L-1..L-3 describe the same slow local build loop from
  different angles; they are counted separately because the audit lists them separately. F-19 is rated P2 CONFIRMED but is a
  clean result (no browser dependency in ArtifactsPage).
- c2-agents: counts are the 37 numbered table rows. The three "top bug" write-ups carry no severity; bug 3 (chooser stays on
  "Same folder for all") has no table row, so it is listed unrated under section 2.
- o2-tests: the last P3 ("Proof for Round 1") is a record of commands run, not a defect; it is counted because the audit rates
  it. The audit file also carries a round 2 ledger (its section 5): the lane has since fixed most P1 items (see the status
  column in section 2).
- o3-rune: the audit's section 3 says fixes for six findings were found uncommitted in its worktree. Two P3 findings
  (missing `type="button"`, unmount guards) are each bundles of several sites; each is counted once.
- c1-coord: row 0b is CONFIRMED by o3-rune, counted as CONFIRMED.

## 2. P0 and P1 findings (31: 2 P0, 29 P1)

"Where" is as given in the audit. Cost is the audit's estimate. State notes record what the audit file itself says was fixed
since. "moot" flags: no P0 or P1 fix lives inside the embedded browser that goal 0 removes, so none is dropped. Rows tagged
"removal work" exist only because the web pane is going; they are required changes, not wasted ones.

### P0 (2)

| Lane | Id | Sev | Status | What is wrong | Fix | Cost | Where |
|---|---|---|---|---|---|---|---|
| c1-coord | #0 | P0 | CONFIRMED | Every lane commits its own LANE-REPORT.md at repo root; the second merge is an add/add conflict, and every lane's round-start merge of integrate/wave-1 then conflicts, so nothing integrates. | Txais approves (a) local `merge=ours` attribute plus `git config merge.ours.driver true` (tested in a scratch repo), or (b) rename to LANE-REPORT-<lane>.md in loop prompt and briefs. Until then c1 does not merge lane branches. | 5 min (a), 30 min (b) | wave process, `LANE-REPORT.md` |
| o1-tools | H-1 | P0 | CONFIRMED | The update check calls `crate::browser::head(...)`, the app's only HTTP client with proxy and cert policy. Deleting browser modules silently stops updates, no error. | Reduce `browser.rs` to a ~600-line `net.rs` (head/get, allowed, local_host, public_addrs, hop_ok, icon_clients, fetch_icon_within) before deleting the rest. Owner c3-terminal. Removal work. | not given | `src-tauri/src/update.rs:163`, test `update.rs:548` |

### P1 (29)

| Lane | Id | Sev | Status | What is wrong | Fix | Cost | Where |
|---|---|---|---|---|---|---|---|
| c1-coord | #1 | P1 | CONFIRMED | Paths no lane owns: spec/, docs/guide/, src/assets/, design/, tools/, scripts/*.mjs check scripts, four root tests. Browser removal needs spec/ and docs/guide/ edits nobody may make. | c1 claims spec/, docs/guide/, scripts/*-check.mjs; src/assets/ to c2; root theme/contrast tests to c3; record in DECISIONS. | 15 min | ownership map `_wave/prompts/*.md` |
| c1-coord | #2 | P1 | CONFIRMED | 15 PLAN tasks and BROW cards still describe the web pane as shipped; plan-check counts BROW-001..009 as passing P0 cards. | After o1 removal merges: DECISIONS row, move BROW cards to retired (H), strike BROW tasks, drop "browser tabs" from README. Removal work. | 45 min | PLAN.md:79,177-178,199,215,265-270,335,349,400-401; DECISIONS.md section 3 |
| c2-agents | #1 | P1 | CONFIRMED | Pre-spawn agent start failures are never logged, so "Grok never started" cannot be diagnosed. | log::warn with id, program, resolved path, error (terminal.rs part filed to c3). | 30 min | `agents.rs:779-780`, `terminal.rs` terminal_spawn |
| c2-agents | #2 | P1 | PLAUSIBLE | Skipped pre-trust is silent; Claude then sits on "Quick safety check" with "No, exit" preselected (pane histories 127-129 confirmed stuck). | Log why trust was skipped, show a pane notice "choose Yes", find why team worktrees fail made_by_kolux / head_is_on_origin. | 1-2 h | `launchActions.ts:369-384`, `trust.rs:334-391` |
| c2-agents | #3 | P1 | CONFIRMED | Claude gets inline `--agents` JSON and a multi-line system prompt on argv; breaks under shell wrap and eats the 32K limit. | Write to a file, pass the path. | 1-2 h | `agents.rs:808-809` |
| c2-agents | #4 | P1 | CONFIRMED | Agents are not started through the user's shell (goal 0 item 5). | New `agent_shell.rs` via_shell (powershell -EncodedCommand on Windows, `$SHELL -l -i -c` on Unix), fallbacks, logical program kept. Needs c3 hook at spawn. | 1-1.5 d | `pty.rs:323` via `terminal.rs:1133` |
| c2-agents | #5 | P1 | CONFIRMED | Sidebar quick launch (own folder) makes a worktree with no team record or view; separate grid. | Record team folder, view = project. | 45 min | `launchActions.ts:433-436` |
| c2-agents | #6 | P1 | CONFIRMED | One-AI own-folder launch is not a "team": own row, own grid. | `team = makes`. | 20 min | `launchActions.ts:120` |
| c2-agents | #7 | P1 | CONFIRMED | With worktree rows hidden, "+ New workspace" opens its name field inside display:none. | Drop the button or move nameField out. | 30 min | `ProjectsPanel.tsx:2295-2299, 2405` |
| c2-agents | top bug 3 (unrated, no table row) | unrated | CONFIRMED | Chooser stays on "Same folder for all" at 2+ seats: sheetStart stores copies explicitly so the default never applies. Also launchActions records `makes ? separate : shared` instead of the user's choice. | sheetStart leaves copies undefined unless user picked; file to paneActions.ts owner if needed. | ~45 min | `seats.ts:355-359`, `paneActions.ts:93`, `SeatChooser.tsx:51`, `launchActions.ts:116,195` |
| o1-tools | F-01 | P1 | CONFIRMED | Trying a change takes 30-45 min: release.mjs checks out separately, waits up to 30 min on CI, builds with lto, makes installer and signs; CARGO_TARGET_DIR unset so each worktree builds cold. | `pnpm local` (scripts/local-run.mjs) plus docs/dev-loop.md, shared target dir, identifier com.txaisxiong.kolux.local. | ~0.5 d | `Cargo.toml:81-86`, `scripts/release.mjs:252-357` |
| o1-tools | L-1 | P1 | CONFIRMED | `lto = true` + `codegen-units = 1` make release 7x debug (19m55s vs 2m42s measured). | Add `[profile.local]` (thin lto, 16 units, incremental). Cargo.toml is c3's; bug filed. | 20 min + a timed run | `src-tauri/Cargo.toml [profile.release]` |
| o1-tools | L-2 | P1 | CONFIRMED | `tauri build --no-bundle` exists and is unused; every local try also builds NSIS, updater artifacts, signature. | `pnpm local` uses `--no-bundle --profile local --config local.json`. | 30 min | `scripts/release.mjs:356` |
| o1-tools | L-3 | P1 | CONFIRMED | Harness honours CARGO_TARGET_DIR but nothing sets it; every lane rebuilds from cold. | Default one shared target dir for local builds; document one build at a time. | 40 min | `scripts/evidence/app-launch.mjs:468` |
| o1-tools | F-02 | P1 | CONFIRMED | EditorPane.tsx is imported both dynamically and statically (DiffPane, AllChangesPane, DiskBanner), a circular import that defeats lazy loading (vite INEFFECTIVE_DYNAMIC_IMPORT). | Extract look, saveFile, saveQuiet, stampOne, StaleNotice into editorShared/StaleNotice. | ~2 h | `AllChangesPane.tsx:30`, `DiffPane.tsx:29`, `DiskBanner.tsx:16`, `EditorPane.tsx:49,92-183` |
| o1-tools | H-2 | P1 | CONFIRMED | Project icons call browser::allowed, local_host, icon_clients, fetch_icon_within, public_addrs, hop_ok. Removal work. | Keep in net.rs (see H-1). Owner c3 + c2. | not given | `web_icon.rs:46,81-83,94,214-251`, `projects.rs:3237-3300` |
| o1-tools | H-3 | P1 | CONFIRMED | The Tower window is built by `browser::tower::tower_window_open`; deleting browser_*.rs breaks Tower. Removal work. | Move it beside the other window builders first. Owner c3. | not given | `browser_tower.rs:45`, `lib.rs:887,233`, `src/tower/ownWindow.ts:133` |
| o1-tools | N-01 | P1 | CONFIRMED | HTML Preview becomes a silent no-op once the pane is gone (event with no listener). Removal work. | Repoint to `open_external` or drop the button. | 30 min | `EditorPane.tsx:791`, `DiffPane.tsx:576`, `htmlPreview.ts:15`, `shell/useWindowStart.ts:94` |
| o1-tools | N-15 | P1 | CONFIRMED | Checks panel PR link: plain click goes to the pane, so after removal it does nothing. Removal work. | `openOut(pr.url)`; drop inKolux, reviewHint. | 15 min | `ChecksPanel.tsx:157` vs `:47` |
| o1-tools | N-26 | P1 | CONFIRMED | Chat links can return "kolux" and offer a "choose browser" menu; this stops the pane deletion from compiling. Removal work. | Make webClick system-only; drop BrowserChoice, inKolux, LinkHost.chooseBrowser. | 60-90 min | `chatLinks.ts:140-145`, `ChatText.tsx:6,38,84`, `StepRows.tsx:10,58-63`, `ChatView.tsx:198-213,346` |
| o1-tools | N-40 | P1 | CONFIRMED | Two settings switches (General "Open links in Kolux", Terminal "Open web links ... in the Kolux browser") will read nothing. Removal work. | Delete both with N-26. | 20 min | `GeneralPage.tsx:336`, `TerminalPage.tsx:222-225` |
| o1-tools | N-44 | P1 | CONFIRMED | The "Removing a started session" setting does nothing: removePlan has no non-test caller; the real path always asks. | Wire it in removeSession (c3 file) or delete the control. Cross-lane. | 30-45 min wired, 5 min deleted | `TerminalPage.tsx:277-284`, `terminal/remove.ts:41`, `terminal/paneActions.ts:105-113` |
| o2-tests | P1-a | P1 | CONFIRMED | startPlain() and openClaude() use removed UI selectors (chooser select, button.newtab); about 60 live scripts affected. | Use the data-testid tiles and `pane-new-session`. State: fixed in round 2. | ~0.5 d | `scripts/prove/live-common.mjs:355-370, 144-150` |
| o2-tests | P1-b | P1 | CONFIRMED | Vite port regex `/localhost:14\d\d/` fails on o2 slots 1500-1590. | Match PROVE_PORT/VITE_PORT or any port. State: fixed in round 2. | ~1 h | `scripts/evidence/cdp.mjs:22`, `scripts/stress/lib.mjs:335` |
| o2-tests | P1-c | P1 | CONFIRMED | Hardcoded BASE, LOGS and identifier break parallel runs. | One env() accessor. State: fixed in round 2. | ~0.5 d | `live-common.mjs:19-25, 74, 247-248, 296` |
| o2-tests | P1-d | P1 | CONFIRMED | 10 live scripts plus s10-git-load target the Source Control sidebar removed by T-644. | Rewrite onto All Changes or retire. State: open (run-all flags them). | ~1.5 d | `live-edit-common.mjs:34`, `live-git-common.mjs:10-45`, `live-GIT-*`, `live-EDIT-027/029`, `s10-git-load.mjs:188-192` |
| o2-tests | P1-e | P1 | CONFIRMED | 9 live scripts use removed `button.newtab` or `.sb-foot` add-project button. | Central openNewSession / addProjectByPath helpers. State: newtab and chooser fixed, add-project paths open. | ~0.5 d | `live-EDIT-041`, `live-TERM-023/041`, `live-VIEW-001/017`, `live-audit-1:72`, `live-T-544:360`, `live-T-640:37`, `live-T-643:40`, `live-flood:228` |
| o2-tests | P1-f | P1 | CONFIRMED | 10 prove scripts, 2 stress scenarios and 1 IPC guard entry depend on the web pane. Removal work. | Move helpers, delete scripts, drop phases. State: fixed in round 2 (nine proofs deleted). | ~0.5 d | `live-BROW.mjs`, `live-browser-*.mjs`, `live-checks.mjs:102-138`, `s11-footprint.mjs:352-385`, `s12-everyday.mjs:169-222`, `app-launch.mjs:100` |
| o2-tests | P1-g | P1 | CONFIRMED | `.pane-row` no longer exists in src/; 5 live checks and a helper query it, so they cannot pass (their unit test passes anyway). | Use `.sess[role=button][data-pane]`; add a selector-drift assertion. State: fixed in round 2. | ~2 h | `scripts/prove/pane-states.mjs:8`, `live-ORCH-016:11`, `live-SET-027`, `live-T-640`, `live-T-643` |
| o3-rune | P1 | P1 | CONFIRMED | Claude `resetsAt` is in ms but treated as seconds: launch warnings and usage alert dates show year ~58,000. The test masked it by using seconds. | Divide by 1000 in claudeFigures; test with real ms values. State: fix found uncommitted in the worktree, verified there. | ~15 min | `src/usage/launchWarn.ts:44-48` (used at `:27`, `alerts.ts:37`) |

Counts check: P0 rows 2; P1 rows 29 numbered (c1 2, c2 7, o1 12, o2 7, o3 1) plus the one unrated c2 top bug listed for completeness.

## 3. Refactor plan per area

Highest value first. Behaviour stays the same; one refactor per commit.

### c1-coord
- Tag each of the 80 open PLAN tasks `blocked: <reason>` or `wave-able` so later rounds plan only what lanes can finish (#5).
- Fix the mojibake `U+FFFD` at PLAN.md:136, 202, 261, 406 (#4, 5 min).
- DECISIONS.md is 855 lines (over ~800); section 7 grows each wave. Splitting needs a plan-check change; leave until after the wave (#7).
- After web pane removal lands: rewrite README.md:43 and :51, move BROW cards to retired (#2, #3).
- Re-check `@xterm/*` (4 packages) after the native-terminal decision; all 31 dependencies are otherwise in use (#8).

### c2-agents
- Split the oversized Rust files along their seams (all with tests moved out first): projects.rs 6921 lines (~3600 tests; icons, naming, rename, remove, records, place, origins, start_git), scm.rs 5792 (tests from line 2975), git.rs 4507 (tests from 2339; guard, runner, trash, diff), agents.rs 1785, agent_install.rs 1530, session_list.rs 1034.
- Split ProjectsPanel.tsx (2871 lines) after the sidebar fix: useWorktreeScan, usePrPoll, NameField, WorkspaceRow, ProjectBlock, ProjectSettingsForm, GroupForm.
- One shared bounded-process runner (`process_run.rs`) for git.rs:1717, scm.rs:941-1088, scm_writers.rs:~330 (#25, 1 d); resolve the agent path once and cache search dirs (#12); reuse stored_paths for the registry Path read (#26).
- Delete proven-dead code: launchFailed, promptFailed, launchInOrder, dead exports in projects (baseHint, details, folderWorkspace, headers, renameOnWork, filter, rows), CardFacts.agents, stale `#[allow(dead_code)]` (#28-#31).
- Merge the two FEATURED lists (launch/agents.ts:57, launch/agentInstall.ts:17) and replace local path compares with sameDir/pathKey (#27, #19).
- After o1 deletes src/browser: remove the browser tour, step, demo, stop card and notePage from src/onboarding, reword the "a browser is open" copy in space.ts (#32, #33). scm_watch.rs (1785 lines) was not reviewed for seams.

### c3-terminal
- No round 1 audit and no refactor findings of its own. Its LANE-REPORT.md names TerminalPane.tsx (2,170 lines) to be split in a later round, and o3-rune counts the terminal area at 170 files (paneActions.ts 45 KB among them).
- Work already planned in its report: native terminal step 2 (skip xterm drawing for native panes), terminal visual bugs, then the audit it never wrote.
- Refactor work other lanes asked of c3 files: reduce `browser.rs` to `net.rs` and delete the other ~27 modules (~14,000 lines) (o1 H-1 to H-5); move `tower_window_open`; add `[profile.local]` (o1 L-1); remove browser surfaces in src/shell, src/chrome, src/keys, src/terminal, styles.css (o1 section 1.2).

### o1-tools
- Break the EditorPane cycle: move look, saveFile, saveQuiet, stampOne, StaleNotice, save guards into editorShared, saveGuards, editorTheme; EditorPane drops from 933 below 800 (F-02, N-08, N-14, 2-3 h total).
- Delete the dead SourceControlPanel.tsx (1,350 lines) plus FailureNotice, FileOpenWith, openWith, HandoffNote, LineNotes, LocalOnlyBadge and their tests, after c1 confirms (F-09, ~2 h). Needs a c1 answer.
- Split Explorer.tsx (1,012 lines) into explorerOps.ts and ExplorerMenus.tsx (F-04, ~3 h); split model.ts (686) into graph, mergeBox, budget (N-23); split frontMatter.ts (777) into richPlacement.ts (N-09); move Detail and HermesRuns out of AutomationsPage.tsx (N-39).
- Dedupe helpers inside the lane: baseName, clampZoom, pastedName (F-05), stepZoom, freeName, legacy cleanApps/PRESETS (F-13), the four open-in-system-browser copies into one `openOut` (N-19), four path-key copies (N-11), two number-draft fields (N-47, N-48), three list searches (N-37), `renderMarkdown` out of PreviewPane (N-38).
- Delete proven-dead code: pickers.ts, NEUTRAL, hasChanges, autoSaver, hiddenWhitespace, openInItems (F-11, N-50); viewSwitch and diskChange exports (N-10); withLink, acLayoutOf (N-22); setupChoice and dead automation keys (N-28); unused composer `commands` prop (N-27); shadowed CSS rules in settings.css (F-12).
- Add missing tests on risky paths: EditorPane, PrStart, CommentsPanel, ChatView, MessageBox, AutomationsPage, PdfView, ShortcutsPage (N-12, N-20, N-30, F-07, N-52).

### o2-tests
- Consolidate duplicated harness helpers: poll vs waitFor, shot, rawKey, dismissFirstRun, checker vs guardRow (P3 duplicated helpers; shot and rawKey still duplicated after round 2).
- Wrap standalone prove entry points in `isMain` guards and gate writes to `ROOT/evidence/` (partly done: PROVE_EVIDENCE and PROVE_NO_EVIDENCE exist; 7 entry points open).
- Split smoke.mjs (809 lines after flows 6 and 7) along its `--self-test` block into smoke-flows.mjs.
- Rewrite or retire the 10 Source Control live proofs and s10-git-load (open).
- Keep the generated coverage matrix (`tests/coverage.md`, 91 of 237 guide tasks named by a test) and the src-derived selector-drift check in run-all as the way to track health.

### o3-rune
- Extract shared formatting and scan helpers (compact, money, dayText, ago; dueForCount vs dueForScan, countedAt vs scannedAt, folderOf vs workspaceName) into `src/usage/format.ts` and reuse from insights (~45 min).
- Preload the active language pack at startup or add a `useT` hook subscribed to `onPackLoaded`, which no production code calls today (~30 min; main.tsx and TopBar.tsx are c3's).
- Swap `?raw` imports in contract tests for `readFileSync` so a stale Vite cache cannot fail correct code (~20 min); CI cache clear is o2's.
- Add `type="button"` and unmount guards; clear the `states` Map in paneFigures; memoize pricing resolve (found already written, uncommitted).
- No file in the lane is over 800 lines (largest: UpdateCenterView.tsx 355). Duplicate `.upd-*` rules in styles.css belong to c3.

## 4. Other findings by count (P2 and P3, for orientation)

Not listed one by one here; each audit file holds the rows. The groups with the most weight:
- c2-agents P2: 5 s scan polls hidden worktrees (#9), up to 4 full PATH walks per agent pane (#12), URL row opens the embedded browser (#15), scm_github_repo and scm_watch do blocking work on the async worker (#17, #18), serde panic on a corrupt mail store at startup (#16), no test of the DT-C274 hiding (#20).
- o1-tools P2: 2 s `file_stamps` poll per editor tab under the fence mutex (N-03), no right-click Copy on non-editable text anywhere (N-07), Checks tab frozen on one status read (N-16), settings search mounts every matching page including a full claude_setup scan (N-45), four settings writes bypass the save turn (N-49), Ports clears its list on open (N-17).
- o2-tests P2: smoke.mjs lacked the session and sidebar flows (fixed in round 2), 12 scripts hardcode ports, 9 write into `ROOT/evidence/`, window moved to (0,0) over the user's monitor, coverage 15.8% of the feature index by id, only 36 `data-testid` for ~45 feature areas.
- o3-rune P2: language packs load async but nothing re-renders, stale translation of `onboarding.connect.wait` in 5 packs (fixed uncommitted), pricing resolve rebuilds tables per row (fixed uncommitted), duplicated helpers, stale Vite cache.
- c1-coord P2: lane-loop can run two sessions in one worktree (0b), README lines about browser tabs and the Windows console (#3), PLAN mojibake (#4), 80 open tasks unreachable by lanes (#5), smoke.mjs gap (#6).

## 5. Cross-lane items

### Duplicated helpers across areas
- Path key: `keyOf` (o1, `editor/buffers.ts:141`) is re-implemented in `agents/rail.ts:12` (c2; it mangles WSL paths), `editor/desktopDrops.ts:19` and `editor/noteLinks.ts:78` (o1 N-11). c2 also has local path compares that ignore `\` vs `/` (#19): both want one shared helper (`sameDir`/`pathKey`).
- Registry Path read written three times: `agents.rs:249-258` (c2), `lifecycle.rs:735` and `pty.rs:146` (c3). c2 reuses its own; the other two are a bug to c3 (#26).
- `openInItems` in `settings/openIn.ts:62` re-implemented at `scm/openWith.ts:13` (both o1; F-09 retirement may remove one).
- `linksOpenInKolux` read as a literal in `shell/linkAsk.ts:6` and `shell/window/Pane.tsx:255` (c3) and in o1 files; disappears with web pane removal.
- Two FEATURED agent lists in c2 (`launch/agents.ts:57`, `launch/agentInstall.ts:17`).
- Harness helpers (shot, rawKey, dismissFirstRun) in `scripts/prove` and `scripts/stress` (both o2).

### Unowned or mis-assigned paths
- Unowned (c1 #1): spec/, docs/guide/, src/assets/, design/, tools/, scripts/*.mjs check scripts, root tests (plainWords, contrast, themeContrast, screenLook). Proposed: c1 takes spec/, docs/guide/, scripts/*-check.mjs; c2 src/assets/; c3 the theme tests. Needs a DECISIONS record.
- docs/guide/feature-map.md (o2) sits in docs/guide, which c1 proposes to claim: the brief gives o2 that one file; keep it explicit.
- Still unnamed in c1's claim: `scripts/privacy-audit.test.mjs`, `scripts/bundle-budget.mjs`, `scripts/csp.test.mjs` (o1 lists them as browser leftovers for c1), and the external repo TxaisX/kolux-skills (two skills still mention the embedded browser).
- o1 assigns `src-tauri/src/import.rs:631` to c2-agents, but c2's OWNS list does not include import.rs, so it falls to c3-terminal by default. Needs a c1 ruling.
- o1 assigns `src/status/` browser references to o3-rune, but src/status/ is in c3-terminal's OWNS list. The bug file is probably in the wrong queue.
- `.upd-*` CSS duplicated in `src/styles.css` (c3-owned) vs `src/update/update.css` (o3).

### Needs c1-coord or Txais
1. Decide the LANE-REPORT.md merge fix (P0 above). Until then c1 merges no lane branches.
2. Lane-loop lock file per lane (two sessions ran in one worktree); harness change, Txais's call (0b).
3. Record DECISIONS rows and CHANGELOG lines: web pane retired (c1 #2), USAGE-001 header ring removed, native terminal path (keep ConPTY, draw with Microsoft.Terminal.Control.dll, setting terminalNative, default off); mark USAGE-001 removed in feature-index (all from c3's report).
4. Dependency decision: ship Microsoft.Terminal.Control.dll (MIT, NuGet CI.Microsoft.Terminal.Wpf, ~2-3 MB per arch) plus a THIRD-PARTY-NOTICES entry (c3's report).
5. Confirm retiring SourceControlPanel.tsx and its six dead children (o1 F-09).
6. Adopt the rule that every interactive element in the guides gets a `data-testid`, added by the owning lane; the sidebar workspace row needs one first (o2 P2, filed to c1).
7. The `?raw` stale-cache fix has a CI half (clear `node_modules/.vite`) that is o2's, and a code half in o3 (o3 2b).
8. Rust removal order matters: keep `net.rs`, Tower window and icon helpers before deleting browser_*.rs (o1 H-1..H-5, c2 note on Tower); this is filed to c3 but c1 gates the merge order.
9. N-44: the "Removing a started session" control is o1's, the reader is c3's `terminal/remove.ts`; one of them has to decide wire vs delete.
10. c2 #4 needs a c3 hook at `terminal.rs:1133` and `pty_service.rs:240`, and `terminal.rs:2203` / `shellMarks.ts:153` must key the output gate on the logical program (c2 #10).

### Incidental findings inside c3-terminal files (the area with no audit)
- `terminal.rs` terminal_spawn errors are never logged (c2 #1, R4); argv[0] drives the output gate (c2 #10).
- Right sidebar keeps polling behind a full-page settings screen: `Right.tsx:62` ignores `fullPage` (o1, bug filed).
- `terminal/remove.ts:41` removePlan has no non-test caller (o1 N-44).
- `update.rs:163` depends on the browser HTTP client; `startup_marks.rs:238` names `browser::helpers::sweep_at_start`; `browser_session.rs:4,21` leaves `browser-tabs.json` behind (o1 H-1, H-4, H-5).
- `Cargo.toml` has no local profile (o1 L-1).
- `.upd-*` rules in `styles.css:1014-1036` (o3).

## 6. Out of scope and not covered

- **Terminal area: no round 1 audit exists.** Nothing audited src/terminal (170 files), src/shell, src/chrome, src/keys, src/look, src/status, src/sleep, src/marks, src/lazy, src/ipc, src/recovery, src/space, src/switcher, App.tsx, main.tsx, theme.ts, styles.css, nor the Rust files c3 owns (pty*.rs, terminal*.rs, lib.rs, update.rs, and everything c2 does not own). c3's round 2 report says its native-terminal first build is unit-tested but not yet proven live, GPU drawing was checked but not measured with 8 panes, and terminal visual bugs are still ahead.
- c1-coord did not audit feature code or the 16 historical reports in docs/research/ (read-only history). The 60 old lane branches are noise, not wave work.
- c2-agents built and launched nothing; `src/sessions` past notices.ts was not scanned for dead exports; scm_watch.rs (1785 lines) was not reviewed for seams. Several fixes are PLAUSIBLE only (Grok weekly limit R3, Grok effort flag, Unix login-shell PATH, trust skip root cause).
- o1-tools: no live run of its screens in round 1 (only tsc, vite build, vitest, `pnpm check`); a full dead-code pass over src/settings (82 files, 10.2k lines) was only partly done; two editor tests fail under parallel CPU load (`richSaveLists.test.ts:55`, `PreviewPane.test.ts:86`; both pass alone). Docs, decisions and gates tied to the web pane are filed to c1, not audited.
- o2-tests: no live proof run in round 1; no Windows VM or CI runner set up (README only); feature-index coverage was measured by task id, so a check that names an id may still not exercise every button; `tests/coverage.md` (91 of 237 named, 38.4%) supersedes the audit's 15.8% figure, which used a different denominator (61 of 387 rows).
- o3-rune: the Rune spike has not been built; Rune publishes no Windows performance figures and has no terminal or PTY support (a terminal pane is all new code); the stale-translation check covered one key in five packs, not all strings; mount and timer effects of WorkspaceSpend, InsightsPanel and TokenAnalytics are untested; `src/styles.css` and `main.tsx` fixes belong to c3.
- Not audited by anyone: the app was never built or run against all findings together; no finding was re-verified by a second lane. Counts in this file are of audit rows, not of distinct defects (F-01 and L-1..L-3 overlap, and several o2 and o1 items are the same web-pane removal seen from two sides).
