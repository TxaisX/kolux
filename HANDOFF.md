# Handoff

Read this before changing anything. It is the current state of the project and the
context a fresh agent cannot infer from the code. Update it when you finish work.

Last updated: 2026-09-10.

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

The version is held at `0.0.0` deliberately, because the product is still being built.
**Do not bump it.** The owner will say when to move to the next version.

## Recent work, and why

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
  - Still not runtime-verified: the native folder picker and the "Make it a git repo" click.
    Pre-existing: 5 failures in `worktree-creation-flow.test.ts` (identical on `b0ec17bc`). 5 failures in `worktree-creation-flow.test.ts` are
    pre-existing: identical on commit `b0ec17bc`.
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
