import React from 'react'
import { SortableContext } from '@dnd-kit/sortable'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TabStripScrollIndicator } from './TabStripScrollIndicator'
import { getTabStripScrollMaskClassName } from './tab-strip-scroll-metrics'
import type { useTabStripOverflowNavigation } from './tab-strip-overflow-navigation'
import type { useTabStripDragScrollHandlers } from './tab-strip-drag-scroll'
import type { TabBarProps } from './tab-bar-props'
import type { TabBarRuntimeModel } from './use-tab-bar-runtime-model'
import type { TabBarCreateMenuController } from './use-tab-bar-create-menu-controller'
import type { TabBarItemProjection } from './use-tab-bar-item-projection'
import type { TabBarItem } from './tab-bar-item-model'
import { renderTabBarItems } from './tab-bar-item-surface'
import { renderTabBarCreateMenu } from './tab-bar-create-menu'
import ClientHostedBrowserTabRows from './ClientHostedBrowserTabRows'
import type { ClientHostedBrowserRow } from '../../../../shared/client-hosted-browser-rows'

const EMPTY_CLIENT_HOSTED_ROWS: readonly ClientHostedBrowserRow[] = []

export function renderTabBarSurface({
  props,
  runtime,
  createMenu,
  itemProjection,
  tabStripNavigation,
  tabStripDragScroll,
  activeClientHostedBrowserRowId,
  togglePinned
}: {
  props: TabBarProps
  runtime: TabBarRuntimeModel
  createMenu: TabBarCreateMenuController
  itemProjection: TabBarItemProjection
  tabStripNavigation: ReturnType<typeof useTabStripOverflowNavigation>
  tabStripDragScroll: ReturnType<typeof useTabStripDragScrollHandlers>
  activeClientHostedBrowserRowId: string | null
  togglePinned: (item: TabBarItem) => void
}): React.JSX.Element {
  const { worktreeId, tabStripChrome = 'default', hideCreateMenu = false } = props
  const { resolvedGroupId } = runtime
  const { orderedItems, sortableIds, dropIndicatorByVisibleId } = itemProjection
  const clientHostedBrowserRows = props.clientHostedBrowserRows ?? EMPTY_CLIENT_HOSTED_ROWS
  const { tabStripRef, tabStripOverflowState, scrollTabStrip } = tabStripNavigation
  const includeTopTabBorder = tabStripChrome !== 'floating-panel'
  const renderedItems = renderTabBarItems({
    items: orderedItems,
    props,
    runtime,
    dropIndicatorByVisibleId,
    includeTopTabBorder,
    activeClientHostedBrowserRowId,
    togglePinned
  })

  return (
    <div
      className="flex items-stretch h-full overflow-hidden flex-1 min-w-0"
      // Why: preload routes native OS drops by this marker — only the tab strip opens files in the editor, not terminal panes.
      data-native-file-drop-target="editor"
    >
      {tabStripOverflowState.hasOverflow ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="mx-0.5 my-auto h-6 w-5 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              aria-label={translate(
                'auto.components.tab.bar.TabBar.7a9b4af2af',
                'Scroll tabs left'
              )}
              aria-disabled={!tabStripOverflowState.canScrollStart}
              disabled={
                !tabStripDragScroll.isTabDragActive && !tabStripOverflowState.canScrollStart
              }
              onClick={() => scrollTabStrip('start')}
              onPointerEnter={tabStripDragScroll.onDragScrollStartEnter}
              onPointerLeave={tabStripDragScroll.onDragScrollLeave}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.components.tab.bar.TabBar.7a9b4af2af', 'Scroll tabs left')}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {/* Why: no strategy stops dnd-kit animating siblings, so tabs stay anchored during drag; only the insertion bar moves. */}
      <SortableContext items={sortableIds}>
        {/* Why: no-drag lets tab interactions work inside the titlebar's drag region (outer container stays window-draggable). */}
        <div
          className="group/tab-strip relative flex min-h-0 min-w-0 max-w-full flex-[0_1_auto]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div
            ref={tabStripRef}
            // Why: only `border-r` here — a strip-level `border-l` would render a heavier L-corner than the first tab's own `border-l`.
            className={[
              'terminal-tab-strip flex h-full min-w-0 max-w-full flex-1 items-stretch overflow-x-auto overflow-y-hidden border-r border-border/70',
              getTabStripScrollMaskClassName(tabStripOverflowState)
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {renderedItems}
            {clientHostedBrowserRows.length > 0 ? (
              <ClientHostedBrowserTabRows
                rows={clientHostedBrowserRows}
                worktreeId={worktreeId}
                groupId={resolvedGroupId}
                groupActiveTabId={props.groupActiveTabId ?? null}
                includeTopTabBorder={includeTopTabBorder}
              />
            ) : null}
          </div>
          <TabStripScrollIndicator
            metrics={tabStripOverflowState}
            scrollContainerRef={tabStripRef}
            disabled={tabStripDragScroll.isTabDragActive}
          />
        </div>
      </SortableContext>
      {tabStripOverflowState.hasOverflow ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="mx-0.5 my-auto h-6 w-5 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-35"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              aria-label={translate(
                'auto.components.tab.bar.TabBar.232e075b07',
                'Scroll tabs right'
              )}
              aria-disabled={!tabStripOverflowState.canScrollEnd}
              disabled={!tabStripDragScroll.isTabDragActive && !tabStripOverflowState.canScrollEnd}
              onClick={() => scrollTabStrip('end')}
              onPointerEnter={tabStripDragScroll.onDragScrollEndEnter}
              onPointerLeave={tabStripDragScroll.onDragScrollLeave}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>
            {translate('auto.components.tab.bar.TabBar.232e075b07', 'Scroll tabs right')}
          </TooltipContent>
        </Tooltip>
      ) : null}
      {hideCreateMenu ? null : renderTabBarCreateMenu({ props, runtime, createMenu })}
    </div>
  )
}
