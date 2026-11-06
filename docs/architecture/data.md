# Data and storage

Kolux keeps everything on the user's machine. There is no account, no sync service, and no server-side store. This page describes what is written, where it lives, and how it survives a crash.

## The profile folder

The root is `%APPDATA%\com.txaisxiong.kolux-rs` (`src-tauri/src/resources/recovery.rs:849-851`, `src-tauri/tauri.conf.json:5`). A development or test run can point somewhere else with `KOLUX_APP_DIR` or `KOLUX_USER_DATA_PATH` (`src-tauri/src/cli/mod.rs:48-53`).

| Path | Format | Purpose |
|---|---|---|
| `settings.json` | Pretty JSON | User preferences. Seven fields hold sealed secrets. |
| `settings.json.bak` | JSON | The previous good settings copy. |
| `state.db` | SQLite, WAL | One `kv(key, value)` table for everything structured. |
| `state.db.bak` | SQLite | The backup used when the database is corrupt. |
| `vault/` | Sealed files | One DPAPI-sealed file per managed sign-in. |
| `logs/kolux.log` | Text | Rotated app log. Pane output is not recorded. |
| `logs/diagnostics-review.txt` | Text | The review copy written by the Diagnostics card. |
| `terminals.json` | JSON | Terminal service port, token, pid, generation, protocol. |
| `cli.json` | JSON | CLI loopback port, token, pid. |
| `agent-hooks-endpoint.txt` | One line, `port token` | What the agent hook scripts read. |
| `terminals-seen.json` | JSON | How much output the window drew, for reattach. |
| `agent-hooks-spool.txt` | Text | Events held while Kolux was closed. |
| `artifacts/` | JSON plus folders | The artifact library and its stored files. |
| `browser-profiles/` | WebView2 data | Browser tabs, logins, and history. |
| `browser-history.json` | JSON | Address bar history. |
| `claude-accounts/`, `codex-accounts/` | Agent homes | Managed per-account sign-ins. |
| `crashes.json` | JSON | Crash records for the recovery screen. |
| `memory-last.json` | JSON | The last memory figure. |
| `safe-graphics.json` | JSON | The safe-graphics latch. |

Hook scripts are outside the profile, in `~/.kolux-rs/agent-hooks` (`src-tauri/src/hooks.rs:30-36`). The release checkout and the signing key also live under `~/.kolux-rs` (`scripts/release.mjs:35-37`).

## The state store

`state.db` is one SQLite file in WAL mode with one table:

```sql
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

The store holds projects, worktrees, file grants, editor drafts, orchestration tasks and mail, account lists, rate-limit windows, update state, and secret bookkeeping (`src-tauri/src/state.rs:36-41`). Settings are separate: they stay in `settings.json`, not the database.

Writes are transactional. Multi-key changes use one transaction, and a key that depends on an old value is copied aside and compared before the swap (`src-tauri/src/state.rs:109-138`). A failed read sets a latch that refuses every save until a read succeeds, so a transient read error cannot overwrite good data with an empty state (`src-tauri/src/state.rs:19-27`). The SQLite busy timeout is 5 seconds.

If the database is corrupt, the app sets it aside, restores `state.db.bak`, and only falls back to a frozen scratch store if the backup also fails (`src-tauri/src/resources/recovery.rs:160-190`). The damaged file is preserved, not deleted.

## Settings

`settings.json` is written atomically: a temporary file is written, synced, and renamed over the old copy. `.bak` is written the same way (`src-tauri/src/state.rs:225-260`). A corrupt file is kept as `settings.json.corrupt-<millis>` and the backup is loaded.

The window saves partial patches, not the whole file. Rust applies each patch under one lock, strips secret fields, and broadcasts only the changed keys as `settings-saved` (`src-tauri/src/lib.rs:160-170`, `src-tauri/src/settings_sync.rs`). Every window applies the patch to its local copy, so two windows do not overwrite each other with stale full copies.

## Secrets

Every key and managed sign-in is sealed with Windows DPAPI at current-user scope before it touches a file (`src-tauri/src/secrets.rs:1-4`, `:482-518`). The sealed form is `kolux-sealed:v1:<base64>`. On non-Windows builds the fallback is only an XOR scramble, and the log says so.

Seven settings fields are secret (`src-tauri/src/secrets.rs:28`):

- `claudeOauthToken`
- `xaiApiKey`
- `httpProxy`
- `browserSearchSessionUrl`
- `minimaxCookie`
- `minimaxApiKey`
- `moonshotApiKey`

The frontend never receives those values. Rust removes them from the settings payload and ignores them on the way back; the page can learn only whether a secret is set (`src-tauri/src/secrets.rs:150-170`, `:537-541`). If the secret store is unavailable, a write is refused rather than storing the value in the clear (`src-tauri/src/secrets.rs:206-224`).

Managed sign-ins live in `vault/`, one sealed file per account, written by temporary file and rename. An unreadable vault file is moved aside as `<name>.unreadable-<seconds>`, never deleted (`src-tauri/src/secrets.rs:339-370`). The profile folder is restricted to the current user with `icacls /inheritance:r` at launch (`src-tauri/src/secrets.rs:451-471`).

The app deliberately never reads Claude's `.credentials.json`, its backups, project transcripts, `.jsonl` files, any `.env*`, or whatever an `apiKeyHelper` points at. The allow-list is recorded in `DECISIONS.md` DT-C88 and enforced by the settings reader.

## Endpoint files

The local doors publish their addresses in small files so a pane or a CLI process can find them after a restart:

- `terminals.json` is written by the terminal service with `{port, token, pid, generation, protocol}` and is read by the window (`src-tauri/src/pty_service.rs:38`, `:510-520`).
- `cli.json` is written by the desktop app with `{port, token, pid}` and is read by `kolux` (`src-tauri/src/cli/mod.rs:48`, `:3624`).
- `agent-hooks-endpoint.txt` is one line, `port token`, read by every hook script (`src-tauri/src/hooks.rs:44`, `:864-865`).

These files are the reason a pane or a shell can outlive a restart. They are also the reason the local doors are only a same-user boundary: any process running as the same user can read them. See [Security](security.md).

## Managed agent homes

Kolux can manage more than one Claude or Codex sign-in. Each account gets its own home under `claude-accounts/<id>/` or `codex-accounts/<id>/` (`src-tauri/src/claude_accounts.rs:37`, `src-tauri/src/codex_accounts.rs:32`). A pane launched on that account gets the matching home in its environment. Kolux does not overwrite the user's own `~/.claude` or `~/.codex` homes for managed accounts.

Hook installs do write into the agent's own settings, because that is how an agent reports status. Each install keeps a `.bak-kolux` copy beside the file and removes only the entries it wrote. The hook scripts themselves live in `~/.kolux-rs/agent-hooks`.

## Artifacts and browser data

Artifacts are stored in `artifacts/` with a `library.json` index and one folder per entry (`src-tauri/src/artifacts.rs:307`). The artifact viewer serves them over the custom `kolux-artifact` scheme, not from the profile by direct file path.

Browser tabs use WebView2 child webviews with their own profile folders under `browser-profiles/<id>/` (`src-tauri/src/browser_profiles.rs:169-177`). Passwords and cookies stay in the WebView2 profile, not in `settings.json`.

## Logs and diagnostics

`logs/kolux.log` records app start and exit, terminal start and exit, and failures. It does not record terminal output, command arguments, or keys (`src-tauri/src/diag.rs:4-23`). Past 512 KB the file rotates, and old rotated files are pruned.

The Diagnostics card can copy a scrubbed bundle or write `diagnostics-review.txt` for the user to read before sharing. The scrubber masks credential-shaped values in addresses, `name=value` pairs, flags, bearer tokens, and known key prefixes (`src-tauri/src/diag.rs:118-120`, `src-tauri/src/secrets.rs:284-298`).

## Recovery behavior

The app is built to preserve data first:

- a corrupt `state.db` is set aside and the backup is restored;
- a corrupt `settings.json` is kept and the `.bak` is loaded;
- an unreadable sealed value is moved aside and the user is asked to reconnect;
- a profile folder with broken permissions is repaired at launch;
- safe graphics is latched after a graphics crash;
- a frozen store is used only when the backup also fails.

The goal is that a bad file never becomes an empty file.

## What is not stored

- No telemetry, analytics, or crash upload.
- No terminal output in the app log. Automation runs keep the last ~16,000 characters of a run on purpose, so the run's result survives.
- No Claude credentials file contents. The app reads the account through Claude's own CLI and keeps only its own sealed copy.
- No `.env` files. The settings reader refuses them.
- No server-side account or sync record.
