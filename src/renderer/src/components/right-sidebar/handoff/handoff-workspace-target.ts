import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { buildWorkspaceHandoffKey } from '../../../../../shared/workspace-handoff-key'
import { parseWorkspaceKey } from '../../../../../shared/workspace-scope'
import { splitWorktreeIdForFilesystem } from '../../../../../shared/worktree/id'
import type { FolderWorkspace } from '../../../../../shared/folder-workspace-types'
import type { Worktree } from '../../../../../shared/worktree/types'

export type WorkspaceHandoffTarget = {
  /** Stable per-workspace key the store/IPC layer keys the document by. */
  key: string
  /** The active workspace id as `launchAgentInNewTab` expects it (worktree id or `folder:<id>`). */
  launchWorkspaceId: string
  name: string
  hostId: string
  path: string
}

/**
 * Resolves which workspace owns the handoff document. Pure so the host+path -> key mapping is
 * testable without the store: a git worktree's path comes from its id, a folder workspace's
 * from its own record, and either can carry a non-local `hostId` for SSH/WSL ownership.
 */
export function resolveWorkspaceHandoffTarget(input: {
  activeWorktreeId: string | null
  folderWorkspaces: readonly FolderWorkspace[] | null | undefined
  worktree: Pick<Worktree, 'displayName' | 'hostId'> | null | undefined
}): WorkspaceHandoffTarget | null {
  const { activeWorktreeId, folderWorkspaces, worktree } = input
  if (!activeWorktreeId) {
    return null
  }
  const scope = parseWorkspaceKey(activeWorktreeId)
  if (scope?.type === 'folder') {
    // Why: partially hydrated stores (and render tests) can lack the folder list entirely.
    const folderWorkspace = (folderWorkspaces ?? []).find(
      (entry) => entry.id === scope.folderWorkspaceId
    )
    if (!folderWorkspace) {
      return null
    }
    const hostId =
      folderWorkspace.executionHostId ??
      (folderWorkspace.connectionId ? `ssh:${folderWorkspace.connectionId}` : 'local')
    return {
      key: buildWorkspaceHandoffKey({ hostId, path: folderWorkspace.folderPath }),
      launchWorkspaceId: activeWorktreeId,
      name: folderWorkspace.name,
      hostId,
      path: folderWorkspace.folderPath
    }
  }
  const parsedId = splitWorktreeIdForFilesystem(activeWorktreeId)
  if (!parsedId || !worktree) {
    return null
  }
  const hostId = worktree.hostId ?? 'local'
  return {
    key: buildWorkspaceHandoffKey({ hostId, path: parsedId.worktreePath }),
    launchWorkspaceId: activeWorktreeId,
    name: worktree.displayName,
    hostId,
    path: parsedId.worktreePath
  }
}

export function useWorkspaceHandoffTarget(): WorkspaceHandoffTarget | null {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const worktree = useAppStore((s) =>
    activeWorktreeId ? s.getKnownWorktreeById(activeWorktreeId) : undefined
  )
  return useMemo(
    () => resolveWorkspaceHandoffTarget({ activeWorktreeId, folderWorkspaces, worktree }),
    [activeWorktreeId, folderWorkspaces, worktree]
  )
}
