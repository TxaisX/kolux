import React from 'react'
import { Check } from 'lucide-react'
import { AgentIcon, type AgentCatalogEntry } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import type { TuiAgent } from '../../../../shared/tui-agent'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.launch-agents.LaunchAgentGrid.${id}`, fallback)

/**
 * AGENT section: a single-select 3-column grid of every enabled agent CLI
 * detected on this machine. Detection can be slow or find nothing — the
 * caller decides `agents`, so an empty list here just means "show the empty
 * state", never a blocked or endlessly spinning grid.
 */
export function LaunchAgentGrid({
  agents,
  selected,
  onSelect,
  emptyMessage
}: {
  agents: readonly AgentCatalogEntry[]
  selected: TuiAgent | null
  onSelect: (agent: TuiAgent) => void
  emptyMessage?: string
}): React.JSX.Element {
  if (agents.length === 0) {
    return (
      <p className="rounded-md border border-border bg-background px-3 py-4 text-center text-xs text-muted-foreground">
        {emptyMessage ?? T('noAgentsDetected', 'No agent CLIs detected on this host yet.')}
      </p>
    )
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {agents.map((entry) => {
        const isSelected = entry.id === selected
        return (
          <button
            key={entry.id}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(entry.id)}
            className={`relative flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-xs font-medium transition-colors ${
              isSelected
                ? 'border-primary bg-accent text-foreground'
                : 'border-border bg-background text-foreground hover:border-muted-foreground/35 hover:bg-accent'
            }`}
          >
            {isSelected ? (
              <Check
                className="absolute right-1.5 top-1.5 size-3 text-primary"
                aria-hidden="true"
              />
            ) : null}
            <AgentIcon agent={entry.id} size={20} />
            <span className="truncate">{entry.label}</span>
          </button>
        )
      })}
    </div>
  )
}
