import type { PaneManagerHost } from './pane-manager-host'
import { applyDividerStyles, disposeDividersIn } from './pane-divider'
import { disposeWebgl } from './pane-webgl-renderer'
import { reattachWebglIfNeeded } from './pane-webgl-reattach'
import { captureScrollState } from './pane-scroll'
import { clearPendingSplitScrollRestore, scheduleSplitScrollRestore } from './pane-split-scroll'
import { wrapInSplit } from './pane-tree-ops'

function buildChain(
  host: PaneManagerHost,
  containers: HTMLElement[],
  isVertical: boolean
): HTMLElement {
  const staging = document.createElement('div')
  staging.appendChild(containers[0])
  for (let index = 1; index < containers.length; index += 1) {
    const current = staging.firstElementChild as HTMLElement
    wrapInSplit(current, containers[index], isVertical, host.createDivider(isVertical), {
      ratio: index / (index + 1)
    })
  }
  return staging.firstElementChild as HTMLElement
}

/** Rebuilds split wrappers around the same mounted panes and terminal instances. */
export function rearrangeManagedPaneGrid(host: PaneManagerHost, rows: readonly number[]): boolean {
  const paneElements = Array.from(host.root.querySelectorAll<HTMLElement>('.pane[data-pane-id]'))
  const orderedPanes = paneElements.map((element) => host.panes.get(Number(element.dataset.paneId)))
  if (
    host.isDestroyed() ||
    rows.length === 0 ||
    rows.some((count) => !Number.isInteger(count) || count < 1) ||
    rows.reduce((sum, count) => sum + count, 0) !== host.panes.size ||
    orderedPanes.length !== host.panes.size ||
    orderedPanes.some((pane, index) => !pane || pane.container !== paneElements[index]) ||
    new Set(orderedPanes).size !== host.panes.size
  ) {
    return false
  }

  const panes = orderedPanes as NonNullable<(typeof orderedPanes)[number]>[]
  const captures = panes.map((pane) => {
    clearPendingSplitScrollRestore(pane)
    const scroll = captureScrollState(pane.terminal)
    pane.pendingSplitScrollState = scroll
    const hadWebgl = !!pane.webglAddon
    disposeWebgl(pane)
    return { pane, scroll, hadWebgl }
  })
  disposeDividersIn(host.root)

  let cursor = 0
  const rowRoots = rows.map((count) => {
    const row = buildChain(
      host,
      panes.slice(cursor, cursor + count).map((pane) => pane.container),
      true
    )
    cursor += count
    return row
  })
  const grid = buildChain(host, rowRoots, false)
  host.root.replaceChildren(grid)
  applyDividerStyles(host.root, host.getStyleOptions())
  host.options.onLayoutChanged?.()
  for (const { pane, scroll, hadWebgl } of captures) {
    scheduleSplitScrollRestore(
      (id) => host.panes.get(id),
      pane.id,
      scroll,
      host.isDestroyed,
      hadWebgl ? reattachWebglIfNeeded : undefined
    )
  }
  return true
}
