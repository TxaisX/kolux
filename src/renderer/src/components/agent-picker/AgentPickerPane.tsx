import React from 'react'
import { RefreshCw, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { DEFAULT_DISABLED_TUI_AGENTS } from '../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { translate } from '@/i18n/i18n'
import { getAgentPickerOptions } from './agent-picker-options'

const T = (id: string, fallback: string, options?: Record<string, unknown>): string =>
  translate(`auto.components.agent-picker.AgentPickerPane.${id}`, fallback, options)

export type AgentPickerPaneProps = {
  /** Worktree the pane will launch into — drives agent detection, same as the
   *  tab-bar quick-launch menu. */
  worktreeId: string
  /** Name shown in the "Start vibe coding in <name>" heading. */
  workspaceName: string
  /** Fires once, with the chosen agent or `'blank'` for the plain terminal
   *  card. This component never launches anything itself — the call site owns
   *  routing the pick through the shared launch funnel. */
  onPick: (agent: TuiAgent | 'blank') => void
}

/**
 * BridgeMind-style empty-pane agent picker: a heading naming the workspace,
 * a grid of cards for every detected+enabled agent, and a full-width plain
 * Terminal card. Presentational — no store writes, no launch calls.
 */
export function AgentPickerPane({
  worktreeId,
  workspaceName,
  onPick
}: AgentPickerPaneProps): React.JSX.Element {
  const agentDetectionTarget = useAgentDetectionTargetForWorktree(worktreeId)
  const { detectedIds, isLoading, isRefreshing, refresh } = useDetectedAgents(agentDetectionTarget)
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const disabledAgents = useAppStore(
    (s) => s.settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS
  )
  const agents = detectedIds ? getAgentPickerOptions(detectedIds, defaultAgent, disabledAgents) : []

  return (
    <div className="scrollbar-sleek flex size-full flex-col items-center justify-center gap-6 overflow-y-auto p-8">
      <h2 className="text-center text-lg font-medium text-foreground">
        {T('heading', 'Start vibe coding in {{value0}}', { value0: workspaceName })}
      </h2>
      <div className="flex w-full max-w-lg flex-col gap-3">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="self-end"
          disabled={isLoading || isRefreshing}
          aria-busy={isRefreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {T('refreshAgents', 'Refresh agents')}
        </Button>
        {agents.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            {detectedIds && detectedIds.length > 0
              ? T('noEnabledAgents', 'No enabled agents. Check Agent settings.')
              : T('noAgentsDetected', 'No agents detected on this machine yet.')}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {agents.map((agent) => (
              <AgentPickerCard key={agent} agent={agent} onPick={onPick} />
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => onPick('blank')}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-3 text-sm font-medium text-foreground transition-colors hover:border-muted-foreground/35 hover:bg-accent"
        >
          <SquareTerminal className="size-4" aria-hidden="true" />
          {T('terminal', 'Terminal')}
        </button>
      </div>
    </div>
  )
}

function AgentPickerCard({
  agent,
  onPick
}: {
  agent: TuiAgent
  onPick: (agent: TuiAgent | 'blank') => void
}): React.JSX.Element {
  const label = getAgentLabel(agent)
  return (
    <button
      type="button"
      onClick={() => onPick(agent)}
      title={T('launchTitle', 'Launch {{value0}} in this pane', { value0: label })}
      className="flex flex-col items-center gap-2 rounded-lg border border-border bg-background px-4 py-5 text-sm font-medium text-foreground transition-colors hover:border-muted-foreground/35 hover:bg-accent"
    >
      <AgentIcon agent={agent} size={24} />
      <span>{label}</span>
    </button>
  )
}
