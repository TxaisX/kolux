import React, { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { FloorLane } from './FloorLane'
import { buildFloorAxisTicks, floorTimePercent } from './floor-range'
import { countFloorLanes } from './floor-lane-lookup'
import type { FloorHost } from './floor-types'

const LEFT_CELL_WIDTH = 300

function FloorAxis({ range }: { range: { start: number; end: number } }): React.JSX.Element {
  const ticks = useMemo(() => buildFloorAxisTicks(range), [range])
  return (
    <div className="sticky top-0 z-10 flex border-b border-border bg-background">
      <div className="shrink-0" style={{ width: LEFT_CELL_WIDTH }} />
      <div className="relative h-6 min-w-0 flex-1">
        {ticks.map((tick) => (
          <span
            key={tick.at}
            className="absolute top-1 -translate-x-1/2 text-[11px] text-muted-foreground first:translate-x-0"
            style={{ left: `${floorTimePercent(tick.at, range)}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function FloorHostGroup({
  host,
  range,
  selectedPaneKey,
  onSelect
}: {
  host: FloorHost
  range: { start: number; end: number }
  selectedPaneKey: string | null
  onSelect: (paneKey: string) => void
}): React.JSX.Element {
  const agentCount = countFloorLanes([host])
  return (
    <div>
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-1.5 text-xs">
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            host.live ? 'bg-status-success' : 'bg-muted-foreground/40'
          )}
        />
        <span className="font-medium">{host.label}</span>
        <span className="rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {agentCount} agent{agentCount === 1 ? '' : 's'}
        </span>
      </div>
      {host.lanes.map((lane) => (
        <FloorLane
          key={lane.paneKey}
          lane={lane}
          depth={0}
          range={range}
          selectedPaneKey={selectedPaneKey}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

type FloorLanesProps = {
  hosts: FloorHost[]
  range: { start: number; end: number }
  selectedPaneKey: string | null
  onSelect: (paneKey: string) => void
  onOpenInbox: () => void
}

/** Host-grouped agent lanes on a time axis, with a "select then Enter" model:
 *  clicking a lane selects it (and feeds the run panel); Enter opens it in Inbox. */
export function FloorLanes({
  hosts,
  range,
  selectedPaneKey,
  onSelect,
  onOpenInbox
}: FloorLanesProps): React.JSX.Element {
  return (
    <div
      role="listbox"
      aria-label="Agents"
      className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && selectedPaneKey) {
          event.preventDefault()
          onOpenInbox()
        }
      }}
    >
      <FloorAxis range={range} />
      {hosts.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">No agents running right now.</div>
      ) : (
        hosts.map((host) => (
          <FloorHostGroup
            key={host.hostId}
            host={host}
            range={range}
            selectedPaneKey={selectedPaneKey}
            onSelect={onSelect}
          />
        ))
      )}
    </div>
  )
}
