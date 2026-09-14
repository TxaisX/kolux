import { describe, expect, it, vi } from 'vitest'
import type {
  PendingWorktreeCreation,
  WorktreeCreationRequest
} from '@/lib/pending-worktree-creation'

const store = {
  settings: { activeRuntimeEnvironmentId: null as string | null },
  activeView: 'terminal' as 'terminal' | 'tasks',
  activePendingCreationId: 'creation-1' as string | null,
  repos: [{ id: 'repo-1', connectionId: null }],
  pendingWorktreeCreations: {} as Record<string, PendingWorktreeCreation>,
  beginPendingWorktreeCreation: vi.fn((entry: PendingWorktreeCreation) => {
    store.pendingWorktreeCreations[entry.creationId] = entry
    if (entry.request.revealOnStart !== false) {
      store.activePendingCreationId = entry.creationId
    }
  }),
  updatePendingWorktreeCreation: vi.fn(
    (creationId: string, patch: Partial<PendingWorktreeCreation>) => {
      const entry = store.pendingWorktreeCreations[creationId]
      if (entry) {
        store.pendingWorktreeCreations[creationId] = { ...entry, ...patch }
      }
    }
  ),
  removePendingWorktreeCreation: vi.fn((creationId: string) => {
    delete store.pendingWorktreeCreations[creationId]
  }),
  setActivePendingWorktreeCreation: vi.fn(),
  setActiveView: vi.fn(),
  setSidebarOpen: vi.fn(),
  createWorktree: vi.fn(),
  tabsByWorktree: {} as Record<string, { id: string }[]>,
  unifiedTabsByWorktree: {}
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => store }
}))

vi.mock('@/lib/browser-uuid', () => ({
  createBrowserUuid: () => 'creation-1'
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: vi.fn()
}))

vi.mock('@/lib/worktree-initial-terminal-seeding', () => ({
  ensureWorktreeHasInitialTerminal: vi.fn(() => 'tab-1')
}))

vi.mock('@/lib/workspace-activation-terminal-focus', () => ({
  queueWorkspaceActivationTerminalFocus: vi.fn()
}))

vi.mock('@/lib/new-workspace', () => ({
  ensureAgentStartupInTerminal: vi.fn()
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() }
}))

vi.mock('@/lib/ephemeral-vm-workspace-target', () => ({
  prepareEphemeralVmWorkspaceTarget: vi.fn()
}))

import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { runBackgroundWorktreeCreation } from './worktree-creation-flow'

function makeRequest(overrides: Partial<WorktreeCreationRequest> = {}): WorktreeCreationRequest {
  return {
    repoId: 'repo-1',
    name: 'feature',
    setupDecision: 'inherit',
    agent: null,
    pendingFirstAgentMessageRename: false,
    note: '',
    startupPlan: null,
    quickPrompt: '',
    quickTelemetry: null,
    ...overrides
  }
}

async function flushAsyncWorktreeCreation(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('revealOnStart:false background batch launches', () => {
  it('does not flip activeView, open the sidebar, or claim the active pending creation', () => {
    vi.clearAllMocks()
    store.activeView = 'terminal'
    store.activePendingCreationId = null
    store.pendingWorktreeCreations = {}
    store.createWorktree.mockImplementation(() => new Promise(() => {}))

    runBackgroundWorktreeCreation(makeRequest({ revealOnStart: false }))

    expect(store.setActiveView).not.toHaveBeenCalled()
    expect(store.setSidebarOpen).not.toHaveBeenCalled()
    expect(store.activePendingCreationId).toBeNull()
  })

  it('never activates on completion, even once a sibling creation nulls activePendingCreationId', async () => {
    // Why: this is bug #3's root cause — a batch launch shares activeView/
    // activePendingCreationId across N concurrent creations, so one sibling's
    // completion nulling activePendingCreationId used to hijack another
    // creation into activateAndRevealWorktree's gate/adopt race instead of the
    // plain background-terminal path every other launched worktree relies on.
    vi.clearAllMocks()
    store.activeView = 'terminal'
    store.activePendingCreationId = 'creation-1'
    store.pendingWorktreeCreations = {}
    let resolveCreate!: (result: {
      worktree: { id: string; repoId: string }
      startupTerminal: { tabId: string; spawned: true }
    }) => void
    store.createWorktree.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCreate = resolve
      })
    )

    const creationId = runBackgroundWorktreeCreation(makeRequest({ revealOnStart: false }))

    // Why: a sibling creation in the same batch completing first (or the user
    // moving on) clears the shared pointer while this one is still in flight.
    store.activePendingCreationId = null
    resolveCreate({
      worktree: { id: 'wt-1', repoId: 'repo-1' },
      startupTerminal: { tabId: 'agent-tab', spawned: true }
    })
    await flushAsyncWorktreeCreation()

    expect(creationId).toBe('creation-1')
    expect(activateAndRevealWorktree).not.toHaveBeenCalled()
  })

  it('still hands main the startup command, with the no-focus flag set', async () => {
    // Why: an earlier fix withheld `startup` entirely to dodge main's hardcoded
    // `activate: true` (worktree-remote.ts) — that stopped the grid bounce but
    // also stopped every claude.exe from spawning, since the renderer never
    // mounts a pane to trigger its own fallback pty spawn for a grid-only view.
    // The real fix threads `focusStartupTerminal: false` through instead, so
    // main still spawns the agent but skips focusing/revealing it.
    vi.clearAllMocks()
    store.activeView = 'agent-grid' as never
    store.activePendingCreationId = null
    store.pendingWorktreeCreations = {}
    store.createWorktree.mockResolvedValueOnce({
      worktree: { id: 'wt-1', repoId: 'repo-1' },
      startupTerminal: { tabId: 'agent-tab', spawned: true }
    })

    runBackgroundWorktreeCreation(
      makeRequest({
        revealOnStart: false,
        agent: 'claude',
        startup: { command: 'claude' },
        startupPlan: {
          agent: 'claude',
          launchCommand: 'claude',
          expectedProcess: 'claude',
          followupPrompt: null,
          launchConfig: { agentArgs: '', agentEnv: {} }
        } as never
      })
    )
    await flushAsyncWorktreeCreation()

    expect(store.createWorktree).toHaveBeenCalledTimes(1)
    const createCall = store.createWorktree.mock.calls[0] as unknown[]
    expect(createCall[16]).toEqual({ command: 'claude' })
    expect(createCall[25]).toEqual(expect.objectContaining({ focusStartupTerminal: false }))
    expect(activateAndRevealWorktree).not.toHaveBeenCalled()
  })

  it('leaves the focus flag unset (main keeps focusing) for an ordinary reveal-on-start request', async () => {
    vi.clearAllMocks()
    store.activeView = 'terminal'
    store.activePendingCreationId = 'creation-1'
    store.pendingWorktreeCreations = {}
    store.createWorktree.mockResolvedValueOnce({
      worktree: { id: 'wt-1', repoId: 'repo-1' }
    })
    vi.mocked(activateAndRevealWorktree).mockReturnValueOnce({ primaryTabId: 'tab-1' })

    runBackgroundWorktreeCreation(makeRequest({ startup: { command: 'claude' } }))
    await flushAsyncWorktreeCreation()

    const createCall = store.createWorktree.mock.calls[0] as unknown[]
    expect(createCall[25]).toEqual(
      expect.not.objectContaining({ focusStartupTerminal: expect.anything() })
    )
  })
})
