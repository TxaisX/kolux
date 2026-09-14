import type { WorktreeUnpushedStatus } from '../../../../shared/git-unpushed-status'

type Listener = () => void

// Why: a plain module-level store (not a Zustand slice) — this data is ephemeral,
// best-effort, and read by many cards; useSyncExternalStore is the stdlib fit.
const statusByWorktreeId = new Map<string, WorktreeUnpushedStatus>()
const listeners = new Set<Listener>()

function statusEquals(a: WorktreeUnpushedStatus, b: WorktreeUnpushedStatus): boolean {
  if (a.kind !== b.kind) {
    return false
  }
  const countA = 'count' in a ? a.count : undefined
  const countB = 'count' in b ? b.count : undefined
  return countA === countB
}

export function subscribeWorktreeUnpushedStatus(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getWorktreeUnpushedStatusSnapshot(
  worktreeId: string
): WorktreeUnpushedStatus | undefined {
  return statusByWorktreeId.get(worktreeId)
}

export function applyWorktreeUnpushedStatuses(
  statuses: Record<string, WorktreeUnpushedStatus>
): void {
  let changed = false
  for (const [worktreeId, status] of Object.entries(statuses)) {
    const previous = statusByWorktreeId.get(worktreeId)
    if (!previous || !statusEquals(previous, status)) {
      statusByWorktreeId.set(worktreeId, status)
      changed = true
    }
  }
  if (changed) {
    for (const listener of listeners) {
      listener()
    }
  }
}

/** Test-only: reset between specs so one test's fetched statuses can't leak into another. */
export function clearWorktreeUnpushedStatusStoreForTests(): void {
  statusByWorktreeId.clear()
}
