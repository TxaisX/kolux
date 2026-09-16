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

/** "Layout presets" submenu item for the pane menu — hidden when no documented preset matches the current pane count. */
export default function LayoutPresetsMenu({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const presets = useLayoutPresetsCommand(worktreeId)
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
              '{{rows}} grid',
              { rows: preset.rows.join(' × ') }
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
