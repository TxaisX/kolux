// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { SharedCheckoutSeatRequest } from './launch-agents-requests'

const mocks = vi.hoisted(() => ({
  createTab: vi.fn(),
  queueTabStartupCommand: vi.fn(),
  openTerminalWindowForSharedCheckoutSeat: vi.fn(),
  buildQuickComposerStartup: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      createTab: mocks.createTab,
      queueTabStartupCommand: mocks.queueTabStartupCommand
    })
  }
}))
vi.mock('./launch-agents-window-handoff', () => ({
  openTerminalWindowForSharedCheckoutSeat: mocks.openTerminalWindowForSharedCheckoutSeat
}))
vi.mock('@/hooks/composer-state/quick-startup-plan', () => ({
  buildQuickComposerStartup: mocks.buildQuickComposerStartup
}))

// eslint-disable-next-line import/first -- mocks above must register before the module under test loads
import { runSharedCheckoutLaunch } from './launch-agents-shared-checkout'

const CLAUDE = 'claude' as TuiAgent
const WORKTREE = 'wt-project'

function seat(overrides: Partial<SharedCheckoutSeatRequest> = {}): SharedCheckoutSeatRequest {
  return {
    agent: CLAUDE,
    model: null,
    prompt: 'ship it',
    agentLaunchRoute: 'terminal-tui',
    ...overrides
  }
}

describe('runSharedCheckoutLaunch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTab.mockImplementation((_worktreeId: string, groupId: string | undefined) => ({
      id: `tab-${mocks.createTab.mock.calls.length}`,
      groupId
    }))
    mocks.buildQuickComposerStartup.mockReturnValue({
      startupPlan: {
        launchCommand: 'claude',
        env: undefined,
        launchConfig: undefined,
        sessionOptions: undefined
      },
      backendStartup: undefined,
      telemetry: null
    })
  })

  it('opens one OS window per seat, all in the project worktree, and creates no worktree or pane group', () => {
    const seats = [seat(), seat({ agent: CLAUDE, model: 'opus' }), seat()]
    runSharedCheckoutLaunch(WORKTREE, seats, {} as never)

    expect(mocks.createTab).toHaveBeenCalledTimes(3)
    // Why: every call targets the SAME project worktree, and no group id is
    // ever passed — proves no split/pane group is created for these seats.
    for (const call of mocks.createTab.mock.calls) {
      expect(call[0]).toBe(WORKTREE)
      expect(call[1]).toBeUndefined()
    }

    expect(mocks.openTerminalWindowForSharedCheckoutSeat).toHaveBeenCalledTimes(3)
    for (const call of mocks.openTerminalWindowForSharedCheckoutSeat.mock.calls) {
      expect(call[0]).toBe(WORKTREE)
    }
    const openedTabIds = mocks.openTerminalWindowForSharedCheckoutSeat.mock.calls.map(
      (call) => call[1]
    )
    expect(new Set(openedTabIds).size).toBe(3)
  })

  it('skips a seat with no buildable startup plan — no tab, no window', () => {
    mocks.buildQuickComposerStartup.mockReturnValueOnce({
      startupPlan: null,
      backendStartup: undefined,
      telemetry: null
    })
    runSharedCheckoutLaunch(WORKTREE, [seat()], {} as never)

    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.openTerminalWindowForSharedCheckoutSeat).not.toHaveBeenCalled()
  })
})
