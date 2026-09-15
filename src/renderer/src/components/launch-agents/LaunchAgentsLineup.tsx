import React from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { getLaunchPresets } from './launch-agent-roles'

const T = (id: string, fallback: string): string =>
  translate(`auto.components.launch-agents.LaunchAgentsLineup.${id}`, fallback)

export function LaunchPresetRow({
  presetId,
  onSelect
}: {
  presetId: string | null
  onSelect: (id: string | null) => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{T('shape', 'Shape')}</span>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="xs"
          variant={presetId === null ? 'default' : 'outline'}
          onClick={() => onSelect(null)}
        >
          {T('samePrompt', 'Same prompt')}
        </Button>
        {getLaunchPresets().map((preset) => (
          <Button
            key={preset.id}
            type="button"
            size="xs"
            variant={presetId === preset.id ? 'default' : 'outline'}
            onClick={() => onSelect(preset.id)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {presetId === null
          ? T('samePromptHelp', 'Every session gets the identical prompt.')
          : T('rolesHelp', 'Each session gets a different job ahead of your prompt.')}
      </p>
    </div>
  )
}
