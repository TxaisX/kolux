import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useNow } from '@/hooks/use-now'
import { buildExecutionHostRegistry } from '../../../../shared/execution-host-registry'
import { getWorktreeExecutionHostId } from '../../../../shared/execution-host'
import { buildFloorLanes } from './floor-lanes'
import type {
  FloorLanesResult,
  FloorRange,
  FloorTabInput,
  FloorWorktreeInput
} from './floor-types'

/** Bridges the live renderer store to the pure `buildFloorLanes` builder:
 *  resolves host id/label/liveness the same way the sidebar's host menu does
 *  (`buildExecutionHostRegistry`), flattens tabs/worktrees by id, and re-ticks
 *  on a coarse clock so running bars and "no update in Xm" text stay current. */
export function useFloorLanes(range: FloorRange): FloorLanesResult {
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const ptyIdsByTabId = useAppStore((s) => s.ptyIdsByTabId)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)
  const settings = useAppStore((s) => s.settings)
  const now = useNow(15_000)

  return useMemo(() => {
    const hostRegistry = buildExecutionHostRegistry({
      repos,
      settings,
      sshTargetLabels,
      sshConnectionStates,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId
    })
    const hostsById = new Map(hostRegistry.map((host) => [host.id, host]))

    const worktreesById: Record<string, FloorWorktreeInput> = {}
    for (const repo of repos) {
      for (const worktree of worktreesByRepo[repo.id] ?? []) {
        if (worktree.isArchived) {
          continue
        }
        const hostId = getWorktreeExecutionHostId(worktree, repo)
        const host = hostsById.get(hostId)
        worktreesById[worktree.id] = {
          id: worktree.id,
          repoId: repo.id,
          repoName: repo.displayName,
          name: worktree.displayName,
          branch: worktree.branch,
          hostId,
          hostLabel: host?.label ?? hostId,
          hostLive: host ? host.health === 'local' || host.health === 'available' : false
        }
      }
    }

    const tabsById: Record<string, FloorTabInput> = {}
    for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
      for (const tab of tabs) {
        tabsById[tab.id] = { id: tab.id, worktreeId, title: tab.title }
      }
    }

    return buildFloorLanes({
      statuses: agentStatusByPaneKey,
      tabsById,
      worktreesById,
      ptyIdsByTabId,
      range,
      now
    })
  }, [
    repos,
    worktreesByRepo,
    tabsByWorktree,
    agentStatusByPaneKey,
    ptyIdsByTabId,
    sshTargetLabels,
    sshConnectionStates,
    runtimeEnvironments,
    runtimeStatusByEnvironmentId,
    settings,
    range,
    now
  ])
}
