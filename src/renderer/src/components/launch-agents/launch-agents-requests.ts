import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { Repo } from '../../../../shared/repo-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { SetupDecision } from '../../../../shared/worktree/create-types'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import {
  EMPTY_RETIRED_NAME_REGISTRY,
  type RetiredNameRegistry
} from '../../../../shared/worktree/retired-name-registry'
import { resolveLocalWindowsAgentStartupShell } from '../../../../shared/windows-terminal-shell'
import { getAgentSessionOptionCatalog } from '../../../../shared/agent-session-option-catalog'
import { resolveAgentSessionOptionLaunch } from '../../../../shared/agent-session-option-launch'
import {
  normalizeSuggestedName,
  selectSuggestedCreatureName,
  suggestionPathBasename
} from '../../../../shared/worktree-name-suggestion'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { buildQuickComposerStartup } from '@/hooks/composer-state/quick-startup-plan'

/** Where a wave of seats runs. A git repo defaults to a worktree per seat;
 *  a non-git folder workspace has no git worktrees at all, so every seat
 *  shares the one checkout and opens a plain terminal pane there instead. */
export type LaunchIsolationMode = 'new-worktree' | 'shared-checkout'

/** One seat: which agent CLI, and the catalog model it opens on (null = agent default). */
export type LaunchAgentSlot = { agent: TuiAgent; model: string | null }

/** One seat's plan for `shared-checkout` isolation: a plain terminal-CLI
 *  launch, pinned the same way as the `new-worktree` path so neither
 *  isolation mode can drift into a chat route. */
export type SharedCheckoutSeatRequest = {
  agent: TuiAgent
  model: string | null
  prompt: string
  agentLaunchRoute: 'terminal-tui'
}

/** Pure seat plan for `shared-checkout` isolation — every seat shares the
 *  one prompt and always opens as a terminal CLI. */
export function buildSharedCheckoutSeatRequests(input: {
  slots: readonly LaunchAgentSlot[]
  prompt: string
}): SharedCheckoutSeatRequest[] {
  const sharedPrompt = input.prompt.trim()
  return input.slots.map((slot) => ({
    agent: slot.agent,
    model: slot.model,
    prompt: sharedPrompt,
    agentLaunchRoute: 'terminal-tui' as const
  }))
}

/** `new-worktree` is only meaningful for a git repo — a folder workspace has no worktrees. */
export function isNewWorktreeIsolationAvailable(repo: Pick<Repo, 'kind'>): boolean {
  return isGitRepoKind(repo)
}

export function defaultIsolationMode(repo: Pick<Repo, 'kind'>): LaunchIsolationMode {
  return isNewWorktreeIsolationAvailable(repo) ? 'new-worktree' : 'shared-checkout'
}

/** The catalog default model for an agent, or null when the agent has no model catalog. */
export function defaultLaunchModel(agent: TuiAgent): string | null {
  const models = getAgentSessionOptionCatalog(agent)?.models ?? []
  return (models.find((model) => model.isDefault) ?? models[0])?.id ?? null
}

/** Grow or shrink to `count` seats, keeping existing picks; new seats copy the
 *  last one so a longer wave is quick to build. */
export function resizeLaunchSlots(
  slots: readonly LaunchAgentSlot[],
  count: number,
  agent: TuiAgent | null
): LaunchAgentSlot[] {
  const target = Math.max(0, Math.floor(count))
  const next = slots.slice(0, target)
  while (next.length < target) {
    const template = next.at(-1)
    if (template) {
      next.push({ ...template })
    } else if (agent) {
      next.push({ agent, model: defaultLaunchModel(agent) })
    } else {
      break
    }
  }
  return next
}

/** Re-point every slot at a newly picked agent, keeping each seat's model
 *  when that model still exists in the new agent's catalog, else its default. */
export function retargetLaunchSlots(
  slots: readonly LaunchAgentSlot[],
  agent: TuiAgent
): LaunchAgentSlot[] {
  const models = getAgentSessionOptionCatalog(agent)?.models ?? []
  const fallback = defaultLaunchModel(agent)
  return slots.map((slot) => ({
    agent,
    model: slot.model && models.some((model) => model.id === slot.model) ? slot.model : fallback
  }))
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

/** Merges a seat's model choice into the agent's launch args as the catalog's
 *  own CLI flags (e.g. `--model opus`), the same mechanism a launch args
 *  override always uses — no separate model plumbing through the startup plan. */
export function settingsWithSeatModel(
  settings: GlobalSettings,
  agent: TuiAgent,
  model: string | null
): GlobalSettings {
  if (!model) {
    return settings
  }
  const modelArgs = resolveAgentSessionOptionLaunch(agent, { model }).args
  if (modelArgs.length === 0) {
    return settings
  }
  const baseArgs = settings.agentDefaultArgs?.[agent]?.trim()
  const combined = [baseArgs, modelArgs.join(' ')].filter(Boolean).join(' ')
  return { ...settings, agentDefaultArgs: { ...settings.agentDefaultArgs, [agent]: combined } }
}

/** Builds one `WorktreeCreationRequest` per seat for `new-worktree` isolation:
 *  every seat gets its own worktree, its own model, and always opens as the
 *  agent's terminal CLI — never a chat composer or structured chat session. */
export function buildLaunchAgentsRequests(input: {
  repo: Repo
  settings: GlobalSettings
  prompt: string
  slots: readonly LaunchAgentSlot[]
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
  return input.slots.map((slot) => {
    const name = selectSuggestedCreatureName(used, Math.random, retired.exhaustedTiers)
    used.add(normalizeSuggestedName(name))
    const seatSettings = settingsWithSeatModel(input.settings, slot.agent, slot.model)
    const { startupPlan, backendStartup, telemetry } = buildQuickComposerStartup({
      agent: slot.agent,
      prompt: sharedPrompt,
      draftPrompt: null,
      settings: seatSettings,
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
      agent: slot.agent,
      // Why: every seat opens as a real terminal CLI session — structured/native
      // chat stays opt-in per workspace, never the launcher's default.
      agentLaunchRoute: 'terminal-tui',
      startup: backendStartup,
      pendingFirstAgentMessageRename: false,
      note: '',
      startupPlan,
      quickPrompt: sharedPrompt,
      quickTelemetry: telemetry,
      // Why: N creations finish in any order; none of them should steal focus from the others.
      suppressTerminalFocusOnCompletion: true
    }
  })
}
