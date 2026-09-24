import { describe, expect, it, vi } from 'vitest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import type { Automation } from '../../../shared/automations-types'
import {
  createAutomationRun,
  listAutomationRunsPage,
  type AutomationRunOperations
} from './automation-run-operations'

function stateWithRuns(runs: { id: string; createdAt: number }[]): PersistedState {
  return {
    automationRuns: runs.map((run) => ({ ...run, automationId: 'a1' }))
  } as PersistedState
}

function makeOperations(state: Partial<PersistedState> = {}): AutomationRunOperations {
  return {
    state: { automations: [], automationRuns: [], ...state } as PersistedState,
    flush: vi.fn(),
    recordManualRun: vi.fn(),
    getWorkspaceDisplayName: () => null
  }
}

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    name: 'On PR opened',
    prompt: 'Review it',
    precheck: null,
    agentId: 'claude',
    projectId: 'r1',
    executionTargetType: 'local',
    executionTargetId: 'local',
    schedulerOwner: 'local_host_service',
    workspaceMode: 'new_per_run',
    workspaceId: null,
    baseBranch: null,
    reuseSession: false,
    timezone: 'UTC',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    dtstart: 0,
    enabled: true,
    nextRunAt: 0,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 720,
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

describe('createAutomationRun', () => {
  it('persists a triggerEvent when one is passed for an event-triggered run', () => {
    const operations = makeOperations()
    const triggerEvent = {
      kind: 'review_opened' as const,
      key: 'review_opened:github:local:/repo:3',
      summary: 'PR #3 was opened'
    }

    const run = createAutomationRun(operations, makeAutomation(), Date.now(), 'event', triggerEvent)

    expect(run.trigger).toBe('event')
    expect(run.triggerEvent).toEqual(triggerEvent)
  })

  it('omits triggerEvent for a scheduled run', () => {
    const operations = makeOperations()

    const run = createAutomationRun(operations, makeAutomation(), Date.now())

    expect(run.trigger).toBe('scheduled')
    expect(run.triggerEvent).toBeUndefined()
  })
})

describe('listAutomationRunsPage', () => {
  it('returns a bounded, newest-first page and an opaque continuation cursor', () => {
    const state = stateWithRuns([
      { id: 'old', createdAt: 1 },
      { id: 'new', createdAt: 3 },
      { id: 'middle', createdAt: 2 }
    ])

    const first = listAutomationRunsPage(state, 'a1', 2)
    expect(first.runs.map((run) => run.id)).toEqual(['new', 'middle'])
    expect(first.nextCursor).not.toBeNull()

    expect(listAutomationRunsPage(state, 'a1', 2, first.nextCursor ?? undefined)).toEqual(
      expect.objectContaining({
        runs: [expect.objectContaining({ id: 'old' })],
        nextCursor: null
      })
    )
  })

  it('keeps the window stable when a newer run lands between pages', () => {
    const state = stateWithRuns([
      { id: 'r1', createdAt: 1 },
      { id: 'r2', createdAt: 2 },
      { id: 'r3', createdAt: 3 }
    ])

    const first = listAutomationRunsPage(state, 'a1', 2)
    expect(first.runs.map((run) => run.id)).toEqual(['r3', 'r2'])

    state.automationRuns = [
      ...state.automationRuns,
      { id: 'r4', automationId: 'a1', createdAt: 4 } as PersistedState['automationRuns'][number]
    ]

    const second = listAutomationRunsPage(state, 'a1', 2, first.nextCursor ?? undefined)
    expect(second.runs.map((run) => run.id)).toEqual(['r1'])
    expect(second.nextCursor).toBeNull()
  })

  it('resumes after a pruned boundary run instead of restarting the page', () => {
    const state = stateWithRuns([
      { id: 'r1', createdAt: 1 },
      { id: 'r2', createdAt: 2 },
      { id: 'r3', createdAt: 3 }
    ])
    const first = listAutomationRunsPage(state, 'a1', 2)

    state.automationRuns = state.automationRuns.filter((run) => run.id !== 'r2')

    expect(
      listAutomationRunsPage(state, 'a1', 2, first.nextCursor ?? undefined).runs.map(
        (run) => run.id
      )
    ).toEqual(['r1'])
  })

  it('keeps runs tied on createdAt when the boundary run is pruned', () => {
    const state = stateWithRuns([
      { id: 'r2', createdAt: 10 },
      { id: 'r1', createdAt: 10 },
      { id: 'r0', createdAt: 5 }
    ])
    const first = listAutomationRunsPage(state, 'a1', 1)
    expect(first.runs.map((run) => run.id)).toEqual(['r1'])

    state.automationRuns = state.automationRuns.filter((run) => run.id !== 'r1')

    expect(
      listAutomationRunsPage(state, 'a1', 2, first.nextCursor ?? undefined).runs.map(
        (run) => run.id
      )
    ).toEqual(['r2', 'r0'])
  })

  it('still honours a legacy offset cursor issued before the upgrade', () => {
    const state = stateWithRuns([
      { id: 'r1', createdAt: 1 },
      { id: 'r2', createdAt: 2 },
      { id: 'r3', createdAt: 3 }
    ])

    expect(listAutomationRunsPage(state, 'a1', 2, '2').runs.map((run) => run.id)).toEqual(['r1'])
  })
})
