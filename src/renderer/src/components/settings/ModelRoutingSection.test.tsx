// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { ModelRoutingSection } from './ModelRoutingSection'

// Why: Radix Select needs pointer-capture/portal behavior happy-dom doesn't implement;
// swapping in a native <select> keeps these tests about routing logic, not Radix internals.
vi.mock('../ui/select', () => ({
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

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function baseSettings(overrides?: GlobalSettings['orchestrationRouting']): GlobalSettings {
  return { ...getDefaultSettings('/tmp'), orchestrationRouting: overrides }
}

function render(
  settings: GlobalSettings,
  updateSettings: (updates: Partial<GlobalSettings>) => void,
  detectedIds: Set<string> | null = null
): void {
  act(() => {
    root.render(
      <ModelRoutingSection
        settings={settings}
        updateSettings={updateSettings}
        detectedIds={detectedIds}
      />
    )
  })
}

function tierSelects(tier: string): HTMLSelectElement[] {
  return Array.from(container.querySelectorAll<HTMLSelectElement>(`[data-tier="${tier}"] select`))
}

function providerRadio(name: string): HTMLButtonElement {
  const radio = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[role="radio"]')
  ).find((button) => button.textContent?.includes(name))
  if (!radio) {
    throw new Error(`provider radio for ${name} not found`)
  }
  return radio
}

function selectValue(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('ModelRoutingSection', () => {
  it('renders the four tiers with Claude defaults for the default provider', () => {
    render(baseSettings(), vi.fn())

    expect(container.textContent).toContain('Model routing')
    expect(container.textContent).toContain('Major')
    expect(container.textContent).toContain('Deep')
    expect(container.textContent).toContain('Build')
    expect(container.textContent).toContain('Light')
    expect(tierSelects('major')[0].value).toBe('fable')
  })

  it('hides the effort select for Haiku (light tier, no effort control)', () => {
    render(baseSettings(), vi.fn())

    expect(tierSelects('light')).toHaveLength(1)
    expect(tierSelects('light')[0].value).toBe('haiku')
  })

  it('switching the provider shows that provider defaults', () => {
    render(baseSettings(), vi.fn())

    act(() => {
      providerRadio('Codex').click()
    })

    expect(tierSelects('major')[0].value).toBe('gpt-5.6-sol')
    expect(tierSelects('major')[1].value).toBe('high')
  })

  it('writes an override for only the changed provider and tier', () => {
    const updateSettings = vi.fn()
    render(baseSettings(), updateSettings)

    selectValue(tierSelects('major')[0], 'opus')

    expect(updateSettings).toHaveBeenCalledWith({
      orchestrationRouting: { claude: { major: { model: 'opus', effort: 'high' } } }
    })
  })

  it('removes the override key (and the empty provider entry) on Reset', () => {
    const updateSettings = vi.fn()
    render(baseSettings({ claude: { build: { model: 'opus', effort: 'high' } } }), updateSettings)

    const resetButton = container.querySelector<HTMLButtonElement>('[data-tier="build"] button')
    if (!resetButton) {
      throw new Error('reset button not found')
    }
    act(() => {
      resetButton.click()
    })

    expect(updateSettings).toHaveBeenCalledWith({ orchestrationRouting: {} })
  })

  it('shows "Not set" for a Cursor tier with no default, and writes on pick', () => {
    const updateSettings = vi.fn()
    render(baseSettings(), updateSettings)

    act(() => {
      providerRadio('Cursor').click()
    })

    expect(container.querySelector('[data-tier="major"]')?.textContent).toContain('Not set')

    selectValue(tierSelects('major')[0], 'auto')

    expect(updateSettings).toHaveBeenCalledWith({
      orchestrationRouting: { cursor: { major: { model: 'auto' } } }
    })
  })
})
