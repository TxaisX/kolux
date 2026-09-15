import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { useShortcutKeyDetails } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '../store'
import type { TopLevelView } from '../../../shared/ui-chrome-types'
import type { KeybindingActionId } from '../../../shared/keybindings'

export type ModeSwitchId = 'inbox' | 'floor' | 'code'

export type ModeSwitchItem = {
  id: ModeSwitchId
  view: TopLevelView
  actionId: KeybindingActionId
  label: string
}

export type ModeSwitchModel = {
  selected: ModeSwitchId
  items: readonly ModeSwitchItem[]
}

/** Pure mapping from the active top-level view to the mode switch's selection and segments. */
export function getModeSwitchModel(activeView: TopLevelView): ModeSwitchModel {
  const selected: ModeSwitchId =
    activeView === 'inbox' ? 'inbox' : activeView === 'floor' ? 'floor' : 'code'
  return {
    selected,
    items: [
      {
        id: 'inbox',
        view: 'inbox',
        actionId: 'view.inbox',
        label: translate('auto.app-shell.ModeSwitch.5c1a7e9d02', 'Inbox')
      },
      {
        id: 'floor',
        view: 'floor',
        actionId: 'view.floor',
        label: translate('auto.app-shell.ModeSwitch.b30f6c2e81', 'Floor')
      },
      {
        id: 'code',
        view: 'terminal',
        actionId: 'view.code',
        label: translate('auto.app-shell.ModeSwitch.e9421d7fa4', 'Code')
      }
    ]
  }
}

function ModeSwitchShortcutChip({
  actionId
}: {
  actionId: KeybindingActionId
}): React.JSX.Element | null {
  const detail = useShortcutKeyDetails(actionId)
  if (detail.keys.length === 0) {
    return null
  }
  return (
    <ShortcutKeyCombo
      keys={detail.keys}
      doubleTap={detail.doubleTap}
      className="opacity-70"
      keyCapClassName="h-4 min-w-4 border-none bg-transparent px-1 text-[10px] shadow-none"
    />
  )
}

/** Three-segment Inbox · Floor · Code switch, mounted at the start of the titlebar's main strip. */
export function ModeSwitch(): React.JSX.Element {
  const activeView = useAppStore((s) => s.activeView)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const model = getModeSwitchModel(activeView)

  return (
    <ToggleGroup
      type="single"
      value={model.selected}
      onValueChange={(value) => {
        const item = model.items.find((candidate) => candidate.id === value)
        if (item) {
          setActiveView(item.view)
        }
      }}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      className="shrink-0 mr-2"
      aria-label={translate('auto.app-shell.ModeSwitch.1f84a6c930', 'Mode')}
    >
      {model.items.map((item) => (
        <ToggleGroupItem
          key={item.id}
          value={item.id}
          size="sm"
          className="gap-1.5 text-muted-foreground data-[state=on]:bg-accent data-[state=on]:text-foreground"
          aria-label={item.label}
        >
          <span>{item.label}</span>
          <ModeSwitchShortcutChip actionId={item.actionId} />
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
