import { Maximize2, Minimize2, MoreHorizontal, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

type HeaderActionButtonProps = {
  label: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  children: React.ReactNode
}

function HeaderActionButton({
  label,
  onClick,
  disabled,
  children
}: HeaderActionButtonProps): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          aria-label={label}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            onClick(event)
          }}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

type TerminalPaneHeaderActionsProps = {
  showSplit: boolean
  canExpand: boolean
  isExpanded: boolean
  onOverflow: (event: React.MouseEvent<HTMLButtonElement>) => void
  onToggleExpand: () => void
  onSplit: () => void
  onClose: () => void
}

/** Right side of the pane header: overflow, expand/collapse, split, close — in
 *  that fixed order. Every other header action (rename, chat toggle, fork,
 *  continue-in-new-session, …) lives behind the overflow menu, which reuses
 *  the pane's existing right-click context menu. */
export function TerminalPaneHeaderActions({
  showSplit,
  canExpand,
  isExpanded,
  onOverflow,
  onToggleExpand,
  onSplit,
  onClose
}: TerminalPaneHeaderActionsProps): React.JSX.Element {
  const moreLabel = translate('components.terminalPane.header.moreActions', 'More actions')
  const expandLabel = isExpanded
    ? translate('auto.components.terminal.pane.TerminalContextMenu.df766809e0', 'Collapse Pane')
    : translate('auto.components.terminal.pane.TerminalContextMenu.925f49f210', 'Expand Pane')
  const splitLabel = translate(
    'auto.components.terminal.pane.TerminalContextMenu.20e565d865',
    'Split Terminal Right'
  )
  const closeLabel = translate(
    'auto.components.terminal.pane.TerminalContextMenu.8c17d6786d',
    'Close Pane'
  )

  return (
    <div className="pane-title-actions ml-auto flex shrink-0 items-center gap-0.5">
      <HeaderActionButton label={moreLabel} onClick={onOverflow}>
        <MoreHorizontal />
      </HeaderActionButton>
      <HeaderActionButton label={expandLabel} onClick={onToggleExpand} disabled={!canExpand}>
        {isExpanded ? <Minimize2 /> : <Maximize2 />}
      </HeaderActionButton>
      {showSplit ? (
        <HeaderActionButton label={splitLabel} onClick={onSplit}>
          <Plus />
        </HeaderActionButton>
      ) : null}
      <HeaderActionButton label={closeLabel} onClick={onClose}>
        <X />
      </HeaderActionButton>
    </div>
  )
}
