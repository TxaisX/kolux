/**
 * @vitest-environment happy-dom
 */
import { act, createRef, type ReactNode, type RefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import { useAppStore } from '@/store'
import type { PtyTransport } from './pty-transport'
import TerminalPaneHeaderOverlay from './TerminalPaneHeaderOverlay'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children?: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children?: ReactNode }) => children,
  TooltipContent: ({ children }: { children?: ReactNode }) => <span>{children}</span>
}))

const mounted: { container: HTMLDivElement; root: Root }[] = []

function makePane(id: number, leafId: string): ManagedPane {
  const brandedLeafId = leafId as ManagedPane['leafId']
  return {
    id,
    leafId: brandedLeafId,
    stablePaneId: brandedLeafId,
    container: document.createElement('div'),
    linkTooltip: document.createElement('div'),
    terminal: {} as ManagedPane['terminal'],
    fitAddon: {} as ManagedPane['fitAddon'],
    searchAddon: {} as ManagedPane['searchAddon'],
    serializeAddon: {} as ManagedPane['serializeAddon']
  }
}

const PANE_1_LEAF = '11111111-1111-4111-8111-111111111111'
const PANE_2_LEAF = '22222222-2222-4222-8222-222222222222'

function renderOverlay({
  paneCount = 2,
  expandedPaneId = null,
  showSplitButton = true,
  onClosePane = vi.fn(),
  onToggleExpandPane = vi.fn(),
  onSplitPane = vi.fn(),
  onPaneTitleContextMenu = vi.fn(),
  renameValue = '',
  renamingPaneId = null
}: {
  paneCount?: number
  expandedPaneId?: number | null
  showSplitButton?: boolean
  onClosePane?: ReturnType<typeof vi.fn>
  onToggleExpandPane?: ReturnType<typeof vi.fn>
  onSplitPane?: ReturnType<typeof vi.fn>
  onPaneTitleContextMenu?: ReturnType<typeof vi.fn>
  renameValue?: string
  renamingPaneId?: number | null
} = {}): {
  container: HTMLDivElement
  onClosePane: ReturnType<typeof vi.fn>
  onToggleExpandPane: ReturnType<typeof vi.fn>
  onSplitPane: ReturnType<typeof vi.fn>
  onPaneTitleContextMenu: ReturnType<typeof vi.fn>
} {
  const panes = [makePane(1, PANE_1_LEAF), makePane(2, PANE_2_LEAF)]
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <TerminalPaneHeaderOverlay
        tabId="tab-1"
        worktreeId="wt-1"
        cwd={path.join(path.sep, 'tmp')}
        showAlwaysOnHeaders
        showSplitButton={showSplitButton}
        paneCount={paneCount}
        panes={panes}
        paneTitleOverlayRects={{
          1: { left: 0, top: 0, width: 200 },
          2: { left: 220, top: 0, width: 200 }
        }}
        renamingPaneId={renamingPaneId}
        renameValue={renameValue}
        renameInputRef={createRef<HTMLInputElement>()}
        titleUsesLightSurface={false}
        paneTitleBackground="transparent"
        terminalContentVisible
        hiddenStartupStyle={{}}
        managerRef={{ current: null } as RefObject<PaneManager | null>}
        paneTransportsRef={{ current: new Map() } as RefObject<Map<number, PtyTransport>>}
        expandedPaneId={expandedPaneId}
        onSplitPane={
          onSplitPane as (pane: ManagedPane, direction: 'vertical' | 'horizontal') => void
        }
        onToggleExpandPane={onToggleExpandPane as (pane: ManagedPane) => void}
        onBeginPaneDrag={vi.fn()}
        onActivatePaneTitleInteraction={vi.fn()}
        onPaneTitleContextMenu={
          onPaneTitleContextMenu as (event: React.MouseEvent<HTMLElement>, paneId: number) => void
        }
        onClosePane={onClosePane as (paneId: number) => void}
        onRenameValueChange={vi.fn()}
        onRenameSubmit={vi.fn()}
        onRenameCancel={vi.fn()}
        onRenameBlur={vi.fn()}
      />
    )
  })
  mounted.push({ container, root })
  return { container, onClosePane, onToggleExpandPane, onSplitPane, onPaneTitleContextMenu }
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
})

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('TerminalPaneHeaderOverlay', () => {
  it('renders no title text in the steady-state header', () => {
    const { container } = renderOverlay()

    expect(container.querySelector('.pane-title-text')).toBeNull()
    expect(container.querySelector('.pane-title-input')).toBeNull()
  })

  it("renders the running agent's logo for a pane whose agent is known", () => {
    useAppStore.setState({
      agentStatusByPaneKey: {
        [`tab-1:${PANE_1_LEAF}`]: {
          state: 'working',
          prompt: '',
          updatedAt: Date.now(),
          stateStartedAt: Date.now(),
          paneKey: `tab-1:${PANE_1_LEAF}`,
          stateHistory: [],
          agentType: 'codex'
        }
      }
    })

    const { container } = renderOverlay()

    expect(container.querySelector('[data-agent-icon="codex"]')).not.toBeNull()
  })

  it('falls back to a plain terminal glyph when no agent is identified for the pane', () => {
    const { container } = renderOverlay()

    expect(container.querySelector('[data-agent-icon]')).toBeNull()
    expect(container.querySelector('svg.lucide-square-terminal')).not.toBeNull()
  })

  it('keeps the fixed action order: overflow, expand, split, close', () => {
    const { container } = renderOverlay()

    const actions = container.querySelector('.pane-title-actions')
    const labels = Array.from(actions?.querySelectorAll('button') ?? []).map((button) =>
      button.getAttribute('aria-label')
    )

    expect(labels).toEqual(['More actions', 'Expand Pane', 'Split Terminal Right', 'Close Pane'])
  })

  it('opens the pane context menu (which carries rename) from the overflow button', () => {
    const { container, onPaneTitleContextMenu } = renderOverlay()

    const overflow = container.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')
    expect(overflow).not.toBeNull()

    act(() => overflow?.click())

    expect(onPaneTitleContextMenu).toHaveBeenCalledWith(expect.anything(), 1)
  })

  it('always shows the close button, even for a lone untitled pane', () => {
    const { container, onClosePane } = renderOverlay({ paneCount: 1 })

    const closeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close Pane"]'
    )
    expect(closeButton).not.toBeNull()

    act(() => closeButton?.click())

    expect(onClosePane).toHaveBeenCalledWith(1)
  })

  it('disables expand for a lone pane and enables it once split', () => {
    const { container: solo } = renderOverlay({ paneCount: 1 })
    expect(
      solo.querySelector<HTMLButtonElement>('button[aria-label="Expand Pane"]')?.disabled
    ).toBe(true)

    const { container: split } = renderOverlay({ paneCount: 2 })
    expect(
      split.querySelector<HTMLButtonElement>('button[aria-label="Expand Pane"]')?.disabled
    ).toBe(false)
  })

  it('omits the split control when the header affordance is hidden', () => {
    const { container } = renderOverlay({ paneCount: 1, showSplitButton: false })

    expect(container.querySelector('button[aria-label="Split Terminal Right"]')).toBeNull()
  })

  it('conveys the dot state through an accessible label, not color alone', () => {
    useAppStore.setState({
      agentStatusByPaneKey: {
        [`tab-1:${PANE_1_LEAF}`]: {
          state: 'blocked',
          prompt: '',
          updatedAt: Date.now(),
          stateStartedAt: Date.now(),
          paneKey: `tab-1:${PANE_1_LEAF}`,
          stateHistory: []
        }
      }
    })

    const { container } = renderOverlay()

    expect(container.querySelector('[aria-label="Blocked"]')).not.toBeNull()
  })

  it('renders the rename input when editing, still with no visible title text', () => {
    const { container } = renderOverlay({ renamingPaneId: 1, renameValue: 'server' })

    const input = container.querySelector<HTMLInputElement>('.pane-title-input')
    expect(input).not.toBeNull()
    expect(input?.value).toBe('server')
    expect(container.querySelector('.pane-title-text')).toBeNull()
  })
})
