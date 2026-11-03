# Claude settings, theming and "my AI setup" screens: research note

Clean-room note. Everything below comes from public docs pages and is paraphrased. Nothing was taken from app bundles, source or assets.
Date: 2026-11-02. Version numbers are as the public docs stated them that day.

---

## 1. How Claude Code is configured on disk (what a read-only viewer can show)

Convention: `~` = home dir (`%USERPROFILE%` on Windows). If `CLAUDE_CONFIG_DIR` is set, every `~/.claude/...` path and `~/.claude.json` move under that directory. A viewer should honour that variable.

### 1.1 Settings scopes and precedence

| Scope | File | Applies to |
|---|---|---|
| User | `~/.claude/settings.json` | you, every project on this machine |
| Shared project | `<project>/.claude/settings.json` | everyone in the repo (committed) |
| Project local | `<project>/.claude/settings.local.json` | you, this project only (git-ignored) |
| Managed | `managed-settings.json` + optional `managed-settings.d/*.json` in a system dir, or MDM / server-delivered | the whole org; cannot be overridden |

Managed system dirs:
- Windows: `C:\Program Files\ClaudeCode\` (the old `C:\ProgramData\ClaudeCode\` path is no longer read)
- macOS: `/Library/Application Support/ClaudeCode/` (also a configuration profile, domain `com.anthropic.claudecode`)
- Linux / WSL: `/etc/claude-code/`
- Cached server-delivered policy: `~/.claude/remote-settings.json` (also `policy-limits.json`).

Precedence, highest first: managed, command line (`--settings`), project local, shared project, user.
- Same key at several levels: highest wins.
- List keys such as `permissions.allow` are merged across files, not replaced.
- A few security keys keep the stricter value from any level (for example `disableClaudeAiConnectors: true`).
- Environment variables are not a level; each variable/key pair has its own rule (`ANTHROPIC_MODEL` beats the `model` key).
- Settings files are strict JSON (no comments or trailing commas). A broken file is skipped and reported.
- Claude Code reloads these files live when they change, so a viewer can watch them too.

`~/.claude.json` is a separate, self-written file: account details, per-project state (trust decisions), local- and user-scope MCP servers, and "global config" toggles that `/config` writes. It is not a settings scope.

### 1.2 Where each item lives (keys and files)

| Item | Where | Notes for a viewer |
|---|---|---|
| Permissions | `settings.json` key `permissions`: `allow`, `ask`, `deny` (rule strings like `Bash(npm run test *)`), `defaultMode`, `additionalDirectories`, `blockReadsOutsideWorkingDirectories`, `blockWritesOutsideWorkingDirectories` | show merged lists with a source badge per rule. `auto` and `bypassPermissions` default modes are ignored from project/local files; flag that |
| Hooks | `settings.json` key `hooks`: event name (`PreToolUse`, `PostToolUse`, `Notification`, `ConfigChange`, ...) -> list of `{matcher, hooks:[{type:"command", command}]}` | also in skill/agent frontmatter `hooks`, and in plugins. Show command text as plain text, never run it |
| Env | `settings.json` key `env` | values may be secrets; mask by default |
| Model | `model`, `availableModels`, `deniedModels`, `fallbackModel`, `modelPicker`, `modelOverrides`, `effortLevel`, `modelSettings`, `maxEffortLevel` | env overrides: `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_MODEL`; `--model` flag beats both |
| MCP servers | local scope: `~/.claude.json` -> `projects["<path>"].mcpServers`; user scope: `~/.claude.json` -> `mcpServers`; project scope: `<project>/.mcp.json` -> `mcpServers`; managed: `managed-mcp.json` in the managed dir or the `managedMcpServers` key | precedence: managed, local, project, user, plugin-provided, claude.ai connectors. Whole entry from the winner is used, no merging. Per-project on/off in `~/.claude.json` (`disabledMcpServers` / `enabledMcpServers`). Project approval keys: `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers`. Entries can hold tokens in `env` / `headers`; mask |
| Skills | `~/.claude/skills/<name>/SKILL.md`, `<project>/.claude/skills/<name>/SKILL.md`; legacy `commands/*.md` in the same two roots; plugin skills. Frontmatter includes `name`, `description`, `allowed-tools`, `model`, `effort`, `context`, `agent`, `hooks`, `paths` | list name + description + scope; read only the frontmatter |
| Subagents | `~/.claude/agents/*.md`, `<project>/.claude/agents/*.md`. Frontmatter: `name`, `description`, `tools`, `disallowedTools`, `model`, `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `effort`, `color`, `isolation` | `color` is one of 8 names, useful for a legend. Persistent memory in `agent-memory/<name>/` |
| Plugins | `settings.json` keys `enabledPlugins`, `extraKnownMarketplaces`; install record `~/.claude/plugins/installed_plugins.json`; cloned marketplaces and versions under `~/.claude/plugins/`; claude.ai-synced ones in `~/.claude/plugins/synced/` | `syncClaudeAiPlugins` / `syncClaudeAiSkills` control sync. Plugins can add skills, agents, hooks, MCP servers, themes, output styles |
| Memory (CLAUDE.md) | `<project>/CLAUDE.md`, `<project>/CLAUDE.local.md` (private), `~/.claude/CLAUDE.md`, a managed copy, `rules/*.md` (optional `paths` frontmatter) in both roots; `AGENTS.md` can stand in | show a list with size/line count; docs advise keeping each under about 200 lines |
| Auto memory | `~/.claude/projects/<project>/memory/` | Claude's own notes; a read-only list is fine |
| Output styles | `output-styles/*.md` in either root | |
| Themes | `~/.claude/themes/*.json`; selected value stored as `custom:<slug>` | see section 3 |
| Status line | `settings.json` key `statusLine` | |
| Other prefs | `editorMode`, `spinnerTipsEnabled`, `preferredNotifChannel`, `cleanupPeriodDays`, `maxProseWidth` | |
| Keybindings | `~/.claude/keybindings.json` | |

Project path encoding: transcripts go in `~/.claude/projects/<project>/`, where `<project>` is the working path with every non letter/digit character replaced by `-`.

### 1.3 In-product views a Claude tab can echo

| Command | What it shows (paraphrased) |
|---|---|
| `/config` | tabbed dialog with a short list of personal options (theme, editor mode, verbose...). Not a view of settings.json. Not available in the VS Code panel or desktop app |
| `/status` | version, account, model, and a "Setting sources" line naming each settings file actually loaded, with managed delivery in brackets. It does not say which file supplied each key |
| `claude doctor` | lists rejected or broken entries |
| `/context` | what is filling the context window (instructions, tools, MCP, messages) |
| `/usage` | session block (tokens by model, estimated cost, cache hit line), plan usage bars, 24h/7d toggle, attribution by skill, subagent, plugin and MCP server, ranked recommendations. Cost is a local estimate at list price |
| `/cost` | older name for the session cost figure; now folded into `/usage` |
| `/model`, `/effort` | picker and effort level |
| `/mcp` | per-server health (connected, needs auth, failed, pending approval, cached), tool count, plugin origin marker, enable/disable toggle |
| `/hooks`, `/permissions`, `/agents`, `/memory`, `/plugin` | browse the matching config |
| `/theme` | theme picker and custom theme editor |
| `/insights` | HTML report in `~/.claude/usage-data/report.html` |

Takeaway: Claude Code has no single "setup overview" page; the information is scattered over six or more commands. One Claude tab that merges them, with a source badge per item, fills a real gap.

### 1.4 Files a viewer must NEVER read

| Path | Why |
|---|---|
| `~/.claude/.credentials.json` | login / OAuth credentials |
| OS credential store entries (macOS Keychain, Windows Credential Manager, libsecret) | where tokens may live instead of the file |
| `~/.claude/backups/.claude.json.*` | copies of `~/.claude.json` |
| anything an `apiKeyHelper` script points to, any `.env*` file | secrets |
| `~/.claude/projects/**/*.jsonl`, `history.jsonl`, `paste-cache/`, `file-history/`, `debug/`, `shell-snapshots/`, `session-env/`, `uploads/`, heap snapshots | plaintext transcripts and history; the docs say a credential printed by a tool ends up here |

Careful-handling files (read, but whitelist keys and mask values):
- `~/.claude.json`: parse in memory and surface only `projects[*].mcpServers` (names, type, url, command; never `env` / `headers` values), `disabledMcpServers` / `enabledMcpServers`, and UI toggles. Never show or log account fields (email, org, user id, tokens).
- `settings*.json`: mask values under `env`, anything with KEY, TOKEN, SECRET or PASSWORD in the name, and `apiKeyHelper`.
- `.mcp.json`: same masking for `env` and `headers`.
- Hook commands may embed secrets inline; offer a "reveal" click, off by default.

---

## 2. How the Claude apps present settings and appearance

Source basis is thin: the public help article covers only three controls.

- Entry: click your name or initials, bottom-left of the sidebar, then Settings. The older layout kept appearance under "General"; the newer layout has an "Appearance" section.
- Color mode: Light, Match System, Dark. A three-way choice; system is a first-class option.
- Chat font: Default, Match System, Dyslexic Friendly (an accessibility font offered by name).
- Sidebar: can't be switched off, only collapsed with a button at its top edge.
- No accent colour, custom theme or theme presets exist in the apps (a public feature request asks for sepia and high-contrast presets, which confirms they are absent). Third-party browser add-ons exist; ignore them.
- Claude Desktop reads the same Claude Code settings files; `/config` isn't available there, so the app's own settings page is the only UI.
- Layout pattern: a left rail of sections, one scrolling pane of labelled rows, each row = short label, one-line help, control on the right. Few controls per page, no tabs inside tabs.
- The Claude Code CLI is the richer one: a theme picker with auto-detect, colour-blind (daltonized) variants, plain-ANSI variants and user-defined themes (section 3). Worth copying more than the apps.

Patterns worth borrowing:
1. Three-way color mode with "Match System" as a named option, not a hidden default.
2. Accessibility font offered as a named choice, not buried.
3. Short settings pages; advanced material behind explicit links.
4. A "setting sources" line: tell the user in plain words which files contributed.
5. Sync-from-account toggles shown as ordinary switches with a one-line explanation.

---

## 3. Claude Code custom theme model (prior art for Kolux)

Facts from the public docs:
- A custom theme is one JSON file in `~/.claude/themes/`; filename = slug; the selection is stored as `custom:<slug>`.
- Three optional fields: `name`, `base` (one of `dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`, `light-ansi`; default `dark`), and `overrides` (token name -> colour).
- Only the tokens you list change; the rest fall back to the base. Unknown tokens and invalid colours are silently ignored, so a typo cannot break rendering.
- Colour syntax: hex (3 or 6 digits), `rgb(r,g,b)`, `ansi256(n)`, `ansi:<name>`.
- Files are watched and reload live.
- Tokens are semantic and grouped: text and accent; status (success, error, warning, merged); input border and mode indicators; diff backgrounds (added/removed, dimmed, word-level); message backgrounds; selection; side panel; usage meter fill/empty; eight named subagent colours; shimmer partners for animated tokens.
- Interactive editor: "New custom theme", pick a token, live preview, Ctrl+E to edit.
- Plugins can contribute themes too.

---

## 4. Recommendations for Kolux RS

### Appearance page

1. **Base plus overrides, not full palettes.** Store a theme as `{name, base, overrides:{token: colour}}`. A user who only wants a different accent writes one line; tokens added in future versions never break old themes. Ignore unknown tokens and bad colours instead of failing.
2. **Four main colour pickers plus an Advanced fold.** Front row: Accent, Background, Surface (cards, panels), Text. Derive hover, border, muted text and selection from those by mixing toward text/background. The Advanced fold lists every individual token, grouped as the docs do (text, status, borders, diffs, selection). Most people never open it.
3. **Terminal palette as its own section.** Foreground, background, cursor, selection and the 16 ANSI slots as two rows of 8 clickable swatches. Buttons: "Derive from app theme" and "Match Claude Code theme". The live preview is a fake terminal snippet printing all 16 colours, a diff (added/removed lines), and an error and a success line.
4. **Contrast warnings, inline and non-blocking.** Compute the WCAG ratio for each text-on-surface pair and show a small chip beside the swatch: green "AA", yellow "low (3.1)", red "fails". Check at least text/background, text/surface, accent/background, accent-text/accent, muted/surface, and ANSI 1-7 against the terminal background. Warn, never forbid. Add a "Fix automatically" action that nudges lightness until AA is met.
5. **Mode handling like the Claude app, plus more.** Light, Match System, Dark as a segmented control; each custom theme declares its mode, and the user can pin a different theme for light and for dark so "Match System" swaps them. Ship a colour-blind-safe preset (status colours that do not rely on red/green) and a high-contrast preset, since the apps have neither.
6. **Import / export as single small files.** One theme = one `.json` (name, base, overrides, terminal palette, schema version). Export copies to clipboard and saves a file; import accepts a file or pasted JSON, validates, and shows a preview and a diff against the current theme before applying. Lenient on read (skip bad entries and say how many), strict on write. Add "Reset to base" per token (a small undo arrow on each changed row).
7. **Live apply, cheap rollback.** Apply while editing and keep "Revert" until the page closes. Persist one file per theme in a user themes folder and watch it, so hand-editing or sharing a file just works.

### Claude tab (read-only setup overview)

8. **One page that answers "how is Claude set up here?"** Collapsible cards: Sources loaded (managed / user / project / local, with path and found / missing / invalid state), Model and effort, Permissions (merged allow/ask/deny, each row with a scope badge), Hooks (event, matcher, command), MCP servers (name, scope, transport, enabled; masked env), Skills, Subagents (with their colour), Plugins and marketplaces, Memory files (CLAUDE.md chain with sizes and a "too long" hint past about 200 lines), Output styles and theme. At the top, a precedence strip (Managed > CLI > Local > Project > User) highlighting which scope each visible value came from. That does what `/status` only half does ("which files", not "which file set this key").
9. **Project selector at the top**, defaulting to the active terminal's working directory, since local and project scope depend on it. Show a clear "no project files found" state rather than an empty page.
10. **Safety by construction.** Read only through an allow-list of paths and keys (section 1.4). Never open `.credentials.json`, transcripts, history or backups. Parse `~/.claude.json` in the backend and return only whitelisted fields. Mask `env`, `headers` and token-like values by default. Never execute hook or MCP commands. Show invalid JSON as an error card with the parse position, not a crash. Footer line: "Kolux only reads configuration; it never reads your credentials or conversations."
11. **Keep usage honest.** If cost is echoed, label it a local estimate (the docs say it is computed locally at list price and is per machine). Link out to the account usage page rather than re-implementing plan limits.

Priority if time is short: 1, 2, 4, 8, 10 (themes that cannot break, readable by default, and a safe overview).

---

## Sources (all public docs / support domains)

- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/claude-directory
- https://code.claude.com/docs/en/mcp
- https://code.claude.com/docs/en/managed-settings
- https://code.claude.com/docs/en/terminal-config
- https://code.claude.com/docs/en/costs
- https://code.claude.com/docs/en/interactive-mode
- https://support.claude.com/en/articles/8887527-customizing-your-appearance-settings
