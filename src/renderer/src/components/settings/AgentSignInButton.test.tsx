import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openAgentAccountSettings, openAgentSetupInWorkspace } from './AgentSignInButton'

const mocks = vi.hoisted(() => ({
  owner: 'local' as string | undefined,
  state: {
    activeWorktreeId: 'folder:project' as string | null,
    settings: { activeRuntimeEnvironmentId: null as string | null },
    openSettingsTarget: vi.fn(),
    openSettingsPage: vi.fn(),
    setActiveView: vi.fn()
  },
  launch: vi.fn()
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => mocks.state } }))
vi.mock('@/hooks/useAgentDetectionTarget', () => ({
  getAgentDetectionTargetKeyForWorktree: () => mocks.owner
}))
vi.mock('../launch-agents/launch-agents-into-workspace', () => ({
  launchAgentsIntoWorkspace: mocks.launch
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.owner = 'local'
  mocks.state.activeWorktreeId = 'folder:project'
  mocks.state.settings.activeRuntimeEnvironmentId = null
  mocks.launch.mockReturnValue(1)
})

describe('agent sign-in entry points', () => {
  it.each([
    ['codex', 'codex'],
    ['claude', 'claude'],
    ['claude-agent-teams', 'claude']
  ] as const)('routes %s to its managed browser sign-in', (agent, provider) => {
    expect(openAgentAccountSettings(agent)).toBe(true)
    expect(mocks.state.openSettingsTarget).toHaveBeenCalledWith({
      pane: 'accounts',
      repoId: null,
      sectionId: `accounts-${provider}`
    })
    expect(mocks.launch).not.toHaveBeenCalled()
  })
  it('opens other CLIs without submitting work in the current folder workspace', () => {
    expect(openAgentAccountSettings('gemini')).toBe(false)
    expect(openAgentSetupInWorkspace('gemini')).toBe(true)
    expect(mocks.launch).toHaveBeenCalledWith('folder:project', [{ agent: 'gemini', prompt: '' }])
    expect(mocks.state.setActiveView).toHaveBeenCalledWith('terminal')
  })
  it.each([undefined, 'ssh:remote', 'runtime:other'])(
    'does not authenticate on a mismatched owner %s',
    (owner) => {
      mocks.owner = owner
      expect(openAgentSetupInWorkspace('gemini')).toBe(false)
      expect(mocks.launch).not.toHaveBeenCalled()
    }
  )
  it('uses the matching paired runtime workspace without a local fallback', () => {
    mocks.owner = 'runtime:server'
    mocks.state.settings.activeRuntimeEnvironmentId = 'server'
    expect(openAgentSetupInWorkspace('grok')).toBe(true)
  })
  it('requires a workspace and keeps settings open when launch fails', () => {
    mocks.state.activeWorktreeId = null
    expect(openAgentSetupInWorkspace('gemini')).toBe(false)
    mocks.state.activeWorktreeId = 'folder:project'
    mocks.launch.mockReturnValue(0)
    expect(openAgentSetupInWorkspace('gemini')).toBe(false)
    expect(mocks.state.setActiveView).not.toHaveBeenCalled()
  })
})
