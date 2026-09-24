import {
  resolveOrchestrationRoutingRoute,
  type OrchestrationRoutingSettings
} from '../../../../../../shared/orchestration-routing-tiers'
import type { TuiAgent } from '../../../../../../shared/tui-agent'
import { isTuiAgent } from '../../../../../../shared/tui-agent-config'
import type { KoluxRuntimeService } from '../../../../kolux-runtime'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import type { WorkerStartInput } from './worker-start-schema'

type RoutingRuntime = Pick<
  KoluxRuntimeService,
  | 'getClientSettings'
  | 'validateOrchestrationAgentLauncher'
  | 'getOrchestrationFleetAgentStatusSnapshot'
  | 'getTerminalPaneKey'
>

/** The store can be missing on a runtime that never opened one; that reads as no overrides. */
function readOrchestrationRoutingOverrides(
  runtime: Pick<KoluxRuntimeService, 'getClientSettings'>
): OrchestrationRoutingSettings | undefined {
  try {
    return runtime.getClientSettings()?.orchestrationRouting
  } catch {
    return undefined
  }
}

/** The live agent a pane is running, from the same hook-reported fleet snapshot worker-list
 *  and worker-show read; undefined when unreported, so it never falsely fences a launch. */
function resolvePaneAgentType(
  runtime: RoutingRuntime,
  paneKey: string | null
): TuiAgent | undefined {
  if (!paneKey) {
    return undefined
  }
  const agentType = runtime
    .getOrchestrationFleetAgentStatusSnapshot()
    .find((evidence) => evidence.activity.paneKey === paneKey)?.activity.agentType
  return agentType && isTuiAgent(agentType) ? agentType : undefined
}

function resolveTerminalAgentType(
  runtime: RoutingRuntime,
  terminalHandle: string | undefined
): TuiAgent | undefined {
  if (!terminalHandle) {
    return undefined
  }
  return resolvePaneAgentType(runtime, runtime.getTerminalPaneKey(terminalHandle))
}

function isolationError(coordinatorAgent: TuiAgent): OrchestrationError {
  return new OrchestrationError(
    'invalid_argument',
    `Workers must use the coordinator's own agent (${coordinatorAgent}); providers never mix.`
  )
}

/**
 * Providers never mix: every worker-start (local or federated, with or without `--tier`) must
 * land on the coordinator's own agent when that agent is knowable. A fresh `--agent` and a
 * reused `--terminal` pane are both checked; an unknowable side (no live status yet, a remote
 * pane) never fences the launch — only a proven mismatch does.
 */
function assertProviderIsolation(args: {
  runtime: RoutingRuntime
  coordinatorAgent: TuiAgent | undefined
  params: WorkerStartInput
}): void {
  const { runtime, coordinatorAgent, params } = args
  if (!coordinatorAgent) {
    return
  }
  const workerAgent = params.terminal
    ? resolveTerminalAgentType(runtime, params.terminal)
    : isTuiAgent(params.agent)
      ? params.agent
      : undefined
  if (workerAgent && workerAgent !== coordinatorAgent) {
    throw isolationError(coordinatorAgent)
  }
}

function resolveTierRouting(args: {
  params: WorkerStartInput
  runtime: RoutingRuntime
  coordinatorAgent: TuiAgent | undefined
}): WorkerStartInput {
  const { params, runtime, coordinatorAgent } = args
  const tier = params.tier
  if (!tier) {
    return params
  }
  let agent: TuiAgent
  if (params.agent) {
    if (coordinatorAgent && params.agent !== coordinatorAgent) {
      throw isolationError(coordinatorAgent)
    }
    agent = params.agent as TuiAgent
  } else if (coordinatorAgent) {
    agent = coordinatorAgent
  } else {
    throw new OrchestrationError(
      'invalid_argument',
      '--tier needs a coordinator agent; pass --agent.'
    )
  }
  try {
    runtime.validateOrchestrationAgentLauncher(agent)
  } catch {
    throw new OrchestrationError(
      'agent_unconfigured',
      `Tier '${tier}' routes to agent ${agent}, which is unavailable. Pass --agent/--model explicitly or change Settings > Agents > Model routing.`
    )
  }
  const route = resolveOrchestrationRoutingRoute(
    agent,
    tier,
    readOrchestrationRoutingOverrides(runtime)
  )
  if (!route) {
    throw new OrchestrationError(
      'invalid_argument',
      `No ${tier} route for ${agent}; set one in Settings > Agents > Model routing or pass --model.`
    )
  }
  const { tier: _tier, ...rest } = params
  return {
    ...rest,
    agent,
    model: route.model,
    ...(route.effort ? { effort: route.effort } : {})
  }
}

/**
 * Resolves `--tier` into agent/model/effort on the coordinator's own runtime, before any remote
 * forwarding, so a federated server only ever receives plain agent/model/effort — and enforces
 * the provider-isolation rule on every worker-start, tiered or not.
 */
export function resolveWorkerStartRoutingTier(args: {
  params: WorkerStartInput
  runtime: RoutingRuntime
  coordinatorPaneKey: string | null
}): WorkerStartInput {
  const { params, runtime, coordinatorPaneKey } = args
  const coordinatorAgent = resolvePaneAgentType(runtime, coordinatorPaneKey)
  if (params.tier) {
    return resolveTierRouting({ params, runtime, coordinatorAgent })
  }
  assertProviderIsolation({ runtime, coordinatorAgent, params })
  return params
}
