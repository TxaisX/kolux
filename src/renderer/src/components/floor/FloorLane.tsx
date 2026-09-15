import React from 'react'
import { cn } from '@/lib/utils'
import { AgentStateDot } from '@/components/AgentStateDot'
import { floorDotState } from './floor-dot-state'
import { floorTimePercent } from './floor-range'
import type { FloorLane as FloorLaneData, FloorSegment, FloorSegmentKind } from './floor-types'

const LEFT_CELL_WIDTH = 300
const INDENT_PER_DEPTH = 20

const SEGMENT_CLASS: Record<FloorSegmentKind, string> = {
  working: 'bg-accent text-accent-foreground',
  needs: 'bg-agent-question text-white',
  done: 'bg-status-success text-white',
  unverifiable: 'text-muted-foreground',
  idle: ''
}

const UNVERIFIABLE_STRIPE = {
  backgroundImage:
    'repeating-linear-gradient(135deg, var(--muted-foreground) 0, var(--muted-foreground) 1px, transparent 1px, transparent 6px)',
  opacity: 0.5
} as const

function FloorSegmentBar({
  segment,
  range
}: {
  segment: FloorSegment
  range: { start: number; end: number }
}): React.JSX.Element | null {
  if (segment.kind === 'idle') {
    return null
  }
  const left = floorTimePercent(segment.start, range)
  const width = Math.max(floorTimePercent(segment.end, range) - left, 0.5)
  return (
    <span
      className={cn(
        'absolute top-1 bottom-1 flex items-center overflow-hidden truncate rounded-sm px-1.5 text-[11px]',
        SEGMENT_CLASS[segment.kind]
      )}
      style={{
        left: `${left}%`,
        width: `${width}%`,
        ...(segment.kind === 'unverifiable' ? UNVERIFIABLE_STRIPE : undefined)
      }}
      title={segment.label}
    >
      {segment.kind !== 'unverifiable' ? segment.label : null}
    </span>
  )
}

type FloorLaneProps = {
  lane: FloorLaneData
  depth: number
  range: { start: number; end: number }
  selectedPaneKey: string | null
  onSelect: (paneKey: string) => void
}

export function FloorLane({
  lane,
  depth,
  range,
  selectedPaneKey,
  onSelect
}: FloorLaneProps): React.JSX.Element {
  const selected = selectedPaneKey === lane.paneKey
  return (
    <>
      <div
        role="option"
        aria-selected={selected}
        tabIndex={0}
        data-pane-key={lane.paneKey}
        onClick={() => onSelect(lane.paneKey)}
        className={cn(
          'flex cursor-pointer border-b border-border/60 outline-none',
          selected && 'bg-accent'
        )}
      >
        <div
          className="flex shrink-0 flex-col justify-center gap-0.5 py-2 pr-3"
          style={{ width: LEFT_CELL_WIDTH, paddingLeft: 12 + depth * INDENT_PER_DEPTH }}
        >
          <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
            <AgentStateDot state={floorDotState(lane.state)} size="sm" title={null} />
            <span className="truncate">{lane.title}</span>
            {lane.role ? (
              <span className="shrink-0 truncate font-normal text-muted-foreground">
                · {lane.role}
              </span>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="shrink-0 font-mono">{lane.branch}</span>
            <span
              className={cn('truncate', lane.state === 'needs' && 'text-agent-question')}
            >
              {lane.statusText}
            </span>
          </div>
        </div>
        <div className="relative min-w-0 flex-1">
          {depth > 0 ? (
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-1/2 left-0 border-l border-border"
            />
          ) : null}
          {lane.segments.map((segment) => (
            <FloorSegmentBar key={`${segment.start}-${segment.kind}`} segment={segment} range={range} />
          ))}
          <span aria-hidden="true" className="absolute inset-y-0 right-0 border-r border-dashed border-border" />
        </div>
      </div>
      {lane.children.map((child) => (
        <FloorLane
          key={child.paneKey}
          lane={child}
          depth={depth + 1}
          range={range}
          selectedPaneKey={selectedPaneKey}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}
