# Kolux

Run a team of AI coding agents in parallel on Windows, each in its own git worktree.

Kolux is a desktop workspace for agent-driven development. Point it at a repository, launch
the agent CLIs you already have on your PATH, and every session gets an isolated worktree, its own
terminals, and a status you can read at a glance.

## What it does

- **Isolated sessions.** Each agent works in its own git worktree, so parallel sessions never fight
  over the same checkout.
- **Any agent on your PATH.** Claude Code, Codex, Gemini CLI, Copilot, OpenCode, Aider and others
  are detected automatically. Kolux launches them and bills through your own accounts; it
  bundles no models and no keys.
- **One-click launch.** The `+` menu lists only the agents actually installed on the machine, so a
  new agent terminal is one click, or one keystroke once you bind a shortcut.
- **Launch a shape, not a prompt.** Solo, Pair, Workbench and Swarm open several sessions at once
  and give each a distinct role, with a lineup you review before anything is created.
- **Live status.** Managed hooks report whether each agent is working, waiting on you, or done.
- **Automations.** Run a prompt on a schedule, hourly, daily or on a cron expression.
- **Orchestration.** A first-class CLI creates runs and tasks, starts worker sessions from inside
  another agent, dispatches work between them, and carries messages in per-run mailboxes.
- **Everything in one window.** Terminals, an editor, a browser and diff review sit side by side.

## Build (Windows 11)

Requirements: Node 24 with `corepack enable` (pnpm is pinned by `packageManager`), Visual Studio
2022 Build Tools with the C++ workload (not 2026 — node-gyp cannot detect VS 18), Python 3, and
Windows long paths enabled. Clone with `core.autocrlf=false`; CRLF breaks linting.

```
pnpm install
pnpm dev                 # development instance
pnpm run build:win       # unsigned NSIS installer in dist/
```

The installer is unsigned, so SmartScreen will warn: choose More info, then Run anyway.

Install a fresh build from **PowerShell**, never Git Bash, which rewrites `/S` into a path and
silently drops the installer into its interactive UI:

```
Start-Process dist\kolux-windows-setup.exe -ArgumentList '/S','/currentuser' -Wait
```

Close any editor window holding the repository or the install folder first. An update moves every
installed file aside and aborts if one is locked. `config/scripts/windows-who-locks.ps1 -Path <file>`
names the process holding it.

## Command line

The shipped CLI lives at `%LOCALAPPDATA%\Programs\kolux\resources\bin\kolux.cmd`.

```
kolux status
kolux repo add --path <repo>
kolux worktree create --name x --repo path:<repo> --agent claude --prompt "..."
kolux terminal create --worktree name:x --command claude --focus
kolux orchestration run-create
```

`kolux --help` lists every command; `kolux orchestration --full` documents the
orchestration surface.

## Configuration

- `KOLUX_WORKSPACES_DIR` overrides where worktrees are created.
- Keyboard shortcuts are user-owned in `~/.kolux/keybindings.json`.

### Shortcuts that ship unbound

A number of commands deliberately ship with no key assigned, so they never steal
a chord you already use. They are on menus and in the shortcut list, and you bind
the ones you want. Among the most useful:

| Command | What it does |
| --- | --- |
| Toggle Agent Dashboard | One view of every agent and what it is doing (see below) |
| Toggle Workspace Board | The board view of your workspaces |
| Equalize pane sizes | Evens up panes you have split inside a tab |
| New agent tab | Opens a tab already running your default agent |
| Toggle Quick Commands menu | The per-workspace command palette |
| Open Tasks | The task list |

Assign them in the shortcut list, or add them under the `platforms` block of
`~/.kolux/keybindings.json`, for example:

```json
{
  "version": 1,
  "platforms": {
    "win32": {
      "dashboard.toggle": ["Mod+Alt+D"],
      "terminal.equalizePaneSizes": ["Mod+Shift+U"]
    }
  }
}
```

`Mod` is Ctrl on Windows and Linux, Command on macOS. The app validates the file
on load and reports conflicts rather than silently dropping a binding.

### The agent dashboard is opt-in

The dashboard is the control tower. It opens in its own window as a board of
every agent across every workspace, in three columns:

| Column | What lands there |
| --- | --- |
| Needs you | Agents parked on a question only you can answer |
| Working | Agents currently running |
| Done | Agents that finished |

Idle agents are hidden by default, so a quiet agent shows in no column and the
count reads zero. Turn on **Show idle agents** in the dashboard's own settings
menu to add a fourth column for them.

Sub-agents nest under the session that spawned them, each row carries a status
dot, and a filter narrows the board. The board can also start an agent, so it
is a place to act from and not only to watch.

It ships behind an experimental setting and is off by default, so its shortcut
does nothing and its row is hidden in the shortcut list until you turn it on.
Enable **Experimental agent dashboard popout** in Settings, then bind
`dashboard.toggle`. Turning it on also adds an Agent Dashboard entry to the
sidebar. Binding the shortcut without the setting has no effect, which is easy
to mistake for a broken key.

Day to day you may not need it: each workspace row in the sidebar already shows
its agent and state, for example `Claude Code - Idle`.

## License

MIT. See [LICENSE](LICENSE).
