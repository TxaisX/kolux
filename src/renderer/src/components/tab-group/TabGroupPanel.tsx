import { Suspense, useMemo } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { useDroppable } from '@dnd-kit/core'
import { Ellipsis, LayoutGrid, Plus, X } from 'lucide-react'
import { useAppStore } from '../../store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

import { TabBarQuickCommandsButton } from '../tab-bar/TabBarQuickCommandsButton'
import { useTabGroupWorkspaceModel } from './useTabGroupWorkspaceModel'
import { useTidyLayoutCommand } from './useTidyLayoutCommand'
import LayoutPresetsMenu from './LayoutPresetsMenu'
import PaneCountStepper from './PaneCountStepper'
import WorkspacePreviewButton from './WorkspacePreviewButton'
import { getTabPaneBodyDroppableId } from './useTabDragSplit'
import { tabGroupBodyAnchorName } from './tab-group-body-anchor'
import { translate } from '@/i18n/i18n'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'

const EditorPanel = lazy(() => import('../editor/EditorPanel'))

export default function TabGroupPanel({
  groupId,
  worktreeId,
  isVisible,
  isFocused,
  hasSplitGroups,
  touchesRightEdge,
  touchesLeftEdge,
  touchesBottomEdge = false,
  suppressLeftBorder = false,
  suppressRightBorder = false,
  suppressBottomBorder = false,
  reserveClosedExplorerToggleSpace,
  reserveCollapsedSidebarHeaderSpace,
  isTabDragActive = false
}: {
  groupId: string
  worktreeId: string
  isVisible: boolean
  isFocused: boolean
  hasSplitGroups: boolean
  touchesRightEdge: boolean
  touchesLeftEdge: boolean
  touchesBottomEdge?: boolean
  suppressLeftBorder?: boolean
  suppressRightBorder?: boolean
  suppressBottomBorder?: boolean
  reserveClosedExplorerToggleSpace: boolean
  reserveCollapsedSidebarHeaderSpace: boolean
  isTabDragActive?: boolean
}): React.JSX.Element {
  const rightSidebarOpen = useAppStore((state) => state.rightSidebarOpen)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const model = useTabGroupWorkspaceModel({ groupId, worktreeId })
  const tidyLayoutCommand = useTidyLayoutCommand(worktreeId)
  const { activeTab, commands } = model
  const { setNodeRef: setBodyDropRef } = useDroppable({
    id: getTabPaneBodyDroppableId(groupId),
    data: {
      kind: 'pane-body',
      groupId,
      worktreeId
    },
    disabled: !isTabDragActive
  })
  // Why: per-group anchor-name lets the worktree-level overlay position panes via CSS anchor positioning, so moving a tab between groups re-targets the anchor instead of remounting xterm (loses alt-screen TUI state) or reloading `<webview>`.
  const bodyAnchorName = tabGroupBodyAnchorName(groupId)
  // Why: memoize so a fresh style object each render doesn't break downstream memoization keyed on referential equality.
  const bodyAnchorStyle = useMemo(
    () => ({ anchorName: bodyAnchorName }) as React.CSSProperties,
    [bodyAnchorName]
  )

  const menuButtonClassName =
    'my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
  // Why: focused-only so quick commands and Close split pane stay with the active pane and unfocused strips stay compact.
  const focusedActionChromeClassName = `flex shrink-0 items-center gap-0.5 overflow-hidden transition-[opacity] duration-150 ${
    isFocused ? 'ml-1.5 pointer-events-auto opacity-100' : 'pointer-events-none opacity-0 w-0'
  }`
  return (
    <div
      // Why: vertical borders stay `border-border` so the focus highlight (--accent ~#f5f5f5 in light) doesn't paint a near-white strip by the resize handle; only the bottom border changes on focus.
      // Why: unfocused split groups dim subtly so the focused one reads as selected; only when hasSplitGroups since a lone group has nothing to contrast against.
      className={`group/tab-group relative flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden${
        hasSplitGroups
          ? // Why: skip border-l/border-r on edge-touching groups; the split-layout wrapper and right sidebar already paint borders at those seams (double line otherwise).
            ` ${
              touchesLeftEdge || suppressLeftBorder ? '' : 'border-l'
            } ${touchesRightEdge || suppressRightBorder ? '' : 'border-r'} ${
              touchesBottomEdge || suppressBottomBorder ? '' : 'border-b'
            } border-border ${
              isFocused && !touchesBottomEdge && !suppressBottomBorder ? 'border-b-accent' : ''
            } ${isFocused ? '' : 'opacity-95'}`
          : ''
      }`}
      onPointerDown={commands.focusGroup}
      // Why: keyboard/AT focus can enter a split group without a pointer event, so sync group focus to DOM focus for global shortcuts.
      onFocusCapture={commands.focusGroup}
    >
      {/* Why: the tab bar is gone — every pane holds exactly one session — but a focused
          pane (or one sitting in a window-control corner) still needs a slim strip for
          pane-level actions and the no-drag spacers around the titlebar. An unfocused,
          non-corner pane renders none of this, so nothing sits at its top. */}
      {/* Why: macOS hiddenInset titleBarStyle makes -webkit-app-region: drag the only way to move the window from this row. */}
      {isFocused ||
      (reserveCollapsedSidebarHeaderSpace && !sidebarOpen) ||
      (reserveClosedExplorerToggleSpace && !rightSidebarOpen) ? (
        <div
          className="h-[32px] shrink-0 border-b border-border bg-card"
          data-tab-group-strip-id={groupId}
          data-terminal-focus-release-surface="true"
          data-worktree-id={worktreeId}
        >
          <div className="flex h-full items-stretch justify-end pr-1.5">
            {/* Why: Electron drag hit-test respects no-drag only on DOM descendants, not z-index siblings, so this no-drag spacer keeps the collapsed left-sidebar's floating toggle clickable. */}
            {reserveCollapsedSidebarHeaderSpace && !sidebarOpen ? (
              <div
                className="shrink-0"
                style={
                  {
                    width: 'var(--collapsed-sidebar-header-width)',
                    WebkitAppRegion: 'no-drag'
                  } as React.CSSProperties
                }
              />
            ) : null}
            <div
              className="min-w-0 flex-1"
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            />
            <div
              className="ml-1.5 flex shrink-0 items-center gap-0.5"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <div className={focusedActionChromeClassName}>
                {isFocused ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={translate(
                          'auto.components.tab.group.TabGroupPanel.launchAgent',
                          'Launch agent'
                        )}
                        onClick={(event) => {
                          event.stopPropagation()
                          useAppStore
                            .getState()
                            .openModal('launch-agents', {
                              repoId: getRepoIdFromWorktreeId(worktreeId)
                            })
                        }}
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      {translate(
                        'auto.components.tab.group.TabGroupPanel.launchAgent',
                        'Launch agent'
                      )}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {isFocused ? (
                  <TabBarQuickCommandsButton worktreeId={worktreeId} groupId={groupId} />
                ) : null}
                {/* Why only isFocused: "choose how many panes" acts on the whole
                    worktree grid, so one focused pane's control is enough. */}
                {isFocused ? <PaneCountStepper worktreeId={worktreeId} /> : null}
                {isFocused ? (
                  <WorkspacePreviewButton worktreeId={worktreeId} groupId={groupId} />
                ) : null}
                {/* Why only isFocused: Tidy and the presets apply to the panes inside a
                    tab too, which exist with or without split groups. Closing a group
                    still needs one, so that item keeps the stricter gate below. */}
                {isFocused ? (
                  <Tooltip>
                    <DropdownMenu modal={false}>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label={translate(
                              'auto.components.tab.group.TabGroupPanel.9acaf92093',
                              'Pane Actions'
                            )}
                            onClick={(event) => {
                              event.stopPropagation()
                            }}
                            className={menuButtonClassName}
                          >
                            <Ellipsis className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <DropdownMenuContent align="end" side="bottom" sideOffset={4}>
                        <DropdownMenuItem
                          onSelect={() => {
                            tidyLayoutCommand()
                          }}
                        >
                          <LayoutGrid className="size-4" />
                          {translate(
                            'auto.components.tab.group.TabGroupPanel.tidyLayout',
                            'Tidy panes'
                          )}
                        </DropdownMenuItem>
                        <LayoutPresetsMenu worktreeId={worktreeId} />
                        {hasSplitGroups ? (
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              commands.closeGroup()
                            }}
                          >
                            <X className="size-4" />
                            {translate(
                              'auto.components.tab.group.TabGroupPanel.closePaneColumn',
                              'Close split pane'
                            )}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <TooltipContent side="bottom" sideOffset={6}>
                      {translate(
                        'auto.components.tab.group.TabGroupPanel.9acaf92093',
                        'Pane Actions'
                      )}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>
            {/* Why: Electron drag hit-test respects no-drag only on DOM descendants, not z-index siblings, so this no-drag spacer keeps the floating right-sidebar toggle + window controls clickable. */}
            {reserveClosedExplorerToggleSpace && !rightSidebarOpen ? (
              <div
                className="shrink-0"
                style={
                  {
                    width: 'calc(40px + var(--window-controls-width, 0px))',
                    WebkitAppRegion: 'no-drag'
                  } as React.CSSProperties
                }
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        ref={setBodyDropRef}
        data-tab-group-body-id={groupId}
        data-worktree-id={worktreeId}
        className="relative flex-1 min-h-0 overflow-hidden bg-workbench-surface"
        style={bodyAnchorStyle}
      >
        {/* Why: empty anchor so the agent-sessions tour reads as a terminal-area tip, not toolbar chrome. */}
        {isFocused ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-1/4 h-px"
            data-contextual-tour-target="workspace-agent-terminal-tip"
          />
        ) : null}
        {activeTab &&
          activeTab.contentType !== 'terminal' &&
          activeTab.contentType !== 'agent-session' &&
          activeTab.contentType !== 'browser' &&
          activeTab.contentType !== 'simulator' && (
            <div className="absolute inset-0 flex min-h-0 min-w-0">
              {/* Why: split groups render editor content in a plain relative pane body, not the legacy Terminal.tsx flex column. */}
              <Suspense
                fallback={
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    {translate(
                      'auto.components.tab.group.TabGroupPanel.814fb04c43',
                      'Loading editor...'
                    )}
                  </div>
                }
              >
                <EditorPanel
                  activeFileId={activeTab.entityId}
                  activeViewStateId={activeTab.id}
                  isVisible={isVisible}
                  isCmdSaveOwner={isFocused}
                />
              </Suspense>
            </div>
          )}

        {/* Why: terminal/browser/simulator/structured-chat panes render at the worktree level; tab activation only changes overlay visibility and never remounts a live surface. */}
      </div>
    </div>
  )
}
