import React, { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Rocket, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { getAgentCatalog, getAgentLabel } from '@/lib/agent-catalog'
import { runBackgroundWorktreeCreation } from '@/lib/worktree-creation-flow'
import { resolveDirectSetupDecision } from '@/lib/launch-work-item-direct-preflight'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { useRetiredWorktreeNames } from '@/hooks/useRetiredWorktreeNames'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  buildLaunchAgentsRequests,
  buildSharedCheckoutSeatRequests,
  defaultLaunchModel,
  isNewWorktreeIsolationAvailable,
  resizeLaunchSlots,
  retargetLaunchSlots,
  type LaunchAgentSlot,
  type LaunchIsolationMode
} from './launch-agents-requests'
import { runSharedCheckoutLaunch } from './launch-agents-shared-checkout'
import { LaunchAgentGrid } from './LaunchAgentGrid'
import { LaunchSeatCountPicker } from './LaunchSeatCountPicker'
import { LaunchIsolationToggle } from './LaunchIsolationToggle'
import { LaunchAgentsLineup } from './LaunchAgentsLineup'

const T = (id: string, fallback: string, options?: Record<string, unknown>): string =>
  translate(`auto.components.launch-agents.LaunchAgentsDialog.${id}`, fallback, options)

/**
 * "New session": pick an agent CLI, how many seats, and whether each seat
 * gets its own worktree or shares the current checkout, then launch. Every
 * seat always opens as the agent's terminal CLI (`agentLaunchRoute:
 * 'terminal-tui'`) — never a chat composer or structured chat session.
 */
export default function LaunchAgentsDialog(): React.JSX.Element | null {
  const visible = useAppStore((s) => s.activeModal === 'launch-agents')
  const closeModal = useAppStore((s) => s.closeModal)
  const modalData = useAppStore((s) => s.modalData)
  if (!visible) {
    return null
  }
  return (
    <Dialog open onOpenChange={(open) => !open && closeModal()}>
      {/* Why: BridgeMind's reference is a full-surface "New session" tab, not a
          small dialog — approximated here as a near-full-viewport surface
          since the workspace shell's own tab-group tree is out of this
          component's ownership. */}
      <DialogContent
        showCloseButton={false}
        className="flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">{T('title', 'New session')}</DialogTitle>
        <LaunchAgentsBody
          repoId={typeof modalData.repoId === 'string' ? modalData.repoId : null}
          onClose={closeModal}
        />
      </DialogContent>
    </Dialog>
  )
}

function LaunchAgentsBody({
  repoId: repoIdOverride,
  onClose
}: {
  repoId: string | null
  onClose: () => void
}): React.JSX.Element {
  const repos = useAppStore((s) => s.repos)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const settings = useAppStore((s) => s.settings)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)

  const repoId = repoIdOverride ?? activeRepoId
  const repo = repos.find((entry) => entry.id === repoId) ?? null
  const retired = useRetiredWorktreeNames(repoId ?? null, repoId ?? '')
  const repoWorktrees = repoId ? (worktreesByRepo[repoId] ?? []) : []
  // Why: detect on the host the shared-checkout launch will run on, so SSH/WSL projects list their own CLIs.
  const launchWorktreeId =
    repoWorktrees.find((candidate) => candidate.id === activeWorktreeId)?.id ??
    repoWorktrees[0]?.id ??
    null
  const detectionTarget = useAgentDetectionTargetForWorktree(launchWorktreeId)
  const {
    detectedIds: detectedAgentList,
    isLoading,
    isRefreshing,
    detectionFailed,
    refresh
  } = useDetectedAgents(detectionTarget)

  const agents = useMemo(() => {
    const detected = new Set<TuiAgent>(detectedAgentList ?? [])
    return getAgentCatalog().filter(
      (entry) => isTuiAgentEnabled(entry.id, settings?.disabledTuiAgents) && detected.has(entry.id)
    )
  }, [detectedAgentList, settings?.disabledTuiAgents])

  const [selectedAgent, setSelectedAgent] = useState<TuiAgent | null>(null)
  const [count, setCount] = useState(1)
  // Why: sessions of a project share its checkout by default; a worktree per seat is opt-in.
  const [isolation, setIsolation] = useState<LaunchIsolationMode>('shared-checkout')
  const [slots, setSlots] = useState<LaunchAgentSlot[]>([])
  const [prompt, setPrompt] = useState('')
  const [launching, setLaunching] = useState(false)

  // Why: a refresh or host switch can remove the selected CLI; keep the lineup launchable.
  useEffect(() => {
    if (!agents.some((entry) => entry.id === selectedAgent)) {
      const next = agents[0]?.id ?? null
      setSelectedAgent(next)
      setSlots((prev) => (next ? retargetLaunchSlots(prev, next) : []))
    }
  }, [agents, selectedAgent])

  useEffect(() => {
    setSlots((prev) => resizeLaunchSlots(prev, count, selectedAgent))
  }, [count, selectedAgent])

  const selectAgent = (agent: TuiAgent): void => {
    setSelectedAgent(agent)
    setSlots((prev) =>
      prev.length > 0
        ? retargetLaunchSlots(prev, agent)
        : [{ agent, model: defaultLaunchModel(agent) }]
    )
  }

  const newWorktreeAvailable = repo ? isNewWorktreeIsolationAvailable(repo) : false
  const effectiveIsolation: LaunchIsolationMode =
    isolation === 'new-worktree' && newWorktreeAvailable ? 'new-worktree' : 'shared-checkout'

  const launch = async (): Promise<void> => {
    if (
      !repo ||
      !settings ||
      isLoading ||
      isRefreshing ||
      slots.length === 0 ||
      slots.some((slot) => !agents.some((agent) => agent.id === slot.agent))
    ) {
      return
    }
    setLaunching(true)
    try {
      if (effectiveIsolation === 'shared-checkout') {
        // Why: sessions land in the workspace the user is looking at when it belongs to
        // this project, else in the project's own checkout.
        const worktrees = worktreesByRepo[repo.id] ?? []
        const activeWorktreeId = useAppStore.getState().activeWorktreeId
        const worktree =
          worktrees.find((candidate) => candidate.id === activeWorktreeId) ?? worktrees[0]
        if (!worktree) {
          toast.error(T('noCheckout', 'No checkout found for this project yet.'))
          return
        }
        const seats = buildSharedCheckoutSeatRequests({ slots, prompt })
        const launched = await runSharedCheckoutLaunch(worktree.id, worktree.path, seats, settings)
        if (launched === 0) {
          toast.error(T('noneLaunched', 'No agent sessions could be started.'))
          return
        }
        toast.success(T('launched', 'Launching {{count}} agent sessions', { count: launched }))
        onClose()
        return
      }
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
        setupDecision: trust === 'skip' ? 'skip' : setup.decision,
        worktreesByRepo,
        retired
      }).filter((request) => request.startupPlan !== null)
      if (requests.length === 0) {
        toast.error(T('noneLaunched', 'No agent sessions could be started.'))
        return
      }
      for (const request of requests) {
        runBackgroundWorktreeCreation(request)
      }
      toast.success(T('launched', 'Launching {{count}} agent sessions', { count: requests.length }))
      onClose()
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-6 py-3">
        <span className="rounded-full border border-border bg-accent px-2 py-0.5 text-xs font-medium text-foreground">
          {repo?.displayName ?? T('noProject', 'No project')}
        </span>
        <h2 className="text-sm font-medium text-foreground">{T('title', 'New session')}</h2>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {repo?.path ?? ''}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={T('close', 'Close')}
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
        <div className="flex w-full max-w-[520px] flex-col gap-6">
          <Section label={T('agentSection', 'Agent')}>
            <LaunchAgentGrid
              agents={agents}
              selected={selectedAgent}
              onSelect={selectAgent}
              emptyMessage={
                isLoading
                  ? T('detectingAgents', 'Looking for agent CLIs on this host…')
                  : detectionFailed
                    ? T(
                        'detectionFailed',
                        'Could not check this host for agent CLIs. Try Refresh agents.'
                      )
                    : T('noAgentsDetected', 'No agent CLIs detected on this host yet.')
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="self-start"
              disabled={isLoading || isRefreshing}
              aria-busy={isRefreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              {T('refreshAgents', 'Refresh agents')}
            </Button>
          </Section>

          <Section label={T('howManySection', 'How many')}>
            <LaunchSeatCountPicker count={count} onChange={setCount} />
          </Section>

          <Section label={T('isolationSection', 'Isolation')}>
            <LaunchIsolationToggle
              mode={effectiveIsolation}
              onChange={setIsolation}
              newWorktreeAvailable={newWorktreeAvailable}
            />
          </Section>

          <Section label={T('willLaunchSection', 'Will launch')}>
            <LaunchAgentsLineup
              slots={slots}
              agentLabel={getAgentLabel}
              onModelChange={(index, model) =>
                setSlots((prev) =>
                  // Why: a new model rarely shares the old one's option ids or
                  // choices, so a carried-over override could apply to the wrong thing.
                  prev.map((slot, i) => (i === index ? { ...slot, model, options: {} } : slot))
                )
              }
              onOptionChange={(index, optionId, value) =>
                setSlots((prev) =>
                  prev.map((slot, i) =>
                    i === index
                      ? { ...slot, options: { ...slot.options, [optionId]: value } }
                      : slot
                  )
                )
              }
            />
          </Section>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              {T('prompt', 'Prompt for every session (optional)')}
            </span>
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={3}
              placeholder={T(
                'promptPlaceholder',
                'Describe the task. Leave empty to just open the agents.'
              )}
            />
          </label>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border px-6 py-3">
        <p className="text-xs text-muted-foreground">
          {T('footer', '{{count}} sessions in {{repo}}', {
            count: slots.length,
            repo: repo?.displayName ?? ''
          })}
        </p>
        <Button
          type="button"
          size="sm"
          disabled={launching || isLoading || isRefreshing || slots.length === 0 || repo === null}
          onClick={() => void launch()}
        >
          <Rocket className="size-3.5" />
          {T('launchCount', 'Launch {{count}}', { count: slots.length })}
        </Button>
      </div>
    </div>
  )
}

function Section({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}
