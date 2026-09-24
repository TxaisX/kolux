import type React from 'react'
import { useState } from 'react'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import {
  ORCHESTRATION_ROUTING_TIERS,
  ORCHESTRATION_ROUTING_TIER_LABELS,
  resolveOrchestrationRoutingRoute,
  type OrchestrationRoutingRoute,
  type OrchestrationRoutingTier
} from '../../../../shared/orchestration-routing-tiers'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { getEffortChoices, getRoutableAgents, routeForModelChange } from './model-routing-draft'
import { SettingsSegmentedControl, SettingsSubsectionHeader } from './SettingsFormControls'

const NOT_SET_VALUE = '__model_routing_not_set__'
const SELECT_TRIGGER_CLASS = 'h-7 w-full text-xs'

type ModelRoutingSectionProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
  /** null while detection hasn't resolved yet; undetected providers are marked, not hidden. */
  detectedIds: Set<string> | null
}

export function ModelRoutingSection({
  settings,
  updateSettings,
  detectedIds
}: ModelRoutingSectionProps): React.JSX.Element {
  const routableAgents = getRoutableAgents(getAgentCatalog())
  const [selectedAgent, setSelectedAgent] = useState<TuiAgent>(
    () => routableAgents[0]?.id ?? 'claude'
  )
  const overrides = settings.orchestrationRouting
  const agentOverrides = overrides?.[selectedAgent]
  const models = getAgentSessionOptionCatalog(selectedAgent)?.models ?? []

  const setRoute = (tier: OrchestrationRoutingTier, route: OrchestrationRoutingRoute): void => {
    updateSettings({
      orchestrationRouting: { ...overrides, [selectedAgent]: { ...agentOverrides, [tier]: route } }
    })
  }

  const resetTier = (tier: OrchestrationRoutingTier): void => {
    if (!agentOverrides || !(tier in agentOverrides)) {
      return
    }
    const nextAgentOverrides = { ...agentOverrides }
    delete nextAgentOverrides[tier]
    const next = { ...overrides }
    if (Object.keys(nextAgentOverrides).length === 0) {
      delete next[selectedAgent]
    } else {
      next[selectedAgent] = nextAgentOverrides
    }
    updateSettings({ orchestrationRouting: next })
  }

  return (
    <section className="space-y-4">
      <SettingsSubsectionHeader
        title={translate('auto.components.settings.ModelRoutingSection.title', 'Model routing')}
        description={translate(
          'auto.components.settings.ModelRoutingSection.description',
          "Each provider orchestrates its own models. Coordinators pick a tier per task; Kolux launches that tier's model on the same provider."
        )}
      />
      <SettingsSegmentedControl<TuiAgent>
        ariaLabel={translate('auto.components.settings.ModelRoutingSection.provider', 'Provider')}
        value={selectedAgent}
        onChange={setSelectedAgent}
        options={routableAgents.map((agent) => {
          const isUndetected = detectedIds !== null && !detectedIds.has(agent.id)
          return {
            value: agent.id,
            label: (
              <span className="inline-flex items-center gap-1.5">
                <AgentIcon agent={agent.id} size={12} />
                {agent.label}
              </span>
            ),
            tooltip: isUndetected
              ? translate(
                  'auto.components.settings.ModelRoutingSection.agentNotDetected',
                  'Not detected on this machine'
                )
              : undefined
          }
        })}
      />
      <div className="divide-y divide-border rounded-md border border-border">
        {ORCHESTRATION_ROUTING_TIERS.map((tier) => {
          const { label, description } = ORCHESTRATION_ROUTING_TIER_LABELS[tier]
          const route = resolveOrchestrationRoutingRoute(selectedAgent, tier, overrides)
          const effortChoices = route ? getEffortChoices(selectedAgent, route.model) : null
          const hasOverride = agentOverrides ? tier in agentOverrides : false

          return (
            <div key={tier} data-tier={tier} className="flex flex-wrap items-start gap-3 px-3 py-3">
              <div className="min-w-0 flex-1 sm:min-w-[11rem]">
                <div className="text-sm font-medium leading-none">{label}</div>
                <p className="mt-1 text-xs text-muted-foreground">{description}</p>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-1.5 sm:w-[16rem]">
                <Select
                  value={route?.model ?? NOT_SET_VALUE}
                  onValueChange={(value) => {
                    if (value !== NOT_SET_VALUE) {
                      setRoute(tier, routeForModelChange(selectedAgent, value, route?.effort))
                    }
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={translate(
                      'auto.components.settings.ModelRoutingSection.modelFor',
                      '{{value0}} model',
                      { value0: label }
                    )}
                    className={SELECT_TRIGGER_CLASS}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {!route ? (
                      <SelectItem value={NOT_SET_VALUE}>
                        {translate(
                          'auto.components.settings.ModelRoutingSection.notSet',
                          'Not set'
                        )}
                      </SelectItem>
                    ) : null}
                    {models.map((model) => (
                      <SelectItem key={model.id} value={model.id} title={model.description}>
                        {model.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {effortChoices && route ? (
                  <Select
                    value={route.effort ?? effortChoices[0]?.value}
                    onValueChange={(value) => setRoute(tier, { model: route.model, effort: value })}
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={translate(
                        'auto.components.settings.ModelRoutingSection.effortFor',
                        '{{value0}} effort',
                        { value0: label }
                      )}
                      className={SELECT_TRIGGER_CLASS}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {effortChoices.map((choice) => (
                        <SelectItem key={choice.value} value={choice.value}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div />
                )}
              </div>
              <div className="flex h-7 shrink-0 items-center">
                {hasOverride && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => resetTier(tier)}
                    aria-label={translate(
                      'auto.components.settings.ModelRoutingSection.resetFor',
                      'Reset {{value0}} routing',
                      { value0: label }
                    )}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {translate('auto.components.settings.ModelRoutingSection.reset', 'Reset')}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
