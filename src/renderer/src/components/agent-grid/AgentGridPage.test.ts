import { describe, expect, it } from 'vitest'
import { selectAgentGridCards } from './AgentGridPage'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'

function makeCard(overrides: Partial<DashboardCard> & { worktreeId: string }): DashboardCard {
  return {
    paneKey: `${overrides.worktreeId}::pane`,
    ptyId: `pty-${overrides.worktreeId}`,
    agentType: 'claude',
    bucket: 'working',
    dotState: 'working',
    task: '',
    repoId: 'repo-1',
    tabId: `${overrides.worktreeId}-tab`,
    leafId: 'leaf-1',
    repoName: 'repo',
    worktreeName: overrides.worktreeId,
    startedAt: 0,
    finishedAt: null,
    stateChangedAt: 0,
    unseen: false,
    ...overrides
  }
}

describe('selectAgentGridCards', () => {
  it('returns one tile per launched worktree, none dropped, up to six', () => {
    const worktreeIds = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6']
    const cards = worktreeIds.map((worktreeId) => makeCard({ worktreeId }))

    const result = selectAgentGridCards(cards, 'repo-1')

    expect(result.map((card) => card.worktreeId)).toEqual(worktreeIds)
  })

  it('excludes a worktree whose only row has no live pty', () => {
    const cards = [makeCard({ worktreeId: 'w1' }), makeCard({ worktreeId: 'w2', ptyId: null })]

    const result = selectAgentGridCards(cards, 'repo-1')

    expect(result.map((card) => card.worktreeId)).toEqual(['w1'])
  })

  it('picks the live-pty row for a worktree with a stale ptyless row first', () => {
    const cards = [
      makeCard({ worktreeId: 'w1', ptyId: null, tabId: 'blank-tab' }),
      makeCard({ worktreeId: 'w1', ptyId: 'pty-real', tabId: 'agent-tab' })
    ]

    const result = selectAgentGridCards(cards, 'repo-1')

    expect(result).toHaveLength(1)
    expect(result[0].ptyId).toBe('pty-real')
  })

  it('ignores cards from other repos', () => {
    const cards = [makeCard({ worktreeId: 'w1', repoId: 'repo-2' })]

    expect(selectAgentGridCards(cards, 'repo-1')).toHaveLength(0)
  })
})
