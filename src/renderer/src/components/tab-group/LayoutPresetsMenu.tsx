import { LayoutGrid } from 'lucide-react'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useLayoutPresetsCommand } from './useLayoutPresetsCommand'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.tab.group.LayoutPresetsMenu.${id}`, fallback)

/** Group-only layouts; inner terminal splits are owned by PaneManager. */
export default function LayoutPresetsMenu({
  worktreeId,
  activeTerminalTabId
}: {
  worktreeId: string
  activeTerminalTabId?: string | null
}): React.JSX.Element | null {
  const presets = useLayoutPresetsCommand(worktreeId, activeTerminalTabId)
  if (presets.length === 0) {
    return null
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <LayoutGrid className="size-4" />
        {T('layoutPresets', 'Layout presets')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {presets.map((preset) => (
          <DropdownMenuItem
            key={preset.count}
            onSelect={() => {
              preset.apply()
            }}
          >
            {translate(
              'auto.components.tab.group.LayoutPresetsMenu.layoutPresetGrid',
              '{{rows}} {{target}} grid',
              {
                rows: preset.rows.join(' × '),
                target: preset.target === 'terminal-panes' ? 'pane' : 'group'
              }
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
