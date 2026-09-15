import { SquareTerminal } from 'lucide-react'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { AgentIcon } from '@/lib/agent-catalog'
import type { TuiAgent } from '../../../../shared/tui-agent'

type TerminalPaneHeaderIdentityProps = {
  agent: TuiAgent | null
  dotState: AgentDotState
}

/** Left side of the pane header: state dot + the running agent's logo mark.
 *  No title text — see the terminal-pane header spec in AGENTS.md. Falls back
 *  to a plain terminal glyph when no agent is identified for this pane. */
export function TerminalPaneHeaderIdentity({
  agent,
  dotState
}: TerminalPaneHeaderIdentityProps): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <AgentStateDot state={dotState} size="sm" />
      <span
        className="inline-flex shrink-0"
        data-agent-icon={agent ?? undefined}
        aria-hidden="true"
      >
        {agent ? (
          <AgentIcon agent={agent} size={13} />
        ) : (
          <SquareTerminal className="size-3.5 text-muted-foreground" />
        )}
      </span>
    </span>
  )
}
