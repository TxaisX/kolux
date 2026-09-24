# Handoff

Read this before changing anything. It is the current state of the project and the
context a fresh agent cannot infer from the code. Update it when you finish work.

Last updated: 2026-09-24.

## 2026-09-24: release 0.11.0

- **0.11.0 — x:** plan review before Claude runs, event-triggered automations, per-provider model routing, target-aware launcher refresh, the dashboard Runs view, terminal-grid layout presets and packaged update checks are new; OpenCode support is removed. Tagged `v0.11.0`; `release.yml` builds and publishes it.
- `pnpm ship --message "<text>"` commits with that exact message instead of asking Haiku; use it for version bumps, whose message must state the x/y reason.

## 2026-09-24: CI on main is green again

- **Why it was red:** the unit step never finished. ~8,000 files take ~50 min on one runner and the job timed out at 30, which GitHub reports as *cancelled*, so every "cancelled" run looked like a superseded push. Under that, ~120 files failed: `--ignore-scripts` left `node-pty` unbuilt (no Linux prebuild, ~97 files), plus stale rename fixtures, Windows-only path assumptions, and a few real bugs.
- **Now:** `.github/workflows/ci.yml` has a `check` job (typecheck, lint, max-lines) and a 4-shard `unit` matrix (~10 min each, `fail-fast: false`) that runs `ensure-native-runtime.mjs --runtime=node` first, the same step `pnpm test` runs, and sets a git author/committer so real-commit tests work.
- **Real bugs fixed along the way:** the Vercel sandbox name budget was one short since the `orca-` days (names hit 129 > 128); `translatedSymlinkTarget` and the WSL mounted-drive `joinWslPath` used the host's path rules on Windows paths; the Unix CLI launchers (`resources/linux/bin/kolux-ide`, `resources/darwin/bin/kolux`) were committed without the exec bit (packaging already chmods them); a `Tui`→`TUI` message casing.
- **Test fixes, not product bugs:** half-renamed fixtures (repos-remote, dev-channel/mac-channel repos, persistence, palette search, landing preflight, repo icon); the Codex trust-hash fixture needs its original `orca-case-b` command (the hash is of that exact string — Kolux's hashing is correct); `plugin-launch-content` now asserts on whatever launch packs ship (the fork ships none by design); the cross-version terminal journeys ran concurrently and clobbered one shared `window` (now sequential, and `terminal-wire-link.ts` refuses a second live link); the updater bridge subscribes before its snapshot on purpose.
- **Guards:** the child_process-import and global-fetch guards now skip `src/cli/bundled-skill-guides.ts`: it's generated from skill markdown, and the koluxsecurity docs quote `require('child_process')` / `fetch(` as prose.
- **Flake closed:** terminal tests could leave a real timer that fired after the file's global sweep deleted `window` (kolux#14728). `pty-connection-test-environment.ts` now tracks real timers while its globals are installed and cancels them at teardown.
- **Trap:** `vitest-agent-session-env-isolation.ts` strips every `KOLUX_*` env var, so `KOLUX_CROSS_VERSION_BASELINE_REF` never reaches the cross-version test. Locally the repo has upstream tags to v1.4.199, so that test picks the wrong baseline; it's only meaningful on CI.

## 2026-09-23: review the plan before Claude runs it (v1)

- New flow: when Claude calls `ExitPlanMode`, the pane header shows a "Review plan" icon
  button (`ClipboardCheck`) and the existing native-chat approval card grows a matching
  button. Both open the same `PlanReviewSheet` UI (a right-edge `Sheet`): the plan splits
  into sections at blank lines (code fences are exempt so a fenced snippet never gets cut),
  each section can take an inline comment, and a footer holds an optional general note plus
  **Request changes (N)** / **Approve**. Approve writes `'1'`; Request changes writes ESC,
  waits for the pane to actually leave the ExitPlanMode wait (or 3s), then sends the
  formatted feedback as a normal chat message. Drafts live in an in-memory LRU keyed by
  `paneKey + plan text` (`plan-review.ts`), not a store slice — a new plan from Claude is a
  new draft key.
- `interactive-tool.ts`'s `deriveInteractivePrompt` now carries ExitPlanMode's `tool_input.plan`
  in the approval envelope (`{approval:{tool,summary,plan?,planTruncated?}}`), shrinking the
  plan (binary search, surrogate-safe) until the serialized envelope fits the existing
  16,000-char `interactivePrompt` cap — `summary` is always kept so old clients still render
  a plain Allow/Deny card. **It fires on `PermissionRequest` OR a `PreToolUse` ExitPlanMode**:
  step 0 could not confirm which one this Claude build sends (see below), so both are wired,
  mirroring how `normalizeClaudeEvent` already treats AskUserQuestion. `claude-events.ts` was
  extended the same way so the pane shows `waiting` (amber dot) either way.
- **Step 0 deviation — no live-captured fixture.** The design called for a real ExitPlanMode
  hook payload captured via a standalone `claude` CLI run. Two independent blockers made that
  impossible in this environment/session:
  1. Headless (`claude -p ... --permission-mode plan`) never exposes `ExitPlanMode` as a tool
     at all — Claude's own reply says so verbatim: *"The tool I normally use to hand you a plan
     for approval isn't available in this session."* Confirmed with both bare `-p` and piped
     stdin.
  2. A real interactive run over a standalone `node-pty` (Windows conpty) — trust dialog
     answered, prompt submitted, echoed correctly — then produced **zero further PTY output**
     for 170s+, three separate times (one run also surfaced "You've used 99% of your session
     limit" first). This matches the `docs/reference` conpty caveat AGENTS.md already flags for
     dev-shell ptys; it reproduced on a bare script outside the app too.
  - `src/main/claude/__fixtures__/claude-exit-plan-mode-{pretooluse,permissionrequest}.json` are
    therefore built from Claude Code's documented `ExitPlanMode` schema
    (`tool_input: { plan: string }`) plus the exact envelope shape a real (non-plan-mode) hook
    run *did* capture live for other tools (`session_id`/`cwd`/`transcript_path`/etc.), not a
    literal ExitPlanMode capture. Flagged in a comment at the top of the test that loads them
    (`server-claude-normalization.test.ts`). If a real payload ever contradicts this shape,
    the fixtures and both event-name branches need a second look.
- **Worktree note:** this worktree (`G:/Dev/kolux-workspaces/kolux/plan-review`) disappeared
  mid-session (directory + branch both gone; `.git/worktrees/plan-review` was a stale/corrupt
  admin dir `git worktree prune --dry-run` flagged) — most likely an automated stale-worktree
  reaper firing on it while it still had zero commits. It was recreated with
  `git worktree add -b TxaisX/plan-review` from `main` (`f21282fda`, unchanged) and `pnpm
  install` was rerun. No work was lost — nothing had been committed or wag written to disk in
  it yet at that point — but this HANDOFF.md's pre-existing entries below are whatever `main`
  actually has at `f21282fda`, which may be older than what a previous session's copy of this
  file showed.
- New: `src/renderer/src/components/plan-review/` (`plan-review.ts`, `plan-review-send.ts`,
  `PlanReviewSheet.tsx`, `PlanReviewButton.tsx`, plus tests for each). Changed:
  `interactive-tool.ts`, `claude-events.ts`, `native-chat-interactive-prompt.ts`,
  `NativeChatInteractiveCard.tsx`, `NativeChatApprovalCard.tsx`,
  `terminal-pane/TerminalPaneHeaderRow.tsx`, `i18n/locales/en.json` (new `plan-review` keys).
- **Verified in the dev app (2026-09-23, isolated profile, CDP):** a live Claude pty doesn't run in dev shells, so a waiting status carrying the captured fixture plan was injected into a real pane's `agentStatusByPaneKey`. The pane header showed "Review plan". Clicking it opened the sheet with the plan's sections, a Comment button per section, a general note, and "Request changes (0)" (disabled until there's a comment) beside Approve. The keystrokes Approve and Request changes send were not exercised live; `plan-review-send.test.ts` covers their order and timing.
- **Step 0 result:** Claude Code 2.1.280 fires both `PreToolUse` and `PermissionRequest` for ExitPlanMode, and each carries the full text in `tool_input.plan`. Fixtures are in `src/main/claude/__fixtures__/claude-exit-plan-mode-*.json`.
- **Approve sends `'1'`**, like the existing approval card. In most Claude versions that is "Yes, and auto-accept edits", so the label stays a neutral "Approve".
- **Test trap:** a hand-built `agentStatusByPaneKey` entry needs `stateHistory: []`, or the runtime-graph sync subscriber throws and the app shows "Kolux hit a recoverable UI error".

## 2026-09-23: OpenCode support removed entirely

- **Owner's call:** Kolux focuses on frontier-lab agents, so OpenCode is gone, not hidden: the agent id, launcher/settings/status-bar/stats UI, OpenCode Go usage scraping and its account cookie, session-history scanning, hook plugin, PTY env/overlays, the `@opencode` orchestration address, `~/.opencode/bin` PATH discovery, the pet, and locale strings (~570 files). `pnpm ship` writes commit messages with Claude Haiku instead.
- **MiMo Code stays.** It reused OpenCode's status plugin, which now lives in `src/main/mimo/status-plugin/` (`getMimoCodePluginSource`); the generated plugin is byte-identical apart from names/comments. Shared normalizers are `normalizeMimoCodeEvent` / `extractMimoCodeToolFields`.
- **Mixed versions degrade, never fail** (`remote-wire-compatibility.md`): an old peer sending `statusBarItems` with `'opencode-go'` is filtered (`client-ui-schemas.ts`), `startupAgent`/`agent`/`launchAgent: 'opencode'` becomes "no agent"/a plain terminal (`worktree-schemas.ts`, `session-tabs-schemas.ts`); resuming an OpenCode session fails with invalid params. The `opencodePluginSource` relay param was removed on both sides at once.
- **Old profiles load clean:** `stripRetiredGlobalSettings` drops `opencodeSessionCookie`/`opencodeWorkspaceId` (the ciphertext is never retained, so the next save erases it); `normalizeDefaultTuiAgent` and `isTuiAgentEnabled` reject unknown agent ids; unknown status-bar ids are filtered in main (`normalize-loaded-ui-state.ts`) and renderer (`migrateStatusBarItems`).
- **One-time cleanup:** `src/main/startup/retired-opencode-cleanup.ts` (marker-guarded, run from preflight) deletes `<userData>/opencode-hooks`, `opencode-config-overlays` and `kolux-opencode-usage.json` via `safeRemoveTree` (never follows junctions into the user's real `~/.config/opencode`, which Kolux never touches). Relays sweep `~/.kolux-relay/opencode-overlays` at start.
- **Verified 2026-09-23:** `tc:node/web/cli` clean after merging main; renderer suites 9,920/9,928 (the remaining failures `palette-match-performance`, `worktree-palette-search` and the `repos-remote` SSH clone cases fail identically on main). Dev app over CDP with a seeded old profile (`defaultTuiAgent:'opencode'`, `opencodeWorkspaceId`, `statusBarItems` with `'opencode-go'`, a real leftover `opencode-hooks/`): loaded with `defaultTuiAgent:null`, no OpenCode settings, status bar filtered, `opencode-hooks/` deleted and the marker written; Settings > Agents lists MiMo/Claude/Codex/Gemini and no OpenCode; Accounts and Appearance have none; zero console errors. **Not verified:** a real remote host running an old Kolux (tolerance is unit-tested only).
- **Kept on purpose:** the terminal perf e2e fixtures, renamed `artificial-tui-*` (they emulate a heavy TUI); `capture-synthetic-tui-repro.mjs` still clones the public OpenCode repo as realistic redraw bytes. Remaining `opencode` strings are only the cleanup/tolerance code and their tests.

## Current handoff: improvement pass for Claude (2026-09-22)

Codex left this pass uncommitted in the primary checkout; on 2026-09-23 Claude verified
it, moved it into the `codex-pass` worktree on top of main, and shipped it.

- **Launcher reliability:** launch-agent discovery and refresh are now target-aware
  (local, environment, or SSH), stale selections are revalidated, unresolved hosts
  stay visible as an explicit state, and the queue shows the actual queued count.
  The focused launcher suites reported 51 tests plus 19 shared-checkout/refresh tests
  passing. Runtime-verified 2026-09-23: opened the launcher for a throwaway local
  project, clicked "Refresh agents", and confirmed the busy state toggled and the
  agent tiles (Claude/Codex) reflected local detection.
- **Updates:** the packaged app checks the `TxaisX/kolux` GitHub release feed every
  15 minutes and the sidebar button uses the same feed. Development builds now report
  that updates require a packaged app instead of claiming they are current. Available
  releases produce one in-app toast per version and an OS notification when the window
  is not focused; installing still requires the normal user restart. The update card
  no longer auto-restarts the app. Runtime-verified 2026-09-23 on a fresh dev boot: the
  store's `updateStatus` settles to `{state:'error', retryable:false, message:'Updates
  can be checked and installed from a packaged Kolux app.'}`, the sidebar button renders
  disabled as "Update unavailable", and the update card shows a failed-check state — none
  of it claims "current".
- **Release assurance:** `.github/workflows/release.yml` now runs
  `config/scripts/release-packaged-smoke.mjs` before publishing. It checks the packaged
  Windows CLI (`--version`, `--help`) and an isolated Nightshift-to-Kolux profile
  migration. Passed locally 2026-09-24 on a Windows package of main `8abd69906` (see
  Next steps).
- **Terminal continuity:** standalone terminal-window replay now resets the xterm
  buffer before applying replacement scrollback after resize. A headless regression and
  the terminal-window suite pass; this surface is dormant in the pane-based UI and the
  active SSH reconnect path had no reproduced failure. Not re-verified live this pass
  (out of scope — see Known gaps).
- **Layout presets:** presets can now arrange the active terminal pane grid while
  preserving the existing pane/PTY identities; tab-group presets remain identity-safe.
  Runtime-verified 2026-09-23: dispatched the same `kolux-split-terminal-pane` /
  `kolux-arrange-terminal-pane-grid` events the UI uses, split one pane into two, then
  applied the "2 pane grid" preset. Both panes kept the same `data-pane-id`/
  `data-leaf-id`/`data-pty-id` triples across the rearrange — no pane or pty was
  recreated.
- **Orchestration visibility:** the agent dashboard now has a Runs view that reads the
  runtime run/task ledger, supports refresh and pagination, and explains why direct SSH
  hosts cannot use the local ledger. The focused panel tests cover environment, SSH,
  and unresolved-host states. Runtime-verified 2026-09-23 with
  `experimentalAgentDashboardPopout` enabled on a throwaway dev profile: the Runs view
  rendered "RECENT RUNS" with the legacy local run and its inspect-only detail pane.
- **Cross-version wire coverage:** a new terminal-wire journey exercises current and
  release-tagged clients. CI now fetches full history so tags are available. The test is
  skipped on Windows because release-tree extraction hangs on this OneDrive checkout;
  Linux CI is the intended signal.

### Verification snapshot

- Updater preflight: 12/12 focused checks passed; renderer updater tests: 33/33.
- 2026-09-23: the full focused-suite sweep for this pass — launch-agents (7 files/55
  tests), updater incl. `UpdateCard*`/`SidebarUpdateButton*`/`updater-status-ipc-bridge*`
  (28 files/307 tests, 1 file/14 tests skipped), terminal-window (3/7), tab-group incl.
  layout presets (20/117), dashboard (70/542), pane-manager (76/859, 1 skipped),
  cross-version-wire (3 files/26 tests, 1 file/5 tests skipped on Windows as designed),
  settings incl. the terminal-preview snapshot (175/1148, 1 skipped) — all passed.
- `pnpm tc:node`, `pnpm tc:web` and `pnpm tc:cli` pass. (`tc:node` needed
  `'lastNotifiedUpdateVersion'` added to `MainOwnedUIState` in
  `ui-state-schema-parity-checks.ts`: only the main process writes it.)
- `oxlint` is clean on all 41 touched files. Two files needed line-count trims to stay
  under the 300/400-line ratchet after the pass's additions: `pane-manager.ts` (delegate
  methods converted to one-line arrow class fields) and `TabGroupPanel.tsx` (an
  `activeTerminalTabId` local extracted, two tab handlers collapsed). `DashboardRunsPanel.tsx`
  no longer type-imports from `main/runtime/orchestration/types.ts` (renderer tsconfig
  doesn't include main); it mirrors the two picked fields locally instead.
- `git diff --check` is clean.
- Not verified here: real browser sign-in in an installed build, and a full Linux CI run.

### Next steps for Claude

All five steps from the previous handoff are done. Step 4, 2026-09-24: in a `rel-build`
worktree at main `8abd69906` (OpenCode removal included), ran the release workflow's
build (`build:desktop` incl. typecheck, `build:native`, `ensure:electron-runtime`), then
`electron-builder --win --publish never` → `dist/kolux-windows-setup.exe` (169 MB,
signed). `release-packaged-smoke.mjs` passed: packaged CLI `--version` = 0.10.0 and
`--help`, and the isolated Nightshift → Kolux profile migration. Not done: installing
that build over the owner's live app or booting its UI (the smoke runs the exe as Node
only). A real release still needs a version bump past 0.10.0 and a `v*` tag, which
triggers `release.yml`.

## 2026-09-23: automations can start on an event

- An automation's **Trigger** is now Schedule or Event. The v1 events are: a PR/MR opens on a workspace branch, checks fail on a PR/MR, and an agent finishes in the project. They work for every git provider `getHostedReviewForBranch` supports.
- **Data:** `Automation.eventTrigger` and `AutomationRun.triggerEvent` (`src/shared/automation-event-trigger.ts`); the new run trigger value is `'event'`. When `eventTrigger` is absent, the automation runs on its rrule exactly as before. No migration.
- **Detection** (`src/main/automations/automation-event-sources.ts`):
  - Review events come from `setHostedReviewObserver` in `hosted-review.ts`. The first answer for a branch only sets a baseline.
  - `agent_done` comes from `subscribeEnrichedStatus`.
  - `automation-event-run.ts` filters on enabled, kind, repo, host ownership, the persisted key and a 5-minute cooldown, then dispatches with the event appended to the prompt.
  - Panes owned by an automation run are ignored, so a run can't trigger itself.
- **Wire:** the capability is `automation.event-triggers.v1`. The renderer refuses to save an event trigger to a host that doesn't advertise it, because an older host would silently run it on the schedule instead.
- **Limits:**
  - Review events fire only while something polls that branch (a worktree card or the checks panel). A headless serve with no client sees none. Latency is up to ~15 min before a PR exists and ~60 s after.
  - Anything that happened while Kolux was down is missed.
  - The run goes to the automation's configured workspace, not the triggering worktree. That override is the obvious v1.1.
  - Linear/Jira events need a poller that doesn't exist yet.
- **Verified:** 278 main-process tests (32 files, including `service.test.ts`) and 806 renderer automations tests pass; both typechecks clean. Dev app (isolated profile via `KOLUX_DEV_USER_DATA_PATH`): the editor shows Trigger, Schedule/Event, and the three event options.
- **Trap:** this worktree's first install left `node-pty` empty, so every file importing it failed at load. A second `pnpm install --frozen-lockfile` fixed it; the `@vscode/windows-process-tree` native rebuild still fails there, and unit tests don't need it.

## 2026-09-22: one WebGL hiccup no longer slows every new terminal

- In `auto` GPU mode (the default), one failed WebGL attach used to set a module-global flag that put every *new* terminal on the DOM renderer until the user changed the GPU setting. That contradicted the file's own per-pane-latch comment. On Windows the auto policy always allows WebGL, so a routine GPU reset after sleep stranded the session. Superset measured DOM at 1.2x to 13.7x the CPU of WebGL (their #6874).
- Now `pane-webgl-renderer.ts` demotes new auto panes only after **3 consecutive** failed attaches, and any success resets the streak. A GPU that never gives WebGL still stops costing each pane an attempt. The per-pane latch is unchanged. Tests: `pane-webgl-context-recovery.test.ts` (one failure doesn't demote a healthy pane) and `pane-lifecycle.test.ts` (three in a row do). The pane-manager suite passes (859).
- Other performance gaps found in the 2026-09-22 competitor study, not done yet:
  - No periodic WebGL glyph-atlas budget (superset resets it after 32 atlas pages, #6352).
  - Eviction-exempt hidden tabs stay mounted at any age (`pane-manager-registry.ts` notes a ~1.3 GB heap).
  - Nothing reacts to system memory pressure. Agent hibernation is idle-only and `experimentalAgentHibernation` defaults to false.
  - The window waits for proxy and plugin setup before opening (`main-process-ready.ts`). Measure it with `pnpm bench:startup` first.

## 2026-09-22: a quieter left sidebar

- **Removed on the owner's call:** the sidebar's Search, Floor and Agent grid rows, and the titlebar's Inbox · Floor · Code switch (`ModeSwitch.tsx` deleted). Inbox and Floor lost their default Ctrl+Shift+1/2 shortcuts, so nothing strands a user in a view that has no way back. Ctrl+Shift+3 (Code) and the worktree palette shortcut still work. The Inbox, Floor and Agent grid pages and store code are untouched; delete them in a separate pass if nobody misses them.
- **Dark sidebar is `var(--card)` (#171717), not #2a2a2a.** #2a2a2a made the sidebar the brightest surface in the app. Its luminance step over the canvas was about 2x Zed's and 4x Superset's, with the thinnest border of the group. The titlebar was already `--card`, so the left column now reads as one panel. Selected rows use `--secondary`. Light mode is unchanged, and was already in line with VS Code and Zed.
- **Verified in the dev app (dark theme, CDP DOM checks):** nav rows = Onboarding checklist, Tasks. No search row, no Mode switch, sidebar computed background rgb(23,23,23). The screenshot hung as usual on a hidden window.
- **The current workspace card has a 2px left bar** in `--terminal-pane-locate` (the app's "you are here" blue), via `::before` on `[data-worktree-card-active='primary']` in `main.css`. Verified in the dev app: 2px wide, blue, left -1px. The sidebar divider needed no change: 7% white over #171717 comes out about #272727, VS Code's #2B2B2B.

## 2026-09-22: per-provider model routing tiers for orchestration workers

- `kolux orchestration worker-start --tier major|deep|build|light` resolves to a model + effort from Settings > Agents > Model routing (`GlobalSettings.orchestrationRouting`, one table per provider). Contract and defaults: `src/shared/orchestration-routing-tiers.ts` (Claude: fable/opus/sonnet/haiku; Codex: gpt-5.6-sol/terra/terra/luna). Resolution: `orchestration/worker/worker-routing-tier.ts`, run in `workers.ts` before the local/federated split, so remotes only ever get plain model/effort.
- **Providers never mix** (owner decision): every worker-start, tiered or not, must use the coordinator's own agent. The coordinator's agent comes from the hook-fed fleet status snapshot; when no status has been reported yet the check can't prove a mismatch and lets the launch through (known ceiling).
- The coordinator guide (`skill-guides/orchestration/references/coordinator-loop.md`, regenerated into `src/cli/bundled-skill-guides.ts`) now tells coordinators to classify tasks into tiers and to do small tasks inline, since every worker pays the full startup context.
- Codex CLI 0.156 was installed on the owner's machine (`npm i -g @openai/codex`); it reuses the desktop app's ChatGPT login and reads Kolux's skills from `~/.agents/skills`. A one-word Fable probe cost ~$0.48 at API rates, almost all startup context — Fable belongs on coordination, not routine edits.
- Verified: `pnpm tc`, oxlint, 377 test files (orchestration RPC, CLI, settings) green; dev app over CDP shows the section, per-provider defaults, an edit persists as `orchestrationRouting.claude.build`, Reset removes it. **Not driven live:** a real `worker-start --tier` from a coordinator pane (unit/handler tests only).
- **Trap:** keep worktree names short. `G:/Dev/kolux-workspaces/kolux/orchestration-routing-tiers` pushed a node-gyp `.tlog` path past Windows' 260-char MAX_PATH and `pnpm install` failed rebuilding `@vscode/windows-process-tree` (FTK1011).
- Next idea (not built): per-provider "tactics" — Claude/Codex native subagents for small delegations inside one session (no startup cost), Kolux workers only for big isolated work.

## 2026-09-22: one worktree per agent, `pnpm ship` does the git work

- Agents no longer commit, merge or push. `pnpm ship` (`config/scripts/ship.mjs`) stages the worktree, has Claude Haiku write the message (`claude -p`, ~$0.002 per commit), commits, and pushes the branch; `pnpm ship --main` also lands it on GitHub main and fast-forwards the primary checkout. It merges (never rebases) when GitHub is ahead, and on any conflict it aborts and pushes nothing. Rule text is in AGENTS.md.
- **Trap:** `claude -p` must run with `--setting-sources '' --strict-mcp-config --disable-slash-commands --system-prompt …`. The owner's plugins, skills and MCP servers alone make a ~440K-token prompt, over Haiku's 200K window. `--bare` is not an option: it only accepts API-key auth and the owner signs in with OAuth.
- Worktree base for this project is `G:/Dev/kolux-workspaces`, set per project with `kolux project setup-update --worktree-base-path`. Kolux appends the repo name, so paths are `…/kolux/kolux/<name>`. The old location nested worktrees *inside* the primary checkout, where `git add -A` would have committed them as embedded repos.

## Current pass: the product is renamed Nightshift → Kolux

- Every mention was renamed by a case-preserving replace (nightshift→kolux, Nightshift→Kolux, NIGHTSHIFT→KOLUX), including 587 file paths, env vars, IPC/RPC names, the CLI (`kolux`), the protocol (`kolux://`), and the appId (`com.txais.kolux`). Only `LICENSE` keeps its original text.
- **2026-09-22: shipped as v0.10.0** (`kolux-windows-setup.exe`, published as Latest). The first release run failed in packaging because `cli/runtime/metadata.js` requires `pre-kolux-userdata-migration` and it was not in `asarUnpack`; the CLI's `ELECTRON_RUN_AS_NODE` loader cannot see into app.asar. Fixed, and `electron-builder-config.test.mjs` now fails when any main-process module the CLI imports is left packed.
- **The owner's machine was swapped to Kolux on 2026-09-22**: Nightshift closed, `%APPDATA%\kolux` (the stale test copy) moved aside, the Kolux installer removed Nightshift, then Kolux launched and carried the data forward. The script deleted the Nightshift leftovers (`%APPDATA%\nightshift`, `~/.nightshift`, `~/.nightshift-remote`, `%APPDATA%\nightshift-dev`, `%LOCALAPPDATA%\Nightshift`, `nightshift-updater`, `Programs\nightshift`) only after the carry-over marker appeared. Log: `%TEMP%\kolux-swap.log`.
  - **Second sweep, 2026-09-22:** removed the dead `~/.nightshift/agent-hooks/claude-hook.cmd` entries from `~/.codex/hooks.json` and `%APPDATA%\kolux\codex-runtime-home\home\hooks.json` (Kolux keeps foreign entries when it merges its own), the `NIGHTSHIFT_WORKSPACES_DIR` user env var and the dead `Programs\nightshift` PATH entry, the `nightshift-cli` / `nightshift-run` skills (replaced by `kolux-cli` and a ported `kolux-run`), `G:\Temp\nightshift-*`, the Nightshift shortcuts, and the old `G:\Dev\git-repos\nightshift` clone. Its two unpushed branches, `archive/pre-original` and `TxaisX/wip-pane-per-session-and-conpty-warmup`, now exist **only as local branches in this repo**.
  - Kept on purpose: `G:\Dev\nightshift-workspaces` is Kolux's `workspaceDir` and holds registered repos (`nightshift/` there is a clone of `TxaisX/kolux`); renaming it would orphan persisted paths.
  - **Follow-up for upgraders:** the migration sweeps old-named hook *files* but not Codex `hooks.json` *entries* that point into `~/.nightshift`. They are no-ops (`|| echo {}`), but each fires a failed command per event until removed.
- **2026-09-22: the GitHub repo is now `TxaisX/kolux`.** All 1,400 addresses and every release-feed repo name (`electron-builder.config.cjs`, `dev-app-update.yml`, the dev-channel names, the plugin marketplace) point at it. GitHub redirects the old address, which is what keeps already-installed 0.9.0 Nightshift builds updating. Version bumped to `0.10.0` — x-level, because the app name, the CLI command and the app identity all change.
- One-time migration so upgraders lose nothing:
  - `src/main/startup/pre-kolux-userdata-migration.ts` moves userData, `~/.nightshift` and marker files. It is hooked into preflight, koluxd and the CLI.
  - `legacy-persisted-key-migration.ts` covers JSON keys and enums.
  - `legacy-local-storage-prefix-migration.ts` covers renderer storage.
  - Repo-side fallbacks read `nightshift.yaml`, `.nightshift/` and `nightshift-plugin.json` when the new names are absent.
  - Agent installers sweep old-named hook files, so hooks don't run twice.
  - The migration runs only for a real `kolux` / `.kolux` root. It never runs for `kolux-dev` or E2E roots, and under vitest it is a no-op unless the caller passes `{ homeDir }`. This protects a developer machine that still runs the installed Nightshift.
- The Windows installer (`config/nsis/kolux-installer-hooks.nsh`, `customInit`) stops a running `Nightshift.exe` and runs the old app's `QuietUninstallString`. It is best-effort, never blocks the install, and keeps `%APPDATA%\Nightshift` so the first-launch migration can carry it over.
- Known consequences:
  - Embedded-browser site logins and macOS Keychain-protected secrets need one re-entry.
  - **Kolux cannot talk to an old Nightshift remote server, and an old client can't talk to a Kolux server.** The relay handshake frame type changed. Update both ends.
  - The old `nightshift` CLI launcher on mac/Linux is not removed automatically.
- New app icon: an aperture (six petals around a light point) replaces the moon in every size, the tray, the alt icons, and the in-app logo. The tray glyph is narrower, so check that `tray-dev-badge.ts`'s DEV stamp doesn't overlap it.
- Fixes the rename itself broke:
  - The updater's feed regexes had become `txaisx/kolux`, which would have silently ended updates.
  - The CLI bundle was missing the migration entry in `electron.vite.config.ts`.
  - Remote browser downloads still went to `.nightshift/`.
  - Mobile E2EE and grab-script fixture hashes.
  - About 60 tests whose fixtures paired `TxaisX` with `repo: 'kolux'`.
- **Verified 2026-09-21:**
  - A sandboxed dev launch (APPDATA / USERPROFILE / HOME redirected, pane env stripped) built and launched with title "Kolux", no "nightshift" text in the DOM, and the aperture logo.
  - A seeded legacy profile migrated, and `kolux --help` ran.
  - CDP screenshots hang on windowless launches, so the checks were made on the DOM.
- **Test isolation.** `config/scripts/vitest-agent-session-env-isolation.ts` runs first in every test file. It strips inherited `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `NIGHTSHIFT_*` and `KOLUX_*`, and points HOME/USERPROFILE at a throwaway dir (keeping `GIT_CONFIG_GLOBAL`).
  - Before this, a suite run from inside a Claude Code / Nightshift pane wrote into the developer's real `~/.claude/settings.json` (hook commands pointing at deleted temp dirs; this predates the rename, since the Sep 11 backup has the same damage), `~/.nightshift` / `~/.kolux` (keybindings.json, tmux shim, kimi-hook.sh) and `~/.codex`.
  - On 2026-09-21 the unguarded migration also moved the owner's live Nightshift profile into `%APPDATA%\kolux` and `~/.kolux`. All 257 files were copied back and the Claude hooks were restored.
  - **Leftover:** `%APPDATA%\kolux` still holds the stale moved copy, because the running Nightshift keeps a log open in it. Rename it aside after Nightshift next restarts and **before installing Kolux on this machine**, or the migration's no-clobber rule will keep the stale copy. `~/.kolux*.accidental-test-copy-20260921` can be deleted once nothing is missing.
- **Round 2 (2026-09-21), fixing the reds that predate the rename:** the full suite went from 1,060 failing tests in 343 files to about 200 in 50. Each fix targeted the root cause.
  - Real code bugs fixed:
    - A leaked journal SQLite handle in `structured-agent-session-settlement-retry.ts`; behind about 14 EBUSY reds.
    - A daemon respawn race in `withDaemonRetry`.
    - Monaco silently rewriting LF→CRLF.
    - The CLI child-PATH delimiter ignoring its platform seam.
    - POSIX socket and Wayland paths built with the host `join`.
    - A UTF-8 truncation boundary in the delta coalescer.
    - WSL home UNC-forcing.
    - The plugin kill-list guard placement.
    - A dotless-IP bypass in the local-network check.
    - Windows `openSync` accepting a directory in the rotating log writer.
    - A git-diff header dequoting bug on Windows.
    - Stale node-pty patch hashes.
  - Stale tests were updated to intended behavior:
    - "Opus by default" (0cbb68f2).
    - The orchestration pane-binding rule.
    - `githubRepoIdentityKey` intentionally lowercases.
    - Several `Txais`→`TxaisX` typos.
  - Windows-only capability gaps are `skipIf(win32)` with a WHY comment: symlinks without Developer Mode, `/bin/sh`, chmod bits, and OpenSSH. CRLF source reads normalize line endings.
  - Deleted as obsolete:
    - 30 CI contract tests plus `config/scripts/pr-code-change-scope.mjs`, whose workflows, actions and scripts were removed at the fork split.
    - 4 `tests/e2e/cross-version-wire` lanes pinned to upstream releases (v1.4.184, v1.4.190, fd9125ea8c) that are not in this repo's history. `remote-wire.cross-version-terminal-journey` is now a registered `protection: none` gap in `config/reliability-gates.jsonc`.
    - A handful of test cases for features that never existed (Discord/X help links) or that moved.
  - The vitest setup also removes globals a file added once it finishes, so a node test's leaked `globalThis.window` can't poison the next happy-dom file on the same fork worker.
- **Still red:**
  - About 43 happy-dom renderer files fail with `document/window is not defined` only deep into a full run. They pass alone, in a 958-file happy-dom batch, and in mixed batches. The cause is fork-worker global corruption that couldn't be reproduced below full-suite scale, and `pool: 'vmForks'` fixes it but breaks `vi.mock('node:…')` in 337 files.
  - (Fixed 2026-09-24, see "CI on main is green again": `plugin-launch-content` and `config-toml-trust-hash`.)
  - `claude-stream-json-connection` shows an occasional EPERM under load.

## Previous pass: Codex access, account authorization, and automatic updates

- Codex is already a supported detected agent and launches into the active workspace panes. The launcher and agent-picker now expose a target-aware `Refresh agents` action so a newly installed Codex CLI becomes available without restarting Kolux.
- Managed Codex login now forces file-backed credentials per account (`cli_auth_credentials_store="file"`), uses the provider's browser authorization flow, waits for a usable identity in `auth.json`, and rejects an empty/missing credential instead of saving a broken account. Claude managed login uses the same piped browser-login approach while preserving its existing credential capture.
- Settings > Agents now provides provider-aware sign-in guidance. Codex and Claude account panels explain that `Add Account` opens browser authorization and only save after successful authorization. The Codex status-bar switcher recommends another account only when its cached usage is fresh, successful, host/runtime-matched, and tied to a different identity.
- The updater checks every 15 minutes while packaged and online, retries after connectivity returns, keeps available/downloading/downloaded state intact, and the release workflow keeps a GitHub release draft until the installer, manifest, and blockmap are present. The existing sidebar update control remains the bottom-left download/restart entry point.
- Merged into `main` on 2026-09-20 from `ns/sessions-as-panes` (a branch cut from 0.5.0). Its 0.5.0-base launcher rewrite (`3d23a6ea`, `launch-agents-into-workspace.ts`, the `launch-agent-counts.ts` rename) was dropped again, same as on 2026-09-16; only the `Refresh agents` button was ported onto 0.7.0's New session launcher.
- Verified 2026-09-20 before commit: `pnpm tc` clean, oxlint clean on every changed file, and all 23 changed/new test files pass (385 tests). Two real bugs fixed at that point: `updater-events.ts` kept its own 24-hour copy of the check interval, so after the first successful check the next one waited a day instead of 15 minutes (now imports the shared constants); and the new "no background check while an update is available" guard also blocked the hourly fallback retry that moves a user off a stand-in (prerelease or last-good) release, so timer retries now pass `allowWhileAvailable`. Still red and pre-existing: `updater-changelog` and `updater-nudge` fetch tests (7 + 3) expect data that `FORK_NO_PHONE_HOME` has disabled since the fork; the account suite's Windows/WSL fixture and symlink reds. Not verified: the draft-then-publish release workflow (needs a real tag push) and a real browser sign-in in an installed build.

## What this is

Kolux is an original Windows-first desktop app for running several AI coding-agent
CLIs in parallel, each in its own git worktree, with terminals, an editor, a browser and
diff review in one window.

It began as a fork of another project and no longer is one. On 2026-09-10 the fork was
severed: the rename machinery and the two-branch model were deleted, ~2,300 lines across
383 files were de-branded, the GitHub repository was recreated so it carries no "forked
from" banner, and history was squashed to a single root commit. `main` is now an ordinary
hand-edited branch: edit it directly, and push to `origin` only. `main` is the sole branch
on GitHub, and the `upstream` remote is gone.

The local `base` and `archive/pre-original` branches still exist, but they are **archives of
the old history, not part of the workflow**. Nothing is generated from them any more.

**Do not reintroduce the old branding, and do not look for an upstream to sync from.**
The former upstream's history survives only in local refs (`base`, `archive/pre-original`,
tags `pre-original-*`) and a bundle under `G:\Dev\backups`. Nothing prunes those unless
asked.

`LICENSE` keeps its original copyright line. MIT requires that notice to travel with the
code, so removing it would make every build infringing. It is not user-visible. Leave it.

## Versioning

Versions stay within `0.x.y` while the product is being built. **Never move to `1.0.0`**
until the owner says so. Pick x or y from what the release changes, and state the reason in
the version-bump commit message (for example "0.2.0 — x: adds the orchestration panel").

| Bump | When | Examples |
|---|---|---|
| **x** → `0.X.0` (y resets to 0) | Users can do something new, or must change how they work | a new feature, screen or workflow; removing or reworking existing behavior; settings or saved data that older versions can't read |
| **y** → `0.x.Y` | Existing behavior gets better, nothing new to learn | bug fixes, performance, visual or wording polish, security patches, dependency updates |
| none | Nothing a user would notice | docs, tests, CI, internal refactors with no behavior change |

If a release contains both kinds, the larger one wins: any x-level change makes it x.
`0.1.0` was x: it is the first release and adds automatic updates.

## Releasing and auto-update

The installed app checks GitHub Releases on `TxaisX/kolux` once a day. The update button
in the sidebar footer (`SidebarUpdateButton.tsx`, between Help and "Reveal active workspace")
walks the same flow by hand: Check for updates → Update to vX → Downloading % → Restart to
update. Any check that finds a newer release starts the download itself, so the card jumps
straight to Downloading % → Restart to update; the only click left is Restart. It only reflects `updateStatus`, so the updater never runs in `pnpm dev` and the button
stays on "Check for updates" there. To ship a release:

1. Bump `version` in `package.json` (for example `0.1.0` → `0.1.1`) and commit it to `main`.
2. `git tag v0.1.1 && git push origin main v0.1.1`.
3. `.github/workflows/release.yml` builds the Windows installer and publishes the release.
   It fails fast if the tag and `package.json` disagree.

Releases are **unsigned**. Stable Windows builds only carry the SignPath `publisherName` when
`KOLUX_WIN_SIGNPATH=1`, because an installed app with a publisherName rejects every
unsigned update. Builds made before 2026-09-14 do carry it, so they need one manual install
of a newer release; after that, updates are automatic. Mac and Linux are not released.

## Recent work, and why

- **One session per pane, the "+" out of the strip, and sessions back in the sidebar
  (2026-09-17).** Three independent changes on the owner's call that the tab strip should stop
  implying multiple tabs per pane.
  - **No "+" beside a tab.** The create menu moved out of `tab-bar-surface.tsx` into
    `tab-bar/tab-bar-create-menu.tsx`, with `TabBarCreateMenuButton` mounting it standalone.
    `TabBar` gained `hideCreateMenu` (default false) and `TabGroupPanel` passes it, so pane
    strips render the tab alone. **Trap that cost a rebuild:** the replacement was first mounted
    in the titlebar, which does not work — the Code view has no full-width titlebar, so neither
    `#titlebar-tabs` nor the added `#titlebar-new-tab` renders while panes are on screen, and
    the app ended up with *zero* "+" anywhere. It now lives in the focused pane's action cluster
    beside Quick Commands and the pane-count stepper, gated on `isFocused` so exactly one shows
    and it follows focus. The titlebar plumbing is still in the tree and inert in Code view;
    delete it when someone is next in there. `aria-label="New tab"` is preserved because nine
    E2E specs locate the control by it. **Those nine specs have not been run** — they build
    two-tab groups as setup, which no longer happens, so treat them as unverified.
  - **Enforcement is UI-only by choice.** Nothing in the interface builds a two-tab pane, but the
    store still can, so dragging a tab onto another pane still merges. Do not "fix" that without
    asking; it is the deliberate escape hatch.
  - **Sidebar session rows are back**, reversing `124ee74b` two days after it landed. That commit
    cut them because the list "restated what the count badge already said" — true while the strip
    listed sessions, false once the strip's "+" went away and nothing else names them. Restored
    `WorktreeCardSessions` from `124ee74b^` rather than rewritten; `WorktreeCardAgents` stays
    dead (older, twice superseded, and keys off paneKeys instead of tab ids). No persisted state
    changed: `'inline-agents'` was still defaulted and the `normalize-loaded-ui-state` one-shot
    migration already backfills it.
  - **The Windows daemon host no longer copies on the spawn path.** `materializeRelocatedDaemonHost`
    is async over `fs/promises.cp` with a single-flight guard, and `launchDesktopMode` pre-warms
    it unawaited once the first window exists. It used to be a serial `cpSync` loop over 439
    files (~273MB) that froze the main process on the first terminal after every version change.
  - **The ~30s "Claude takes forever to open" is not an app bug.** Measured on the owner's machine:
    PowerShell starts in 0.3s, the `claude` binary in 0.05s, the daemon-host copy in 1.7s — and
    `claude mcp list` takes **19.9s** against the 20 MCP servers configured globally. The startup
    cost is the CLI dialling those servers, so it is a config problem, not a Kolux one. Do
    not go looking for it in the spawn path again. `DAEMON_RECOVERY_BUDGET_MS` (32s) is also not
    it: that only engages for a wedged daemon handoff.

- **The 0.5.0 launcher rewrite was dropped in favour of 0.7.0's (2026-09-16).** A branch built
  on the 0.5.0 base rewrote `LaunchAgentsDialog` to open one pane per session via
  `launch-agents-into-workspace.ts`, and renamed `launch-agents-requests.ts` to
  `launch-agent-counts.ts`. 0.7.0's `runSharedCheckoutLaunch` already does that job and does it
  better: it pre-trusts the checkout per agent, carries per-seat models through
  `settingsWithSeatModel`, reuses an empty root group, and keeps New worktree as an opt-in. The
  rewrite was skipped whole rather than merged — its rename also deleted `settingsWithSeatModel`,
  which 0.7.0's own launch path imports. **Still open from it:** `runSharedCheckoutLaunch` hardcodes
  `isRemote: false`, `CLIENT_PLATFORM` and `resolveLocalWindowsAgentStartupShell`, so a
  shared-checkout wave assumes a local host — the dropped version routed through
  `launchAgentInNewTab`, which resolves the execution host and so worked on SSH and folder
  workspaces. Worth porting that routing before anyone launches a wave on a remote workspace.

- **Sessions are panes in the main window again (2026-09-15, 0.7.0).** The 0.6.0
  one-window-per-terminal model is off the user's path. The in-window workbench
  (`components/Terminal.tsx`, `TerminalWorkbenchContainer.tsx`, the Inbox · Floor · Code shell,
  the workspace composer, the pane count `− N +` stepper and Layout presets) is mounted in
  `AppWorkspaceShell` exactly as in 0.5.0, restored from the pre-0.6.0 tree. On top of 0.5.0:
  - The New session launcher defaults to **Shared checkout** ("sessions of a project"); New
    worktree is the opt-in. `runSharedCheckoutLaunch` pre-trusts the checkout once per agent in
    the wave (`preflightAgentTrust`, before any tab exists), gives every seat its own tab group
    (the first seat reuses an empty root group), regrids with `regridToCurrentLeaves` and reveals
    the workspace. Seats land in the active workspace when it belongs to the project, else in the
    project's own checkout.
  - A sidebar session row activates its workspace and tab in the main window
    (`activateAndRevealWorktree` + `activateTabAndFocusPane`).
  - Inbox and Floor are sidebar nav rows as well, because the Code view has no full-width
    titlebar and therefore no ModeSwitch; the titlebar switch still shows on Inbox and Floor.
  - The OS terminal-window code (`main/window/terminal-session-window*`, `ipc/terminal-windows.ts`,
    `renderer/terminal-window.tsx`, `components/terminal-window/`) stays in the tree but nothing
    opens it: the renderer callers are gone and the startup restore call was removed. Pty
    delivery already falls back to the main window when no window owns a pty
    (`resolvePtyDeliveryWindow`), so no transport change was needed.
  Verified in the dev app over CDP (`.tmp/verify-grid.mjs` pattern: `window.__store`,
  `openModal('launch-agents')`, click the seat pill, Launch): Launch 2 → two Claude panes in the
  grid and `terminalWindows:list` empty; typing into a pane reached the pty and hook status
  arrived; a second Launch 2 gave a 2x2 grid and both new seats started without the trust prompt;
  Inbox and Floor open from the sidebar, Code returns from the titlebar switch, and the four
  terminals stayed mounted meanwhile.
  Pre-existing failure left alone: `app-startup-routing.test.ts` "#9002" expects a one-line
  `addEventListener` that prettier wrapped in `use-app-session-persistence.ts`.
  `agent-launch-routing-caller-census` now pins `HandoffPanel.tsx`, which called
  `launchAgentInNewTab` unpinned.
- **Superseded by 0.7.0 above. Terminal windows actually attach now (2026-09-15).** Commit `097edc5b` opened one
  window per terminal but none worked at runtime. Four causes, each found by running the app:
  worktree ids are `<repoId>::<path>`, so the key validator rejected every real id (keys now
  split on the last `::`, and only the tab id may not contain it); the window URL never carried
  the pty id (main now falls back to the tab's persisted pty); the window root had no
  `TooltipProvider`, so the pane header crashed on first render; and
  `terminalPreview:*` only admitted the main window and the dashboard pop-out. A terminal window
  is now admitted only for the one pty it was opened on
  (`isTerminalSessionWindowRendererForPty`). Restore waits for the daemon and reopens only tabs
  whose pty `listLiveDaemonPtyIds()` still reports; if the inventory is unavailable it reopens
  none, rather than empty windows. Verified: restored Claude sessions render live output in
  their own windows.
- **Found updates download themselves (2026-09-15).** `updater-events.ts` calls
  `downloadUpdate()` right after broadcasting `available`, background or manual, so the only
  click left is Restart. Skipped for local builds, pinned dev jumps, externally managed Linux
  packages, and serve hosts (`updater-setup.ts` gates on interactive install mode, because a
  paired client drives a server's download and expects to see `available` first). Check cadence
  is unchanged (launch, daily, wake/focus after a day). Test: `updater.startup-scheduling.test.ts`
  "downloads an update found by a background check without a click". `updater-changelog.test.ts`
  and `updater-nudge.test.ts` fail on this branch before and after; their `net.fetch` mock
  returns null and is unrelated.
- **Every new session gets its own pane (2026-09-16, `8a19ef2a`, `d1d386e6`).** Owner's call: the tab
  strip's "+" used to stack New Terminal / Choose agent… / agent quick-launches as tabs in
  one strip, hiding every session but one. `pane-layout/split-pane-for-new-session.ts` is the
  one helper: split a fresh group to the right of the source, regrid to a balanced grid
  (`regridToCurrentLeaves` moved here from `usePaneCountCommand.ts`), return the group to
  create in, or the source group when nothing can be split. It is called at every
  new-session entry point: the store's `openNewTerminalTabInActiveWorkspace` (tab-strip "+",
  titlebar "+", Cmd/Ctrl+J), `newTerminalWithShell`, the tab-bar agent quick-launch menu and
  `QuickLaunchButton`, and the global `handleNewTab` / `handleNewAgentTab` /
  `handleNewAgentChoiceTab`. Deliberately not split: browser, markdown and simulator tabs,
  "Split Terminal Right" (already splits), restore/sync/adoption paths, and the launch funnel
  `launchAgentInNewTab` itself (continuation and recovery launches choose their group on
  purpose). `resolvePendingAgentChoice` now launches into the placeholder's own group and
  closes the placeholder afterwards, so the picked agent stays in the pane it was chosen for;
  `use-terminal-create-actions.ts` delegates to it instead of carrying a copy. Trap: the
  helper's Tidy broadcast is guarded on `typeof window.dispatchEvent === 'function'` because
  store-level tests stub `window` with only `api`. Runtime-verified 2026-09-16 in this tree's
  dev app by clicking the real "+" control (`aria-label="New tab"`, use the `:visible` match:
  hidden workspace surfaces stay mounted with their own "+") in a fresh folder workspace: New
  Terminal took it from 1 pane to 2, Choose agent… to 3, one tab per pane, the picker pane
  pending, and the shells spawned. Activating a workspace from a script with
  `setActiveWorktree` does not mount the pane surface; the Add Project flow does.
- **Add Project opens only the picked folder (2026-09-16, `1da4acc7`).** Picking or dropping
  a folder used to scan it for the git repositories inside and stop at a "review nested
  repos" step that imported each one as its own project. Owner's call: only the selected
  folder. `useAddRepoLocalFolderFlow` and `useAddRepoServerPathFlow` now go straight to
  `addRepoPath`: a git repo opens as a project, anything else goes to the existing "Open as
  Folder" confirmation and becomes one folder workspace. The nested-review step, its store
  actions and the main-process scan/import IPC are untouched and still reachable from the SSH
  "remote path" flow (`useRemoteRepo` in `AddRepoSteps.tsx`) and the runtime RPC; nothing
  local reaches them any more. Runtime-verified the same day: dropping a non-git parent holding
  two git repos on Add Project went straight to "Open as Folder", and the store then held one
  `kind: 'folder'` repo for the parent and none for the children.

- **Terminals could not open during a child-worktree removal (2026-09-16, `8be599aa`).**
  Symptom: launching Claude tabs in the root workspace while a child worktree was being deleted
  left the panes blank; the trace shows `terminal_pane_recovery_remount` /
  `spawn-left-pane-unbound` three times per tab at 15s, then the 5-minute recovery cap.
  Cause: `watcher-removal-gate.ts` fenced any PTY spawn whose root *enclosed* the removal root,
  and child worktrees live inside the root worktree's folder, so every root-workspace spawn was
  refused for the whole removal (40s+ when `git worktree remove` stalls on EBUSY). The renderer
  swallows that fence as "doomed pane" and remount-loops. Fix: `beginTerminalInstall` now fences
  only spawns *inside-or-equal* the removal root; `beginWatcherInstall` keeps both directions
  (a recursive watcher on the parent holds handles inside the child). Needs a `0.5.1` release to
  reach the installed app. Left alone: the renderer's remount loop on a fenced pane.
- **Darker Code work area (2026-09-15).** Two parts. `--workbench-surface`
  (`main.css`, mapped for Tailwind) paints the tab-group body, splits and empty panes one
  step below the chrome. The default dark terminal theme is now `Kolux Dark`
  (`#0d0d0d`, `lib/terminal-themes/defaults.ts`); Ghostty's `#282c34` was the lightest
  surface on screen. Profiles that still hold the old default on disk move once through
  `terminalThemeDarkDefaultedToKolux` (`shared/terminal-theme-default-migration.ts`,
  applied in `prepare-loaded-profile-settings.ts`); a theme the user picked is never touched,
  and any later change from Settings sets the guard. Also fixed in passing: `--editor-surface`
  was never registered in the `@theme` block, so eleven `bg-editor-surface` call sites
  (diff panes, artifact and activity previews) painted nothing; they now paint as written.
- **Three-mode shell (2026-09-14).** The renderer now has Inbox · Floor · Code as top-level
  modes with a switch in the title bar (`app-shell/ModeSwitch.tsx`) and `Ctrl+Shift+1/2/3`.
  Why and what: `docs/redesign/three-mode-shell.md`; the clickable spec is
  `docs/redesign/prototype/three-mode-prototype.html`. What landed in this pass:
  - `inbox` and `floor` views on `TopLevelView`; Code is the existing `terminal` view.
  - **Inbox** (`components/inbox/`): needs-you / waiting / done items derived from
    `agentStatusByPaneKey` with the sidebar's freshness and decay rules; question and
    approval cards reuse `native-chat` and send answers to the agent's pty. That send path
    runs outside its usual chat-pane host and is **not runtime-verified**.
  - **Floor** (`components/floor/`): lanes per agent grouped by host, segments from
    `stateHistory`, 15m / 60m / today axis, workers nested under their dispatcher. Runs,
    tasks and mailboxes have no renderer IPC yet (`// ponytail:` in `FloorRunPanel.tsx`).
  - **Pane count** (`components/tab-group/PaneCountStepper.tsx`, `usePaneCountCommand.ts`,
    `pane-layout/pane-count-plan.ts`): `− N +` in the focused pane's toolbar, 1 to 9; growing
    adds agent-picker panes, shrinking never closes a pane with more than one tab or a live
    agent and reports where it stopped.
  - **Usage** (`components/usage/`): a dialog from the status bar roster item "Usage
    details & history" (`openModal('usage')`) listing every rate-limit provider's windows,
    reset countdowns, today's tokens and recent sessions.
  - **Per-workspace handoff** (`components/right-sidebar/handoff/`, `main/workspace-handoff/`,
    `workspaceHandoff:get/set` IPC): one document per workspace keyed by host + path, stored
    in userData so folder and SSH workspaces get one without touching the remote. "Hand to
    agent…" launches the chosen agent in the same workspace with the document as its prompt.
  - `Mod+Shift+<digit>` chords now match on every platform (`keybindings/matching-key.ts`):
    Shift+2 reports "@", so the digit binding falls back to the physical `Digit2` code. This
    also fixes the older `Mod+Shift+0` binding on macOS.
  Not done yet from the design doc: Launch agents without shape presets, readable
  transcript as the default pane view, Ctrl+K session palette, Floor from the orchestration
  run log.

- **Workspace composer** (`components/composer/`, mounted under the panes in
  `TerminalWorktreeSplitSurface`). One message box per workspace with two chips: an
  **agent picker** listing the running agents in that workspace (targets come from
  `deriveNotesSendAgentTargets`, so a freshly launched CLI appears once its title says it is
  ready) and a **YOLO** chip that stores `agentPermissionModeByWorktree` and is applied by
  `resolveWorktreeAgentLaunchArgs` on the next launch in that workspace. Sends go through
  `sendBracketedPasteToRunningAgent`; Enter sends, Shift+Enter is a newline, Escape hands
  focus back to the terminal, and the box is disabled until a target is eligible. Verified in
  the dev app on Windows: Claude launched with `--dangerously-skip-permissions`, the chip
  listed it once Claude's "✳" title arrived, a sent prompt reached it (title flipped to "◐"
  then back to "✳"), and no keystrokes leaked to the terminal. Traps: Claude's one-time
  "bypass permissions" acceptance prompt does not set a title, so the composer stays
  disabled until it is answered in the pane; the YOLO chip cannot switch a running agent,
  only the next launch; agent panes use the canvas renderer, so `.xterm-rows` is empty for
  them under CDP and the runtime pane title is the only readable signal.

- **Launch a wave of up to 6 agents.** Landing's primary button is "Launch agents"; with no
  local git repo it opens the folder picker first. A plain folder gets "Make it a git repo"
  (`repos:initGit`: `git init` + empty commit, never stages user files; local only), which
  continues into the launch dialog. The dialog lists git repos only, picks a count from a 2x3
  grid of squares (cap `LAUNCH_AGENTS_MAX = 6`, also enforced in the request builder), an
  agent and a catalog model (sent as `sessionOptions.model` -> `--model`). Every session's
  prompt starts with `CONTEXT7_AUDIT_BRIEF`. After launch the app switches to the new
  `agent-grid` top-level view (also in the sidebar nav): up to 6 live terminals tiled 3x2,
  font 14/12/11px for 1-2/3-4/5-6 agents, ptyId resolved via `useLiveDashboardSnapshot`.
  Verified over CDP: button, 2x3 squares (75px, 2 rows x 3 cols), model select, Launch N
  enabling, grid page empty state. Not driven: the native folder picker and the git-init click.
- **Live 6-agent test (2026-09-14, throwaway repo, Haiku).** Worked: `repos:initGit` from the
  page (one empty commit, zero files tracked); 6 worktrees on 6 separate branches; 6
  `claude.exe` processes all carrying `--model haiku`; 5 grid tiles in a 3-wide layout at
  516x403; each agent read README and named its own worktree; no files changed anywhere.
  **Broken, found by the test:**
  1. *Trust prompt blocks every agent.* Each Claude session stopped on "Do you trust this
     folder?" although `.claude.json` held `hasTrustDialogAccepted: true` for its path
     (written before spawn, `worktree-remote.ts:443`). Slash style is not the cause: accepting
     trust wrote no new key. Suspect six concurrent `claude` startups rewriting `.claude.json`
     (the preset has a `ponytail:` note about exactly this race). Unproven.
  2. *Launch leaves the grid.* `revealPendingCreation` forces `setActiveView('terminal')` per
     creation; something at completion pulls the view back off `agent-grid`.
  3. *Sixth tile missing.* The worktree the app activated (`needlefish`) never appears in the
     grid; `selectAgentGridCards` needs a card with a live `ptyId` for it.
  4. *Branch names come from the audit brief.* First-message rename named branches
     `audit-docs-before-reporting`, `audit-apis-with-context7`, … because
     `CONTEXT7_AUDIT_BRIEF` is the start of every prompt. Put the task first or exclude the
     brief from naming.
  The project `fleet` points at a deleted folder (`G:\Dev\git-repos\fleet`); launching into it
  fails as "No base branch found", which misdescribes a missing directory.
- **Fixes after the live test (uncommitted as of writing).**
  - *Per-agent model + handoff.* Picking a count creates one row per agent (`LaunchAgentSlots`,
    `resizeLaunchSlots`); each row has its own agent and model. Every prompt is
    `task + <kolux-launch-brief>…</kolux-launch-brief>` (`src/shared/launch-agent-brief.ts`):
    role brief, stay-in-your-worktree, keep `.kolux/handoffs/<worktree>.md` of every file
    added/updated/removed, and the context7 audit.
  - *Bug 4 fixed.* `first-work-branch-rename.ts` strips the brief before naming; brief-only
    prompts never rename.
  - *Bugs 2 and 3 fixed (one cause).* `beginPendingWorktreeCreation` gave every concurrent
    creation the single `activePendingCreationId`, and the `activeView === 'terminal' &&
    activePendingCreationId === null` completion fallback then activated an arbitrary sibling. That
    pulled the view off the grid, and the activation gate lost a pty race, leaving that worktree's
    card with `ptyId === null`. Requests now carry `revealOnStart: false`, which skips view/pending
    claims and completion activation. **That alone did not hold live:** main's
    `spawnLocalStartupAndSetupTerminals` calls `createTerminal({ activate: true })`
    (`worktree-remote.ts:459`), and the renderer turns that into `activateTerminalInitiatedWorktree`,
    which pulls the view off the grid independently. Dropping `startup` for background launches kept
    the grid but started **no agents**: the renderer fallback only queues the command, and a PTY
    spawns only when a pane mounts, which the grid never does. Final fix: an optional
    `focusStartupTerminal: false` on `CreateWorktreeArgs` → `createTerminal({ activate: false,
    surfaceOwner: false })`. The runtime RPC path reuses its existing `activate` field. The PTY
    still registers in `ptyIdsByTabId` without a mounted pane, so tiles get live terminals.
  - *Sixth worktree failing (found in the live retest).* Six `git worktree add` runs plus
    `branch.<b>.base` writes on one repo collided on `.git/config` ("could not lock config file",
    "Permission denied"). `addWorktree` now serializes per repo via `runKeyedSerializedOperation`,
    keyed on `wslDistro + resolve(repoPath)`; different repos still run in parallel.
  - **Live verification, final (2026-09-14, throwaway repo, rows opus/opus/sonnet/sonnet/haiku/haiku):**
    view stayed on `agent-grid` throughout; 6 worktrees, 6 grid tiles; no trust prompt anywhere; six
    `claude.exe` with matching `--model`; every agent wrote `count.txt` and
    `.kolux/handoffs/<worktree>.md`, and nothing else changed; branches renamed from the task
    (`count-readme-lines`, `-2`…`-6`). One Haiku/Sonnet-class answer was wrong (5 vs 4): model
    quality, not app.
  - "Make it a git repo" verified live on the merged branch (`95356b57`, 2026-09-14). Opening
    `confirm-non-git-folder` through `window.__store` on a plain folder containing `notes.txt`
    and clicking the button added the project as `kind: git`, set it active, and landed on
    `launch-agents` with it selected. It made one empty "Initial commit": zero files in the
    commit, zero tracked, `notes.txt` untouched and untracked. Still not driven: the native folder
    picker itself (not automatable).
  - Pre-existing: 5 failures in `worktree-creation-flow.test.ts`, identical on commit `b0ec17bc`.
  - *Bug 1: root cause found, fix not yet runtime-verified.* **On Windows Claude looks up trust
    only under forward-slash keys.** Its `d1()` runs `path.normalize` and then replaces `\` with
    `/`; `Dqe()` keys the project on the main repo root, and the fallback walk checks the worktree
    folder, both through `d1()` (Claude Code 2.1.270 bundle). Kolux wrote `G:\Dev\…`, which is
    never read. Proven live: six `hasTrustDialogAccepted: true` backslash entries still prompted,
    and accepting the prompt wrote `G:/…/six-agent-retest`, the forward-slash main repo root. Every
    "green" earlier fix wrote the wrong key. Fix: `toClaudeProjectKey()` in `claude-trust-preset.ts`
    (forward slashes on win32 only). Also kept: the wave pre-trust (`agentTrust:preTrustWorktrees`,
    one write before any spawn, called from LaunchAgentsDialog), the 250 ms batch for per-spawn
    marks, and a Claude branch in the CLI/runtime create path, which previously had none.
    Parent-directory trust cannot work: Claude's walk stops at the nearest `.git`, and every
    worktree has its own `.git` file. Stale backslash entries in `.claude.json` are harmless.
  - A test once wrote temp entries into the real `.claude.json`; they were removed and the test now
    clears `CLAUDE_CONFIG_DIR`. Any new test touching Claude config must do the same.
- **Git repos as the default way to hold a project (2026-09-14).** Four features plus
  security/review fixes, merged at `80d5dd72`:
  - *Clone first.* Add repo's hero card on local hosts is "Clone from URL"; Browse folder moved
    under "Other ways to add" (SSH ordering unchanged). `addRepo()` now opens that dialog and
    resolves `Repo | null` only after it closes (`resolveAddRepoDialogRequest`, settled in a
    `finally`). **If another modal is already open it falls back to the native picker**, because
    modal state is single-slot and swapping would wipe Launch Agents' draft.
  - *Unpushed badge.* `worktrees:unpushedStatus` + a renderer registry (150 ms debounce, 60 s
    visible interval, focus refresh) → amber "↑N unpushed" / "Unpublished" on git worktree
    cards. Paths are resolved against the repo's own worktree list; SSH failures read
    `unverifiable`, never synced.
  - *Folder → git → publish.* Context menu "Make it a git repo" (`repos:convertFolderToGit`)
    keeps the **empty** first commit on purpose: these can be personal folders (Documents).
    Committing files is an opt-in second step with a full-tree secret/large-file scan
    (display list capped, scan is not) and a default `.gitignore`. "Publish to remote…" needs
    `confirmed: true`, defaults GitHub to private, rejects URLs with embedded credentials, and
    rolls back `origin` on failure (never deletes a created GitHub repo). Local hosts only.
  - *Overlap CLI.* `kolux worktree changes|overlap --json` (read-only; merge-tree prediction
    on committed tips only). A non-authoritative sibling scan sets `siblingsUnverifiable`; one
    failing sibling degrades alone. Skill guides tell agents to run it before editing.
  - **Verified in a running app (hidden instance, CDP):** Clone-first hero + focus, both badges,
    conversion + commit preview flagging `id_ed25519` and gating on acknowledgement, publish
    dialog counts and credential-URL rejection, Launch Agents keeping its draft (via store call;
    the native picker can't be driven). Not driven: an actual publish to GitHub.
  - **Bugs the runtime check found (fixed after, tests only):** a race where the background folder
    watcher upgrades the record before `convertFolderToGit` does, so the handler saw 'blocked',
    deleted `.git` and stranded a git-kind record (now it succeeds if the record is already git);
    and the follow-up dialog had "Commit files…" as primary instead of "Done".
  - **Traps from building it:** fresh `git worktree add` copies can't compile native modules in
    this sandbox, so use `pnpm install --ignore-scripts` and run `node node_modules/vitest/vitest.mjs
    run --config config/vitest.config.ts`, `node config/scripts/run-typecheck-projects-in-parallel.mjs`
    and `node node_modules/oxlint/bin/oxlint` directly. Harness-isolated worktrees can start from a
    stale commit or be auto-removed when unchanged; check `git log -1` first. When two sessions share
    this checkout, build in separate worktrees and merge only after the other session commits.
- **Agent picker.** A pane can now exist without spawning a shell. "Choose agent…" in the
  `+` menu opens a pane whose whole body is a picker of the agent CLIs detected on this
  machine; nothing starts until one is chosen. Verified end to end in a running app.
- **Launch shapes.** The Launch agents dialog offers Solo, Pair, Workbench and Swarm. Each
  session gets a distinct role prefixed to the shared prompt, and a lineup shows which
  agent takes which role before anything is created. Previously every session received an
  identical prompt and did identical work.
- **Sidebar session badges.** Each workspace row shows how many sessions are live, hidden
  entirely at zero. Per-session status dots already existed and were reused.
- **Tidy.** A workspace holds two independent split trees: the tab-group tree, and the
  panes inside each tab created by "Split Terminal Right". Tidy originally evened only the
  first, which is the one users rarely split, so it appeared to do nothing. It now evens
  both by broadcasting a window event that each tab responds to.
- **Performance.** Every agent hook event used to rebuild a status snapshot for every open
  pane. Agents emit these several times a second each, so this was thousands of short-lived
  objects per second on the main thread. Listeners are now notified only when something
  they read changes, with a five-minute heartbeat so a long run cannot starve the
  keep-awake timer. Also: locale collators are built once per sort instead of once per
  comparison, and a background service that served a removed UI no longer starts.

## What is verified, and what is not

Verified by driving the running app, not only by tests: the agent picker end to end, the
sidebar session badge, the launch dialog lineup, and Tidy (pane widths went from
312/312/636 to 418/418/423).

Not verified at runtime: layout presets, and whether the agent dashboard populates under
load.

Three-mode shell, verified by driving the dev app over CDP on 2026-09-14: the switch renders
with its shortcut chips, clicking Inbox mounts the empty state ("Nothing needs you right
now"), clicking Floor mounts the header, legend and range toggle, Code returns to the
workspace landing, and no renderer errors were logged. Not verified at runtime: the
keyboard chords (Electron routes shortcuts in the main process, and neither the new chords
nor the pre-existing Ctrl+Shift+J fire from CDP key events, so this harness cannot test
them), the pane stepper (it renders only with an active worktree, and the dev profile had
none), the usage dialog (the roster item only exists once a provider is configured), and the
Inbox answer path. Each has unit coverage; drive them by hand before a release.

Darker work area and Preview button, verified in the running dev app over CDP on 2026-09-15
with the dev profile switched to dark and restored: tab-group body `rgb(10,10,10)`
(`--workbench-surface`), tab strip `rgb(23,23,23)` (`--card`), xterm `rgb(13,13,13)`
(Kolux Dark), and the profile's stored theme had moved to `Kolux Dark` with the
guard set. The Preview button (`tab-group/WorkspacePreviewButton.tsx`) renders disabled
with no errors. Its enabled state could not be reached on this Windows machine, and the
cause is upstream: the Windows port scan never learns a listener's working directory
(`local-workspace-platform-port-scanner.ts` reads cwd from `/proc` on Linux and `lsof` on
macOS only), so no port is ever attributed to a workspace here, even one started from the
workspace's own terminal that printed its URL. The sidebar ports panel is empty for the
same reason. Likely fix: let `local-workspace-port-scanner.ts` promote a listener to
workspace-kind when `advertisedUrlWatcher.lookup` holds a validated entry for that port,
since the watcher already knows which PTY, and therefore which worktree, printed it.

Resolved on 2026-09-14, verified in the running app (Preview enabled after
`python -m http.server 8771 --bind 127.0.0.1` in the workspace terminal, and one click opened
a browser pane on that URL). It took three pieces, and the first alone changed nothing:
`enrichPort` attributes a banner-only listener with confidence `advertised`;
`reconcileAdvertisedUrls` must count that listener as present for the workspace, or the
watcher evicts the banner in the same scan (that is why `beafcc5d` did not enable the
button); and the renderer's `workspace-port-scan-client.ts` validator must accept the new
confidence value, or it discards the entire scan as "invalid response" and the status bar
reports the scan as unavailable. When you add a value to a shared union that crosses the
main/renderer boundary, grep for the hand-written validator too.

Repository trap: `.gitignore` ignores `docs/**` by policy and allow-lists durable docs one
by one. A new file under `docs/` is silently left out of every commit (the three-mode-shell
spec and prototype were referenced by two commits and this file before anyone noticed they
were untracked). When you add a durable doc, add its folder or path to the allow-list in the
same commit and check `git ls-files docs/<path>` before you cite it.

Runtime traps found while doing this:

- `pnpm dev` runs `ensure:electron-runtime`, which reinstalls and rebuilds native modules;
  on this machine that fails inside MSBuild's FileTracker (`FTK1011`, a missing `.tlog`
  directory for `@vscode/windows-process-tree`). Launch with
  `KOLUX_BACKGROUND_LAUNCH=1 node config/scripts/run-electron-vite-dev.mjs` instead.
- Playwright's `page.screenshot` never returns against the off-screen window because it waits
  for a compositor frame. Use `page.evaluate` for DOM-level checks, and raw
  `Page.captureScreenshot` only when a frame exists.
- Suites that fail before any change, all verified against the previous commit with the
  working tree stashed: `right-sidebar/SourceControl.host-context-boundary` (asserts source
  text that is already out of date), `app-shell/workspace-view-cross-client-sync` and the
  reliability-gates check (both read files under `mobile/`, which is not in this worktree),
  and `i18n/runtime-required-catalog` plus `verify:localization-runtime-catalog` (seven
  TerminalPane minimum-contrast entries drifted from `en.json`; `pnpm run
  sync:localization-runtime-catalog` regenerates it). `verify:skill-bundle-manifest` and
  `audit:code-quality:native` (two import cycles in `shared/constants.ts` and
  `main/github/stacked-pr-creation.ts`) also fail on the previous commit.
- The full `vitest run` on this machine reports about 340 failing files. None of them
  touch a file this branch changed; the causes are Windows `EPERM`/`EBUSY` on temp files,
  `spawn /bin/sh ENOENT`, and the missing `mobile/` folder. CI on Linux is the honest
  signal for the whole suite; run targeted suites locally.

**Green tests are not enough here.** Three separate UI features passed tests, typecheck
and lint while being broken: one never rendered, one silently created a plain terminal, and
one was attached to the wrong data. Running the app found all three. Do the same.

## Known gaps

- **Sidebar agent rows are dead code.** The sidebar lists sessions now, but
  `sidebar/WorktreeCardAgents.tsx` and its four tests remain; the only live import is the
  `SUPPRESS_WORKTREE_LIST_SCROLL_ADJUSTMENT_EVENT` constant in `use-scroll-suppression.ts`.
  Move that constant, then delete the file and its tests.
- **Standalone terminal-window scrollback resync** previously appended a replacement
  snapshot to the old xterm buffer after resize. The window now resets its buffer before
  replay, guarded by a headless terminal regression test. This standalone window surface
  is dormant in the current pane-based UI, so the fix has not had a live UI repro.
- **The earlier SSH terminal-window restore claim was stale.**
  `restoreLiveTerminalSessionWindows` has no production caller, and the renderer has no
  `terminalWindows.open` caller. Active main-window SSH panes use the persisted remote
  session IDs and a separate reconnect path; no failure in that path was reproduced here.
- **Layout presets** now cover the active terminal-pane grid as well as the tab-group
  tree. The pane path preserves mounted pane and PTY identities — runtime-verified
  2026-09-23 by driving the real `kolux-split-terminal-pane` /
  `kolux-arrange-terminal-pane-grid` events and diffing `data-pane-id`/`data-leaf-id`/
  `data-pty-id` before and after. Still not exercised with WebGL or existing scrollback
  present, or through the actual dropdown-menu click path (the pane header's split
  button and the "Pane Actions" menu are hover/opacity-gated and did not resolve as
  clickable in a hidden/background CDP window; the events they dispatch are the same
  ones driven here).
- **Orchestration control is still intentionally split.** The dashboard now exposes a
  read-only Runs/tasks view with refresh and pagination; creating or routing work still
  happens from the coordinator terminal/CLI. Do not describe the new panel as a full
  dispatcher. Runtime-verified 2026-09-23: with the experimental setting on, the Runs
  view rendered the legacy local run and its read-only detail pane.
- **The agent dashboard is off by default** behind "Experimental agent dashboard popout".
  Until that setting is on, its shortcut does nothing and its row is hidden in the shortcut
  list, which reads as a broken key rather than a disabled feature. This pass only enabled
  it on a throwaway dev profile to verify the Runs view; the shipped default is unchanged,
  so this gap stands.

## Verification limits carried into the next session

- The full suite remains noisy on this Windows machine (happy-dom fork-worker failures,
  missing `/bin/sh`, occasional `EPERM`/`EBUSY`). Use focused suites locally and Linux CI
  (now green, 4 shards) for the whole repository; `gh workflow run CI --ref <branch>` runs
  it on a pushed branch before landing on main.
- The cross-version release checkout is deliberately skipped on Windows because extracting
  a tagged release hangs on OneDrive. Keep the test enabled on Linux; do not “fix” this by
  weakening the wire journey.
- No packaged `dist/win-unpacked/Kolux.exe` exists in this worktree, so the release smoke
  script could only be reviewed, not executed locally.
- A real browser authorization flow and a live hidden-renderer/CDP check of the new UI
  surfaces are still outstanding.

## Working here

```
pnpm install
pnpm dev                 # development instance
pnpm run build:win       # unsigned installer in dist/
```

- **Tests must pass `--config`:** `node_modules/.bin/vitest run --config config/vitest.config.ts <path>`.
  Without it the `@/` alias fails to resolve and every suite errors at import.
- **Some suites fail on this machine for environment reasons**, not because of your change:
  symlink permission errors and a missing `/bin/sh`. Before claiming a regression, stash
  your change and re-run to see whether the failure pre-dates it.
- **Install from PowerShell, never Git Bash**, which rewrites `/S` into a path and drops the
  installer into its interactive UI:
  `Start-Process dist\kolux-windows-setup.exe -ArgumentList '/S','/currentuser' -Wait`.
  Close any editor window holding the repo or the install folder first; a lock makes the
  silent update abort. `config/scripts/windows-who-locks.ps1 -Path <file>` names the holder.
- **To drive the running app:** start it with `--remote-debugging-port=<port>` and connect
  with playwright-core over the debugging protocol. Screenshots time out waiting on fonts;
  read `document.body.innerText` instead. The native folder dialog cannot be automated, so
  add a project with `window.api.repos.add({ path, kind: 'folder' })` from the page instead.
- **Max 300 code lines per file** (400 `.tsx`, 600 `.mjs`, 800 test files), enforced by lint.
  Blank lines and comments are not counted, so comments are free. Add a sibling file rather
  than growing one, and never disable the rule: `AGENTS.md` forbids it and a ratchet test
  enforces it. Every file in the repo is currently under budget, so `pnpm exec oxlint` exits
  clean — keep it that way.
- **Do not commit with `--no-verify` unless you have a reason.** The pre-commit hook is what
  lints staged files against the real config, so bypassing it is how an oversized file or a
  formatting drift reaches CI.
- **Clean `out/` before packaging a release build.** `out/` is gitignored and never pruned, so
  a file deleted from source survives there and electron-builder packages it. A stale
  `fleet-workspaces-dir.js` from an earlier name shipped inside an installer this way.

## Naming

The project is Kolux. It was briefly called Fleet during the rebrand, and that name is
gone from source. Two things to know:

- **`fleet` is also an ordinary word here**, meaning a group of agents, as in
  `orchestration-fleet-projection.ts` and "fleet-wide freshness". Those are correct domain
  vocabulary and predate the short-lived product name. Do not rename them.
- The repository folder may still be `git-reposleet` on disk. That is only a local
  directory name; nothing in the code depends on it.

## Conventions worth knowing

- Many commands ship with no keyboard shortcut on purpose, so they never claim a chord you
  already use. That policy is pinned by a test. Bind them per user in
  `~/.kolux/keybindings.json`; do not change the shipped defaults to suit one person.
- A few strings look like the old brand but are not: a real npm package, the unrelated GNOME
  Orca screen reader at `/usr/bin/orca`, and a legacy process name used only to clean up
  what older installs left behind. Leave all of them.
