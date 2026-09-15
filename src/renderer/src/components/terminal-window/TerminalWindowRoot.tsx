import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useTerminalWindowTerminal } from './use-terminal-window-terminal'
import { TerminalWindowHeader } from './TerminalWindowHeader'
import { TerminalWindowSurface } from './TerminalWindowSurface'

type TerminalWindowRootProps = {
  sessionKey: string
  worktreeId: string
  tabId: string
  /** From the query string — see terminal-window.tsx. Not yet routed by main
   *  for every open path (see OpenTerminalSessionWindowArgs in
   *  terminal-session-window.ts); absent means "not wired yet", handled the
   *  same as a session that's genuinely gone. */
  ptyId: string | null
}

function closeThisWindow(sessionKey: string): void {
  void window.api.terminalWindows.close({ sessionKey })
}

/** No pty to attach to — either the session never had one wired to this
 *  window, or it's gone. Distinct from the surface's own "pty died" message,
 *  which still shows the window's normal header for a session that did connect. */
function TerminalWindowGoneState({ sessionKey }: { sessionKey: string }): React.JSX.Element {
  const closeLabel = translate('components.terminalWindow.header.close', 'Close Terminal')
  return (
    <div className="absolute inset-0 bg-background">
      <div className="pane-title-overlay-layer" aria-hidden="true" />
      <div className="absolute right-1 top-1 z-10">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          aria-label={closeLabel}
          onClick={() => closeThisWindow(sessionKey)}
        >
          <X />
        </Button>
      </div>
      <div className="absolute inset-0 flex items-center justify-center px-6 py-8 text-center text-[13px] text-muted-foreground">
        {translate(
          'components.terminalWindow.sessionGone',
          "No live terminal — this session's window has no session to attach to."
        )}
      </div>
    </div>
  )
}

function TerminalWindowConnected({
  sessionKey,
  worktreeId,
  tabId,
  ptyId
}: TerminalWindowRootProps & { ptyId: string }): React.JSX.Element {
  const terminal = useTerminalWindowTerminal(ptyId)
  return (
    <div className="absolute inset-0">
      <TerminalWindowHeader
        tabId={tabId}
        worktreeId={worktreeId}
        onClearScreen={terminal.clearScreen}
        onCopy={terminal.copySelection}
        onPaste={terminal.pasteClipboard}
        onClose={() => closeThisWindow(sessionKey)}
      />
      <TerminalWindowSurface
        ptyId={ptyId}
        containerRef={terminal.containerRef}
        ptyGone={terminal.ptyGone}
      />
    </div>
  )
}

/** Top of the terminal window's renderer: renders exactly one terminal bound
 *  to the pty this session carries, or a quiet empty state when it has none. */
export function TerminalWindowRoot({
  sessionKey,
  worktreeId,
  tabId,
  ptyId
}: TerminalWindowRootProps): React.JSX.Element {
  if (!ptyId) {
    return <TerminalWindowGoneState sessionKey={sessionKey} />
  }
  return (
    <TerminalWindowConnected
      sessionKey={sessionKey}
      worktreeId={worktreeId}
      tabId={tabId}
      ptyId={ptyId}
    />
  )
}
