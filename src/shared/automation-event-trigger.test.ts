import { describe, expect, it } from 'vitest'
import {
  agentDoneEventKey,
  appendAutomationEventContext,
  isAutomationEventKind,
  reviewChecksFailedEventKey,
  reviewOpenedEventKey
} from './automation-event-trigger'

describe('automation event trigger', () => {
  it('appends the event summary and link after the prompt', () => {
    expect(
      appendAutomationEventContext('Fix CI.\n', {
        kind: 'review_checks_failed',
        key: 'k',
        summary: 'Checks failed on PR #12 (feature/x)',
        url: 'https://example.test/pr/12'
      })
    ).toBe(
      'Fix CI.\n\nTriggered by: Checks failed on PR #12 (feature/x)\nLink: https://example.test/pr/12'
    )
  })

  it('omits the link line when the event has no url', () => {
    expect(
      appendAutomationEventContext('Review it', {
        kind: 'agent_done',
        key: 'k',
        summary: 'Claude finished in feature/x'
      })
    ).toBe('Review it\n\nTriggered by: Claude finished in feature/x')
  })

  it('builds stable dedupe keys', () => {
    expect(
      reviewOpenedEventKey({ provider: 'github', executionHostId: 'local', repoPath: '/r', number: 3 })
    ).toBe('review_opened:github:local:/r:3')
    expect(
      reviewChecksFailedEventKey({
        provider: 'gitlab',
        executionHostId: 'ssh:1',
        repoPath: '/r',
        number: 3,
        revision: 'abc'
      })
    ).toBe('review_checks_failed:gitlab:ssh:1:/r:3:abc')
    expect(agentDoneEventKey({ paneKey: 'tab:leaf', stateStartedAt: 42 })).toBe(
      'agent_done:tab:leaf:42'
    )
  })

  it('recognizes only the v1 event kinds', () => {
    expect(isAutomationEventKind('agent_done')).toBe(true)
    expect(isAutomationEventKind('issue_assigned')).toBe(false)
  })
})
