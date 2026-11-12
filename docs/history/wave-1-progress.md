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
