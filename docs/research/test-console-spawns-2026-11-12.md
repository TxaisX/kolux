# Rust tests no longer start a console host per child (2026-11-12)

Bug: the lib test run started `conhost.exe` about 2,600 times a minute, and Defender scanned each
start (report: `_shared/bugs/c1-coord/20261112-1622-rust-tests-spawn-thousands-of-consoles.md`).

## Cause

Every `git`, `cmd` and similar child the tests start already passed `CREATE_NO_WINDOW`. That flag
does not mean "no console": it means "a new console with no window", and Windows backs every new
console with its own `conhost.exe`. A test binary run from a terminal (or any pane) already has a
console. A child started with no flag shares it and costs nothing; a child started with
`CREATE_NO_WINDOW` pays for a new host.

Controlled check (60 `git --version` starts from a PowerShell that has a console, new `conhost.exe`
processes seen in each batch; the other agents on the PC add roughly 10 per minute as noise):

| Start mode | New conhost.exe |
|---|---|
| `CREATE_NO_WINDOW` (what Kolux did) | 60 |
| no flag (shares the console) | 10 |
| `DETACHED_PROCESS` | 9 |

## Change

`src-tauri/src/winproc.rs` gets `no_window()`: it returns `CREATE_NO_WINDOW` when the program has no
console of its own (the release app: `windows_subsystem = "windows"`), and 0 when it has one (a test
binary, a debug build started from a terminal, a pane's pseudo console). It is decided once with
`GetConsoleProcessList`. `winproc::quiet` and `winproc::command` use it, and every spawn site that
wrote the literal `0x0800_0000` (or a local `CREATE_NO_WINDOW` const) now calls it instead, so there
is one helper and one rule.

Production: the release app has no console, so it keeps `CREATE_NO_WINDOW` and behaves as before. A
console program that already has a console (`kolux` CLI, a dev build) now lets its children share
it: no window opens either way.

## Spawn sites

Changed (the literal flag became `crate::winproc::no_window()`): `agent_install.rs`,
`automations.rs`, `automations/external.rs`, `auto_pr.rs` (3), `codex_usage.rs`, `editor_search.rs`,
`files.rs` (2), `fonts.rs`, `git.rs` (2), `include.rs`, `links.rs`, `newproject.rs`,
`notebook_run.rs`, `notifications.rs`, `ports.rs`, `procs.rs`, `resources/recovery.rs`,
`resources/update_guard.rs`, `scm.rs`, `secrets.rs`, `session_scan.rs`, `setup.rs`,
`skills/installer.rs` (2), `terminal.rs` (2), `tools.rs`, `trust.rs`, and the test helpers in
`git_tests.rs` (7) and `scm_tests.rs` (2).

Left alone:

- PTY panes (`pty.rs`, `pty_service.rs`, `terminal.rs` shell spawns via `portable_pty`): they own a
  pseudo console by design. The 18 conhosts left in a lib run are most likely these (about 20 PTY
  tests exist in `pty.rs`, `terminal.rs`, `claude_key.rs` and others); not individually traced.
- `cli/mod.rs:377` and `pty_service.rs:769,772` (`DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`
  style flags for a detached background service): detached children take no console host.
- `links.rs:458` keeps `CREATE_NEW_CONSOLE` for a NeoVim link, which needs a real console.
- `cli/mod.rs` `kolux claude` and `cli_accounts.rs`: spawns that deliberately share the user's
  terminal (listed in `winproc.rs`'s `ALLOWED`).

## Measurement

`conwatch.ps1` (kept outside the repo): starts the lib test binary directly, takes a process
snapshot every 5 ms (`CreateToolhelp32Snapshot`), counts every `conhost.exe` PID not present before
the run, and reports how many have a parent chain that leads to the test binary. The count is a
lower bound (a host that starts and exits between two snapshots is missed). Both runs are the same
binary built from the same tree except for this change.

Command: `powershell -File conwatch.ps1 -Exe src-tauri\target\debug\deps\kolux_lib-<hash>.exe -Cwd src-tauri`

| Run (lib tests, 2,940 and 2,941 pass, 0 fail, 9 ignored) | New conhost.exe, whole run | Attributed to the test binary | Run time |
|---|---|---|---|
| Before (510dd09b) | 1,696 | 1,671 | 318 s |
| After | 58 | 18 | 409 s |

The 40 unattributed hosts in the "after" run are other agents' builds and terminals on the same PC
(an idle 20 s sample before the first run saw 24 new hosts); the 18 attributed ones are most likely the PTY tests.
The "after" run was slower because a second Rust build was running in another worktree.

Sampling is every 5 ms, so the "before" count of 1,671 against 1,965 `git.exe` starts in that run
says about one host per `git` start, matching the 60-for-60 result above.

## Still open

- `git.exe` itself starts thousands of times per run (git is the thing under test). That is Defender
  scan cost no console flag can remove; cutting it means fewer git calls per test, a larger change
  than this fix.
