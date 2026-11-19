# Troubleshooting

Find out what went wrong, get a safe report to share, and get back to work. Start with the table of symptoms. Then use "Copy diagnostics" if you need help.

## Quick fixes

| What you see | What it means | What to do |
|---|---|---|
| A pane shows "This terminal stopped" with **Close pane** and **Restart** | The program in the pane stopped | Restart opens it again in that pane. Close pane gives its space to the others |
| "Kolux can't find this program" | Windows cannot find the program | Install it, or fix your PATH, then open the pane again |
| "Windows refused to start the program (access denied)" | An antivirus or policy blocked it | Allow the program, then open the pane again |
| "Git Bash could not start another process: Windows has run out of process slots for it" | Too many programs running | Close a few terminals or other programs, or restart Kolux, then open the pane again |
| "The program in this pane has ended, so nothing can be sent to it" | You sent text to a pane whose program had stopped | Restart the pane |
| "A program it needed isn't installed (code 127)" | The start line names a missing command | Check the agent's Command in Settings, Agents |
| Code 126 or 128: "It couldn't run its program" | The shell found the program but could not run it | Check the file's permissions and path, then Restart |
| Code above 128: "The program was stopped" | Something ended the program, such as Ctrl+C or a crash | Restart |
| An unexplained error ends with a "report it" link | Kolux has no plain words for it | Copy diagnostics (below) and report it |
| A new terminal opens with a dim line "<shell> did not start; opened <shell>" | The default terminal you chose in Settings would not start, so Kolux used the next automatic shell | Check that the shell is still installed, or pick another under Settings, Terminal & sessions, Default terminal. See [Settings](settings.md#default-terminal) |
| A pane stays blank after it opens | A known case: a shell sometimes stalls as it starts | Close the pane and open a new one |
| A Claude Code or Codex pane's status word lags behind | The switch "Show what each agent is doing" is off, so Kolux reads the state from the terminal only | Turn on "Show what each agent is doing" in Settings, Agents. See [Settings](settings.md) |
| An agent halted | A usage limit, a lapsed sign-in or a provider error | Its pane reads Blocked, with the reason on its line. See [Status words](terminals.md#status-words) |
| "Sign in again" on a pane | A sign-in lapsed | Use the button, or Settings, Accounts & keys |
| Removing an old workspace is refused | The workspace is locked, holds another workspace, has changes, or changed since you were asked | Read the message. A locked workspace is never force-deleted: unlock it with `git worktree unlock` first |

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

Kolux keeps a log at `logs\kolux.log` in its data folder, `%APPDATA%\com.txaisxiong.kolux`. It records:

- when the app starts and exits;
- when terminal sessions start and end;
- anything a background task refused to do;
- panics (crashes) and fatal start-up failures.

A crash in a background thread ends only that thread. A crash in the main thread is fatal and is logged first. When the log passes 512 KB it moves aside as `kolux.<number>.log`; the oldest copies are deleted once the total passes 2 MB. The log never leaves your computer, and it is scrubbed when included in a report.

The browser engine keeps its own data in `%LOCALAPPDATA%\com.txaisxiong.kolux\EBWebView`.

## After a quit or a crash

Kolux keeps your folders between runs but, by default, not your tabs: each start asks what to open (see [Getting started](getting-started.md)).

- **Programs do not survive.** Closing a pane, quitting or a crash ends every program Kolux started, so none is left running in the background. A running build or server is stopped.
- **Tabs and layout** come back only with `"keepWorkspaces": true` in `settings.json`, and they reopen as plain shells. A tab whose folder is gone is dropped on its own; the rest stay. The program in each is new; it does not carry on from where it was.
- **Agent sessions** resume when a sleeping agent tab wakes (Agent sleep, in Settings, General, Experimental): the agent restarts on the same start line with its own resume form, using the session it last reported. Claude Code and Codex report theirs through their status hooks, so this needs "Show what each agent is doing" on in Settings, Agents. A pane marked "restored without resume" had no session to go back to and starts fresh. See [Agent sessions after a restart](projects-and-worktrees.md#agent-sessions-after-a-restart).
- A tab you close on purpose stays closed, and its saved output is forgotten.
- A slow start never drops your tabs: if the saved settings were slow to read, Kolux waits.
- Settings cannot be wiped by a failed read. If `settings.json` cannot be read, Kolux reports an error and refuses to save over it, and keeps `settings.json.bak` from the last good read.

## Hooks messages and leftovers

One known problem with agent status hooks (the small scripts behind the switch "Show what each agent is doing"). It does not lose your own settings. Background is in [Safety](safety.md#agent-status-hooks).

| What you see | Cause | What to do |
|---|---|---|
| At every start, a message that Claude Code's `settings.json` "already holds Kolux's hook entries but has no .bak-kolux copy" | Known issue. Kolux created that file itself, so there is no earlier version to back up, and at every start Kolux reports the missing copy. The hooks already installed keep working, but updates to them do not land | Switch "Agent status hooks" Off, then On again (Settings, Agents; or `kolux agent hooks off` then `kolux agent hooks on`). The message goes away. Not yet fixed in the app |

## Quiet terminals

If a working terminal goes silent for 10 minutes, Kolux alerts you. Change the time in Settings, Notifications ("Quiet alert minutes"); 0 turns it off.

## Still stuck

Use "Send feedback" in Settings, General, Privacy. It opens a new issue page on GitHub in your browser, with a version and platform footer. Paste your diagnostics there; the app submits nothing by itself.

<!-- verified against: src-tauri/src/diag.rs, src/terminal/errors.ts, src/terminal/TerminalPane.tsx, src/terminal/history.ts, src/terminal/layout.ts, src-tauri/src/projects.rs, src-tauri/src/procs.rs, src/settings/GeneralPage.tsx, src/settings/privacy.ts, src-tauri/src/agent_hooks/mod.rs, src-tauri/src/pty.rs, src-tauri/src/skills.rs, src-tauri/src/onboarding.rs, src-tauri/src/agents.rs, src/settings/AgentsPage.tsx at 01b39757 -->
