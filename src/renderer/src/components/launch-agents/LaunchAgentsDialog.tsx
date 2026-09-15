import React, { useEffect, useMemo, useState } from 'react'
import { Rocket, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { getAgentCatalog, getAgentLabel } from '@/lib/agent-catalog'
import { runBackgroundWorktreeCreation } from '@/lib/worktree-creation-flow'
import { openTerminalWindowWhenSeatIsReady } from './launch-agents-window-handoff'
import { resolveDirectSetupDecision } from '@/lib/launch-work-item-direct-preflight'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { useRetiredWorktreeNames } from '@/hooks/useRetiredWorktreeNames'
import { translate } from '@/i18n/i18n'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  buildLaunchAgentsRequests,
  buildSharedCheckoutSeatRequests,
  defaultIsolationMode,
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
  const detectedAgentList = useAppStore((s) => s.detectedAgentIds)
  const ensureDetectedAgents = useAppStore((s) => s.ensureDetectedAgents)

  const repoId = repoIdOverride ?? activeRepoId
  const repo = repos.find((entry) => entry.id === repoId) ?? null
  const retired = useRetiredWorktreeNames(repoId ?? null, repoId ?? '')

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

  const [selectedAgent, setSelectedAgent] = useState<TuiAgent | null>(null)
  const [count, setCount] = useState(1)
  const [isolation, setIsolation] = useState<LaunchIsolationMode | null>(null)
  const [slots, setSlots] = useState<LaunchAgentSlot[]>([])
  const [prompt, setPrompt] = useState('')
  const [launching, setLaunching] = useState(false)

  // Why: pick the first detected agent once detection resolves, rather than
  // blocking the grid on a default that may not be installed here.
  useEffect(() => {
    if (selectedAgent === null && agents.length > 0) {
      setSelectedAgent(agents[0].id)
    }
  }, [agents, selectedAgent])

  useEffect(() => {
    if (isolation === null && repo) {
      setIsolation(defaultIsolationMode(repo))
    }
  }, [isolation, repo])

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
    isolation && (isolation !== 'new-worktree' || newWorktreeAvailable)
      ? isolation
      : 'shared-checkout'

  const launch = async (): Promise<void> => {
    if (!repo || !settings || slots.length === 0) {
      return
    }
    setLaunching(true)
    try {
      if (effectiveIsolation === 'shared-checkout') {
        const worktreeId = worktreesByRepo[repo.id]?.[0]?.id
        if (!worktreeId) {
          toast.error(T('noCheckout', 'No checkout found for this project yet.'))
          return
        }
        const seats = buildSharedCheckoutSeatRequests({ slots, prompt })
        runSharedCheckoutLaunch(worktreeId, seats, settings)
        toast.success(T('launched', 'Launching {{count}} agent sessions', { count: seats.length }))
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
      })
      for (const request of requests) {
        const creationId = runBackgroundWorktreeCreation(request)
        // Why: every seat is its own terminal window — hand each one off as its
        // background worktree/tab creation concludes, reusing the existing
        // pending-creation lifecycle instead of re-deriving completion here.
        openTerminalWindowWhenSeatIsReady(creationId, repo.id, request.name)
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
            <LaunchAgentGrid agents={agents} selected={selectedAgent} onSelect={selectAgent} />
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
                setSlots((prev) => prev.map((slot, i) => (i === index ? { ...slot, model } : slot)))
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
          disabled={launching || slots.length === 0 || repo === null}
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
