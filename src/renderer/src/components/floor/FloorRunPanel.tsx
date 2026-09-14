import React from 'react'
import { Code2, Inbox as InboxIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { AgentStateDot } from '@/components/AgentStateDot'
import { formatCompactDuration } from '@/lib/agent-row-decay-state'
import { floorDotState } from './floor-dot-state'
import { openFloorLaneInCode, openFloorLaneInInbox } from './floor-lane-activation'
import type { FloorSelection } from './floor-lane-lookup'
import type { FloorLane, FloorSegmentKind } from './floor-types'

function countByState(lanes: FloorLane[], state: FloorSegmentKind): number {
  return lanes.filter((lane) => lane.state === state).length
}

/**
 * Right-column detail for the selected lane's run: identity, prompt, child
 * roster and the two cross-mode jumps. Runs/tasks/dispatch and mailboxes
 * exist in the `nightshift` CLI but have no renderer IPC yet (see
 * three-mode-shell.md), so this panel only reads fields the agent-status hook
 * pipeline already delivers (`AgentStatusOrchestrationContext`).
 */
export function FloorRunPanel({
  selection,
  now
}: {
  selection: FloorSelection | null
  now: number
}): React.JSX.Element {
  if (!selection) {
    return (
      <div className="w-90 shrink-0 border-l border-border p-4 text-sm text-muted-foreground">
        Select an agent to see its run.
      </div>
    )
  }
  const { lane, root, children, hostLabel } = selection
  const everyone = [root, ...children]
  const activeCount = countByState(everyone, 'working')
  const needsYouCount = countByState(everyone, 'needs')

  return (
    <div className="w-90 shrink-0 overflow-y-auto scrollbar-sleek border-l border-border">
      <div className="space-y-3 border-b border-border p-4">
        <h3 className="text-sm font-semibold">
          {root.title}
          {children.length > 0 ? ` · ${children.length + 1} agents` : ''}
        </h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Repo</dt>
          <dd className="font-mono">{root.repoName}</dd>
          <dt className="text-muted-foreground">Host</dt>
          <dd>{hostLabel}</dd>
          <dt className="text-muted-foreground">Started</dt>
          <dd>{formatCompactDuration(now - root.startedAt)} ago</dd>
          {root.prompt ? (
            <>
              <dt className="text-muted-foreground">Prompt</dt>
              <dd className="line-clamp-3">{root.prompt}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <div className="border-b border-border p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tasks
        </div>
        <div className="flex gap-4 text-sm">
          <div>
            <div className="text-base font-semibold">{activeCount}</div>
            <div className="text-xs text-muted-foreground">active</div>
          </div>
          <div>
            <div
              className={
                needsYouCount > 0
                  ? 'text-base font-semibold text-agent-question'
                  : 'text-base font-semibold'
              }
            >
              {needsYouCount}
            </div>
            <div className="text-xs text-muted-foreground">needs you</div>
          </div>
        </div>
      </div>

      <div className="border-b border-border p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Lineup
        </div>
        <div className="space-y-1.5">
          {everyone.map((member) => (
            <div key={member.paneKey} className="flex items-center gap-1.5 text-sm">
              <AgentStateDot state={floorDotState(member.state)} size="sm" title={null} />
              <span className="truncate">{formatAgentTypeLabel(member.agent)}</span>
              {member.role ? (
                <span className="truncate text-xs text-muted-foreground">{member.role}</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 p-4">
        <Button variant="outline" size="sm" className="flex-1" onClick={() => openFloorLaneInCode(lane, selection.hostId)}>
          <Code2 />
          Open in Code
        </Button>
        <Button variant="outline" size="sm" className="flex-1" onClick={() => openFloorLaneInInbox()}>
          <InboxIcon />
          Open in Inbox
        </Button>
      </div>
    </div>
  )
}
