import { Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { QuickLaunchAgentMenuItems } from './QuickLaunchButton'
import TabBarCreateEntry from './TabBarCreateEntry'
import { renderTabBarStaticCreateMenu } from './tab-bar-static-create-menu'
import type { TabBarCreateMenuProps } from './tab-bar-props'
import type { TabBarRuntimeModel } from './use-tab-bar-runtime-model'
import type { TabBarCreateMenuController } from './use-tab-bar-create-menu-controller'

const NEW_TAB_LABEL_KEY = 'auto.components.tab.bar.TabBar.b1a132357f'

/**
 * The tab strip's "+" trigger and its create menu (open entry search, static create
 * items, quick-launch agents) — pulled out of tab-bar-surface so it can mount without
 * a tab strip around it, e.g. the titlebar when panes are split.
 */
export function renderTabBarCreateMenu({
  props,
  runtime,
  createMenu,
  titlebarStyle = false
}: {
  props: TabBarCreateMenuProps
  runtime: TabBarRuntimeModel
  createMenu: TabBarCreateMenuController
  /** Titlebar mount: compact icon button + tooltip, matching the other titlebar chrome buttons. */
  titlebarStyle?: boolean
}): React.JSX.Element {
  const {
    worktreeId,
    terminalOnly = false,
    showAgentLaunchItems = true,
    onNewTerminalTab,
    onOpenEntry
  } = props
  const {
    resolvedGroupId,
    mobileEmulatorEnabled,
    managedBrowserCreationEnabled,
    mobileEmulatorCreationEnabled,
    workspaceHasSimulatorTab,
    showMobileEmulatorIntroCallout,
    windowsTerminalCapabilities,
    defaultWindowsPowerShellImplementation,
    agentLaunchOptions,
    newTerminalShortcut,
    newBrowserShortcut,
    newSimulatorShortcut,
    newFileShortcut,
    openMarkdownShortcut
  } = runtime
  const {
    newTabMenuOpen,
    setNewTabMenuOpen,
    setCreateMenuQuery,
    createMenuOptions,
    windowsShellEntries,
    handleSelectCreateMenuOption,
    launchAgentFromNewTabEntry,
    runPendingNewTabMenuFocusAfterClose,
    clearPendingNewTabMenuFocusOnUnmount,
    queueNewActiveTerminalFocusAfterNewTabMenuClose,
    queueTerminalTabFocusAfterNewTabMenuClose,
    queueFocusAfterNewTabMenuClose,
    showStaticCreateMenuItems
  } = createMenu
  const standardCreateMenuItems = renderTabBarStaticCreateMenu({
    props,
    terminalOnly,
    mobileEmulatorEnabled,
    managedBrowserCreationEnabled,
    mobileEmulatorCreationEnabled,
    workspaceHasSimulatorTab,
    showMobileEmulatorIntroCallout,
    windowsShellEntries,
    defaultWindowsPowerShellImplementation,
    pwshAvailable: windowsTerminalCapabilities.pwshAvailable,
    newTerminalShortcut,
    newBrowserShortcut,
    newSimulatorShortcut,
    newFileShortcut,
    openMarkdownShortcut,
    queueNewActiveTerminalFocusAfterNewTabMenuClose
  })

  const trigger = (
    <DropdownMenuTrigger asChild>
      {titlebarStyle ? (
        <button
          type="button"
          className="titlebar-icon-button"
          // Why: aria-label matches the tooltip so E2E can locate the "+" via getByRole('button', { name: 'New tab' }).
          aria-label={translate(NEW_TAB_LABEL_KEY, 'New tab')}
        >
          <Plus size={14} />
        </button>
      ) : (
        <button
          className="ml-2 my-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={translate(NEW_TAB_LABEL_KEY, 'New tab')}
          // Why: aria-label matches the tooltip so E2E can locate the "+" via getByRole('button', { name: 'New tab' }).
          aria-label={translate(NEW_TAB_LABEL_KEY, 'New tab')}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
    </DropdownMenuTrigger>
  )

  return (
    // Why: a stable DOM node for this menu's own pending-focus cleanup (was the tab strip's outer wrapper; display:contents keeps flex layout unaffected here).
    <div ref={clearPendingNewTabMenuFocusOnUnmount} style={{ display: 'contents' }}>
      <DropdownMenu
        open={newTabMenuOpen}
        onOpenChange={setNewTabMenuOpen}
        // Why: modal would disable body pointer events, making the Mobile Emulator "Hide" re-enable toast unclickable.
        modal={false}
      >
        {titlebarStyle ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate(NEW_TAB_LABEL_KEY, 'New tab')}
            </TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <DropdownMenuContent
          align="start"
          sideOffset={6}
          className="w-72 max-w-[calc(100vw-1rem)] rounded-[11px] border-border/80 p-1 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
          onCloseAutoFocus={(event) => {
            // Why: Radix restores focus to the "+" trigger on close, stealing it from the freshly-mounted terminal.
            event.preventDefault()
            runPendingNewTabMenuFocusAfterClose()
          }}
        >
          {!terminalOnly && onOpenEntry ? (
            <>
              <TabBarCreateEntry
                worktreeId={worktreeId}
                groupId={resolvedGroupId}
                menuOpen={newTabMenuOpen}
                menuOptions={createMenuOptions}
                agentOptions={agentLaunchOptions}
                onLaunchAgent={launchAgentFromNewTabEntry}
                onOpenDefaultTerminal={() => {
                  queueNewActiveTerminalFocusAfterNewTabMenuClose()
                  onNewTerminalTab()
                }}
                onOpenEntry={onOpenEntry}
                onQueryChange={setCreateMenuQuery}
                onQueueSwitchFocus={queueFocusAfterNewTabMenuClose}
                onSelectMenuOption={handleSelectCreateMenuOption}
                onDidOpenEntry={() => setNewTabMenuOpen(false)}
              />
              {showStaticCreateMenuItems ? <DropdownMenuSeparator /> : null}
            </>
          ) : null}
          {showStaticCreateMenuItems ? standardCreateMenuItems : null}
          {showStaticCreateMenuItems && showAgentLaunchItems ? (
            <>
              <DropdownMenuSeparator />
              <QuickLaunchAgentMenuItems
                worktreeId={worktreeId}
                groupId={resolvedGroupId}
                onFocusTerminal={queueTerminalTabFocusAfterNewTabMenuClose}
              />
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
