import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ReactModule from 'react'
import type { Repo } from '../../../../shared/repo-types'

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>()
  return {
    ...actual,
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useEffect: vi.fn(),
    useRef: <T>(value: T) => ({ current: value })
  }
})

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn()
  }
}))

function makeRepo(path: string, kind: Repo['kind'] = 'git'): Repo {
  const id = path.split('/').pop() ?? path
  return {
    id,
    path,
    displayName: id,
    badgeColor: '#999999',
    addedAt: 1,
    kind
  }
}

describe('useAddRepoLocalFolderFlow', () => {
  const addRepoPath = vi.fn()
  const closeModal = vi.fn()
  const fetchWorktrees = vi.fn()
  const onGitRepoReady = vi.fn()
  const setIsAdding = vi.fn()
  const setAddProjectBusyLabel = vi.fn()
  const pickFolders = vi.fn()

  const flowArgs = () => ({
    isOpen: true,
    droppedLocalPath: '',
    activeRuntimeEnvironmentId: null,
    addRepoPath,
    closeModal,
    fetchWorktrees,
    onGitRepoReady,
    setIsAdding,
    setAddProjectBusyLabel
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('window', {
      api: {
        repos: {
          pickFolders
        }
      }
    })
    addRepoPath.mockImplementation(async (path: string) => makeRepo(path))
    fetchWorktrees.mockResolvedValue(true)
    onGitRepoReady.mockResolvedValue(undefined)
  })

  it('adds every selected local folder and completes one default-checkout handoff', async () => {
    pickFolders.mockResolvedValue(['/projects/alpha', '/projects/beta'])
    const { useAddRepoLocalFolderFlow } = await import('./useAddRepoLocalFolderFlow')

    const { handleBrowse } = useAddRepoLocalFolderFlow(flowArgs())

    await handleBrowse()

    expect(pickFolders).toHaveBeenCalledTimes(1)
    expect(addRepoPath).toHaveBeenCalledTimes(2)
    expect(addRepoPath).toHaveBeenNthCalledWith(1, '/projects/alpha', undefined, {
      runtimeEnvironmentId: null
    })
    expect(addRepoPath).toHaveBeenNthCalledWith(2, '/projects/beta', undefined, {
      runtimeEnvironmentId: null
    })
    expect(fetchWorktrees).toHaveBeenCalledWith('alpha', {
      requireAuthoritative: true,
      executionHostId: 'local'
    })
    expect(fetchWorktrees).toHaveBeenCalledWith('beta', {
      requireAuthoritative: true,
      executionHostId: 'local'
    })
    expect(onGitRepoReady).toHaveBeenCalledTimes(1)
    expect(onGitRepoReady).toHaveBeenCalledWith('alpha', 'local_folder_picker', 'local')
  })

  it('opens only the picked folder, never a repository scan, and closes after a folder add', async () => {
    pickFolders.mockResolvedValue(['/projects/monorepo'])
    addRepoPath.mockResolvedValueOnce(makeRepo('/projects/monorepo', 'folder'))
    const { useAddRepoLocalFolderFlow } = await import('./useAddRepoLocalFolderFlow')

    const { handleBrowse } = useAddRepoLocalFolderFlow(flowArgs())

    await handleBrowse()

    expect(addRepoPath).toHaveBeenCalledTimes(1)
    expect(addRepoPath).toHaveBeenCalledWith('/projects/monorepo', undefined, {
      runtimeEnvironmentId: null
    })
    expect(setAddProjectBusyLabel).not.toHaveBeenCalledWith('Scanning for repositories...')
    expect(fetchWorktrees).not.toHaveBeenCalled()
    expect(onGitRepoReady).not.toHaveBeenCalled()
    expect(closeModal).toHaveBeenCalledTimes(1)
  })

  it('stops the batch when an add pauses on a confirmation', async () => {
    pickFolders.mockResolvedValue(['/projects/plain', '/projects/later'])
    addRepoPath.mockResolvedValueOnce(null)
    const { useAddRepoLocalFolderFlow } = await import('./useAddRepoLocalFolderFlow')

    const { handleBrowse } = useAddRepoLocalFolderFlow(flowArgs())

    await handleBrowse()

    expect(addRepoPath).toHaveBeenCalledTimes(1)
    expect(onGitRepoReady).not.toHaveBeenCalled()
  })

  it('drops a local add completion after host-scoped reset', async () => {
    pickFolders.mockResolvedValue(['/projects/stale'])
    let resolveAdd!: (repo: Repo) => void
    addRepoPath.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAdd = resolve
      })
    )
    const { useAddRepoLocalFolderFlow } = await import('./useAddRepoLocalFolderFlow')
    const flow = useAddRepoLocalFolderFlow(flowArgs())

    const adding = flow.handleBrowse()
    await vi.waitFor(() => expect(addRepoPath).toHaveBeenCalled())
    flow.resetLocalFolderFlow()
    resolveAdd(makeRepo('/projects/stale'))
    await adding

    expect(fetchWorktrees).not.toHaveBeenCalled()
    expect(onGitRepoReady).not.toHaveBeenCalled()
  })
})
