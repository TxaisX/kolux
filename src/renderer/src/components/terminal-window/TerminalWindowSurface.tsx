import { terminalPreviewUnavailableMessage } from '@/components/dashboard-popout/terminal-preview-unavailable-message'
import { cn } from '@/lib/utils'

type TerminalWindowSurfaceProps = {
  ptyId: string
  containerRef: React.RefObject<HTMLDivElement | null>
  ptyGone: boolean
}

/** The terminal body below the header row — full-bleed, matching a normal
 *  pane's rounded-card frame (`.pane-title-overlay-layer`). Shows a quiet
 *  message instead of a blank box once the pty is confirmed gone. The xterm
 *  container itself always stays mounted (just hidden) so the connection
 *  hook's ref never goes stale mid-effect. */
export function TerminalWindowSurface({
  ptyId,
  containerRef,
  ptyGone
}: TerminalWindowSurfaceProps): React.JSX.Element {
  return (
    <div className="absolute inset-0 min-h-0 min-w-0 bg-background">
      <div className="pane-title-overlay-layer" aria-hidden="true" />
      {ptyGone ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 py-8 text-center text-[13px] text-muted-foreground">
          {terminalPreviewUnavailableMessage({ ptyId })}
        </div>
      ) : null}
      <div
        ref={containerRef}
        aria-hidden={ptyGone || undefined}
        className={cn('w-full overflow-hidden p-1.5', ptyGone && 'invisible')}
        style={{
          marginTop: 'var(--nightshift-pane-title-height)',
          height: 'calc(100% - var(--nightshift-pane-title-height))'
        }}
      />
    </div>
  )
}
