// PKG-2 (narrow the redraw): when the sidebar's project list may skip a render. Every prop is named with how it is
// compared (stable.ts sameProps). Every function prop runs from a handler or an effect, never while the list draws, so
// Sidebar.tsx hands over the window's deeds (store.tsx), which keep one identity.
import type { ComponentProps } from "react";
import type ProjectsPanel from "../../projects/ProjectsPanel";
import { sameProps } from "./stable";
import { sameSettings } from "./terminalProps";

/** The sidebar's handle to focus one pane from its session row (bug 20261112-1200). Named here so the shell can
 * hand it over before ProjectsPanel declares it; once the panel lists it the intersection is the same type. */
export type FocusPane = { onFocusPane?: (key: number) => void };

export type ProjectsProps = ComponentProps<typeof ProjectsPanel> & FocusPane;

/** True when the project list would draw the same: React.memo's comparator for ProjectsPanel. */
export const sameProjects = sameProps<ProjectsProps>({
  reveal: "same",
  openDirs: "data", // made fresh each render from the panes
  sessions: "data", // made fresh each render from the panes
  states: "data", // made fresh each render from the panes
  unread: "same", // a new Set on every change
  onUnread: "same",
  settings: sameSettings, // read while drawing (group, sort, details): by value, less the window's saved layout
  onSetting: "same",
  activeDir: "same",
  workDir: "same",
  onSelect: "same",
  onAdded: "same",
  onRemoved: "same",
  onRemovedAll: "same",
  onSleep: "same",
  agents: "same",
  launching: "same",
  onLaunch: "same",
  defaultId: "same",
  onSetDefault: "same",
  onChoose: "same",
  onTerminal: "same",
  allOff: "same",
  pass: "same",
  onRefresh: "same",
  page: "same",
  onPage: "same",
  refresh: "same",
  onIndex: "same",
  createRequest: "same",
  worktreeRequest: "same",
  onWorktreeSession: "same",
  createName: "same",
  deleteRequest: "same",
  renameRequest: "same",
  onRenameTaken: "same",
  onStartIn: "same",
  nest: "same",
  onNest: "same",
  onPending: "same",
  onFocusPane: "same", // a stable caller (Sidebar.tsx act.focusPane)
}, "projects");
