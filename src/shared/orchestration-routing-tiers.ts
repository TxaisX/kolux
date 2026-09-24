import type { TuiAgent } from './tui-agent'

/** Work classes a coordinator sorts tasks into; each provider maps them to its own models. */
export const ORCHESTRATION_ROUTING_TIERS = ['major', 'deep', 'build', 'light'] as const
export type OrchestrationRoutingTier = (typeof ORCHESTRATION_ROUTING_TIERS)[number]

export type OrchestrationRoutingRoute = {
  model: string
  /** Absent when the model has no effort control (e.g. Haiku). */
  effort?: string
}

export type OrchestrationRoutingTable = Record<OrchestrationRoutingTier, OrchestrationRoutingRoute>

/** Why: providers never mix, so a table only ever names that provider's own models. */
export type OrchestrationRoutingSettings = Partial<
  Record<TuiAgent, Partial<OrchestrationRoutingTable>>
>

export const ORCHESTRATION_ROUTING_TIER_LABELS: Record<
  OrchestrationRoutingTier,
  { label: string; description: string }
> = {
  major: {
    label: 'Major',
    description: 'Building something big or changing a system as a whole: plan and final review'
  },
  deep: { label: 'Deep', description: 'Planning, review, hard bugs, architecture' },
  build: { label: 'Build', description: 'Implementing features and multi-file refactors' },
  light: {
    label: 'Light',
    description: 'Mechanical work: renames, lint fixes, test scaffolding, search, docs'
  }
}

export const DEFAULT_ORCHESTRATION_ROUTING: Partial<Record<TuiAgent, OrchestrationRoutingTable>> = {
  claude: {
    major: { model: 'fable', effort: 'high' },
    deep: { model: 'opus', effort: 'high' },
    build: { model: 'sonnet', effort: 'medium' },
    light: { model: 'haiku' }
  },
  codex: {
    major: { model: 'gpt-5.6-sol', effort: 'high' },
    deep: { model: 'gpt-5.6-terra', effort: 'high' },
    build: { model: 'gpt-5.6-terra', effort: 'medium' },
    light: { model: 'gpt-5.6-luna', effort: 'low' }
  }
}

export function isOrchestrationRoutingTier(value: unknown): value is OrchestrationRoutingTier {
  return (ORCHESTRATION_ROUTING_TIERS as readonly unknown[]).includes(value)
}

/** A tier the user never edited follows the shipped default; undefined = no route for this provider. */
export function resolveOrchestrationRoutingRoute(
  agent: TuiAgent,
  tier: OrchestrationRoutingTier,
  overrides: OrchestrationRoutingSettings | undefined
): OrchestrationRoutingRoute | undefined {
  return overrides?.[agent]?.[tier] ?? DEFAULT_ORCHESTRATION_ROUTING[agent]?.[tier]
}
