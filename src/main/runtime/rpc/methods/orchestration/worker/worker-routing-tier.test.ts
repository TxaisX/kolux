import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_ORCHESTRATION_ROUTING } from '../../../../../../shared/orchestration-routing-tiers'
import { resolveWorkerStartRoutingTier } from './worker-routing-tier'
import { WorkerStartParams, type WorkerStartInput } from './worker-start-schema'

const COORD_PANE = 'tab_coord:leaf'

function runtimeWith(args: {
  orchestrationRouting?: unknown
  agentUnavailable?: boolean
  settingsThrows?: boolean
  /** paneKey -> live agentType, as the fleet snapshot would report it. */
  paneAgents?: Record<string, string>
  /** terminal handle -> paneKey, for --terminal reuse lookups. */
  terminalPanes?: Record<string, string>
}) {
  return {
    getClientSettings: vi.fn(() => {
      if (args.settingsThrows) {
        throw new Error('runtime_unavailable')
      }
      return { orchestrationRouting: args.orchestrationRouting } as never
    }),
    validateOrchestrationAgentLauncher: vi.fn(() => {
      if (args.agentUnavailable) {
        throw new Error('agent_unconfigured')
      }
    }),
    getOrchestrationFleetAgentStatusSnapshot: vi.fn(() =>
      Object.entries(args.paneAgents ?? {}).map(([paneKey, agentType]) => ({
        activity: { paneKey, agentType }
      }))
    ),
    getTerminalPaneKey: vi.fn((handle: string) => args.terminalPanes?.[handle] ?? null)
  } as never
}

function baseParams(overrides: Partial<WorkerStartInput> = {}): WorkerStartInput {
  return { task: 'task_1', from: 'term_coord', ...overrides }
}

describe('resolveWorkerStartRoutingTier: tier routing', () => {
  it('leaves params untouched when no tier is requested and the agent matches the coordinator', () => {
    const params = baseParams({ agent: 'claude' })
    const runtime = runtimeWith({ paneAgents: { [COORD_PANE]: 'claude' } })
    expect(resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: COORD_PANE })).toBe(
      params
    )
  })

  it('resolves a tier to the coordinator agent default model/effort', () => {
    const params = baseParams({ tier: 'deep' })
    const runtime = runtimeWith({ paneAgents: { [COORD_PANE]: 'claude' } })
    const resolved = resolveWorkerStartRoutingTier({
      params,
      runtime,
      coordinatorPaneKey: COORD_PANE
    })
    expect(resolved).toMatchObject({
      agent: 'claude',
      ...DEFAULT_ORCHESTRATION_ROUTING.claude!.deep
    })
    expect(resolved).not.toHaveProperty('tier')
  })

  it('routes a Codex coordinator to Codex defaults, not Claude', () => {
    const params = baseParams({ tier: 'build' })
    const runtime = runtimeWith({ paneAgents: { [COORD_PANE]: 'codex' } })
    const resolved = resolveWorkerStartRoutingTier({
      params,
      runtime,
      coordinatorPaneKey: COORD_PANE
    })
    expect(resolved).toMatchObject({
      agent: 'codex',
      ...DEFAULT_ORCHESTRATION_ROUTING.codex!.build
    })
  })

  it('applies a user override for one tier while other tiers keep their defaults', () => {
    const orchestrationRouting = {
      claude: { build: { model: 'sonnet', effort: 'low' } }
    }
    const runtime = runtimeWith({ orchestrationRouting, paneAgents: { [COORD_PANE]: 'claude' } })
    const overridden = resolveWorkerStartRoutingTier({
      params: baseParams({ tier: 'build' }),
      runtime,
      coordinatorPaneKey: COORD_PANE
    })
    expect(overridden).toMatchObject({ agent: 'claude', model: 'sonnet', effort: 'low' })
    const untouched = resolveWorkerStartRoutingTier({
      params: baseParams({ tier: 'major' }),
      runtime,
      coordinatorPaneKey: COORD_PANE
    })
    expect(untouched).toMatchObject({
      agent: 'claude',
      ...DEFAULT_ORCHESTRATION_ROUTING.claude!.major
    })
  })

  it('passes a Haiku (light) tier through with no effort field', () => {
    const params = baseParams({ tier: 'light' })
    const runtime = runtimeWith({ paneAgents: { [COORD_PANE]: 'claude' } })
    const resolved = resolveWorkerStartRoutingTier({
      params,
      runtime,
      coordinatorPaneKey: COORD_PANE
    })
    expect(resolved).toMatchObject({ agent: 'claude', model: 'haiku' })
    expect(resolved).not.toHaveProperty('effort')
  })

  it('tolerates a settings read throw and falls back to defaults', () => {
    const params = baseParams({ tier: 'major' })
    const runtime = runtimeWith({ settingsThrows: true, paneAgents: { [COORD_PANE]: 'claude' } })
    const resolved = resolveWorkerStartRoutingTier({
      params,
      runtime,
      coordinatorPaneKey: COORD_PANE
    })
    expect(resolved).toMatchObject({
      agent: 'claude',
      ...DEFAULT_ORCHESTRATION_ROUTING.claude!.major
    })
  })

  it('names the tier and agent when the routed agent is unavailable', () => {
    const params = baseParams({ tier: 'build' })
    const runtime = runtimeWith({
      agentUnavailable: true,
      paneAgents: { [COORD_PANE]: 'codex' }
    })
    expect(() =>
      resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: COORD_PANE })
    ).toThrow(/Tier 'build' routes to agent codex.*Settings > Agents > Model routing/)
  })

  it('accepts --agent alongside --tier when it matches the coordinator agent', () => {
    const params = baseParams({ tier: 'build', agent: 'claude' })
    const runtime = runtimeWith({ paneAgents: { [COORD_PANE]: 'claude' } })
    const resolved = resolveWorkerStartRoutingTier({
      params,
      runtime,
      coordinatorPaneKey: COORD_PANE
    })
    expect(resolved).toMatchObject({ agent: 'claude' })
  })

  it('rejects --agent alongside --tier when it mismatches the coordinator agent', () => {
    const params = baseParams({ tier: 'build', agent: 'codex' })
    const runtime = runtimeWith({ paneAgents: { [COORD_PANE]: 'claude' } })
    expect(() =>
      resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: COORD_PANE })
    ).toThrow("Workers must use the coordinator's own agent (claude); providers never mix.")
  })

  it('accepts an explicit --agent with --tier when the coordinator agent is unknown', () => {
    const params = baseParams({ tier: 'build', agent: 'codex' })
    const runtime = runtimeWith({})
    const resolved = resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: null })
    expect(resolved).toMatchObject({ agent: 'codex' })
  })

  it('requires --agent when --tier is used and the coordinator agent is unknown', () => {
    const params = baseParams({ tier: 'build' })
    const runtime = runtimeWith({})
    expect(() =>
      resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: null })
    ).toThrow('--tier needs a coordinator agent; pass --agent.')
  })

  it('names the tier and agent when the resolver has no route for that provider', () => {
    const params = baseParams({ tier: 'major' })
    const runtime = runtimeWith({ paneAgents: { [COORD_PANE]: 'grok' } })
    expect(() =>
      resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: COORD_PANE })
    ).toThrow(
      'No major route for grok; set one in Settings > Agents > Model routing or pass --model.'
    )
  })
})

describe('resolveWorkerStartRoutingTier: provider isolation without --tier', () => {
  it('passes through a fresh --agent that matches the coordinator', () => {
    const params = baseParams({ agent: 'claude' })
    const runtime = runtimeWith({ paneAgents: { [COORD_PANE]: 'claude' } })
    expect(resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: COORD_PANE })).toBe(
      params
    )
  })

  it('rejects a fresh --agent that differs from the coordinator', () => {
    const params = baseParams({ agent: 'codex' })
    const runtime = runtimeWith({ paneAgents: { [COORD_PANE]: 'claude' } })
    expect(() =>
      resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: COORD_PANE })
    ).toThrow("Workers must use the coordinator's own agent (claude); providers never mix.")
  })

  it('allows an --agent mismatch when the coordinator agent is unknown', () => {
    const params = baseParams({ agent: 'codex' })
    const runtime = runtimeWith({})
    expect(resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: COORD_PANE })).toBe(
      params
    )
  })

  it('rejects reusing a --terminal running a different agent', () => {
    const params = baseParams({ terminal: 'term_worker' })
    const runtime = runtimeWith({
      paneAgents: { [COORD_PANE]: 'claude', 'tab_worker:leaf': 'codex' },
      terminalPanes: { term_worker: 'tab_worker:leaf' }
    })
    expect(() =>
      resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: COORD_PANE })
    ).toThrow("Workers must use the coordinator's own agent (claude); providers never mix.")
  })

  it('allows reusing a --terminal running the same agent', () => {
    const params = baseParams({ terminal: 'term_worker' })
    const runtime = runtimeWith({
      paneAgents: { [COORD_PANE]: 'claude', 'tab_worker:leaf': 'claude' },
      terminalPanes: { term_worker: 'tab_worker:leaf' }
    })
    expect(resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: COORD_PANE })).toBe(
      params
    )
  })

  it('allows reusing a --terminal whose agent is not (yet) knowable', () => {
    const params = baseParams({ terminal: 'term_worker' })
    const runtime = runtimeWith({
      paneAgents: { [COORD_PANE]: 'claude' },
      terminalPanes: { term_worker: 'tab_worker:leaf' }
    })
    expect(resolveWorkerStartRoutingTier({ params, runtime, coordinatorPaneKey: COORD_PANE })).toBe(
      params
    )
  })
})

describe('WorkerStartParams --tier exclusivity', () => {
  it('rejects --tier combined with --model, --effort, or --terminal', () => {
    for (const overrides of [
      { model: 'opus' },
      { effort: 'high' },
      { terminal: 'term_existing' }
    ]) {
      const parsed = WorkerStartParams.safeParse({
        task: 'task_1',
        from: 'term_coord',
        tier: 'build',
        ...overrides
      })
      expect(parsed.success).toBe(false)
      expect(parsed.error?.issues.map((issue) => issue.message)).toContain(
        '--tier cannot combine with --model, --effort, or --terminal'
      )
    }
  })

  it('accepts --tier combined with --agent (the dynamic coordinator-match check runs later)', () => {
    expect(
      WorkerStartParams.safeParse({
        task: 'task_1',
        from: 'term_coord',
        tier: 'build',
        agent: 'claude'
      }).success
    ).toBe(true)
  })

  it('accepts --tier alone', () => {
    expect(
      WorkerStartParams.safeParse({ task: 'task_1', from: 'term_coord', tier: 'light' }).success
    ).toBe(true)
  })

  it('rejects an unknown tier value', () => {
    expect(
      WorkerStartParams.safeParse({ task: 'task_1', from: 'term_coord', tier: 'urgent' }).success
    ).toBe(false)
  })
})
