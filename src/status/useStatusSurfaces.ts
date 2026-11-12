// The status surfaces the window feeds, moved out of App.tsx as they were (cycle 2, the App.tsx split): the
// Inbox's sources and an exited pane's open prompt (STAT-050, T-035-b), Open in Code's reveal (EDIT-041) and
// the sidebar rows' strongest state (PROJ-063, STAT-036). Called where it sat, so the hook order is unchanged.
import { inboxOverlay } from "../inbox/exitedPrompt";
import { sourceOf, type Source } from "../inbox/inbox";
import { cacheDue, cacheMinutes } from "../projects/cache";
import { paneState, strongest, type AgentState, type RowInfo } from "../projects/rows";
import { tabName } from "../terminal/tabName";
import { workingByDir } from "./working";
import { viewOf } from "../workspaces";
import { useState } from "react";
import type { WindowState } from "../shell/windowStore";
import type { WindowLate } from "../shell/windowLate";

export function useStatusSurfaces({ agentOf, exitedPrompt, hook, liveIds, panes, rowRef, running, settings, stamp, statusOf, titles }: Pick<WindowState, "agentOf" | "hook" | "liveIds" | "panes" | "rowRef" | "running" | "settings" | "stamp" | "statusOf" | "titles"> & Pick<WindowLate, "exitedPrompt">) {
  const sources: Source[] = panes
    .filter((p) => !p.kind && !p.seats)
    // Review of PR #16 (b): the agent the pane carries (agentOf), so the Inbox names Gemini, not PowerShell.
    .map((p) => sourceOf({ ...p, agent: agentOf(p) }, tabName(p, titles), statusOf(p), running[p.key], stamp[p.key]));
  // T-035-b: the Inbox sees an exited pane's open prompt; a restart, a closed pane or a fresh hook state drops it.
  const inboxSeen = inboxOverlay(sources, exitedPrompt.current, hook);
  exitedPrompt.current = inboxSeen.kept;
  const [reveal, setReveal] = useState(0);
  const live = panes.filter((p) => running[p.key]);
  // DT-C274: a row stands for the grid shown in its folder, so a pane counts where it is shown (`viewOf`): an
  // own-folder team's agents count on the row of the folder their one grid is in, not on their hidden worktrees.
  // openDirs keeps every pane's own folder and adds the folder it is shown in.
  const openDirs = panes.flatMap((p) => (p.view != null && p.view !== p.cwd ? [p.cwd, p.view] : [p.cwd])).filter((d): d is string => d !== null);
  // PROJ-063 / PROJ-050: a workspace row shows the strongest state among its panes, and remembers
  // when that last moved so the smart sort can put the newest change first.
  const byDir: Record<string, AgentState[]> = {};
  // STAT-001: a hook-fed state wins over the guess from the program's state.
  for (const p of panes) {
    const dir = viewOf(p);
    if (dir !== null && p.kind !== "browser" && !p.seats) (byDir[dir] ??= []).push(statusOf(p) ?? paneState(p.agent, running[p.key]));
  }
  const rowStates: Record<string, RowInfo> = {};
  const workingIn = workingByDir(panes.map((p) => ({ ...p, cwd: viewOf(p) })), hook, running, liveIds); // STAT-036: working agents per workspace (shown grid, DT-C274)
  const cacheFor = cacheMinutes(settings); // SET-059
  for (const [dir, states] of Object.entries(byDir)) {
    const state = strongest(states);
    const prev = rowRef.current[dir];
    const cache = cacheDue(panes.filter((p) => viewOf(p) === dir).map((p) => ({ agent: p.agent, state: hook[p.key], since: stamp[p.key]?.at ?? 0 })), cacheFor);
    rowStates[dir] = { ...(prev && prev.state === state ? prev : { state, changed: Date.now(), pr: null }), cache, working: workingIn[dir] ?? 0 };
  }
  rowRef.current = rowStates;
  return {
    sources, inboxSeen, reveal, setReveal, live, openDirs, byDir, rowStates, workingIn, cacheFor,
  };
}

export type StatusSurfaces = ReturnType<typeof useStatusSurfaces>;
