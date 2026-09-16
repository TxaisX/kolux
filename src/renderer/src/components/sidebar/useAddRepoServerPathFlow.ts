import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { markOnboardingProjectAdded } from '@/lib/onboarding-project-checklist'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { AddRepoExistingWorkspaceSource } from '../../../../shared/telemetry-events'
import type { Repo } from '../../../../shared/repo-types'
import type { WorktreeFetchOptions } from '@/store/slices/worktree-helpers'
import { worktreeRefreshOptions } from './add-repo-runtime-owner'
import type { ExecutionHostId } from '../../../../shared/execution-host'

export function useAddRepoServerPathFlow({
  addRepoPath,
  activeRuntimeEnvironmentId,
  closeModal,
  fetchWorktrees,
  onGitRepoReady,
  setAddProjectBusyLabel
}: {
  addRepoPath: (
    path: string,
    kind?: 'git' | 'folder',
    options?: { runtimeEnvironmentId?: string | null }
  ) => Promise<Repo | null>
  activeRuntimeEnvironmentId: string | null
  closeModal: () => void
  fetchWorktrees: (repoId: string, options?: WorktreeFetchOptions) => Promise<unknown>
  onGitRepoReady: (
    repoId: string,
    source: AddRepoExistingWorkspaceSource,
    executionHostId?: ExecutionHostId
  ) => Promise<void>
  setAddProjectBusyLabel: (label: string | null) => void
}): {
  serverPath: string
  isAddingServerPath: boolean
  setServerPath: Dispatch<SetStateAction<string>>
  resetServerPathFlow: () => void
  handleAddServerPath: (kind: 'git' | 'folder') => Promise<void>
} {
  const [serverPath, setServerPath] = useState('')
  const [isAddingServerPath, setIsAddingServerPath] = useState(false)
  const serverAddGenRef = useRef(0)

  const resetServerPathFlow = useCallback((): void => {
    serverAddGenRef.current++
    setServerPath('')
    setIsAddingServerPath(false)
  }, [])

  const handleAddServerPath = useCallback(
    async (kind: 'git' | 'folder'): Promise<void> => {
      const path = serverPath.trim()
      if (!path) {
        return
      }
      const gen = ++serverAddGenRef.current
      setIsAddingServerPath(true)
      setAddProjectBusyLabel(kind === 'git' ? 'Opening project...' : 'Opening folder...')
      try {
        const repo = await addRepoPath(path, kind, {
          runtimeEnvironmentId: activeRuntimeEnvironmentId
        })
        if (gen !== serverAddGenRef.current) {
          return
        }
        if (repo && isGitRepoKind(repo)) {
          // Why: once the repo exists, a transient non-authoritative refresh
          // should fall through to project reveal instead of leaving the add flow open.
          const ownerOptions = worktreeRefreshOptions(activeRuntimeEnvironmentId ?? null)
          await fetchWorktrees(repo.id, ownerOptions)
          if (gen !== serverAddGenRef.current) {
            return
          }
          await onGitRepoReady(repo.id, 'runtime_server_path', ownerOptions.executionHostId)
        } else if (repo) {
          // Why: folder repos skip the Git default-checkout handoff; their synthetic
          // root workspace is opened by the folder add flow.
          await markOnboardingProjectAdded('addedFolder')
          closeModal()
        }
      } finally {
        if (gen === serverAddGenRef.current) {
          setIsAddingServerPath(false)
          setAddProjectBusyLabel(null)
        }
      }
    },
    [
      addRepoPath,
      activeRuntimeEnvironmentId,
      closeModal,
      fetchWorktrees,
      onGitRepoReady,
      serverPath,
      setAddProjectBusyLabel
    ]
  )

  return { serverPath, isAddingServerPath, setServerPath, resetServerPathFlow, handleAddServerPath }
}
