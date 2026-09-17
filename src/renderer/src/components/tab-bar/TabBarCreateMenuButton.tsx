import React from 'react'
import { useTabBarRuntimeModel } from './use-tab-bar-runtime-model'
import { useTabBarCreateMenuController } from './use-tab-bar-create-menu-controller'
import { renderTabBarCreateMenu } from './tab-bar-create-menu'
import type { TabBarCreateMenuProps } from './tab-bar-props'

/**
 * Mounts just the tab strip's "+" create menu, with no tab strip around it — the
 * titlebar's own new-tab button when the workspace is split and every pane owns its
 * own strip (which suppresses its "+" via TabBar's `hideCreateMenu`).
 */
function TabBarCreateMenuButtonInner(props: TabBarCreateMenuProps): React.JSX.Element {
  const { worktreeId, terminalOnly = false } = props
  const runtime = useTabBarRuntimeModel({ worktreeId })
  const createMenu = useTabBarCreateMenuController({
    worktreeId,
    resolvedGroupId: runtime.resolvedGroupId,
    terminalOnly,
    mobileEmulatorEnabled: runtime.mobileEmulatorEnabled,
    managedBrowserCreationEnabled: runtime.managedBrowserCreationEnabled,
    mobileEmulatorCreationEnabled: runtime.mobileEmulatorCreationEnabled,
    workspaceHasSimulatorTab: runtime.workspaceHasSimulatorTab,
    showWindowsShellMenu: runtime.showWindowsShellMenu,
    projectRuntimeShellMenuMode: runtime.projectRuntimeShellMenuMode,
    defaultWindowsShell: runtime.defaultWindowsShell,
    defaultWindowsPowerShellImplementation: runtime.defaultWindowsPowerShellImplementation,
    windowsTerminalCapabilities: runtime.windowsTerminalCapabilities,
    agentLaunchOptions: runtime.agentLaunchOptions,
    onNewTerminalTab: props.onNewTerminalTab,
    onNewTerminalWithShell: props.onNewTerminalWithShell,
    onNewBrowserTab: props.onNewBrowserTab,
    onNewSimulatorTab: props.onNewSimulatorTab,
    onNewFileTab: props.onNewFileTab,
    onOpenFileTab: props.onOpenFileTab
  })
  return renderTabBarCreateMenu({ props, runtime, createMenu, titlebarStyle: true })
}

export default React.memo(TabBarCreateMenuButtonInner)
