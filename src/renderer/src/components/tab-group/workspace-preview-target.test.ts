import { describe, expect, it } from 'vitest'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import type { BrowserWorkspace } from '../../../../shared/browser-workspace-types'
import { findExistingPreviewTab, selectWorkspacePreviewCandidates } from './workspace-preview-target'

const WORKTREE_ID = 'worktree-1'

function workspacePort(overrides: Partial<WorkspacePort> & { id: string; port: number }): WorkspacePort {
  return {
    bindHost: '0.0.0.0',
    connectHost: '127.0.0.1',
    protocol: 'http',
    kind: 'workspace',
    owner: {
      worktreeId: WORKTREE_ID,
      repoId: 'repo-1',
      displayName: 'my-app',
      path: '/repo',
      confidence: 'cwd'
    },
    ...overrides
  } as WorkspacePort
}

function browserWorkspace(overrides: Partial<BrowserWorkspace> & { id: string; url: string }): BrowserWorkspace {
  return {
    worktreeId: WORKTREE_ID,
    title: 'Preview',
    loading: false,
    faviconUrl: null,
    canGoBack: false,
    canGoForward: false,
    loadError: null,
    createdAt: 0,
    activePageId: `${overrides.id}-page`,
    ...overrides
  } as BrowserWorkspace
}

describe('selectWorkspacePreviewCandidates', () => {
  it('returns an empty list when there are no ports for the workspace', () => {
    expect(selectWorkspacePreviewCandidates([], WORKTREE_ID)).toEqual([])
  })

  it('ignores ports not owned by this worktree and non-workspace ports', () => {
    const otherWorktree = workspacePort({
      id: 'a',
      port: 3000,
      owner: {
        worktreeId: 'worktree-2',
        repoId: 'repo-1',
        displayName: 'other',
        path: '/other',
        confidence: 'cwd'
      }
    })
    const container = { ...workspacePort({ id: 'b', port: 4000 }), kind: 'container' } as WorkspacePort
    expect(selectWorkspacePreviewCandidates([otherWorktree, container], WORKTREE_ID)).toEqual([])
  })

  it('prefers advertisedUrl over other ports', () => {
    const withAdvertised = workspacePort({
      id: 'a',
      port: 4000,
      advertisedUrl: 'https://local.example.com:4000'
    })
    const plain = workspacePort({ id: 'b', port: 3000 })
    const ranked = selectWorkspacePreviewCandidates([plain, withAdvertised], WORKTREE_ID)
    expect(ranked[0].port.id).toBe('a')
    expect(ranked[0].url).toBe('https://local.example.com:4000')
  })

  it('ranks a known protocol over unknown, then lowest port number', () => {
    const unknown = workspacePort({ id: 'a', port: 3000, protocol: 'unknown' })
    const httpHigh = workspacePort({ id: 'b', port: 8080, protocol: 'http' })
    const httpLow = workspacePort({ id: 'c', port: 3001, protocol: 'http' })
    const ranked = selectWorkspacePreviewCandidates([unknown, httpHigh, httpLow], WORKTREE_ID)
    expect(ranked.map((c) => c.port.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('findExistingPreviewTab', () => {
  it('returns null when origin is null', () => {
    expect(findExistingPreviewTab([browserWorkspace({ id: 't1', url: 'http://localhost:3000' })], null)).toBeNull()
  })

  it('returns null when no tab matches the origin', () => {
    const tabs = [browserWorkspace({ id: 't1', url: 'http://localhost:3000/app' })]
    expect(findExistingPreviewTab(tabs, 'http://localhost:4000')).toBeNull()
  })

  it('matches a tab whose active page origin equals the candidate origin, ignoring path', () => {
    const target = browserWorkspace({ id: 't2', url: 'http://localhost:5173/dashboard' })
    const tabs = [browserWorkspace({ id: 't1', url: 'http://localhost:3000' }), target]
    expect(findExistingPreviewTab(tabs, 'http://localhost:5173')).toBe(target)
  })
})
