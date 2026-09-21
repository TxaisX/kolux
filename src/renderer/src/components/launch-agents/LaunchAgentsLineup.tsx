import React from 'react'
import { AgentIcon } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import type { CatalogOption } from '../../../../shared/agent-session-option-catalog-types'
import type { SessionOptionValue } from '../../../../shared/native-chat-session-options'
import type { LaunchAgentSlot } from './launch-agents-requests'

const T = (id: string, fallback: string, options?: Record<string, unknown>): string =>
  translate(`auto.components.launch-agents.LaunchAgentsLineup.${id}`, fallback, options)

const SELECT_CLASS =
  'h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-1.5 text-xs'

/**
 * WILL LAUNCH: one row per seat — its number, the agent icon and label, a
 * per-seat model dropdown, and a control for each option the selected model
 * declares (e.g. `effort`, `fastMode`). A model with no declared options
 * renders no extra controls. Changing a row's model or option affects only
 * that seat.
 */
export function LaunchAgentsLineup({
  slots,
  agentLabel,
  onModelChange,
  onOptionChange
}: {
  slots: readonly LaunchAgentSlot[]
  agentLabel: (agent: LaunchAgentSlot['agent']) => string
  onModelChange: (index: number, model: string | null) => void
  onOptionChange: (index: number, optionId: string, value: SessionOptionValue) => void
}): React.JSX.Element | null {
  if (slots.length === 0) {
    return null
  }
  return (
    <ol className="scrollbar-sleek max-h-56 overflow-y-auto rounded-md border border-border">
      {slots.map((slot, index) => {
        const models = getAgentSessionOptionCatalog(slot.agent)?.models ?? []
        const selectedModel = models.find((model) => model.id === slot.model)
        const options = selectedModel?.options ?? []
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
            {options.map((option) => (
              <LaunchAgentOptionControl
                key={option.id}
                seatIndex={index}
                option={option}
                value={slot.options?.[option.id]}
                onChange={(value) => onOptionChange(index, option.id, value)}
              />
            ))}
          </li>
        )
      })}
    </ol>
  )
}

/** One catalog-declared option's control: a select for `select` kind, a
 *  checkbox for `boolean` kind. Shows the catalog default until the seat
 *  overrides it. */
function LaunchAgentOptionControl({
  seatIndex,
  option,
  value,
  onChange
}: {
  seatIndex: number
  option: CatalogOption
  value: SessionOptionValue | undefined
  onChange: (value: SessionOptionValue) => void
}): React.JSX.Element {
  const label = `${option.label} ${seatIndex + 1}`
  if (option.kind.type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : option.kind.defaultValue
    return (
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <input
          type="checkbox"
          aria-label={label}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        {option.label}
      </label>
    )
  }
  const current = typeof value === 'string' ? value : option.kind.defaultValue
  return (
    <select
      aria-label={label}
      className={SELECT_CLASS}
      value={current}
      onChange={(event) => onChange(event.target.value)}
    >
      {option.kind.choices.map((choice) => (
        <option key={choice.value} value={choice.value} title={choice.description}>
          {choice.label}
        </option>
      ))}
    </select>
  )
}
