import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import type { WorktreeUnpushedStatusQuery } from '../../../../shared/git-unpushed-status'
import { applyWorktreeUnpushedStatuses } from './worktree-unpushed-status-store'

// Why: a slow safety net is enough once focus/mount refreshes already keep this fresh.
const UNPUSHED_STATUS_POLL_INTERVAL_MS = 60_000
// Why: many cards register within the same render burst (initial mount, scroll); coalesce
// them into one batched call instead of one per card.
const REGISTRATION_FETCH_DEBOUNCE_MS = 150

const registry = new Map<string, WorktreeUnpushedStatusQuery>()
let pendingFetch: Promise<void> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pollingStarted = false
let stopPolling: (() => void) | null = null

/** Registers a worktree as visible in the sidebar; call from a card's mount effect. */
export function registerWorktreeForUnpushedStatus(query: WorktreeUnpushedStatusQuery): () => void {
  registry.set(query.worktreeId, query)
  ensureWorktreeUnpushedStatusPollingStarted()
  scheduleWorktreeUnpushedStatusFetch()
  return () => {
    if (registry.get(query.worktreeId) === query) {
      registry.delete(query.worktreeId)
    }
    // Why: stop the interval/focus listener once nothing is left to check — an empty
    // sidebar (or a test that unmounts every card) should not poll in the background.
    if (registry.size === 0) {
      stopWorktreeUnpushedStatusPolling()
    }
  }
}

function stopWorktreeUnpushedStatusPolling(): void {
  stopPolling?.()
  stopPolling = null
  pollingStarted = false
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function scheduleWorktreeUnpushedStatusFetch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void fetchWorktreeUnpushedStatuses()
  }, REGISTRATION_FETCH_DEBOUNCE_MS)
}

/** Fetches the currently-registered worktrees now (single-flight); safe to call from
 *  triggers (focus, interval) as well as the debounced registration path. */
export function fetchWorktreeUnpushedStatuses(): Promise<void> {
  if (pendingFetch) {
    return pendingFetch
  }
  // Why optional chaining: many card tests stub only part of window.api, and a paired
  // web/mobile client never sets this method at all.
  const unpushedStatus = window.api?.worktrees?.unpushedStatus
  const worktrees = [...registry.values()]
  if (!unpushedStatus || worktrees.length === 0) {
    return Promise.resolve()
  }
  pendingFetch = unpushedStatus({ worktrees })
    .then((statuses) => {
      applyWorktreeUnpushedStatuses(statuses)
    })
    .catch(() => undefined)
    .finally(() => {
      pendingFetch = null
    })
  return pendingFetch
}

function ensureWorktreeUnpushedStatusPollingStarted(): void {
  if (pollingStarted) {
    return
  }
  pollingStarted = true
  const stopInterval = installWindowVisibilityInterval({
    run: () => void fetchWorktreeUnpushedStatuses(),
    // Why a no-op: the debounced registration fetch already covers "just started",
    // and the focus listener below covers "regained focus" — this interval only
    // needs to own the periodic tick.
    runOnVisible: () => {},
    intervalMs: UNPUSHED_STATUS_POLL_INTERVAL_MS
  })
  const onFocus = (): void => void fetchWorktreeUnpushedStatuses()
  window.addEventListener('focus', onFocus)
  stopPolling = () => {
    stopInterval()
    window.removeEventListener('focus', onFocus)
  }
}

/** Test-only: tears down the singleton poller/registry between specs. */
export function resetWorktreeUnpushedStatusPollingForTests(): void {
  stopWorktreeUnpushedStatusPolling()
  registry.clear()
  pendingFetch = null
}
