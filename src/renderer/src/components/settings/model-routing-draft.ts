import {
  findCatalogModel,
  findCatalogOption,
  getAgentSessionOptionCatalog
} from '../../../../shared/agent-session-option-catalog'
import type { CatalogOption } from '../../../../shared/agent-session-option-catalog-types'
import type { OrchestrationRoutingRoute } from '../../../../shared/orchestration-routing-tiers'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { AgentCatalogEntry } from '@/lib/agent-catalog'

/** Agents whose catalog supports launch-time model/effort overrides — the only valid routing providers. */
export function getRoutableAgents(catalog: readonly AgentCatalogEntry[]): AgentCatalogEntry[] {
  return catalog.filter(
    (agent) => getAgentSessionOptionCatalog(agent.id)?.supportsWorkerLaunchPreferences
  )
}

function effortOptionFor(agent: TuiAgent, modelId: string): CatalogOption | undefined {
  const catalog = getAgentSessionOptionCatalog(agent)
  return catalog ? findCatalogOption(findCatalogModel(catalog, modelId), 'effort') : undefined
}

/** Effort choices for a tier's current model on its provider, or null when that model has no effort control. */
export function getEffortChoices(
  agent: TuiAgent,
  modelId: string
): readonly { value: string; label: string }[] | null {
  const option = effortOptionFor(agent, modelId)
  return option?.kind.type === 'select' ? option.kind.choices : null
}

/** Route for a model change within a tier: keeps the picked effort if the new model still offers it. */
export function routeForModelChange(
  agent: TuiAgent,
  modelId: string,
  previousEffort: string | undefined
): OrchestrationRoutingRoute {
  const option = effortOptionFor(agent, modelId)
  if (option?.kind.type !== 'select') {
    return { model: modelId }
  }
  const effort = option.kind.choices.some((choice) => choice.value === previousEffort)
    ? (previousEffort as string)
    : option.kind.defaultValue
  return { model: modelId, effort }
}
