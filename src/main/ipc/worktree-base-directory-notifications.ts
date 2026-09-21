import type { BrowserWindow } from 'electron'
import type { WorktreeBaseCollectedChanges } from './worktree-base-directory-change-collector'
import type { WorktreeBaseWatchTarget } from './worktree-base-directory-event-filter'
import {
  refreshWorktreeHeadIdentities,
  type WorktreeHeadIdentityRefreshState
} from './worktree-head-identity-refresh'
import {
  EMPTY_HEAD_IDENTITY_SCOPE,
  FULL_HEAD_IDENTITY_SCOPE,
  mergeHeadIdentityScopes,
  type WorktreeHeadIdentityScope
} from './worktree-head-identity-scope'
import { notifyWorktreeGitStatusMetadataChanged } from './worktree-remote'
import { notifyWatchedWorktreeCatalogChanged } from './watched-worktree-catalog-notification'
import {
  isWorktreeMutationGated,
  onWorktreeMutationGateRelease
} from './worktree-refresh-mutation-gate'

export type WorktreeBaseNotificationWatch = WorktreeBaseWatchTarget & {
  mainWindow: BrowserWindow
  notifyTimer: ReturnType<typeof setTimeout> | null
  pendingStructureRepoIds: Set<string>
  pendingGitStatusRepoIds: Set<string>
  pendingHeadIdentityRepoIds: Set<string>
  pendingHeadIdentityScope: WorktreeHeadIdentityScope
  headIdentityRefresh: WorktreeHeadIdentityRefreshState
  disposed: boolean
}

const WATCH_DEBOUNCE_MS = 250

export function clearPendingWorktreeBaseNotifications(watch: WorktreeBaseNotificationWatch): void {
  watch.pendingStructureRepoIds.clear()
  watch.pendingGitStatusRepoIds.clear()
  watch.pendingHeadIdentityRepoIds.clear()
  watch.pendingHeadIdentityScope = EMPTY_HEAD_IDENTITY_SCOPE
}

export function supportsWorktreeHeadIdentityRefresh(watch: WorktreeBaseNotificationWatch): boolean {
  return watch.kind === 'git-common' && !watch.connectionId
}

export function scheduleWorktreeBaseNotification(
  watch: WorktreeBaseNotificationWatch,
  changes: Partial<Omit<WorktreeBaseCollectedChanges, 'overflow'>>
): void {
  if (watch.disposed || watch.mainWindow.isDestroyed()) {
    clearPendingWorktreeBaseNotifications(watch)
    return
  }
  for (const repoId of changes.structureRepoIds ?? []) {
    watch.pendingStructureRepoIds.add(repoId)
  }
  for (const repoId of changes.gitStatusRepoIds ?? []) {
    watch.pendingGitStatusRepoIds.add(repoId)
  }
  for (const repoId of changes.headIdentityRepoIds ?? []) {
    watch.pendingHeadIdentityRepoIds.add(repoId)
  }
  // Why: callers that cannot attribute the burst to specific worktrees (watcher
  // failure, event overflow) omit the scope entirely; that is a loss of
  // knowledge, so it must widen to a full re-read rather than narrow to nothing.
  watch.pendingHeadIdentityScope = mergeHeadIdentityScopes(
    watch.pendingHeadIdentityScope,
    changes.headIdentityScope ?? FULL_HEAD_IDENTITY_SCOPE
  )
  clearTimeout(watch.notifyTimer ?? undefined)
  watch.notifyTimer = setTimeout(() => {
    watch.notifyTimer = null
    if (watch.disposed || watch.mainWindow.isDestroyed()) {
      clearPendingWorktreeBaseNotifications(watch)
      return
    }
    const { held: heldStructureIds, free: freeStructureIds } = partitionGatedRepoIds(
      watch.pendingStructureRepoIds
    )
    const { held: heldGitStatusIds, free: freeGitStatusIds } = partitionGatedRepoIds(
      watch.pendingGitStatusRepoIds
    )
    const { held: heldHeadIdentityIds, free: freeHeadIdentityIds } = partitionGatedRepoIds(
      watch.pendingHeadIdentityRepoIds
    )
    const headIdentityScope = watch.pendingHeadIdentityScope
    clearPendingWorktreeBaseNotifications(watch)
    requeueHeldWorktreeBaseNotification(watch, {
      structureRepoIds: heldStructureIds,
      gitStatusRepoIds: heldGitStatusIds,
      headIdentityRepoIds: heldHeadIdentityIds,
      headIdentityScope
    })

    const pendingStructure = freeStructureIds
    const sourceControlRepoIds = new Set(
      [...freeGitStatusIds, ...freeHeadIdentityIds].filter(
        (repoId) => !pendingStructure.includes(repoId)
      )
    )
    // Why: an in-flight structural change for this repo — free now or still held for
    // the mutation gate — means its catalog refresh (now or on release) already carries
    // the fresh head, so a targeted head-identity emit here would be redundant.
    const emitHeadIdentities = pendingStructure.length === 0 && heldStructureIds.length === 0
    for (const repoId of pendingStructure) {
      notifyWatchedWorktreeCatalogChanged(watch.mainWindow, repoId, watch.connectionId)
    }
    for (const repoId of sourceControlRepoIds) {
      notifyWorktreeGitStatusMetadataChanged(watch.mainWindow, repoId)
    }
    if (
      supportsWorktreeHeadIdentityRefresh(watch) &&
      (pendingStructure.length > 0 || freeHeadIdentityIds.length > 0)
    ) {
      void refreshWorktreeHeadIdentities(
        watch,
        watch.headIdentityRefresh,
        emitHeadIdentities,
        headIdentityScope
      )
    }
  }, WATCH_DEBOUNCE_MS)
}

function partitionGatedRepoIds(repoIds: ReadonlySet<string>): {
  held: string[]
  free: string[]
} {
  const held: string[] = []
  const free: string[] = []
  for (const repoId of repoIds) {
    ;(isWorktreeMutationGated(repoId) ? held : free).push(repoId)
  }
  return { held, free }
}

/** Re-queues repo ids whose watcher notification was held for an in-flight create/remove,
 *  and arms a one-shot retry per held repo so the accumulated notification flushes once the
 *  mutation ends — bounded by the gate's own hard timeout, never held forever.
 *  ponytail: head-identity fanout (`refreshWorktreeHeadIdentities`) notifies every repo id
 *  sharing this watch's base directory when any of them changed, not just the held one — a
 *  gated repo co-located with a busy sibling can still see a head-identity notification
 *  during the gate. Upgrade to per-repo head-identity scoping if that co-location becomes common. */
function requeueHeldWorktreeBaseNotification(
  watch: WorktreeBaseNotificationWatch,
  held: {
    structureRepoIds: readonly string[]
    gitStatusRepoIds: readonly string[]
    headIdentityRepoIds: readonly string[]
    headIdentityScope: WorktreeHeadIdentityScope
  }
): void {
  const heldRepoIds = new Set([
    ...held.structureRepoIds,
    ...held.gitStatusRepoIds,
    ...held.headIdentityRepoIds
  ])
  if (heldRepoIds.size === 0) {
    return
  }
  for (const repoId of held.structureRepoIds) {
    watch.pendingStructureRepoIds.add(repoId)
  }
  for (const repoId of held.gitStatusRepoIds) {
    watch.pendingGitStatusRepoIds.add(repoId)
  }
  for (const repoId of held.headIdentityRepoIds) {
    watch.pendingHeadIdentityRepoIds.add(repoId)
  }
  if (held.headIdentityRepoIds.length > 0) {
    watch.pendingHeadIdentityScope = mergeHeadIdentityScopes(
      watch.pendingHeadIdentityScope,
      held.headIdentityScope
    )
  }
  for (const repoId of heldRepoIds) {
    onWorktreeMutationGateRelease(repoId, () => scheduleWorktreeBaseNotification(watch, {}))
  }
}
