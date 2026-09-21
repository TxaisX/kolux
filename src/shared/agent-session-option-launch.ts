import type { AgentType } from './agent-status-types'
import { findCatalogModel, getAgentSessionOptionCatalog } from './agent-session-option-catalog'
import type { SessionOptionValue } from './native-chat-session-options'

export type ResolvedSessionOptionLaunch = {
  args: string[]
  appliedValues: Record<string, SessionOptionValue>
}

export function removeOverriddenAgentSessionArgs(
  agent: AgentType,
  values: Record<string, SessionOptionValue> | null | undefined,
  tokens: readonly string[]
): string[] {
  const catalog = getAgentSessionOptionCatalog(agent)
  const modelId = typeof values?.model === 'string' ? values.model : null
  if (!catalog || !values || !modelId) {
    return [...tokens]
  }
  let result = catalog.modelApply.removeAgentArgs?.(tokens) ?? [...tokens]
  const model = findCatalogModel(catalog, modelId)
  const modelOptions = model?.options ?? catalog.unknownModelOptions ?? []
  for (const option of modelOptions) {
    if (values[option.id] !== undefined && option.apply.removeAgentArgs) {
      result = option.apply.removeAgentArgs(result)
    }
  }
  return result
}

export function resolveAgentSessionOptionLaunch(
  agent: AgentType,
  values: Record<string, SessionOptionValue> | null | undefined,
  trailingAgentArgs: readonly string[] = [],
  includeCatalogDefaults = true
): ResolvedSessionOptionLaunch {
  const catalog = getAgentSessionOptionCatalog(agent)
  if (!catalog) {
    return { args: [], appliedValues: {} }
  }
  const explicitModelId = typeof values?.model === 'string' ? values.model : null
  // Why: an unpicked launch still adopts the catalog's isDefault model (and its
  // options' defaults) when the catalog opts in, so Claude always launches at
  // its best model/effort instead of the bare CLI default.
  const defaultModelId =
    !explicitModelId && includeCatalogDefaults && catalog.launchDefaultModel
      ? catalog.models.find((candidate) => candidate.isDefault)?.id
      : undefined
  const modelId = explicitModelId ?? defaultModelId ?? null
  if (!modelId) {
    return { args: [], appliedValues: {} }
  }
  const sourceValues = values ?? {}

  const model = findCatalogModel(catalog, modelId)
  const appliedValues: Record<string, SessionOptionValue> = {}
  const args: string[] = []
  const modelOptions = model?.options ?? catalog.unknownModelOptions ?? []
  const modelValues = Object.fromEntries(
    modelOptions.flatMap((option) => {
      const explicitValue = sourceValues[option.id]
      if (explicitValue !== undefined) {
        if (
          !model &&
          option.kind.type === 'select' &&
          !option.kind.choices.some((choice) => choice.value === explicitValue)
        ) {
          return []
        }
        return [[option.id, explicitValue]]
      }
      return model && includeCatalogDefaults ? [[option.id, option.kind.defaultValue]] : []
    })
  )
  const composedModelId = catalog.composeModelValue
    ? catalog.composeModelValue(modelId, modelValues)
    : modelId
  const modelOverridden = catalog.modelApply.agentArgsOverride?.(trailingAgentArgs) === true
  // Why: a picker/worker choice always wins over conflicting agent args (they land
  // later on the line, so last-flag-wins still resolves to the user's own value).
  // A launch *default* has no such backstop — the user's flag may sit earlier on
  // the line (e.g. inside a command override) — so a defaulted, overridden value
  // is dropped outright instead of merely left unrecorded.
  const modelWasDefaulted = !explicitModelId

  if (catalog.modelApply.launchArgs) {
    if (!(modelWasDefaulted && modelOverridden)) {
      args.push(...catalog.modelApply.launchArgs(composedModelId))
    }
    if (!modelOverridden) {
      appliedValues.model = modelId
    }
  }
  for (const option of modelOptions) {
    const value = modelValues[option.id]
    if (value === undefined) {
      continue
    }
    const optionOverridden = option.apply.agentArgsOverride?.(trailingAgentArgs) === true
    const optionWasDefaulted = sourceValues[option.id] === undefined
    if (option.apply.composedIntoModel) {
      if (catalog.modelApply.launchArgs && !modelOverridden) {
        appliedValues[option.id] = value
      }
      continue
    }
    if (!option.apply.launchArgs) {
      continue
    }
    if (optionWasDefaulted && optionOverridden) {
      continue
    }
    args.push(...option.apply.launchArgs(value))
    if (!modelOverridden && !optionOverridden) {
      appliedValues[option.id] = value
    }
  }
  return { args, appliedValues }
}
