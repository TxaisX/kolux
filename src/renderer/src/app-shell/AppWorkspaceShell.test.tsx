// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { AppChromeLayout } from './use-app-chrome-layout'
import type { FloatingWorkspacePanelState } from './use-floating-workspace-panel'

vi.mock('../components/Sidebar', () => ({ default: () => <div data-testid="sidebar-stub" /> }))
vi.mock('../components/right-sidebar', () => ({
  default: () => <div data-testid="right-sidebar-stub" />
}))
vi.mock('../components/floating-terminal/FloatingTerminalToggleButton', () => ({
  FloatingTerminalToggleButton: () => null
}))
vi.mock('./TitlebarLeftControls', () => ({ TitlebarLeftControls: () => null }))
vi.mock('./TitlebarMainStrip', () => ({
  TitlebarMainStrip: () => null,
  RightSidebarToggle: () => null
}))
vi.mock('../components/Landing', () => ({ default: () => <div data-testid="landing-stub" /> }))

// eslint-disable-next-line import/first -- mocks above must register before the module under test loads
import { AppWorkspaceShell } from './AppWorkspaceShell'

function makeLayout(overrides: Partial<AppChromeLayout> = {}): AppChromeLayout {
  return {
    activeView: 'terminal',
    activeWorktreeId: null,
    activePendingCreationId: null,
    activeTabCanExpand: false,
    effectiveActiveTabId: null,
    collapsedSidebarHeaderWidth: 0,
    creationLayoutActive: false,
    isFullScreen: false,
    leftSidebarStyle: undefined,
    leftTitlebarChromeLayout: { shouldMount: false, isFloating: false },
    rightSidebarExplorerView: 'files',
    rightSidebarOpen: false,
    rightSidebarTab: 'explorer',
    showSidebar: true,
    showRightSidebarControls: false,
    showTitlebarAppName: true,
    showTitlebarExpandButton: false,
    sidebarOpen: true,
    stackedSidebarOpen: false,
    titlebarLeftControlsRef: { current: null },
    workspaceChromeActive: false,
    ...overrides
  } as AppChromeLayout
}

const floatingWorkspace: FloatingWorkspacePanelState = {
  showToggleButton: false
} as FloatingWorkspacePanelState

describe('AppWorkspaceShell', () => {
  afterEach(() => {
    cleanup()
  })

  it('never mounts a terminal surface, even with a stale persisted active worktree', async () => {
    // Why: a restored session can carry activeView 'terminal' with an activeWorktreeId
    // from before terminals moved into their own OS windows. The main window must not
    // crash on that stale combination, and must not try to render a workbench for it.
    const layout = makeLayout({ activeView: 'terminal', activeWorktreeId: 'stale-worktree-id' })

    render(<AppWorkspaceShell layout={layout} floatingWorkspace={floatingWorkspace} />)

    expect(await screen.findByTestId('landing-stub')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-workbench-container')).not.toBeInTheDocument()
    expect(document.querySelector('[data-terminal-workbench-container]')).toBeNull()
  })

  it('shows Landing for the plain no-project case too', async () => {
    const layout = makeLayout({ activeView: 'terminal', activeWorktreeId: null })

    render(<AppWorkspaceShell layout={layout} floatingWorkspace={floatingWorkspace} />)

    expect(await screen.findByTestId('landing-stub')).toBeInTheDocument()
  })
})
