import type { Store } from '../persistence'
import {
  AUTOMATION_EVENT_COOLDOWN_MS,
  appendAutomationEventContext,
  type AutomationRunTriggerEvent
} from '../../shared/automation-event-trigger'
import { getAutomationRunRepoId } from '../../shared/automation-run-identity'
import type { Automation, AutomationRun } from '../../shared/automations-types'
import {
  automationSchedulableOnThisHost,
  type AutomationRunTargetResult
} from './run-target-resolution'
import type { AutomationRunWriter } from './automation-run-writer'

/** A detected event, plus the repo it happened in — for matching against automations' own repoId. */
export type DetectedAutomationEvent = {
  event: AutomationRunTriggerEvent
  repoId: string
}

export function automationMatchesEvent(
  automation: Automation,
  detected: DetectedAutomationEvent
): boolean {
  return (
    automation.enabled &&
    automation.eventTrigger?.kind === detected.event.kind &&
    getAutomationRunRepoId(automation) === detected.repoId
  )
}

/** An automation runs at most once per event key, even across process restarts. */
export function automationEventAlreadyRun(
  store: Store,
  automationId: string,
  key: string
): boolean {
  return store.listAutomationRuns(automationId).some((run) => run.triggerEvent?.key === key)
}

export function automationEventInCooldown(
  store: Store,
  automationId: string,
  now = Date.now()
): boolean {
  const latest = store
    .listAutomationRuns(automationId)
    .filter((run) => run.trigger === 'event')
    .reduce<AutomationRun | null>(
      (newest, run) => (!newest || run.createdAt > newest.createdAt ? run : newest),
      null
    )
  return latest !== null && now - latest.createdAt < AUTOMATION_EVENT_COOLDOWN_MS
}

export type AutomationEventRunContext = {
  store: Store
  detected: DetectedAutomationEvent
  allowRemoteHostScheduling: boolean
  runs: AutomationRunWriter
  resolveTarget: (automation: Automation) => AutomationRunTargetResult
  requestDispatch: (
    automation: Automation,
    run: AutomationRun,
    target: AutomationRunTargetResult
  ) => Promise<AutomationRun>
}

/** Runs every automation subscribed to `detected.event.kind` in its repo, once per event key. */
export async function runAutomationEvent(ctx: AutomationEventRunContext): Promise<void> {
  for (const automation of ctx.store.listAutomations()) {
    if (!automationMatchesEvent(automation, ctx.detected)) {
      continue
    }
    // Why: a runtime host's own automations are the server's to run; the desktop
    // client sees the same store and must stay silent, not write a refusal row.
    if (
      !automationSchedulableOnThisHost(automation, {
        allowRemoteHostScheduling: ctx.allowRemoteHostScheduling
      })
    ) {
      continue
    }
    if (automationEventAlreadyRun(ctx.store, automation.id, ctx.detected.event.key)) {
      continue
    }
    if (automationEventInCooldown(ctx.store, automation.id)) {
      continue
    }
    const run = ctx.runs.createRun(automation, Date.now(), 'event', ctx.detected.event)
    const promptedAutomation: Automation = {
      ...automation,
      prompt: appendAutomationEventContext(automation.prompt, ctx.detected.event)
    }
    await ctx.requestDispatch(promptedAutomation, run, ctx.resolveTarget(automation))
  }
}
