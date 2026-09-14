import React, { useEffect, useMemo, useState } from 'react'
import { FolderPlus, Rocket } from 'lucide-react'
import { isGitRepoKind } from '../../../../shared/repo-kind'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { runBackgroundWorktreeCreation } from '@/lib/worktree-creation-flow'
import { resolveDirectSetupDecision } from '@/lib/launch-work-item-direct-preflight'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { useRetiredWorktreeNames } from '@/hooks/useRetiredWorktreeNames'
import { translate } from '@/i18n/i18n'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  buildLaunchAgentsRequests,
  LAUNCH_AGENTS_MAX,
  type LaunchAgentSlot
} from './launch-agents-requests'
import { assignLaunchRoles, getLaunchPreset } from './launch-agent-roles'
import { LaunchPresetRow } from './LaunchAgentsLineup'
import { LaunchAgentSlots, resizeLaunchSlots } from './LaunchAgentSlots'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.launch-agents.LaunchAgentsDialog.${id}`, fallback)

const COUNT_CHOICES = Array.from({ length: LAUNCH_AGENTS_MAX }, (_, index) => index + 1)

export default function LaunchAgentsDialog(): React.JSX.Element | null {
  const visible = useAppStore((s) => s.activeModal === 'launch-agents')
  const closeModal = useAppStore((s) => s.closeModal)
  if (!visible) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && closeModal()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{T('title', 'Launch agents')}</DialogTitle>
          <DialogDescription>
            {T(
              'description',
              'Pick up to 6 agents and a model for each. Every agent gets its own worktree, branch and handoff file, so no two ever touch the same files.'
            )}
          </DialogDescription>
        </DialogHeader>
        <LaunchAgentsBody onClose={closeModal} />
      </DialogContent>
    </Dialog>
  )
}

function LaunchAgentsBody({ onClose }: { onClose: () => void }): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const settings = useAppStore((s) => s.settings)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const detectedAgentList = useAppStore((s) => s.detectedAgentIds)
  const ensureDetectedAgents = useAppStore((s) => s.ensureDetectedAgents)

  const addRepo = useAppStore((s) => s.addRepo)
  // Why: plain folders have no worktrees, so only git repos can host parallel agents.
  const localRepos = useMemo(
    () => repos.filter((repo) => !repo.connectionId && isGitRepoKind(repo)),
    [repos]
  )
  const pickRepo = async (): Promise<void> => {
    const added = await addRepo()
    if (added && isGitRepoKind(added)) {
      setRepoId(added.id)
    }
  }
  const [repoId, setRepoId] = useState<string>(() =>
    localRepos.some((repo) => repo.id === activeRepoId)
      ? (activeRepoId ?? '')
      : (localRepos[0]?.id ?? '')
  )
  const [prompt, setPrompt] = useState('')
  const [slots, setSlots] = useState<LaunchAgentSlot[]>([])
  const [presetId, setPresetId] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const retired = useRetiredWorktreeNames(repoId || null, repoId)

  useEffect(() => {
    void ensureDetectedAgents()
  }, [ensureDetectedAgents])

  const agents = useMemo(() => {
    const detected = detectedAgentList ? new Set<TuiAgent>(detectedAgentList) : null
    return getAgentCatalog().filter(
      (entry) =>
        isTuiAgentEnabled(entry.id, settings?.disabledTuiAgents) &&
        (detected === null || detected.has(entry.id))
    )
  }, [detectedAgentList, settings?.disabledTuiAgents])

  const total = slots.length
  const expandedAgents = useMemo(() => slots.map((slot) => slot.agent), [slots])
  const repo = localRepos.find((entry) => entry.id === repoId) ?? null
  const preset = getLaunchPreset(presetId)
  const roles = useMemo(
    () => assignLaunchRoles(expandedAgents, preset?.roles ?? []),
    [expandedAgents, preset]
  )

  const chooseCount = (count: number): void => {
    setSlots((prev) => resizeLaunchSlots(prev, count, agents[0]?.id ?? null))
  }
  const updateSlot = (index: number, slot: LaunchAgentSlot): void => {
    setSlots((prev) => prev.map((entry, i) => (i === index ? slot : entry)))
  }

  // Why: picking a shape with no count chosen should produce that shape, not an empty lineup.
  const selectPreset = (nextPresetId: string | null): void => {
    setPresetId(nextPresetId)
    const nextPreset = getLaunchPreset(nextPresetId)
    if (nextPreset && total === 0) {
      chooseCount(Math.min(nextPreset.roles.length, LAUNCH_AGENTS_MAX))
    }
  }

  const launch = async (): Promise<void> => {
    if (!repo || !settings || total === 0) {
      return
    }
    setLaunching(true)
    try {
      const store = useAppStore.getState()
      const setup = await resolveDirectSetupDecision(
        repo.id,
        repo,
        getSettingsForRepoRuntimeOwner(store, repo.id)
      )
      if (setup.kind === 'needs-modal') {
        toast.error(
          T(
            'setupAsksPerWorkspace',
            'This project asks about setup scripts per workspace. Pick a default in its settings, then launch again.'
          )
        )
        return
      }
      const trust = await ensureHooksConfirmed(useAppStore.getState(), repo.id, 'setup')
      const requests = buildLaunchAgentsRequests({
        repo,
        settings,
        prompt,
        slots,
        roles,
        setupDecision: trust === 'skip' ? 'skip' : setup.decision,
        worktreesByRepo,
        retired
      })
      // Why: agents spawn seconds apart and each rewrites Claude's config, so trust every folder before the first one starts.
      const claudeNames = requests.filter((r) => r.agent === 'claude').map((r) => r.name)
      if (claudeNames.length > 0) {
        const preTrust = await window.api.agentTrust.preTrustWorktrees({
          repoId: repo.id,
          agent: 'claude',
          worktreeNames: claudeNames
        })
        if ('error' in preTrust) {
          console.warn(
            '[launch-agents] pre-trust failed; per-agent trust still runs:',
            preTrust.error
          )
        }
      }
      for (const request of requests) {
        runBackgroundWorktreeCreation(request)
      }
      toast.success(
        translate(
          'auto.components.launch-agents.LaunchAgentsDialog.launched',
          'Launching {{count}} agent sessions',
          { count: requests.length }
        )
      )
      onClose()
      // Why: a wave is launched to be watched together, so land on the grid for this repo.
      useAppStore.getState().setActiveRepo(repo.id)
      useAppStore.getState().setActiveView('agent-grid')
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="scrollbar-sleek flex min-h-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{T('project', 'Git repo')}</span>
        <div className="flex items-center gap-2">
          <select
            aria-label={T('project', 'Git repo')}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            value={repoId}
            onChange={(event) => setRepoId(event.target.value)}
          >
            {localRepos.length === 0 ? (
              <option value="">{T('noRepos', 'No git repos added yet')}</option>
            ) : null}
            {localRepos.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.displayName}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm" onClick={() => void pickRepo()}>
            <FolderPlus className="size-3.5" />
            {T('addRepo', 'Add repo…')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{T('howMany', 'How many agents')}</span>
        {agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {T('noAgents', 'No agent CLIs detected on this machine yet.')}
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label={T('howMany', 'How many agents')}
            className="grid w-full max-w-[15rem] grid-cols-3 gap-2"
          >
            {COUNT_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                role="radio"
                aria-checked={total === choice}
                onClick={() => chooseCount(choice)}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-lg border text-xl font-semibold tabular-nums transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  total === choice
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-accent'
                )}
              >
                {choice}
              </button>
            ))}
          </div>
        )}
      </div>

      <LaunchAgentSlots slots={slots} agents={agents} roles={roles} onChange={updateSlot} />

      <LaunchPresetRow presetId={presetId} onSelect={selectPreset} />

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{T('prompt', 'Prompt for every session')}</span>
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          rows={4}
          placeholder={T(
            'promptPlaceholder',
            'Describe the task. Leave empty to just open the agents.'
          )}
        />
      </label>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {T('cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={launching || total === 0 || repo === null}
          onClick={() => void launch()}
        >
          <Rocket className="size-3.5" />
          {translate(
            'auto.components.launch-agents.LaunchAgentsDialog.launchCount',
            'Launch {{count}}',
            { count: total }
          )}
        </Button>
      </div>
    </div>
  )
}
