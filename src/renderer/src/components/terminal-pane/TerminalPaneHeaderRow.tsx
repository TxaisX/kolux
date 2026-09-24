import type { RefObject } from 'react'
import type { ManagedPane, PaneManager } from '@/lib/pane-manager/pane-manager'
import { translate } from '@/i18n/i18n'
import { WORKSPACE_FILE_PATH_MIME, WORKSPACE_FILE_PATHS_MIME } from '@/lib/workspace-file-drag'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import type { PtyTransport } from './pty-transport'
import { handleInternalTerminalFileDrop } from './terminal-drop-handler'
import { useTerminalPaneHeaderAgent } from './use-terminal-pane-header-agent'
import { TerminalPaneHeaderIdentity } from './TerminalPaneHeaderIdentity'
import { TerminalPaneHeaderActions } from './TerminalPaneHeaderActions'
import type { PaneTitleOverlayRect } from './TerminalPaneHeaderOverlay'
import { PlanReviewButton } from '../plan-review/PlanReviewButton'

type TerminalPaneHeaderRowProps = {
  pane: ManagedPane
  tabId: string
  worktreeId: string
  cwd: string
  overlayRect: PaneTitleOverlayRect
  isEditing: boolean
  renameValue: string
  renameInputRef: RefObject<HTMLInputElement | null>
  paneCount: number
  expandedPaneId: number | null
  showSplitButton: boolean
  managerRef: RefObject<PaneManager | null>
  paneTransportsRef: RefObject<Map<number, PtyTransport>>
  onActivatePaneTitleInteraction: (paneId: number) => void
  onPaneTitleContextMenu: (event: React.MouseEvent<HTMLElement>, paneId: number) => void
  onBeginPaneDrag: (paneId: number, handle: HTMLElement, event: PointerEvent) => void
  onSplitPane: (pane: ManagedPane, direction: 'vertical' | 'horizontal') => void
  onToggleExpandPane: (pane: ManagedPane) => void
  onClosePane: (paneId: number) => void
  onRenameValueChange: (value: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onRenameBlur: () => void
}

/** One pane's header row: [status dot][agent logo] on the left, an overflow
 *  menu + expand + split + close on the right. No title text ever renders
 *  here — renaming and every other retired header action live behind the
 *  overflow button, which reopens this pane's existing right-click menu. */
export function TerminalPaneHeaderRow({
  pane,
  tabId,
  worktreeId,
  cwd,
  overlayRect,
  isEditing,
  renameValue,
  renameInputRef,
  paneCount,
  expandedPaneId,
  showSplitButton,
  managerRef,
  paneTransportsRef,
  onActivatePaneTitleInteraction,
  onPaneTitleContextMenu,
  onBeginPaneDrag,
  onSplitPane,
  onToggleExpandPane,
  onClosePane,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  onRenameBlur
}: TerminalPaneHeaderRowProps): React.JSX.Element {
  const { agent, dotState } = useTerminalPaneHeaderAgent(tabId, worktreeId, pane.leafId)

  return (
    <div
      className="pane-title-bar"
      data-native-file-drop-target="terminal"
      data-terminal-tab-id={tabId}
      data-pane-prevent-terminal-focus=""
      {...(isEditing ? { 'data-editing': '' } : {})}
      onPointerDownCapture={() => onActivatePaneTitleInteraction(pane.id)}
      onDragOver={(event) => {
        onActivatePaneTitleInteraction(pane.id)
        if (
          event.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME) ||
          event.dataTransfer.types.includes(WORKSPACE_FILE_PATHS_MIME)
        ) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        if (
          !event.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME) &&
          !event.dataTransfer.types.includes(WORKSPACE_FILE_PATHS_MIME)
        ) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        onActivatePaneTitleInteraction(pane.id)
        const manager = managerRef.current
        if (!manager) {
          return
        }
        void handleInternalTerminalFileDrop({
          manager,
          paneTransports: paneTransportsRef.current,
          worktreeId,
          tabId,
          cwd,
          dataTransfer: event.dataTransfer,
          dropTarget: event.target
        })
      }}
      onContextMenuCapture={(event) => onPaneTitleContextMenu(event, pane.id)}
      style={{
        left: overlayRect.left,
        top: overlayRect.top,
        width: overlayRect.width
      }}
    >
      {isEditing ? (
        <input
          ref={renameInputRef}
          className="pane-title-input"
          aria-label={translate(
            'auto.components.terminal.pane.TerminalPane.7dbbfcbecc',
            'Pane title'
          )}
          placeholder={translate(
            'auto.components.terminal.pane.TerminalPane.7dbbfcbecc',
            'Pane title'
          )}
          value={renameValue}
          onChange={(event) => onRenameValueChange(event.target.value)}
          onKeyDown={(event) => {
            // Why: an Enter that only confirms a CJK IME candidate must
            // not commit the rename; wait for a non-composition Enter.
            if (isImeCompositionKeyDown(event)) {
              return
            }
            if (event.key === 'Enter') {
              onRenameSubmit()
            } else if (event.key === 'Tab') {
              // Why: commit on Tab directly instead of relying on the
              // browser advancing focus (which fires blur). Headless / no
              // window-focus environments (xvfb, some SSH sessions) don't
              // always move focus off the input, so the blur-driven commit
              // never runs. Submitting closes the editor, so the default
              // Tab focus move is moot and any follow-on blur is a no-op.
              onRenameSubmit()
            } else if (event.key === 'Escape') {
              onRenameCancel()
            }
          }}
          onBlur={onRenameBlur}
        />
      ) : (
        <>
          {paneCount > 1 && (
            <div
              className="pane-title-drag-handle"
              aria-hidden="true"
              onPointerDown={(event) => {
                onBeginPaneDrag(pane.id, event.currentTarget, event.nativeEvent)
              }}
            />
          )}
          <TerminalPaneHeaderIdentity agent={agent} dotState={dotState} />
          <PlanReviewButton
            tabId={tabId}
            paneKey={makePaneKey(tabId, pane.leafId)}
            getPtyId={() => paneTransportsRef.current.get(pane.id)?.getPtyId() ?? null}
          />
          <TerminalPaneHeaderActions
            showSplit={showSplitButton}
            canExpand={paneCount > 1}
            isExpanded={expandedPaneId === pane.id}
            onOverflow={(event) => onPaneTitleContextMenu(event, pane.id)}
            onToggleExpand={() => onToggleExpandPane(pane)}
            onSplit={() => onSplitPane(pane, 'vertical')}
            onClose={() => onClosePane(pane.id)}
          />
        </>
      )}
    </div>
  )
}
