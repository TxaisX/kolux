import {
  agentDoneEventKey,
  reviewChecksFailedEventKey,
  reviewOpenedEventKey,
  type AutomationRunTriggerEvent
} from '../../shared/automation-event-trigger'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import type { HostedReviewInfo } from '../../shared/hosted-review'
import type { Store } from '../persistence'
import type { EnrichedAgentHookEventPayload } from '../agent-hooks/server/server-types'
import { getRepoHostedReviewExecutionHostId } from '../source-control/hosted-review-execution-host'
import {
  setHostedReviewObserver,
  type HostedReviewObservedIdentity
} from '../source-control/hosted-review'
import type { AutomationService } from './service'

const MAX_REMEMBERED_BRANCH_ANSWERS = 500

/** Pure: the events a branch's review answer transitioned into, or none. `prev` is the last
 *  observed answer for the branch (never a startup baseline — the caller only calls this once
 *  a baseline exists), so a first-ever `null` still reports "no review" rather than "opened". */
export function reviewTransitionEvent(
  prev: HostedReviewInfo | null,
  next: HostedReviewInfo | null,
  identity: Pick<HostedReviewObservedIdentity, 'executionHostId' | 'repoPath'>
): AutomationRunTriggerEvent[] {
  if (!next) {
    return []
  }
  const keyParts = {
    provider: next.provider,
    executionHostId: identity.executionHostId,
    repoPath: identity.repoPath,
    number: next.number
  }
  const events: AutomationRunTriggerEvent[] = []
  if (prev === null && (next.state === 'open' || next.state === 'draft')) {
    events.push({
      kind: 'review_opened',
      key: reviewOpenedEventKey(keyParts),
      summary: `${next.title} (#${next.number}) was opened`,
      url: next.url
    })
  }
  if (prev?.status !== 'failure' && next.status === 'failure') {
    events.push({
      kind: 'review_checks_failed',
      key: reviewChecksFailedEventKey({ ...keyParts, revision: next.headSha ?? next.updatedAt }),
      summary: `Checks failed on ${next.title} (#${next.number})`,
      url: next.url
    })
  }
  return events
}

/** Pure: whether this status change is a real, fresh turn completion worth an event. */
export function agentDoneEvent(enriched: EnrichedAgentHookEventPayload): AutomationRunTriggerEvent | null {
  if (
    enriched.payload.state !== 'done' ||
    enriched.payload.interrupted === true ||
    enriched.payload.sessionBoundary === true ||
    enriched.restoredUnconfirmed === true ||
    !enriched.worktreeId
  ) {
    return null
  }
  const agentLabel = enriched.payload.agentType?.trim() || 'An agent'
  return {
    kind: 'agent_done',
    key: agentDoneEventKey({ paneKey: enriched.paneKey, stateStartedAt: enriched.stateStartedAt }),
    summary: `${agentLabel} finished a turn`
  }
}

/** True when `paneKey` is the terminal an automation run is (or was) executing in — firing
 *  `agent_done` for it would let an automation's own dispatch trigger another automation run. */
export function isAutomationRunOwnedPane(store: Store, paneKey: string): boolean {
  return store.listAutomationRuns().some((run) => run.terminalPaneKey === paneKey)
}

function rememberBranchAnswer(
  answers: Map<string, HostedReviewInfo | null>,
  key: string,
  value: HostedReviewInfo | null
): void {
  answers.delete(key)
  answers.set(key, value)
  while (answers.size > MAX_REMEMBERED_BRANCH_ANSWERS) {
    const oldest = answers.keys().next().value
    if (oldest === undefined) {
      break
    }
    answers.delete(oldest)
  }
}

/** Taps the hosted-review poll and the agent-hook status stream for event detection, and hands
 *  matching transitions to the service. Owns the per-branch baseline so a fresh process never
 *  fires a burst of events for reviews that already existed before it started. */
export function wireAutomationEventSources(deps: {
  store: Store
  service: Pick<AutomationService, 'handleAutomationEvent'>
  agentHookServer: { subscribeEnrichedStatus: (listener: (payload: EnrichedAgentHookEventPayload) => void) => () => void }
}): void {
  const { store, service, agentHookServer } = deps
  const lastReviewByBranch = new Map<string, HostedReviewInfo | null>()

  setHostedReviewObserver((identity, review) => {
    const key = `${identity.executionHostId}\0${identity.repoPath}\0${identity.branch}`
    const hasBaseline = lastReviewByBranch.has(key)
    const prev = lastReviewByBranch.get(key) ?? null
    rememberBranchAnswer(lastReviewByBranch, key, review)
    if (!hasBaseline) {
      return
    }
    const repo = store
      .getRepos()
      .find(
        (candidate) =>
          candidate.path === identity.repoPath &&
          getRepoHostedReviewExecutionHostId(candidate) === identity.executionHostId
      )
    if (!repo) {
      return
    }
    for (const event of reviewTransitionEvent(prev, review, identity)) {
      void service.handleAutomationEvent({ event, repoId: repo.id })
    }
  })

  agentHookServer.subscribeEnrichedStatus((enriched) => {
    if (isAutomationRunOwnedPane(store, enriched.paneKey)) {
      return
    }
    const event = agentDoneEvent(enriched)
    if (!event || !enriched.worktreeId) {
      return
    }
    void service.handleAutomationEvent({ event, repoId: getRepoIdFromWorktreeId(enriched.worktreeId) })
  })
}
