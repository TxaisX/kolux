import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentTerminalPreview } from '@/components/dashboard-popout/AgentTerminalPreview'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { translate } from '@/i18n/i18n'
import {
  dashboardCardDisplayState,
  type DashboardCard
} from '../../../../shared/dashboard-snapshot'

/** A grid card is a live agent card whose pty resolved (see AgentGridPage). */
export type LiveAgentGridCard = DashboardCard & { ptyId: string }

export function AgentGridTile({
  card,
  fontSize
}: {
  card: LiveAgentGridCard
  fontSize: number
}): React.JSX.Element {
  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-popover">
      <button
        type="button"
        onClick={() => activateAndRevealWorktree(card.worktreeId)}
        className="flex shrink-0 items-center gap-1.5 border-b border-border px-2 py-1 text-left hover:bg-muted/40"
        aria-label={translate('agentGrid.openWorktree', 'Open worktree {{name}}', {
          name: card.worktreeName
        })}
      >
        <AgentStateDot state={dashboardCardDisplayState(card)} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
          {card.worktreeName}
        </span>
      </button>
      <AgentTerminalPreview
        ptyId={card.ptyId}
        terminalInput={card.terminalInput ?? null}
        fontSize={fontSize}
        className="h-auto min-h-0 flex-1"
      />
    </div>
  )
}
