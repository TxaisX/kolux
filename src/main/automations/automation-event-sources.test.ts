import { describe, expect, it, vi } from 'vitest'
import type { HostedReviewInfo } from '../../shared/hosted-review'
import type { AutomationRun } from '../../shared/automations-types'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'

const { setHostedReviewObserverMock } = vi.hoisted(() => ({
  setHostedReviewObserverMock: vi.fn()
}))
vi.mock('../source-control/hosted-review', () => ({
  setHostedReviewObserver: setHostedReviewObserverMock
}))
vi.mock('../source-control/hosted-review-execution-host', () => ({
  getRepoHostedReviewExecutionHostId: (repo: { executionHostId?: string }) =>
    repo.executionHostId ?? 'local'
}))

import {
  agentDoneEvent,
  isAutomationRunOwnedPane,
  reviewTransitionEvent,
  wireAutomationEventSources
} from './automation-event-sources'

function makeReview(overrides: Partial<HostedReviewInfo> = {}): HostedReviewInfo {
  return {
    provider: 'github',
    number: 3,
    title: 'Add feature',
    state: 'open',
    url: 'https://example.test/pull/3',
    status: 'pending',
    updatedAt: '2026-05-13T00:00:00.000Z',
    mergeable: 'MERGEABLE',
    ...overrides
  }
}

const identity = { executionHostId: 'local' as const, repoPath: '/repo' }

describe('reviewTransitionEvent', () => {
  it('fires review_opened on a null-to-open transition', () => {
    const events = reviewTransitionEvent(null, makeReview({ state: 'open' }), identity)
    expect(events).toEqual([
      expect.objectContaining({ kind: 'review_opened', key: 'review_opened:github:local:/repo:3' })
    ])
  })

  it('fires review_opened for a draft PR too', () => {
    const events = reviewTransitionEvent(null, makeReview({ state: 'draft' }), identity)
    expect(events.some((event) => event.kind === 'review_opened')).toBe(true)
  })

  it('does not fire review_opened again on an identical repeat', () => {
    const review = makeReview()
    expect(reviewTransitionEvent(review, review, identity)).toEqual([])
  })

  it('fires review_checks_failed on a pending-to-failure transition', () => {
    const prev = makeReview({ status: 'pending' })
    const next = makeReview({ status: 'failure', headSha: 'abc123' })
    const events = reviewTransitionEvent(prev, next, identity)
    expect(events).toEqual([
      expect.objectContaining({
        kind: 'review_checks_failed',
        key: 'review_checks_failed:github:local:/repo:3:abc123'
      })
    ])
  })

  it('fires review_checks_failed for a GitLab pipeline failure the same way', () => {
    const prev = makeReview({ provider: 'gitlab', status: 'pending' })
    const next = makeReview({ provider: 'gitlab', status: 'failure' })
    const events = reviewTransitionEvent(prev, next, identity)
    expect(events.some((event) => event.kind === 'review_checks_failed')).toBe(true)
  })

  it('does not refire review_checks_failed while checks stay failed', () => {
    const failing = makeReview({ status: 'failure' })
    expect(reviewTransitionEvent(failing, failing, identity)).toEqual([])
  })

  it('reports nothing when there is still no review', () => {
    expect(reviewTransitionEvent(null, null, identity)).toEqual([])
  })
})

describe('agentDoneEvent', () => {
  function makePayload(
    overrides: Partial<EnrichedAgentHookEventPayload> = {}
  ): EnrichedAgentHookEventPayload {
    return {
      paneKey: 'tab-1:11111111-1111-4111-8111-111111111111',
      connectionId: null,
      worktreeId: 'r1::/repo',
      receivedAt: 1,
      stateStartedAt: 1,
      payload: { state: 'done' },
      ...overrides
    } as EnrichedAgentHookEventPayload
  }

  it('fires for a plain done state with a worktree', () => {
    expect(agentDoneEvent(makePayload())).toEqual(
      expect.objectContaining({
        kind: 'agent_done',
        key: 'agent_done:tab-1:11111111-1111-4111-8111-111111111111:1'
      })
    )
  })

  it('ignores a non-done state', () => {
    expect(agentDoneEvent(makePayload({ payload: { state: 'working' } } as never))).toBeNull()
  })

  it('ignores an interrupted done', () => {
    expect(
      agentDoneEvent(makePayload({ payload: { state: 'done', interrupted: true } } as never))
    ).toBeNull()
  })

  it('ignores a session-boundary done', () => {
    expect(
      agentDoneEvent(makePayload({ payload: { state: 'done', sessionBoundary: true } } as never))
    ).toBeNull()
  })

  it('ignores a restored-unconfirmed row', () => {
    expect(agentDoneEvent(makePayload({ restoredUnconfirmed: true }))).toBeNull()
  })

  it('ignores an event with no worktreeId', () => {
    expect(agentDoneEvent(makePayload({ worktreeId: undefined }))).toBeNull()
  })
})

describe('isAutomationRunOwnedPane', () => {
  it('is true when a run is using this pane as its terminal', () => {
    const store = {
      listAutomationRuns: () => [{ terminalPaneKey: 'pane-1' } as AutomationRun]
    } as never
    expect(isAutomationRunOwnedPane(store, 'pane-1')).toBe(true)
  })

  it('is false for an unrelated pane', () => {
    const store = { listAutomationRuns: () => [] as AutomationRun[] } as never
    expect(isAutomationRunOwnedPane(store, 'pane-1')).toBe(false)
  })
})

describe('wireAutomationEventSources', () => {
  function wire(repo: { id: string; path: string; executionHostId?: string } | null) {
    setHostedReviewObserverMock.mockReset()
    const handleAutomationEvent = vi.fn()
    const subscribeEnrichedStatus = vi.fn()
    const store = {
      getRepos: () => (repo ? [repo] : []),
      listAutomationRuns: () => [] as AutomationRun[]
    } as never
    wireAutomationEventSources({
      store,
      service: { handleAutomationEvent },
      agentHookServer: { subscribeEnrichedStatus }
    })
    return {
      handleAutomationEvent,
      reviewObserver: setHostedReviewObserverMock.mock.calls[0][0] as (
        identity: { executionHostId: string; repoPath: string; branch: string },
        review: HostedReviewInfo | null
      ) => void,
      statusListener: subscribeEnrichedStatus.mock.calls[0][0] as (
        payload: EnrichedAgentHookEventPayload
      ) => void
    }
  }

  it('does not fire on the first answer for a branch (baseline only)', () => {
    const { reviewObserver, handleAutomationEvent } = wire({ id: 'r1', path: '/repo' })
    reviewObserver({ executionHostId: 'local', repoPath: '/repo', branch: 'feature' }, makeReview())
    expect(handleAutomationEvent).not.toHaveBeenCalled()
  })

  it('fires once a later poll transitions null to open', () => {
    const { reviewObserver, handleAutomationEvent } = wire({ id: 'r1', path: '/repo' })
    const branchIdentity = { executionHostId: 'local', repoPath: '/repo', branch: 'feature' }
    reviewObserver(branchIdentity, null)
    reviewObserver(branchIdentity, makeReview())
    expect(handleAutomationEvent).toHaveBeenCalledTimes(1)
    expect(handleAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 'r1',
        event: expect.objectContaining({ kind: 'review_opened' })
      })
    )
  })

  it('does not match to any automation when no repo owns the branch', () => {
    const { reviewObserver, handleAutomationEvent } = wire(null)
    const branchIdentity = { executionHostId: 'local', repoPath: '/repo', branch: 'feature' }
    reviewObserver(branchIdentity, null)
    reviewObserver(branchIdentity, makeReview())
    expect(handleAutomationEvent).not.toHaveBeenCalled()
  })

  it('routes agent_done through getRepoIdFromWorktreeId', () => {
    const { statusListener, handleAutomationEvent } = wire({ id: 'r1', path: '/repo' })
    statusListener({
      paneKey: 'pane-1',
      connectionId: null,
      worktreeId: 'r1::/repo',
      receivedAt: 1,
      stateStartedAt: 1,
      payload: { state: 'done' }
    } as EnrichedAgentHookEventPayload)
    expect(handleAutomationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: 'r1',
        event: expect.objectContaining({ kind: 'agent_done' })
      })
    )
  })
})
