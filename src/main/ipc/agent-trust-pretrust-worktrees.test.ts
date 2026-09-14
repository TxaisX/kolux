import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Repo } from '../../shared/repo-types'
import { canonicalizeClaudeProjectPath } from '../claude-trust-preset'
import {
  computeWorktreePath,
  getWorktreePathSettings,
  sanitizeWorktreeName
} from './worktree-logic'
import {
  MAX_PRE_TRUST_WORKTREES,
  planPreTrustWorktreePaths,
  validatePreTrustWorktreesArgs
} from './agent-trust-pretrust-worktrees'

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

function settingsWithWorkspaceDir(workspaceDir: string): GlobalSettings {
  return { nestWorkspaces: false, workspaceDir } as GlobalSettings
}

describe('planPreTrustWorktreePaths', () => {
  it('computes the exact path createLocalWorktree would use for the same repo and name', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'nightshift-pretrust-repo-'))
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'nightshift-pretrust-root-'))
    try {
      const testRepo = repo({ path: repoDir })
      const settings = settingsWithWorkspaceDir(workspaceRoot)

      const [planned] = await planPreTrustWorktreePaths(testRepo, settings, ['My Feature'])

      // Why this is the assertion that matters: this is the same computeWorktreePath call
      // createLocalWorktree (worktree-remote.ts) makes for the same repo + name -- the wave
      // pre-trust must key its entry with the identical path or the later spawn-time check misses.
      const worktreePathSettings = getWorktreePathSettings(testRepo, settings)
      const expectedRaw = computeWorktreePath(
        sanitizeWorktreeName('My Feature'),
        testRepo.path,
        worktreePathSettings,
        workspaceRoot
      )
      expect(planned).toBe(canonicalizeClaudeProjectPath(expectedRaw))
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('plans one distinct path per name for a full 6-name wave', async () => {
    const repoDir = mkdtempSync(join(tmpdir(), 'nightshift-pretrust-repo-'))
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'nightshift-pretrust-root-'))
    try {
      const testRepo = repo({ path: repoDir })
      const settings = settingsWithWorkspaceDir(workspaceRoot)
      const names = ['a', 'b', 'c', 'd', 'e', 'f']

      const planned = await planPreTrustWorktreePaths(testRepo, settings, names)

      expect(planned).toHaveLength(6)
      expect(new Set(planned).size).toBe(6)
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('rejects an invalid name the same way createLocalWorktree would', async () => {
    const settings = settingsWithWorkspaceDir('/workspaces')
    await expect(planPreTrustWorktreePaths(repo(), settings, ['..'])).rejects.toThrow(
      'Invalid worktree name'
    )
  })
})

describe('validatePreTrustWorktreesArgs', () => {
  it('accepts a well-formed wave request', () => {
    const result = validatePreTrustWorktreesArgs({
      repoId: 'repo-1',
      agent: 'claude',
      worktreeNames: ['a', 'b']
    })
    expect(result).toEqual({ repoId: 'repo-1', agent: 'claude', worktreeNames: ['a', 'b'] })
  })

  it(`rejects more than ${MAX_PRE_TRUST_WORKTREES} names`, () => {
    const names = Array.from({ length: MAX_PRE_TRUST_WORKTREES + 1 }, (_, i) => `n${i}`)
    const result = validatePreTrustWorktreesArgs({
      repoId: 'repo-1',
      agent: 'claude',
      worktreeNames: names
    })
    expect(result).toEqual({ error: expect.stringContaining(String(MAX_PRE_TRUST_WORKTREES)) })
  })

  it('rejects an unknown agent', () => {
    const result = validatePreTrustWorktreesArgs({
      repoId: 'repo-1',
      agent: 'not-a-real-agent',
      worktreeNames: ['a']
    })
    expect('error' in result).toBe(true)
  })

  it('rejects a missing repoId', () => {
    const result = validatePreTrustWorktreesArgs({ agent: 'claude', worktreeNames: ['a'] })
    expect('error' in result).toBe(true)
  })

  it('rejects an empty worktreeNames array', () => {
    const result = validatePreTrustWorktreesArgs({
      repoId: 'repo-1',
      agent: 'claude',
      worktreeNames: []
    })
    expect('error' in result).toBe(true)
  })

  it('rejects a non-string entry in worktreeNames', () => {
    const result = validatePreTrustWorktreesArgs({
      repoId: 'repo-1',
      agent: 'claude',
      worktreeNames: ['a', 42]
    })
    expect('error' in result).toBe(true)
  })
})
