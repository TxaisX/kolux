# Clean UI: folders-only sidebar, one session per grid cell

Status: not started. Owner decision 2026-11-12.

## What the owner asked for

1. The sidebar shows workspace folders only. No terminal or session rows under a folder,
   because every session is already visible in the workspace grid.
2. Each layout cell shows only its session. Remove the per-cell tab strip
   ("Terminal 3 x", "claude x", "New session x") that sits above each pane header.
   Keep the grid and the layout picker (1/2/4/6/9/12).

## Scope

- `src/shell/window/Grid.tsx`: drop the per-cell tab strip; each cell renders pane header + session.
- One session per cell. A saved layout whose cell holds several tabs opens each extra tab in
  its own cell (grow the layout if needed); nothing is closed or lost.
- Move tab-only controls into the pane header: rename, pin, color, close, usage ring, status
  badges, drag-to-move between cells.
- `src/projects/folderSessions.ts` and the sidebar rows that use it: stop rendering session rows;
  folder rows stay, with their existing actions.
- Keep the current Kolux look. New popovers/menus use the `src/ui/` Base UI wrappers
  (see `docs/base-ui-migration.md`).

## Done when

- Typecheck, project checks, and the full vitest suite pass; Rust tests unaffected.
- Screenshots of the dev app: 1-cell and 4-cell layouts with no tab strip, and a sidebar with
  folders only.
- A layout saved before this change (cells with 2+ tabs) reopens with every session visible.
