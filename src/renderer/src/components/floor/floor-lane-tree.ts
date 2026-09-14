import type { FloorHost, FloorLane } from './floor-types'

export type FloorRawLane = FloorLane & {
  hostId: string
  hostLabel: string
  hostLive: boolean
}

/**
 * Nest lanes under their parent's `parentPaneKey`, but only within the same
 * host — a child whose parent lives on another host, or whose parent is
 * missing entirely (already filtered out, or never had a pane), stays a
 * top-level orphan lane instead of vanishing.
 */
function nestLanesWithinHost(lanes: FloorRawLane[]): FloorLane[] {
  const byPaneKey = new Map<string, FloorLane>(
    lanes.map((lane) => [lane.paneKey, { ...lane, children: [] as FloorLane[] }])
  )
  const roots: FloorLane[] = []
  for (const lane of lanes) {
    const node = byPaneKey.get(lane.paneKey)
    if (!node) {
      continue
    }
    const parent =
      lane.parentPaneKey && lane.parentPaneKey !== lane.paneKey
        ? byPaneKey.get(lane.parentPaneKey)
        : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/** Group lanes by host, nesting children within each host, hosts ordered
 *  local-first then alphabetically by label. Hosts with no lanes are omitted. */
export function groupFloorLanesByHost(lanes: FloorRawLane[]): FloorHost[] {
  const lanesByHost = new Map<string, FloorRawLane[]>()
  const hostMeta = new Map<string, { label: string; live: boolean }>()
  for (const lane of lanes) {
    if (!lanesByHost.has(lane.hostId)) {
      lanesByHost.set(lane.hostId, [])
      hostMeta.set(lane.hostId, { label: lane.hostLabel, live: lane.hostLive })
    }
    lanesByHost.get(lane.hostId)?.push(lane)
  }
  const hostIds = [...lanesByHost.keys()].sort((a, b) => {
    if (a === 'local' || b === 'local') {
      return a === b ? 0 : a === 'local' ? -1 : 1
    }
    return (hostMeta.get(a)?.label ?? a).localeCompare(hostMeta.get(b)?.label ?? b)
  })
  return hostIds.map((hostId) => {
    const meta = hostMeta.get(hostId)
    return {
      hostId,
      label: meta?.label ?? hostId,
      live: meta?.live ?? false,
      lanes: nestLanesWithinHost(lanesByHost.get(hostId) ?? [])
    }
  })
}
