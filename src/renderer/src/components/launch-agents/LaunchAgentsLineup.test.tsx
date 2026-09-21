// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { LaunchAgentsLineup } from './LaunchAgentsLineup'
import type { LaunchAgentSlot } from './launch-agents-requests'

afterEach(cleanup)

const CLAUDE = 'claude' as TuiAgent

describe('LaunchAgentsLineup', () => {
  it('renders an effort select and a fast mode checkbox for a model that declares both', () => {
    const slots: LaunchAgentSlot[] = [{ agent: CLAUDE, model: 'opus' }]
    render(
      <LaunchAgentsLineup
        slots={slots}
        agentLabel={() => 'Claude'}
        onModelChange={vi.fn()}
        onOptionChange={vi.fn()}
      />
    )

    const effort = screen.getByRole('combobox', { name: /Effort 1/ })
    expect((effort as HTMLSelectElement).value).toBe('high')
    const fastMode = screen.getByRole('checkbox', { name: /Fast mode 1/ }) as HTMLInputElement
    expect(fastMode.checked).toBe(false)
  })

  it('renders no option controls for a model that declares none', () => {
    const slots: LaunchAgentSlot[] = [{ agent: CLAUDE, model: 'haiku' }]
    render(
      <LaunchAgentsLineup
        slots={slots}
        agentLabel={() => 'Claude'}
        onModelChange={vi.fn()}
        onOptionChange={vi.fn()}
      />
    )

    expect(screen.queryByRole('combobox', { name: /Effort/ })).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('reports a picked option only for the row it was changed on', () => {
    const onOptionChange = vi.fn()
    const slots: LaunchAgentSlot[] = [
      { agent: CLAUDE, model: 'opus' },
      { agent: CLAUDE, model: 'opus' }
    ]
    render(
      <LaunchAgentsLineup
        slots={slots}
        agentLabel={() => 'Claude'}
        onModelChange={vi.fn()}
        onOptionChange={onOptionChange}
      />
    )

    const effortSelects = screen.getAllByRole('combobox', { name: /Effort/ })
    fireEvent.change(effortSelects[1], { target: { value: 'low' } })

    expect(onOptionChange).toHaveBeenCalledExactlyOnceWith(1, 'effort', 'low')
  })

  it('shows an already-picked override instead of the catalog default', () => {
    const slots: LaunchAgentSlot[] = [{ agent: CLAUDE, model: 'opus', options: { effort: 'low' } }]
    render(
      <LaunchAgentsLineup
        slots={slots}
        agentLabel={() => 'Claude'}
        onModelChange={vi.fn()}
        onOptionChange={vi.fn()}
      />
    )

    expect((screen.getByRole('combobox', { name: /Effort 1/ }) as HTMLSelectElement).value).toBe(
      'low'
    )
  })
})
