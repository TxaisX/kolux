# Handoff

Read this before changing anything. It is the current state of the project and the
context a fresh agent cannot infer from the code. Update it when you finish work.

Last updated: 2026-09-16.

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

- **Launch agents opens panes, not workspaces (2026-09-16, `3d23a6ea`).** The 🚀 launcher
  used to build one `WorktreeCreationRequest` per session, so launching 3 agents added 3 rows
  under the repo in the sidebar. It now opens one pane per session inside the *active*
  workspace (`launch-agents-into-workspace.ts`): `createEmptySplitGroup` per session,
  `launchAgentInNewTab` into that group, then one `regridToCurrentLeaves` so the grid stays
  even. The workspace row's `SessionCountBadge` counts the new sessions instead; no new rows.
  Owner's call — sessions share the workspace's working directory, so a wave can edit the same
  files; roles (`launch-agent-roles.ts`) are what keep them from doing identical work.
  - `launch-agents-requests.ts` → `launch-agent-counts.ts`: the creature-naming, setup-decision
    and startup-plan machinery was only needed to *create* worktrees and is gone. What survived
    is `expandLaunchAgentCounts`.
  - Prompts go out as `promptDelivery: 'submit-after-ready'`, matching every other generated
    multi-line prompt path (fix-checks, recovery-launch, session continuation). The old argv
    delivery would truncate a role brief + task, and plain `auto-submit` leaves
    `stdin-after-start` agents holding an unsent draft.
  - The dialog lost its project picker (it shows the target workspace read-only) and with it the
    local-repo-only restriction: `launchAgentInNewTab` resolves the execution host itself, so the
    launcher now works in SSH and folder workspaces too.
  - **Runtime-verified on 2026-09-16** in this tree's dev app over CDP (port 9334): with a
    folder workspace active, the dialog showed a read-only "Workspace verify-parent /
    verify-parent" line and no `<select>`, and "Launch 2" took the layout from 1 to 3 leaves
    (2×1 grid, one tab per group, both new tabs carrying `launchAgent: 'claude'`) with the
    worktree count unchanged. Not verified: the agents actually running, because the dev
    runtime on this machine cannot spawn any shell (node-pty's build output has `conpty.node`
    but no `conpty.dll`, the `ensure:electron-runtime` trap below; a plain Terminal 1 in the
    same workspace failed identically). Drive one real launch in an installed build before
    a release.

- **Every new session gets its own pane (2026-09-16, `5ff6a619`, `53a3a67b`).** Owner's call: the tab
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
- **Add Project opens only the picked folder (2026-09-16, `fea3bffd`).** Picking or dropping
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

- **Terminals could not open during a child-worktree removal (2026-09-16, `646cd973`).**
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
