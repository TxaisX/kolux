// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as I18nModule from '@/i18n/i18n'
import { TerminalWindowRoot } from './TerminalWindowRoot'

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

const terminalHandle = {
  containerRef: { current: null },
  ptyGone: false,
  clearScreen: vi.fn(),
  copySelection: vi.fn(),
  pasteClipboard: vi.fn()
}
vi.mock('./use-terminal-window-terminal', () => ({
  useTerminalWindowTerminal: () => terminalHandle
}))

const SESSION_KEY = 'wt-1::tab-1'
const originalApi = window.api

function stubTerminalWindowsApi(): { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn().mockResolvedValue({ ok: true })
  window.api = {
    ...originalApi,
    terminalWindows: {
      ...originalApi?.terminalWindows,
      close,
      open: vi.fn(),
      focus: vi.fn(),
      list: vi.fn()
    }
  } as typeof window.api
  return { close }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.api = originalApi
})

describe('TerminalWindowRoot', () => {
  it("closing via X calls terminalWindows.close with this session's sessionKey", () => {
    const { close } = stubTerminalWindowsApi()
    render(
      <TerminalWindowRoot sessionKey={SESSION_KEY} worktreeId="wt-1" tabId="tab-1" ptyId="pty-1" />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal' }))
    expect(close).toHaveBeenCalledWith({ sessionKey: SESSION_KEY })
  })

  it('shows a quiet empty state instead of a blank box when there is no pty to attach to', () => {
    stubTerminalWindowsApi()
    render(
      <TerminalWindowRoot sessionKey={SESSION_KEY} worktreeId="wt-1" tabId="tab-1" ptyId={null} />
    )
    expect(screen.getByText(/no session to attach to/i)).toBeInTheDocument()
  })
})
