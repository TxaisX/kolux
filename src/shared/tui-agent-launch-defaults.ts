import { isTuiAgent } from './tui-agent-config'
import { YOLO_TUI_AGENT_ARGS, YOLO_TUI_AGENT_ENV } from './tui-agent-permissions'
import type { TuiAgent } from './tui-agent'

const UNSUPPORTED_TUI_AGENT_ARGS: Partial<Record<TuiAgent, readonly string[]>> = {
  opencode: ['--dangerously-skip-permissions'],
  kilo: ['--dangerously-skip-permissions']
}

export const DEFAULT_TUI_AGENT_ARGS: Partial<Record<TuiAgent, string>> = YOLO_TUI_AGENT_ARGS

export const DEFAULT_TUI_AGENT_ENV: Partial<Record<TuiAgent, Record<string, string>>> =
  YOLO_TUI_AGENT_ENV

function argPattern(arg: string): RegExp {
  return new RegExp(`(^|\\s)${arg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'g')
}

export function hasUnsupportedTuiAgentArgs(agent: TuiAgent, value: unknown): boolean {
  if (typeof value !== 'string') {
    return false
  }
  return (UNSUPPORTED_TUI_AGENT_ARGS[agent] ?? []).some((arg) => argPattern(arg).test(value))
}

function sanitizeTuiAgentLaunchArgs(agent: TuiAgent, args: string): string {
  const unsupportedArgs = UNSUPPORTED_TUI_AGENT_ARGS[agent]
  if (!unsupportedArgs) {
    return args.trim()
  }
  // Why: a few agents have removed, relocated, or never exposed Claude-style
  // skip-permission flags on the interactive TUI command Kolux launches.
  return unsupportedArgs.reduce((next, arg) => next.replace(argPattern(arg), ' '), args).trim()
}

export function normalizeTuiAgentArgsRecord(value: unknown): Partial<Record<TuiAgent, string>> {
  const normalized: Partial<Record<TuiAgent, string>> = {}
  if (!value || typeof value !== 'object') {
    return normalized
  }
  for (const [agent, args] of Object.entries(value)) {
    if (!isTuiAgent(agent) || typeof args !== 'string') {
      continue
    }
    normalized[agent] = sanitizeTuiAgentLaunchArgs(agent, args)
  }
  return normalized
}

export function normalizeTuiAgentEnvRecord(
  value: unknown
): Partial<Record<TuiAgent, Record<string, string>>> {
  const normalized: Partial<Record<TuiAgent, Record<string, string>>> = {}
  if (!value || typeof value !== 'object') {
    return normalized
  }
  for (const [agent, env] of Object.entries(value)) {
    if (!isTuiAgent(agent) || !env || typeof env !== 'object') {
      continue
    }
    const nextEnv: Record<string, string> = {}
    for (const [name, raw] of Object.entries(env)) {
      const key = name.trim()
      if (!key || typeof raw !== 'string') {
        continue
      }
      nextEnv[key] = raw
    }
    normalized[agent] = nextEnv
  }
  return normalized
}

export function getTuiAgentDefaultArgs(agent: TuiAgent): string {
  return DEFAULT_TUI_AGENT_ARGS[agent] ?? ''
}

export function getTuiAgentDefaultEnv(agent: TuiAgent): Record<string, string> {
  return { ...DEFAULT_TUI_AGENT_ENV[agent] }
}

export function resolveTuiAgentLaunchArgs(
  agent: TuiAgent,
  configuredArgs: Partial<Record<TuiAgent, string>> | null | undefined
): string {
  if (
    configuredArgs &&
    Object.hasOwn(configuredArgs, agent) &&
    typeof configuredArgs[agent] === 'string'
  ) {
    return configuredArgs[agent] ?? ''
  }
  return getTuiAgentDefaultArgs(agent)
}

export function resolveTuiAgentLaunchEnv(
  agent: TuiAgent,
  configuredEnv: Partial<Record<TuiAgent, Record<string, string>>> | null | undefined
): Record<string, string> {
  if (configuredEnv && Object.hasOwn(configuredEnv, agent)) {
    return { ...configuredEnv[agent] }
  }
  return getTuiAgentDefaultEnv(agent)
}

/**
 * Per-workspace YOLO override: 'yolo' replaces args/env with the agent's YOLO
 * shape outright; 'manual' strips just the YOLO flag/env, leaving any other
 * custom args/env the workspace's resolved defaults carried untouched.
 */
export function applyAgentPermissionModeOverride(
  agent: TuiAgent,
  mode: 'yolo' | 'manual',
  args: string,
  env: Record<string, string>
): { agentArgs: string; agentEnv: Record<string, string> } {
  if (mode === 'yolo') {
    return {
      agentArgs: YOLO_TUI_AGENT_ARGS[agent] ?? '',
      agentEnv: { ...YOLO_TUI_AGENT_ENV[agent] }
    }
  }
  const yoloArgs = YOLO_TUI_AGENT_ARGS[agent]
  const strippedArgs = yoloArgs ? args.replace(argPattern(yoloArgs), ' ').trim() : args
  const strippedEnv = { ...env }
  for (const key of Object.keys(YOLO_TUI_AGENT_ENV[agent] ?? {})) {
    delete strippedEnv[key]
  }
  return { agentArgs: strippedArgs, agentEnv: strippedEnv }
}

/**
 * Resolve the launch args/env a caller should actually use: an explicit caller
 * override always wins untouched; otherwise the host default is resolved and,
 * when the launch worktree has an explicit per-workspace YOLO mode, overridden
 * by it. Shared by every launch path so the three-way precedence stays in one place.
 */
export function resolveWorktreeAgentLaunchArgs(args: {
  agent: TuiAgent
  explicitAgentArgs: string | null | undefined
  defaultAgentArgs: Partial<Record<TuiAgent, string>> | null | undefined
  defaultAgentEnv: Partial<Record<TuiAgent, Record<string, string>>> | null | undefined
  worktreeMode: 'yolo' | 'manual' | undefined
}): { agentArgs: string | null; agentEnv: Record<string, string> } {
  const agentEnv = resolveTuiAgentLaunchEnv(args.agent, args.defaultAgentEnv)
  if (args.explicitAgentArgs !== undefined) {
    return { agentArgs: args.explicitAgentArgs, agentEnv }
  }
  const agentArgs = resolveTuiAgentLaunchArgs(args.agent, args.defaultAgentArgs)
  return args.worktreeMode
    ? applyAgentPermissionModeOverride(args.agent, args.worktreeMode, agentArgs, agentEnv)
    : { agentArgs, agentEnv }
}
