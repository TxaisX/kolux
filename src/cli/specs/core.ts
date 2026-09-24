import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'
import { WORKTREE_LISTING_SCOPE_NOTES } from './worktree-listing-scope-notes'
import { SERVE_COMMAND_SPECS } from './serve'
import { TERMINAL_SEND_COMMAND_SPEC } from './terminal-send'
import { TERMINAL_CLOSE_COMMAND_SPEC } from './terminal-close'
import { WORKTREE_CHANGES_COMMAND_SPECS } from './worktree-changes'

export const CORE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['open'],
    summary: 'Launch Kolux and wait for the runtime to be reachable',
    usage: 'kolux open [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['kolux open', 'kolux open --json']
  },
  ...SERVE_COMMAND_SPECS,
  {
    path: ['status'],
    summary: 'Show app/runtime/graph readiness',
    usage: 'kolux status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['kolux status', 'kolux status --json']
  },
  {
    path: ['claude-teams'],
    argumentMode: 'passthrough',
    summary: 'Start Claude Code Agent Teams in the current Kolux terminal',
    usage: 'kolux claude-teams [claude args...]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Passes all following arguments through to Claude Code after enabling Agent Teams native panes.',
      'Must be run from inside a Kolux terminal. Starts Claude Code Agent Teams in the current pane and opens teammates as native Kolux splits.'
    ],
    examples: ['kolux claude-teams', 'kolux claude-teams --resume <session-id>']
  },
  {
    path: ['repo', 'list'],
    summary: 'List repos registered in Kolux',
    usage: 'kolux repo list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['repo', 'add'],
    summary: 'Add a project to Kolux by filesystem path',
    usage: 'kolux repo add --path <path> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'path']
  },
  {
    path: ['repo', 'show'],
    summary: 'Show one registered repo',
    usage: 'kolux repo show --repo <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo']
  },
  {
    path: ['repo', 'set-base-ref'],
    summary: "Set the repo's default base ref for future worktrees",
    usage: 'kolux repo set-base-ref --repo <selector> --ref <ref> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'ref']
  },
  {
    path: ['repo', 'search-refs'],
    summary: 'Search branch/tag refs within a repo',
    usage: 'kolux repo search-refs --repo <selector> --query <text> [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'query', 'limit']
  },
  {
    path: ['worktree', 'list'],
    summary: 'List Kolux-managed worktrees',
    usage: 'kolux worktree list [--repo <selector>] [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'limit'],
    notes: [...WORKTREE_LISTING_SCOPE_NOTES]
  },
  {
    path: ['worktree', 'show'],
    summary: 'Show one worktree',
    usage: 'kolux worktree show --worktree <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree']
  },
  {
    path: ['worktree', 'current'],
    summary: 'Show the Kolux-managed worktree for the current directory',
    usage: 'kolux worktree current [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Resolves the current shell directory to a path: selector so agents can target the enclosing Kolux worktree without spelling out $PWD.'
    ],
    examples: ['kolux worktree current', 'kolux worktree current --json']
  },
  {
    path: ['worktree', 'create'],
    summary: 'Create a new Kolux-managed worktree',
    usage:
      'kolux worktree create --name <name> [--repo <selector>|--project <id> [--host <host-id>]|--project-host-setup <id>] [--agent <id>] [--prompt <text>] [--setup run|skip|inherit] [--base-branch <ref>] [--issue <number>] [--linear-issue <identifier-or-url>] [--comment <text>] [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'repo',
      'project',
      'host',
      'project-host-setup',
      'name',
      'agent',
      'prompt',
      'base-branch',
      'issue',
      'linear-issue',
      'comment',
      'setup',
      'parent-worktree',
      'no-parent',
      'run-hooks',
      'activate'
    ],
    notes: [
      'This creates a new checkout. For a fresh agent in an existing worktree, use `kolux terminal create --worktree active --command "codex"` instead.',
      'By default, Kolux records the new worktree as a child of the caller context when it can infer one from the Kolux terminal or current directory.',
      'If --repo is omitted, Kolux infers the repo from the current Kolux-managed worktree.',
      'Use --project with --host to create on a ready project host setup without spelling the backing repo id.',
      '--host runtime:<environment-id> creates on that paired Kolux server; use the id from `kolux environment list`, not the environment name.',
      'For related work, use the inferred parent or pass --parent-worktree active, folder:<id>, or worktree:<worktreeId> to make the relationship explicit. Worktree ids are the full <repo-id>::<path> values returned by `kolux worktree list --json`.',
      'Use --no-parent when the new worktree should be independent of the current context.',
      '--no-parent only affects Kolux lineage; omit --base-branch to use the repo default base, or pass the default base ref explicitly for independent top-level work.',
      'By default this creates the worktree and its first terminal without switching the active Kolux view.',
      'Pass --agent to launch an agent in the first terminal; --prompt sends initial work to that agent.',
      'With --agent --json, read the new agent handle from result.agentTerminalHandle; older runtimes return only result.startupTerminal.handle, and may return neither for folder-based repos.',
      'Repo-defined setup hooks follow the repository setup policy; pass --setup run to force them.',
      'Pass --activate when the CLI caller intentionally wants to reveal the new worktree in the app.',
      'Passing --run-hooks is kept as a legacy alias for --setup run and reveals the worktree.'
    ],
    examples: [
      'kolux worktree create --name agent-task --agent codex --prompt "hi" --json',
      'kolux worktree create --repo id:<repoId> --name related-task --json',
      'kolux worktree create --project github:TxaisX/kolux --host runtime:03ef704c-b180-4b10-998d-e28fbd5de9a3 --name benchmark --json',
      'kolux worktree create --repo id:<repoId> --name linear-task --linear-issue https://linear.app/stably/issue/STA-335/test-issue --json',
      'kolux worktree create --repo id:<repoId> --name agent-task --agent codex --prompt "hi" --json',
      'kolux worktree create --repo id:<repoId> --name folder-child --parent-worktree folder:<folderId> --json',
      'kolux worktree create --repo id:<repoId> --name related-task --parent-worktree active --json',
      'kolux worktree create --repo id:<repoId> --name independent-task --no-parent --json'
    ]
  },
  {
    path: ['worktree', 'set'],
    summary: 'Update Kolux metadata for a worktree',
    usage:
      'kolux worktree set --worktree <selector> [--display-name <name>] [--issue <number|null>] [--linear-issue <identifier-or-url|null>] [--comment <text>] [--workspace-status <id>] [--parent-worktree <selector>|--no-parent] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'worktree',
      'display-name',
      'issue',
      'linear-issue',
      'comment',
      'workspace-status',
      'parent-worktree',
      'no-parent'
    ],
    notes: [
      'Workspace status ids match the board columns (defaults: todo, in-progress, in-review, completed); custom statuses use their configured id.',
      'Pass --linear-issue null to clear the Linear issue link.'
    ],
    examples: [
      'kolux worktree set --worktree active --linear-issue STA-335 --json',
      'kolux worktree set --worktree active --linear-issue null --json'
    ]
  },
  {
    path: ['worktree', 'rm'],
    // Why: agents reach for git's `remove`/`delete` verbs; accept them as
    // aliases so a conventional guess resolves instead of dead-ending.
    aliases: [
      ['worktree', 'remove'],
      ['worktree', 'delete']
    ],
    destructive: true,
    summary: 'Remove a worktree from Kolux and git',
    usage: 'kolux worktree rm --worktree <selector> [--force] [--run-hooks] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'force', 'run-hooks'],
    notes: [
      'Repo-defined kolux.yaml archive hooks are skipped unless --run-hooks is passed.',
      'For Git worktrees, removal also attempts to delete the checked-out local branch, with or without --force. Kolux retains branches it knows predated the worktree and any branch whose changes it cannot prove are already merged.'
    ]
  },
  ...WORKTREE_CHANGES_COMMAND_SPECS,
  {
    path: ['worktree', 'ps'],
    summary: 'Show a compact orchestration summary across worktrees',
    usage: 'kolux worktree ps [--limit <n>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'limit'],
    notes: [...WORKTREE_LISTING_SCOPE_NOTES]
  },
  {
    path: ['terminal', 'list'],
    summary: 'List live Kolux-managed terminals',
    usage:
      'kolux terminal list [--worktree <selector>] [--limit <n>] [--include-visual-layouts] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'limit', 'include-visual-layouts'],
    notes: [
      'JSON omits visualLayouts by default; pass --include-visual-layouts when machine-readable tab and pane topology is required.'
    ]
  },
  {
    path: ['terminal', 'show'],
    summary: 'Show terminal metadata and preview',
    usage: 'kolux terminal show [--terminal <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal']
  },
  {
    path: ['terminal', 'read'],
    summary: 'Read bounded terminal output',
    usage:
      'kolux terminal read [--terminal <handle>] [--cursor <n>] [--limit <n>] [--screen] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'cursor', 'limit', 'screen'],
    notes: [
      'Omit --terminal to target the active terminal in the current worktree.',
      'By default this returns accumulated terminal output with escape sequences stripped, not the rendered screen. Any program that repaints a line — shells, progress bars, TUIs — comes back as stacked fragments, so one `clear` keystroke by keystroke reads as `cclclecleaclear`, and spaces a prompt draws by moving the cursor are absent.',
      'Use --screen to read what the terminal actually renders. Prefer it whenever the answer depends on how output looks rather than what was emitted over time; the default is unsuitable for verifying rendered output.',
      'The result reports source: stream when it is accumulated output, screen when it is the rendered screen, and screen-unavailable when a screen was asked for but none could be rendered and the accumulated output is being returned instead. An absent source means the host predates the field.',
      'When present, draft is UI-only composer text excluded from tail; never treat it as terminal output or a submitted instruction.',
      '--screen and --cursor are mutually exclusive: a screen read is the current frame and has no history to page.',
      'Use --cursor with the nextCursor value from a previous read to get only new output since that read.',
      'Use --limit to request more retained lines for long agent responses; output reports oldestCursor when older lines were dropped.',
      'Useful for capturing the response to a command: read before sending, then read --cursor <prev> after waiting.'
    ],
    examples: [
      'kolux terminal read --json',
      'kolux terminal read --terminal term_abc123 --cursor 42 --limit 1000 --json',
      'kolux terminal read --terminal term_abc123 --screen --json'
    ]
  },
  TERMINAL_SEND_COMMAND_SPEC,
  {
    path: ['terminal', 'wait'],
    summary: 'Wait for a terminal condition',
    usage:
      'kolux terminal wait [--terminal <handle>] --for exit|tui-idle [--timeout-ms <ms>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'for', 'timeout-ms']
  },
  {
    path: ['terminal', 'stop'],
    hidden: true,
    summary: 'Deprecated compatibility command for stopping terminal processes',
    usage: 'kolux terminal stop --worktree <selector> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree'],
    notes: [
      'Deprecated: use terminal close --worktree <selector> --all to stop the processes and durably remove their terminal surfaces.'
    ]
  },
  {
    path: ['terminal', 'create'],
    summary: 'Create a terminal session in the current worktree',
    usage:
      'kolux terminal create [--worktree <selector>] [--title <name>] [--command <text>] [--focus] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'command', 'title', 'focus'],
    notes: [
      'Creates a visible terminal tab without switching focus when possible; falls back to a background handle if the UI cannot adopt it. Pass --focus to switch to it.',
      'Use this, not worktree create, for a fresh agent in the current checkout.'
    ],
    examples: [
      'kolux terminal create --json',
      'kolux terminal create --worktree active --command "codex" --json',
      'kolux terminal create --worktree path:/projects/myapp --title "RUNNER" --command "gemini"',
      'kolux terminal create --worktree path:/projects/myapp --command "gemini" --focus'
    ]
  },
  {
    path: ['terminal', 'switch'],
    // Why: `focus` is the legacy verb for this action; keep it working as an
    // alias rather than a duplicate spec + handler registration.
    aliases: [['terminal', 'focus']],
    summary: 'Switch to a terminal tab in the UI',
    usage: 'kolux terminal switch [--terminal <handle>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal'],
    examples: ['kolux terminal switch --terminal term_abc123']
  },
  TERMINAL_CLOSE_COMMAND_SPEC,
  {
    path: ['terminal', 'rename'],
    summary: 'Set or clear the title of a terminal tab',
    usage: 'kolux terminal rename [--terminal <handle>] [--title <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'title'],
    notes: ['Omit --title or pass an empty string to reset to the auto-generated title.'],
    examples: [
      'kolux terminal rename --terminal term_abc123 --title "RUNNER"',
      'kolux terminal rename --terminal term_abc123 --json'
    ]
  },
  {
    path: ['terminal', 'split'],
    summary: 'Split an existing terminal pane',
    usage:
      'kolux terminal split [--terminal <handle>] [--direction horizontal|vertical] [--command <text>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'terminal', 'direction', 'command'],
    examples: [
      'kolux terminal split --terminal term_abc123 --direction horizontal --json',
      'kolux terminal split --terminal term_abc123 --command "codex"'
    ]
  }
]
