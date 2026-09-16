// Selects the raw slices deriveInboxItems needs and re-derives on change.
// Kept as its own hook so InboxPage/InboxList stay presentational.
import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import { getIndexedAllWorktrees } from '@/store/worktree-repo-index'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import { deriveInboxItems, type InboxGroups } from './inbox-items'

const AGE_TICK_MS = 60_000

/** Re-renders once a minute so relative ages ("34m", "No update in 12m") stay current. */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), AGE_TICK_MS)
    return () => clearInterval(id)
  }, [])
  return now
}

export function useInboxGroups(): InboxGroups {
  const now = useMinuteTick()
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const tabsByWorktree = useAppStore((s) => s.tabsByWorktree)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const repos = useAppStore((s) => s.repos)
  const ptyIdsByTabId = useAppStore((s) => s.ptyIdsByTabId)
  const branchLineTotalByWorktree = useAppStore((s) => s.gitBranchLineTotalByWorktree)
  const settings = useAppStore((s) => s.settings)

  const worktrees = useMemo(() => getIndexedAllWorktrees(worktreesByRepo), [worktreesByRepo])
  const hostLabelById = useMemo(() => getHostDisplayLabelOverrides(settings), [settings])

  return useMemo(
    () =>
      deriveInboxItems({
        now,
        agentStatusByPaneKey,
        tabsByWorktree,
        worktrees,
        repos,
        hostLabelById,
        branchLineTotalByWorktree,
        ptyIdsByTabId
      }),
    [
      now,
      agentStatusByPaneKey,
      tabsByWorktree,
      worktrees,
      repos,
      hostLabelById,
      branchLineTotalByWorktree,
      ptyIdsByTabId
    ]
  )
}
