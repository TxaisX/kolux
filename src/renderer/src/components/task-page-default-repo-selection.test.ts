import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import {
  getDefaultTaskRepoSelection,
  getTaskEligibleRepos,
  getTaskProjectPickerGroups,
  getTaskProjectPickerRepos,
  normalizeTaskRepoSelection
} from './task-page-default-repo-selection'

function repo(overrides: Partial<Repo> & Pick<Repo, 'id'>): Repo {
  return {
    path: `/repos/${overrides.id}`,
    displayName: overrides.id,
    badgeColor: '#737373',
    addedAt: 100,
    kind: 'git',
    ...overrides
  }
}

describe('getTaskEligibleRepos', () => {
  it('keeps only Git repos with a resolvable remote identity', () => {
    const eligible = getTaskEligibleRepos([
      repo({ id: 'github-upstream', upstream: { owner: 'TxaisX', repo: 'kolux' } }),
      repo({
        id: 'github-icon',
        repoIcon: {
          type: 'image',
          src: 'https://github.com/txais.png?size=64',
          source: 'github',
          label: 'TxaisX/nightshift'
        }
      }),
      repo({
        id: 'gitlab-remote',
        gitRemoteIdentity: {
          canonicalKey: 'gitlab.example.com/team/kolux',
          remoteName: 'origin',
          remoteUrl: 'git@gitlab.example.com:team/kolux.git'
        }
      }),
      repo({ id: 'settled-no-remote', gitRemoteIdentity: null }),
      repo({
        id: 'incomplete-remote',
        gitRemoteIdentity: {
          canonicalKey: 'gitlab.example.com/team/incomplete',
          remoteName: '',
          remoteUrl: 'git@gitlab.example.com:team/incomplete.git'
        }
      }),
      repo({
        id: 'folder-with-remote',
        kind: 'folder',
        upstream: { owner: 'TxaisX', repo: 'docs' }
      })
    ])

    expect(eligible.map((candidate) => candidate.id)).toEqual([
      'github-upstream',
      'github-icon',
      'gitlab-remote'
    ])
  })

  it('keeps a repo visible while its remote identity probe has not answered', () => {
    const eligible = getTaskEligibleRepos([
      repo({ id: 'probe-pending' }),
      repo({ id: 'ssh-probe-pending', connectionId: 'builder' }),
      repo({ id: 'settled-no-remote', gitRemoteIdentity: null })
    ])

    expect(eligible.map((candidate) => candidate.id)).toEqual([
      'probe-pending',
      'ssh-probe-pending'
    ])
  })

  it('excludes folders and settled remote-less repos even while others are pending', () => {
    const eligible = getTaskEligibleRepos([
      repo({ id: 'folder-pending', kind: 'folder' }),
      repo({ id: 'folder-settled', kind: 'folder', gitRemoteIdentity: null }),
      repo({ id: 'git-pending' })
    ])

    expect(eligible.map((candidate) => candidate.id)).toEqual(['git-pending'])
  })

  it('treats a partially resolved remote identity as settled, not pending', () => {
    const eligible = getTaskEligibleRepos([
      repo({
        id: 'gitlab-ssh-partial',
        connectionId: 'builder',
        gitRemoteIdentity: {
          canonicalKey: 'gitlab.example.com/team/kolux',
          remoteName: 'origin',
          remoteUrl: ''
        }
      }),
      repo({
        id: 'gitlab-ssh-complete',
        connectionId: 'builder',
        gitRemoteIdentity: {
          canonicalKey: 'gitlab.example.com/team/kolux',
          remoteName: 'origin',
          remoteUrl: 'git@gitlab.example.com:team/kolux.git'
        }
      })
    ])

    expect(eligible.map((candidate) => candidate.id)).toEqual(['gitlab-ssh-complete'])
  })
})

describe('getDefaultTaskRepoSelection', () => {
  it('selects one source per logical GitHub project', () => {
    const selection = getDefaultTaskRepoSelection([
      repo({
        id: 'local-kolux',
        upstream: { owner: 'Txais', repo: 'Kolux' }
      }),
      repo({
        id: 'ssh-kolux',
        connectionId: 'builder',
        upstream: { owner: 'TxaisX', repo: 'kolux' }
      }),
      repo({
        id: 'other',
        upstream: { owner: 'TxaisX', repo: 'other' }
      })
    ])

    expect([...selection].sort()).toEqual(['local-kolux', 'other'])
  })

  it('keeps GitHub grouping intact while a pending-identity repo joins as its own project', () => {
    const selection = getDefaultTaskRepoSelection(
      getTaskEligibleRepos([
        repo({ id: 'local-kolux', upstream: { owner: 'Txais', repo: 'Kolux' } }),
        repo({
          id: 'ssh-kolux',
          connectionId: 'builder',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        }),
        repo({ id: 'ssh-gitlab-pending', connectionId: 'builder' })
      ])
    )

    expect([...selection].sort()).toEqual(['local-kolux', 'ssh-gitlab-pending'])
  })

  it('prefers local checkout over a remote checkout for the same project', () => {
    const selection = getDefaultTaskRepoSelection([
      repo({
        id: 'ssh-kolux',
        addedAt: 1,
        connectionId: 'builder',
        upstream: { owner: 'TxaisX', repo: 'kolux' }
      }),
      repo({
        id: 'local-kolux',
        addedAt: 2,
        upstream: { owner: 'TxaisX', repo: 'kolux' }
      })
    ])

    expect([...selection]).toEqual(['local-kolux'])
  })

  it('keeps same-named folders separate when provider identity is missing', () => {
    const selection = getDefaultTaskRepoSelection([
      repo({ id: 'local-app', displayName: 'app' }),
      repo({ id: 'ssh-app', displayName: 'app', connectionId: 'builder' })
    ])

    expect([...selection].sort()).toEqual(['local-app', 'ssh-app'])
  })

  it('uses GitHub repo icon metadata to identify legacy duplicate projects', () => {
    const selection = getDefaultTaskRepoSelection([
      repo({
        id: 'local-claude-swap',
        displayName: 'claude-swap',
        repoIcon: {
          type: 'image',
          src: 'https://github.com/txais.png?size=64',
          source: 'github',
          label: 'txais/claude-swap'
        }
      }),
      repo({
        id: 'ssh-claude-swap',
        displayName: 'claude-swap',
        connectionId: 'builder',
        repoIcon: {
          type: 'image',
          src: 'https://github.com/txais.png?size=64',
          source: 'github',
          label: 'Txais/claude-swap'
        }
      })
    ])

    expect([...selection]).toEqual(['local-claude-swap'])
  })
})

describe('getTaskProjectPickerRepos', () => {
  it('shows one picker row per logical GitHub project', () => {
    const pickerRepos = getTaskProjectPickerRepos([
      repo({
        id: 'local-kolux',
        upstream: { owner: 'Txais', repo: 'Kolux' }
      }),
      repo({
        id: 'ssh-kolux',
        connectionId: 'builder',
        upstream: { owner: 'TxaisX', repo: 'kolux' }
      }),
      repo({
        id: 'other',
        upstream: { owner: 'TxaisX', repo: 'other' }
      })
    ])

    expect(pickerRepos.map((candidate) => candidate.id)).toEqual(['local-kolux', 'other'])
  })

  it('uses an explicitly selected remote source as the visible project row', () => {
    const pickerRepos = getTaskProjectPickerRepos(
      [
        repo({
          id: 'local-kolux',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        }),
        repo({
          id: 'ssh-kolux',
          connectionId: 'builder',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        })
      ],
      new Set(['ssh-kolux'])
    )

    expect(pickerRepos.map((candidate) => candidate.id)).toEqual(['ssh-kolux'])
  })

  it('collapses legacy local and SSH rows that share a GitHub repo icon identity', () => {
    const pickerRepos = getTaskProjectPickerRepos([
      repo({
        id: 'local-claude-swap',
        displayName: 'claude-swap',
        repoIcon: {
          type: 'image',
          src: 'https://github.com/txais.png?size=64',
          source: 'github',
          label: 'txais/claude-swap'
        }
      }),
      repo({
        id: 'ssh-claude-swap',
        displayName: 'claude-swap',
        connectionId: 'builder',
        repoIcon: {
          type: 'image',
          src: 'https://github.com/txais.png?size=64',
          source: 'github',
          label: 'Txais/claude-swap'
        }
      })
    ])

    expect(pickerRepos.map((candidate) => candidate.id)).toEqual(['local-claude-swap'])
  })
})

describe('getTaskProjectPickerGroups', () => {
  it('keeps all host sources under one logical project row', () => {
    const groups = getTaskProjectPickerGroups([
      repo({
        id: 'local-kolux',
        upstream: { owner: 'TxaisX', repo: 'kolux' }
      }),
      repo({
        id: 'ssh-kolux',
        connectionId: 'builder',
        upstream: { owner: 'TxaisX', repo: 'kolux' }
      }),
      repo({
        id: 'docs',
        upstream: { owner: 'TxaisX', repo: 'docs' }
      })
    ])

    expect(groups).toHaveLength(2)
    expect(groups[0]).toMatchObject({
      projectKey: 'github:TxaisX/nightshift',
      repo: { id: 'local-kolux' }
    })
    expect(groups[0]?.sources.map((source) => source.id)).toEqual(['local-kolux', 'ssh-kolux'])
    expect(groups[1]).toMatchObject({
      projectKey: 'github:txais/docs',
      repo: { id: 'docs' }
    })
  })

  it('uses the explicitly selected source as the project representative', () => {
    const groups = getTaskProjectPickerGroups(
      [
        repo({
          id: 'local-kolux',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        }),
        repo({
          id: 'ssh-kolux',
          connectionId: 'builder',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        })
      ],
      new Set(['ssh-kolux'])
    )

    expect(groups[0]?.repo.id).toBe('ssh-kolux')
    expect(groups[0]?.sources.map((source) => source.id)).toEqual(['local-kolux', 'ssh-kolux'])
  })
})

describe('normalizeTaskRepoSelection', () => {
  it('collapses duplicate selected sources for the same logical project', () => {
    const selection = normalizeTaskRepoSelection(
      [
        repo({
          id: 'local-kolux',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        }),
        repo({
          id: 'ssh-kolux',
          connectionId: 'builder',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        })
      ],
      new Set(['local-kolux', 'ssh-kolux'])
    )

    expect([...selection]).toEqual(['local-kolux'])
  })

  it('preserves a single explicit remote source selection', () => {
    const selection = normalizeTaskRepoSelection(
      [
        repo({
          id: 'local-kolux',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        }),
        repo({
          id: 'ssh-kolux',
          connectionId: 'builder',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        })
      ],
      new Set(['ssh-kolux'])
    )

    expect([...selection]).toEqual(['ssh-kolux'])
  })

  it('normalizes raw all-host selection to one source per logical project', () => {
    const selection = normalizeTaskRepoSelection(
      [
        repo({
          id: 'local-kolux',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        }),
        repo({
          id: 'ssh-kolux',
          connectionId: 'builder',
          upstream: { owner: 'TxaisX', repo: 'kolux' }
        }),
        repo({
          id: 'docs',
          upstream: { owner: 'TxaisX', repo: 'docs' }
        })
      ],
      new Set(['local-kolux', 'ssh-kolux', 'docs'])
    )

    expect([...selection].sort()).toEqual(['docs', 'local-kolux'])
  })
})
