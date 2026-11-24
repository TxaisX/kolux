# Overnight ticket board: audit fixes, lag fixes, auto-land (2026-11-24)

One overnight run of the ticket board, from the goal "build the auto-merge after each task, audit the whole application for errors and better optimize the terminal launching when we start new sessions", plus the lag goal "make Kolux seamless and non-laggy with many sessions in many folders".

A Fable planner wrote the tickets and their tests. DeepSeek V4.1 Flash workers (max effort, through OpenCode) wrote every fix. No Claude model wrote solution code.

## Result

| | |
|---|---|
| Final check (ROOT) | passed, plus a clean-copy rebuild |
| Tickets done | 103 of 103 |
| Re-planned | 2 |
| Given up as impossible | 0 |
| Tests changed because they were wrong | 0 during the run (one changed at review, see below) |
| Time | about 9 hours 18 minutes |
| Worker cost | $7.94 of DeepSeek on OpenRouter (28.2M input, 1.4M output, 2.7M reasoning tokens, 102 runs) |
| Claude workers | none |

## What changed for the user

**Starting and restoring agents**
- A restored Claude pane resumes its conversation only when that conversation was really saved, and a resume that fails is forgotten instead of failing again on every start.
- A pane now says why its agent stopped (ended by itself, closed by Kolux, crashed) and offers Start fresh.
- Hook events from an agent started inside another agent's pane no longer overwrite the outer pane's status.
- New panes start faster: Kolux remembers where the shell programs are instead of searching PATH each time.

**Sending finished work to main (auto-land)**
- A finished workspace can send its work to main by itself, or from a Send to main button on the pane, which also shows where the work stands.
- Agents get a land script they can run; a workspace that falls behind main is retried after the agent's next finished turn.
- After a land, the workspace's build output is cleared to free disk space.
- This replaces the old "merge when Kolux quits" switch. It is on by default: that default is your call.

**Lag with many sessions** (12 findings from the lag audit, 11 fixed, 1 rejected with reasons)
- A change in one pane redraws only that terminal, not all of them.
- Terminal output goes only to the pane that owns it, through one shared listener per event kind.
- Each terminal has its own input queue, so one stuck program cannot freeze typing in other panes.
- Spinner frames in agent titles no longer churn the window; only the switch between idle and working gets through.
- Settings are written to disk without holding everything else up.
- Git is polled every 5 seconds for the active project and once a minute for the others.
- Folder scans and "is this pane busy" checks run off the window's main thread, and read the process list once for many panes.
- After a folder switch, the panes you can see get the graphics card within a second.
- Kolux now logs any moment the window freezes for half a second or more, and any backend command slower than 100 ms, so future lag can be found from the log.

**Chat**
- The chat asks the agent to echo each message back, and your message stays above the reply to it. A message you send while the agent is still replying waits at the bottom until that reply is done.

**Audit fixes**: 46 bugs found by the audit fixed, across settings, workspaces, accounts, sessions, git and the terminal.

## Review before landing

Two independent Claude reviews (one Rust, one frontend) read the whole change. Both said merge after fixes. DeepSeek fixed the findings; each fix round was reviewed again.

Fixed before landing:
- Closing a restored agent in its first 15 seconds made Kolux forget its conversation.
- A message typed while the agent was replying was drawn in the middle of the reply. The first fix for this brought back the "reply above my message" bug after the first turn; the second round fixed it and a reviewer confirmed it with a test run.
- The "working" status missed agents that only show work in their title.
- Live chat re-checked every past message on each streamed word.
- Hook events from a helper agent started in another folder could take over the pane's status. The filter now turns off only after the pane's own agent has exited to the shell, and turns back on when that agent resumes. This took three review rounds.
- The workspaces folder setting accepted a relative path that pointed nowhere useful; it now refuses one.
- Codex sessions that drifted out of sync are now cleared properly.
- Clearing a workspace's build output is safer: it never follows links, and a half-finished clear is cleaned up next time.
- The same session could appear under two paths; it is now counted once.

One locked test was changed, by the coordinator's decision: the spinner test said nothing at all may reach the window while the spinner turns. It now allows exactly one update, the switch from idle to working, so that switch shows. Frame-by-frame updates are still blocked.

## Checks

- Type check: passed.
- Frontend tests (chat, terminal, status): 196 files, 1,465 tests, all passed.
- Rust tests: 2,352 passed in the main suite. 7 sandbox-only tests fail on this PC because they need a fake home folder; the board did not touch them.
- After all review fixes: Rust main suite 2,364 passed; every other Rust suite passed except the same 7 sandbox-only tests. Type check and 1,465 frontend tests passed on the combined branch.

## Left for later

- After you press Stop, a message that was waiting to send can be drawn below your next exchange.
- The error banner shows for the fallback shell in an agent pane.
- A rare blank frame when panes swap graphics after a folder switch.
- Every pane asks for land states on every land event.
- A half-cleared build folder left over from an earlier clear is removed with a plain delete, which can still strand it if a file is in use.
- If the shell shows for a split second while a resumed agent starts, the helper-agent filter can stay off for that session (very unlikely).

## Harness notes

- The verifier now compares a ticket's work against where it branched off, so tickets that started before others landed are not blamed for others' files.
- The worker launcher now writes its output as UTF-8; a spinner symbol used to crash it mid-run.
- A test copy of Kolux started by one ticket's check stayed open overnight; it has since closed.
