// Why: `git worktree add`/`remove` on a large repo write thousands of files, which the base
// watcher sees as a burst and turns into repeated `worktrees:changed`/`gitStatusMetadataChanged`
// fanout — those trigger renderer refetches whose git subprocesses compete with the mutation's
// own `git worktree add`/`remove` for disk and CPU. Hold watcher-driven notifications for a repo
// while its own mutation is in flight; the mutation's end-of-flow notification still fires.

const GATE_TIMEOUT_MS = 10 * 60 * 1000

type GateState = {
  tokens: Set<symbol>
  onRelease: Set<() => void>
}

const gates = new Map<string, GateState>()

function getOrCreateGate(repoId: string): GateState {
  let gate = gates.get(repoId)
  if (!gate) {
    gate = { tokens: new Set(), onRelease: new Set() }
    gates.set(repoId, gate)
  }
  return gate
}

export function isWorktreeMutationGated(repoId: string): boolean {
  return (gates.get(repoId)?.tokens.size ?? 0) > 0
}

/** Call at the start of a create/remove; call the returned function once it finishes
 *  (success or failure). Bounded by GATE_TIMEOUT_MS so a wedged mutation can't mute a
 *  repo's watcher notifications forever. */
export function beginWorktreeMutationGate(repoId: string): () => void {
  const gate = getOrCreateGate(repoId)
  const token = Symbol('worktree-mutation-gate-token')
  gate.tokens.add(token)
  let released = false
  const timer = setTimeout(() => release(), GATE_TIMEOUT_MS)
  timer.unref?.()

  function release(): void {
    if (released) {
      return
    }
    released = true
    clearTimeout(timer)
    gate.tokens.delete(token)
    if (gate.tokens.size > 0) {
      return
    }
    gates.delete(repoId)
    const callbacks = [...gate.onRelease]
    gate.onRelease.clear()
    for (const callback of callbacks) {
      callback()
    }
  }

  return release
}

/** Registers a one-shot callback for when `repoId` has no in-flight mutation left.
 *  Runs immediately if nothing is gating the repo right now. */
export function onWorktreeMutationGateRelease(repoId: string, callback: () => void): void {
  const gate = gates.get(repoId)
  if (!gate) {
    callback()
    return
  }
  gate.onRelease.add(callback)
}
