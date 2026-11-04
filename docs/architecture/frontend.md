# Frontend architecture

The window is a React 19 and TypeScript app built with Vite. It has no router, no global state library, and no CSS framework. The shape is deliberate: one large window state, a small number of contexts, and plain CSS with design tokens.

## Boot

`src/main.tsx` does the work before React draws:

1. Apply the cached appearance from `localStorage["kolux.look"]`, so the first frame already has the saved mode and fonts (`src/main.tsx:26-27`, `src/theme.ts:393-409`).
2. Start the system light/dark watcher.
3. Load `./App` and read settings in parallel, with a 1.5-second race (`src/main.tsx:35-39`).
4. After settings arrive, stamp the look, apply language and zoom, restore the saved tab layout, drop panes whose folder is gone, prune history, and rebuild each agent's resume start line (`src/main.tsx:83-113`).
5. Render, show the window after two frames, and prefetch lazy modules during idle time (`src/main.tsx:46-63`).
6. If settings arrive late, re-render with the saved tabs instead of letting the empty layout overwrite them (`src/main.tsx:69-76`).

The window is created hidden (`src-tauri/tauri.conf.json:22`), so the user never sees a white or wrong-theme frame.

## Shell and navigation

There is no URL router. The only URL use is the Tower's `#tower-window` hash (`src/main.tsx:29-31`). The current screen is a string union:

`Agents`, `Board`, `Terminals`, `Tower`

(`src/chrome/TopBar.tsx:26-33`).

The screen is persisted as `lastScreen` through a 400 ms coalescer, and other windows follow the same setting (`src/shell/useWindowSave.ts:33-58`). Full pages such as Settings, Inbox, Tower, Floor, Space, Artifacts, and Skills are separate state, persisted as `openPage` (`src/shell/windowStore.ts:64`, `src/shell/useWindowSave.ts:28-30`).

The element tree is:

```
.app
  Tip
  TopBar
  .body
    Dialogs
    Sidebar
    Content
    Right
  Hosts (status bar, floating layer, wizard, update, edit menu)
```

(`src/shell/WindowView.tsx:31-42`). The top bar is 36 px and is the drag region (`src/styles.css:45`). Under 900 CSS pixels the side panels take turns rather than shrinking to nothing (`src/shell/window/narrow.ts:4-30`).

## Feature modules

| Module | Responsibility | Entry point |
|---|---|---|
| `agents` | Agents rail, board chips, Tower figures | `src/agents/useRailAndTower.ts` |
| `board` | Board lanes and cards | `src/board/chip.ts` |
| `terminals` | Grid, tabs, panes, terminal session | `src/shell/window/Grid.tsx` |
| `tower` | Control-tower screen and its own window | `src/tower/TowerView.tsx` |
| `floor` | Activity timeline | `src/floor/FloorView.tsx` |
| `tasks` | GitHub issues and pull requests | `src/tasks/TasksPage.tsx` |
| `automations` | Scheduled and event-driven runs | `src/automations/AutomationsPage.tsx` |
| `skills` | Skill library and installs | `src/skills/SkillsPage.tsx` |
| `artifacts` | Artifact library and sandboxed viewer | `src/artifacts/ArtifactsPage.tsx` |
| `settings` | Settings pages and per-repo settings | `src/settings/SettingsPage.tsx` |
| `onboarding` | First-run wizard, guides, tours | `src/onboarding/Wizard.tsx` |
| `editor` | Editor, previews, diffs, explorer | `src/editor/EditorPane.tsx` |
| `browser` | Browser tab and native child webview | `src/browser/BrowserPane.tsx` |
| `chat` | Transcript view of a terminal-backed session | `src/chat/ChatView.tsx` |
| `scm` | Source control, PRs, checks, review notes | `src/scm/SourceControlPanel.tsx` |
| `sessions` | Past sessions and resume | `src/sessions/AgentsPanel.tsx` |
| `projects` | Projects, workspaces, CLI bridge | `src/projects/ProjectsPanel.tsx` |
| `usage` | Plan limits, pills, token analytics | `src/usage/plan.ts` |
| `update` | Update center and timetable | `src/update/UpdateCenter.tsx` |
| `recovery` | Heartbeat, crash screen, error boundary | `src/recovery/RecoveryMount.tsx` |

Supporting folders: `shell` (window state and layout), `chrome` (top bar, status bar, icons), `launch` (agents, seats, chooser), `status` (agent status and notifications), `keys` (keymap and shortcuts), `i18n` (six languages), `look` (pane header cards), `floating` (floating workspace panel), `marks` (vendor marks), `notify` (badge and notification pacing), and `setup` (trust prompts).

## State and data flow

There is no Redux, Zustand, or MobX. There are two React contexts:

- `KeymapContext` for the resolved shortcut map (`src/keys/KeymapContext.tsx:27`);
- `WindowStoreContext` for the window state (`src/shell/window/store.tsx:9`).

Everything else is one large hook, `useWindowStore` plus `useWindowStoreTail`, typed as `WindowBag` (`src/shell/windowStore.ts:45-206`, `src/shell/windowBag.ts`). That object holds the current screen, the open page, panes, tabs, the focused terminal, the settings copy, and the handlers.

Settings are loaded once at startup. The window saves only the keys that changed:

```
settings_patch { set, remove }
```

Rust applies the patch under one lock, strips secret fields, and broadcasts `settings-saved` with only the changed keys (`src-tauri/src/lib.rs:160-170`, `src-tauri/src/settings_sync.rs`). Every window overlays the patch on its local copy, so two windows cannot overwrite each other with stale full copies (`src/settings/settingsSync.ts:10`, `:23-36`).

Layout is saved with a 400 ms coalescer and a 2-second maximum, then flushed before close (`src/shell/useWindowSave.ts:138-147`). The saved form is a per-folder pane layout, not a screenshot of the DOM (`src/terminal/layoutSave.ts:25-69`).

## Status pipeline

Agent state has one path from the hook listener to every surface:

1. The agent runs its hook script, which posts to the loopback listener.
2. Rust turns the event into a pane state and emits `agent-status`.
3. `useAgentStatus` keeps per-pane hook, stamp, turn, and stale maps (`src/status/useAgentStatus.ts:234-320`).
4. `paneStatus` derives the one state used everywhere (`src/shell/windowStore.ts:137-138`, `src/board/chip.ts:73-109`).
5. Tabs, the sidebar, the needs strip, the Board, the Tower, the Inbox, notifications, and the taskbar badge all read that same derived value.

This is why the pane header, Board card, and Inbox row cannot disagree about whether an agent is waiting.

## Terminal grid

The grid supports 1 to 12 cells per workspace (`src/terminal/grid.ts:33-49`). Tabs share a cell through their group, and a cell can be split into stacked panes (`src/terminal/grid.ts:9-21`, `:74-78`). A pane can expand to fill the workspace and restore the previous layout (`src/terminal/grid.ts:101-116`). Divider dragging, split right/down, and drag reordering are separate modules (`src/terminal/paneGrid.ts:14-77`, `src/terminal/tabSplit.ts:11-28`, `src/terminal/rearrange.ts`).

Each pane is an xterm.js terminal. The setup includes FitAddon, Unicode-16 widths, OSC-9999 in-band status, and custom link providers (`src/terminal/TerminalPane.tsx:461-518`). The WebGL renderer is used when available, with a pool of at most six GPU contexts and a DOM fallback on context loss (`src/terminal/renderer.ts:30-98`). The ligatures addon is loaded lazily.

Reattach is the important part. Before starting a new terminal, the pane asks the background service for its old one, with a 3-second limit and a protocol floor (`src/terminal/reattach.ts:19-44`). If the service has been replaced, output from the old generation is dropped (`src/terminal/TerminalPane.tsx:881`). The pane then attaches or starts, and the service returns the scrollback tail it missed.

## Editor and viewers

- **CodeMirror 6** is the source editor, with language detection, one-dark highlighting, and compartments for settings (`src/editor/EditorPane.tsx:17-22`).
- **Lexical** is the rich Markdown editor, not the preview (`src/editor/markdown.ts:5-20`). The source/rich switch is `src/editor/viewSwitch.ts`.
- **Markdown preview** uses `marked` plus DOMPurify, with mermaid and KaTeX loaded only when a diagram appears (`src/editor/PreviewPane.tsx:7-8`, `src/editor/diagramLibs.ts:8-25`). Diagrams render in a locked iframe.
- **PDF** uses pdf.js with canvas pages near the viewport, text and link layers, and locked options (`src/editor/PdfView.tsx:9-20`, `src/editor/pdfPageLayers.ts`, `src/editor/pdfFiles.ts`).
- **Images, SVG, CSV, and notebooks** have their own viewers (`src/editor/ImageView.tsx`, `SvgView.tsx`, `CsvTable.tsx`, `NotebookView.tsx`).
- **Diffs** use CodeMirror's `MergeView` and a unified view, with review-note gutters (`src/editor/DiffPane.tsx:18-26`, `src/editor/AllChangesPane.tsx:20-26`).

## Styling and the first frame

`src/styles.css` is about 1,619 lines and 146 KB, imported once at `src/main.tsx:16`. Feature CSS files add roughly another 110 KB. There is no Tailwind, no CSS-in-JS, and no web font download.

The theme module writes about 50 color tokens as CSS custom properties on `:root` (`src/theme.ts:11-61`, `:352-356`). There are 17 built-in hues, plus user custom themes, and light, dark, or system mode (`src/theme.ts:95-117`). Fonts are system stacks: Inter or Segoe UI Variable for the UI, Cascadia Mono or Consolas for code.

The first frame is handled outside React. `index.html` replays a whitelisted set of `--token` variables from `localStorage["kolux.look"]` before paint (`index.html:8-22`). `applyAppearance` always rewrites that cache (`src/theme.ts:303`, `:393-409`), and `cachedAppearance` reads it at boot (`src/main.tsx:26`). The window is shown only after the first paint.

## Lazy loading and the budget

`deferred()` wraps `React.lazy`, caches the module, and renders inside `Suspense` (`src/lazy/deferred.tsx:16-26`). It covers about 40 pages and dialogs (`src/lazy/pages.tsx:14-69`) and six pane bodies (`src/lazy/panes.tsx:9-22`). The terminal pane is not lazy; it is on the first screen.

After the first frame, `prefetch()` loads the rest at idle time or after 1.5 seconds (`src/lazy/deferred.tsx:33-39`, `src/main.tsx:63`). Settings pages split again per page, and mermaid is a separate dynamic import.

The first-load JavaScript budget is 1,490,000 bytes (`scripts/bundle-budget.mjs:18`). It counts the entry script, its preloads, the `App-*` chunk, and their static imports. CSS and on-demand chunks are excluded. CI enforces it after `vite build` (`.github/workflows/ci.yml:68-69`).

## Where to change what

- A new screen: add it to the screen union, the top bar switcher, and the page table; persist it through `lastScreen` or `openPage`.
- A new pane kind: add it to `src/shell/window/Pane.tsx` and the lazy pane table.
- A new status surface: read `paneStatus`, do not add a second derivation.
- A new setting: add it to `src/settings/pages.ts` and the settings registry, then read it through `useAppSettings`.
- A new theme token: add it to `theme.ts` and the first-frame whitelist in `index.html`.
- A new Tauri command: register it in `lib.rs` and add the TypeScript wrapper; `scripts/invoke-contract.mjs` will fail if the name does not match.
