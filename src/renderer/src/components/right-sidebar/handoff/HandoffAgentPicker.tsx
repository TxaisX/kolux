import { Send } from 'lucide-react'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import { DEFAULT_DISABLED_TUI_AGENTS } from '../../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../../shared/tui-agent'
import { getAgentPickerOptions } from '../../agent-picker/agent-picker-options'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.right-sidebar.handoff.HandoffAgentPicker.${id}`, fallback)

/** "Hand to agent…" button: a popover of agents detected on this workspace's host. */
export function HandoffAgentPicker({
  worktreeId,
  disabled,
  onPick
}: {
  worktreeId: string
  disabled?: boolean
  onPick: (agent: TuiAgent) => void
}): React.JSX.Element {
  const target = useAgentDetectionTargetForWorktree(worktreeId)
  const { detectedIds } = useDetectedAgents(target)
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const disabledAgents = useAppStore(
    (s) => s.settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS
  )
  const agents = detectedIds ? getAgentPickerOptions(detectedIds, defaultAgent, disabledAgents) : []

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" disabled={disabled} className="gap-1.5">
          <Send className="size-3.5" aria-hidden="true" />
          {T('trigger', 'Hand to agent…')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {agents.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {T('empty', 'No agents detected on this workspace.')}
          </p>
        ) : (
          agents.map((agent) => (
            <button
              key={agent}
              type="button"
              onClick={() => onPick(agent)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
            >
              <AgentIcon agent={agent} size={14} />
              <span>{getAgentLabel(agent)}</span>
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  )
}
