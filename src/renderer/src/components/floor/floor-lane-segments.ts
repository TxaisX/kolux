import type { AgentStatusEntry, AgentStatusState } from '../../../../shared/agent-status-types'
import { agentNoUpdateLabel, type AgentRowState } from '@/lib/agent-row-decay-state'
import type { FloorSegment, FloorSegmentKind } from './floor-types'

/** Fold the six-state row vocabulary onto the five Floor bar colors — 'blocked'
 *  and 'waiting' both read as "needs you" (three-mode-shell.md vocabulary). */
export function floorSegmentKind(state: AgentRowState | AgentStatusState): FloorSegmentKind {
  switch (state) {
    case 'blocked':
    case 'waiting':
      return 'needs'
    case 'working':
    case 'done':
    case 'idle':
    case 'unverifiable':
      return state
  }
}

function segmentKindLabel(kind: FloorSegmentKind): string {
  switch (kind) {
    case 'working':
      return 'Working'
    case 'needs':
      return 'Needs you'
    case 'done':
      return 'Done'
    case 'unverifiable':
      return 'Unverifiable'
    case 'idle':
      return 'Idle'
  }
}

/** Status line shown in the lane's left cell for its current (live) state. */
export function floorLaneStatusText(
  entry: AgentStatusEntry,
  currentState: AgentRowState,
  now: number
): string {
  if (currentState === 'unverifiable') {
    return agentNoUpdateLabel(entry, now)
  }
  if (currentState === 'idle') {
    return 'Idle'
  }
  const message = entry.lastAssistantMessage?.trim()
  if (currentState === 'working') {
    return entry.toolName ? `Running ${entry.toolName}` : (message ?? 'Working')
  }
  if (message) {
    return message
  }
  return segmentKindLabel(floorSegmentKind(currentState))
}

/**
 * Build the lane's segment timeline from `stateHistory` (oldest to newest,
 * appended-only — see agent-status-live-entry-builder.ts) plus the current
 * live state, which runs to `now`. Each entry's span is [its startedAt, the
 * next entry's startedAt); clamp to [range.start, range.end] and drop
 * segments that fall entirely outside it.
 */
export function buildLaneSegments(
  entry: AgentStatusEntry,
  currentState: AgentRowState,
  currentStatusText: string,
  range: { start: number; end: number },
  now: number
): FloorSegment[] {
  const timeline: { state: AgentStatusState | AgentRowState; startedAt: number }[] = [
    ...entry.stateHistory.map((h) => ({ state: h.state, startedAt: h.startedAt })),
    { state: currentState, startedAt: entry.stateStartedAt }
  ]
  const segments: FloorSegment[] = []
  for (let i = 0; i < timeline.length; i++) {
    const isCurrent = i === timeline.length - 1
    const start = Math.max(timeline[i].startedAt, range.start)
    const end = Math.min(isCurrent ? now : timeline[i + 1].startedAt, range.end)
    if (end <= start) {
      continue
    }
    const kind = floorSegmentKind(timeline[i].state)
    segments.push({
      start,
      end,
      kind,
      label: isCurrent ? currentStatusText : segmentKindLabel(kind)
    })
  }
  return segments
}
