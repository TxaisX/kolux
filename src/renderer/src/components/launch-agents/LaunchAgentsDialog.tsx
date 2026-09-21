import React, { useMemo, useState } from 'react'
import { Minus, Plus, RefreshCw, Rocket } from 'lucide-react'
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
import { AgentIcon, getAgentCatalog } from '@/lib/agent-catalog'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  expandLaunchAgentCounts,
  LAUNCH_AGENTS_MAX_PER_AGENT,
  type LaunchAgentCounts
} from './launch-agent-counts'
import { assignLaunchRoles, composeRolePrompt, getLaunchPreset } from './launch-agent-roles'
import { launchAgentsIntoWorkspace } from './launch-agents-into-workspace'
import { LaunchAgentsLineup, LaunchPresetRow } from './LaunchAgentsLineup'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.launch-agents.LaunchAgentsDialog.${id}`, fallback)

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
              'Pick how many sessions of each agent to open. Each one opens as a pane in the current workspace and gets the same prompt.'
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
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const settings = useAppStore((s) => s.settings)
  const detectionTarget = useAgentDetectionTargetForWorktree(activeWorktreeId)
  const { detectedIds, isLoading, isRefreshing, refresh } = useDetectedAgents(detectionTarget)

  // Why: sessions land as panes in the workspace the user is looking at; there is no project picker.
  const workspace = useMemo(
    () =>
      Object.values(worktreesByRepo)
        .flat()
        .find((worktree) => worktree.id === activeWorktreeId) ?? null,
    [activeWorktreeId, worktreesByRepo]
  )
  const projectName = repos.find((repo) => repo.id === workspace?.repoId)?.displayName ?? null
  const [prompt, setPrompt] = useState('')
  const [counts, setCounts] = useState<LaunchAgentCounts>({})
  const [presetId, setPresetId] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)

  const agents = useMemo(() => {
    const detected = detectedIds ? new Set<TuiAgent>(detectedIds) : null
    return getAgentCatalog().filter(
      (entry) =>
        isTuiAgentEnabled(entry.id, settings?.disabledTuiAgents) &&
        (detected === null || detected.has(entry.id))
    )
  }, [detectedIds, settings?.disabledTuiAgents])

  const expandedAgents = useMemo(() => expandLaunchAgentCounts(counts), [counts])
  const total = expandedAgents.length
  const preset = getLaunchPreset(presetId)
  const roles = useMemo(
    () => assignLaunchRoles(expandedAgents, preset?.roles ?? []),
    [expandedAgents, preset]
  )

  const setCount = (agent: TuiAgent, next: number): void => {
    setCounts((prev) => ({
      ...prev,
      [agent]: Math.max(0, Math.min(LAUNCH_AGENTS_MAX_PER_AGENT, next))
    }))
  }

  // Why: picking a shape with nothing queued should produce that shape, not an
  // empty lineup the user then has to build by hand one click at a time.
  const selectPreset = (nextPresetId: string | null): void => {
    setPresetId(nextPresetId)
    const nextPreset = getLaunchPreset(nextPresetId)
    const firstAgent = agents[0]
    if (!nextPreset || total > 0 || !firstAgent) {
      return
    }
    setCount(firstAgent.id, Math.min(nextPreset.roles.length, LAUNCH_AGENTS_MAX_PER_AGENT))
  }

  const launch = (): void => {
    if (!workspace || total === 0) {
      return
    }
    setLaunching(true)
    try {
      // Why: each session gets its role brief ahead of the shared task, so a wave
      // of N agents divides the work instead of repeating it N times.
      const launched = launchAgentsIntoWorkspace(
        workspace.id,
        expandedAgents.map((agent, index) => ({
          agent,
          prompt: composeRolePrompt(prompt.trim(), roles[index] ?? null)
        }))
      )
      if (launched === 0) {
        toast.error(T('launchFailed', 'Could not build a launch command for these agents.'))
        return
      }
      toast.success(
        translate(
          'auto.components.launch-agents.LaunchAgentsDialog.launched',
          'Launching {{count}} agent sessions',
          { count: launched }
        )
      )
      onClose()
    } finally {
      setLaunching(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{T('workspace', 'Workspace')}</span>
        {workspace ? (
          <span className="truncate text-muted-foreground">
            {projectName ? `${projectName} / ` : ''}
            {workspace.displayName}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {T('noWorkspace', 'Open a workspace first; sessions launch into it as panes.')}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{T('agents', 'Agents')}</span>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isLoading || isRefreshing}
            aria-busy={isRefreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            {T('refreshAgents', 'Refresh agents')}
          </Button>
        </div>
        <div className="scrollbar-sleek max-h-56 overflow-y-auto rounded-md border border-border">
          {agents.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {T('noAgents', 'No agent CLIs detected on this machine yet.')}
            </p>
          ) : null}
          {agents.map((entry) => {
            const count = counts[entry.id] ?? 0
            return (
              <div
                key={entry.id}
                className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0"
              >
                <AgentIcon agent={entry.id} size={14} />
                <span className="flex-1 truncate">{entry.label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={T('fewer', 'Fewer')}
                  disabled={count === 0}
                  onClick={() => setCount(entry.id, count - 1)}
                >
                  <Minus className="size-3.5" />
                </Button>
                <span className="w-5 text-center tabular-nums">{count}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={T('more', 'More')}
                  disabled={count >= LAUNCH_AGENTS_MAX_PER_AGENT}
                  onClick={() => setCount(entry.id, count + 1)}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      </div>

      <LaunchPresetRow presetId={presetId} onSelect={selectPreset} />

      <LaunchAgentsLineup agents={expandedAgents} roles={roles} />

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
          disabled={launching || total === 0 || workspace === null}
          onClick={launch}
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
