import React from 'react'
import { AgentIcon } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import type { TuiAgent } from '../../../../shared/tui-agent'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.launch-agents.LaunchModelPicker.${id}`, fallback)

const SELECT_CLASS =
  'h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm'

/** The model a wave opens on: the user's pick if this agent offers it, else the catalog default. */
export function resolveLaunchModel(agent: TuiAgent, picked: string | null): string | null {
  const models = getAgentSessionOptionCatalog(agent)?.models ?? []
  if (picked && models.some((model) => model.id === picked)) {
    return picked
  }
  return (models.find((model) => model.isDefault) ?? models[0])?.id ?? null
}

export function LaunchModelPicker({
  agents,
  agentId,
  onAgentChange,
  model,
  onModelChange
}: {
  agents: readonly { id: TuiAgent; label: string }[]
  agentId: TuiAgent
  onAgentChange: (agent: TuiAgent) => void
  model: string | null
  onModelChange: (model: string) => void
}): React.JSX.Element {
  const models = getAgentSessionOptionCatalog(agentId)?.models ?? []
  return (
    <div className="flex flex-col gap-3 text-sm sm:flex-row">
      {agents.length > 1 ? (
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="font-medium">{T('agent', 'Agent')}</span>
          <div className="flex items-center gap-2">
            <AgentIcon agent={agentId} size={14} />
            <select
              className={SELECT_CLASS}
              value={agentId}
              onChange={(event) => onAgentChange(event.target.value as TuiAgent)}
            >
              {agents.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          </div>
        </label>
      ) : null}
      <label className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="font-medium">{T('model', 'Model')}</span>
        {models.length === 0 || model === null ? (
          <p className="flex h-8 items-center text-xs text-muted-foreground">
            {T('agentDefault', "Uses this agent's own default model")}
          </p>
        ) : (
          <select
            className={SELECT_CLASS}
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
          >
            {models.map((entry) => (
              <option key={entry.id} value={entry.id} title={entry.description}>
                {entry.label}
              </option>
            ))}
          </select>
        )}
      </label>
    </div>
  )
}
