// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationDraft } from './AutomationEditorDialog'
import { AutomationEventTriggerField } from './AutomationEventTriggerField'
import { isValidAutomationSchedule } from '../../../../shared/automation-schedule-parsing'

// Why: Radix Select mounts its content in a portal only once opened; the native swap keeps
// options in the document so assertions read real DOM text, matching AutomationSchedulePicker's test.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children
  }: {
    value: string
    onValueChange: (value: string) => void
    children: React.ReactNode
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  )
}))

const BASE_DRAFT: AutomationDraft = {
  name: '',
  prompt: '',
  agentId: 'codex',
  projectId: '',
  workspaceMode: 'existing',
  workspaceId: '',
  baseBranch: '',
  reuseSession: false,
  precheckCommand: '',
  precheckTimeoutSeconds: '30',
  preset: 'weekly',
  time: '09:15',
  dayOfWeek: '5',
  customSchedule: '',
  missedRunGraceMinutes: '720',
  scheduleWarning: null,
  eventKind: null
}

function ControlledField({
  initialDraft,
  isHermesTarget = false
}: {
  initialDraft?: Partial<AutomationDraft>
  isHermesTarget?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = React.useState<AutomationDraft>({ ...BASE_DRAFT, ...initialDraft })
  return (
    <AutomationEventTriggerField
      draft={draft}
      isHermesTarget={isHermesTarget}
      validateAdvancedSchedule={isValidAutomationSchedule}
      toggleGroupClassName=""
      toggleItemClassName=""
      pickerTriggerClassName=""
      onDraftChange={(updater) => setDraft((current) => updater(current))}
    />
  )
}

// Every mocked <select> renders as an ARIA combobox with no distinguishing label (SelectTrigger,
// which would carry aria-label, is mocked away) — find the event-kind one by its option values.
function findEventKindSelect(): HTMLSelectElement | undefined {
  return (screen.getAllByRole('combobox') as HTMLSelectElement[]).find((select) =>
    Array.from(select.options).some((option) => option.value === 'review_opened')
  )
}

afterEach(() => {
  cleanup()
})

describe('AutomationEventTriggerField', () => {
  it('defaults to schedule mode with no event select', () => {
    render(<ControlledField />)

    expect(screen.getByRole('radio', { name: 'Schedule' })).toHaveAttribute('aria-checked', 'true')
    expect(findEventKindSelect()).toBeUndefined()
  })

  it('switching to Event shows the three provider-neutral event options, defaulted', async () => {
    const user = userEvent.setup()
    render(<ControlledField />)

    await user.click(screen.getByRole('radio', { name: 'Event' }))

    const select = findEventKindSelect()
    expect(select).toHaveValue('review_opened')
    const optionLabels = Array.from(select?.options ?? []).map((option) => option.textContent)
    expect(optionLabels).toEqual([
      'A PR/MR opens on a workspace branch',
      'Checks fail on a PR/MR',
      'An agent finishes in this project'
    ])
  })

  it('picking an event kind updates the draft', async () => {
    const user = userEvent.setup()
    render(<ControlledField />)

    await user.click(screen.getByRole('radio', { name: 'Event' }))
    const select = findEventKindSelect()
    await user.selectOptions(select!, 'review_checks_failed')

    expect(findEventKindSelect()).toHaveValue('review_checks_failed')
  })

  it('switching back to Schedule clears the event kind and re-shows the schedule picker', async () => {
    const user = userEvent.setup()
    render(<ControlledField initialDraft={{ eventKind: 'agent_done' }} />)

    expect(findEventKindSelect()).toHaveValue('agent_done')

    await user.click(screen.getByRole('radio', { name: 'Schedule' }))

    expect(findEventKindSelect()).toBeUndefined()
    expect(screen.getByRole('radio', { name: 'Schedule' })).toHaveAttribute('aria-checked', 'true')
  })

  it('Hermes targets never see the toggle, even with a saved event kind', () => {
    render(<ControlledField initialDraft={{ eventKind: 'agent_done' }} isHermesTarget />)

    expect(screen.queryByRole('radio', { name: 'Schedule' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Event' })).toBeNull()
    expect(findEventKindSelect()).toBeUndefined()
  })
})
