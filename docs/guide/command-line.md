# Command line

Drive Kolux from any terminal pane: make a workspace, read a pane's output, type into a pane, wait for a program to finish. Anything you can click for workspaces and panes, a script or an agent can do with one line.

## The command is `kolux`

The installed app puts a program called `kolux` (`kolux.exe`, with a `kolux.cmd` helper beside it) in the `bin` folder of its install folder. A development build calls the same program `kolux-dev`. Both are one program with one set of commands.

Two things to know:

- **The help text always says `kolux-dev`.** Every usage line in `kolux --help` starts with `kolux-dev`, even when you ran `kolux`. Type `kolux` where the help says `kolux-dev`.
- **Inside a Kolux RS pane, `kolux` is this app's command.** Kolux puts its own folder first on the PATH (the list of places Windows looks for programs) in every pane it opens. If you also have the older Kolux installed, a plain terminal outside Kolux RS may find that one instead. Registering the command for the whole computer is not built.

To check which one you are running:

| Check | Run | You should see |
|---|---|---|
| Which program is found first | `where.exe kolux` | A path under the Kolux RS install folder, ending in `bin\kolux.exe` |
| Version | `kolux --version` | `0.1.0` |
| Which app the pane belongs to | `$env:KOLUX_APP_DIR` (PowerShell) or `echo %KOLUX_APP_DIR%` (Command Prompt) | A folder ending in `com.txaisxiong.kolux-rs` |

## How it reaches the app

The running app listens on a random port of your own computer (address `127.0.0.1`, reachable only from this machine). It writes the port and a one-run secret key into `cli.json` in its data folder, `%APPDATA%\com.txaisxiong.kolux-rs`. The command reads that file, sends one request and prints the answer.

- A request that looks like a web page request is dropped, so a web page cannot talk to Kolux this way.
- A request with the wrong key is refused.
- Kolux handles one request at a time. If it does not answer within 300 seconds, you get "Kolux is running but did not answer within 300 s; it may still be working".

## Run Kolux from the command line

| Command | What it does |
|---|---|
| `kolux open` | Starts Kolux, or brings its window to the front, and waits up to 60 seconds until it answers. It then says whether the window really came to the front (see below) |
| `kolux status` | Says whether Kolux is up, without starting it. Works with the app closed (see below) |
| `kolux diagnostics memory` | Shows how much memory Kolux and each terminal session use (see below) |
| `kolux --version` | Prints the version |
| `kolux --help` | Lists every command. `--help` also works on a group, such as `kolux terminal --help` |

When Kolux was already running, `kolux open` restores its window and brings it forward itself, the way a second start of the app does, and reports what happened: "Kolux is ready; its window is in front" when Windows let it, or "Kolux is ready; its window was restored, but Windows kept another window in front" when it did not (Windows then flashes Kolux in the taskbar instead). With `--json`, `result.raised` is `true` or `false`; it is `null` when the question could not be asked (an answer naming no process, or a system other than Windows). When Kolux had to be started, the line reads "Kolux started and is ready".

`kolux status` prints one line with one of four words. Scripts can rely on these words; they will not change.

| Word | Means | Exit code |
|---|---|---|
| `running` | Kolux is up and ready | 0 |
| `graph-not-ready` | Kolux answers but is still reading your projects' workspaces, usually for a second or two after it starts | 1 |
| `stale` | Kolux left `cli.json` behind (it was killed or crashed) and nothing answers. Run `kolux open` to start it again | 1 |
| `not-running` | Kolux is closed | 1 |

With `--json` the word is in `result.state`, and the command counts as worked in every case. The exit code still says whether Kolux is ready.

Kolux answers the command line one request at a time. If it is busy with another one (a workspace being created with its setup, for example), `kolux status` still answers at once and says what Kolux is busy with and for how long, for example `running: Kolux is up, busy with another request for 3 min 12 s (worktree.create) (pid 4545)` (exit 0). With `--json`, `result.detail` reads "busy with another request", `result.busyMs` is the time in milliseconds and `result.busyCommand` is the request's name. A busy time of many minutes may mean Kolux is stuck, so use it to tell a long request from a hung one. An older Kolux app cannot say how long: `kolux status` then waits about 2.5 seconds and says only `running: Kolux is up, busy with another request`. It never waits the 5 minutes other commands allow.

`kolux diagnostics memory` prints the Resource Manager's memory figures: Kolux itself, then each terminal session together with every program running inside it, then the total, then free memory. Each row has two numbers:

| Column | Means |
|---|---|
| resident | Memory the process is using right now |
| committed | Memory Windows has set aside for it. When the computer runs low, this is the figure that runs out |

A dash means Kolux could not read that figure. When some of a row's programs could not be read, its committed figure is a dash rather than a partial sum, and the row adds a note such as "(2 of 5 could not be read)". The Total does the same, so it never passes a partial sum off as the whole. The Resource Manager in the app shows the same two figures, Resident and Committed, with a dash where Kolux could not read one. If Kolux is closed, the command says so in one line and exits with 1.

Every command takes `--json` to print one machine-readable result instead of text. Without it, errors go to the error stream. Exit code 0 means it worked; 1 means any error.

## Selectors: how you name things

Many commands take `--repo` or `--worktree` to say which project or workspace you mean.

| Option | Accepts |
|---|---|
| `--repo` | `id:<id>`, `name:<name>`, `path:<folder>` |
| `--worktree` | `active`, `current`, `id:<repo-id>::<path>`, `identity:...`, `name:...`, `branch:...`, `issue:...`, `path:...` |

A worktree is a separate working copy of a project on its own branch; the rest of this guide calls it a workspace. With no selector, the command uses the folder you are standing in.

## Projects and workspaces

| Command | What it does |
|---|---|
| `kolux project list` | Lists your projects |
| `kolux repo list` | Lists repositories |
| `kolux repo add --path <folder>` | Adds a Git repository as a project |
| `kolux repo show` | Shows one repository |
| `kolux repo set-base-ref --ref <ref>` | Sets the branch new workspaces start from |
| `kolux repo search-refs --query <text>` | Searches branches and tags; `--limit` caps the list |
| `kolux worktree create --name <name>` | Makes a workspace. Options: `--repo`, `--agent`, `--prompt`, `--setup run\|skip\|inherit`, `--base-branch`, `--issue`, `--comment`, `--parent-worktree`, `--no-parent`, `--run-hooks`, `--activate` |
| `kolux worktree rm --worktree <selector>` | Removes a workspace (also `remove`, `delete`). `--force` and `--run-hooks` are optional |
| `kolux worktree list` | Lists workspaces; a project whose folder cannot be read (deleted, or on an offline drive) is named instead of emptying the list |
| `kolux worktree ps` | Lists them with a summary of orchestration work |
| `kolux worktree show` | Shows one workspace |
| `kolux worktree current` | Shows the one you are in. `--usage` adds the tokens its sessions used |
| `kolux worktree set` | Renames it or changes its issue, comment or parent: `--display-name`, `--issue`, `--comment`, `--parent-worktree`, `--no-parent` |
| `kolux worktree changes` | Lists what the workspace changed |
| `kolux worktree overlap` | Shows who else touches the same files |

`--prompt` needs `--agent`: a first prompt has to go to an agent.

Example: make a workspace named `fix-login` and switch to it.

```
kolux worktree create --name fix-login --activate
```

## Panes

A pane is one terminal. Each has a handle (its name for scripts) that looks like `term-3`. Inside a pane, `KOLUX_TERMINAL_HANDLE` holds that pane's own handle, and commands that take `--terminal` default to it.

| Command | What it does |
|---|---|
| `kolux terminal list` | Lists panes; `--worktree` narrows it |
| `kolux terminal show --terminal <handle>` | Shows one pane |
| `kolux terminal create` | Opens a pane. Options: `--worktree`, `--command`, `--title`, `--focus` |
| `kolux terminal split --terminal <handle>` | Splits a pane: `--direction vertical\|horizontal`, `--command` |
| `kolux terminal rename --terminal <handle> --title <t>` | Renames it. Without `--title` the default name returns |
| `kolux terminal switch --terminal <handle>` | Focuses it (also `focus`) |
| `kolux terminal close --terminal <handle>` | Closes it. `--tab` closes the whole tab; `--worktree <selector> --all` closes every pane of a workspace |
| `kolux terminal read` | Prints what the pane showed. `--cursor` and `--limit` page through output; `--screen` gives the frame visible now. `--screen` and `--cursor` cannot be combined (a screen has no history). When older lines are no longer kept, a warning says which cursor to read on from. In the output form, PowerShell may show a typed command twice because it redraws the line as you type; `--screen` shows it once |
| `kolux terminal send` | Types into a pane: `--text`, `--enter`, `--interrupt`. With none of them it refuses. When it sends a prompt to an agent, it watches 3 seconds and reports whether the agent began its turn, or warns that Enter may have been lost. If the agent is already working, it says "queued" at once, exit 0: the prompt waits behind the agent's turn. A plain send always exits 0, so a script does not read a warning as a failure and send the prompt twice. `--wait-submit <seconds>` (1 to 300; anything else is refused) changes the watch time and asks for a firm answer: if the agent has not taken the prompt in that time, the command fails (exit 1) and says why, for example "term-2 did not submit the prompt within 5 s (it is working; the prompt waits behind its turn)". With `--retry-request <id>`, sending the same id to the same pane again answers with the first receipt and types nothing (until Kolux restarts) |
| `kolux terminal wait --for exit\|tui-idle` | Waits until the program ends, or a full-screen program stops moving. `--timeout-ms` sets the limit; if it passes first, the command fails (exit 1) and names the state the pane is in ("term-3 did not reach exit within 60000 ms (it is running)"). With no status hooks reporting, `tui-idle` means 3 seconds without output, and a warning says so |

With `--json`, `kolux terminal list` and `kolux terminal show` give each pane's `cwd` (the folder it started in), `program` (what it runs), and the workspace and branch that folder belongs to. For a plain shell pane opened without a folder, `cwd` is your home folder and `program` is the shell that actually started (a fallback shell if your chosen one would not start), so neither is empty any more. Unless your home folder is itself inside a workspace, such a pane belongs to no workspace, so its workspace and branch stay empty. The plain-text form of `show` prints the handle, title, workspace, pane, tab and whether it is in view.

Examples:

```
kolux terminal read --terminal term-3 --screen
kolux terminal send --terminal term-3 --text "npm test" --enter
kolux terminal wait --terminal term-3 --for exit --timeout-ms 60000
```

## Accounts

| Command | What it does |
|---|---|
| `kolux account add --agent claude\|codex` | Runs that agent's own sign-in in the current terminal. Codex uses a device code |
| `kolux account list` | Lists your Claude and Codex accounts |

## Working with other agents (orchestration)

Orchestration lets one agent (a coordinator) hand work to others (workers) and exchange messages. A Run is one coordinated effort; a task is one piece of work in it; a dispatch hands a task to a worker. These commands are for agents and scripts, so only the groups are listed here. Run `kolux orchestration --help` for every flag.

| Group | Commands |
|---|---|
| Runs | `run-create`, `run-use`, `run-current`, `run-list`, `run-show` |
| Messages | `send`, `check`, `reply`, `inbox`, `ask` |
| Tasks | `task-create`, `task-list`, `task-update`, `dispatch`, `dispatch-show` (see [Held tasks](#held-tasks)) |
| Decision gates (a question that holds a task until answered) | `gate-create`, `gate-resolve`, `gate-list` |
| Workers | `worker-start`, `worker-list`, `worker-show`, `worker-stop`, `worker-abandon`, `worker-retain`, `worker-release` (see [Worker commands](#worker-commands)) |
| Housekeeping | `request-show` (what became of a change whose answer was lost), `reset --all\|--tasks\|--messages` |

Changes can be retried safely: pass the same `--retry-request <id>` and the work is not done twice.

### Held tasks

A task whose worker has failed three times is held back: Kolux no longer hands it out. `task-list` shows its status as "held" instead of "ready", and `--ready` leaves it out. `--status held` lists only held tasks. With `--json`, a held task also carries `failures` (the count) and `held` ("held (3 failures)"). The plain-text line shows only the word "held", not the count.

`orchestration task-reset --id <task>` frees a held task: it closes the breaker, so the task lists as ready again, and the failed records stay. The app itself has no button for it.

### Worker commands

A worker is an agent a coordinator started for one task. Each worker has a dispatch id such as `dispatch-2`, and most worker commands take `--dispatch <id>`. The "next:" commands in the answers start with `kolux-dev`, like the help text. Type `kolux`.

| Command | What it does |
|---|---|
| `worker-list` | One row per worker with what is left of its terminal: active, reclaimable, retained, release_pending, release_unknown or released. `--terminal-state` narrows it; `--limit` and `--cursor` page through it. A row ends with "next: " and the command to run |
| `worker-show --dispatch <id>` | Shows one worker: its terminal state, task status, terminal, workspace folder and whether it is waiting on a person |
| `worker-stop --dispatch <id>` | Ends the worker's agent terminal and keeps its workspace folder |
| `worker-abandon --dispatch <id>` | Gives up on the worker; its task goes back to ready |
| `worker-retain --dispatch <id>` | Keeps a settled worker's terminal open on purpose, across restarts. Answers "kept: its terminal ... stays open until it is released" |
| `worker-release --dispatch <id>` | Saves a settled worker's output to a text file, then closes its terminal. The workspace folder stays. A worker still working is turned away: stop it first |

**Release.** Kolux marks the worker, saves its terminal output, and only then closes the terminal. The output goes to one file per worker, `worker-archives\<dispatch id>.txt`, in Kolux's data folder. If the file cannot be written, nothing is closed. Releasing a worker twice answers "was already released".

| You see | What it means | What to do |
|---|---|---|
| `release_pending` in `worker-list` | A release started and did not finish, for example because Kolux quit in the middle | Run `worker-release` again; the row's "next:" says so |
| `release_unknown` in `worker-list`, or "release unknown: ..." | The release stopped half-way: the output could not be saved so the terminal was left open, or it was saved but the terminal would not close | Run `worker-release` again. `--json` gives the reason in `error` and the saved file in `archive` |
| "released: its output is saved at <file> and its terminal is closed; the worktree <folder> stays" | The release finished | Nothing |

**A terminal that is not the worker's own stays open.** Release closes only a terminal the worker started itself. It leaves the terminal open, and still counts the worker as released, when:

- the worker was handed a terminal that was already open;
- another worker still working, or kept, uses the same terminal;
- the terminal now runs a different agent than the worker's, or only a shell.

Both answers give the reason. With `--json` it is in `terminalLeftOpen`. The plain-text line reads "<dispatch id> released: its terminal term-N is left open (<reason>); the worktree <folder> stays". "Its terminal was already gone" is printed only when the terminal really was gone.

**Waiting on a person.** `worker-show` answers yes, no or unknown, with a reason in parentheses. "No" appears only when Kolux can tell: the worker has settled, or its terminal has ended. A live worker reads unknown: "Kolux has not read a prompt off its screen, so it cannot say nothing is waiting". The command line does not pass a pane's status hooks into `worker-show` yet, so it never answers yes.

**Attention flags.** With `--json`, `worker-show` adds `attention` and `attentionWhy`. These can be raised today:

| Flag | When |
|---|---|
| failure | The worker's task failed |
| interruption | The agent ended before it reported done, its terminal ended, or Kolux restarted under it |
| stale | A working worker sent no heartbeat for over 10 minutes |

Input and approval flags (an agent waiting for a person) need the pane's status hooks, which this command does not read yet. A worker that has settled raises nothing.

**Stop warning.** `worker-stop` adds a line starting "warning: " when the worker's process may still be running. It has two forms:

- "the worker's process was kept alive: Kolux could not end <terminal>, so it may still be running; close it by hand if it is" appears when Kolux has no terminal to end for the worker, or tried to end it and could not;
- "the worker's process was left running: <reason>; close it by hand if it should stop" appears when Kolux chose not to end the terminal because it is not the worker's own (the same reasons as for release, above). The stop itself still counts, and the task goes back to ready.

**How Kolux finds the worker's terminal.** The window puts the dispatch id into the first session it starts for the worker, and Kolux counts only that stamped session as the worker's. A tab you open yourself in the same folder is never taken for the worker, so `worker-stop` and `worker-release` cannot end it. The start counts as ready once the stamped session has written something and then been quiet for one second. A worker started through a custom command (a wrapper, a `.cmd` file or `npx`) is found the same way, by its stamp, not by the program it runs.

**A worker start that does not come up.** If the window has not stamped a session for the dispatch in time (a slow start, for example on a busy PC), `worker-start` exits 1 with "the worker did not come up within N ms; it may still be starting in the background (<dispatch id> in <folder>); if it does, worker-show and worker-stop find its session". Nothing is closed for you. With `--json` the answer names the stage reached ("worker"), what was done (task handed over, workspace folder made, terminal opened), what is left over, and the commands to clean up or retry: `worker-stop --dispatch <id>`, `worker-start --task <task>`, and `worktree rm` for a folder it made. The plain-text form prints the message and the `worktree rm` hint only. A failure in the workspace's setup script is not named as a "setup" stage yet.

**Late agents.** After a start gives up, Kolux keeps the dispatch open to a late session for 10 minutes (while Kolux stays running). If the window does start the agent in that time, the session is tied to the dispatch and recorded on its row the next time any worker command runs, so `worker-show`, `worker-stop` and `worker-release` can find and end it. `worker-list` and `worker-show` rows then end with "its agent came up late"; with `--json` they carry `lateStamp`, and `worker-list` also `latePending`.

If the dispatch had already been stopped, abandoned, released, completed or failed when the agent came up, the row keeps that status in `lateAfter` and Kolux raises an alarm. A stopped, abandoned or released dispatch says "<id> was already <status> when its agent came up late; the agent in <terminal> is running on a task that was handed back". A completed or failed one says the agent is "a second agent on a finished task". The alarm is added to every worker answer for that Run (a terminal tied to no Run sees all Runs): as a `lateWorker` note with `--json`, and as a "warning: ...; next: ... worker-release --dispatch <id>" line in plain text. It does not go away when you read it once. A second `worker-show` of the row stops the alarm, and a `worker-release` that closes the late terminal ends it for good. If that release leaves the terminal open, the note says "the late agent's terminal <terminal> is left open (<reason>), so that agent is still running on a task that was handed back" and points to `terminal close`.

One Windows quirk: the `kolux.cmd` helper refuses `kolux orchestration send` and `kolux orchestration reply` (exit code 2), because the Windows command prompt reads their text a second time and can change it. Run `kolux.exe orchestration send ...` instead.

## Automations

| Command | What it does |
|---|---|
| `kolux automations list` | Lists automations |
| `kolux automations show <id>` | Shows one |
| `kolux automations runs <id>` | Lists its past runs |
| `kolux automations create` | Makes one: `--name`, `--trigger hourly\|daily\|weekdays\|weekly\|<cron line>`, `--prompt`, and optional `--time`, `--day`, `--timezone`, `--repo`, `--workspace`, `--workspace-mode`, `--enabled\|--disabled` |
| `kolux automations edit <id>` | Changes one, with the same flags |
| `kolux automations remove <id>` | Deletes one |
| `kolux automations run <id>` | Runs it now |

## Commands that work with Kolux closed

| Command | What it does |
|---|---|
| `kolux agent-context` | Lists every command with its flags and usage, for an agent to read |
| `kolux skills list`, `skills get <topic>`, `skills coverage` | Lists Kolux's skill documents, prints one, and shows which installed agents have the orchestration skill |
| `kolux agent hooks status` | Shows, for each agent, whether its status hooks are installed, partial, not installed or in error. Antigravity can also show "disabled" when its Kolux bundle is switched off in its own file (`"enabled": false`) |
| `kolux agent hooks on`, `agent hooks off` | Switches the status hooks and brings every agent in line |
| `kolux agent hooks prepare-codex` | Installs and trusts Kolux's Codex hooks before Codex is first started |

`kolux claude-teams` is not available on Windows.

## Typos and errors

A mistyped command is caught before Kolux is contacted, with a suggestion: "no command or group is called kolux-dev x; did you mean kolux-dev y?" Other messages:

| Message | What to do |
|---|---|
| Kolux is not running; start it with `kolux open` first | Run `kolux open`, or start the app |
| the token does not match this app; is cli.json stale? | The app was restarted or a different Kolux is running. Retry; if it persists, see [Troubleshooting](troubleshooting.md) |
| this Kolux is older than the command line; update Kolux before sending orchestration changes | Update the app |
| the connection to Kolux dropped while sending | Check whether the change happened (`request-show` for orchestration), then retry |
| --path is required: the folder of a Git repository | Give `repo add` a `--path` |
| kolux.exe is missing from the folder of kolux.cmd; reinstall Kolux. | Reinstall |

## Not built yet

These do not exist, so do not look for them: opening or comparing files from the command line, a `tab` command, registering `kolux` on the PATH for the whole computer, `worker-read`, `ask`'s older hand-back with exit status 75, and a command to reset a held task.

<!-- verified against: src-tauri/src/cli.rs, src-tauri/src/bin/kolux.rs, src-tauri/src/bin/kolux-dev.rs, src-tauri/Cargo.toml, src-tauri/cli/kolux.cmd, src-tauri/src/terminal.rs, src-tauri/src/resources.rs, src/status/ResourceManager.tsx, PLAN.md (T-262-c, T-250-a, T-250-b, T-076-c, T-287-c, MERGE-49) at 73f5e38; worker and held-task sections (src-tauri/src/orchestration.rs, src-tauri/src/local_cli.rs, T-089-c, T-129-c, T-172-c, T-279-c) at 5e6726c2 -->
