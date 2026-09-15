import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'

/**
 * Real (not scaled) fit for a window that owns its whole grid: measures the
 * container with FitAddon, resizes the local terminal, and — deduped by the
 * resulting cols/rows so an unchanged size never re-requests — pushes that
 * size to the pty via the same `terminalPreview.fit` call the dashboard
 * preview issues when it wins its grid claim. There is no other viewer to
 * contend with here, so the claim always lands.
 */
export function createTerminalWindowFit(args: {
  ptyId: string
  container: HTMLElement
  fitAddon: FitAddon
  getTerminal: () => Terminal | null
  isDisposed: () => boolean
}): { schedule: () => void; dispose: () => void } {
  let lastRequestedFit: string | null = null
  let scheduled = false

  const requestFit = (): void => {
    if (args.isDisposed() || !args.getTerminal()) {
      return
    }
    let dimensions: { cols: number; rows: number } | undefined
    try {
      args.fitAddon.fit()
      dimensions = { cols: args.getTerminal()!.cols, rows: args.getTerminal()!.rows }
    } catch {
      return
    }
    if (dimensions.cols <= 0 || dimensions.rows <= 0) {
      return
    }
    const fitKey = `${dimensions.cols}x${dimensions.rows}`
    if (fitKey === lastRequestedFit) {
      return
    }
    lastRequestedFit = fitKey
    void window.api.terminalPreview
      .fit(args.ptyId, dimensions.cols, dimensions.rows)
      .catch(() => undefined)
  }

  const schedule = (): void => {
    if (scheduled) {
      return
    }
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      requestFit()
    })
  }

  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule())
  resizeObserver?.observe(args.container)

  return {
    schedule,
    dispose: () => resizeObserver?.disconnect()
  }
}
