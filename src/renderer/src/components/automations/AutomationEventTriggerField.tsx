import { cn } from '@/lib/utils'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { AutomationEventKind } from '../../../../shared/automation-event-trigger'
import { AUTOMATION_EDITOR_SECTION_LABEL_CLASS, Field } from './automation-page-parts'
import { AutomationSchedulePicker } from './AutomationSchedulePicker'
import type { AutomationDraft } from './AutomationEditorDialog'
import { translate } from '@/i18n/i18n'

const DEFAULT_EVENT_KIND: AutomationEventKind = 'review_opened'

// Provider-neutral: v1 events come from PR/MR review taps shared across GitHub, GitLab, etc.
const EVENT_KIND_OPTIONS = [
  [
    'review_opened',
    'A PR/MR opens on a workspace branch',
    'auto.components.automations.AutomationEventTriggerField.b1f4d0a712'
  ],
  [
    'review_checks_failed',
    'Checks fail on a PR/MR',
    'auto.components.automations.AutomationEventTriggerField.c8a3e56f90'
  ],
  [
    'agent_done',
    'An agent finishes in this project',
    'auto.components.automations.AutomationEventTriggerField.9d271b6a44'
  ]
] as const satisfies readonly (readonly [AutomationEventKind, string, string])[]

type AutomationEventTriggerFieldProps = {
  draft: AutomationDraft
  isHermesTarget: boolean
  validateAdvancedSchedule: (schedule: string) => boolean
  toggleGroupClassName: string
  toggleItemClassName: string
  pickerTriggerClassName: string
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
}

export function AutomationEventTriggerField({
  draft,
  isHermesTarget,
  validateAdvancedSchedule,
  toggleGroupClassName,
  toggleItemClassName,
  pickerTriggerClassName,
  onDraftChange
}: AutomationEventTriggerFieldProps): React.JSX.Element {
  // Why: Hermes runs only on its schedule (design decision), so it never sees the toggle.
  const mode = !isHermesTarget && draft.eventKind ? 'event' : 'schedule'

  return (
    <Field
      className="mb-4"
      labelClassName={AUTOMATION_EDITOR_SECTION_LABEL_CLASS}
      label={translate('auto.components.automations.AutomationEventTriggerField.1a7c9e4b21', 'Trigger')}
    >
      <div className="grid gap-3">
        {isHermesTarget ? null : (
          <ToggleGroup
            type="single"
            spacing={1}
            value={mode}
            onValueChange={(value) => {
              if (!value) {
                return
              }
              onDraftChange((current) => ({
                ...current,
                eventKind: value === 'event' ? (current.eventKind ?? DEFAULT_EVENT_KIND) : null
              }))
            }}
            size="sm"
            className={toggleGroupClassName}
          >
            <ToggleGroupItem value="schedule" className={toggleItemClassName}>
              {translate(
                'auto.components.automations.AutomationEventTriggerField.6e3f8a0c15',
                'Schedule'
              )}
            </ToggleGroupItem>
            <ToggleGroupItem value="event" className={toggleItemClassName}>
              {translate(
                'auto.components.automations.AutomationEventTriggerField.72d4b1e893',
                'Event'
              )}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {mode === 'event' ? (
          <Select
            value={draft.eventKind ?? DEFAULT_EVENT_KIND}
            onValueChange={(eventKind) =>
              onDraftChange((current) => ({
                ...current,
                eventKind: eventKind as AutomationEventKind
              }))
            }
          >
            <SelectTrigger
              aria-label={translate(
                'auto.components.automations.AutomationEventTriggerField.72d4b1e893',
                'Event'
              )}
              className={cn('w-full min-w-0', pickerTriggerClassName)}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {EVENT_KIND_OPTIONS.map(([value, fallbackLabel, labelKey]) => (
                <SelectItem key={value} value={value}>
                  {translate(labelKey, fallbackLabel)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <AutomationSchedulePicker
            draft={draft}
            validateAdvancedSchedule={validateAdvancedSchedule}
            onDraftChange={onDraftChange}
          />
        )}
      </div>
    </Field>
  )
}
