import type { FloorHost, FloorLane } from './floor-types'

export type FloorSelection = {
  lane: FloorLane
  root: FloorLane
  children: FloorLane[]
  hostId: string
  hostLabel: string
}

type FloorLaneIndexEntry = { lane: FloorLane; root: FloorLane; hostId: string; hostLabel: string }

function flattenLanes(
  lanes: FloorLane[],
  hostId: string,
  hostLabel: string,
  out: Map<string, FloorLaneIndexEntry>,
  root?: FloorLane
): void {
  for (const lane of lanes) {
    const laneRoot = root ?? lane
    out.set(lane.paneKey, { lane, root: laneRoot, hostId, hostLabel })
    if (lane.children.length > 0) {
      flattenLanes(lane.children, hostId, hostLabel, out, laneRoot)
    }
  }
}

/** Find a lane by paneKey anywhere in the host tree, along with its run's
 *  root lane and sibling children — what the run panel needs regardless of
 *  whether the user selected the root or one of its workers. */
export function resolveFloorSelection(hosts: FloorHost[], paneKey: string | null): FloorSelection | null {
  if (!paneKey) {
    return null
  }
  const index = new Map<string, FloorLaneIndexEntry>()
  for (const host of hosts) {
    flattenLanes(host.lanes, host.hostId, host.label, index)
  }
  const entry = index.get(paneKey)
  return entry
    ? {
        lane: entry.lane,
        root: entry.root,
        children: entry.root.children,
        hostId: entry.hostId,
        hostLabel: entry.hostLabel
      }
    : null
}

/** The first top-level lane on the Floor, used as the default selection. */
export function firstFloorLanePaneKey(hosts: FloorHost[]): string | null {
  return hosts[0]?.lanes[0]?.paneKey ?? null
}

function countLanes(lanes: FloorLane[]): number {
  return lanes.reduce((sum, lane) => sum + 1 + countLanes(lane.children), 0)
}

/** Total agent count across every host, including nested children. */
export function countFloorLanes(hosts: FloorHost[]): number {
  return hosts.reduce((sum, host) => sum + countLanes(host.lanes), 0)
}
