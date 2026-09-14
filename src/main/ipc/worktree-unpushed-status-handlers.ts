import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import { isFolderRepo } from '../../shared/repo-kind'
import { mapWithConcurrency } from '../../shared/map-with-concurrency'
import type {
  WorktreeUnpushedStatus,
  WorktreeUnpushedStatusQuery
} from '../../shared/git-unpushed-status'
import { resolveWorktreeUnpushedStatus } from './worktree-unpushed-status'

// Why: one badge refresh can cover a large sidebar; cap fan-out so it can't spawn
// unbounded git subprocesses (or SSH round-trips) at once.
const UNPUSHED_STATUS_CONCURRENCY = 4
// Why: a malformed/huge renderer request must not turn into an unbounded scan.
const MAX_UNPUSHED_STATUS_QUERIES = 500

export function registerWorktreeUnpushedStatusHandlers(store: Store): void {
  ipcMain.removeHandler('worktrees:unpushedStatus')
  ipcMain.handle(
    'worktrees:unpushedStatus',
    async (
      _event,
      args?: { worktrees?: WorktreeUnpushedStatusQuery[] }
    ): Promise<Record<string, WorktreeUnpushedStatus>> => {
      const queries = Array.isArray(args?.worktrees)
        ? args.worktrees.slice(0, MAX_UNPUSHED_STATUS_QUERIES)
        : []
      const entries = await mapWithConcurrency(
        queries,
        UNPUSHED_STATUS_CONCURRENCY,
        async (query): Promise<[string, WorktreeUnpushedStatus]> => {
          const repo = query.repoId ? store.getRepo(query.repoId) : undefined
          if (!repo || isFolderRepo(repo)) {
            return [query.worktreeId, { kind: 'unknown' }]
          }
          const status = await resolveWorktreeUnpushedStatus(
            {
              path: query.path,
              hostId: query.hostId,
              isMainWorktree: query.isMainWorktree
            },
            repo
          )
          return [query.worktreeId, status]
        }
      )
      return Object.fromEntries(entries)
    }
  )
}
