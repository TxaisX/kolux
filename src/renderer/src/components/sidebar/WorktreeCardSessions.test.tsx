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

const mocks = vi.hoisted(() => ({
  activateAndRevealWorktree: vi.fn(),
  activateTabAndFocusPane: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: typeof fakeState) => unknown) => selector(fakeState)
}))
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: mocks.activateAndRevealWorktree
}))
vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: mocks.activateTabAndFocusPane
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
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('clicking a session row reveals its workspace and activates that tab in the main window', () => {
    render(<WorktreeCardSessions worktreeId="wt-1" />)

    fireEvent.click(screen.getByRole('button', { name: 'Claude' }))

    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledTimes(1)
    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith('wt-1')
    expect(mocks.activateTabAndFocusPane).toHaveBeenCalledWith('tab-1', null)
  })

  it('is reachable and activatable by keyboard, not only by pointer', () => {
    render(<WorktreeCardSessions worktreeId="wt-1" />)

    const row = screen.getByRole('button', { name: 'Claude' })
    expect(row).toHaveAttribute('tabIndex', '0')
    fireEvent.keyDown(row, { key: 'Enter' })

    expect(mocks.activateAndRevealWorktree).toHaveBeenCalledWith('wt-1')
    expect(mocks.activateTabAndFocusPane).toHaveBeenCalledWith('tab-1', null)
  })
})
