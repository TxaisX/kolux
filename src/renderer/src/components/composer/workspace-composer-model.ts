export type ComposerTargetStatus = 'eligible' | 'disabled'

export type ComposerTargetSummary = {
  paneKey: string
  status: ComposerTargetStatus
}

/**
 * Which agent the composer talks to by default: the focused pane's agent if
 * it is still a target of this workspace (eligible or not — the user just
 * came from there), otherwise the first eligible target, otherwise none.
 */
export function resolveDefaultComposerTargetPaneKey(
  targets: readonly ComposerTargetSummary[],
  focusedPaneKey: string | null
): string | null {
  if (focusedPaneKey && targets.some((target) => target.paneKey === focusedPaneKey)) {
    return focusedPaneKey
  }
  return targets.find((target) => target.status === 'eligible')?.paneKey ?? null
}

/**
 * `Tab` cycling order: every target of the workspace, in menu order,
 * wrapping around. A stale or missing current selection lands on the first
 * target rather than erroring.
 */
export function cycleComposerTargetPaneKey(
  targets: readonly ComposerTargetSummary[],
  currentPaneKey: string | null
): string | null {
  if (targets.length === 0) {
    return null
  }
  const currentIndex = targets.findIndex((target) => target.paneKey === currentPaneKey)
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % targets.length
  return targets[nextIndex].paneKey
}

/** Send requires real text and a target that can actually receive it. */
export function isComposerSendEnabled(
  draft: string,
  targetStatus: ComposerTargetStatus | undefined
): boolean {
  return draft.trim().length > 0 && targetStatus === 'eligible'
}
