# Renderer sidebar surfaces — who owns what you can see

A map of the left sidebar and the workspace chrome around the pane grid, so a "move/remove this
thing in the sidebar" task starts at the right file instead of a grep sweep. Paths are under
`src/renderer/src/` unless noted.

## The rule that costs the most time

**Visible chrome is usually persisted per-user state, not a code default.** Changing a default in
`src/shared/default-global-settings.ts` does nothing for a profile that already stored a value —
and every profile that has run the app once has. Three stores gate sidebar chrome:

| Store | Holds | Where it lives |
|---|---|---|
| `GlobalSettings` | `showAutomationsButton`, `showMobileButton`, `showArtifactsButton`, `showSkillsButton`, `compactWorktreeCards`, … | settings file in userData; defaults in `shared/default-global-settings.ts` |
| `worktreeCardProperties` | which rows a workspace card shows (`status`, `branch`, `ports`, …) | persisted UI state; one-shot migrations in `src/main/persistence/loading-store/normalize-loaded-ui-state.ts` |
| `collapsedGroups` | which project/group headers are collapsed | persisted UI state |

So: to make chrome disappear for the current user, either delete the render site, or flip the
stored value (`window.api.settings.set({...})` over CDP — see the `nightshift-run` skill). A
default flip alone only changes fresh profiles. The renderer store does not pick up an external
`settings.set` live; the row changes on next renderer load.

## Left sidebar

| What you see | File |
|---|---|
| Search / Tasks / Floor / Agent grid / Artifacts / Skills / Automations / Mobile rows | `components/sidebar/SidebarNav.tsx` — one JSX block per row; the optional ones are wrapped in a `ContextMenu` with a "Hide from sidebar" item |
| The View-menu toggles behind those rows | `src/main/menu/register-app-menu.ts`, fed by `src/main/startup/main-process-i18n-menu.ts` |
| The Projects list itself (virtualized) | `components/sidebar/worktree-list/` — `viewport/` measures, `rows/virtual-row-dispatch.tsx` routes each row type |
| Project header row (repo-backed) | built in `worktree-list/grouping/group-sections.ts` (`groupBy === 'repo'`), rendered by `worktree-list/rows/SectionHeader.tsx` |
| Project **group** header row (folder of projects) | built in `worktree-list/grouping/project-group-sections.ts`, same renderer |
| Status / PR lane headers, flat "All" header, Pinned header | `group-sections.ts`, `build-rows.ts`, `pinned-group-rows.ts` |
| Collapse chevron on any header | `SectionHeader.tsx` → `ctx.toggleGroupWithScrollAnchor(row.key)`, state in `collapsedGroups` |
| Workspace (branch) card | `components/sidebar/WorktreeCard.tsx`, split into `worktree-card-header.tsx` (title, `primary`/`sparse` badges, live-session badge), `worktree-card-meta-row.tsx` (branch, unpushed, ports), `worktree-card-secondary-rows.tsx` (conflict notice, lineage chip), with `worktree-card-presentation.tsx` deciding what renders and `use-worktree-card-secondary-details.ts` deriving it |
| Live-session count badges | `components/session-rail/SessionCountBadge.tsx` (renders nothing at 0), `use-live-session-count.ts` (one worktree), `ProjectSessionCountBadge.tsx` (all worktrees under a project row) |
| Card display-property menus | `sidebar-workspace-option-items.ts` and `worktree-card-display-property-options.ts`; the property union is `shared/worktree/card-properties.ts` and is persisted, so removing a menu entry is cheap but removing the property is a migration |

A header row only knows its workspaces if the builder put `worktreeIds` on it — `GroupHeaderRow`
in `worktree-list/grouping/row-types.ts`. Anything aggregating per project (a count, a status
roll-up) needs that field populated in whichever builder makes that header.

## Workspace chrome around the pane grid

| What you see | File |
|---|---|
| The pane grid for the visible workspace, plus every overlay layer (terminal, browser, emulator, structured-agent, drop layers) | `components/TerminalWorktreeSplitSurface.tsx` — the single mount point; anything docked above or below the grid mounts here |
| Tab groups inside the grid | `components/tab-group/TabGroupSplitLayout.tsx` |
| Seat launcher ("Launch N") | `components/launch-agents/` — `launch-agents-shared-checkout.ts` runs seats as panes in the project's own checkout (no worktree created) |

## Hooks in the list are not free

`rows/*.tsx` render functions are plain functions called during the list's render, not components —
they cannot call hooks. Anything reactive there (a count, a live status) has to be a small
component, as `ProjectSessionCountBadge` is.
