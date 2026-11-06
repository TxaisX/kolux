# Troubleshooting

Find out what went wrong, get a safe report to share, and get back to work. Start with the table of symptoms. Then use "Copy diagnostics" if you need help.

## Quick fixes

| What you see | What it means | What to do |
|---|---|---|
| A pane shows "The shell ended with exit code N" with **Close pane** and **Restart** | The program in the pane stopped | Restart runs the same start line again in that pane. Close pane gives its space to the neighbours |
| "The program is not installed where Kolux looks for it (it is not on PATH)" | Windows cannot find the program | Install it, or fix your PATH, then open the pane again |
| "Windows refused to start the program (access denied)" | An antivirus or policy blocked it | Allow the program, then open the pane again |
| "Git Bash could not start another process: Windows has run out of process slots for it" | Too many programs running | Close a few terminals or other programs, or restart Kolux, then open the pane again |
| "The program in this pane has ended, so nothing can be sent to it" | You sent text to a pane whose program had stopped | Restart the pane |
| "The shell could not find a command it was started with (exit 127)" | The start line names a missing command | Check the agent's Command in Settings, Agents |
| Exit 126 or 128: "usually a permission or a path problem" | The shell found the program but could not run it | Check the file's permissions and path, then Restart |
| Exit above 128: "The shell was stopped by a signal" | Something ended the program from outside | Restart |
| An unexplained error ends with a "report it" link | Kolux has no plain words for it | Copy diagnostics (below) and report it |
| A new terminal opens with a dim line "<shell> did not start; opened <shell>" | The default shell you chose in Settings would not start, so Kolux used the next automatic shell | Check that the shell is still installed, or pick another under Settings, Terminal & sessions, Default shell. See [Settings](settings.md#default-shell) |
| The Skill folders list says "Not scanned: This folder links to another computer, which Kolux never opens" | The workspace is on a network share, or a skills folder is a link to one. Kolux never reads through those | Use a copy on a local drive, or a mapped drive letter for the workspace. See [Safety](safety.md#other-computers-and-network-shares) |
| A pane stays blank after it opens | A known case: a shell sometimes stalls as it starts | Close the pane and open a new one |
| The Board or Agents page shows no live status | Agent status hooks are off | Turn on "Agent status hooks" in Settings, Agents. See [Settings](settings.md) |
| An agent halted | A usage limit, a lapsed sign-in or a provider error | The Board shows it in the Stopped lane with the reason. See [Board, Agents and Inbox](board-agents-inbox.md) |
| "Sign in again" on a card | A sign-in lapsed | Use the button, or Settings, Accounts & keys |
| A save was refused: "changed on disk since you opened it" | An agent or program changed the file | Choose Reload or Keep mine. See [Files and browser](files-and-browser.md) |
| "outside your projects" | The fence blocked a file | See [Safety](safety.md) |
| Removing a workspace is refused | The workspace is locked, holds another workspace, has changes, or changed since you were asked | Read the message. A locked workspace is never force-deleted: unlock it with `git worktree unlock` first |
| `worker-start` ends with "the worker did not come up within N ms; it may still be starting in the background (<dispatch> in <folder>)", though the agent is running | The window did not stamp a session for the dispatch in time, usually a slow start on a busy PC. A tab you open yourself is never taken for the worker. A session that starts later is still tied to the dispatch for 10 minutes and shows in `worker-show`, `worker-list` and `worker-release` | Use the commands in the answer (`--json` lists them), or `worker-show` and `worker-stop` once the agent has come up. See [Command line](command-line.md#worker-commands) |
| A command says "Kolux is not running; start it with `kolux open` first" | The command line cannot find the app | Run `kolux status` to see why (`not-running` or `stale`), then `kolux open`. See [Command line](command-line.md) |

## Get a safe report

Settings, General, Diagnostics has three buttons:

| Button | What it does |
|---|---|
| Copy diagnostics | Puts the report on the clipboard. The message says keys, passwords and tokens are masked |
| Write a review copy and open it | Saves the same report as `diagnostics-review.txt` in Kolux's data folder and opens it, so you can read it before sharing |
| Throw the review copy away | Deletes that file |

The report begins "Kolux <version> diagnostics, <time> on <os> <arch>". Anything that looks like a key, token, password, cookie, secret or sign-in is replaced with `[masked]`, and so are secrets inside web addresses and command lines. Running the scrub twice changes nothing more.

Nothing is sent anywhere. You paste the report where you choose. Failures read "could not write the review copy: ..." or "could not remove the review copy: ...".

For one terminal, a pane's menu has "Copy terminal diagnostics". It is masked the same way.

## The log

Kolux keeps a log at `logs\kolux.log` in its data folder, `%APPDATA%\com.txaisxiong.kolux-rs`. It records:

- when the app starts and exits;
- when terminal sessions start and end;
- anything a background task refused to do;
- panics (crashes) and fatal start-up failures.

A crash in a background thread ends only that thread. A crash in the main thread is fatal and is logged first. When the log passes 512 KB it moves aside as `kolux.<number>.log`; the oldest copies are deleted once the total passes 2 MB. The log never leaves your computer, and it is scrubbed when included in a report.

The browser engine keeps its own data in `%LOCALAPPDATA%\com.txaisxiong.kolux-rs\EBWebView`.

## After a quit or a crash

Kolux saves your tabs and layout as you work and brings them back at the next start.

- **Tabs and layout** return, with the active tab and focus. A tab whose folder is gone is dropped on its own; the rest stay.
- **Terminal output** returns. The last text of each pane is replayed with a grey note: "restored after a restart, the shell below is new". The program is new; it does not carry on from where it was.
- **Agent sessions** resume. An agent tab restarts on the same start line with the agent's own resume form, using the session it last reported (Claude Code, Codex and 15 more agents have one built in; Kiro and Aider also resume without a reported session). This needs the agent status hooks on. A pane marked "restored without resume" had no session to go back to and started at its prompt. See [Projects and worktrees](projects-and-worktrees.md#agent-sessions-after-a-restart).
- **Programs do not survive.** Closing a pane, quitting or a crash ends every program Kolux started, so none is left running in the background. A running build or server is stopped.
- A tab you close on purpose stays closed, and its saved output is forgotten.
- A slow start never drops your tabs: if the saved settings were slow to read, Kolux waits.
- Settings cannot be wiped by a failed read. If `settings.json` cannot be read, Kolux reports an error and refuses to save over it, and keeps `settings.json.bak` from the last good read.

Kolux also reopens on the screen you left (Agents, Board or Terminals).

## Hooks messages and leftovers

Two known problems with agent status hooks. Neither loses your own settings. Background is in [Safety](safety.md#agent-status-hooks).

| What you see | Cause | What to do |
|---|---|---|
| At every start, a message that Claude Code's `settings.json` "already holds Kolux's hook entries but has no .bak-kolux copy" | Known issue. Kolux created that file itself, so there is no earlier version to back up, and at every start Kolux reports the missing copy. The hooks already installed keep working, but updates to them do not land | Switch "Agent status hooks" Off, then On again (Settings, Agents; or `kolux agent hooks off` then `kolux agent hooks on`). The message goes away. Not yet fixed in the app |
| After switching hooks off, `~\.gemini\settings.json` or Antigravity's `~\.gemini\config\hooks.json` still exists and holds only `{}` | Known issue. Kolux created that file itself, and switching off takes out Kolux's entries but does not delete the file it made | The `{}` holds no settings. Delete the file yourself if you want it gone, once nothing else of yours is in it. Not yet fixed in the app |

## Quiet terminals

If a working terminal goes silent for 10 minutes, Kolux alerts you. Change the time in Settings, Notifications ("Quiet alert minutes"); 0 turns it off.

## If the command line fails

| Message | Cause and fix |
|---|---|
| "the token does not match this app; is cli.json stale?" | The key file belongs to an app that is no longer running. Start Kolux again, or run `kolux open` |
| "Kolux is running but did not answer within 300 s; it may still be working" | The app is busy. Wait, then try again |
| "this Kolux is older than the command line; update Kolux before sending orchestration changes" | Update the app |
| "the Kolux window is gone" | Close and reopen Kolux |
| "<terminal> is not running an agent Kolux recognises, or the agent has not finished starting" | Wait a few seconds, or check the pane is running a supported agent |

If `kolux` runs a different app than you expect, you may have the older Kolux on your PATH. Inside a Kolux pane the Kolux command comes first. Check with `where.exe kolux`. See [Command line](command-line.md).

## Still stuck

Use "Send feedback" in Settings, General, Privacy. It opens a new issue page on GitHub in your browser, with a version and platform footer. Paste your diagnostics there; the app submits nothing by itself.

<!-- verified against: src-tauri/src/diag.rs, src/terminal/errors.ts, src/terminal/TerminalPane.tsx, src/terminal/history.ts, src/terminal/layout.ts, src-tauri/src/cli.rs, src-tauri/src/projects.rs, src-tauri/src/procs.rs, src/settings/GeneralPage.tsx, src/settings/privacy.ts, STATE.md, src-tauri/src/agent_hooks/mod.rs, src-tauri/src/agent_hooks/vendors.rs, src-tauri/src/pty.rs, src-tauri/src/skills.rs, src-tauri/src/onboarding.rs at 73f5e38; worker and resume rows (src-tauri/src/cli.rs, src-tauri/src/orchestration.rs, src-tauri/src/agents.rs) at 5e6726c2 -->
