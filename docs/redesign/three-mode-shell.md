# Three-mode shell redesign

Status: **spec, being integrated**. Owner: Txais. Started 2026-09-14.

This document is the durable record of the redesign work: what was learned from the
field, what was decided, what the prototype does, and what the app must do. The
clickable prototype lives next to it at
[`prototype/three-mode-prototype.html`](./prototype/three-mode-prototype.html); open it in
a browser. It is the interaction spec: when this doc and the prototype disagree, the
prototype wins for behavior and this doc wins for scope.

## Why

Every competing desktop app for coding agents (Conductor, Superset, Emdash, Devin Desktop,
Kiro Crew, Sculptor, Vibe Kanban, Codex app, Cursor, Warp, Zed) opens on a session list
and a transcript. The human is a spectator who scrolls. Nightshift already has three things
none of them show: **hosts** (local, WSL, SSH), **orchestration** (runs, tasks, dispatch,
mailboxes in the CLI), and **launch shapes**. None of them are visible in the renderer
today. The redesign gives them a face and turns the app into a desk the operator works
from, not a wall of terminals they watch.

Survey report (19 products, screenshots, pattern matrix):
`G:\OneDrive\Documents\nightshift-ui-survey\index.html`.

## The three modes

One switch, top center of the title bar, `Ctrl+Shift+1` / `Ctrl+Shift+2` / `Ctrl+Shift+3`
(`Ctrl+1` already selects workspaces by index). The left rail
re-labels itself per mode instead of stacking three lists.

| Mode | Question it answers | What is on screen |
|---|---|---|
| **Inbox** | What needs me? | Left: cards grouped Needs you / Waiting on agent / Done today. Center: the readable transcript of the selected session, a decision bar, the composer. Right: Files · Changes · Review with a PR strip and checks. |
| **Floor** | What is everyone doing? | Agents as lanes on a time axis, grouped by host. Bars colored by state. A dispatcher lane with its workers indented under it. Right: the run's tasks active/queued, lineup, mailbox, Stop run. |
| **Code** | Let me look at this one | The existing worktree sidebar with richer rows, N panes in a grid, a **live web preview pane**, the composer aimed at the focused pane, the same right panel as Inbox. |

Inbox is the home screen. The app opens there.

## Vocabulary

Session state uses exactly four words, matching the SSH execution-boundary contract
(`docs/reference/ssh-execution-boundary.md`): **live**, **needs you**, **unverifiable**,
**done**. Loss of contact is never evidence of exit.

"Needs you" has kinds. With permissions bypassed by default (see below) the common ones are:

| Kind | Trigger | Primary action |
|---|---|---|
| Question | agent asked the user something | Answer (inline input) |
| PR ready | PR open, checks green | Merge |
| Failed | tests or build red after the agent stopped | Open in Code |
| Approve edit | only when a workspace has bypass turned off | Approve / Reject |

## Visual rules

- Monochrome chrome per `docs/STYLEGUIDE.md`. **One warm accent** (`--agent-question`
  orange) is spent only on "needs you". Green for live, dashed grey for unverifiable.
- Windows conventions: caption buttons on the right, `Ctrl` shortcuts, `ShortcutKeyCombo`
  chips. Geist for text, the mono token for paths and terminal-adjacent UI.
- The Code mode work area is **darker than the chrome**. Two parts: `--workbench-surface`
  paints the tab-group body, splits and empty panes one step below the chrome, and the
  default dark terminal theme is now `Nightshift Dark` (`#0d0d0d`) instead of Ghostty's
  `#282c34`, which was the lightest surface on screen. Profiles still on the old default
  move once via `terminalThemeDarkDefaultedToNightshift`; a theme the user picked is never
  touched. Editor and diff panes stay on `--editor-surface`, one step lighter, so edits
  read as the subject.
- Row metadata order everywhere: what it is, where it is, what changed, how old.
- Pane header = status dot · agent glyph · title. Actions collapse into `…` on hover.

## Behaviors the app must have

### Panes: choose how many

A stepper in the Code toolbar, `+` / `−` keys, 1 to 9 panes. Grid: one row up to 3, a 2×2
for 4, three columns from 5. Panes at 4 or more become compact cards. Any pane with no
agent is an **agent picker** listing the CLIs detected on the machine; picking one starts
a session there, using the composer text as the first message if present. No named
presets: the number of panes on screen is the number of agents.

### Launch agents

`N` in Code mode. Three inputs: how many, which repository, what prompt. Shows the lineup
(which agent takes which seat), creates one worktree per agent, opens that many panes.
With three or more, the first coordinates and the rest work; the Floor shows that as a
parent lane with indented children.

### Live web preview in Code mode

Like BridgeMind's `localhost:3000` pane: the embedded browser is a peer pane in the grid,
not a separate mode. A **Preview** button in the focused pane's toolbar opens the
workspace's dev server in a browser pane inside that tab group. The server is found by the
port scanner the app already runs (`components/ports/WorkspacePortScanner.tsx`, every
30 s plus an instant path when a terminal prints a URL), attributed to the workspace by
process cwd or command line, and the URL the server printed (`advertisedUrl`) wins over
the raw port. If a browser tab for that origin already exists it is activated instead of
duplicated; with no server detected the button is disabled and says so. Reloading is the
dev server's job (HMR); there is no file watcher in the renderer and none is planned until a
non-HMR server needs one. There is no "Start dev" command in the app today; Quick Commands
are the place to run one.

### Permissions bypassed by default (YOLO)

This build is for personal use. New sessions start with the agent's bypass mode on
(Claude Code `--dangerously-skip-permissions`, Codex full-auto / YOLO, and the equivalent
for every other CLI). The composer chip reads **YOLO on** / **YOLO off** and is flipped per
workspace; the choice binds at the next launch in that workspace, it does not change an
agent that is already running. Approve/Reject cards only appear for workspaces where
YOLO is off.

### Usage across every CLI

A usage view reachable from the status bar meters: for Claude, Codex and every detected
CLI, what the plan allows, what is used in the current window, when it resets, and the
per-session token counts. The point is to know when to move work to another model before
a limit hits. The status bar keeps the compact meters; the view is the detail.

### Handoffs are per workspace

Every workspace (worktree or folder) owns its own handoff document. It is written and read
inside that workspace only, never merged across workspaces, so a tree line stays specific
to what was assigned to it. In the Code mode right panel a **Handoff** tab shows the
workspace's handoff, lets you edit it, and lets you hand the workspace to another agent
(which starts that agent in the same worktree with the handoff as its first context).

### Pick which agent you are talking to

A workspace can have several agents up. The workspace row and the pane headers show them;
the composer names the one it targets ("Message fix-guard · claude…"). `Tab` cycles, and
the agent chips in the composer switch the target without leaving the keyboard. Typing
never goes to "the workspace"; it goes to one named agent in it.

### Everything else from the prototype

- Composer as a card with chips: agent · model · effort · bypass · branch · tokens.
- Readable transcript: verb + target rows (Read · Edit · Run) with a nested result line,
  collapsed "N tool calls" groups, a Readable / Raw toggle per pane. Raw is the terminal.
- Right panel: PR strip (No PR yet · Create PR / #412 Ready to merge · Merge / Merged),
  Files · Changes N · Review N tabs, checks, a Run · Terminal · Browser drawer.
- Host chip in the title bar filters all three modes to one host.
- `Ctrl+K` palette: jump to any session or mode.
- `J` / `K` move in the Inbox, `Enter` opens in Code, `Ctrl+Enter` takes the primary action.
- Status bar tally: N live · N needs you · N unverifiable, plus provider meters.

## What exists today and is reused

Mapped 2026-09-14. Paths are repo-relative under `src/renderer/src` unless noted.

| Need | Reuse | Gap |
|---|---|---|
| Top-level modes | `TopLevelView` (`src/shared/ui-chrome-types.ts`), `setActiveView`, `TitlebarMainStrip.tsx` center strip, `ui/toggle-group` | add `inbox` and `floor` views, the switch, keybindings (`Mod+1` is taken by tab switching) |
| Needs-you predicate | `components/sidebar/smart-attention.ts` SmartClass 1 (blocked / waiting), `AgentStatusEntry.interactivePrompt`, `useAgentBucketCounts` | a cross-worktree selector sorted by attention time |
| Readable transcript | `components/native-chat/` (message list, question card, approval card, diff card, composer) behind `experimentalNativeChat` | mount outside the pane; default the flag on |
| Agent picker pane | `components/agent-picker/AgentPickerPane.tsx` via `createTab(..., { pendingAgentChoice: true })` | none |
| Launch N agents | `components/launch-agents/` (per-agent stepper, lineup, one worktree per agent) | drop the shape presets from the UI |
| Pane grid | `components/pane-layout/` (`computeGridRows`, `buildGridLayout`, `tidyLayout`), `setTabGroupLayout` | a "set pane count to N" command that creates and closes leaves |
| YOLO by default | `src/shared/tui-agent-launch-defaults.ts` defaults every agent to its skip-permissions flag; `resolveWorktreeAgentLaunchArgs` applies the per-workspace override | none |
| Workspace composer | `components/composer/WorkspaceComposer.tsx` under the panes: agent picker chip (`deriveNotesSendAgentTargets`) + YOLO chip (`agentPermissionModeByWorktree`), sends via `sendBracketedPasteToRunningAgent` | model / effort / branch / token chips |
| Usage | `store/slices/rate-limits.ts`, `usage-provider-slices.ts` (Claude, Codex, OpenCode, Grok), `components/status-bar/InlineProviderUsage.tsx`, switcher menus, `feature-wall/agents-orchestration/UsagePage.tsx` | one view across CLIs with reset times |
| PR state | `store/slices/hosted-review.ts` (provider-agnostic state and decision), `github-checks.ts` `checksStatus`, `components/github-pr-merge-state.ts` | a derived "ready to merge" |
| Changes panel | `components/right-sidebar/source-control/` | bind to an arbitrary worktree, not only the active one |
| Embedded browser | `components/browser-pane/` | place in the grid, bind to a workspace's dev server |
| Timeline data | `AgentStatusEntry.stateHistory` (cap 20) with timestamps, host on the worktree | a time-axis renderer |
| Orchestration | `src/main/runtime/orchestration/` (runs, tasks, dispatch, mailboxes) and the CLI | no renderer IPC at all; only `AgentStatusOrchestrationContext` rides on status rows |
| Handoff | `AgentSessionHandoffStatus` in `src/shared/agent-session-wire.ts` is an owner switch between terminal and structured chat, not a document | per-workspace handoff documents are new |

## Integration plan

Slices are ordered so each one ships on its own and the app keeps working between them.
Status as of 2026-09-14 is in brackets.

1. **Shell**: mode switch in the title bar, `Ctrl+Shift+1/2/3` (`Ctrl+1` was taken by
   workspace-by-index), Code mode = today's layout. [done]
2. **YOLO default + composer chips**: new sessions start in YOLO (already true); the
   composer shows a YOLO chip and an agent picker. [done 2026-09-15; model/effort chips
   not started]
3. **Pane count + pickers + launch by number**: stepper, grid, empty panes as pickers.
   [stepper and pickers done; Launch dialog still shows shape presets]
4. **Inbox**: needs-you feed from hook events; decision cards via native-chat; open in
   Code. [done for agent status; PR-ready and failed kinds not started]
5. **Right panel**: PR strip, Changes/Review/Handoff tabs, checks, drawer. [Handoff section
   done; the rest is the existing right sidebar]
6. **Web preview pane** bound to the focused workspace. [done, v0.4.0 / v0.4.1]
7. **Usage view** across CLIs. [done]
8. **Floor**: lanes from session history [done], runs from the orchestration store [needs
   renderer IPC, not started].
9. **Per-workspace handoff** documents and hand-to-agent. [done]

Each slice: tests pass, typecheck, lint, and a runtime check by driving the app in the
background (`NIGHTSHIFT_BACKGROUND_LAUNCH=1`). Green tests were not enough before; see
`HANDOFF.md`.

## Open questions

- Which CLIs beyond Claude Code and Codex are detected today, and which expose usage.
- Where per-workspace handoff files live (inside the worktree as `HANDOFF.md`, or in app
  data keyed by worktree) so folder workspaces get one too.
- Whether the Floor's time axis should come from hook event timestamps alone or from the
  orchestration run log.
