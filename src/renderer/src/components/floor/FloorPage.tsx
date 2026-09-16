import { translate } from '@/i18n/i18n'
import React, { useEffect, useMemo, useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useNow } from '@/hooks/use-now'
import { FloorLanes } from './FloorLanes'
import { FloorRunPanel } from './FloorRunPanel'
import { countFloorLanes, firstFloorLanePaneKey, resolveFloorSelection } from './floor-lane-lookup'
import { openFloorLaneInInbox } from './floor-lane-activation'
import { useFloorLanes } from './use-floor-lanes'
import type { FloorRange } from './floor-types'

function rangeOptions(): { value: FloorRange; label: string }[] {
  return [
    { value: '15m', label: translate('components.floor.range.15m', '15m') },
    { value: '60m', label: translate('components.floor.range.60m', '60m') },
    { value: 'today', label: translate('components.floor.range.today', 'Today') }
  ]
}

function rangeSubtitle(range: FloorRange): string {
  if (range === '15m') {
    return translate('components.floor.range.last15', 'last 15 min')
  }
  if (range === '60m') {
    return translate('components.floor.range.last60', 'last 60 min')
  }
  return translate('components.floor.range.todaySubtitle', 'today')
}

function FloorLegendDot({ className }: { className: string }): React.JSX.Element {
  return <span className={`size-1.5 rounded-full ${className}`} />
}

function FloorLegend(): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <FloorLegendDot className="bg-accent-foreground" />
        {translate('components.floor.legend.running', 'running')}
      </span>
      <span className="flex items-center gap-1">
        <FloorLegendDot className="bg-agent-question" />
        {translate('components.floor.legend.needsYou', 'needs you')}
      </span>
      <span className="flex items-center gap-1">
        <FloorLegendDot className="bg-status-success" />
        {translate('components.floor.legend.done', 'done')}
      </span>
      <span className="flex items-center gap-1">
        <FloorLegendDot className="border border-dashed border-muted-foreground bg-transparent" />
        {translate('components.floor.legend.unverifiable', 'unverifiable')}
      </span>
    </div>
  )
}

/** Floor mode: "what is everyone doing?" — agents as lanes on a time axis,
 *  grouped by host, with the selected run's detail on the right.
 *  See docs/redesign/three-mode-shell.md and the Floor section of
 *  docs/redesign/prototype/three-mode-prototype.html for the interaction spec. */
export default function FloorPage(): React.JSX.Element {
  const [range, setRange] = useState<FloorRange>('60m')
  const [selectedPaneKey, setSelectedPaneKey] = useState<string | null>(null)
  const { hosts, range: rangeWindow } = useFloorLanes(range)
  // Why: shares the same coarse clock useFloorLanes ticks on, so the run
  // panel's "Started Xm ago" stays current without its own impure Date.now() read.
  const now = useNow(15_000)

  const agentCount = useMemo(() => countFloorLanes(hosts), [hosts])
  const hostCount = hosts.length

  // Why: keep a valid selection as lanes appear/disappear — fall back to the
  // first lane rather than leaving the run panel pointed at a closed pane.
  useEffect(() => {
    if (selectedPaneKey && resolveFloorSelection(hosts, selectedPaneKey)) {
      return
    }
    setSelectedPaneKey(firstFloorLanePaneKey(hosts))
  }, [hosts, selectedPaneKey])

  const selection = resolveFloorSelection(hosts, selectedPaneKey)

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">{translate('components.floor.title', 'Floor')}</h2>
          <span className="text-xs text-muted-foreground">
            {translate('components.floor.subtitle', '{{agents}} on {{hosts}} · {{range}}', {
              agents: translate('components.floor.agentCount', '{{count}} agents', {
                count: agentCount
              }),
              hosts: translate('components.floor.hostCount', '{{count}} hosts', {
                count: hostCount
              }),
              range: rangeSubtitle(range)
            })}
          </span>
          <div className="flex-1" />
          <FloorLegend />
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={range}
            onValueChange={(value) => value && setRange(value as FloorRange)}
          >
            {rangeOptions().map((option) => (
              <ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <FloorLanes
          hosts={hosts}
          range={rangeWindow}
          selectedPaneKey={selectedPaneKey}
          onSelect={setSelectedPaneKey}
          onOpenInbox={openFloorLaneInInbox}
        />
      </div>
      <FloorRunPanel selection={selection} now={now} />
    </div>
  )
}
