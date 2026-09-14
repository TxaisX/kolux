import { describe, expect, it, vi } from 'vitest'
import { createTestStore } from '../slices/store-test-helpers'
import {
  installReposRuntimeRoutingHarness,
  localRepo,
  reposAdd,
  reposPickFolder
} from '../slices/repos-runtime-routing-fixture'

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  }
}))

installReposRuntimeRoutingHarness()

// Pins the addRepo() contract other callers (Landing, launch-agents) depend on: it now routes
// through the Add repo dialog instead of the native picker, but still resolves the same way —
// the added Repo once the dialog finishes, or null on cancel / non-git-folder handoff.
describe('addRepo() dialog-routing contract', () => {
  it('opens the Add repo dialog instead of the native folder picker on a local host', () => {
    const store = createTestStore()

    void store.getState().addRepo()

    expect(store.getState().activeModal).toBe('add-repo')
    expect(reposPickFolder).not.toHaveBeenCalled()
  })

  it('resolves with the added repo once the dialog finishes adding one', async () => {
    const store = createTestStore()
    const addRepoPromise = store.getState().addRepo()

    store.getState().resolveAddRepoDialogRequest(localRepo)

    await expect(addRepoPromise).resolves.toEqual(localRepo)
  })

  it('resolves null when the dialog is cancelled', async () => {
    const store = createTestStore()
    const addRepoPromise = store.getState().addRepo()

    store.getState().resolveAddRepoDialogRequest(null)

    await expect(addRepoPromise).resolves.toBeNull()
  })

  it('resolves null when addRepoPath hands off to the non-git-folder confirm dialog', async () => {
    reposAdd.mockResolvedValue({ error: 'Not a valid git repository at /some/path' })
    const store = createTestStore()
    const addRepoPromise = store.getState().addRepo()

    await expect(store.getState().addRepoPath('/some/path')).resolves.toBeNull()

    expect(store.getState().activeModal).toBe('confirm-non-git-folder')
    await expect(addRepoPromise).resolves.toBeNull()
  })

  it('settles a stale pending request with null before opening a fresh one', async () => {
    const store = createTestStore()
    const firstAddRepoPromise = store.getState().addRepo()

    const secondAddRepoPromise = store.getState().addRepo()

    await expect(firstAddRepoPromise).resolves.toBeNull()
    store.getState().resolveAddRepoDialogRequest(localRepo)
    await expect(secondAddRepoPromise).resolves.toEqual(localRepo)
  })
})
