# COMPAT

The outside surfaces Kolux RS must keep, so that Txais's habits, skills, agent setups and saved data keep working on the day he switches.

## 1. Why the contracts exist, and the rule

Txais does not only click around Kolux. His own skills (kolux-cli, kolux-run and the orchestration skill) drive the app through the `kolux` command, and the agents he runs inside Kolux terminals call that command as well. His agent CLIs carry hook entries that Kolux wrote into their config files. His shortcut file and his repos' `kolux.yaml` files are his own files. His profile folder holds months of projects, worktrees and settings.

The rule:

| What | Rule |
|---|---|
| Interfaces in this file | Kept exactly: command words, flag spellings, aliases, the JSON envelope, exit codes, hook event names, keybinding ids and the shortcut file, environment variable names, `kolux.yaml` keys, and the data the importer reads. |
| Everything behind them | Written new. Nothing here says how the old app did it, and the rebuild must not copy its code. |
| Rows marked "not carried, see `DECISIONS.md`" | Gone on purpose. The rebuild must not grow them back without a new decision. |
| Rows marked UNKNOWN | Not stated by the help text or the registries. Capture them from the live app before building that surface. |

Versions: the installed CLI reported 0.15.2 when its help was captured; the source tree read for the registries was 0.15.0. Command words agree between the two. Where wording differs, the installed help wins.

## 2. The kolux CLI

### 2.1 Launchers and PATH

| Fact | Contract |
|---|---|
| Command name | `kolux` everywhere. Dev builds use a separate name (kolux-dev) so they never shadow the installed one; the Linux package uses kolux-ide. |
| Windows launcher | `kolux.cmd` sits on the user PATH and forwards every argument to `kolux.exe` in the same folder. It returns that program's exit status, or 1 when the program is missing. |
| PATH registration | The installer adds the CLI folder to the user PATH (per user, not machine-wide). |
| Inside Kolux terminals | Kolux puts its CLI folder first on PATH in every terminal it opens, so `kolux` works with no setup. Each terminal also gets its own handle, pane key, tab id and worktree id in the environment (section 5.5). |
| Orchestration send and reply on Windows | The cmd launcher refuses these two commands and exits 2, telling the caller to use the program directly; message text does not survive the Windows command shell's quoting. Their help is reachable only by calling `kolux.exe` directly, which is how it was captured. |

### 2.2 Help at every level

- Root: `kolux --help`, `kolux help`, or `kolux` with nothing after it.
- Group: `kolux worktree --help` or `kolux help worktree` (same for every group).
- Command: `kolux worktree create --help` or `kolux help worktree create`.
- Help works with the app closed. Hidden commands never appear in any help. An unknown help path prints the closest help that exists plus a suggestion, and exits 1.
- `--version` (or -v) prints the version only when typed alone.
- Root help order, by section: Startup; Diagnostics; Agent Discovery; Accounts; Skills; Automations; Projects; Repos; Worktrees; Files; Terminals; Orchestration; Browser Automation; then Common Commands, Selectors, Terminal Send Options, Terminal List Options, Wait Options, Output Options, Behavior and Examples. The old help also had Hosts, Environments, Environment Recipes, Computer Use, Linear and Mobile Emulator sections: not carried, see `DECISIONS.md`.

### 2.3 Grammar, global options and selectors

| Rule | Contract |
|---|---|
| Flag forms | Space form and equals form both work. a flag written with an equals sign and nothing after it means an explicit empty value. A value that itself begins with two dashes is accepted only in the equals form. |
| Repeatable flags | `--skill` may repeat. A flag that is not repeatable, given twice with different values, is refused. |
| Aliases | Resolve before anything else (table 2.6 lists them). |
| Global options | `--json` and `--help` on every command, and they may come before the command words. `--page` selects a browser page on the browser commands. The old `--pairing-code` and `--environment` globals: not carried, see `DECISIONS.md`. |
| Repo selector | `--repo` takes an id: prefix, a name: prefix or a path: prefix. |
| Worktree selector | `--worktree` takes identity:, id: (repo id, two colons, path), name:, branch:, issue:, path:, or the words active or current. Example: `kolux worktree show --worktree branch:main` (Kolux RS, T-014-b-fix: identity: and active are refused with the accepted forms listed, DT-C12.) |
| Terminal selector | `--terminal` takes a handle printed by `kolux terminal list --json`. Inside a Kolux terminal it defaults to that terminal. |
| Parent selectors | `--parent-worktree` and `--no-parent` on worktree create and set. |

### 2.4 Output

- With `--json`, stdout carries one JSON object: a request id, a success flag, the result, and metadata that names the runtime. On failure the object carries an error with a code, a message and optional data. Without `--json`, results are plain text on stdout and errors go to stderr.
- Per-command result fields: the command specs declare none (all 229 manifest rows say "not declared"). Capture each command's live JSON before the rebuild fixes a shape. UNKNOWN until then.
- `kolux agent-context --json` prints a self-description document: schema version 1, a count of commands, and one entry per command with its path, usage and flags. Keep its field names stable once captured.

### 2.5 Exit codes and the running app

| Code | When |
|---|---|
| 0 | Success. |
| 1 | Any error: bad arguments, unknown command or help path, app not reachable, command failed. |
| 2 | `kolux.cmd` refusing orchestration send or reply (2.1). |
| 75 | `kolux orchestration ask` on the packaged Windows build, when it hands the wait back to the caller to resume later. |
| Non-zero | `kolux terminal wait` when the terminal ends blocked rather than in the awaited state. The exact code is UNKNOWN from help. |
| Passed through | skills install and skills update return the package tool's status; claude-teams returns its child process's status; `kolux.cmd` returns the program's status. |

Most commands need the app running; `kolux open` starts it and `kolux status` reports whether it is up. These work with the app closed: help, version, agent-context, skills list, get, install and update, and the agent hooks commands.

### 2.6 Commands the rebuild keeps

Columns: command; aliases; positional arguments; the command's own flags (globals left out); marks (hidden, destructive, passthrough, special exit code); JSON (whether `--json` is accepted); usage as declared, first line only, with dropped flags removed.

#### Startup (3)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux open` |  |  |  |  | yes | `kolux open [--json]` |
| `kolux status` |  |  |  |  | yes | `kolux status [--json]` |
| `kolux claude-teams` |  |  |  | passes remaining arguments through; returns the child process's exit status | yes | `kolux claude-teams [claude args...]` |

#### Diagnostics (1)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux diagnostics memory` |  |  |  |  | yes | `kolux diagnostics memory [--json]` |

#### Agent discovery (1)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux agent-context` |  |  |  |  | yes | `kolux agent-context [--json]` |

#### Accounts (2)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux account add` |  |  | `--agent` |  | yes | `kolux account add [--agent claude\|codex] [--json]` |
| `kolux account list` |  |  |  |  | yes | `kolux account list [--json]` |

#### Skills (4)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux skills list` |  |  |  |  | yes | `kolux skills list [--json]` |
| `kolux skills get` | `kolux skills show` | topic | `--topic` `--full` `--reference` `--references` |  | yes | `kolux skills get <topic> [--full \| --reference <name>] [--json]` |
| `kolux skills install` |  |  | `--skill` `--all` `--agent` `--local` `--dry-run` | returns the package tool's exit status | yes | `kolux skills install [--skill <name>]... [--all] [--agent <name>[,<name>]] [--local] [--dry-run] [--json]` |
| `kolux skills update` |  |  | `--skill` `--all` `--local` `--dry-run` | returns the package tool's exit status | yes | `kolux skills update [--skill <name>]... [--all] [--local] [--dry-run] [--json]` |

#### Automations (7)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux automations list` |  |  |  |  | yes | `kolux automations list [--json]` |
| `kolux automations show` |  | id | `--id` |  | yes | `kolux automations show <id> [--json]` |
| `kolux automations create` |  |  | `--name` `--prompt` `--provider` `--precheck` `--precheck-timeout` `--repo` `--workspace` `--source-context` `--workspace-mode` `--base-branch` `--trigger` `--schedule` `--time` `--day` `--timezone` `--enabled` `--disabled` `--missed-run-grace-minutes` `--reuse-session` `--fresh-session` |  | yes | `kolux automations create --name <name> --trigger <preset\|cron\|rrule> --prompt <text> --provider <agent> [--precheck <command>] [--repo <selector>\|--workspace <selector>] [--json]` |
| `kolux automations edit` |  | id | `--id` `--name` `--prompt` `--provider` `--precheck` `--precheck-timeout` `--repo` `--workspace` `--source-context` `--workspace-mode` `--base-branch` `--trigger` `--schedule` `--time` `--day` `--timezone` `--enabled` `--disabled` `--missed-run-grace-minutes` `--reuse-session` `--fresh-session` |  | yes | `kolux automations edit <id> [--name <name>] [--trigger <preset\|cron\|rrule>] [--json]` |
| `kolux automations remove` |  | id | `--id` | destructive | yes | `kolux automations remove <id> [--json]` |
| `kolux automations run` |  | id | `--id` |  | yes | `kolux automations run <id> [--json]` |
| `kolux automations runs` |  |  | `--id` |  | yes | `kolux automations runs [--id <automation-id>] [--json]` |

#### Projects (1)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux project list` |  |  |  |  | yes | `kolux project list [--json]` |

#### Repos (5)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux repo list` |  |  |  |  | yes | `kolux repo list [--json]` |
| `kolux repo add` |  |  | `--path` |  | yes | `kolux repo add --path <path> [--json]` |
| `kolux repo show` |  |  | `--repo` |  | yes | `kolux repo show --repo <selector> [--json]` |
| `kolux repo set-base-ref` |  |  | `--repo` `--ref` |  | yes | `kolux repo set-base-ref --repo <selector> --ref <ref> [--json]` |
| `kolux repo search-refs` |  |  | `--repo` `--query` `--limit` |  | yes | `kolux repo search-refs --repo <selector> --query <text> [--limit <n>] [--json]` |

#### Worktrees (9)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux worktree list` |  |  | `--repo` `--limit` |  | yes | `kolux worktree list [--repo <selector>] [--limit <n>] [--json]` |
| `kolux worktree show` |  |  | `--worktree` |  | yes | `kolux worktree show --worktree <selector> [--json]` |
| `kolux worktree current` |  |  |  |  | yes | `kolux worktree current [--json]` |
| `kolux worktree create` |  |  | `--repo` `--name` `--agent` `--prompt` `--base-branch` `--issue` `--comment` `--setup` `--parent-worktree` `--no-parent` `--run-hooks` `--activate` |  | yes | `kolux worktree create --name <name> [--repo <selector>] [--agent <id>] [--prompt <text>] [--setup run\|skip\|inherit] [--base-branch <ref>] [--issue <number>] [--comment <text>] [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--json]` |
| `kolux worktree set` |  |  | `--worktree` `--display-name` `--issue` `--comment` `--workspace-status` `--parent-worktree` `--no-parent` |  | yes | `kolux worktree set --worktree <selector> [--display-name <name>] [--issue <number\|null>] [--comment <text>] [--workspace-status <id>] [--parent-worktree <selector>\|--no-parent] [--json]` |
| `kolux worktree rm` | `kolux worktree remove`, `kolux worktree delete` |  | `--worktree` `--force` `--run-hooks` | destructive | yes | `kolux worktree rm --worktree <selector> [--force] [--run-hooks] [--json]` |
| `kolux worktree changes` |  |  | `--worktree` |  | yes | `kolux worktree changes [--worktree <selector>] [--json]` |
| `kolux worktree overlap` |  |  | `--worktree` |  | yes | `kolux worktree overlap [--worktree <selector>] [--json]` |
| `kolux worktree ps` |  |  | `--limit` |  | yes | `kolux worktree ps [--limit <n>] [--json]` |

#### Files (3)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux file open` |  | path | `--path` `--worktree` |  | yes | `kolux file open <path> [--worktree <selector>] [--json]` |
| `kolux file diff` |  | path | `--path` `--staged` `--worktree` |  | yes | `kolux file diff <path> [--staged] [--worktree <selector>] [--json]` |
| `kolux file open-changed` |  |  | `--mode` `--worktree` |  | yes | `kolux file open-changed [--mode edit\|diff\|both] [--worktree <selector>] [--json]` |

#### Terminals (11)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux terminal list` |  |  | `--worktree` `--limit` `--include-visual-layouts` |  | yes | `kolux terminal list [--worktree <selector>] [--limit <n>] [--include-visual-layouts] [--json]` |
| `kolux terminal show` |  |  | `--terminal` |  | yes | `kolux terminal show [--terminal <handle>] [--json]` |
| `kolux terminal read` |  |  | `--terminal` `--cursor` `--limit` `--screen` |  | yes | `kolux terminal read [--terminal <handle>] [--cursor <n>] [--limit <n>] [--screen] [--json]` |
| `kolux terminal send` |  |  | `--terminal` `--text` `--enter` `--interrupt` `--wait-submit` `--retry-request` |  | yes | `kolux terminal send [--terminal <handle>] [--text <text>] [--enter] [--interrupt] [--wait-submit <seconds>] [--retry-request <id>] [--json]` |
| `kolux terminal wait` |  |  | `--terminal` `--for` `--timeout-ms` | non-zero when the terminal ends blocked | yes | `kolux terminal wait [--terminal <handle>] --for exit\|tui-idle [--timeout-ms <ms>] [--json]` |
| `kolux terminal stop` |  |  | `--worktree` | hidden | yes | `kolux terminal stop --worktree <selector> [--json]` |
| `kolux terminal create` |  |  | `--worktree` `--command` `--title` `--focus` |  | yes | `kolux terminal create [--worktree <selector>] [--title <name>] [--command <text>] [--focus] [--json]` |
| `kolux terminal switch` | `kolux terminal focus` |  | `--terminal` |  | yes | `kolux terminal switch [--terminal <handle>] [--json]` |
| `kolux terminal close` |  |  | `--terminal` `--tab` `--worktree` `--all` | destructive | yes | `kolux terminal close ([--terminal <handle>] [--tab] \| --worktree <selector> --all) [--json]` |
| `kolux terminal rename` |  |  | `--terminal` `--title` |  | yes | `kolux terminal rename [--terminal <handle>] [--title <text>] [--json]` |
| `kolux terminal split` |  |  | `--terminal` `--direction` `--command` |  | yes | `kolux terminal split [--terminal <handle>] [--direction horizontal\|vertical] [--command <text>] [--json]` |

#### Orchestration (28)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux orchestration run-create` |  |  | `--objective` `--from` `--retry-request` |  | yes | `kolux orchestration run-create --objective <text> [--from <handle>] [--retry-request <id>] [--json]` |
| `kolux orchestration run-use` |  |  | `--id` `--from` `--takeover-legacy` `--retry-request` |  | yes | `kolux orchestration run-use --id <run_id> [--from <handle>] [--takeover-legacy] [--retry-request <id>] [--json]` |
| `kolux orchestration run-current` |  |  | `--from` |  | yes | `kolux orchestration run-current [--from <handle>] [--json]` |
| `kolux orchestration run-list` |  |  | `--limit` `--cursor` |  | yes | `kolux orchestration run-list [--limit <n>] [--cursor <cursor>] [--json]` |
| `kolux orchestration run-show` |  |  | `--id` |  | yes | `kolux orchestration run-show --id <run_id> [--json]` |
| `kolux orchestration send` |  |  | `--to` `--run` `--from` `--subject` `--body` `--type` `--priority` `--thread-id` `--payload` `--task-id` `--dispatch-id` `--dispatch-capability` `--retry-request` `--outcome` `--files-modified` `--report-path` `--phase` | refused by the cmd launcher (exit 2) | yes | `kolux orchestration send --subject <text> [--to <run:id\|dispatch:id\|legacy_handle>] [--run <run_id>] [--from <handle>] [--body <text>] [--type <type>] [--priority <level>] [--thread-id <id>] [--payload <json>] [--task-id <id>] [--dispatch-id <id>] [--outcome <succeeded\|failed>] [--files-modified <csv>] [--report-path <path>] [--phase <text>] [--retry-request <id>] [--json]` |
| `kolux orchestration check` |  |  | `--terminal` `--run` `--ack` `--unread` `--peek` `--all` `--types` `--format` `--wait` `--timeout-ms` `--retry-request` |  | yes | `kolux orchestration check [--terminal <handle>] [--run <run_id>] [--ack <delivery_id>] [--unread \| --peek \| --all] [--types <type,...>] [--format] [--wait] [--timeout-ms <n>] [--retry-request <id>] [--json]` |
| `kolux orchestration reply` |  |  | `--id` `--body` `--run` `--from` `--retry-request` | refused by the cmd launcher (exit 2) | yes | `kolux orchestration reply --id <msg_id> --body <text> [--run <run_id>] [--from <handle>] [--retry-request <id>] [--json]` |
| `kolux orchestration inbox` |  |  | `--limit` `--terminal` `--full` |  | yes | `kolux orchestration inbox [--limit <n>] [--terminal <handle>] [--full] [--json]` |
| `kolux orchestration task-create` |  |  | `--spec` `--task-title` `--display-name` `--deps` `--parent` `--run` `--from` `--retry-request` |  | yes | `kolux orchestration task-create --spec <text> [--task-title <text>] [--display-name <text>] [--deps <json_array>] [--parent <task_id>] [--run <run_id>] [--from <handle>] [--retry-request <id>] [--json]` |
| `kolux orchestration task-list` |  |  | `--status` `--ready` `--brief` `--run` `--from` |  | yes | `kolux orchestration task-list [--status <status>] [--ready] [--brief] [--run <run_id>] [--from <handle>] [--json]` |
| `kolux orchestration task-update` |  |  | `--id` `--status` `--result` `--run` `--from` `--retry-request` |  | yes | `kolux orchestration task-update --id <task_id> --status <status> [--result <json>] [--run <run_id>] [--from <handle>] [--retry-request <id>] [--json]` |
| `kolux orchestration worker-start` |  |  | `--task` `--spec` `--task-title` `--deps` `--parent` `--worktree` `--name` `--repo` `--base-branch` `--display-name` `--comment` `--setup` `--agent` `--model` `--effort` `--terminal` `--tier` `--retry-of` `--timeout-ms` `--run` `--from` `--retry-request` |  | yes | `kolux orchestration worker-start (--task <task_id> \| --spec <text>) [--worktree <current\|selector\|new-child\|new-top-level>] (--agent <agent> \| --terminal <handle> \| --tier <major\|deep\|build\|light>) [--task-title <text>] [--deps <json_array>] [--parent <task_id>] [--model <id>] [--effort <level>] [--name <name>] [--repo <selector>] [--base-branch <ref>] [--display-name <text>] [--comment <text>] [--setup <run\|skip\|inherit>] [--retry-of <dispatch_id>] [--timeout-ms <n>] [--run <run_id>] [--from <handle>] [--retry-request <id>] [--json]` |
| `kolux orchestration worker-show` |  |  | `--dispatch` |  | yes | `kolux orchestration worker-show --dispatch <dispatch_id> [--json]` |
| `kolux orchestration worker-read` |  |  | `--dispatch` `--source` `--cursor` `--limit` |  | yes | `kolux orchestration worker-read --dispatch <dispatch_id> [--source <auto\|transcript\|terminal>] [--cursor <cursor>] [--limit <n>] [--json]` |
| `kolux orchestration worker-stop` |  |  | `--dispatch` `--retry-request` |  | yes | `kolux orchestration worker-stop --dispatch <dispatch_id> [--retry-request <id>] [--json]` |
| `kolux orchestration worker-abandon` |  |  | `--dispatch` `--retry-request` |  | yes | `kolux orchestration worker-abandon --dispatch <dispatch_id> [--retry-request <id>] [--json]` |
| `kolux orchestration worker-release` |  |  | `--dispatch` `--retry-request` |  | yes | `kolux orchestration worker-release --dispatch <dispatch_id> [--retry-request <id>] [--json]` |
| `kolux orchestration worker-retain` |  |  | `--dispatch` `--retry-request` |  | yes | `kolux orchestration worker-retain --dispatch <dispatch_id> [--retry-request <id>] [--json]` |
| `kolux orchestration worker-list` |  |  | `--run` `--terminal-state` `--cursor` `--limit` |  | yes | `kolux orchestration worker-list [--run <run_id>] [--terminal-state <active\|reclaimable\|retained\|release_pending\|release_unknown\|released>] [--cursor <cursor>] [--limit <1-100>] [--json]` |
| `kolux orchestration dispatch` |  |  | `--task` `--to` `--from` `--run` `--inject` `--dry-run` `--return-preamble` `--retry-request` |  | yes | `kolux orchestration dispatch --task <task_id> --to <handle> [--from <handle>] [--run <run_id>] [--inject] [--dry-run] [--return-preamble] [--retry-request <id>] [--json]` |
| `kolux orchestration request-show` |  |  | `--request` |  | yes | `kolux orchestration request-show --request <request_id> [--json]` |
| `kolux orchestration dispatch-show` |  |  | `--task` `--preamble` `--from` |  | yes | `kolux orchestration dispatch-show --task <task_id> [--preamble] [--from <handle>] [--json]` |
| `kolux orchestration ask` |  |  | `--to` `--run` `--question` `--resume` `--dispatch-capability` `--options` `--timeout-ms` `--from` `--retry-request` | exit 75 on the packaged Windows hand-back | yes | `kolux orchestration ask (--question <text> \| --resume <message_id>) [--to <run:id>] [--run <run_id>] [--options <csv>] [--timeout-ms <n>] [--from <handle>] [--retry-request <id>] [--json]` |
| `kolux orchestration gate-create` |  |  | `--task` `--question` `--options` `--from` `--retry-request` |  | yes | `kolux orchestration gate-create --task <task_id> --question <text> [--options <json_array>] [--from <handle>] [--retry-request <id>] [--json]` |
| `kolux orchestration gate-resolve` |  |  | `--id` `--resolution` `--from` `--retry-request` |  | yes | `kolux orchestration gate-resolve --id <gate_id> --resolution <text> [--from <handle>] [--retry-request <id>] [--json]` |
| `kolux orchestration gate-list` |  |  | `--task` `--status` `--run` `--from` |  | yes | `kolux orchestration gate-list [--task <task_id>] [--status <status>] [--run <run_id>] [--from <handle>] [--json]` |
| `kolux orchestration reset` |  |  | `--all` `--tasks` `--messages` `--retry-request` |  | yes | `kolux orchestration reset (--all \| --tasks \| --messages) [--retry-request <id>] [--json]` |

#### Agent hooks (4)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux agent hooks prepare-codex` |  |  |  |  | yes | `kolux agent hooks prepare-codex` |
| `kolux agent hooks status` |  |  |  |  | yes | `kolux agent hooks status [--json]` |
| `kolux agent hooks off` |  |  |  |  | yes | `kolux agent hooks off [--json]` |
| `kolux agent hooks on` |  |  |  |  | yes | `kolux agent hooks on [--json]` |

#### Browser tabs (7)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux tab list` |  |  | `--worktree` `--show-profile` |  | yes | `kolux tab list [--worktree <selector\|all>] [--show-profile] [--json]` |
| `kolux tab show` |  |  | `--page` `--worktree` |  | yes | `kolux tab show --page <id> [--worktree <selector>] [--json]` |
| `kolux tab current` |  |  | `--worktree` |  | yes | `kolux tab current [--worktree <selector\|all>] [--json]` |
| `kolux tab switch` |  |  | `--index` `--page` `--worktree` `--focus` |  | yes | `kolux tab switch (--index <n> \| --page <id>) [--worktree <selector>] [--focus] [--json]` |
| `kolux tab create` |  |  | `--url` `--worktree` `--profile` |  | yes | `kolux tab create [--url <url>] [--worktree <selector>] [--profile <id>] [--json]` |
| `kolux tab close` |  |  | `--index` `--worktree` |  | yes | `kolux tab close [--index <n>] [--worktree <selector>] [--json]` |
| `kolux exec` |  |  | `--command` `--worktree` |  | yes | `kolux exec --command "<agent-browser command>" [--worktree <selector>] [--json]` |

#### Browser navigation and capture (11)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux snapshot` |  |  | `--worktree` |  | yes | `kolux snapshot [--worktree <selector>] [--json]` |
| `kolux screenshot` |  |  | `--format` `--worktree` |  | yes | `kolux screenshot [--format <png\|jpeg>] [--worktree <selector>] [--json]` |
| `kolux scroll` |  |  | `--direction` `--amount` `--worktree` |  | yes | `kolux scroll --direction <up\|down> [--amount <pixels>] [--worktree <selector>] [--json]` |
| `kolux goto` |  |  | `--url` `--worktree` |  | yes | `kolux goto --url <url> [--worktree <selector>] [--json]` |
| `kolux back` |  |  | `--worktree` |  | yes | `kolux back [--worktree <selector>] [--json]` |
| `kolux reload` |  |  | `--worktree` |  | yes | `kolux reload [--worktree <selector>] [--json]` |
| `kolux eval` |  |  | `--expression` `--worktree` |  | yes | `kolux eval --expression <js> [--worktree <selector>] [--json]` |
| `kolux wait` |  |  | `--selector` `--timeout` `--text` `--url` `--load` `--fn` `--state` `--worktree` |  | yes | `kolux wait [--selector <sel>] [--timeout <ms>] [--text <text>] [--url <pattern>] [--load <state>] [--fn <js>] [--state <hidden\|visible>] [--worktree <selector>] [--json]` |
| `kolux pdf` |  |  | `--worktree` |  | yes | `kolux pdf [--worktree <selector>] [--json]` |
| `kolux full-screenshot` |  |  | `--format` `--worktree` |  | yes | `kolux full-screenshot [--format <png\|jpeg>] [--worktree <selector>] [--json]` |
| `kolux forward` |  |  | `--worktree` |  | yes | `kolux forward [--worktree <selector>] [--json]` |

#### Browser interaction (25)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux click` |  |  | `--element` `--worktree` |  | yes | `kolux click --element <ref> [--worktree <selector>] [--json]` |
| `kolux fill` |  |  | `--element` `--value` `--worktree` |  | yes | `kolux fill --element <ref> --value <text> [--worktree <selector>] [--json]` |
| `kolux type` |  |  | `--input` `--worktree` |  | yes | `kolux type --input <text> [--worktree <selector>] [--json]` |
| `kolux select` |  |  | `--element` `--value` `--worktree` |  | yes | `kolux select --element <ref> --value <value> [--worktree <selector>] [--json]` |
| `kolux check` |  |  | `--element` `--worktree` |  | yes | `kolux check --element <ref> [--worktree <selector>] [--json]` |
| `kolux uncheck` |  |  | `--element` `--worktree` |  | yes | `kolux uncheck --element <ref> [--worktree <selector>] [--json]` |
| `kolux focus` |  |  | `--element` `--worktree` |  | yes | `kolux focus --element <ref> [--worktree <selector>] [--json]` |
| `kolux clear` |  |  | `--element` `--worktree` |  | yes | `kolux clear --element <ref> [--worktree <selector>] [--json]` |
| `kolux select-all` |  |  | `--element` `--worktree` |  | yes | `kolux select-all --element <ref> [--worktree <selector>] [--json]` |
| `kolux keypress` |  |  | `--key` `--worktree` |  | yes | `kolux keypress --key <name> [--worktree <selector>] [--json]` |
| `kolux hover` |  |  | `--element` `--worktree` |  | yes | `kolux hover --element <ref> [--worktree <selector>] [--json]` |
| `kolux drag` |  |  | `--from` `--to` `--worktree` |  | yes | `kolux drag --from <ref> --to <ref> [--worktree <selector>] [--json]` |
| `kolux upload` |  |  | `--element` `--files` `--worktree` |  | yes | `kolux upload --element <ref> --files <path,...> [--worktree <selector>] [--json]` |
| `kolux dblclick` |  |  | `--element` `--worktree` |  | yes | `kolux dblclick --element <ref> [--worktree <selector>] [--json]` |
| `kolux scrollintoview` |  |  | `--element` `--worktree` |  | yes | `kolux scrollintoview --element <ref> [--worktree <selector>] [--json]` |
| `kolux get` |  |  | `--what` `--element` `--worktree` |  | yes | `kolux get --what <property> [--element <ref>] [--worktree <selector>] [--json]` |
| `kolux is` |  |  | `--what` `--element` `--worktree` |  | yes | `kolux is --what <state> --element <ref> [--worktree <selector>] [--json]` |
| `kolux inserttext` |  |  | `--text` `--worktree` |  | yes | `kolux inserttext --text <text> [--worktree <selector>] [--json]` |
| `kolux mouse move` |  |  | `--x` `--y` `--worktree` |  | yes | `kolux mouse move --x <n> --y <n> [--worktree <selector>] [--json]` |
| `kolux mouse down` |  |  | `--button` `--worktree` |  | yes | `kolux mouse down [--button <left\|right\|middle>] [--worktree <selector>] [--json]` |
| `kolux mouse up` |  |  | `--button` `--worktree` |  | yes | `kolux mouse up [--button <left\|right\|middle>] [--worktree <selector>] [--json]` |
| `kolux mouse wheel` |  |  | `--dy` `--dx` `--worktree` |  | yes | `kolux mouse wheel --dy <n> [--dx <n>] [--worktree <selector>] [--json]` |
| `kolux find` |  |  | `--locator` `--value` `--action` `--text` `--worktree` |  | yes | `kolux find --locator <type> --value <text> --action <action> [--text <text>] [--worktree <selector>] [--json]` |
| `kolux download` |  |  | `--selector` `--path` `--worktree` |  | yes | `kolux download --selector <ref> --path <path> [--worktree <selector>] [--json]` |
| `kolux highlight` |  |  | `--selector` `--worktree` |  | yes | `kolux highlight --selector <ref> [--worktree <selector>] [--json]` |

#### Browser network and console capture (7)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux intercept enable` |  |  | `--patterns` `--worktree` |  | yes | `kolux intercept enable [--patterns <glob,...>] [--worktree <selector>] [--json]` |
| `kolux intercept disable` |  |  | `--worktree` |  | yes | `kolux intercept disable [--worktree <selector>] [--json]` |
| `kolux intercept list` |  |  | `--worktree` |  | yes | `kolux intercept list [--worktree <selector>] [--json]` |
| `kolux capture start` |  |  | `--worktree` |  | yes | `kolux capture start [--worktree <selector>] [--json]` |
| `kolux capture stop` |  |  | `--worktree` |  | yes | `kolux capture stop [--worktree <selector>] [--json]` |
| `kolux console` |  |  | `--limit` `--worktree` |  | yes | `kolux console [--limit <n>] [--worktree <selector>] [--json]` |
| `kolux network` |  |  | `--limit` `--worktree` |  | yes | `kolux network [--limit <n>] [--worktree <selector>] [--json]` |

#### Browser cookies (3)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux cookie get` |  |  | `--url` `--worktree` |  | yes | `kolux cookie get [--url <url>] [--worktree <selector>] [--json]` |
| `kolux cookie set` |  |  | `--name` `--value` `--domain` `--path` `--secure` `--httpOnly` `--sameSite` `--expires` `--worktree` |  | yes | `kolux cookie set --name <n> --value <v> [--domain <d>] [--path <p>] [--secure] [--httpOnly] [--sameSite <s>] [--expires <epoch>] [--worktree <selector>] [--json]` |
| `kolux cookie delete` |  |  | `--name` `--domain` `--url` `--worktree` | destructive | yes | `kolux cookie delete --name <n> [--domain <d>] [--url <u>] [--worktree <selector>] [--json]` |

#### Browser storage (6)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux storage local get` |  |  | `--key` `--worktree` |  | yes | `kolux storage local get --key <key> [--worktree <selector>] [--json]` |
| `kolux storage local set` |  |  | `--key` `--value` `--worktree` |  | yes | `kolux storage local set --key <key> --value <value> [--worktree <selector>] [--json]` |
| `kolux storage local clear` |  |  | `--worktree` | destructive | yes | `kolux storage local clear [--worktree <selector>] [--json]` |
| `kolux storage session get` |  |  | `--key` `--worktree` |  | yes | `kolux storage session get --key <key> [--worktree <selector>] [--json]` |
| `kolux storage session set` |  |  | `--key` `--value` `--worktree` |  | yes | `kolux storage session set --key <key> --value <value> [--worktree <selector>] [--json]` |
| `kolux storage session clear` |  |  | `--worktree` | destructive | yes | `kolux storage session clear [--worktree <selector>] [--json]` |

#### Browser environment (11)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux viewport` |  |  | `--width` `--height` `--scale` `--mobile` `--worktree` |  | yes | `kolux viewport --width <w> --height <h> [--scale <n>] [--mobile] [--worktree <selector>] [--json]` |
| `kolux geolocation` |  |  | `--latitude` `--longitude` `--accuracy` `--worktree` |  | yes | `kolux geolocation --latitude <lat> --longitude <lon> [--accuracy <n>] [--worktree <selector>] [--json]` |
| `kolux set device` |  |  | `--name` `--worktree` |  | yes | `kolux set device --name <device> [--worktree <selector>] [--json]` |
| `kolux set offline` |  |  | `--state` `--worktree` |  | yes | `kolux set offline [--state <on\|off>] [--worktree <selector>] [--json]` |
| `kolux set headers` |  |  | `--headers` `--worktree` |  | yes | `kolux set headers --headers <json> [--worktree <selector>] [--json]` |
| `kolux set credentials` |  |  | `--user` `--pass` `--worktree` |  | yes | `kolux set credentials --user <user> --pass <pass> [--worktree <selector>] [--json]` |
| `kolux set media` |  |  | `--color-scheme` `--reduced-motion` `--worktree` |  | yes | `kolux set media [--color-scheme <dark\|light>] [--reduced-motion <reduce\|no-preference>] [--worktree <selector>] [--json]` |
| `kolux clipboard read` |  |  | `--worktree` |  | yes | `kolux clipboard read [--worktree <selector>] [--json]` |
| `kolux clipboard write` |  |  | `--text` `--worktree` |  | yes | `kolux clipboard write --text <text> [--worktree <selector>] [--json]` |
| `kolux dialog accept` |  |  | `--text` `--worktree` |  | yes | `kolux dialog accept [--text <text>] [--worktree <selector>] [--json]` |
| `kolux dialog dismiss` |  |  | `--worktree` |  | yes | `kolux dialog dismiss [--worktree <selector>] [--json]` |

#### Browser profiles (7)

| Command | Aliases | Positional | Own flags | Marks | JSON | Usage |
|---|---|---|---|---|---|---|
| `kolux tab profile list` |  |  |  |  | yes | `kolux tab profile list [--json]` |
| `kolux tab profile create` |  |  | `--label` `--scope` `--no-ua-spoof` |  | yes | `kolux tab profile create --label <name> [--scope <isolated\|imported>] [--no-ua-spoof] [--json]` |
| `kolux tab profile delete` |  |  | `--profile` | destructive | yes | `kolux tab profile delete --profile <id> [--json]` |
| `kolux tab profile set` |  |  | `--profile` `--page` `--worktree` |  | yes | `kolux tab profile set (--page <id> \| --worktree <selector>) --profile <id> [--json]` |
| `kolux tab profile show` |  |  | `--page` `--worktree` |  | yes | `kolux tab profile show --page <id> [--worktree <selector>] [--json]` |
| `kolux tab profile use-default` |  |  | `--page` `--worktree` |  | yes | `kolux tab profile use-default --page <id> [--worktree <selector>] [--json]` |
| `kolux tab profile clone` |  |  | `--profile` `--page` `--worktree` |  | yes | `kolux tab profile clone --profile <id> [--page <id>] [--worktree <selector>] [--json]` |

### 2.7 Retired, held back

| Command | Alias | Contract |
|---|---|---|
| `kolux orchestration coordinator-start` | `kolux orchestration run` | Retired before the fork: prints a note pointing at the current orchestration skill and does nothing. Tier H, default skip. |
| `kolux orchestration coordinator-stop` | `kolux orchestration run-stop` | Same. |

### 2.8 Commands missing from root help (source only)

The capture lists 182 commands reachable from root help. A further 49 exist only in the command specs; their help was captured by calling each one directly. Keep or drop:

| Command | Kept? | Note |
|---|---|---|
| `kolux claude-teams` | keep | Kept; listed in 2.6. |
| `kolux terminal stop` | keep | Hidden and deprecated; kept so old scripts still work. Points callers at terminal close. |
| `kolux open-url` | drop | Not carried, see `DECISIONS.md`. |
| `kolux select-all` | keep | Kept; listed in 2.6. |
| `kolux pdf` | keep | Kept; listed in 2.6. |
| `kolux full-screenshot` | keep | Kept; listed in 2.6. |
| `kolux cookie get` | keep | Kept; listed in 2.6. |
| `kolux cookie set` | keep | Kept; listed in 2.6. |
| `kolux cookie delete` | keep | Kept; listed in 2.6. |
| `kolux viewport` | keep | Kept; listed in 2.6. |
| `kolux geolocation` | keep | Kept; listed in 2.6. |
| `kolux intercept enable` | keep | Kept; listed in 2.6. |
| `kolux intercept disable` | keep | Kept; listed in 2.6. |
| `kolux intercept list` | keep | Kept; listed in 2.6. |
| `kolux capture start` | keep | Kept; listed in 2.6. |
| `kolux capture stop` | keep | Kept; listed in 2.6. |
| `kolux console` | keep | Kept; listed in 2.6. |
| `kolux network` | keep | Kept; listed in 2.6. |
| `kolux agent hooks prepare-codex` | keep | Kept; listed in 2.6. |
| `kolux agent hooks status` | keep | Kept; listed in 2.6. |
| `kolux agent hooks off` | keep | Kept; listed in 2.6. |
| `kolux agent hooks on` | keep | Kept; listed in 2.6. |
| `kolux linear save-issue` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear list-issues` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear relation add` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear relation remove` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear issue` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear search` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear team list` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear team members` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear team states` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear team labels` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear project list` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear list` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear status set` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear assignee set` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear assignee clear` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear priority set` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear priority clear` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear estimate set` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear estimate clear` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear due-date set` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear due-date clear` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear label add` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear label remove` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear label set` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear comment add` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear attach` | drop | Not carried, see `DECISIONS.md`. |
| `kolux linear create` | drop | Not carried, see `DECISIONS.md`. |

### 2.9 Not carried

Each of these is not carried, see `DECISIONS.md`:

| Surface | Commands |
|---|---|
| kolux serve | 1 (headless server) |
| kolux environment | 4 (add, list, show, rm) |
| kolux host | 1 (list) |
| kolux vm | 1 (recipe doctor) |
| kolux emulator | 16 |
| kolux computer | 14 |
| kolux linear | 27 (all source only) |
| Project host setups | 6: project setups, setup-existing-folder, setup-clone, setup-create, setup-update, setup-delete |
| open-url | 1 (opens a link on a paired client) |
| Flags on kept commands | `--pairing-code`, `--environment` (global); `--linear-issue` on worktree create and set; `--project`, `--host` and `--project-host-setup` on worktree create and on automations create and edit; `--on` on orchestration worker-start; `--include-remote` on orchestration worker-list |

### 2.10 Cross-check with `spec/20-cli.md`

| Check | Result |
|---|---|
| Groups kept | Match: open, status, claude-teams, diagnostics, agent-context, account, skills, automations, project (list only), repo, worktree, file, terminal, orchestration, agent hooks, and the browser groups. |
| Dropped groups | Match the D cards: serve, remote targeting with environment, host and open-url, project host setups, WSL, vm, emulator, computer, linear. |
| terminal focus | An alias of terminal switch, not its own command: matches. |
| terminal stop | Hidden and deprecated in favour of terminal close: matches. |
| coordinator-start and coordinator-stop | Tier H, retired: matches 2.7. |
| Exit codes and JSON envelope | Match the grammar, envelope and exit code cards. |
| Gap | Neither the spec nor the manifest declares per-command result fields (2.4). |

Counts: 229 manifest rows (182 from help plus 49 source only, less the terminal focus alias and the linear placeholder). 71 rows dropped, 2 held, 156 kept.

### 2.11 Ship and release commands, project scripts

These two are not `kolux` commands and are not part of the installed app. They are the project's own scripts, run from a worktree of the Kolux repo, and Txais's ship habit and his skills type their flags (cards APP-058 and APP-059 in `spec/19-app-lifecycle.md`). How the rebuild launches them is its own choice; the flag spellings and the variable below are kept.

| Command | Flag or variable | Contract |
|---|---|---|
| Ship | `--main` | The work is finished: land it on main, on the remote and locally, then start the release job in the background. |
| Ship | `--no-release` | Only with `--main`: land on main but do not start the release job. |
| Ship | `--merge` with a branch name | After committing, merge that branch into the current one; a conflict undoes the merge and stops with nothing pushed. |
| Ship | `--dry-run` | Show the commit message that would be used, then commit nothing, push nothing and leave the changes unstaged. |
| Ship | `--model` with a model id | Choose the model that writes the commit message. |
| Ship | `--message` with text | Use this text as the commit message instead of the AI one (how version-bump commits are made). |
| Release job | `--dry-run` | Print-only rehearsal: show each step and the version it would pick, with no build and no publish. |
| Release job | `--no-publish` | Full rehearsal: build and smoke test as usual, but stop short of publishing the release. |
| Release job | `KOLUX_RELEASE_WORKTREE` | Environment variable: point the release job at a different build checkout instead of the dedicated release checkout. |

After a release, `kolux --version`, the installed app and the update manifest all report the same release version.

### 2.12 Cards that carry a CLI contract

These cards state a CLI contract. The rows of 2.6 spell out each command, and 2.7 to 2.9 say what is not carried; this table ties each card id to its contract so every carded contract has a home here.

| Card | Contract |
|---|---|
| CLI-001 | Help at every level: the word help, `--help`, `--version` and its one-letter form -v; `kolux help` followed by a command path and `--help` after the path both work (2.2). |
| CLI-002 | A flag's value may follow as the next word, after an equals sign, or be empty after an equals sign; every alias named in 2.3 and 2.6 is part of the typed interface. |
| CLI-004 | With `--json`, one envelope goes to standard output carrying the request id, success flag, result, error code, message, data and the runtime id in its metadata, with stable names and meanings; text errors go to standard error (2.4). |
| CLI-005 | Exit statuses 0, 1, 2 (shim refusal) and 75 (Windows hand-back from ask) keep their meaning (2.5). |
| CLI-006 | On Windows both entries `kolux.cmd` and `kolux.exe` exist, and the shim refuses with exit status 2 (2.1, 2.5). |
| CLI-007, CLI-039 | Every Kolux terminal carries `KOLUX_TERMINAL_HANDLE` and `KOLUX_PANE_KEY` under those names (5.5), so `kolux` works with no setup and orchestration knows who is calling; `--from` names the caller explicitly. |
| CLI-008 | The command is named kolux, and kolux-dev in development builds, registered in one install place per operating system (2.1). |
| CLI-009 | The repo, worktree and terminal selector prefixes of 2.3 are typed interface, and the current folder is the default selection. |
| CLI-011, APP-056 | `kolux open` starts the app or brings it to the front and waits until it is ready; it accepts `--json`. |
| CLI-012, APP-057 | `kolux status` reports whether the app and its runtime are up; scripts read its four state names from the JSON output, so they stay stable (2.5). |
| CLI-013, ORCH-041 | `kolux claude-teams` passes every following argument to Claude Code untouched and returns its exit status. |
| CLI-014, ACCT-031 | `kolux account add` with an optional `--agent` (claude, codex or another supported provider) and `kolux account list`, both with `--json`. |
| CLI-015, PROJ-010 | `kolux repo` list, add (`--path`), show (`--repo`), set-base-ref (`--repo`, `--ref`) and search-refs (`--repo`, `--query`, optional `--limit`), each with `--json`. |
| CLI-016, PROJ-011 | `kolux project list`, with `--json`; the only project command carried. |
| CLI-017, PROJ-078, ORCH-040 | `kolux worktree` list (`--repo`, `--limit`), show (`--worktree`), current and ps (`--limit`, sums up orchestration across worktrees), each with `--json`. |
| CLI-018, PROJ-077 | `kolux worktree create` with `--name` plus the optional `--repo`, `--agent`, `--prompt`, `--setup` (run, skip or inherit), `--base-branch`, `--issue`, `--comment`, `--parent-worktree` or `--no-parent`, `--run-hooks`, `--activate` and `--json`; the project, host, host-setup and Linear flags are not carried (2.9). See the note on `--run-hooks` below the table. |
| CLI-019, PROJ-078 | `kolux worktree set` with `--worktree` and the optional `--display-name`, `--issue`, `--comment`, `--workspace-status`, and `--parent-worktree` or `--no-parent`. |
| CLI-020, PROJ-077 | `kolux worktree rm`, also reachable as remove and delete, with `--worktree` and the optional `--force`, `--run-hooks` and `--json`. See the note on `--run-hooks` below the table. |
| CLI-021, PROJ-079, GIT-068 | `kolux worktree changes` and `kolux worktree overlap`, each with an optional `--worktree` selector and `--json`. |
| CLI-022, EDIT-042, GIT-069 | `kolux file open` with a path, `kolux file diff` with a path and an optional `--staged`, and `kolux file open-changed` with `--mode` set to edit, diff or both; the path may also be given as `--path`; all take `--worktree` (selectors id:, name:, branch:, issue:, path:, active and current) and `--json`. |
| CLI-023, TERM-125 | `kolux terminal list` and `kolux terminal show` with `--worktree`, `--limit`, `--include-visual-layouts` and `--terminal`. |
| CLI-024, TERM-125 | `kolux terminal read` with `--terminal`, `--cursor`, `--limit` and `--screen` (the screen as it looks now instead of the output history). |
| CLI-025, TERM-125, TERM-126 | `kolux terminal send` with `--terminal`, `--text`, `--enter`, `--interrupt`, `--wait-submit` with a number of seconds (confirms the agent took the prompt) and `--retry-request`; `kolux terminal wait` with `--for` set to exit or tui-idle, and `--timeout-ms`. |
| CLI-026, TERM-125 | `kolux terminal create`, split, rename and switch (focus is another name for switch) with `--worktree`, `--command`, `--title`, `--focus`, `--direction` (horizontal or vertical) and `--terminal`. |
| CLI-027, TERM-125, TERM-127 | `kolux terminal close` with `--terminal`, `--tab`, `--worktree` and `--all`; `kolux terminal stop` with `--worktree` stays as a hidden word. |
| CLI-028, CLI-029, AUTO-020 | `kolux automations` list, show, create, edit, remove, run and runs (runs takes an optional `--id`), with the flags of AUTO-001, AUTO-005, AUTO-007, AUTO-008 and AUTO-009 below, plus `--source-context`, `--help` and `--json`. |
| AUTO-001 | The timetable goes in `--trigger` or its alias `--schedule`: hourly, daily, weekdays, weekly, a five-field cron line or a recurrence rule; `--time` takes hours and minutes as HH:MM, `--day` takes 0 to 6 with Sunday as 0, and `--timezone` takes an IANA zone name. |
| AUTO-005 | Create and edit take `--name`, `--prompt`, `--provider` (codex, claude or gemini), `--repo` (an id:, name: or path: selector), `--workspace`, `--workspace-mode` (existing or new-per-run), `--base-branch`, and `--enabled` or `--disabled`. |
| AUTO-007 | `--missed-run-grace-minutes` on create and edit sets the grace window for runs missed while Kolux was away. |
| AUTO-008 | `--precheck` and `--precheck-timeout` on create and edit set the command that gates each run. |
| AUTO-009 | `--reuse-session` and `--fresh-session` on create and edit choose whether one agent session carries across runs. |
| CLI-030, ORCH-001, ORCH-002, ORCH-048 | `kolux orchestration run-create` with `--objective` and an optional `--from`; run-use with `--id`, an optional `--from` and `--takeover-legacy` (takes over a coordinator Run left by an older Kolux); run-current; run-list with `--limit` and `--cursor`; run-show with `--id`; the ones that change state take `--retry-request`, and all take `--json`. |
| CLI-031, ORCH-003, ORCH-006 | `kolux orchestration send` with `--subject`, `--to` (run:, dispatch:, a terminal handle or an @ group), `--body`, `--type` (status, dispatch, worker_done, merge_ready, escalation, handoff, decision_gate, question or heartbeat), `--priority` (normal, high or urgent), `--thread-id`, `--payload`, `--task-id`, `--dispatch-id`, `--outcome`, `--files-modified`, `--report-path`, `--phase`, `--run`, `--from` and `--retry-request`; `kolux orchestration reply` with `--id` and `--body`. |
| ORCH-004 | Group addresses for `--to`: @all, @idle, @worktree: followed by a worktree id, @claude, @codex, @cursor and @droid; each fans one message out to every matching agent. |
| CLI-032, ORCH-005 | `kolux orchestration check` with `--terminal`, `--run`, `--ack`, one of `--unread`, `--peek` or `--all`, `--types`, `--format`, `--wait` and `--timeout-ms`; `kolux orchestration inbox` with `--limit`, `--terminal` and `--full`. While it waits, check writes one keepalive line to standard error every 15 seconds: a JSON object with a true flag named keepalive (with a leading underscore) and, for scripts that still filter on it, the older flag named heartbeat in the same style, plus the elapsed and deadline times. |
| CLI-033, ORCH-029 | `kolux orchestration ask` with `--question` or `--resume`, and the optional `--to`, `--run`, `--options`, `--timeout-ms`, `--from`, `--dispatch-capability` and `--retry-request`; exit status 75 is the Windows hand-back. |
| CLI-034, ORCH-010, ORCH-011, ORCH-012, ORCH-013, ORCH-014 | `kolux orchestration task-create` (`--spec`, `--task-title`, `--display-name`, `--deps` as a JSON array, `--parent`, `--run`); task-list (`--status`, `--ready`, `--brief`, `--run`); task-update (`--id`, `--status` set to pending, ready, dispatched, completed, failed or blocked, `--result`); dispatch (`--task`, `--to`, `--inject`, `--dry-run`, `--return-preamble`); dispatch-show (`--task`, `--preamble`); all with `--json`. |
| CLI-035, ORCH-016, ORCH-017, ORCH-018, ORCH-019 | `kolux orchestration worker-start` with `--task` or `--spec`, `--worktree` (current, a selector, new-child or new-top-level), one of `--agent`, `--terminal` or `--tier` (major, deep, build or light), and the optional `--model`, `--effort`, `--name`, `--repo`, `--base-branch`, `--display-name`, `--comment`, `--setup`, `--retry-of`, `--timeout-ms`, `--task-title`, `--deps`, `--parent`, `--run`, `--from`, `--retry-request` and `--json`; it exits 0 when the worker is ready and 1 when the start failed or its outcome is unknown. |
| CLI-036, ORCH-020, ORCH-021, ORCH-022, ORCH-023, ORCH-024, ORCH-025, ORCH-026 | `kolux orchestration` worker-list (`--run`, `--terminal-state` set to active, reclaimable, retained, release_pending, release_unknown or released, `--cursor`, `--limit` from 1 to 100), worker-show, worker-read (`--source` set to auto, transcript or terminal, `--cursor`, `--limit`), worker-stop, worker-abandon, worker-release (answers released, already released, or release outcome unknown) and worker-retain, each with `--dispatch` and `--json`. |
| ORCH-015 | A worker reports with `kolux orchestration send` using `--type` worker_done, `--outcome` succeeded or failed, and the optional `--files-modified` and `--report-path`; a heartbeat is `--type` heartbeat. |
| CLI-037, ORCH-028 | `kolux orchestration gate-create` (`--task`, `--question`, `--options` as a JSON array), gate-resolve (`--id`, `--resolution`) and gate-list (`--task`, `--status` set to pending, resolved or timeout, `--run`, `--json`). |
| CLI-038, ORCH-030, ORCH-031 | `--retry-request` takes a UUID on every orchestration command that changes state and on terminal send, so a retried call never does the work twice; `kolux orchestration request-show` with `--request` answers completed, pending or absent; `kolux orchestration reset` takes `--all`, `--tasks` or `--messages`. |
| ORCH-065 | Every orchestration subcommand accepts `--json`. |
| ORCH-067 | Worker report commands (send and ask) carry the secret dispatch pass as `--dispatch-capability`; that option name stays, and any output that reads it back hides it. |
| CLI-040, STAT-003 | `kolux agent hooks status`, on and off, each with `--json`, plus prepare-codex. |
| CLI-041, APP-055 | `kolux diagnostics memory` prints a memory snapshot, with `--json` for machine output. |
| CLI-042 | `kolux agent-context` prints the schema version (1 at 0.15.0), the command count and one entry per command; the field names stay stable (2.4). |
| CLI-043, SKILL-030 | `kolux skills list` with `--json`; `kolux skills get` (alias show) with a topic or `--topic`, then `--full` or `--reference` with a name, plus `--references` and `--json`. |
| CLI-044, SKILL-031 | `kolux skills install` with `--skill` (repeatable), `--all`, `--agent` with one name or a comma-separated list, `--local`, `--dry-run` and `--json`; `kolux skills update` takes the same flags except `--agent`. |
| CLI-045, BROW-044, BROW-045, BROW-025 | `kolux tab` list, show, current, switch, create and close, and `kolux tab profile` list, create, delete, set, show, use-default and clone, with `--page`, `--index`, `--worktree`, `--profile`, `--label`, `--scope` (isolated or imported), `--show-profile`, `--focus` and `--url`; `--no-ua-spoof` on profile create sets native mode, which lets Google sign-in work inside the pane. |
| CLI-046, BROW-046, BROW-047 | The page verbs of 2.6 (goto, back, forward, reload, wait, eval, scroll, snapshot, screenshot, full-screenshot, pdf, click and the other element verbs, fill, type, inserttext, select, keypress, drag, upload, download, highlight, find, get, is and mouse) with `--element` references taken from a snapshot, `--value`, `--worktree` and `--page`. |
| CLI-047, BROW-048, BROW-049, BROW-050 | cookie get, set (with `--httpOnly` and `--sameSite`) and delete; storage local or session get, set and clear; viewport, geolocation, set device, offline, headers, credentials and media; intercept enable, disable and list; capture start and stop; console; network; clipboard read and write; dialog accept and dismiss. |
| BROW-042 | `kolux exec` with `--command` passes a helper command through to the worktree's visible browser tab; every browser command accepts `--worktree`, `--page` and `--json`. Which helper the rebuild wraps or pins is an owner decision; `--pairing-code` and `--environment` are not carried. |
| CLI-048, ORCH-046 | The retired words orchestration coordinator-start and coordinator-stop, and their aliases orchestration run and run-stop, answer with a pointer to the current orchestration skill and do nothing else (2.7). |
| GIT-049 | `kolux worktree create` and `kolux worktree set` take `--issue` with an issue or pull request number. |
| PROJ-025 | The project host-setups group, which held the CLI route for setting a project's own workspaces folder, is not carried (2.9). The folder is set on the per-repository settings page with no CLI route (`DECISIONS.md` OD-07); if OD-07 is flipped, the new `kolux` command is added here first. |
| PROJ-096 | The project host-setup words (project setups, setup-existing-folder, setup-clone, setup-create, setup-update and setup-delete) are not carried (2.9). |
| ORCH-050 | `--on` on worker-start and `--include-remote` on worker-list leave with remote workers. |
| GIT-078 | The `kolux linear` group is not carried; scripts that call it fail (2.8). |
| BROW-060 | `kolux open-url` is not carried (2.8). |
| BROW-062 | The `kolux computer` group (capabilities, list-apps, permissions, list-windows, get-app-state, click, perform-secondary-action, scroll, drag, type-text, press-key, hotkey, paste-text and set-value) is not carried (2.9). |

Note on `--run-hooks`: kept on both commands, as CLI-018, CLI-020 and the 2.6 rows say (settled 2026-10-06; PROJ-077 was corrected to match). On worktree create it is the older spelling that runs setup and activates the worktree; on worktree rm it runs the kolux.yaml archive script, which the CLI otherwise skips (`DECISIONS.md` OD-14).

## 3. Hook events per agent

Kolux learns what an agent is doing (working, blocked, waiting for Txais, done) from hooks: small commands that the agent CLI itself runs at moments like "a prompt was submitted" or "a tool is about to run". Kolux writes those hook entries into the agent's own config file, which belongs to the user.

### 3.1 The stdin and stdout contract

- The agent starts the hook command and writes one JSON payload to its stdin, as that agent's hook docs define it.
- The hook reads all of stdin and sends it to Kolux over HTTP on the loopback address, at a per-agent path, on the port given by `KOLUX_AGENT_HOOK_PORT`, with `KOLUX_AGENT_HOOK_TOKEN` as a header. A second header carries pane identity: pane key, tab id, launch token, worktree id, hook environment and hook version, base64-encoded.
- Timeouts are short: half a second to connect, one and a half seconds in all. Proxies are bypassed for the loopback address.
- Guard first: if the port, the token or `KOLUX_PANE_KEY` is missing, the hook is running outside a Kolux pane. It exits 0 at once without reading stdin, because outside Kolux the caller may hold stdin open and a read would hang.
- The hook always exits 0 and never blocks the agent. Its stdout is empty unless the agent needs an answer: Gemini gets an empty JSON object; Cursor gets "continue" on `beforeSubmitPrompt` and an empty object otherwise (its permission events `preToolUse`, `beforeShellExecution` and `beforeMCPExecution` are never installed, DT-C49; an older Cursor hook file that still posts `beforeShellExecution` or `beforeMCPExecution` to the Cursor hook address gets {"permission":"ask"}, and `preToolUse` stays an empty object); the Antigravity ask tools get a decision of "ask" so the agent shows its own prompt; Amp's plugin returns "allow" on tool calls. Codex's `PermissionRequest` hook returns no decision, so Codex still shows its own approval screen.
- A small endpoint file in Kolux's data folder holds the current port and token. Hooks read it on each run, so a terminal that outlives a Kolux restart still reaches the current server.
- On macOS and Linux, a hook that cannot reach Kolux spools the payload to a per-pane file under the endpoint folder (folder mode 700, file mode 600, 5 MB cap, cleared after 7 days; tool events are not spooled). On Windows the hook holds every event, tool events included, with names only: event, tool and session names and the few flags the status rules read, never the tool input, output, prompt or reply (the holding line in hooks.rs). Kolux replays the spool when it comes back.
- On Windows, an event that Windows PowerShell cannot parse (keys that differ only in case, for one) is held with its event and session names only, read from the top-level keys that come before the first nested object; when a nested object such as the tool's input comes first, the event is dropped rather than risk a word of it. The held append waits out another hook that holds the file (up to two seconds); any other failure, a missing holding folder for one, gives up at once. A held event costs the agent about half a second to a second of PowerShell start-up on top of the hook's own short timeouts; an event that reaches Kolux pays none of it.
- Replay is weaker for STAT-029: the prompt text is never held, so a machine-written continuation prompt sent after a compaction, held while Kolux was closed, replays as a new turn; the state after its Stop is the same.
- A record saying Kolux created an agent's hooks file that was written by a build before hooks FIX-3 (it reads as missing rather than created) is not honoured, failing closed: the file counts as the user's own and the next start refuses it once as already holding Kolux's entries; hooks off then on clears that. For Codex such a build may leave a hooks file that holds an empty set of hooks (not a zero-byte file, which Kolux would refuse as not JSON) and its record in the Codex home; both are harmless (Codex reads an empty set of hooks as no hooks, and Kolux reads the record when it installs or takes its hooks out, without honouring it).

### 3.2 Windows wrapper behaviour

- Each agent gets a batch script in `~/.kolux/agent-hooks` (or a plugin where the agent uses plugins). The agent's config entry points at that script by full path. (Kolux RS, DT-C1: `~/.kolux-rs/agent-hooks` while the old app is installed beside it.)
- The script runs the guard above before it touches stdin, then reads stdin with the system's built-in pager program called by its full Windows path, so a same-named program in the repo cannot capture the payload.
- It sends with the system curl, then exits 0, then drains any leftover stdin so the agent never sees a broken pipe.
- Claude: when Git Bash is present, the settings entry calls the batch script directly; otherwise it goes through an encoded PowerShell launcher. The Claude script skips itself when the Devin project variable is set, because Devin re-runs Claude hooks. (Kolux RS, DT-C4: not built, the variable's name is not public.)
- OpenClaude uses the same script shape without the PowerShell launcher.
- Gemini's script prints an empty JSON object first, then does the rest.
- Antigravity gets one small script per event, each calling one shared script.
- Copilot uses a PowerShell script in the PowerShell slot of its hook file (5 second timeout); on other systems the bash slot.
- Kimi runs a bash script through Git Bash, with a forward-slash path.
- Amp, Hermes and MiMo Code use plugins (Amp and MiMo Code in JavaScript, Hermes in Python) that post straight to Kolux, so no batch script is involved.

### 3.3 What an event can change in the status model

| Part of the status | Meaning |
|---|---|
| State | One of working, blocked, waiting or done. Working can carry a "monitoring" mode when a background task or scheduled check keeps the agent busy after its turn. |
| Prompt | The last prompt text, used as the row title. |
| Tool in flight | Tool name and a short form of its input, set before a tool runs and cleared after. |
| Interactive prompt | The question shown when the agent waits on Txais. |
| Last reply | The last assistant message, and the last completed one. |
| Interrupted | Set when the turn ended because Txais cancelled it. |
| Session boundary | Marks a fresh session (start, resume, clear or manual compact) so stale state is wiped. |
| Stop cause | On blocked: limit, auth or provider-error, plus a reset time when the agent sends one. |
| Sub-agents and teammates | A roster: id, agent type, model, description, state (working, blocked, waiting or idle) and start time. A lead stays working while any child works. |
| History | The last 20 states with prompt, start time and the interrupted flag. |

Kolux also installs a Claude status-line command, only when the user's own status-line slot is empty, with a marker so that a user who removes it is not overridden again. It forwards `rate_limits` and `context_window` from Claude's status-line payload to the usage meter, throttled.

### 3.4 Agents, config files and events

| Agent | Config file the user owns | Events Kolux installs | Mapped but not installed |
|---|---|---|---|
| Claude | `~/.claude/settings.json`, or the folder named by `CLAUDE_CONFIG_DIR` | 12: `SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `TeammateIdle`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PostCompact` (tool events match every tool) | `PreCompact` (never installed, refused if it arrives) |
| OpenClaude | `~/.openclaude/settings.json` | Same 12 as Claude | `PreCompact` |
| Codex | Kolux's own Codex home under `%APPDATA%\kolux\codex-runtime-home`, plus `~/.codex/hooks.json` and the hook trust entries in `~/.codex/config.toml` (Kolux RS, DT-C3: the entries are written with the keys and fingerprints Codex's own `hooks/list` reports; a user-level key is the `hooks.json` path, the event label, the group index and the handler index) | 8: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop` | none |
| Gemini | `~/.gemini/settings.json` | 4: `BeforeAgent`, `AfterAgent`, `BeforeTool`, `AfterTool` | `PreToolUse`, `PostToolUse` (old entries are swept out) |
| Antigravity | `~/.gemini/config/hooks.json`, inside one named bundle (kolux-status) | 5: `PreInvocation`, `PostInvocation`, `Stop`, `PreToolUse`, `PostToolUse` | none |
| Amp | A plugin file in `~/.config/amp/plugins` | 5: `session.start`, `agent.start`, `tool.call`, `tool.result`, `agent.end` | none |
| Cursor | `~/.cursor/hooks.json` | 5: `beforeSubmitPrompt`, stop, `postToolUse`, `postToolUseFailure`, `afterAgentResponse` | `preToolUse`, `beforeShellExecution`, `beforeMCPExecution` (DT-C49), `sessionStart`, `sessionEnd` |
| Droid | `~/.factory/settings.json` | 8: `SessionStart`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Notification` | none |
| Command Code | `~/.commandcode/settings.json` | 3: `PreToolUse`, `PostToolUse`, `Stop` | none |
| Grok | `~/.grok/hooks/kolux-status.json`, or the same under `GROK_HOME` | 9: `SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Notification` | none |
| GitHub Copilot | `~/.copilot/hooks/kolux.json`, or the same under `COPILOT_HOME` | 13: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, Copilot's lower-case-first subagent-start event, `SubagentStop`, `PreCompact`, `Stop`, `ErrorOccurred`, `PermissionRequest`, `Notification` | none |
| Hermes | A kolux-status plugin folder under `~/.hermes/plugins` (or the Hermes home variable), enabled in `~/.hermes/config.yaml` | 10: `on_session_start`, `pre_llm_call`, `post_llm_call`, `pre_tool_call`, `post_tool_call`, `pre_approval_request`, `post_approval_response`, `on_session_end`, `on_session_finalize`, `on_session_reset` | none |
| Devin | `%APPDATA%\devin\config.json` on Windows, `~/.config/devin/config.json` elsewhere | 8: `SessionStart`, `UserPromptSubmit`, `Stop`, `PostCompaction`, `SessionEnd`, `PreToolUse`, `PostToolUse`, `PermissionRequest` | none |
| Kimi | `~/.kimi-code/config.toml`, or the same under `KIMI_CODE_HOME`, in a block between Kolux marker lines | 7: `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `Stop`, `StopFailure` | none |
| MiMo Code | Not a hook target. A status plugin in Kolux's data folder, loaded through a per-terminal MiMo home overlay | 5 status signals (3.5) | n/a |

Every installer must find and replace only its own entries (identified by the Kolux script path or marker), leave the user's other hooks alone, and remove its entries when hooks are turned off with `kolux agent hooks off`.

Pi, OMP and Prime Agent report status through Kolux-managed extensions loaded by the agent, not through hook files, so they are not in this table.

### 3.5 Event to status, per agent (123 rows)

Claude and OpenClaude (13 rows each, same mapping; OpenClaude sends `StopFailure` instead of `Stop` after model errors):

| Event | Status effect |
|---|---|
| `SessionStart` | done with a session boundary when the source is startup, resume or clear and the event is not from a sub-agent; resets the roster, tasks and scheduled checks. Otherwise no change. |
| `UserPromptSubmit` | working; ignored when it is the automatic continuation after a compact. |
| `Stop` | done, interrupted when the interrupt flag is set; stays working (monitoring) while a sub-agent works or a background task or scheduled check is live. |
| `StopFailure` | blocked with a stop cause: rate limit gives limit; authentication failure, org not allowed or verification required give auth; anything else gives provider-error. Parses a reset time. No change when interrupted. |
| `SubagentStart` | adds a working child to the roster and re-sends the lead's state with the child list. |
| `SubagentStop` | finishes the child (a teammate is parked idle) and re-sends the lead's state. |
| `TeammateIdle` | parks the named teammate idle (turn over, waiting for mail) and re-sends the lead's state. |
| `PreToolUse` | working with the tool in flight; waiting when the tool is the ask-the-user tool or `ExitPlanMode`. |
| `PostToolUse` | working; keeps an open question visible if a parallel tool finished. |
| `PostToolUseFailure` | working, same handling as `PostToolUse`. |
| `PermissionRequest` | waiting; stays visible until the same tool resumes, a new prompt arrives or the child ends. |
| `PostCompact` | done with a session boundary only for a manual compact; automatic compacts change nothing. |
| `PreCompact` | Not installed and refused on arrival. |

Codex (8):

| Event | Status effect |
|---|---|
| `SessionStart` | working; clears the roster and transcript for the pane. |
| `UserPromptSubmit` | working; starts a new turn. |
| `PreToolUse` | working with the tool in flight; waiting for Codex's ask-the-user tool. From a sub-agent, updates that child. |
| `PermissionRequest` | waiting; returns no decision so Codex shows its own approval screen. |
| `PostToolUse` | working. |
| `SubagentStart` | adds a working child (type and model); the lead's state follows the roster. |
| `SubagentStop` | finishes the child; the lead's state follows the roster. |
| `Stop` | done, unless the roster keeps the lead working. |

Gemini (6):

| Event | Status effect |
|---|---|
| `BeforeAgent` | working; starts a new turn. |
| `BeforeTool` | working with the tool in flight. |
| `AfterTool` | working. |
| `AfterAgent` | done. |
| `PreToolUse` | Mapped to working but not installed. |
| `PostToolUse` | Mapped to working but not installed. |

Antigravity (5):

| Event | Status effect |
|---|---|
| `PreInvocation` | working; starts a new turn; the prompt is read from the transcript. |
| `PostInvocation` | working; ignored once the transcript has completed. |
| `Stop` | done only when the agent reports it is fully idle, otherwise working. |
| `PreToolUse` | working; waiting for the ask-question and ask-permission tools (reply: decision "ask"). |
| `PostToolUse` | working; ignored after a completed stop for the same transcript. |

Amp (5):

| Event | Status effect |
|---|---|
| `session.start` | No change; clears the turn cache for the thread. |
| `agent.start` | working; starts a new turn with the message as prompt. |
| `tool.call` | working; plugin answers "allow". |
| `tool.result` | working. |
| `agent.end` | done; interrupted when the status is cancelled. |

Cursor (10):

| Event | Status effect |
|---|---|
| `beforeSubmitPrompt` | working; answers "continue". |
| stop | done; interrupted when the status is not "completed". |
| `preToolUse` | working with the tool in flight; mapped, not installed (DT-C49). |
| `postToolUse` | working. |
| `postToolUseFailure` | working. |
| `beforeShellExecution` | working; mapped, not installed (DT-C49); an older file that still posts it gets the answer "ask". |
| `beforeMCPExecution` | working; mapped, not installed (DT-C49); an older file that still posts it gets the answer "ask". |
| `afterAgentResponse` | done only if Cursor's previous status was already done. |
| `sessionStart` | Mapped to working but not installed. |
| `sessionEnd` | Mapped to done but not installed. |

Droid (8):

| Event | Status effect |
|---|---|
| `SessionStart` | No change. |
| `UserPromptSubmit` | working. |
| `Stop` | done. |
| `SubagentStop` | No change. |
| `PreToolUse` | working; waiting for the ask-the-user tool or a high-risk tool. |
| `PostToolUse` | working. |
| `PermissionRequest` | waiting. |
| `Notification` | waiting, done or no change, depending on the message. |

Command Code (3):

| Event | Status effect |
|---|---|
| `PreToolUse` | working. |
| `PostToolUse` | working. |
| `Stop` | done. |

Grok (9):

| Event | Status effect |
|---|---|
| `SessionStart` | No change. |
| `UserPromptSubmit` | working; starts a new turn. |
| `Stop` | done. |
| `StopFailure` | done. |
| `SessionEnd` | done. |
| `PreToolUse` | working; waiting for the ask-question tool. |
| `PostToolUse` | working. |
| `PostToolUseFailure` | working. |
| `Notification` | Depends on the message. |

GitHub Copilot (13):

| Event | Status effect |
|---|---|
| `SessionStart` | working. |
| `SessionEnd` | done. |
| `UserPromptSubmit` | working. |
| `PreToolUse` | working; blocked for the ask-the-user tool. |
| `PostToolUse` | working. |
| `PostToolUseFailure` | working. |
| Subagent start (lower-case-first name) | No change. |
| `SubagentStop` | No change. |
| `PreCompact` | No change. |
| `Stop` | done. |
| `ErrorOccurred` | working if recoverable, otherwise done. |
| `PermissionRequest` | working; blocked for the ask-the-user tool. |
| `Notification` | blocked for a permission prompt or a question dialog, otherwise no change. |

Hermes (10):

| Event | Status effect |
|---|---|
| `on_session_start` | working; starts a new turn. |
| `pre_llm_call` | working; starts a new turn. |
| `post_llm_call` | done. |
| `pre_tool_call` | working with the tool in flight. |
| `post_tool_call` | working. |
| `pre_approval_request` | waiting. |
| `post_approval_response` | working. |
| `on_session_end` | done. |
| `on_session_finalize` | done. |
| `on_session_reset` | done. |

Devin (8):

| Event | Status effect |
|---|---|
| `SessionStart` | No change. |
| `UserPromptSubmit` | working; starts a new turn. |
| `Stop` | done; interrupted when flagged. |
| `PostCompaction` | working. |
| `SessionEnd` | done. |
| `PreToolUse` | working. |
| `PostToolUse` | working. |
| `PermissionRequest` | waiting. |

Kimi (7):

| Event | Status effect |
|---|---|
| `UserPromptSubmit` | working. |
| `PreToolUse` | working; waiting for the ask-question tool. |
| `PostToolUse` | working. |
| `PostToolUseFailure` | working. |
| `PermissionRequest` | waiting. |
| `Stop` | done; interrupted when flagged. |
| `StopFailure` | blocked with a stop cause (limit, auth or provider-error), or done when none applies. |

MiMo Code (5 status signals from its own plugin events):

| MiMo event | Status effect |
|---|---|
| Session status busy or retrying (`session.status`) | working; not a new turn. |
| `session.idle` | done, after the last reply part is flushed. |
| A message part update | working; a user part starts a new turn and counts as the prompt. |
| `permission.asked` | waiting; cleared by `permission.replied`. |
| `question.asked` | waiting; cleared by `question.replied` or `question.rejected`. |

Verified against the old source for five agents (50 rows): Claude 13, OpenClaude 13 (it reuses the Claude installer and event list with its own config folder), Codex 8, Gemini 6 and Cursor 10. The other rows come from the hook-events registry as captured.

### 3.6 Cards that carry a hook or agent-config contract

| Card | Contract |
|---|---|
| STAT-001 | The hook listener answers on the loopback address only; every terminal Kolux opens is handed the port, token and pane identity the hooks need (3.1, 5.5). The events per agent are in 3.4. |
| STAT-005 | Installers recognise and remove the entries the old app wrote, so after an upgrade each event holds one Kolux entry, not two, and the user's own entries stay untouched (3.4). |
| STAT-007 | Claude Code and OpenClaude: the 12 events of 3.4 in the user settings, following Claude Code's config-folder override (`CLAUDE_CONFIG_DIR`) when the user has set one. |
| STAT-008 | Codex: the 8 events of 3.4, with hook trust recorded in Codex's own TOML settings. |
| STAT-009 | Gemini CLI: the 4 events of 3.4; the older pre-tool and post-tool entries are recognised and swept out. |
| STAT-010 | Antigravity: the 5 events of 3.4 in its hooks file, inside one named Kolux bundle. |
| STAT-011 | Amp: a Kolux plugin in Amp's plugins folder handling the 5 events of 3.4. |
| STAT-012 | Cursor Agent: the 5 installed events of 3.4, in Cursor's own naming style; the card and 3.4 agree that session start, session end and the three permission events (DT-C49) are mapped but not installed. |
| STAT-013 | Droid: the 8 events of 3.4 in its settings. |
| STAT-014 | Command Code: the 3 tool and stop events of 3.4; the rest of its status is read from its transcript. |
| STAT-015 | Kimi: the 7 events of 3.4, in one block between Kolux marker lines in Kimi's TOML settings. |
| STAT-016 | Hermes: a Kolux plugin using the 10 hook points of 3.4 (session start; before and after each model call and each tool call; before an approval request and after its answer; session end, finalise and reset), switched on in Hermes's YAML settings. |
| STAT-017 | GitHub Copilot: the hook file in Copilot's home folder, honouring `COPILOT_HOME`, with the 13 events of 3.4. |
| STAT-018 | Grok: a dedicated global hook file in Grok's home folder, or under `GROK_HOME`, with the 9 events of 3.4; Kolux removes that file when it quits. |
| STAT-019 | Devin: the 8 events of 3.4 in Devin's settings file, which may hold comments that must survive the edit. |
| STAT-020 | MiMo Code: a status plugin in a Kolux overlay home that reports busy, idle, message-part, permission and ask-the-user signals (3.5). |
| STAT-034 | In-band status: a program may print escape, a right bracket, 9999, a semicolon, a JSON status payload, then BEL or escape and backslash. The rebuild accepts the same sequence number, removes the sequence before the text is drawn, drops a malformed payload or an unknown state, and never lets an in-band update erase details that only hooks provide. |
| SAFE-001 | Claude Code sends the plan text inside the tool input of its exit-plan tool, on both the `PreToolUse` and the `PermissionRequest` event; Kolux reads it from either. |
| SAFE-009 | The reply to Claude Code's `PreToolUse` is either an empty JSON object, meaning no opinion, or a hook-specific output block that names the event, sets the permission decision to ask and gives a reason. Kolux reads the tool name (Bash or PowerShell) and the command from the tool input, and accepts both form-encoded and raw JSON hook bodies. |
| SAFE-020 | The installed Claude safety hook prints exactly one JSON object, either empty or the ask reply of SAFE-009, so it can only make Claude ask; the settings file it reads stays private to the user. |
| SAFE-023 | Every new worktree is pre-trusted in the agents' own configuration at its real, resolved path, so the first prompt is not lost. Cursor: a small hidden workspace-trust marker file in that worktree's folder under `~/.cursor/projects`, the folder named by the path with leading slashes dropped and every run of slashes, backslashes, colons and other characters a file name cannot hold turned into one dash; it holds the trust time and the path and is written only when absent. Copilot: the path is added to the trusted-folders list in `~/.copilot/config.json`, compared after resolving, and a corrupt file is never overwritten. Codex: a projects entry for the path with trust level trusted, written to `~/.codex/config.toml` and to the managed Codex home's configuration. Claude Code: the trust-accepted flag on that path's project entry in Claude Code's user configuration file in the home folder (or in `CLAUDE_CONFIG_DIR`), keyed with forward slashes on Windows, one entry per worktree, with writes batched so worktrees launched together are not lost. |
| USAGE-021 | Claude's status-line command (3.3) forwards the plan windows with their reset times (`rate_limits`), the context window (`context_window`) and the config folder the session runs under. |

## 4. Keybindings

### 4.1 The file

| Fact | Contract |
|---|---|
| Location | `~/.kolux/keybindings.json` (on Windows, the .kolux folder in the user's home). Created empty when Settings first needs it. |
| Shape | One JSON object. Recognised top-level keys: "$schema" (ignored), version (the number 1), keybindings (overrides for every platform) and platforms (an object with darwin, linux and win32 sections, each holding overrides for that platform only). |
| An override | Action id mapped to one chord (a string), several chords (an array of strings), or null or false to unbind it. |
| Older form | When the keybindings key is missing, action ids at the top level are read as the all-platforms section. |
| Precedence | The built-in default for this platform, then the all-platforms section, then this platform's section. The platform section wins. |
| Errors | A file that is not a JSON object, or will not parse, is reported and defaults are used. An unknown action id or platform name is a warning and is ignored. A bad chord for one id is an error for that id only. |
| Writing | Settings writes a single action into the active platform's section and keeps the rest of the file as it was. It can also reload the file, open it in an editor and show it in the file manager. No file watcher was found in the old source; reload is explicit. |
| Upgrade seeding | On upgrade, the old tab-switching chords were written into the active platform's section, one action at a time, so people kept the shortcuts they had learned. |

Txais's file today: version 1; empty all-platforms, darwin and linux sections; a win32 section with 13 overrides, 12 of them for ids in the table below plus `voice.dictation`, which belongs to the speech feature that is not carried. The importer leaves unknown ids in the file; the app warns and ignores them.

### 4.2 Chords, contexts and conflicts

- Chords are modifier names and one key joined by +, for example Mod+Shift+ArrowUp. Mod means Ctrl on Windows and Linux and Cmd on macOS. A chord may use Mod or a platform-specific modifier, not both.
- The two digit-index actions (`workspace.selectByIndex`, `tab.selectByIndex`) take a chord ending in 1 and cover 1 to 9; another digit is rewritten to 1.
- Each action has a scope: global, tabs, browser, editor, file explorer, settings or terminal. A shortcut fires only where its scope is active, so one chord can serve several scopes (Mod+F finds in the browser, editor, settings and terminal).
- A few actions also belong to a conflict group, checked as well as the scope: menu (`app.settings`, `app.forceReload`), workspace-shell (`workspace.rename`, `tab.rename`), global (only `tab.openQuickCommandsMenu`, which is not carried, see `DECISIONS.md`, so the rebuild has no global group) and editor (`sourceControl.sendReviewNotes`).
- Conflict reporting: after merging, any custom override that collides with another binding in the same bucket is dropped and the default stays. One error lists the dropped actions by title; the check repeats until no conflict is left. Only conflicts that involve at least one customised action are reported; overlaps between defaults are by design and silent.
- Inside terminals, some actions follow a terminal shortcut policy so the chord reaches the program in the terminal when that program needs it (copy versus interrupt, for example).

### 4.3 Every action id (129)

Windows default shows every chord the action answers to. "Ships unbound" means no default on any platform; 51 actions ship unbound, including `sessions.add`, `sessions.remove` and all 35 per-agent new-tab actions. Six more have a macOS default but none on Windows; their Windows cell says so.

Three rows are not carried, see `DECISIONS.md`: `tab.newSimulator` (the mobile emulator went with remote and hosts), `tab.openQuickCommandsMenu` (the quick commands menu was cut) and `sidebar.ports.toggle` (deleted 2026-10-30 by T-611, DT-C53: its Ports tab went with remote hosts, VIEW-079). They stay in this table only so an old keybindings file that names them still loads: the rebuild registers none of these ids and wires no shortcut for any, so each is an unknown id, warned about and ignored, as `voice.dictation` is. The 129 count above includes them.

| Action id | Title | Windows default | Ships unbound |
|---|---|---|---|
| `worktree.quickOpen` | Go to File | Mod+P | no |
| `app.settings` | Open Settings | Mod+Comma | no |
| `app.forceReload` | Force Reload | Mod+Shift+R | no |
| `worktree.palette` | Switch worktree | Mod+Shift+J | no |
| `worktree.navigateUp` | Previous worktree | Mod+Shift+ArrowUp | no |
| `worktree.navigateDown` | Next worktree | Mod+Shift+ArrowDown | no |
| `workspace.create` | Create worktree | Mod+N, Mod+Shift+N | no |
| `workspace.rename` | Rename worktree | none on Windows (macOS: Mod+Alt+R) | no |
| `workspace.delete` | Delete Workspace | Mod+Shift+Backspace | no |
| `workspace.openBoard` | Show Workspace Statuses (was "Toggle Workspace Board"; renamed by T-610, the id is unchanged) | none | yes |
| `dashboard.toggle` | Toggle Agent Dashboard | none | yes |
| `workspace.selectByIndex` | Select Workspace 1–9 | Mod+1 | no |
| `view.tasks` | Open Tasks | none | yes |
| `sidebar.left.toggle` | Toggle Sidebar | Mod+B | no |
| `sidebar.right.toggle` | Toggle Right Sidebar | Mod+L | no |
| `sidebar.explorer.toggle` | Show Explorer | Mod+Shift+E | no |
| `sidebar.search.toggle` | Show Search | Mod+Shift+F | no |
| `sidebar.sourceControl.toggle` | Show Source Control | Mod+Shift+G | no |
| `sidebar.checks.toggle` | Show Checks | none | yes |
| `sidebar.ports.toggle` (not carried since T-611, see `DECISIONS.md` DT-C53) | Show Ports | none on Windows (macOS: Mod+Shift+I) | no |
| `sidebar.sleepingWorkspaces.toggle` | Toggle Sleeping Workspaces | none | yes |
| `sidebar.focusWorktreeList` | Focus worktree list | Mod+Shift+0 | no |
| `floatingTerminal.toggle` | Toggle Floating Terminal | Mod+Alt+A | no |
| `floatingWorkspace.maximize` | Maximize Floating Workspace Panel | none on Windows (macOS: Mod+Alt+Shift+A) | no |
| `view.inbox` | Show Inbox | none | yes |
| `view.floor` | Show Floor | none | yes |
| `view.code` | Show Code | Mod+Shift+3 | no |
| `floatingWorkspace.minimize` | Minimize Floating Workspace Panel | none | yes |
| `zoom.in` | Zoom In | Mod+Equal, Mod+Shift+Plus, Mod+NumpadAdd | no |
| `zoom.out` | Zoom Out | Mod+Minus, Mod+NumpadSubtract | no |
| `zoom.reset` | Reset Size | Mod+0 | no |
| `worktree.history.back` | Worktree History Back | Mod+Alt+ArrowLeft | no |
| `worktree.history.forward` | Worktree History Forward | Mod+Alt+ArrowRight | no |
| `tab.newTerminal` | New terminal tab | Mod+T | no |
| `tab.newAgent` | New agent tab (default agent) | none on Windows (macOS: Mod+Alt+T) | no |
| `tab.newBrowser` | New browser tab | Mod+Shift+B | no |
| `tab.newSimulator` (not carried, see `DECISIONS.md`) | New mobile emulator tab | none on Windows (macOS: Mod+Alt+Shift+E) | no |
| `tab.newMarkdown` | New markdown tab | Mod+Shift+M | no |
| `tab.openMarkdown` | Open markdown tab | Mod+Shift+O | no |
| `tab.close` | Close active tab | Mod+W | no |
| `tab.closeAll` | Close all editor tabs | Mod+Alt+W | no |
| `tab.rename` | Rename active tab | none on Windows (macOS: Mod+R) | no |
| `tab.reopenClosed` | Reopen closed tab | Mod+Shift+T | no |
| `tab.nextSameType` | Next tab (same type) | Mod+Alt+BracketRight | no |
| `tab.previousSameType` | Previous tab (same type) | Mod+Alt+BracketLeft | no |
| `tab.nextAllTypes` | Next tab (all types) | Mod+Shift+BracketRight | no |
| `tab.previousAllTypes` | Previous tab (all types) | Mod+Shift+BracketLeft | no |
| `tab.previousRecent` | Previous recent tab | Ctrl+Tab | no |
| `tab.nextTerminal` | Next terminal tab | Ctrl+PageDown | no |
| `tab.previousTerminal` | Previous terminal tab | Ctrl+PageUp | no |
| `tab.selectByIndex` | Select Tab 1–9 | Alt+1 | no |
| `tab.openQuickCommandsMenu` (not carried, see `DECISIONS.md`) | Toggle Quick Commands menu | none | yes |
| `browser.find` | Find in Browser | Mod+F | no |
| `browser.back` | Go Back in Browser | Alt+ArrowLeft | no |
| `browser.forward` | Go Forward in Browser | Alt+ArrowRight | no |
| `browser.reload` | Reload Browser Page | Mod+R | no |
| `browser.hardReload` | Hard Reload Browser Page | Mod+Shift+R | no |
| `browser.focusAddressBar` | Focus Browser Address Bar | Mod+L | no |
| `browser.grabElement` | Grab Page Element | Mod+C | no |
| `editor.find` | Find in editor | Mod+F | no |
| `editor.replace` | Replace in editor | Mod+H | no |
| `editor.save` | Save File | Mod+S | no |
| `editor.markdownPreview` | Show Markdown Preview | Mod+Shift+V | no |
| `editor.toggleWordWrap` | Toggle Word Wrap | Alt+Z | no |
| `editor.copyContext` | Copy Context | Mod+Alt+C | no |
| `editor.previousChange` | Go to Previous Change | Shift+F7 | no |
| `editor.nextChange` | Go to Next Change | F7 | no |
| `editor.addReviewNote` | Add Review Note | Mod+Shift+A | no |
| `sourceControl.sendReviewNotes` | Send Review Notes to Agent | none | yes |
| `fileExplorer.undo` | Undo file operation | Mod+Z | no |
| `fileExplorer.redo` | Redo file operation | Mod+Shift+Z, Ctrl+Y | no |
| `fileExplorer.copyPath` | Copy file path | Alt+Shift+C | no |
| `fileExplorer.copyRelativePath` | Copy relative file path | Mod+Alt+Shift+C | no |
| `fileExplorer.delete` | Delete file | Delete | no |
| `settings.search` | Search Settings | Mod+F | no |
| `terminal.copySelection` | Copy terminal selection | Ctrl+Shift+C, Ctrl+C | no |
| `terminal.selectAll` | Select all terminal text | Ctrl+Shift+A | no |
| `terminal.paste` | Paste into terminal | Ctrl+V, Ctrl+Shift+V, Shift+Insert | no |
| `terminal.search` | Search active pane | Mod+F | no |
| `terminal.clear` | Clear active pane | Mod+K | no |
| `terminal.focusNextPane` | Focus next pane | Mod+BracketRight | no |
| `terminal.focusPreviousPane` | Focus previous pane | Mod+BracketLeft | no |
| `terminal.equalizePaneSizes` | Equalize pane sizes | none | yes |
| `terminal.expandPane` | Expand / collapse pane | Mod+Shift+Enter | no |
| `terminal.setTitle` | Set Title… | none | yes |
| `terminal.clearPaneTitle` | Clear Pane Title | none | yes |
| `terminal.closePane` | Close active pane | Mod+W | no |
| `terminal.splitRight` | Split terminal right | Mod+Shift+D | no |
| `terminal.splitDown` | Split terminal down | Alt+Shift+D | no |
| `terminal.switchInputSource` | Switch input source / language (native) | none | yes |
| `view.cycleWorkspaceView` | Cycle Workspace View (Agents / Board / Terminals) | Mod+Alt+V | no |
| `sessions.add` | Add a Session | none | yes |
| `sessions.remove` | Remove a Session | none | yes |
| `terminals.focusNextNeedsYou` | Next That Needs You | Mod+J | no |
| `tab.newAgent.claude` | New Claude tab | none | yes |
| `tab.newAgent.claude-agent-teams` | New Claude Agent Teams tab | none | yes |
| `tab.newAgent.openclaude` | New OpenClaude tab | none | yes |
| `tab.newAgent.codex` | New Codex tab | none | yes |
| `tab.newAgent.devin` | New Devin tab | none | yes |
| `tab.newAgent.ante` | New Ante tab | none | yes |
| `tab.newAgent.trae` | New Trae tab | none | yes |
| `tab.newAgent.autohand` | New Autohand Code tab | none | yes |
| `tab.newAgent.mimo-code` | New MiMo Code tab | none | yes |
| `tab.newAgent.pi` | New Pi tab | none | yes |
| `tab.newAgent.omp` | New OMP tab | none | yes |
| `tab.newAgent.prime-agent` | New Prime Agent tab | none | yes |
| `tab.newAgent.gemini` | New Gemini tab | none | yes |
| `tab.newAgent.antigravity` | New Antigravity tab | none | yes |
| `tab.newAgent.aider` | New Aider tab | none | yes |
| `tab.newAgent.goose` | New Goose tab | none | yes |
| `tab.newAgent.amp` | New Amp tab | none | yes |
| `tab.newAgent.kilo` | New Kilocode tab | none | yes |
| `tab.newAgent.kiro` | New Kiro tab | none | yes |
| `tab.newAgent.crush` | New Charm tab | none | yes |
| `tab.newAgent.aug` | New Auggie tab | none | yes |
| `tab.newAgent.cline` | New Cline tab | none | yes |
| `tab.newAgent.codebuff` | New Codebuff tab | none | yes |
| `tab.newAgent.command-code` | New Command Code tab | none | yes |
| `tab.newAgent.continue` | New Continue tab | none | yes |
| `tab.newAgent.cursor` | New Cursor tab | none | yes |
| `tab.newAgent.droid` | New Droid tab | none | yes |
| `tab.newAgent.kimi` | New Kimi tab | none | yes |
| `tab.newAgent.mistral-vibe` | New Mistral Vibe tab | none | yes |
| `tab.newAgent.qwen-code` | New Qwen Code tab | none | yes |
| `tab.newAgent.rovo` | New Rovo Dev tab | none | yes |
| `tab.newAgent.hermes` | New Hermes tab | none | yes |
| `tab.newAgent.openclaw` | New OpenClaw tab | none | yes |
| `tab.newAgent.copilot` | New GitHub Copilot tab | none | yes |
| `tab.newAgent.grok` | New Grok tab | none | yes |

### 4.4 Menu items that show a shortcut but do nothing

| Menu | Item | Shortcut shown | What happens |
|---|---|---|---|
| View | Open Worktree Palette | The `worktree.palette` chord | Nothing on click; the item has no action. The shortcut itself works through the keyboard layer. |
| View, Workspace View | Cycle Workspace View | The `view.cycleWorkspaceView` chord | Same. |

On Windows and Linux the app menu shows other shortcuts as text only (Settings, Force Reload, Reset Size, Zoom In, Zoom Out, Toggle Left Sidebar, Toggle Right Sidebar); those items do act when clicked, and the keyboard layer handles the chord. Undo and Redo in the Edit menu do not claim their chords on Windows and Linux.

### 4.5 Cards that carry a keybinding contract

Each card below keeps the action ids named here, with the defaults of 4.3, so a keybindings file that binds them still loads. Several cards held their ids back pending the allowlist; the ids are the ones in 4.3.

| Card | Contract |
|---|---|
| PROJ-020 | `workspace.create`. |
| PROJ-053, VIEW-053 | `sidebar.sleepingWorkspaces.toggle`, shipped unbound. |
| PROJ-055 | `worktree.navigateUp`, `worktree.navigateDown`, `workspace.selectByIndex` and `sidebar.focusWorktreeList`. |
| PROJ-056 | `worktree.history.back` and `worktree.history.forward`. |
| PROJ-057, VIEW-037 | `worktree.palette`. |
| PROJ-059 | `workspace.rename`. |
| PROJ-070 | `workspace.delete`. |
| PROJ-085 | `workspace.openBoard`, shipped unbound. Its title is "Show Workspace Statuses" since T-610 (was "Toggle Workspace Board"); the id is kept. |
| SESS-008, TERM-002, VIEW-036 | `sessions.add` and `sessions.remove`, both shipped unbound. |
| SESS-011 | `workspace.create`, `tab.newTerminal`, and `tab.newAgent` for the default agent plus one id per agent formed by adding a dot and the agent's stable id from section 6 (for example `tab.newAgent.claude`). |
| TERM-006 | `terminal.splitRight` and `terminal.splitDown`. |
| TERM-009 | `terminal.equalizePaneSizes`, shipped unbound. |
| TERM-012 | `terminal.focusNextPane` and `terminal.focusPreviousPane`. |
| TERM-013 | `terminal.expandPane`. |
| TERM-014 | `terminal.closePane`. |
| TERM-027 | `terminal.setTitle` and `terminal.clearPaneTitle`, both shipped unbound. |
| TERM-030, STAT-051, VIEW-047 | `terminals.focusNextNeedsYou`. |
| TERM-040 | `tab.newTerminal`, `tab.newBrowser`, `tab.newMarkdown` and `tab.openMarkdown`. |
| TERM-041 | `tab.newAgent` and the per-agent ids built from it (see SESS-011). |
| TERM-044 | `tab.close` and `tab.closeAll`. |
| TERM-047 | `tab.reopenClosed`. |
| TERM-048 | `tab.rename`. |
| TERM-050 | `tab.previousRecent`. |
| TERM-051 | `tab.nextSameType`, `tab.previousSameType`, `tab.nextAllTypes`, `tab.previousAllTypes`, `tab.nextTerminal` and `tab.previousTerminal`. |
| TERM-052 | `tab.selectByIndex`. |
| TERM-059 | `floatingTerminal.toggle`. |
| TERM-060 | `floatingWorkspace.maximize` and `floatingWorkspace.minimize`. |
| TERM-065 | `terminal.copySelection`. |
| TERM-067 | `terminal.selectAll`. |
| TERM-068 | `terminal.paste`. |
| TERM-076 | `terminal.clear`. |
| TERM-077 | `terminal.search`. |
| TERM-078, SET-019 | `zoom.in`, `zoom.out` and `zoom.reset`. |
| TERM-085 | `terminal.switchInputSource`, shipped unbound. |
| STAT-050 | `view.inbox`, shipped unbound; the Inbox is its own top-level view. |
| VIEW-002, SET-037 | `view.cycleWorkspaceView`, Mod+Alt+V. |
| VIEW-009, HID-002 | `view.code` (Mod+Shift+3), and `view.inbox` and `view.floor`, both shipped unbound. |
| VIEW-010, GIT-044 | `view.tasks`, shipped unbound. |
| VIEW-013 | `view.floor`. |
| VIEW-029, SET-046, HID-020 | `dashboard.toggle`, shipped unbound; it stays registered while its experimental switch is off. |
| VIEW-046 | `worktree.history.back`, `worktree.history.forward`, `worktree.navigateUp`, `worktree.navigateDown` and `workspace.selectByIndex`. |
| VIEW-048 | `workspace.delete` and `tab.rename`. |
| VIEW-050 | `sidebar.left.toggle` and `sidebar.focusWorktreeList`. |
| VIEW-056 | `sidebar.right.toggle`. |
| VIEW-057 | `sidebar.explorer.toggle`, `sidebar.search.toggle`, `sidebar.checks.toggle` (shipped unbound) and `sidebar.sourceControl.toggle`. |
| VIEW-060, EDIT-034 | `fileExplorer.undo`, `fileExplorer.redo`, `fileExplorer.copyPath`, `fileExplorer.copyRelativePath` and `fileExplorer.delete`. |
| VIEW-061 | `sidebar.search.toggle`. |
| VIEW-072, GIT-041 | `sourceControl.sendReviewNotes`, shipped unbound. |
| VIEW-079 | `sidebar.ports.toggle`, bound on macOS only. Deleted by T-611 (DT-C53): the rebuild no longer registers it, so a keybindings file naming it gets the unknown-id warning and the binding is ignored. |
| GIT-001 | `sidebar.sourceControl.toggle`, Mod+Shift+G. |
| GIT-029 | `sidebar.checks.toggle`, shipped unbound. |
| GIT-037, EDIT-027 | `editor.nextChange` (F7) and `editor.previousChange` (Shift+F7). |
| GIT-040 | `editor.addReviewNote`, Mod+Shift+A. |
| EDIT-001 | `editor.save`. |
| EDIT-005 | `editor.find` and `editor.replace`. |
| EDIT-006 | `editor.toggleWordWrap`. |
| EDIT-007 | `editor.copyContext`; the copied text carries the path and line numbers as path:line. |
| EDIT-012 | `editor.markdownPreview`, `tab.newMarkdown` and `tab.openMarkdown`. |
| EDIT-020 | `editor.addReviewNote` and `sourceControl.sendReviewNotes`. |
| EDIT-031 | `tab.closeAll`. |
| EDIT-033 | `sidebar.explorer.toggle`; the Explorer's view id is explorer. |
| EDIT-036 | `worktree.quickOpen`, Mod+P. |
| EDIT-037 | `sidebar.search.toggle`, Mod+Shift+F. Include and exclude take patterns separated by commas; a bare pattern matches at any depth, and a backslash before a comma makes it literal. |
| EDIT-041 | `view.code`. |
| EDIT-049, SET-007 | `settings.search`, Mod+F inside Settings. |
| BROW-001 | `tab.newBrowser`, Mod+Shift+B on every platform. |
| BROW-003 | `browser.focusAddressBar`, Mod+L. The address bar's search engine is one of Google, DuckDuckGo, Bing and Kagi; with the browser settings page cut, which engine is the fixed default and whether the Kagi choice keeps a home is an owner decision. |
| BROW-005 | `browser.back`, `browser.forward`, `browser.reload` and `browser.hardReload`. |
| BROW-007 | `browser.find`. |
| BROW-012 | `zoom.in`, `zoom.out` and `zoom.reset` act on the browser tab, each tab keeping its own zoom (100% by default). |
| BROW-018 | `tab.previousRecent`, Ctrl+Tab, still works while focus is inside a page. |
| BROW-019 | `tab.close` and `tab.reopenClosed`. |
| BROW-035 | `browser.grabElement`, Mod+C. |
| SET-006 | `app.settings`, Mod+Comma. |
| SET-011 | The keybindings file of 4.1 keeps its shape: an optional schema reference, version 1, a map from action id to a chord, a list of chords, or null or false, and an optional per-platform block for macOS, Linux and Windows; the importer keeps every override and the meaning of null and false. |
| SET-013 | The default chords and the unbound actions are the ones in 4.3. |
| CHAT-003 | The chord that flips a tab between chat and terminal is fixed, not a rebindable action; each tab's chosen view is saved with the session layout. |
| CHAT-026 | The three chat text zoom chords are fixed inside chat, not rebindable actions. |

## 5. Data the importer carries

### 5.1 What is on disk today

The profile root on Windows is `%APPDATA%\kolux`; a few files live in `~/.kolux`. Names and sizes only; no file contents were read except key names and counts in the main data file.

`~/.kolux`:

| Item | Size | Category |
|---|---|---|
| `~/.kolux/keybindings.json` | 942 B | Keybindings |
| `~/.kolux/agent-hooks` | 5 files, about 9 KB: the Claude, Codex and Kimi hook scripts, the Claude status-line script and its install marker | Hook scripts |
| `~/.kolux/claude-agent-teams-bin` | 1 file, 308 B (a terminal-multiplexer shim for Claude Agent Teams) | Managed agent helpers |

`%APPDATA%\kolux`:

| Item | Size | Category |
|---|---|---|
| `%APPDATA%\kolux\profiles\local-default\kolux-data.json` | 50,491 B | Settings (203 keys), UI state (100 keys), repos (3), projects (2), worktree records (14), workspace session, automations (0), saved launch shapes (0), managed account lists (0), two sealed secret fields |
| The same folder: five rolling backups, a pre-auto-mode backup and a legacy pre-rename backup | 47 to 67 KB each | Backups |
| `%APPDATA%\kolux\profiles\local-default\active-view.json` | 26 B | UI state |
| `%APPDATA%\kolux\profiles\local-default\kolux-github-cache.json` | 808 B | Usage and service caches |
| `%APPDATA%\kolux\profiles\local-default\kolux-workspace-cleanup-scan.json` and the space-analysis file beside it | 3,051 B and 2,280 B | Usage and service caches |
| `%APPDATA%\kolux\profiles\local-default\kolux-secret-protection.json` | 24 B | Key vault report |
| `%APPDATA%\kolux\profiles\local-default\browser-host-client-identity.json` | 75 B | Runtime |
| `%APPDATA%\kolux\kolux-profile-index.json` | 384 B | Profiles index (active profile and the list) |
| `%APPDATA%\kolux\orchestration.db` with its two journal files | 454,656 B plus 82 KB and 32 KB | Orchestration history |
| `%APPDATA%\kolux\kolux-claude-usage.json` | 8,021 B | Usage caches |
| `%APPDATA%\kolux\kolux-codex-usage.json` | 712,436 B | Usage caches |
| `%APPDATA%\kolux\kolux-stats.json` | 276,364 B | Usage caches |
| `%APPDATA%\kolux\ai-vault` | 1 file, 224 KB (session parse cache) | Usage caches |
| `%APPDATA%\kolux\codex-session-backfill` | 4 files, 177 KB | Usage caches |
| `%APPDATA%\kolux\codex-pane-accounts.json` | 314 B | Accounts |
| `%APPDATA%\kolux\claude-accounts`, `%APPDATA%\kolux\codex-accounts`, `%APPDATA%\kolux\claude-runtime-auth` | empty | Accounts |
| `%APPDATA%\kolux\codex-runtime-home` | 10,332 files, 412 MB (Kolux's own Codex home) | Managed agent homes |
| `%APPDATA%\kolux\agent-session-authority.key` | 32 B | Runtime secret |
| `%APPDATA%\kolux\kolux-e2ee-keypair.json` | 216 B | Remote pairing |
| `%APPDATA%\kolux\agent-hooks` | 2 files, 13 KB (endpoint file and last status) | Hook scripts |
| `%APPDATA%\kolux\omp-managed-status-extension` | 2 files, 24 KB | Managed agent helpers |
| `%APPDATA%\kolux\terminal-history` | 80 files, 2.7 MB | Terminal history |
| `%APPDATA%\kolux\logs` | 6 files, 17 MB | Logs |
| `%APPDATA%\kolux\crash-reports.json`, `%APPDATA%\kolux\bootstrap-fatal.log`, `%APPDATA%\kolux\Crashpad` | 22,545 B, 2,388 B, folder | Logs |
| `%APPDATA%\kolux\daemon` | 2 files, 2 KB (process id and token) | Runtime |
| `%APPDATA%\kolux\kolux-runtime.json`, `%APPDATA%\kolux\lockfile`, `%APPDATA%\kolux\DevToolsActivePort`, `%APPDATA%\kolux\windows-acl-grant.json`, `%APPDATA%\kolux\http1-compatibility.json`, `%APPDATA%\kolux\.updaterId`, two migration-complete markers | under 400 B each | Runtime |
| `%APPDATA%\kolux\speech-models` | 4 files, 629 MB | Speech (not carried) |
| `%APPDATA%\kolux\agent-sessions`, `%APPDATA%\kolux\floating-workspace`, `%APPDATA%\kolux\rate-limit-pty-cwd` | empty | Runtime |
| `%APPDATA%\kolux\Cache`, `%APPDATA%\kolux\Code Cache`, `%APPDATA%\kolux\GPUCache`, the two Dawn caches, `%APPDATA%\kolux\blob_storage`, `%APPDATA%\kolux\Local Storage`, `%APPDATA%\kolux\Session Storage`, `%APPDATA%\kolux\Network`, `%APPDATA%\kolux\Partitions`, `%APPDATA%\kolux\Shared Dictionary`, the shared-storage and DIPS files, `%APPDATA%\kolux\Local State`, `%APPDATA%\kolux\Preferences` | caches and browser-engine state | Browser engine data |

### 5.2 Carry or skip, by category (17)

| # | Category | Carry? | Notes |
|---|---|---|---|
| 1 | Settings and UI state | Carry | Every setting the rebuild still has, by meaning, minus the skip list in 5.3. Unknown settings are dropped, not guessed. |
| 2 | Projects, repos and worktrees | Carry | Repos, projects, project groups, folder workspaces, worktree records and their identity aliases, retired worktree names, sparse checkout presets. Only rows bound to this PC (5.3 row 3). |
| 3 | Saved launch shapes | Carry | The saved agent line-ups and the last line-up used per repo. |
| 4 | Automations | Carry | Definitions. Run history is optional. Rows bound to a remote host are skipped. |
| 5 | Accounts and key vault | Carry the account list; secrets need re-entry (5.4) | Managed Claude and Codex accounts, which account is active, per-pane Codex account choices. |
| 6 | Keybindings | Keep in place | `~/.kolux/keybindings.json` is read where it is; the importer never rewrites it. |
| 7 | Orchestration history | Optional | Runs, tasks, messages and decision gates. The app works without it. |
| 8 | Usage caches | Skip | Claude and Codex usage, stats, the session parse cache and the Codex backfill state. Rebuilt from the agents' own session files. |
| 9 | Logs and crash reports | Skip | |
| 10 | Hook scripts and hook endpoint | Skip, then clean up | The rebuild writes its own scripts. It must remove or replace the old app's entries in each agent's config file (section 3.4), never leave two. |
| 11 | Terminal history | Optional | Saved scrollback per terminal. |
| 12 | Profiles index and per-profile caches | Carry the index, skip the caches | Active profile and the list; GitHub cache, cleanup scan and space analysis are rebuilt. |
| 13 | Managed agent homes and helpers | Skip | Kolux's own Codex home, the OMP status extension and the Agent Teams shim are regenerated. Codex sign-in inside the managed home needs re-entry. |
| 14 | Runtime, locks and markers | Skip | Process ids, tokens, lock files, update id, migration markers. Never carry the session authority key. |
| 15 | Browser engine data | Skip | Caches and storage of the old engine. Sites inside Kolux browser tabs need signing in again. |
| 16 | Plugins | Skip | Plugins are not carried (DECISIONS: SKILL-037 to SKILL-041). |
| 17 | Remote, mobile and speech data | Skip | See 5.3. |

### 5.3 Importer must skip

Cross-referenced with the importer skip list of the remote-and-hosts inventory (17 categories), plus four default-cut rows.

| # | Skip | Why |
|---|---|---|
| 1 | SSH host records in the main data file | Remote hosts not carried. |
| 2 | Remote terminal leases, pending remote kills, removed-host markers | Same. |
| 3 | Projects, worktrees, tabs and automations bound to an SSH host or a paired server | Import local rows only. |
| 4 | Kolux's own SSH host-key store (the user's known-hosts file is never touched) | Same. |
| 5 | Saved environments (remote Kolux servers) and the active choice | Environments not carried. |
| 6 | Paired phones and devices | Mobile pairing not carried. |
| 7 | The pairing encryption keypair (`%APPDATA%\kolux\kolux-e2ee-keypair.json`) | Same. |
| 8 | The paired-listener fallback port | Same. |
| 9 | The retired cloud relay region preference | Retired. |
| 10 | Mobile settings (mobile button, pairing addresses, auto restore) | Mobile not carried. |
| 11 | Speech models and speech settings (`%APPDATA%\kolux\speech-models`) | Speech not carried. |
| 12 | The OpenAI speech key in `~/.kolux` | Same. Never read it. |
| 13 | Emulator settings and emulator tabs inside saved sessions | Emulator not carried. |
| 14 | Ephemeral VM runtimes and the VM flag; VM recipes in a repo's `kolux.yaml` stay in the file and are ignored | VMs not carried. |
| 15 | WSL execution settings (WSL distro, WSL shell, which falls back to PowerShell, per-project runtime) | WSL not carried. |
| 16 | Other remote-only settings (remote browser routing, per-host commit message settings, the SSH status-bar item) | Remote not carried. |
| 17 | The headless runtime lock left by the server mode | Server mode not carried. |
| 18 | Kolux Account sign-in and cloud session (default cut) | Kolux Account removed. |
| 19 | Linear workspaces and keys (default cut) | Linear not carried. |
| 20 | Bitbucket, Gitea and Azure credentials (default cut) | Not carried. |
| 21 | The plugins data folder (`%APPDATA%\kolux\plugins-data`, 2 files, 2 KB: marketplace source list and kill list) (default cut) | Plugins not carried. |

### 5.4 The key vault

- The old app seals secrets with the operating system's user-bound protection, through its own runtime's sealing service. A new program cannot be assumed to unseal them. The importer never tries to read them as text, never logs them, and treats any value it cannot unseal as missing.
- Needs re-entry after the switch:

| Secret | What Txais does |
|---|---|
| Claude sign-in token kept in settings | Sign in again |
| Managed Claude accounts (one sealed credential file each) | Sign in again, per account |
| Managed Codex accounts and the managed Codex home's sign-in | Sign in again |
| Grok API key | Paste again |
| HTTP proxy address (may carry a password) | Paste again |
| Browser search session link | Paste again |
| MiniMax key and cookie | Paste again |
| Plugin secrets | Paste again |

- Not affected: each agent's own login in its own home folder (for example Gemini's `oauth_creds.json` under `~/.gemini`), which the importer never touches.
- If the old secret-protection report says sealing was unavailable, some values may sit unsealed on disk. They are still secrets: move them into the new vault and never print them.

### 5.5 Environment variables

User-facing: set by Txais or read by his scripts.

| Variable | Meaning |
|---|---|
| `KOLUX_WORKSPACES_DIR` | Where new worktrees are created. Overrides the default folder under the user's home, so worktrees can live on another drive. Empty or blank means the default. |
| `KOLUX_ROOT_PATH` | Set for setup and archive scripts: the repo's main folder. |
| `KOLUX_WORKTREE_PATH` | Set for setup and archive scripts: the new worktree's folder. |
| `KOLUX_WORKSPACE_NAME` | Set for setup and archive scripts: the worktree folder's name. Two compatibility aliases of the root-path variable, named after other worktree tools, are also set. |
| `KOLUX_TERMINAL_HANDLE` | Set in every Kolux terminal: this terminal's handle, the default for `--terminal`. |
| `KOLUX_PANE_KEY` | Set in every Kolux terminal: the pane's identity, used by hooks and the CLI. |
| `KOLUX_TAB_ID` | Set in every Kolux terminal: the tab's id. |
| `KOLUX_WORKTREE_ID` | Set in every Kolux terminal: the worktree's id; the default parent for `kolux worktree create`. |
| `KOLUX_WORKSPACE_ID` | Set in every Kolux terminal: the workspace's id; preferred over the worktree id as default parent. |
| `KOLUX_AGENT_HOOK_PORT` | Set in every Kolux terminal: the hook server's port. |
| `KOLUX_AGENT_HOOK_TOKEN` | Set in every Kolux terminal: the hook server's token. Secret. |
| `KOLUX_AGENT_HOOK_ENDPOINT` | Set in every Kolux terminal: path of the endpoint file hooks re-read on each run. |
| `KOLUX_AGENT_HOOK_ENV` | Set in every Kolux terminal: which hook environment (installed or dev) the pane belongs to. |
| `KOLUX_AGENT_HOOK_VERSION` | Set in every Kolux terminal: the hook protocol version. |
| `KOLUX_AGENT_LAUNCH_TOKEN` | Set for a launched agent: ties hook posts to the launch that started it. |
| `KOLUX_CODEX_HOME` | Kolux's managed Codex home; `kolux agent hooks prepare-codex` and the Codex launch use it. |
| `KOLUX_AGENT_TEAMS_TEAM_ID`, `KOLUX_AGENT_TEAMS_TOKEN`, `KOLUX_AGENT_TEAMS_SHIM_BIN` | Claude Agent Teams: the team, its token and the shim folder. |
| `KOLUX_CLI_COMMAND` | Which CLI name to print in hints: kolux, kolux-ide or kolux-dev. |
| `KOLUX_WINDOWS_PACKAGED_CLI_LAUNCHER` | Set to 1 when the CLI runs from the packaged Windows launcher; changes the hints and the ask hand-back (exit 75). |
| `KOLUX_USER_DATA_PATH` | Tells the CLI where the app's data folder is. |
| `KOLUX_APP_VERSION` | The app version, reported to terminals as the terminal program version. |
| `KOLUX_OPEN_COMMAND`, `KOLUX_APP_EXECUTABLE`, `KOLUX_APP_EXECUTABLE_NEEDS_APP_ROOT` | How `kolux open` starts the app. |
| `KOLUX_CLI_CWD` | The caller's folder, passed through for skills install with `--local`. |
| `KOLUX_CLI_INSTALL_PATH` | Overrides where the CLI is installed. |
| `KOLUX_HEARTBEAT_INTERVAL_MS`, `KOLUX_KEEPALIVE_INTERVAL_MS` | Keep-alive pace for waiting orchestration checks. |
| `KOLUX_WINDOWS_SHELL`, `KOLUX_TERMINAL_WINDOWS_SHELL` | The Windows shell used for terminals and for re-running a recovered orchestration command. |
| `KOLUX_HISTFILE`, `KOLUX_SHELL_FEATURES`, `KOLUX_ORIG_ZDOTDIR`, `KOLUX_SHELL_READY_ROOT` | Shell integration: per-terminal history file, enabled shell features, the user's own zsh folder, and the shell-ready marker folder. |
| `KOLUX_NOTEBOOK_PYTHON` | The Python used for notebooks. |
| `KOLUX_GH_EXEC_TIMEOUT_MS`, `KOLUX_WORKTREE_ADD_TIMEOUT_MS` | Timeouts for GitHub CLI calls and for creating a worktree. |
| `KOLUX_GIT_ADMISSION_DISABLED`, `KOLUX_DISABLE_REPO_REF_MAINTENANCE` | Turn off the git call limiter and the background ref clean-up. |
| `KOLUX_TELEMETRY_DISABLED`, `KOLUX_DIAGNOSTICS_DISABLED`, `KOLUX_DIAGNOSTICS_TOKEN_URL`, `KOLUX_STARTUP_DIAGNOSTICS`, `KOLUX_ALWAYS_REPORT_SECRET_PROTECTION` | Telemetry and diagnostics: the two off switches (either set to 1 has the same effect as the common do-not-track variable), upload endpoint, startup tracing, and always showing the key vault report. |
| `KOLUX_HANG_WATCHDOG_CHECK_INTERVAL_MS`, `KOLUX_HANG_WATCHDOG_TIMEOUT_MS`, `KOLUX_HANG_WATCHDOG_FORCE` | The hang watchdog's pace, limit and a force switch. |
| `KOLUX_BACKGROUND_LAUNCH` | Start without taking focus. |
| `KOLUX_RENDERER_HEAP_MB` | A positive number sets the interface's memory ceiling in megabytes whatever the machine's RAM; 0, off, none or default keeps the platform's own ceiling; an unreadable value is ignored. |
| `KOLUX_DISABLE_AGENT_BROWSER_SWEEP`, `KOLUX_DISABLE_MACOS_LOGIN_SHELL` | Turn off the stray agent-browser clean-up, and the login shell on macOS. |
| `KOLUX_MULTI_PROFILE_UI` | Set to 1 to show the multi-profile interface. |
| `KOLUX_CLAUDE_AGENT_STATUS_SETTINGS` | Path of the Claude status settings Kolux passes to a launched Claude. |
| `KOLUX_CODEX_LAUNCH_PREFLIGHT` | Marks a Codex launch that runs a preflight step first (changes quoting under the Windows command shell). |
| `KOLUX_PI_CODING_AGENT_DIR`, `KOLUX_PI_SOURCE_AGENT_DIR`, `KOLUX_PI_TITLE_MARKER_OWNED` | Pi: the managed and the user's own agent folders, and title ownership. |
| `KOLUX_OMP_CODING_AGENT_DIR`, `KOLUX_OMP_SOURCE_AGENT_DIR`, `KOLUX_OMP_STATUS_EXTENSION` | OMP: managed and own folders, and the status extension. |
| `KOLUX_PRIME_AGENT_SOURCE_AGENT_DIR`, `KOLUX_PRIME_AGENT_STATUS_EXTENSION` | Prime Agent: own folder and status extension. |
| `KOLUX_MIMOCODE_HOME`, `KOLUX_MIMOCODE_SOURCE_HOME` | MiMo Code: the overlay home with the status plugin, and the user's own home. |

Internal (set by Kolux for its own child processes; the rebuild may rename them freely): `KOLUX_AI_VAULT_SERVICE_PROCESS`, `KOLUX_DAEMON_BACKGROUND_STREAM_DROP`, `KOLUX_DAEMON_ENTRY_LOAD_CHECK`, `KOLUX_DAEMON_SHALLOW_SOCKET_GATE`, `KOLUX_DAEMON_STREAM_BACKLOG_FILE`, `KOLUX_PROVIDER_SUPERVISOR_SPEC`, `KOLUX_PTY_SPAWN_TIMING`, `KOLUX_WATCHER_CANARY_DIR`, `KOLUX_WATCHER_CHILD_PID_FILE`.

Not carried, see `DECISIONS.md`:

| Family | Variables |
|---|---|
| Remote runtime and pairing | `KOLUX_PAIRING_CODE`, `KOLUX_ENVIRONMENT`, `KOLUX_REMOTE_PAIRING`, `KOLUX_RELAY_PATH`, `KOLUX_WORKSPACE_ROOT`, `KOLUX_NODE_OPTIONS`, `KOLUX_NODE_REPL_EXTERNAL_MODULE`, `KOLUX_SYSTEM_SFTP_PATH`, `KOLUX_SYSTEM_SSH_PATH`, `KOLUX_SSH_FORCE_SYSTEM_TRANSPORT`, `KOLUX_SSH_MUX_DEBUG`, `KOLUX_TEST_SSH_REPOSITORIES`, `KOLUX_WSL_HOOK_RELAY_DEBUG` |
| Headless server mode | `KOLUX_USER_DATA`, `KOLUX_VERSION`, `KOLUX_KOLUXD_PREBUILDS_DIR`, `KOLUX_BROWSER_EXECUTABLE` (the server's data folder, version, native module folder and headless browser) |
| Emulator and computer use | `KOLUX_EMULATOR_PROBE`, `KOLUX_COMPUTER_DESKTOP_SCRIPT_PROVIDER_PATH`, `KOLUX_COMPUTER_MACOS_HELPER_APP_PATH`, `KOLUX_COMPUTER_SCREENSHOT_TMPDIR` |
| Kolux Account (16) | `KOLUX_CLOUD_ALLOW_PLAINTEXT_SESSION`, `KOLUX_CLOUD_API_URL`, `KOLUX_CLOUD_AUTH_SCOPE`, `KOLUX_CLOUD_AUTH_URL`, `KOLUX_CLOUD_AUTHORIZE_URL`, `KOLUX_CLOUD_CAPABILITIES_URL`, `KOLUX_CLOUD_CLIENT_ID`, `KOLUX_CLOUD_DEV_AUTH`, `KOLUX_CLOUD_DEV_DISPLAY_NAME`, `KOLUX_CLOUD_DEV_EMAIL`, `KOLUX_CLOUD_DEV_USER_ID`, `KOLUX_CLOUD_LOGOUT_URL`, `KOLUX_CLOUD_ORG_URL`, `KOLUX_CLOUD_PROFILE_URL`, `KOLUX_CLOUD_REFRESH_URL`, `KOLUX_CLOUD_SESSION_URL` |

Dev and test only (the rebuild picks its own names):

| Family | Variables |
|---|---|
| Dev builds (13) | `KOLUX_DEV_BRANCH`, `KOLUX_DEV_CLI_INVOCATION`, `KOLUX_DEV_DOCK_BADGE_LABEL`, `KOLUX_DEV_DOCK_TITLE`, `KOLUX_DEV_INSTANCE_LABEL`, `KOLUX_DEV_MACOS_BUNDLE_ID`, `KOLUX_DEV_REPO_ROOT`, `KOLUX_DEV_STABLE_NAME`, `KOLUX_DEV_USER_DATA_PATH`, `KOLUX_DEV_WORKTREE_NAME`, `KOLUX_DEV_WRAPPER_TEST_ENV_FILE`, `KOLUX_DEV_WRAPPER_TEST_PID_FILE`, `KOLUX_DEV_WRAPPER_TEST_VITE_FILE` |
| End-to-end tests (16) | `KOLUX_E2E_DAEMON_INIT_DELAY_MS`, `KOLUX_E2E_DISABLE_AUTHORITATIVE_SESSION_TABS_INVENTORY`, `KOLUX_E2E_DISABLE_PAIRED_TERMINAL_PARKING`, `KOLUX_E2E_DISABLE_RUNTIME_SHARED_CONTROL`, `KOLUX_E2E_FORBID_LOCAL_SSH_CONNECT_PROBE`, `KOLUX_E2E_FORCE_REMOTE_TERMINAL_INITIAL_SNAPSHOT_TRUNCATED`, `KOLUX_E2E_FOREGROUND`, `KOLUX_E2E_HEADFUL`, `KOLUX_E2E_HEADLESS`, `KOLUX_E2E_HOME_DIR`, `KOLUX_E2E_LOGIN_SESSION_PROBE_FILE`, `KOLUX_E2E_ORCHESTRATION_POINTER_ENTER_DELAY_MS`, `KOLUX_E2E_RUNTIME_WS_PORT`, `KOLUX_E2E_TERMINAL_PARKING_DELAY_MS`, `KOLUX_E2E_TERMINAL_RETENTION_LIMIT`, `KOLUX_E2E_USER_DATA_DIR` |
| SDK contract tests (5) | `KOLUX_SDK_CONTRACT_DESCENDANT`, `KOLUX_SDK_CONTRACT_IGNORE_CONTROL_REQUESTS`, `KOLUX_SDK_CONTRACT_IGNORE_SIGTERM`, `KOLUX_SDK_CONTRACT_REPORT_PATH`, `KOLUX_SDK_CONTRACT_SCENARIO_PATH` |
| Fake sidecar for tests (3) | `KOLUX_FAKE_SIDECAR_CONTROL`, `KOLUX_FAKE_SIDECAR_LOG`, `KOLUX_FAKE_SIDECAR_MODE` |

Counts: 146 variables read by the old source outside tests, plus the 3 it sets only for scripts, 149 in all.

Cards that carry an environment contract, including variables that belong to other programs and that Kolux sets or honours:

| Card | Contract |
|---|---|
| PROJ-026 | `KOLUX_WORKSPACES_DIR` takes an absolute path; it is trimmed, and an empty value is ignored. |
| PROJ-027 | `KOLUX_WORKTREE_ADD_TIMEOUT_MS` sets the worktree-add timeout in milliseconds, clamped to between three and thirty minutes, so work on cloud-synced folders fails fast instead of hanging. |
| USAGE-006 | Claude and Claude Agent Teams launches get `CLAUDE_CODE_AUTO_COMPACT_WINDOW` set to 200000, unless the user already set that variable (in any letter case) or passed `--autocompact`. Codex launches get two per-run config overrides, `model_context_window` at 200000 and `model_auto_compact_token_limit` at 180000, placed before any argument terminator and skipped when the user's command already names either key or uses `--oss`, `--profile` or -p. No CLI config file is touched, and the switch is on unless the user turned it off (5.7). (Kolux RS, T-041-a: built as written, setting key `contextCap200k`; Agent Teams is skipped in Kolux RS.) |
| USAGE-022 | Codex sign-in is checked under `CODEX_HOME` when it is set, otherwise under Codex's default folder in the user's home. |
| USAGE-027 | Kimi's saved sign-in is read from its home folder, honouring `KIMI_CODE_HOME`. |
| ACCT-004, ACCT-024 | Claude Code takes its 1-year key from `CLAUDE_CODE_OAUTH_TOKEN`; Kolux sets that variable only in Claude panes that run in key mode. |
| ACCT-038 | `KOLUX_MULTI_PROFILE_UI` was the developer switch for several Kolux profiles; the rebuild chooses its own. |
| ORCH-042 | For Claude Agent Teams, the stand-in sets tmux's server variable, TMUX, and tmux's pane variable, both pointing at the Kolux pane, so teammates open as real side-by-side panes. |
| APP-022 | `KOLUX_RENDERER_HEAP_MB`: a positive number sets the interface's memory ceiling in megabytes whatever the machine's RAM; 0, a negative number, off, none or default keeps the platform's own ceiling; an unreadable value is ignored. |
| APP-046 | `DO_NOT_TRACK`, `KOLUX_TELEMETRY_DISABLED` and `KOLUX_DIAGNOSTICS_DISABLED`, each set to 1, refuse telemetry and diagnostic upload; a CI environment counts as opted out too. |
| APP-065 | `KOLUX_STARTUP_DIAGNOSTICS` set to 1 prints startup timings and benchmark markers in a development copy. |
| ONB-035 | `KOLUX_DEV_SHOW_FIRST_RUN_EDUCATION` set to 1 switches first-run education back on in development builds. |
| HID-005 | `KOLUX_CLOUD_API_URL` and `KOLUX_CLOUD_CLIENT_ID` mattered only to development builds; release builds ignore them, and they are not carried (table above). |
| SESS-027 | Goose has no no-prompt flag: Kolux gives `GOOSE_MODE` the value auto (6.1). |

### 5.6 kolux.yaml

A file in the repo's root, committed with the project. The pre-rename legacy file name is still read when `kolux.yaml` is missing; Kolux always writes `kolux.yaml`.

| Key | Meaning |
|---|---|
| `scripts.setup` | Shell script run after a worktree is created, with the setup variables of 5.5. |
| `scripts.archive` | Shell script run before a worktree is archived or removed. |
| `setupAgentStartupPolicy` | `start-immediately` (the agent starts while setup runs) or `wait-for-setup`. |
| `issueCommand` | Default command for starting work from a linked GitHub issue. A per-user override file in the repo's .kolux folder wins over it. |
| `defaultTabs` | A list of terminal tabs to open once in each new worktree. Each entry has a title, a color (#rgb or #rrggbb, anything else ignored) and a command; an entry with none of the three is dropped. |
| `worktree.sharedDirectories` | Repo-relative folders that every worktree shares through a link instead of a copy (for example `node_modules`). Entries with two dots or the git folder are dropped. |
| The VM recipes key (environment recipes) | VM recipes. Not carried, see `DECISIONS.md`: leave them in the file and ignore the key. |

Trust: commands from `kolux.yaml` run only after Txais approves them. Approval is stored per repo and per script (setup, archive, issue command) against a hash of its text; a changed script asks again. A repo can be trusted as a whole. Per-repo choices that are not in the file (run setup: ask, run by default or skip by default; take commands from the shared file, the local settings or both) live in the app's settings.

Related repo files: `.worktreeinclude` lists git-ignored files to copy into each new worktree (literal paths only; wildcard and negation lines are skipped with a warning), and `.kolux/templates` holds repo templates.

Cards that carry a repo-file contract:

| Card | Contract |
|---|---|
| PROJ-034 | `kolux.yaml` at the repo root holds the setup script, whether the agent starts at once or waits for setup, the issue command, the default tabs (each with a title, a colour and a command), the archive script and the shared-folders list; the environment-recipes key is ignored. Files already in users' repos must keep working. The archive script and the shared folders stay under `DECISIONS.md` OD-14 (settled 2026-10-06, owner to confirm); the card was corrected to match. |
| STAT-055 | The same file carries the setup, archive and issue-command scripts; the keys are the ones in the table above. |
| GIT-067 | Existing repos may carry the root include file (one path per line; a hash sign starts a comment) and the shared-folders key in `kolux.yaml`. Both are user-facing and keep working under their existing names. |
| PROJ-032 | The include file is read from the repo root, one literal path per line; wildcard and negation lines are skipped with a warning. |
| EDIT-055 | Repo templates are read from `.kolux/templates`, the templates folder inside the repo's hidden Kolux folder, so existing templates keep working. |
| HID-037 | Nightshift-era names exist for the old twin of `kolux.yaml`, the repo settings folder, the plugin manifest and the settings folder in the home directory. Each is read when the Kolux name is missing; Kolux writes only the Kolux names. |

Project-local files that Kolux and its agents write inside a project, and that the rebuild must keep reading and writing in the same places:

- Handoff notes (SESS-025): one Markdown note per worktree, kept in a handoffs folder inside the repo's hidden Kolux folder and named after the worktree. An agent creates its note before its first change and keeps it current: files added, updated and removed, and what is left to do. Agents never edit another agent's note.
- Kit results folder (SKILL-007): a results folder at the project root, with one subfolder per role id. Each role finishes by writing a short Markdown completion marker named DONE in its subfolder. Deliverables are Markdown, CSV or one self-contained HTML page.
- Collected kit folder (SKILL-013): inside the results folder, named with the kit title, an en dash, then the short month name, the day, the year and a 12-hour time with a dot where the colon would be and no leading zero on the hour, followed by AM or PM; for example "Fake Kit – Jan 15 2026, 9.05 AM". It holds the copied files, a README (which role produced each file, with a SHA-256 of each copy in an audit footer) and one HTML results page.
- Kit run record (SKILL-014): each project keeps a small hidden run-record file and a hidden history of its last 50 runs in its results folder; the history across projects (also the last 50) lives in the app's own data folder.

### 5.7 Cards that carry an importer contract

Each row names a value or record the importer brings across from a 0.15.0 profile, with its default when the profile has none. Rows marked not carried are read and dropped.

| Card | Carried data, default |
|---|---|
| SET-035, APP-048 | The old settings file, setting by setting, plus the layout, projects and sessions of a 0.15.0 profile. |
| APP-004 | The whole Nightshift-era profile folder in the system's application-data location, matched in any letter case, is migrated into the Kolux profile folder. |
| SESS-003 | The list of turned-off agents. |
| SESS-010, SET-027, SESS-028 | The default agent (blank by default), the turned-off agents, and each agent's command override, default arguments and default environment. |
| SESS-020 | Saved shapes: the name, each seat's agent, model, options and role, the files choice and the optional prompt. |
| SESS-026 | The launch mode for setup scripts; new tab by default. |
| STAT-002, STAT-023, STAT-041 | Each saved on or off choice; on by default. |
| STAT-035 | Generated titles; off by default. |
| STAT-042, STAT-043 | Every choice on the notifications page, including the tone, the custom sound file and the volume. |
| STAT-045 | The saved threshold; 10 by default. |
| STAT-047 | Close to tray; off by default. |
| VIEW-011 | Each of the two View > Appearance button toggles; both off by default. |
| VIEW-035 | Its View > Appearance toggle; off by default. The feature is cut, so the value is read and dropped. |
| VIEW-052 | Sidebar appearance mode, tint colour and tint opacity. |
| VIEW-062 | List or tree for Source Control; list by default. |
| VIEW-097, BROW-053 | Keep awake: On, Off or Auto; off by default. Areas 03, 05 and 19 card the same behaviour; area 03 owns it, so it is built once. |
| VIEW-106 | The app-name toggle under View > Appearance; on by default. |
| VIEW-108 | Parking hidden terminals to save memory. |
| VIEW-033, VIEW-032 | Experimental switches; off by default. |
| USAGE-007, USAGE-026, ACCT-029 | Opt-in switches that stay off unless the user turned them on; USAGE-026 lets Kolux read the Gemini CLI's own saved browser sign-in. |
| USAGE-009 | Usage alerts (on by default) and, per provider and window, which threshold already fired, tied to that window's reset time so it does not fire twice. |
| USAGE-011 | Local activity counts: agents started, working time, pull requests created and the date counting began. |
| ACCT-005 | Managed Claude accounts (email, organisation, where each runs, last sign-in time) and the active one. |
| ACCT-006 | The Claude opt-out choice; off unless the user turned it on. |
| ACCT-008 | The saved xAI key. |
| ACCT-009 | Secrets stored sealed or in clear text both load, and whether the one-off sealing pass already ran. |
| ACCT-019 | Managed Codex accounts and the active one, including the older record that kept one active choice per runtime. |
| ACCT-021 | The user's Codex TOML settings file is copied into each managed Codex home. |
| ACCT-026 | Everything above on accounts, plus the Claude connection mode, the Claude 1-year key and its creation date, and the Gemini credentials choice. |
| ACCT-028 | MiniMax: the group id, the usage-model names and the endpoint choice. |
| ACCT-034, ORCH-018 | Each provider's table of tier to model and effort, for all four tiers. |
| ACCT-037 | The saved choice to skip that confirmation; off unless turned on. |
| ACCT-040 | Not carried: the account location and WSL distribution choices. |
| ORCH-032 | Nested worker depth, default 1 (the root coordinator is depth 0); anything that is not a whole number of at least 1 becomes 1. Past the limit a dispatch is refused with its own depth-exceeded error that tells the worker to do the task itself. Set in Settings > Orchestration; the rebuild may expose it as a flag or config default. |
| ORCH-034 | Runs, tasks, dispatches, messages, gates and request receipts. |
| AUTO-004 | Each automation: timed or event-driven, and which of the three events it listens for. |
| AUTO-012 | Run history: each run's status (the four progress states, the four skip causes, failed to dispatch) and how it started (timetable, by hand or event). |
| SAFE-015 | The protection master switch, the turned-off built-in rules, the custom rules and the per-project overrides. |
| EDIT-004 | Each worktree's editor session: open tabs, the tab in front, unsaved draft text. |
| EDIT-040 | One handoff note per workspace, keyed by host and path: its text and last-updated time. |
| CHAT-001 | Three yes or no chat preferences; each off by default. |
| CHAT-024 | One set of launch choices per agent; empty by default. |
| CHAT-034 | A durable per-session journal in a small embedded database. A one-time copy comes from the agent's own transcript (Claude, Codex, Grok and OMP; sources over 16 MB are skipped). The earlier line-per-event chat log is not read: such a session opens empty and says where its history went. |
| ONB-007, ONB-008, ONB-011 | The onboarding record: wizard version (7), when it closed, completed or dismissed, the last completed screen (-1 when none), the 12 checklist ticks and the milestone times. Imported users whose record is closed are not onboarded again. |
| ONB-027 | Which tips have been seen. |
| ONB-032 | The seen-tour list and whether the profile qualifies for automatic tours. |
| ONB-037 | Star-prompt state: the baseline, the next threshold, the cooldown and whether it was completed. |
| SET-001 | The theme by name; anything other than Classic or one of the 16 hues becomes Classic. |
| SET-002 | Tint, saturation and depth numbers, clamped to their spans. |
| SET-005 | System, Light or Dark, unchanged. |
| SET-014 | Kolux first or Terminal first, unchanged. |
| SET-015 | The Ctrl+Tab order; most recent first by default. |
| SET-017 | The language: System or one of the six languages, unchanged. |
| SET-032 | The saved workspaces folder and the nest-per-repo choice, as they are (and `KOLUX_WORKSPACES_DIR`, 5.5). |
| BROW-021 | Not carried: the old switch. The behaviour is always on, with no settings page. |
| BROW-027 | Browser profiles, isolated or imported; each keeps its name and, when imported, the source browser. |
| BROW-033 | Proxy address and bypass list; both empty by default, which means the system's own proxy. With the browser settings page cut they have no screen: fixed defaults under `DECISIONS.md` OD-18, which also says what a flip brings (a Browser group on General, old values imported). |
| HID-045 | A per-workspace permission choice saved by builds of this era still loads and applies at the next launch in that workspace; a malformed entry is dropped. |
| HID-012 | The dictation feature-tip names stay valid in saved or incoming records. |
| HID-018 | Old nudge records are accepted and ignored. |
| HID-004 | Not carried: the OpenCode sign-in cookie and workspace id. A saved session that names OpenCode opens as a plain terminal. |
| HID-006, HID-007, HID-008 | Not carried: the phone-pairing connection mode; artifact sharing, artifacts on or off, the artifacts button and the skip-delete-confirmation choice; skill sharing. |
| HID-010 | Not carried: the old dashboard's open mode and its saved window size and position. |
| HID-024, HID-025, HID-026, HID-027, HID-028, HID-029 | Not carried: the two chat switches (unless area 14 is revived), the pet switch, the Activity switch and its one-time reset marker, the attention switch, the sleep switch and the card-style switch. |
| HID-036 | Not carried, the full retired list: scrollback size in bytes, GitHub attribution, agents sidebar, OpenCode sign-in cookie and workspace id, dashboard open mode, artifact sharing, artifacts on or off, artifacts button, skip the artifact delete confirmation, skill sharing, phone-pairing connection mode. |

### 5.8 Update channel

APP-024. Installed 0.15.0 copies look for updates at launch and every 30 minutes, in the public GitHub releases of TxaisX/kolux-releases; the source stays in a private repo. Each release carries the Windows installer, its blockmap and the update manifest, a small YAML file naming the version, the installer, its checksum, its size and the release date. A new version downloads quietly; a pop-up then says it is ready and offers Restart to update, and if that is ignored the update installs at the next quit. The rebuild's first release must go to that same feed, with a higher version number and a manifest the 0.15.0 updater accepts, or installed copies never move to it. Release versions are one patch above the larger of the project's own version and the newest release tag. After a release, `kolux --version`, the installed app and the manifest report the same version (2.11).

## 6. Agent names and detection

An agent counts as installed when its command is found on PATH (or one of its alternative names). No agent is turned off by default. The retired opencode id is mapped away when old settings name it.

| Agent | Id | Command on PATH | Also accepted | Launched as (when different) | Model picker | Status reporting |
|---|---|---|---|---|---|---|
| Claude (featured) | claude | claude |  |  | yes | hooks (3.4) |
| Claude Agent Teams | claude-agent-teams | kolux | kolux-dev, kolux-ide; also needs claude on PATH; not offered on Windows or WSL | kolux claude-teams; Linux: kolux-ide claude-teams; Windows: kolux.cmd claude-teams | no | none of its own (it runs Claude) |
| OpenClaude | openclaude | openclaude |  |  | no | hooks (3.4) |
| Codex (featured) | codex | codex |  |  | yes | hooks (3.4) |
| Autohand Code | autohand | autohand |  |  | no | none |
| Ante | ante | ante |  |  | no | none |
| Trae | trae | traecli |  |  | no | none |
| MiMo Code | mimo-code | mimo |  |  | no | status plugin |
| Pi | pi | pi |  |  | no | managed status extension |
| OMP | omp | omp |  |  | no | managed status extension |
| Prime Agent | prime-agent | prime-agent |  |  | no | managed status extension |
| Gemini | gemini | gemini |  |  | yes | hooks (3.4) |
| Antigravity | antigravity | agy |  |  | no | hooks (3.4) |
| Aider | aider | aider |  |  | no | none |
| Goose | goose | goose |  |  | no | none |
| Amp | amp | amp |  |  | no | hooks (3.4) |
| Kilocode | kilo | kilo |  |  | no | none |
| Kiro | kiro | kiro-cli |  | kiro-cli chat --tui | no | none |
| Charm | crush | crush |  |  | no | none |
| Auggie | aug | auggie |  |  | no | none |
| Cline | cline | cline |  |  | no | none |
| Codebuff | codebuff | codebuff |  |  | no | none |
| Command Code | command-code | command-code |  | command-code --trust | no | hooks (3.4) |
| Continue | continue | cn |  |  | no | none |
| Cursor | cursor | cursor-agent |  |  | yes | hooks (3.4) |
| Droid | droid | droid |  |  | no | hooks (3.4) |
| Kimi | kimi | kimi | kimi-code |  | no | hooks (3.4) |
| Mistral Vibe | mistral-vibe | vibe | mistral-vibe |  | no | none |
| Qwen Code | qwen-code | qwen |  |  | no | none |
| Rovo Dev | rovo | rovo |  |  | no | none |
| Hermes | hermes | hermes |  | hermes --tui | no | hooks (3.4) |
| OpenClaw | openclaw | openclaw |  |  | no | none |
| GitHub Copilot | copilot | copilot |  |  | no | hooks (3.4) |
| Grok (featured) | grok | grok |  |  | yes | hooks (3.4) |
| Devin | devin | devin |  |  | no | hooks (3.4) |

Model picker: Claude, Codex, Gemini, Cursor and Grok have a model list. Hooks: the 14 agents of section 3.4; MiMo Code reports through its plugin; Pi, OMP and Prime Agent through managed extensions.

Stable ids (SESS-001): the Id column is each agent's permanent id. Settings, saved shapes and per-agent shortcut ids refer to agents by it, so it never changes.

### 6.1 Built-in no-prompt switches

Started without default arguments of the user's own, these agents run in the mode where they do not stop to ask for approval (SESS-027 in `spec/02-sessions-launching.md`). Each switch is spelled exactly as the agent's own command line expects it. Default arguments the user sets replace the built-in ones, and an argument an agent does not accept is removed before launch (Kilocode).

| Agent | No-prompt switch |
|---|---|
| Claude (Claude Code) | `--permission-mode` with the value auto |
| Codex | `--sandbox` with the value workspace-write and `--ask-for-approval` with the value never (DT-C46, 2026-10-13: sandboxed, never asks; the bypass flag is never used) |
| Gemini (Gemini CLI) | `--yolo` |
| Aider | `--yes-always` |
| Goose | no flag: `GOOSE_MODE` given the value auto |

## 7. Contracts carried only on cards

Contracts that fit none of the sections above. One row per card; the card holds the detail.

| Card | Contract |
|---|---|
| TERM-099 | Ghostty config files (one key = value per line) and Ghostty theme files are read; unknown keys and invalid values are reported, not fatal. |
| TERM-100, SET-024 | Warp theme files (YAML) and the Ghostty configuration stay sources the user can bring colour schemes in from. |
| EDIT-010 | The editor highlights Astro, Svelte, Vue, Nim and JSON Lines files. |
| EDIT-014 | Link anchors are written as #L and a line number, #L, a line number, C and a column, or a colon, line, colon, column; notes link to each other with a name in double square brackets. |
| EDIT-019 | Markdown with YAML or TOML front matter opens and saves without changing the parts the user did not edit. |
| EDIT-023 | CSV and TSV files open as tables. |
| EDIT-024 | Jupyter notebooks open with their cells, each cell's source and its outputs. |
| GIT-017 | Agents offered for writing commit messages: Claude Code, Codex, Amp, Kimi, Copilot, Pi, Cursor and Antigravity, plus a custom command. |
| GIT-018 | A custom commit-message command marks where the prompt goes with `{prompt}`; saved commands that use it keep working. |
| BROW-028 | Cookie files are a JSON list of cookie records, each with a name, a value and a domain, and optionally a path, the secure flag, the HTTP-only flag, a same-site mode and an expiry. The accepted field spellings should match the common browser-extension export format (to confirm). |
| BROW-034 | Device presets: Mobile S 320 by 568, Mobile M 375 by 667, Mobile L 425 by 812, Tablet 768 by 1024, Laptop 1024 by 768, Laptop L 1440 by 900 and Desktop 1920 by 1080; the phone and tablet presets are touch devices at double pixel density. |
| VIEW-091 | Session history is read from each agent's own transcript folder: Claude from the projects folder under `CLAUDE_CONFIG_DIR` or `~/.claude/projects`; Codex from Kolux's managed home, then `CODEX_HOME` or `~/.codex/sessions`; Gemini from `~/.gemini/tmp`; Copilot from `COPILOT_HOME` or `~/.copilot`; Cursor from `~/.cursor/projects`; Hermes from `~/.hermes/sessions`; Rovo Dev from `~/.rovodev/sessions`; OpenClaw from its state-folder variable or `~/.openclaw`, plus its earlier-name folder; Pi from its agent-folder variable or `~/.pi/agent/sessions`; OMP from `OMP_CODING_AGENT_DIR` or `~/.omp/agent/sessions`; Devin from its home variable or `~/.local/share/devin/cli`; Droid from the sessions and projects folders under `~/.factory`; Cline from its session-data variable or `~/.cline/data/sessions`. |
| VIEW-112 | Setup steps can be brought in from other tools' repo config: Superset's project and local config, Conductor's config, cmux's config (in its hidden folder or at the repo root) and Codex environment files. Oversized or malformed files are refused before they are parsed. |
| USAGE-016 | Claude Code's per-project transcripts, one record per line, give token usage per reply, cache writes split by lifetime, message and request ids and the working folder; each turn is counted once. |
| USAGE-017 | Codex session logs under each Codex home give the token-count events, the session details and the working folder. |
| CHAT-007 | Chat history is read in each agent's own format, honouring the home-folder variables those agents define: Claude's event-per-line log (under `CLAUDE_CONFIG_DIR` or `~/.claude/projects`), Codex's session rollout (Kolux's managed home, `CODEX_HOME` or `~/.codex/sessions`), Grok's chat history (`GROK_HOME` or `~/.grok/sessions`) and omp's session log (`OMP_CODING_AGENT_DIR` or `~/.omp/agent/sessions`). |
| SKILL-021 | Skills are folders in the standard agent-skill format, each with a `SKILL.md`, read from each AI's skills folder (`~/.claude/skills`, `~/.codex/skills`, `~/.omp/agent/skills`) and from the shared cross-agent folder `~/.agents/skills`. |
| SKILL-026 | Updating runs the community skills installer's update command through Node's package runner with no prompts, the skill names in sorted order, a yes flag and global scope. |
| SKILL-028 | Installing runs the same installer's add command against the Kolux repo, with the skill flag once per skill, the agent flag listing the detected AIs plus the shared folder, a yes flag, and the global flag for a global install. |
| SKILL-029 | The bundled skills are kolux-cli, orchestration, koluxsecurity, koluxward and, since 2026-10-31 at Txais's request (DT-C64), video, each matched to the app's version. |
| APP-037 | Issue reports go to the owner's public repo TxaisX/kolux through GitHub's own new-issue page, with the title and body passed in its address; the user reviews them there before sending. |
| ACCT-002 | Seven ways to connect: Claude by 1-year key, Claude by account, Codex by ChatGPT sign-in, Codex by device code, Grok by CLI login, Grok by device code and Grok by API key. |
