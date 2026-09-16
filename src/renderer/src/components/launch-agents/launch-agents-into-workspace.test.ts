import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { createTabsSliceMockApi } from '@/store/slices/tabs-slice-test-harness'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { collectLeafGroupIds } from '../pane-layout/tidy-layout'

const mocks = vi.hoisted(() => ({
  launchAgentInNewTab: vi.fn(),
  store: null as ReturnType<typeof createTestStore> | null
}))

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: mocks.launchAgentInNewTab
}))
// Why: the module under test reads the app store; point it at the per-test store.
vi.mock('@/store', () => ({
  useAppStore: { getState: () => mocks.store!.getState() }
}))

createTabsSliceMockApi()

const WT = 'repo1::/tmp/feature'

describe('launchAgentsIntoWorkspace', () => {
  beforeEach(() => {
    mocks.store = createTestStore()
    mocks.launchAgentInNewTab.mockReset()
    // Why: mirror the real funnel, which creates the tab inside the group it is handed.
    mocks.launchAgentInNewTab.mockImplementation(({ worktreeId, groupId, agent }) => {
      const tab = mocks.store!.getState().createTab(worktreeId, groupId, undefined, {
        launchAgent: agent
      })
      return { tabId: tab.id, startupPlan: {}, pasteDraftAfterLaunch: false }
    })
  })

  it('adds one pane per session to the existing workspace and regrids', async () => {
    const { launchAgentsIntoWorkspace } = await import('./launch-agents-into-workspace')
    mocks.store!.getState().createUnifiedTab(WT, 'terminal')

    const launched = launchAgentsIntoWorkspace(WT, [
      { agent: 'claude', prompt: 'Lead: plan it' },
      { agent: 'claude', prompt: 'Builder: do it' },
      { agent: 'codex', prompt: '' }
    ])

    expect(launched).toBe(3)
    const state = mocks.store!.getState()
    const leafIds = collectLeafGroupIds(state.layoutByWorktree[WT]!)
    expect(leafIds).toHaveLength(4)
    expect(state.groupsByWorktree[WT].every((group) => group.tabOrder.length === 1)).toBe(true)
    expect(mocks.launchAgentInNewTab).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ worktreeId: WT, agent: 'claude', prompt: 'Builder: do it' })
    )
    // Why: four leaves means a 2x2 grid, not a single row of ever-thinner splits.
    const layout = state.layoutByWorktree[WT]!
    expect(layout.type).toBe('split')
    expect(layout.type === 'split' && layout.first.type).toBe('split')
  })

  it('drops the empty pane when a session cannot be launched', async () => {
    const { launchAgentsIntoWorkspace } = await import('./launch-agents-into-workspace')
    mocks.store!.getState().createUnifiedTab(WT, 'terminal')
    mocks.launchAgentInNewTab.mockReturnValueOnce(null)

    const launched = launchAgentsIntoWorkspace(WT, [{ agent: 'claude', prompt: '' }])

    expect(launched).toBe(0)
    expect(collectLeafGroupIds(mocks.store!.getState().layoutByWorktree[WT]!)).toHaveLength(1)
  })

  it('lets the first session create the pane in a workspace that has none', async () => {
    const { launchAgentsIntoWorkspace } = await import('./launch-agents-into-workspace')

    const launched = launchAgentsIntoWorkspace(WT, [{ agent: 'claude', prompt: '' }])

    expect(launched).toBe(1)
    expect(mocks.launchAgentInNewTab).toHaveBeenCalledWith(
      expect.not.objectContaining({ groupId: expect.anything() })
    )
    expect(mocks.store!.getState().groupsByWorktree[WT]).toHaveLength(1)
  })
})
