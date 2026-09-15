import React from 'react'
import { AgentIcon } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import type { LaunchAgentSlot } from './launch-agents-requests'

const T = (id: string, fallback: string, options?: Record<string, unknown>): string =>
  translate(`auto.components.launch-agents.LaunchAgentsLineup.${id}`, fallback, options)

const SELECT_CLASS =
  'h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-xs'

/**
 * WILL LAUNCH: one row per seat — its number, the agent icon and label, and a
 * per-seat model dropdown. Changing a row's model affects only that seat.
 */
export function LaunchAgentsLineup({
  slots,
  agentLabel,
  onModelChange
}: {
  slots: readonly LaunchAgentSlot[]
  agentLabel: (agent: LaunchAgentSlot['agent']) => string
  onModelChange: (index: number, model: string | null) => void
}): React.JSX.Element | null {
  if (slots.length === 0) {
    return null
  }
  return (
    <ol className="scrollbar-sleek max-h-56 overflow-y-auto rounded-md border border-border">
      {slots.map((slot, index) => {
        const models = getAgentSessionOptionCatalog(slot.agent)?.models ?? []
        return (
          <li
            key={index}
            className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0 sm:flex-nowrap"
          >
            <span className="w-5 text-center text-xs tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <AgentIcon agent={slot.agent} size={14} />
            <span className="min-w-0 flex-1 truncate text-xs">{agentLabel(slot.agent)}</span>
            {models.length === 0 ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                {T('agentDefault', 'Default model')}
              </span>
            ) : (
              <select
                aria-label={`${T('modelFor', 'Model')} ${index + 1}`}
                className={SELECT_CLASS}
                value={slot.model ?? ''}
                onChange={(event) => onModelChange(index, event.target.value || null)}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id} title={model.description}>
                    {model.label}
                  </option>
                ))}
              </select>
            )}
          </li>
        )
      })}
    </ol>
  )
}
