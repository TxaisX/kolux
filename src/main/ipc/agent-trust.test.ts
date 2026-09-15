import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { Store } from '../persistence'
import type * as AgentTrustPretrustWorktrees from './agent-trust-pretrust-worktrees'

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
  markClaudeProjectTrusted: vi.fn(async () => undefined),
  writeClaudeProjectTrust: vi.fn(),
  markCodexProjectTrusted: vi.fn(),
  markCopilotFolderTrusted: vi.fn(),
  markCursorWorkspaceTrusted: vi.fn(),
  markRemoteAgentWorkspaceTrusted: vi.fn(async () => undefined),
  planPreTrustWorktreePaths: vi.fn(async (): Promise<string[]> => []),
  getWorktreeMirrorDistro: vi.fn(() => undefined)
}))

vi.mock('electron', () => ({
  ipcMain: {
    removeHandler: vi.fn(),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.ipcHandlers.set(channel, handler)
    })
  }
}))

vi.mock('../agent-trust-presets', () => ({
  markCodexProjectTrusted: mocks.markCodexProjectTrusted,
  markCopilotFolderTrusted: mocks.markCopilotFolderTrusted,
  markCursorWorkspaceTrusted: mocks.markCursorWorkspaceTrusted
}))

vi.mock('../remote-agent-trust-presets', () => ({
  markRemoteAgentWorkspaceTrusted: mocks.markRemoteAgentWorkspaceTrusted
}))

// Why mock: a real markClaudeProjectTrusted/writeClaudeProjectTrust would touch the real
// .claude.json on this machine (see claude-trust-preset.test.ts's CLAUDE_CONFIG_DIR note).
vi.mock('../claude-trust-preset', () => ({
  markClaudeProjectTrusted: mocks.markClaudeProjectTrusted,
  writeClaudeProjectTrust: mocks.writeClaudeProjectTrust
}))

vi.mock('../project-runtime-git-options', () => ({
  getWorktreeMirrorDistro: mocks.getWorktreeMirrorDistro
}))

vi.mock('./agent-trust-pretrust-worktrees', async () => {
  const actual = await vi.importActual<typeof AgentTrustPretrustWorktrees>(
    './agent-trust-pretrust-worktrees'
  )
  return {
    ...actual,
    planPreTrustWorktreePaths: mocks.planPreTrustWorktreePaths
  }
})

const { registerAgentTrustHandlers } = await import('./agent-trust')

function repo(overrides: Partial<Repo> = {}): Repo {
  return {
    id: 'repo-1',
    path: '/repo',
    displayName: 'repo',
    badgeColor: '#000',
    addedAt: 1,
    ...overrides
  }
}

function storeWithRepo(found: Repo | undefined): Store {
  const fake: Pick<Store, 'getRepo' | 'getSettings'> = {
    getRepo: () => found,
    getSettings: () =>
      ({ nestWorkspaces: false, workspaceDir: '/workspaces' }) as ReturnType<Store['getSettings']>
  }
  return fake as Store
}

function invokePreTrust(args: unknown): Promise<{ ok: true } | { error: string }> {
  const handler = mocks.ipcHandlers.get('agentTrust:preTrustWorktrees')
  if (!handler) {
    throw new Error('agentTrust:preTrustWorktrees was not registered')
  }
  return handler(null, args) as Promise<{ ok: true } | { error: string }>
}

beforeEach(() => {
  mocks.ipcHandlers.clear()
  mocks.markClaudeProjectTrusted.mockClear()
  mocks.writeClaudeProjectTrust.mockClear()
  mocks.planPreTrustWorktreePaths.mockClear()
  mocks.planPreTrustWorktreePaths.mockResolvedValue([])
  mocks.getWorktreeMirrorDistro.mockClear()
})

describe('agentTrust:preTrustWorktrees', () => {
  it('writes every planned path in exactly one call for a full 6-name wave', async () => {
    const testRepo = repo()
    registerAgentTrustHandlers(storeWithRepo(testRepo))
    const planned = ['/w/1', '/w/2', '/w/3', '/w/4', '/w/5', '/w/6']
    mocks.planPreTrustWorktreePaths.mockResolvedValue(planned)

    const result = await invokePreTrust({
      repoId: testRepo.id,
      agent: 'claude',
      worktreeNames: ['a', 'b', 'c', 'd', 'e', 'f']
    })

    expect(result).toEqual({ ok: true })
    expect(mocks.writeClaudeProjectTrust).toHaveBeenCalledTimes(1)
    expect(mocks.writeClaudeProjectTrust).toHaveBeenCalledWith(planned)
  })

  it('no-ops for a non-claude agent without touching the trust file', async () => {
    registerAgentTrustHandlers(storeWithRepo(repo()))

    const result = await invokePreTrust({ repoId: 'repo-1', agent: 'codex', worktreeNames: ['a'] })

    expect(result).toEqual({ ok: true })
    expect(mocks.writeClaudeProjectTrust).not.toHaveBeenCalled()
    expect(mocks.planPreTrustWorktreePaths).not.toHaveBeenCalled()
  })

  it('rejects a repo it cannot find', async () => {
    registerAgentTrustHandlers(storeWithRepo(undefined))

    const result = await invokePreTrust({
      repoId: 'missing',
      agent: 'claude',
      worktreeNames: ['a']
    })

    expect('error' in result).toBe(true)
    expect(mocks.writeClaudeProjectTrust).not.toHaveBeenCalled()
  })

  it('rejects a folder repo', async () => {
    const testRepo = repo({ kind: 'folder' })
    registerAgentTrustHandlers(storeWithRepo(testRepo))

    const result = await invokePreTrust({
      repoId: testRepo.id,
      agent: 'claude',
      worktreeNames: ['a']
    })

    expect('error' in result).toBe(true)
    expect(mocks.writeClaudeProjectTrust).not.toHaveBeenCalled()
  })

  it('rejects a non-local (SSH) repo', async () => {
    const testRepo = repo({ connectionId: 'host-1' })
    registerAgentTrustHandlers(storeWithRepo(testRepo))

    const result = await invokePreTrust({
      repoId: testRepo.id,
      agent: 'claude',
      worktreeNames: ['a']
    })

    expect('error' in result).toBe(true)
    expect(mocks.writeClaudeProjectTrust).not.toHaveBeenCalled()
  })

  it('rejects more than 6 worktree names before planning any path', async () => {
    registerAgentTrustHandlers(storeWithRepo(repo()))
    const names = Array.from({ length: 7 }, (_, i) => `n${i}`)

    const result = await invokePreTrust({ repoId: 'repo-1', agent: 'claude', worktreeNames: names })

    expect('error' in result).toBe(true)
    expect(mocks.planPreTrustWorktreePaths).not.toHaveBeenCalled()
  })
})
