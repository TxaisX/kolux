// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'

const fakeState = {
  tabsByWorktree: {
    'wt-1': [{ id: 'tab-1', title: 'Claude' }] as unknown as TerminalTab[]
  },
  settings: { tabAutoGenerateTitle: false }
}

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof fakeState) => unknown) => selector(fakeState)
}))
vi.mock('./useWorktreeAgentRows', () => ({ useWorktreeAgentRows: () => [] }))
vi.mock('./worktree-card-status-inputs', () => ({
  selectLivePtyIdsForWorktree: () => ({ 'tab-1': ['pty-1'] })
}))
vi.mock('./worktree-agent-row-selectors', () => ({
  selectTerminalLayoutsForWorktree: () => ({})
}))
vi.mock('./worktree-card-agents-expansion-state', () => ({
  useWorktreeAgentExpansionState: () => ({
    compactRootListExpanded: true,
    toggleCompactRootList: vi.fn()
  })
}))

// eslint-disable-next-line import/first -- mocks above must register before the module under test loads
import WorktreeCardSessions from './WorktreeCardSessions'

describe('WorktreeCardSessions', () => {
  const openMock = vi.fn()

  beforeEach(() => {
    openMock.mockClear()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test-only window.api shim ahead of the preload contract landing
    ;(window as any).api = { terminalWindows: { open: openMock } }
  })

  afterEach(() => {
    cleanup()
  })

  it('clicking a session row opens that session in its own terminal window, keyed by worktree + tab', () => {
    render(<WorktreeCardSessions worktreeId="wt-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))

    expect(openMock).toHaveBeenCalledTimes(1)
    expect(openMock).toHaveBeenCalledWith({ worktreeId: 'wt-1', tabId: 'tab-1', ptyId: 'pty-1' })
  })

  it('is reachable and activatable by keyboard, not only by pointer', () => {
    render(<WorktreeCardSessions worktreeId="wt-1" />)

    const row = screen.getByRole('button', { name: 'Claude' })
    expect(row).toHaveAttribute('tabIndex', '0')
    fireEvent.keyDown(row, { key: 'Enter' })

    expect(openMock).toHaveBeenCalledTimes(1)
    expect(openMock).toHaveBeenCalledWith({ worktreeId: 'wt-1', tabId: 'tab-1', ptyId: 'pty-1' })
  })
})
