import React from 'react'
import { AgentIcon } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { LaunchRole } from './launch-agent-roles'
import type { LaunchAgentSlot } from './launch-agents-requests'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.launch-agents.LaunchAgentSlots.${id}`, fallback)

const SELECT_CLASS =
  'h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-xs'

/** The catalog default model for an agent, or null when the agent has no model catalog. */
export function defaultLaunchModel(agent: TuiAgent): string | null {
  const models = getAgentSessionOptionCatalog(agent)?.models ?? []
  return (models.find((model) => model.isDefault) ?? models[0])?.id ?? null
}

/** Grow or shrink to `count`, keeping existing picks; new slots copy the last one so a mixed wave is quick to build. */
export function resizeLaunchSlots(
  slots: readonly LaunchAgentSlot[],
  count: number,
  fallbackAgent: TuiAgent | null
): LaunchAgentSlot[] {
  const next = slots.slice(0, count)
  while (next.length < count) {
    const template = next.at(-1)
    if (template) {
      next.push({ ...template })
    } else if (fallbackAgent) {
      next.push({ agent: fallbackAgent, model: defaultLaunchModel(fallbackAgent) })
    } else {
      break
    }
  }
  return next
}

export function LaunchAgentSlots({
  slots,
  agents,
  roles,
  onChange
}: {
  slots: readonly LaunchAgentSlot[]
  agents: readonly { id: TuiAgent; label: string }[]
  roles: readonly (LaunchRole | null)[]
  onChange: (index: number, slot: LaunchAgentSlot) => void
}): React.JSX.Element | null {
  if (slots.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{T('agentsAndModels', 'Agent and model for each')}</span>
      <ol className="scrollbar-sleek max-h-56 overflow-y-auto rounded-md border border-border">
        {slots.map((slot, index) => {
          const models = getAgentSessionOptionCatalog(slot.agent)?.models ?? []
          const role = roles[index]
          return (
            <li
              key={index}
              className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0 sm:flex-nowrap"
            >
              <span className="w-4 text-center text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <AgentIcon agent={slot.agent} size={12} />
              <select
                aria-label={`${T('agentFor', 'Agent')} ${index + 1}`}
                className={SELECT_CLASS}
                value={slot.agent}
                onChange={(event) => {
                  const agent = event.target.value as TuiAgent
                  onChange(index, { agent, model: defaultLaunchModel(agent) })
                }}
              >
                {agents.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
              {models.length === 0 || slot.model === null ? (
                <span className="flex-1 truncate text-xs text-muted-foreground">
                  {T('agentDefault', 'Default model')}
                </span>
              ) : (
                <select
                  aria-label={`${T('modelFor', 'Model')} ${index + 1}`}
                  className={SELECT_CLASS}
                  value={slot.model}
                  onChange={(event) => onChange(index, { ...slot, model: event.target.value })}
                >
                  {models.map((entry) => (
                    <option key={entry.id} value={entry.id} title={entry.description}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              )}
              {role ? (
                <span className="shrink-0 text-xs text-muted-foreground">{role.label}</span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
