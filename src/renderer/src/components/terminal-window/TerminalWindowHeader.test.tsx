// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { useAppStore } from '@/store'
import type * as I18nModule from '@/i18n/i18n'
import { TerminalWindowHeader } from './TerminalWindowHeader'

vi.mock('@/i18n/i18n', async (importOriginal) => ({
  ...(await importOriginal<typeof I18nModule>()),
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) => children,
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) => children,
  TooltipContent: () => null
}))
vi.mock('@/components/ui/dropdown-menu', async () => {
  const React_ = await import('react')
  const passthrough = ({ children }: { children?: React.ReactNode }): React.ReactNode =>
    React_.createElement(React_.Fragment, null, children)
  return {
    DropdownMenu: passthrough,
    DropdownMenuTrigger: passthrough,
    DropdownMenuContent: () => null,
    DropdownMenuItem: passthrough
  }
})

const WORKTREE = 'wt-1'

function seedTab(tabId: string, launchAgent: TerminalTab['launchAgent'] | null): void {
  useAppStore.setState({
    tabsByWorktree: {
      [WORKTREE]: [{ id: tabId, launchAgent: launchAgent ?? undefined } as unknown as TerminalTab]
    },
    terminalLayoutsByTabId: {},
    agentStatusByPaneKey: {}
  })
}

function renderHeader(tabId: string): ReturnType<typeof render> {
  return render(
    <TerminalWindowHeader
      tabId={tabId}
      worktreeId={WORKTREE}
      onClearScreen={vi.fn()}
      onCopy={vi.fn()}
      onPaste={vi.fn()}
      onClose={vi.fn()}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TerminalWindowHeader', () => {
  it('renders the agent logo mark for a tab launched with a known agent', () => {
    seedTab('t-known', 'claude')
    const { container } = renderHeader('t-known')
    expect(container.querySelector('[data-agent-icon="claude"]')).not.toBeNull()
  })

  it('falls back to the plain terminal glyph when no agent is identified', () => {
    seedTab('t-plain', null)
    const { container } = renderHeader('t-plain')
    expect(container.querySelector('[data-agent-icon]')).toBeNull()
  })

  it('never renders title, path, or model text — only icons and controls', () => {
    seedTab('t-known', 'codex')
    const { container } = renderHeader('t-known')
    expect(container.textContent?.trim()).toBe('')
  })

  it('has no "+" add-terminal control and no pop-out control', () => {
    seedTab('t-known', 'claude')
    const { container } = renderHeader('t-known')
    const buttons = container.querySelectorAll('button')
    // Only the overflow ("…") trigger and the close (X) button.
    expect(buttons.length).toBe(2)
    for (const button of buttons) {
      const label = button.getAttribute('aria-label') ?? ''
      expect(label.toLowerCase()).not.toMatch(/split|add terminal|pop.?out|new terminal/)
    }
  })
})
