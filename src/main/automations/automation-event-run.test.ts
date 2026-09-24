import { describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'
import type { Automation, AutomationRun } from '../../shared/automations-types'
import { AUTOMATION_EVENT_COOLDOWN_MS } from '../../shared/automation-event-trigger'
import {
  automationEventAlreadyRun,
  automationEventInCooldown,
  automationMatchesEvent,
  runAutomationEvent,
  type DetectedAutomationEvent
} from './automation-event-run'
import type { AutomationRunTargetResult } from './run-target-resolution'

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
    eventTrigger: { kind: 'review_opened' },
    createdAt: 0,
    updatedAt: 0,
    ...overrides
  }
}

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: 'run-1',
    automationId: 'a1',
    title: 'run 1',
    scheduledFor: 0,
    status: 'pending',
    trigger: 'event',
    workspaceId: null,
    sessionKind: 'terminal',
    chatSessionId: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    outputSnapshot: null,
    precheckResult: null,
    usage: null,
    error: null,
    startedAt: null,
    dispatchedAt: null,
    createdAt: 0,
    ...overrides
  }
}

const detected: DetectedAutomationEvent = {
  event: {
    kind: 'review_opened',
    key: 'review_opened:github:local:/repo:3',
    summary: 'PR #3 opened'
  },
  repoId: 'r1'
}

function fakeStore(
  automations: Automation[],
  runsByAutomation: Record<string, AutomationRun[]> = {}
) {
  return {
    listAutomations: () => automations,
    listAutomationRuns: (automationId?: string) =>
      automationId ? (runsByAutomation[automationId] ?? []) : Object.values(runsByAutomation).flat()
  } as unknown as Store
}

describe('automationMatchesEvent', () => {
  it('matches an enabled automation on kind and repo', () => {
    expect(automationMatchesEvent(makeAutomation(), detected)).toBe(true)
  })

  it('does not match a disabled automation', () => {
    expect(automationMatchesEvent(makeAutomation({ enabled: false }), detected)).toBe(false)
  })

  it('does not match a different event kind', () => {
    expect(
      automationMatchesEvent(makeAutomation({ eventTrigger: { kind: 'agent_done' } }), detected)
    ).toBe(false)
  })

  it('does not match a different repo', () => {
    expect(automationMatchesEvent(makeAutomation({ projectId: 'other-repo' }), detected)).toBe(
      false
    )
  })

  it('does not match a scheduled automation (no eventTrigger)', () => {
    expect(automationMatchesEvent(makeAutomation({ eventTrigger: undefined }), detected)).toBe(
      false
    )
  })
})

describe('automationEventAlreadyRun', () => {
  it('is true once a kept run carries the same key', () => {
    const store = fakeStore([], { a1: [makeRun({ triggerEvent: detected.event })] })
    expect(automationEventAlreadyRun(store, 'a1', detected.event.key)).toBe(true)
  })

  it('is false for a different key', () => {
    const store = fakeStore([], {
      a1: [makeRun({ triggerEvent: { ...detected.event, key: 'other-key' } })]
    })
    expect(automationEventAlreadyRun(store, 'a1', detected.event.key)).toBe(false)
  })
})

describe('automationEventInCooldown', () => {
  it('is true within the cooldown window of the latest event run', () => {
    const store = fakeStore([], { a1: [makeRun({ trigger: 'event', createdAt: 1000 })] })
    expect(automationEventInCooldown(store, 'a1', 1000 + AUTOMATION_EVENT_COOLDOWN_MS - 1)).toBe(
      true
    )
  })

  it('is false once the cooldown has elapsed', () => {
    const store = fakeStore([], { a1: [makeRun({ trigger: 'event', createdAt: 1000 })] })
    expect(automationEventInCooldown(store, 'a1', 1000 + AUTOMATION_EVENT_COOLDOWN_MS)).toBe(false)
  })

  it('ignores scheduled/manual runs when finding the latest event run', () => {
    const store = fakeStore([], {
      a1: [makeRun({ trigger: 'scheduled', createdAt: 999_999 })]
    })
    expect(automationEventInCooldown(store, 'a1', 999_999)).toBe(false)
  })
})

describe('runAutomationEvent', () => {
  const okTarget: AutomationRunTargetResult = { ok: true, cwd: '/repo', repo: {} as never }

  it('dispatches a matching automation once per event key', async () => {
    const automation = makeAutomation()
    const store = fakeStore([automation])
    const createRun = vi.fn().mockReturnValue(makeRun())
    const requestDispatch = vi.fn().mockResolvedValue(makeRun())
    await runAutomationEvent({
      store,
      detected,
      allowRemoteHostScheduling: false,
      runs: { createRun, updateRun: vi.fn(), repeatSkip: vi.fn() } as never,
      resolveTarget: () => okTarget,
      requestDispatch
    })

    expect(createRun).toHaveBeenCalledWith(automation, expect.any(Number), 'event', detected.event)
    expect(requestDispatch).toHaveBeenCalledTimes(1)
    const [dispatchedAutomation] = requestDispatch.mock.calls[0]
    expect(dispatchedAutomation.prompt).toBe('Review it\n\nTriggered by: PR #3 opened')
  })

  it('does not dispatch a second time once the key has already run', async () => {
    const automation = makeAutomation()
    const store = fakeStore([automation], { a1: [makeRun({ triggerEvent: detected.event })] })
    const createRun = vi.fn()
    const requestDispatch = vi.fn()
    await runAutomationEvent({
      store,
      detected,
      allowRemoteHostScheduling: false,
      runs: { createRun, updateRun: vi.fn(), repeatSkip: vi.fn() } as never,
      resolveTarget: () => okTarget,
      requestDispatch
    })

    expect(createRun).not.toHaveBeenCalled()
    expect(requestDispatch).not.toHaveBeenCalled()
  })

  it('does not dispatch while the automation is in its event cooldown', async () => {
    const automation = makeAutomation()
    const store = fakeStore([automation], {
      a1: [makeRun({ trigger: 'event', createdAt: Date.now() })]
    })
    const createRun = vi.fn()
    const requestDispatch = vi.fn()
    await runAutomationEvent({
      store,
      detected,
      allowRemoteHostScheduling: false,
      runs: { createRun, updateRun: vi.fn(), repeatSkip: vi.fn() } as never,
      resolveTarget: () => okTarget,
      requestDispatch
    })

    expect(createRun).not.toHaveBeenCalled()
    expect(requestDispatch).not.toHaveBeenCalled()
  })

  it('skips a runtime-host automation without writing a run row', async () => {
    const automation = makeAutomation({
      schedulerOwner: 'remote_host_service',
      runContext: {
        kind: 'workspace-run',
        projectId: 'p1',
        hostId: 'runtime:gpu-server',
        projectHostSetupId: 'setup-1',
        repoId: 'r1',
        path: '/repo'
      }
    })
    const store = fakeStore([automation])
    const createRun = vi.fn()
    const requestDispatch = vi.fn()
    await runAutomationEvent({
      store,
      detected,
      allowRemoteHostScheduling: false,
      runs: { createRun, updateRun: vi.fn(), repeatSkip: vi.fn() } as never,
      resolveTarget: () => okTarget,
      requestDispatch
    })

    expect(createRun).not.toHaveBeenCalled()
    expect(requestDispatch).not.toHaveBeenCalled()
  })
})
