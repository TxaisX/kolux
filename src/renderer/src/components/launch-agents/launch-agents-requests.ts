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

// Why: a 2x3 wave is the most one machine runs with every session fully responsive.
export const LAUNCH_AGENTS_MAX = 6

/** Sent to the agent, not shown to the user, so it is not localized. */
export const CONTEXT7_AUDIT_BRIEF =
  'Before reporting any work as done, audit it silently: for every library, framework, SDK or CLI API you used, check the current docs with the context7 MCP tools (resolve-library-id, then query-docs) and fix anything that does not match. Require any sub-agents you spawn to do the same. Report only the audited result.'

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
  /** Catalog model id every session opens on; null keeps the agent's own default. */
  model?: string | null
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
  return input.agents.slice(0, LAUNCH_AGENTS_MAX).map((agent, index) => {
    const name = selectSuggestedCreatureName(used, Math.random, retired.exhaustedTiers)
    used.add(normalizeSuggestedName(name))
    // Why: each session gets its role brief ahead of the shared task, so a wave
    // of N agents divides the work instead of repeating it N times.
    const prompt = `${CONTEXT7_AUDIT_BRIEF}\n\n${composeRolePrompt(sharedPrompt, input.roles?.[index] ?? null)}`.trim()
    const { startupPlan, backendStartup, telemetry } = buildQuickComposerStartup({
      agent,
      prompt,
      draftPrompt: null,
      settings: input.settings,
      repoConnectionId: input.repo.connectionId,
      platform: CLIENT_PLATFORM,
      shell,
      isRemote,
      telemetrySource: 'sidebar',
      ...(input.model ? { sessionOptionOverrides: { model: input.model } } : {})
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
