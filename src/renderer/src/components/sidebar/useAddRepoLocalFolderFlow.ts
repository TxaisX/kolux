import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import type { AddRepoExistingWorkspaceSource } from '../../../../shared/telemetry-events'
import type { Repo } from '../../../../shared/repo-types'
import type { WorktreeFetchOptions } from '@/store/slices/worktree-helpers'
import type { RepoSlice } from '@/store/repos/repo-state'
import { translate } from '@/i18n/i18n'
import { worktreeRefreshOptions } from './add-repo-runtime-owner'
import type { ExecutionHostId } from '../../../../shared/execution-host'

type LocalPathAddResult = { status: 'completed'; repo: Repo } | { status: 'cancelled' | 'paused' }

type LocalPathAddMode = 'single' | 'batch'

/**
 * Adds exactly the folder the user picked. A folder is never scanned for the
 * repositories inside it: a git repo opens as a project, anything else goes
 * through the folder-workspace confirmation.
 */
export function useAddRepoLocalFolderFlow({
  isOpen,
  droppedLocalPath,
  activeRuntimeEnvironmentId,
  addRepoPath,
  closeModal,
  fetchWorktrees,
  onGitRepoReady,
  setIsAdding,
  setAddProjectBusyLabel
}: {
  isOpen: boolean
  droppedLocalPath: string
  activeRuntimeEnvironmentId: string | null | undefined
  addRepoPath: RepoSlice['addRepoPath']
  closeModal: () => void
  fetchWorktrees: (repoId: string, options?: WorktreeFetchOptions) => Promise<unknown>
  onGitRepoReady: (
    repoId: string,
    source: AddRepoExistingWorkspaceSource,
    executionHostId?: ExecutionHostId
  ) => Promise<void>
  setIsAdding: (isAdding: boolean) => void
  setAddProjectBusyLabel: (label: string | null) => void
}): {
  handleBrowse: () => Promise<void>
  resetLocalFolderFlow: () => void
} {
  const localAddGenRef = useRef(0)
  const droppedLocalPathHandledRef = useRef<string | null>(null)

  const resetLocalFolderFlow = useCallback((): void => {
    localAddGenRef.current++
    droppedLocalPathHandledRef.current = null
  }, [])

  const addLocalPathForGeneration = useCallback(
    async (
      path: string,
      source: AddRepoExistingWorkspaceSource,
      gen: number,
      mode: LocalPathAddMode = 'single'
    ): Promise<LocalPathAddResult> => {
      if (activeRuntimeEnvironmentId?.trim()) {
        toast.error(
          translate(
            'auto.components.sidebar.useAddRepoLocalFolderFlow.7ab10e4974',
            'Use a host path to add projects from a remote host.'
          )
        )
        closeModal()
        return { status: 'paused' }
      }
      setAddProjectBusyLabel('Opening project...')
      const repo = await addRepoPath(path, undefined, {
        runtimeEnvironmentId: activeRuntimeEnvironmentId ?? null
      })
      if (gen !== localAddGenRef.current) {
        return { status: 'cancelled' }
      }
      if (!repo) {
        return { status: 'paused' }
      }
      if (isGitRepoKind(repo)) {
        // Why: a transient non-authoritative refresh must not strand a persisted repo.
        const ownerOptions = worktreeRefreshOptions(activeRuntimeEnvironmentId ?? null)
        await fetchWorktrees(repo.id, ownerOptions)
        if (gen !== localAddGenRef.current) {
          return { status: 'cancelled' }
        }
        if (mode === 'batch') {
          return { status: 'completed', repo }
        }
        await onGitRepoReady(repo.id, source, ownerOptions.executionHostId)
      } else {
        // Why: folder repos skip the Git default-checkout handoff and activate
        // their synthetic root workspace in the folder add flow.
        closeModal()
      }
      return { status: 'completed', repo }
    },
    [
      activeRuntimeEnvironmentId,
      addRepoPath,
      closeModal,
      fetchWorktrees,
      onGitRepoReady,
      setAddProjectBusyLabel
    ]
  )

  const handleAddLocalPath = useCallback(
    async (
      path: string,
      source: AddRepoExistingWorkspaceSource,
      mode: LocalPathAddMode = 'single'
    ): Promise<LocalPathAddResult> => {
      const gen = ++localAddGenRef.current
      setIsAdding(true)
      try {
        return await addLocalPathForGeneration(path, source, gen, mode)
      } finally {
        if (gen === localAddGenRef.current) {
          setIsAdding(false)
          setAddProjectBusyLabel(null)
        }
      }
    },
    [addLocalPathForGeneration, setAddProjectBusyLabel, setIsAdding]
  )

  const handleAddLocalPaths = useCallback(
    async (paths: string[], source: AddRepoExistingWorkspaceSource, gen: number): Promise<void> => {
      const gitRepoIds: string[] = []
      const shouldDeferGitRepoReady = paths.length > 1
      for (const path of paths) {
        const result = await addLocalPathForGeneration(
          path,
          source,
          gen,
          shouldDeferGitRepoReady ? 'batch' : 'single'
        )
        if (result.status !== 'completed') {
          return
        }
        if (isGitRepoKind(result.repo)) {
          gitRepoIds.push(result.repo.id)
        }
      }
      if (gen !== localAddGenRef.current) {
        return
      }
      if (shouldDeferGitRepoReady && gitRepoIds.length > 0) {
        await onGitRepoReady(
          gitRepoIds[0],
          source,
          worktreeRefreshOptions(activeRuntimeEnvironmentId ?? null).executionHostId
        )
      }
    },
    [activeRuntimeEnvironmentId, addLocalPathForGeneration, onGitRepoReady]
  )

  useEffect(() => {
    if (!isOpen || !droppedLocalPath) {
      return
    }
    if (droppedLocalPathHandledRef.current === droppedLocalPath) {
      return
    }
    droppedLocalPathHandledRef.current = droppedLocalPath
    void handleAddLocalPath(droppedLocalPath, 'local_folder_picker')
  }, [droppedLocalPath, handleAddLocalPath, isOpen])

  const handleBrowse = useCallback(async (): Promise<void> => {
    const gen = ++localAddGenRef.current
    setIsAdding(true)
    setAddProjectBusyLabel('Choose a folder...')
    try {
      const paths = await window.api.repos.pickFolders()
      if (paths.length === 0 || gen !== localAddGenRef.current) {
        return
      }
      await handleAddLocalPaths(paths, 'local_folder_picker', gen)
    } finally {
      if (gen === localAddGenRef.current) {
        setIsAdding(false)
        setAddProjectBusyLabel(null)
      }
    }
  }, [handleAddLocalPaths, setAddProjectBusyLabel, setIsAdding])

  return { handleBrowse, resetLocalFolderFlow }
}
