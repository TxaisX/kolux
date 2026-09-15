import type { CSSProperties, RefObject } from 'react'
import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import type { PtyTransport } from './pty-transport'
import { TerminalPaneHeaderRow } from './TerminalPaneHeaderRow'

export type PaneTitleOverlayRect = {
  left: number
  top: number
  width: number
}

type TerminalPaneHeaderOverlayProps = {
  tabId: string
  worktreeId: string
  cwd: string
  showAlwaysOnHeaders: boolean
  /** Used by ephemeral one-off command terminals that omit the header affordance. */
  showSplitButton?: boolean
  paneCount: number
  panes: readonly ManagedPane[]
  paneTitleOverlayRects: Readonly<Record<number, PaneTitleOverlayRect>>
  renamingPaneId: number | null
  renameValue: string
  renameInputRef: RefObject<HTMLInputElement | null>
  titleUsesLightSurface: boolean
  paneTitleBackground: string
  terminalContentVisible: boolean
  hiddenStartupStyle: CSSProperties
  managerRef: RefObject<PaneManager | null>
  paneTransportsRef: RefObject<Map<number, PtyTransport>>
  /** The pane currently filling its split group, if any — drives the
   *  expand/collapse icon per pane. */
  expandedPaneId: number | null
  onSplitPane: (pane: ManagedPane, direction: 'vertical' | 'horizontal') => void
  onToggleExpandPane: (pane: ManagedPane) => void
  onBeginPaneDrag: (paneId: number, handle: HTMLElement, event: PointerEvent) => void
  onActivatePaneTitleInteraction: (paneId: number) => void
  onPaneTitleContextMenu: (event: React.MouseEvent<HTMLElement>, paneId: number) => void
  onClosePane: (paneId: number) => void
  onRenameValueChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onRenameBlur: () => void
}

/** Renders every pane's header row: [status dot][agent logo] on the left,
 *  overflow/expand/split/close on the right — see TerminalPaneHeaderRow. No
 *  title text is ever rendered; renaming and every other retired action live
 *  behind the overflow button (the pane's existing right-click menu). */
export default function TerminalPaneHeaderOverlay({
  tabId,
  worktreeId,
  cwd,
  showAlwaysOnHeaders,
  showSplitButton = true,
  paneCount,
  panes,
  paneTitleOverlayRects,
  renamingPaneId,
  renameValue,
  renameInputRef,
  titleUsesLightSurface,
  paneTitleBackground,
  terminalContentVisible,
  hiddenStartupStyle,
  managerRef,
  paneTransportsRef,
  expandedPaneId,
  onSplitPane,
  onToggleExpandPane,
  onBeginPaneDrag,
  onActivatePaneTitleInteraction,
  onPaneTitleContextMenu,
  onClosePane,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  onRenameBlur
}: TerminalPaneHeaderOverlayProps): React.JSX.Element {
  return (
    <div
      className="pane-title-overlay-layer"
      data-pane-title-surface={titleUsesLightSurface ? 'light' : 'dark'}
      style={{
        display: terminalContentVisible ? undefined : 'none',
        ['--nightshift-pane-title-bg' as string]: paneTitleBackground,
        ...hiddenStartupStyle
      }}
    >
      {panes.map((pane) => {
        const isEditing = renamingPaneId === pane.id
        const overlayRect = paneTitleOverlayRects[pane.id]
        const showHeader = overlayRect && (showAlwaysOnHeaders || isEditing)
        if (!showHeader || !overlayRect) {
          return null
        }

        return (
          <TerminalPaneHeaderRow
            key={`pane-title-${pane.leafId}`}
            pane={pane}
            tabId={tabId}
            worktreeId={worktreeId}
            cwd={cwd}
            overlayRect={overlayRect}
            isEditing={isEditing}
            renameValue={renameValue}
            renameInputRef={renameInputRef}
            paneCount={paneCount}
            expandedPaneId={expandedPaneId}
            showSplitButton={showSplitButton}
            managerRef={managerRef}
            paneTransportsRef={paneTransportsRef}
            onActivatePaneTitleInteraction={onActivatePaneTitleInteraction}
            onPaneTitleContextMenu={onPaneTitleContextMenu}
            onBeginPaneDrag={onBeginPaneDrag}
            onSplitPane={onSplitPane}
            onToggleExpandPane={onToggleExpandPane}
            onClosePane={onClosePane}
            onRenameValueChange={onRenameValueChange}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            onRenameBlur={onRenameBlur}
          />
        )
      })}
    </div>
  )
}
