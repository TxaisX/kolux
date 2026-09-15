import { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentRowDotState } from '@/lib/agent-row-dot-state'
import { agentTypeToIconAgent, formatAgentTypeLabel } from '@/lib/agent-status'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { AgentTargetMenuItem } from '@/components/editor/ReviewNotesSendMenuContent'
import type { WorkspaceComposerTarget } from './use-workspace-composer-targets'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.composer.ComposerAgentPicker.${id}`, fallback)

/** Chip 1: which running agent in this workspace the composer talks to. */
export function ComposerAgentPicker({
  targets,
  selectedPaneKey,
  onSelect
}: {
  targets: WorkspaceComposerTarget[]
  selectedPaneKey: string | null
  onSelect: (paneKey: string) => void
}): React.JSX.Element {
  const now = useNow(30_000)
  const selected = useMemo(
    () => targets.find(({ target }) => target.paneKey === selectedPaneKey) ?? null,
    [targets, selectedPaneKey]
  )

  if (targets.length === 0) {
    return (
      <span className="inline-flex h-6 items-center rounded-md px-2 text-xs text-muted-foreground">
        {T('none', 'No agent running')}
      </span>
    )
  }

  const agentType = selected?.target.agentType ?? selected?.agent?.agentType
  const dotState = selected
    ? agentRowDotState(selected.agent?.state ?? 'idle', selected.agent?.entry.workingMode)
    : 'idle'
  const model = selected?.agent?.entry.model?.trim()
  const label = formatAgentTypeLabel(agentType)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 items-center gap-1.5 rounded-md bg-secondary px-2 text-xs font-medium text-secondary-foreground hover:bg-accent"
        >
          <AgentStateDot state={dotState} size="sm" />
          <AgentIcon agent={agentTypeToIconAgent(agentType)} size={13} />
          <span className="max-w-40 truncate">{model ? `${label} · ${model}` : label}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top">
        <DropdownMenuLabel>{T('label', 'Message')}</DropdownMenuLabel>
        {targets.map(({ target, agent }) => (
          <AgentTargetMenuItem
            key={target.paneKey}
            target={target}
            agent={agent}
            now={now}
            disabled={target.status !== 'eligible'}
            onSend={(chosen) => onSelect(chosen.paneKey)}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
