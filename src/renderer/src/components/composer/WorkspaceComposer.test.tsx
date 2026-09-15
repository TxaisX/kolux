// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import type { ReactElement, ReactNode } from 'react'
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotesSendAgentTarget } from '@/lib/notes-send-agent-targets'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { WorkspaceComposerTarget } from './use-workspace-composer-targets'

// Why: the composer's send button lives inside a Tooltip, which requires a
// TooltipProvider ancestor at render time.
function render(ui: ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>)
}

const harness = vi.hoisted(() => ({
  storeState: {} as Record<string, unknown>,
  targets: [] as WorkspaceComposerTarget[],
  focusedPane: null as { tabId: string; leafId: string; paneKey: string } | null,
  resolveRunningAgentSendTarget: vi.fn(),
  sendBracketedPasteToRunningAgent: vi.fn(),
  activateTabAndFocusPane: vi.fn(),
  findWorktreeById: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
  agentPickerProps: null as { selectedPaneKey: string | null } | null
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) => selector(harness.storeState),
    { getState: () => harness.storeState }
  )
}))

vi.mock('./use-workspace-composer-targets', () => ({
  useWorkspaceComposerTargets: () => harness.targets,
  useFocusedWorkspacePane: () => harness.focusedPane
}))

vi.mock('./ComposerAgentPicker', () => ({
  ComposerAgentPicker: (props: { selectedPaneKey: string | null }): ReactNode => {
    harness.agentPickerProps = props
    return <div data-testid="agent-picker" />
  }
}))

vi.mock('./ComposerYoloChip', () => ({
  ComposerYoloChip: (): ReactNode => <div data-testid="yolo-chip" />
}))

vi.mock('@/store/slices/worktree-helpers', () => ({
  findWorktreeById: (...args: unknown[]) => harness.findWorktreeById(...args)
}))

vi.mock('@/lib/worktree-default-display-name', () => ({
  resolveWorktreeBranchLabel: (worktree: { branch?: string }) => worktree?.branch ?? ''
}))

vi.mock('@/lib/agent-paste-draft', () => ({
  sendBracketedPasteToRunningAgent: (...args: unknown[]) =>
    harness.sendBracketedPasteToRunningAgent(...args)
}))

vi.mock('@/lib/running-agent-targets', () => ({
  resolveRunningAgentSendTarget: (...args: unknown[]) =>
    harness.resolveRunningAgentSendTarget(...args)
}))

vi.mock('@/lib/activate-tab-and-focus-pane', () => ({
  activateTabAndFocusPane: (...args: unknown[]) => harness.activateTabAndFocusPane(...args)
}))

vi.mock('sonner', () => ({ toast: harness.toast }))

import { WorkspaceComposer } from './WorkspaceComposer'

function makeTarget(overrides: Partial<NotesSendAgentTarget> = {}): WorkspaceComposerTarget {
  return {
    target: {
      paneKey: 'tab-1:leaf-1',
      tabId: 'tab-1',
      leafId: 'leaf-1',
      agentType: 'claude',
      tabTitle: 'Terminal 1',
      status: 'eligible',
      ...overrides
    },
    agent: null
  }
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

describe('WorkspaceComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    harness.storeState = { worktreesByRepo: {} }
    harness.targets = []
    harness.focusedPane = null
    harness.agentPickerProps = null
    harness.findWorktreeById.mockReturnValue({ branch: 'feature/x', path: '/repo/wt' })
  })

  afterEach(() => cleanup())

  it('renders the empty-state placeholder and disables send with no running agents', () => {
    render(<WorkspaceComposer worktreeId="wt-1" />)

    const textarea = screen.getByPlaceholderText('Start an agent in this workspace to message it')
    expect(textarea).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('shows the branch chip from the worktree record', () => {
    render(<WorkspaceComposer worktreeId="wt-1" />)
    expect(screen.getByText('feature/x')).toBeInTheDocument()
  })

  it('enables send only once there is text and an eligible target', () => {
    harness.targets = [makeTarget()]
    render(<WorkspaceComposer worktreeId="wt-1" />)

    const textarea = screen.getByPlaceholderText('Message the chosen agent…')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    fireEvent.change(textarea, { target: { value: 'hello' } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('Enter sends the draft to the chosen agent and clears it', async () => {
    harness.targets = [makeTarget()]
    harness.resolveRunningAgentSendTarget.mockReturnValue({ status: 'eligible', ptyId: 'pty-1' })
    harness.sendBracketedPasteToRunningAgent.mockResolvedValue(true)
    render(<WorkspaceComposer worktreeId="wt-1" />)

    const textarea = screen.getByPlaceholderText('Message the chosen agent…')
    fireEvent.change(textarea, { target: { value: 'hi there' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    await flushMicrotasks()

    expect(harness.sendBracketedPasteToRunningAgent).toHaveBeenCalledWith({
      ptyId: 'pty-1',
      content: 'hi there'
    })
    expect(harness.toast.success).toHaveBeenCalled()
    expect((textarea as HTMLTextAreaElement).value).toBe('')
  })

  it('Shift+Enter inserts a newline instead of sending', () => {
    harness.targets = [makeTarget()]
    harness.resolveRunningAgentSendTarget.mockReturnValue({ status: 'eligible', ptyId: 'pty-1' })
    render(<WorkspaceComposer worktreeId="wt-1" />)

    const textarea = screen.getByPlaceholderText('Message the chosen agent…')
    fireEvent.change(textarea, { target: { value: 'hi' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })

    expect(harness.sendBracketedPasteToRunningAgent).not.toHaveBeenCalled()
  })

  it('Tab cycles the chosen agent only when the draft is empty', () => {
    harness.targets = [
      makeTarget({ paneKey: 'tab-1:leaf-1' }),
      makeTarget({ paneKey: 'tab-2:leaf-2', tabId: 'tab-2', leafId: 'leaf-2' })
    ]
    render(<WorkspaceComposer worktreeId="wt-1" />)
    const textarea = screen.getByPlaceholderText('Message the chosen agent…')

    fireEvent.keyDown(textarea, { key: 'Tab' })
    expect(harness.agentPickerProps?.selectedPaneKey).toBe('tab-2:leaf-2')

    fireEvent.change(textarea, { target: { value: 'not empty' } })
    fireEvent.keyDown(textarea, { key: 'Tab' })
    expect(harness.agentPickerProps?.selectedPaneKey).toBe('tab-2:leaf-2')
  })

  it('Escape blurs the composer and refocuses the active terminal pane', () => {
    harness.targets = [makeTarget()]
    harness.focusedPane = { tabId: 'tab-x', leafId: 'leaf-x', paneKey: 'tab-x:leaf-x' }
    render(<WorkspaceComposer worktreeId="wt-1" />)

    const textarea = screen.getByPlaceholderText('Message the chosen agent…')
    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(harness.activateTabAndFocusPane).toHaveBeenCalledWith('tab-x', 'leaf-x')
  })
})
