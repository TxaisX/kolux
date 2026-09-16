import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { SetupDecision } from '../../../../shared/worktree/create-types'
import {
  EMPTY_RETIRED_NAME_REGISTRY,
  type RetiredNameRegistry
} from '../../../../shared/worktree/retired-name-registry'
import { resolveLocalWindowsAgentStartupShell } from '../../../../shared/windows-terminal-shell'
import {
  normalizeSuggestedName,
  selectSuggestedCreatureName,
  suggestionPathBasename
} from '../../../../shared/worktree-name-suggestion'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { buildQuickComposerStartup } from '@/hooks/composer-state/quick-startup-plan'
import { composeRolePrompt, type LaunchRole } from './launch-agent-roles'

export const LAUNCH_AGENTS_MAX_PER_AGENT = 9

export type LaunchAgentCounts = Partial<Record<TuiAgent, number>>

/** {claude: 2, codex: 1} -> ['claude', 'claude', 'codex'] */
export function expandLaunchAgentCounts(counts: LaunchAgentCounts): TuiAgent[] {
  const agents: TuiAgent[] = []
  for (const [agent, count] of Object.entries(counts) as [TuiAgent, number | undefined][]) {
    for (let i = 0; i < (count ?? 0); i += 1) {
      agents.push(agent)
    }
  }
  return agents
}

// Why: mirrors the composer's dedup (live names across every repo + retired names for this repo),
// but threads each pick back into the used set so N sessions launched together never collide.
function collectUsedNames(
  worktreesByRepo: Record<string, { path: string }[]>,
  retired: RetiredNameRegistry
): Set<string> {
  const used = new Set<string>()
  for (const worktrees of Object.values(worktreesByRepo)) {
    for (const worktree of worktrees) {
      used.add(normalizeSuggestedName(suggestionPathBasename(worktree.path)))
    }
  }
  for (const name of retired.names) {
    used.add(normalizeSuggestedName(name))
  }
  return used
}

export function buildLaunchAgentsRequests(input: {
  repo: Repo
  settings: GlobalSettings
  prompt: string
  agents: TuiAgent[]
  /** Per-session role, index-aligned with `agents`. Omit for N identical sessions. */
  roles?: readonly (LaunchRole | null)[]
  setupDecision: SetupDecision
  worktreesByRepo: Record<string, { path: string }[]>
  retired?: RetiredNameRegistry
}): WorktreeCreationRequest[] {
  const retired = input.retired ?? EMPTY_RETIRED_NAME_REGISTRY
  const used = collectUsedNames(input.worktreesByRepo, retired)
  const isRemote = typeof input.repo.connectionId === 'string'
  const shell = resolveLocalWindowsAgentStartupShell({
    platform: CLIENT_PLATFORM,
    isRemote,
    terminalWindowsShell: input.settings.terminalWindowsShell
  })
  const sharedPrompt = input.prompt.trim()
  return input.agents.map((agent, index) => {
    const name = selectSuggestedCreatureName(used, Math.random, retired.exhaustedTiers)
    used.add(normalizeSuggestedName(name))
    // Why: each session gets its role brief ahead of the shared task, so a wave
    // of N agents divides the work instead of repeating it N times.
    const prompt = composeRolePrompt(sharedPrompt, input.roles?.[index] ?? null)
    const { startupPlan, backendStartup, telemetry } = buildQuickComposerStartup({
      agent,
      prompt,
      draftPrompt: null,
      settings: input.settings,
      repoConnectionId: input.repo.connectionId,
      platform: CLIENT_PLATFORM,
      shell,
      isRemote,
      telemetrySource: 'sidebar'
    })
    return {
      repoId: input.repo.id,
      worktreeCreateProgressMode: 'stepped',
      name,
      nameWasGenerated: true,
      setupDecision: input.setupDecision,
      telemetrySource: 'sidebar',
      agent,
      // Why: the launcher is a terminal-grid feature; structured chat stays opt-in per workspace.
      agentLaunchRoute: 'terminal-tui',
      startup: backendStartup,
      pendingFirstAgentMessageRename: false,
      note: '',
      startupPlan,
      quickPrompt: prompt,
      quickTelemetry: telemetry,
      // Why: N creations finish in any order; none of them should steal focus from the others.
      suppressTerminalFocusOnCompletion: true
    }
  })
}
