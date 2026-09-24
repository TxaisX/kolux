// Event triggers: an automation that runs when something happens, instead of on its schedule.

export const AUTOMATION_EVENT_KINDS = ['review_opened', 'review_checks_failed', 'agent_done'] as const
export type AutomationEventKind = (typeof AUTOMATION_EVENT_KINDS)[number]

/** Set on an automation that runs on an event; absent/null means it runs on its rrule. */
export type AutomationEventTrigger = { kind: AutomationEventKind }

/** The event that started an `event` run, persisted on the run for dedupe and history. */
export type AutomationRunTriggerEvent = {
  kind: AutomationEventKind
  /** Dedupe identity: an automation runs at most once per key. */
  key: string
  /** One line, appended to the prompt and shown in run history. */
  summary: string
  url?: string
}

/** Minimum gap between two event runs of the same automation. */
export const AUTOMATION_EVENT_COOLDOWN_MS = 5 * 60_000

export function isAutomationEventKind(value: unknown): value is AutomationEventKind {
  return (AUTOMATION_EVENT_KINDS as readonly unknown[]).includes(value)
}

export function reviewOpenedEventKey(parts: {
  provider: string
  executionHostId: string
  repoPath: string
  number: number
}): string {
  return `review_opened:${parts.provider}:${parts.executionHostId}:${parts.repoPath}:${parts.number}`
}

export function reviewChecksFailedEventKey(parts: {
  provider: string
  executionHostId: string
  repoPath: string
  number: number
  /** headSha when the provider reports one, else the review's updatedAt. */
  revision: string
}): string {
  return `review_checks_failed:${parts.provider}:${parts.executionHostId}:${parts.repoPath}:${parts.number}:${parts.revision}`
}

export function agentDoneEventKey(parts: { paneKey: string; stateStartedAt: number }): string {
  return `agent_done:${parts.paneKey}:${parts.stateStartedAt}`
}

export function appendAutomationEventContext(
  prompt: string,
  event: AutomationRunTriggerEvent
): string {
  const lines = [`Triggered by: ${event.summary}`]
  if (event.url) {
    lines.push(`Link: ${event.url}`)
  }
  return `${prompt.trimEnd()}\n\n${lines.join('\n')}`
}
