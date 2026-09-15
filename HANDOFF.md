# Handoff

Read this before changing anything. It is the current state of the project and the
context a fresh agent cannot infer from the code. Update it when you finish work.

Last updated: 2026-09-14.

## What this is

Nightshift is an original Windows-first desktop app for running several AI coding-agent
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

The installed app checks GitHub Releases on `TxaisX/nightshift` once a day. The update button
in the sidebar footer (`SidebarUpdateButton.tsx`, between Help and "Reveal active workspace")
walks the same flow by hand: Check for updates → Update to vX → Downloading % → Restart to
update. It only reflects `updateStatus`, so the updater never runs in `pnpm dev` and the button
stays on "Check for updates" there. To ship a release:

1. Bump `version` in `package.json` (for example `0.1.0` → `0.1.1`) and commit it to `main`.
2. `git tag v0.1.1 && git push origin main v0.1.1`.
3. `.github/workflows/release.yml` builds the Windows installer and publishes the release.
   It fails fast if the tag and `package.json` disagree.

Releases are **unsigned**. Stable Windows builds only carry the SignPath `publisherName` when
`NIGHTSHIFT_WIN_SIGNPATH=1`, because an installed app with a publisherName rejects every
unsigned update. Builds made before 2026-09-14 do carry it, so they need one manual install
of a newer release; after that, updates are automatic. Mac and Linux are not released.

## Recent work, and why

- **Darker Code work area (2026-09-15).** Two parts. `--workbench-surface`
  (`main.css`, mapped for Tailwind) paints the tab-group body, splits and empty panes one
  step below the chrome. The default dark terminal theme is now `Nightshift Dark`
  (`#0d0d0d`, `lib/terminal-themes/defaults.ts`); Ghostty's `#282c34` was the lightest
  surface on screen. Profiles that still hold the old default on disk move once through
  `terminalThemeDarkDefaultedToNightshift` (`shared/terminal-theme-default-migration.ts`,
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
    `task + <nightshift-launch-brief>…</nightshift-launch-brief>` (`src/shared/launch-agent-brief.ts`):
    role brief, stay-in-your-worktree, keep `.nightshift/handoffs/<worktree>.md` of every file
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
    `.nightshift/handoffs/<worktree>.md`, and nothing else changed; branches renamed from the task
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
    folder, both through `d1()` (Claude Code 2.1.270 bundle). Nightshift wrote `G:\Dev\…`, which is
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
  - *Overlap CLI.* `nightshift worktree changes|overlap --json` (read-only; merge-tree prediction
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
(Nightshift Dark), and the profile's stored theme had moved to `Nightshift Dark` with the
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
  `NIGHTSHIFT_BACKGROUND_LAUNCH=1 node config/scripts/run-electron-vite-dev.mjs` instead.
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

- **Layout presets** apply a grid to the tab-group tree only, so they are rarely
  applicable. Tidy was fixed to cover both trees; presets were not.
- **Orchestration has a command line but no control UI.** Runs, tasks, dispatch and
  mailboxes exist in the CLI and are not exposed to the renderer at all. The agent
  dashboard shows agents and nested sub-agents, but cannot create or route work.
- **The agent dashboard is off by default** behind "Experimental agent dashboard popout".
  Until that setting is on, its shortcut does nothing and its row is hidden in the shortcut
  list, which reads as a broken key rather than a disabled feature.

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
  `Start-Process dist\nightshift-windows-setup.exe -ArgumentList '/S','/currentuser' -Wait`.
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

The project is Nightshift. It was briefly called Fleet during the rebrand, and that name is
gone from source. Two things to know:

- **`fleet` is also an ordinary word here**, meaning a group of agents, as in
  `orchestration-fleet-projection.ts` and "fleet-wide freshness". Those are correct domain
  vocabulary and predate the short-lived product name. Do not rename them.
- The repository folder may still be `git-reposleet` on disk. That is only a local
  directory name; nothing in the code depends on it.

## Conventions worth knowing

- Many commands ship with no keyboard shortcut on purpose, so they never claim a chord you
  already use. That policy is pinned by a test. Bind them per user in
  `~/.nightshift/keybindings.json`; do not change the shipped defaults to suit one person.
- A few strings look like the old brand but are not: a real npm package, the unrelated GNOME
  Orca screen reader at `/usr/bin/orca`, and a legacy process name used only to clean up
  what older installs left behind. Leave all of them.
