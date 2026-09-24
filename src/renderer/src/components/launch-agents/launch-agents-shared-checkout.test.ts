// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { SharedCheckoutSeatRequest } from './launch-agents-requests'

const mocks = vi.hoisted(() => ({
  createTab: vi.fn(),
  queueTabStartupCommand: vi.fn(),
  ensureWorktreeRootGroup: vi.fn(),
  createEmptySplitGroup: vi.fn(),
  setTabGroupLayout: vi.fn(),
  regridToCurrentLeaves: vi.fn(),
  activateAndRevealWorktree: vi.fn(),
  preflightAgentTrust: vi.fn(() => Promise.resolve()),
  buildQuickComposerStartup: vi.fn(),
  connectionId: null as string | null | undefined,
  executionHostId: 'local',
  projectRuntime: undefined as undefined | { status: 'resolved'; runtime: { kind: 'wsl' } },
  groups: [] as { id: string; tabOrder: string[] }[]
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      createTab: mocks.createTab,
      queueTabStartupCommand: mocks.queueTabStartupCommand,
      ensureWorktreeRootGroup: mocks.ensureWorktreeRootGroup,
      createEmptySplitGroup: mocks.createEmptySplitGroup,
      setTabGroupLayout: mocks.setTabGroupLayout,
      groupsByWorktree: { 'wt-project': mocks.groups }
    })
  }
}))
vi.mock('../pane-layout/split-pane-for-new-session', () => ({
  regridToCurrentLeaves: mocks.regridToCurrentLeaves
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))
vi.mock('@/lib/agent-trust-preflight', () => ({
  preflightAgentTrust: mocks.preflightAgentTrust
}))
vi.mock('@/hooks/composer-state/quick-startup-plan', () => ({
  buildQuickComposerStartup: mocks.buildQuickComposerStartup
}))
vi.mock('@/lib/connection-context', () => ({
  getConnectionIdFromState: () => mocks.connectionId
}))
vi.mock('@/lib/resolved-worktree-execution-host', () => ({
  getResolvedExecutionHostIdForWorktree: () => mocks.executionHostId
}))
vi.mock('@/lib/local-preflight-context', () => ({
  getLocalProjectExecutionRuntimeContext: () => mocks.projectRuntime
}))

// eslint-disable-next-line import/first -- mocks above must register before the module under test loads
import { runSharedCheckoutLaunch } from './launch-agents-shared-checkout'

const CLAUDE = 'claude' as TuiAgent
const WORKTREE = 'wt-project'
const WORKTREE_PATH = 'G:/Dev/project'
const ROOT_GROUP = 'group-root'

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
    mocks.connectionId = null
    mocks.executionHostId = 'local'
    mocks.projectRuntime = undefined
    mocks.groups = [{ id: ROOT_GROUP, tabOrder: [] }]
    mocks.ensureWorktreeRootGroup.mockReturnValue(ROOT_GROUP)
    mocks.createEmptySplitGroup.mockImplementation(
      () => `group-${mocks.createEmptySplitGroup.mock.calls.length}`
    )
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

  it('gives every seat its own pane in the project workspace, then regrids and reveals it', async () => {
    const seats = [seat(), seat({ model: 'opus' }), seat()]
    expect(await runSharedCheckoutLaunch(WORKTREE, WORKTREE_PATH, seats, {} as never)).toBe(3)

    // Why: one trust write per agent in the wave, and it lands before any tab exists.
    expect(mocks.preflightAgentTrust).toHaveBeenCalledTimes(1)
    expect(mocks.preflightAgentTrust).toHaveBeenCalledWith({
      agent: CLAUDE,
      workspacePath: WORKTREE_PATH,
      connectionId: null
    })
    expect(mocks.preflightAgentTrust.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createTab.mock.invocationCallOrder[0]
    )

    // Why: the fresh root group is empty, so the first seat takes it and only the
    // other two seats need a new split group — no idle pane is left in the grid.
    expect(mocks.createEmptySplitGroup).toHaveBeenCalledTimes(2)
    for (const call of mocks.createEmptySplitGroup.mock.calls) {
      expect(call.slice(0, 3)).toEqual([WORKTREE, ROOT_GROUP, 'right'])
    }
    expect(mocks.createTab).toHaveBeenCalledTimes(3)
    expect(mocks.createTab.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [WORKTREE, ROOT_GROUP],
      [WORKTREE, 'group-1'],
      [WORKTREE, 'group-2']
    ])
    expect(mocks.queueTabStartupCommand).toHaveBeenCalledTimes(3)
    expect(mocks.regridToCurrentLeaves).toHaveBeenCalledTimes(1)
    expect(mocks.regridToCurrentLeaves).toHaveBeenCalledWith(expect.anything(), WORKTREE)
    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith(WORKTREE)
  })

  it('keeps a workspace that already holds a tab and adds every seat as a new pane', async () => {
    mocks.groups = [{ id: ROOT_GROUP, tabOrder: ['existing-tab'] }]
    await runSharedCheckoutLaunch(WORKTREE, WORKTREE_PATH, [seat(), seat()], {} as never)

    expect(mocks.createEmptySplitGroup).toHaveBeenCalledTimes(2)
    expect(mocks.createTab.mock.calls.map((call) => call[1])).toEqual(['group-1', 'group-2'])
  })

  it('merges a seat’s effort override into the settings passed to the startup builder', async () => {
    await runSharedCheckoutLaunch(
      WORKTREE,
      WORKTREE_PATH,
      [seat({ model: 'opus', options: { effort: 'low' } })],
      { agentDefaultArgs: {} } as never
    )

    const passedSettings = mocks.buildQuickComposerStartup.mock.calls[0][0].settings
    expect(passedSettings.agentDefaultArgs.claude).toBe('--model opus --effort low')
  })

  it('skips a seat with no buildable startup plan — no tab, no pane, no reveal', async () => {
    mocks.buildQuickComposerStartup.mockReturnValueOnce({
      startupPlan: null,
      backendStartup: undefined,
      telemetry: null
    })
    expect(await runSharedCheckoutLaunch(WORKTREE, WORKTREE_PATH, [seat()], {} as never)).toBe(0)

    expect(mocks.createTab).not.toHaveBeenCalled()
    expect(mocks.createEmptySplitGroup).not.toHaveBeenCalled()
    expect(mocks.regridToCurrentLeaves).not.toHaveBeenCalled()
    expect(mocks.activateAndRevealWorktree).not.toHaveBeenCalled()
  })

  it('uses the SSH host platform and connection for startup and trust', async () => {
    mocks.connectionId = 'builder'
    mocks.executionHostId = 'ssh:builder'
    await runSharedCheckoutLaunch(WORKTREE, '/srv/project', [seat()], {} as never)

    expect(mocks.preflightAgentTrust).toHaveBeenCalledWith({
      agent: CLAUDE,
      workspacePath: '/srv/project',
      connectionId: 'builder'
    })
    expect(mocks.buildQuickComposerStartup).toHaveBeenCalledWith(
      expect.objectContaining({
        repoConnectionId: 'builder',
        platform: 'linux',
        isRemote: true
      })
    )
  })

  it('uses the WSL platform for a local project configured for WSL', async () => {
    mocks.projectRuntime = { status: 'resolved', runtime: { kind: 'wsl' } }
    await runSharedCheckoutLaunch(WORKTREE, WORKTREE_PATH, [seat()], {} as never)

    expect(mocks.buildQuickComposerStartup).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'linux', isRemote: false })
    )
  })

  it('does not launch when the checkout owner is unresolved', async () => {
    mocks.connectionId = undefined
    expect(await runSharedCheckoutLaunch(WORKTREE, WORKTREE_PATH, [seat()], {} as never)).toBe(0)
    expect(mocks.preflightAgentTrust).not.toHaveBeenCalled()
    expect(mocks.createTab).not.toHaveBeenCalled()
  })

  it('does not launch through an unresolved paired-runtime owner', async () => {
    mocks.executionHostId = ''
    expect(await runSharedCheckoutLaunch(WORKTREE, '/srv/project', [seat()], {} as never)).toBe(0)
    expect(mocks.preflightAgentTrust).not.toHaveBeenCalled()
    expect(mocks.createTab).not.toHaveBeenCalled()
  })

  it('does not write a paired-runtime checkout into local trust storage', async () => {
    mocks.executionHostId = 'runtime:remote-1'
    await runSharedCheckoutLaunch(WORKTREE, '/srv/project', [seat()], {} as never)
    expect(mocks.preflightAgentTrust).not.toHaveBeenCalled()
    expect(mocks.buildQuickComposerStartup).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'linux', isRemote: true })
    )
  })
})
