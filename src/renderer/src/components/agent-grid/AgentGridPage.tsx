import { useMemo } from 'react'
import { LayoutGrid } from 'lucide-react'
import { useAppStore } from '@/store'
import { useLiveDashboardSnapshot } from '@/components/dashboard/useLiveDashboardSnapshot'
import { translate } from '@/i18n/i18n'
import { agentGridFontSize } from './agent-grid-font-size'
import { AgentGridTile, type LiveAgentGridCard } from './AgentGridTile'
import type { DashboardCard } from '../../../../shared/dashboard-snapshot'

const MAX_TILES = 6

/** One tile per worktree (its first live-pty card), capped and scoped to the active repo. */
export function selectAgentGridCards(cards: DashboardCard[], repoId: string): LiveAgentGridCard[] {
  const seenWorktreeIds = new Set<string>()
  const result: LiveAgentGridCard[] = []
  for (const card of cards) {
    if (card.repoId !== repoId || card.ptyId === null || seenWorktreeIds.has(card.worktreeId)) {
      continue
    }
    seenWorktreeIds.add(card.worktreeId)
    result.push(card as LiveAgentGridCard)
    if (result.length === MAX_TILES) {
      break
    }
  }
  return result
}

export default function AgentGridPage(): React.JSX.Element {
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const repos = useAppStore((s) => s.repos)
  const snapshot = useLiveDashboardSnapshot()
  // Why: remote/SSH repos have no in-window preview terminal support yet — show the empty state rather than a broken tile.
  const isLocalRepo = useMemo(() => {
    const repo = repos.find((r) => r.id === activeRepoId)
    return !repo?.executionHostId || repo.executionHostId === 'local'
  }, [repos, activeRepoId])
  const cards = useMemo(
    () => (activeRepoId && isLocalRepo ? selectAgentGridCards(snapshot.cards, activeRepoId) : []),
    [snapshot.cards, activeRepoId, isLocalRepo]
  )
  const fontSize = agentGridFontSize(cards.length)
  const placeholderCount = Math.max(0, MAX_TILES - cards.length)

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3">
        <LayoutGrid className="size-4 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-base font-semibold text-foreground">
          {translate('agentGrid.title', 'Agent grid')}
        </h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 scrollbar-sleek">
        {cards.length === 0 ? (
          <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground">
            {translate('agentGrid.empty', 'No live agents in this project yet.')}
          </div>
        ) : (
          <div className="grid h-full min-h-[480px] grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2">
            {cards.map((card) => (
              <AgentGridTile key={card.worktreeId} card={card} fontSize={fontSize} />
            ))}
            {Array.from({ length: placeholderCount }, (_, index) => (
              <div
                key={`agent-grid-empty-${index}`}
                aria-hidden="true"
                className="rounded-md border border-dashed border-border/60"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
