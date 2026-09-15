import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockQueueTabStartupCommand = vi.fn()

const store = {
  settings: {
    agentCmdOverrides: {},
    agentDefaultArgs: {} as Record<string, string>,
    agentDefaultEnv: {} as Record<string, Record<string, string>>,
    activeRuntimeEnvironmentId: null as string | null
  },
  agentPermissionModeByWorktree: {} as Record<string, 'yolo' | 'manual'>,
  repos: [],
  allWorktrees: vi.fn(() => []),
  tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] },
  openFiles: [] as { id: string; worktreeId: string }[],
  browserTabsByWorktree: {} as Record<string, { id: string }[]>,
  tabBarOrderByWorktree: {} as Record<string, string[]>,
  createTab: vi.fn(() => ({ id: 'tab-1' })),
  queueTabStartupCommand: mockQueueTabStartupCommand,
  setActiveTabType: vi.fn(),
  setTabBarOrder: vi.fn()
}

vi.mock('@/store', () => ({
  useAppStore: { getState: () => store }
}))

vi.mock('@/lib/new-workspace', () => ({ CLIENT_PLATFORM: 'darwin' }))

vi.mock('@/lib/connection-context', () => ({
  getConnectionIdFromState: () => null
}))

vi.mock('@/lib/native-chat-transcript-readability', () => ({
  isNativeChatTranscriptLocalReadable: () => true
}))

vi.mock('@/runtime/web-runtime-session', () => ({
  isWebRuntimeSessionActive: () => false
}))

vi.mock('@/lib/worktree-runtime-owner', () => ({
  getExecutionHostIdForWorktree: () => 'local',
  getRuntimeEnvironmentIdForWorktree: () => 'web-runtime'
}))

vi.mock('@/components/tab-bar/reconcile-order', () => ({
  reconcileTabOrder: (_stored: unknown, terminalIds: string[]) => terminalIds
}))

vi.mock('@/lib/telemetry', () => ({
  track: vi.fn(),
  tuiAgentToAgentKind: (agent: string) => agent
}))

vi.mock('@/components/native-chat/native-chat-session-option-cache', () => ({
  seedNativeChatAppliedSessionOptions: vi.fn()
}))

describe('launchAgentInNewTab per-workspace YOLO override', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.agentPermissionModeByWorktree = {}
  })

  it('applies the YOLO flag when the worktree is explicitly set to yolo', async () => {
    store.agentPermissionModeByWorktree = { 'wt-1': 'yolo' }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ agent: 'claude', worktreeId: 'wt-1' })

    expect(mockQueueTabStartupCommand).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ command: "claude '--dangerously-skip-permissions'" })
    )
  })

  it('strips the YOLO flag when the worktree is explicitly set to manual', async () => {
    store.agentPermissionModeByWorktree = { 'wt-1': 'manual' }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ agent: 'claude', worktreeId: 'wt-1' })

    expect(mockQueueTabStartupCommand).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ command: 'claude' })
    )
  })

  it('leaves an explicit caller-provided agentArgs untouched regardless of the override', async () => {
    store.agentPermissionModeByWorktree = { 'wt-1': 'manual' }
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ agent: 'claude', worktreeId: 'wt-1', agentArgs: '--model opus' })

    expect(mockQueueTabStartupCommand).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ command: "claude '--model' 'opus'" })
    )
  })

  it('does not override a worktree with no explicit entry', async () => {
    const { launchAgentInNewTab } = await import('./launch-agent-in-new-tab')

    launchAgentInNewTab({ agent: 'claude', worktreeId: 'wt-1' })

    expect(mockQueueTabStartupCommand).toHaveBeenCalledWith(
      'tab-1',
      expect.objectContaining({ command: "claude '--dangerously-skip-permissions'" })
    )
  })
})
