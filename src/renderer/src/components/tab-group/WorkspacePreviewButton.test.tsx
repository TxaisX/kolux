// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspacePort } from '../../../../shared/workspace-ports'
import type { BrowserWorkspace } from '../../../../shared/browser-workspace-types'

const WORKTREE_ID = 'worktree-1'
const GROUP_ID = 'group-1'

const { activateAndRevealWorktreeMock, storeState } = vi.hoisted(() => {
  const state = {
    settings: {},
    repos: [] as unknown[],
    projects: [] as unknown[],
    getKnownWorktreeById: () => null,
    workspacePortScan: null as { key: string; result: { ports: WorkspacePort[] } } | null,
    browserTabsByWorktree: {} as Record<string, BrowserWorkspace[]>,
    createBrowserTab: vi.fn(),
    setRemoteBrowserPageHandle: vi.fn(),
    focusBrowserTabInWorktree: vi.fn()
  }
  return { activateAndRevealWorktreeMock: vi.fn(), storeState: state }
})

vi.mock('@/store', () => {
  const useAppStore = Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState }
  )
  return { useAppStore }
})

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: activateAndRevealWorktreeMock
}))

vi.mock('@/runtime/use-worktree-runtime-target', () => ({
  useWorktreeRuntimeTarget: () => ({ kind: 'local' })
}))

vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() }
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  )
}))

import WorkspacePreviewButton from './WorkspacePreviewButton'

function makePort(overrides: Partial<WorkspacePort> & { id: string; port: number }): WorkspacePort {
  return {
    bindHost: '0.0.0.0',
    connectHost: '127.0.0.1',
    protocol: 'http',
    kind: 'workspace',
    owner: {
      worktreeId: WORKTREE_ID,
      repoId: 'repo-1',
      displayName: 'my-app',
      path: '/repo',
      confidence: 'cwd'
    },
    ...overrides
  } as WorkspacePort
}

describe('WorkspacePreviewButton', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    storeState.workspacePortScan = null
    storeState.browserTabsByWorktree = {}
    storeState.createBrowserTab.mockReset()
    storeState.createBrowserTab.mockImplementation(() => ({ id: 'new-tab' }) as BrowserWorkspace)
    storeState.setRemoteBrowserPageHandle.mockReset()
    storeState.focusBrowserTabInWorktree.mockReset()
    activateAndRevealWorktreeMock.mockClear()
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  function render(): void {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root.render(<WorkspacePreviewButton worktreeId={WORKTREE_ID} groupId={GROUP_ID} />)
    })
  }

  it('disables the button with a tooltip when no dev server is detected', () => {
    render()
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Preview"]')
    expect(button?.disabled).toBe(true)
    expect(container.textContent).toContain('No dev server detected')
  })

  it('opens the best candidate in the target group on click', async () => {
    storeState.workspacePortScan = {
      key: 'local:all',
      result: { ports: [makePort({ id: 'a', port: 5173 })] }
    }
    render()
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Preview"]')
    expect(button?.disabled).toBe(false)

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(storeState.createBrowserTab).toHaveBeenCalledTimes(1)
    const [, url, options] = storeState.createBrowserTab.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:5173')
    expect(options).toMatchObject({ targetGroupId: GROUP_ID })
    expect(storeState.focusBrowserTabInWorktree).not.toHaveBeenCalled()
  })

  it('activates an existing tab for the same origin instead of opening a new one', async () => {
    storeState.workspacePortScan = {
      key: 'local:all',
      result: { ports: [makePort({ id: 'a', port: 5173 })] }
    }
    storeState.browserTabsByWorktree[WORKTREE_ID] = [
      {
        id: 'existing-tab',
        worktreeId: WORKTREE_ID,
        title: 'Preview',
        loading: false,
        faviconUrl: null,
        canGoBack: false,
        canGoForward: false,
        loadError: null,
        createdAt: 0,
        activePageId: 'existing-page',
        url: 'http://127.0.0.1:5173/app'
      } as BrowserWorkspace
    ]
    render()
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Preview"]')

    await act(async () => {
      button?.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(storeState.focusBrowserTabInWorktree).toHaveBeenCalledWith(WORKTREE_ID, 'existing-page')
    expect(storeState.createBrowserTab).not.toHaveBeenCalled()
  })

  it('lists other detected ports behind the caret and opens the chosen one', async () => {
    storeState.workspacePortScan = {
      key: 'local:all',
      result: {
        ports: [
          makePort({ id: 'a', port: 3000, advertisedUrl: 'http://localhost:3000' }),
          makePort({ id: 'b', port: 9229, protocol: 'unknown' })
        ]
      }
    }
    render()

    const menuButtons = Array.from(container.querySelectorAll('button')).filter(
      (btn) => btn.textContent && /localhost:9229|127\.0\.0\.1:9229/.test(btn.textContent)
    )
    expect(menuButtons).toHaveLength(1)

    await act(async () => {
      menuButtons[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
      await Promise.resolve()
    })

    expect(storeState.createBrowserTab).toHaveBeenCalledTimes(1)
    const [, url] = storeState.createBrowserTab.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:9229')
  })
})
