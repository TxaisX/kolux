import { Clipboard, Copy, Eraser, MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'

type TerminalWindowHeaderMenuProps = {
  onClearScreen: () => void
  onCopy: () => void
  onPaste: () => void
}

/** The window's only overflow menu: everything a single, tab-less terminal
 *  still needs beyond typing — clear, copy/paste selection, nothing else.
 *  Close lives as its own dedicated button next to this one, not in here. */
export function TerminalWindowHeaderMenu({
  onClearScreen,
  onCopy,
  onPaste
}: TerminalWindowHeaderMenuProps): React.JSX.Element {
  const moreLabel = translate('components.terminalWindow.header.moreActions', 'More actions')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          aria-label={moreLabel}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onCopy}>
          <Copy />
          {translate('components.terminalWindow.header.copy', 'Copy Selection')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onPaste}>
          <Clipboard />
          {translate('components.terminalWindow.header.paste', 'Paste')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onClearScreen}>
          <Eraser />
          {translate('components.terminalWindow.header.clearScreen', 'Clear Screen')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
