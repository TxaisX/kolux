# Security model

Kolux RS protects its own files, its own commands, and its own update path. It does not contain the agents it runs. This page states the boundaries plainly, including the parts that are weaker than they look.

The short version:

- **Trusted:** the app's own code, the Rust core, the React window, and the local listeners.
- **Untrusted:** web pages in browser tabs, and any content an agent reads.
- **Third-party:** the agent CLIs and their providers. They run with the user's permissions.
- **The user is the authority.** Kolux asks before some risky actions and refuses some file paths, but it does not sandbox an agent.

## Local doors and bearer tokens

Four local doors accept commands:

| Door | Token | Where the token lives |
|---|---|---|
| Agent hook listener | `x-kolux-token` header | `agent-hooks-endpoint.txt` in the profile |
| CLI loopback | `token` field in the JSON request | `cli.json` in the profile |
| Preview server | 128-bit random path segment per folder | In memory only |
| Terminal service | `hello` operation token | `terminals.json` in the profile |

All four bind `127.0.0.1` on random ports. None binds a public interface. The hook listener refuses any request with an `Origin`, `Referer`, or `Sec-Fetch-*` header, checks the Host, and returns 404 with an empty body for a missing or wrong token (`src-tauri/src/hooks.rs:341-358`). The CLI listener drops HTTP request lines and answers a wrong token with an `unauthorized` envelope (`src-tauri/src/cli/mod.rs:3553-3580`). The terminal service requires a valid `hello` before any other operation (`src-tauri/src/pty_service.rs:433-442`).

The limit is the token model itself. These are bearer tokens stored in user-readable files. Any process running as the same Windows user can read `terminals.json` or `cli.json` and drive the terminal service or the CLI. There is no peer-process identity check. That is a same-user boundary, not a defense against local malware. It is also why the app does not pretend the local doors are a security sandbox.

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

The fence is the authority for the editor, file reads, search, clipboard image writes, and the source-control paths that go through it. It is not an OS sandbox: a program an agent starts can still use its own file APIs.

## Protected commands

Kolux can make Claude Code stop and ask before a risky shell command. The built-in rules are:

- Stripe changes;
- force-push to main;
- dropping database tables;
- infrastructure changes;
- production deploys;
- recursive deletes outside the workspace;
- throwing away uncommitted work.

There is also an un-switchable rule for commands over 256 KB (`src-tauri/src/protected.rs:44-66`).

The rules read the command several ways: plain, shell, bash, and blind when a quote never closes. They split chains and look inside `$( )`, backticks, `sh -c`, `cmd /c`, PowerShell `-Command` and encoded commands, `eval`, `iex`, and `wsl`, to four levels (`src-tauri/src/protected.rs:10-27`, `:604-668`). A trip in any reading produces an ask.

What this is not:

- **It covers Claude Code only.** Codex and other agents get no opinion (`src-tauri/src/protected.rs:3-5`).
- **It reads only Claude's Bash and PowerShell tools.**
- **It is a warning, not a control.** The project's own review found four ways a determined command can slip past.
- **It can be switched off.** The master switch and each rule are in Settings, Safety.

User rules add `startsWith`, `contains`, and `regex` checks, with a 500-character regex limit, a 4,096-character input limit, and a size cap. ReDoS-shaped patterns are refused (`src-tauri/src/protected_custom.rs:12-105`). Project scopes can turn built-ins off for one project and add project rules.

The full user-facing statement is in the [safety guide](../guide/safety.md). It says the same thing: this is advice, not a sandbox.

## Secrets

Every key and managed sign-in is sealed with Windows DPAPI at current-user scope (`src-tauri/src/secrets.rs:1-4`, `:482-518`). The sealed form is `kolux-sealed:v1:<base64>`. A value that cannot be sealed is never stored in the clear; the write is refused and the user is told the system secret store is not answering (`src-tauri/src/secrets.rs:206-224`).

The frontend never receives the seven secret settings. Rust strips them before the settings payload reaches the page, ignores them on the way back, and exposes only a boolean "is it set" (`src-tauri/src/secrets.rs:150-170`, `:537-541`). Managed sign-ins live in `vault/` as sealed files, written by temporary file and rename. An unreadable file is moved aside, never deleted (`src-tauri/src/secrets.rs:339-370`).

The profile folder is restricted to the current user at launch (`src-tauri/src/secrets.rs:451-471`). The Settings, Claude tab never reads Claude's `.credentials.json`, its backups, the project transcripts, `.jsonl` files, any `.env*`, or the target of `apiKeyHelper` (DECISIONS.md DT-C88). Other features read agent transcripts on purpose: the artifact library and native chat. Hook installs must not touch an account's credentials file.

On Windows the protection is real DPAPI. On macOS and Linux the current build only XOR-scrambles values and logs that fact. Those platforms are not supported yet.

## Web content

The main window runs from the Tauri asset origin with a strict CSP:

- `default-src 'self'`
- `script-src 'self'`
- `connect-src 'self' ipc: http://ipc.localhost`
- `frame-src http://kolux-artifact.localhost kolux-artifact:`
- `frame-ancestors 'none'`
- `object-src 'none'`
- `base-uri 'self'`

See `src-tauri/tauri.conf.json:28`. Tauri's CSP modification is disabled only for `style-src`, because the app injects theme variables.

Browser tabs are child webviews of the main window. They are not given the main window's capabilities, but Tauri still hands app commands to webviews whose origin it trusts. The guard is therefore origin-based, not capability-based: a tab may load only `http`, `https`, or blank, and never any `*.localhost` host or the dev origin, by address bar, redirect, or script (`src-tauri/src/browser.rs:1165-1188`, `:2542-2559`). The tower capability file states explicitly that every registered app command remains callable from every window (`src-tauri/capabilities/tower.json:4`).

The preview server binds loopback, uses one 128-bit random path token per folder, checks the Host header, refuses path escapes, and serves only folders inside an open project or worktree (`src-tauri/src/browser_preview.rs:48`, `:117-118`, `:276-300`). Files over 32 MiB are refused.

The artifact viewer uses the custom `kolux-artifact` scheme and is reachable only from the main webview (`src-tauri/src/lib.rs:466-471`). Each response carries a narrow CSP, and the viewer runs in an iframe.

Markdown is sanitized with DOMPurify. Notes forbid `style`, `form`, `input`, `button`, `textarea`, `select`, `dialog`, `map`, and `area` tags, and the `hidden`, `style`, and `popover` attributes. Agent text has raw HTML escaped (`src/editor/PreviewPane.tsx:33-78`).

## Egress

The app's own outbound connections are:

- GitHub Releases, for the update check, the download, and the release notes;
- the GitHub API, for issues, pull requests, and checks, when the user connects GitHub;
- the user's Git remotes, through `git`;
- the Kimi and MiniMax usage endpoints, when those provider keys are configured;
- allow-listed CDN hosts when an artifact page loads a script;
- pages the user opens in the browser pane.

There is no analytics, telemetry, or crash upload endpoint. WebView2 performs its own startup checks to Microsoft, which the app cannot disable.

## Update trust

The app checks `https://github.com/TxaisX/kolux-rs/releases/latest/download/latest.json` (`src-tauri/src/update.rs:24`). The public key is compiled into the build from `KOLUX_RS_RELEASE_PUBKEY`; a release build without a key refuses to update (`src-tauri/src/update.rs:25-31`, `:53-76`).

The update path verifies:

1. the minisign signature over the manifest, with the key id and trusted comment naming the version;
2. the Windows Authenticode publisher of the installer against the running copy or a pinned publisher, with no bypass;
3. a refused installer is remembered by feed signature and SHA-256 so it is not retried.

See `src-tauri/src/update.rs:243-380` and `src-tauri/src/resources/update_guard.rs:1-23`, `:125-200`.

The weak point is key custody. Trust is one build-time public key. There is no published rotation or revocation list in the current code. The release signing key lives at `~/.kolux-rs/release-signing/kolux-rs.key` and is used by `scripts/release.mjs`; the release workflow can also hold it as a GitHub secret for the signing step only. A compromised signing key can produce an installer and manifest that every installed copy accepts. The installer itself is not Authenticode-signed today, so SmartScreen warns on first install.

## Data at rest

The profile folder is user-scoped and ACL-restricted. Logs are rotated and scrubbed for sharing. The Diagnostics card writes a review copy the user can read before sending anything. Feedback and crash reports open a pre-filled GitHub issue in the browser; the app does not submit them (`src/feedback/FeedbackDialog.tsx`).

There is no telemetry, analytics, or crash upload. WebView2 performs its own startup checks to Microsoft, which the app cannot disable; the privacy page names them.

## Out of scope

The following are not protected by Kolux:

- an agent doing something destructive with the permissions the user gave it;
- a command that slips past the protected-command parser;
- a compromised Windows account or local malware reading the token files;
- a vulnerability in WebView2, an agent CLI, or a provider;
- a repository's own setup scripts, hooks, or MCP servers that the user chooses to run.

The app asks before some of these actions where it can. It does not claim to prevent them all.

## Reporting

Do not open a public issue for a security problem. Follow the [security policy](../../SECURITY.md) and use GitHub's private vulnerability reporting.
