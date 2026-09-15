import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TerminalPaneHeaderIdentity } from '@/components/terminal-pane/TerminalPaneHeaderIdentity'
import { translate } from '@/i18n/i18n'
import { useTerminalWindowHeaderAgent } from './use-terminal-window-header-agent'
import { TerminalWindowHeaderMenu } from './TerminalWindowHeaderMenu'

type TerminalWindowHeaderProps = {
  tabId: string
  worktreeId: string
  onClearScreen: () => void
  onCopy: () => void
  onPaste: () => void
  onClose: () => void
}

/** The window's whole chrome, one row: [status dot][agent logo] on the left,
 *  [overflow][close] on the right. No title, path, branch or model text ever
 *  renders here — the CLI already draws that in its own input/status line. */
export function TerminalWindowHeader({
  tabId,
  worktreeId,
  onClearScreen,
  onCopy,
  onPaste,
  onClose
}: TerminalWindowHeaderProps): React.JSX.Element {
  const { agent, dotState } = useTerminalWindowHeaderAgent(tabId, worktreeId)
  const closeLabel = translate('components.terminalWindow.header.close', 'Close Terminal')

  return (
    <div className="pane-title-bar" data-terminal-tab-id={tabId}>
      <TerminalPaneHeaderIdentity agent={agent} dotState={dotState} />
      <div className="pane-title-actions ml-auto flex shrink-0 items-center gap-0.5">
        <TerminalWindowHeaderMenu onClearScreen={onClearScreen} onCopy={onCopy} onPaste={onPaste} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label={closeLabel}
              onClick={onClose}
            >
              <X />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {closeLabel}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
