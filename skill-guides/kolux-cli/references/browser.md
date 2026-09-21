# Built-in browser commands

Use a snapshot-interact-re-snapshot loop:

```text
KOLUX goto --url https://example.com --json
KOLUX snapshot --json
KOLUX click --element @e3 --json
KOLUX snapshot --json
```

Common commands:

```text
KOLUX goto --url <url> --json
KOLUX back --json
KOLUX reload --json
KOLUX snapshot --json
KOLUX screenshot --json
KOLUX full-screenshot --json
KOLUX pdf --json
KOLUX click --element <ref> --json
KOLUX fill --element <ref> --value <text> --json
KOLUX type --input <text> --json
KOLUX select --element <ref> --value <value> --json
KOLUX check --element <ref> --json
KOLUX scroll --direction down --amount 1000 --json
KOLUX hover --element <ref> --json
KOLUX focus --element <ref> --json
KOLUX keypress --key Enter --json
KOLUX upload --element <ref> --files <paths> --json
KOLUX wait --text <text> --json
KOLUX wait --url <substring> --json
KOLUX wait --selector <css> --json
KOLUX wait --load networkidle --json
KOLUX eval --expression <js> --json
KOLUX tab list --json
KOLUX tab create --url <url> --json
KOLUX tab switch --index <n> --json
KOLUX tab close --index <n> --json
KOLUX cookie get --json
KOLUX capture start --json
KOLUX console --limit 50 --json
KOLUX network --limit 50 --json
KOLUX exec --command "help" --json
```

Browser rules:

- Re-snapshot after navigation, tab switches, clicks that change the page, and any `browser_stale_ref`.
- Refs like `@e1` are assigned by `snapshot`, scoped to one tab, and invalidated by navigation or tab switch.
- Browser commands default to the current worktree and its active tab. Use `--worktree all` only intentionally.
- For concurrent browser work, run `KOLUX tab list --json`, read `tabs[].browserPageId`, and pass `--page <browserPageId>` on later commands.
- Use typed tab commands (`KOLUX tab list/create/close/switch`), not `KOLUX exec --command "tab ..."`, so Kolux keeps UI state synchronized.
- Prefer `wait --text`, `--url`, `--selector`, or `--load` after async page changes instead of bare timeouts.
- Anything not listed above goes through `KOLUX exec --command "<agent-browser command>"`.
- If `fill` or `type` fails on a custom input, try `KOLUX focus --element @e1 --json` then `KOLUX inserttext --text "text" --json`.
- A client-hosted page renders in the paired desktop's browser engine, so every command against it needs that desktop online and returns `browser_host_unavailable` while it is closed, asleep, or disconnected. Server-hosted pages run with no desktop attached; prefer them for long or unattended automation.

Common recoveries:

- `browser_no_tab`: open a tab with `KOLUX tab create --url <url> --json`.
- `browser_stale_ref`: run `KOLUX snapshot --json` and retry with fresh refs.
- `browser_tab_not_found`: run `KOLUX tab list --json` before switching or closing.
- `browser_host_unavailable`: the desktop hosting the page is offline. Bring it back, or recreate the page with server placement if the work must outlive the desktop session.
