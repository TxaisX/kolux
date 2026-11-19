# Security model

Kolux protects its own files, its own commands, and its own update path. It does not contain the agents it runs. This page states the boundaries plainly, including the parts that are weaker than they look.

The short version:

- **Trusted:** the app's own code, the Rust core, the React window, and the local listeners.
- **Untrusted:** any content an agent reads or prints.
- **Third-party:** the agent CLIs and their providers. They run with the user's permissions.
- **The user is the authority.** Kolux refuses some file paths, but it does not sandbox an agent, and it leaves every approval to the agent's own prompt.

## Local doors and bearer tokens

Two local doors accept commands:

| Door | Token | Where the token lives |
|---|---|---|
| Agent hook listener | `x-kolux-token` header, one per pane | `agent-hooks-endpoint-<terminal>.txt` in the profile |
| Terminal service | `hello` operation token | `terminals.json` in the profile |

Both bind `127.0.0.1` on random ports. Neither binds a public interface. The hook listener refuses any request with an `Origin`, `Referer`, or `Sec-Fetch-*` header, checks the Host, and returns 404 with an empty body for a missing or wrong token (`src-tauri/src/hooks.rs`). The terminal service requires a valid `hello` before any other operation (`src-tauri/src/pty_service.rs:433-442`). The `kolux` command line and its loopback door were removed in the 2026-11 slim-down; the `cli.json` file left in the profile names only the running copy's pid.

The limit is the token model itself. These are bearer tokens stored in user-readable files. Any process running as the same Windows user can read `terminals.json` or a pane's hook endpoint file and drive the terminal service or report a status for that pane. There is no peer-process identity check. That is a same-user boundary, not a defense against local malware. It is also why the app does not pretend the local doors are a security sandbox.

Per-pane scoping (T-793, DT-C240). A hook event is accepted only with the token minted for the pane that sent it: HMAC-SHA256 of the run secret over the pane key and terminal, written to that pane's own `agent-hooks-endpoint-<terminal>.txt`. A token minted for pane A is refused for pane B, and a request with no token, the old shared token, or the placeholder in `agent-hooks-endpoint.txt` gets the same empty 404. Panes that outlive a restart get their endpoint file rewritten when they are adopted. The check still sits inside the same-user boundary above: every pane can read every pane's token file, and a process that sends no pane identity at all is outside what it can tell apart.

## The file fence

The window reads and writes files only in two places:

1. inside a registered project or one of its worktrees;
2. through an exact grant for a single file the user picked.

`src-tauri/src/fence.rs` refuses, before any disk call:

- UNC paths and `\\?\UNC\` paths, so a host is never contacted;
- volume-GUID and `\\?\GLOBALROOT\` paths;
- paths without a drive;
- network shares and drive roots as project roots;
- any resolved path outside the project after canonicalization, so a junction or symlink cannot lead out.

The fence canonicalizes the real path, or the parent for a file that does not exist yet (`src-tauri/src/fence.rs:68-118`). Single-file grants are for files only, never folders or drive roots. At most 100 are kept, they persist in `state.db`, and each is re-checked when it is used (`src-tauri/src/fence.rs:139-170`). A grant must be marked exact to apply, so listing and diff operations still need a project root.

The fence is the authority for file reads, opening a file or folder in another app, clipboard image writes, and the source-control paths that go through it. It is not an OS sandbox: a program an agent starts can still use its own file APIs.

## Agent hooks

An agent's hook reports what the agent is doing, and Kolux answers every hook with `{}`: no opinion, so the agent's own permission prompt decides (`src-tauri/src/hooks.rs`, `reply_body`). The protected-command rules that made Claude Code ask before a risky command were retired in the 2026-11 slim-down, so Kolux never approves, refuses or pauses a command.

## Secrets

Every key and managed sign-in is sealed with Windows DPAPI at current-user scope (`src-tauri/src/secrets.rs:1-4`, `:482-518`). The sealed form is `kolux-sealed:v1:<base64>`. A value that cannot be sealed is never stored in the clear; the write is refused and the user is told the system secret store is not answering (`src-tauri/src/secrets.rs:206-224`).

The frontend never receives the three secret settings. Rust strips them before the settings payload reaches the page, ignores them on the way back, and exposes only a boolean "is it set" (`src-tauri/src/secrets.rs:150-170`, `:537-541`). Managed sign-ins live in `vault/` as sealed files, written by temporary file and rename. An unreadable file is moved aside, never deleted (`src-tauri/src/secrets.rs:339-370`).

The profile folder is restricted to the current user at launch (`src-tauri/src/secrets.rs:451-471`). The Settings, Claude tab never reads Claude's `.credentials.json`, its backups, the project transcripts, `.jsonl` files, any `.env*`, or the target of `apiKeyHelper` (DECISIONS.md DT-C88). Other features read agent transcripts on purpose: past sessions and native chat. Hook installs must not touch an account's credentials file.

On Windows the protection is real DPAPI. On macOS and Linux the current build only XOR-scrambles values and logs that fact. Those platforms are not supported yet.

## Web content

The main window runs from the Tauri asset origin with a strict CSP:

- `default-src 'self'`
- `script-src 'self'`
- `connect-src 'self' ipc: http://ipc.localhost`
- `frame-ancestors 'none'`
- `object-src 'none'`
- `base-uri 'self'`

See `src-tauri/tauri.conf.json:28`. Tauri's CSP modification is disabled only for `style-src`, because the app injects theme variables.

The browser tabs, the preview server and the artifact viewer were removed in the 2026-11 slim-down, so the main window is the only web view.

Markdown in the chat view is sanitized with DOMPurify (`src/chat/renderMarkdown.ts`).

## Egress

The app's own outbound connections are:

- GitHub Releases, for the update check, the download, and the release notes;
- the GitHub API, for pull requests and checks, when the user connects GitHub;
- the user's Git remotes, through `git`;
- the site a project's page names, for that project's icon;
- OpenRouter, only as the address Claude Code is pointed at when the user adds an OpenRouter key.

The whole list is in Settings, General, Privacy (`src/settings/outbound.ts`).

There is no analytics, telemetry, or crash upload endpoint. WebView2 performs its own startup checks to Microsoft, which the app cannot disable.

## Update trust

The app checks `https://github.com/TxaisX/kolux/releases/latest/download/latest.json` (`src-tauri/src/update.rs:24`). The public key is compiled into the build from `KOLUX_RELEASE_PUBKEY`; a release build without a key refuses to update (`src-tauri/src/update.rs:25-31`, `:53-76`).

The update path verifies:

1. the minisign signature over the manifest, with the key id and trusted comment naming the version;
2. the Windows Authenticode publisher of the installer against the running copy or a pinned publisher, with no bypass;
3. a refused installer is remembered by feed signature and SHA-256 so it is not retried.

See `src-tauri/src/update.rs:243-380` and `src-tauri/src/resources/update_guard.rs:1-23`, `:125-200`.

The weak point is key custody. Trust is one build-time public key. There is no published rotation or revocation list in the current code. The release signing key lives at `~/.kolux/release-signing/kolux.key` and is used by `scripts/release.mjs`; the release workflow can also hold it as a GitHub secret for the signing step only. A compromised signing key can produce an installer and manifest that every installed copy accepts. The installer itself is not Authenticode-signed today, so SmartScreen warns on first install.

## Data at rest

The profile folder is user-scoped and ACL-restricted. Logs are rotated and scrubbed for sharing. The Diagnostics card writes a review copy the user can read before sending anything. Feedback and crash reports open a pre-filled GitHub issue in the browser; the app does not submit them (`src/feedback/FeedbackDialog.tsx`).

There is no telemetry, analytics, or crash upload. WebView2 performs its own startup checks to Microsoft, which the app cannot disable; the privacy page names them.

## Out of scope

The following are not protected by Kolux:

- an agent doing something destructive with the permissions the user gave it;
- a risky command an agent runs: Kolux leaves every approval to the agent's own prompt;
- a compromised Windows account or local malware reading the token files;
- a vulnerability in WebView2, an agent CLI, or a provider;
- a repository's own setup scripts, hooks, or MCP servers that the user chooses to run.

The app asks before some of these actions where it can. It does not claim to prevent them all.

## Reporting

Do not open a public issue for a security problem. Follow the [security policy](../../SECURITY.md) and use GitHub's private vulnerability reporting.
