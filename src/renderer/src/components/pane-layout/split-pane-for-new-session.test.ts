import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { createTabsSliceMockApi } from '@/store/slices/tabs-slice-test-harness'
import { createTestStore } from '@/store/slices/store-test-helpers'
import { collectLeafGroupIds } from './tidy-layout'
import { splitPaneForNewSession } from './split-pane-for-new-session'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

createTabsSliceMockApi()

const WT = 'repo1::/tmp/feature'

describe('splitPaneForNewSession', () => {
  let store: ReturnType<typeof createTestStore>

  beforeEach(() => {
    store = createTestStore()
  })

  it('gives each new session its own pane and keeps the grid balanced', () => {
    store.getState().createUnifiedTab(WT, 'terminal')
    const source = store.getState().groupsByWorktree[WT][0].id

    const second = splitPaneForNewSession(store.getState, WT, source)
    const third = splitPaneForNewSession(store.getState, WT, source)
    const fourth = splitPaneForNewSession(store.getState, WT, source)

    const layout = store.getState().layoutByWorktree[WT]!
    expect(new Set([source, second, third, fourth]).size).toBe(4)
    expect(collectLeafGroupIds(layout)).toHaveLength(4)
    // Why: four panes means a 2x2 grid, not one row of ever-thinner splits.
    expect(layout.type).toBe('split')
    expect(layout.type === 'split' && layout.first.type).toBe('split')
    expect(store.getState().activeGroupIdByWorktree[WT]).toBe(fourth)
  })

  it('falls back to the source group when nothing can be split', () => {
    const stubbed = {
      layoutByWorktree: {},
      createEmptySplitGroup: () => null,
      setTabGroupLayout: vi.fn()
    }
    expect(splitPaneForNewSession(() => stubbed, WT, 'g-1')).toBe('g-1')
    expect(stubbed.setTabGroupLayout).not.toHaveBeenCalled()
  })
})
