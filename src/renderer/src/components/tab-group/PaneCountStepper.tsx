import { Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { usePaneCountCommand } from './usePaneCountCommand'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.tab.group.PaneCountStepper.${id}`, fallback)

/** "− N +" control for "Panes: choose how many" — grows/shrinks the
 *  worktree's pane grid. Lives beside Tidy/Layout presets in the focused
 *  pane's toolbar. */
export default function PaneCountStepper({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element {
  const { count, decrement, increment, min, max } = usePaneCountCommand(worktreeId)
  return (
    <div className="my-auto flex items-center gap-0.5" data-pane-count-stepper={worktreeId}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={T('fewer', 'Fewer panes')}
            disabled={count <= min}
            onClick={(event) => {
              event.stopPropagation()
              decrement()
            }}
          >
            <Minus className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {T('fewer', 'Fewer panes')}
        </TooltipContent>
      </Tooltip>
      <span className="w-4 text-center text-xs tabular-nums text-muted-foreground">{count}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={T('more', 'More panes')}
            disabled={count >= max}
            onClick={(event) => {
              event.stopPropagation()
              increment()
            }}
          >
            <Plus className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {T('more', 'More panes')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
