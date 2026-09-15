// Shared types for the Floor page's pure lane builder. Kept separate from the
// builder itself so the React components can import types without pulling in
// the (larger) build logic.

/** Visible window presets for the Floor time axis. */
export type FloorRange = '15m' | '60m' | 'today'

/** Presentation vocabulary for a Floor bar segment — narrower than
 *  AgentRowState: 'blocked'/'waiting' fold into 'needs' (see three-mode-shell.md). */
export type FloorSegmentKind = 'working' | 'needs' | 'done' | 'unverifiable' | 'idle'

export type FloorSegment = {
  start: number
  end: number
  kind: FloorSegmentKind
  /** Short text shown on/near the bar. Only the current (last) segment carries
   *  the live status text; historical segments carry a generic kind label. */
  label?: string
}

export type FloorLane = {
  paneKey: string
  tabId: string
  worktreeId: string
  repoId: string
  repoName: string
  branch: string
  title: string
  agent: string
  role?: string
  parentPaneKey?: string
  /** Current row state, already decayed to idle/unverifiable when stale. */
  state: FloorSegmentKind
  statusText: string
  /** When this agent's tracked history began (oldest stateHistory entry, or
   *  stateStartedAt if it has none yet) — independent of the visible range. */
  startedAt: number
  /** The user's most recent prompt to this agent, when known. */
  prompt?: string
  segments: FloorSegment[]
  children: FloorLane[]
}

export type FloorHost = {
  hostId: string
  label: string
  live: boolean
  lanes: FloorLane[]
}

export type FloorLanesResult = {
  hosts: FloorHost[]
  range: { start: number; end: number }
}

/** Minimal tab projection the builder needs — decoupled from the full TerminalTab. */
export type FloorTabInput = {
  id: string
  worktreeId: string
  title: string
}

/** Minimal worktree+host projection the builder needs. Host resolution
 *  (SSH/runtime labels, connection health) is the caller's job. */
export type FloorWorktreeInput = {
  id: string
  repoId: string
  repoName: string
  name: string
  branch: string
  hostId: string
  hostLabel: string
  hostLive: boolean
}
