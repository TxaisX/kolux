import { useCallback } from 'react'
import { toast } from 'sonner'
import type { TuiAgent } from '../../../shared/tui-agent'
import { useAppStore } from '../store'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import {
  createWebRuntimeSessionBrowserTab,
  createWebRuntimeSessionTerminal,
  isWebRuntimeSessionActive
} from '@/runtime/web-runtime-session'
import { openMobileEmulatorTab } from '@/lib/open-mobile-emulator-tab'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { buildDuplicatedBrowserTabOptions } from '@/lib/duplicate-browser-tab-options'
import { browserWorkspaceHasRemoteOwner } from '@/runtime/remote-browser-tab-ownership'
import { getClientCreationActionPolicy } from '@/lib/client-creation-action-policy'
import { showClientCreationActionError } from '@/lib/client-creation-action-error'
import { openTabBarEntry, type TabCreateEntryArgs } from './tab-bar/tab-create-entry-action'
import { translate } from '@/i18n/i18n'
import { getActiveWorktreeRuntimeEnvironmentId } from './terminal-workspace-model'
import { splitPaneForNewSession } from './pane-layout/split-pane-for-new-session'
import { resolvePendingAgentChoice } from '@/lib/resolve-pending-agent-choice'
import type { TerminalColdActivationController } from './terminal-cold-activation'

export function useTerminalCreateActions(controller: TerminalColdActivationController) {
  const {
    activeWorktreeId,
    createBrowserTab,
    createTab,
    openNewBrowserTabInActiveWorkspace,
    openNewMarkdownInActiveWorkspace,
    openNewTerminalTabInActiveWorkspace,
    setActiveTabType,
    setTabBarOrder
  } = controller
  const handleNewTab = useCallback(
    (shellOverride?: string) => {
      if (!activeWorktreeId) {
        return
      }
      const sourceGroupId =
        useAppStore.getState().activeGroupIdByWorktree[activeWorktreeId] ??
        useAppStore.getState().groupsByWorktree[activeWorktreeId]?.[0]?.id
      if (!shellOverride && sourceGroupId) {
        // Why: the store action splits a fresh pane for the session itself.
        void openNewTerminalTabInActiveWorkspace(sourceGroupId)
        return
      }
      const targetGroupId = sourceGroupId
        ? splitPaneForNewSession(useAppStore.getState, activeWorktreeId, sourceGroupId)
        : undefined
      const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
      if (isWebRuntimeSessionActive(runtimeEnvironmentId)) {
        void createWebRuntimeSessionTerminal({
          worktreeId: activeWorktreeId,
          environmentId: runtimeEnvironmentId,
          targetGroupId,
          command: shellOverride,
          activate: true
        })
        return
      }
      const newTab = createTab(activeWorktreeId, targetGroupId, shellOverride)
      setActiveTabType('terminal')
      const state = useAppStore.getState()
      const currentTerminals = state.tabsByWorktree[activeWorktreeId] ?? []
      const currentEditors = state.openFiles.filter((file) => file.worktreeId === activeWorktreeId)
      const currentBrowsers = state.browserTabsByWorktree[activeWorktreeId] ?? []
      const stored = state.tabBarOrderByWorktree[activeWorktreeId]
      const termIds = currentTerminals.map((tab) => tab.id)
      const editorIds = currentEditors.map((file) => file.id)
      const browserIds = currentBrowsers.map((tab) => tab.id)
      const validIds = new Set([...termIds, ...editorIds, ...browserIds])
      const base = (stored ?? []).filter((id) => validIds.has(id))
      const inBase = new Set(base)
      for (const id of [...termIds, ...editorIds, ...browserIds]) {
        if (!inBase.has(id)) {
          base.push(id)
          inBase.add(id)
        }
      }
      const order = base.filter((id) => id !== newTab.id)
      order.push(newTab.id)
      setTabBarOrder(activeWorktreeId, order)
      focusTerminalTabSurface(newTab.id)
    },
    [
      activeWorktreeId,
      createTab,
      openNewTerminalTabInActiveWorkspace,
      setActiveTabType,
      setTabBarOrder
    ]
  )

  const handleNewAgentTab = useCallback(
    (agent: TuiAgent) => {
      if (!activeWorktreeId) {
        return
      }
      const state = useAppStore.getState()
      const sourceGroupId =
        state.activeGroupIdByWorktree[activeWorktreeId] ??
        state.groupsByWorktree[activeWorktreeId]?.[0]?.id
      const result = launchAgentInNewTab({
        agent,
        worktreeId: activeWorktreeId,
        groupId: sourceGroupId
          ? splitPaneForNewSession(useAppStore.getState, activeWorktreeId, sourceGroupId)
          : undefined,
        launchSource: 'shortcut'
      })
      if (!result) {
        toast.error(
          translate(
            'auto.components.Terminal.e57db40c11',
            'Could not build launch command for {{value0}}.',
            { value0: agent }
          )
        )
      }
    },
    [activeWorktreeId]
  )

  // Explicit "choose agent" entry point (item 4 of the BridgeMind-picker task):
  // creates a tab in the pending-agent-choice state instead of changing what
  // the plain `+` button (handleNewTab) does, so existing muscle memory and
  // every existing caller keep today's immediate-spawn behavior.
  // ponytail: paired web-runtime workspaces aren't special-cased here (unlike
  // handleNewTab) — they get a pending tab too. Add a paired-host picker path
  // if BridgeMind parity turns out to matter for those workspaces.
  const handleNewAgentChoiceTab = useCallback(() => {
    if (!activeWorktreeId) {
      return
    }
    const state = useAppStore.getState()
    const sourceGroupId =
      state.activeGroupIdByWorktree[activeWorktreeId] ??
      state.groupsByWorktree[activeWorktreeId]?.[0]?.id
    const targetGroupId = sourceGroupId
      ? splitPaneForNewSession(useAppStore.getState, activeWorktreeId, sourceGroupId)
      : undefined
    const newTab = createTab(activeWorktreeId, targetGroupId, undefined, {
      pendingAgentChoice: true
    })
    setActiveTabType('terminal')
    focusTerminalTabSurface(newTab.id)
  }, [activeWorktreeId, createTab, setActiveTabType])

  const handleResolveAgentChoiceTab = useCallback(
    (tabId: string, worktreeId: string, pick: TuiAgent | 'blank') =>
      resolvePendingAgentChoice(tabId, worktreeId, pick),
    []
  )

  const handleNewSimulatorTab = useCallback(() => {
    if (!activeWorktreeId) {
      return
    }
    const targetGroupId =
      useAppStore.getState().activeGroupIdByWorktree[activeWorktreeId] ??
      useAppStore.getState().groupsByWorktree[activeWorktreeId]?.[0]?.id
    void openMobileEmulatorTab(activeWorktreeId, {
      placement: 'rightSplit',
      targetGroupId: targetGroupId ?? undefined
    }).catch(showClientCreationActionError)
  }, [activeWorktreeId])

  const handleNewBrowserTab = useCallback(() => {
    if (!activeWorktreeId) {
      return
    }
    const targetGroupId =
      useAppStore.getState().activeGroupIdByWorktree[activeWorktreeId] ??
      useAppStore.getState().groupsByWorktree[activeWorktreeId]?.[0]?.id
    if (targetGroupId) {
      void openNewBrowserTabInActiveWorkspace(targetGroupId).catch(showClientCreationActionError)
      return
    }
    const state = useAppStore.getState()
    const browserAvailability = getClientCreationActionPolicy(state, activeWorktreeId)[
      'managed-browser'
    ]
    if (browserAvailability.state !== 'enabled') {
      toast.error(browserAvailability.reason)
      return
    }
    const defaultUrl = state.browserDefaultUrl ?? 'about:blank'
    const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
    if (browserAvailability.provider === 'paired-runtime' && runtimeEnvironmentId) {
      void createWebRuntimeSessionBrowserTab({
        worktreeId: activeWorktreeId,
        environmentId: runtimeEnvironmentId,
        url: defaultUrl
      }).catch(showClientCreationActionError)
      return
    }
    createBrowserTab(activeWorktreeId, defaultUrl, {
      title: translate('auto.components.Terminal.37da0d736f', 'New Browser Tab'),
      focusAddressBar: true,
      ...(runtimeEnvironmentId ? { browserRuntimeEnvironmentId: null } : {})
    })
  }, [activeWorktreeId, createBrowserTab, openNewBrowserTabInActiveWorkspace])

  const handleOpenEntry = useCallback(async (args: TabCreateEntryArgs) => {
    await openTabBarEntry(args)
  }, [])

  const handleDuplicateBrowserTab = useCallback(
    (browserTabId: string) => {
      if (!activeWorktreeId) {
        return
      }
      const state = useAppStore.getState()
      const tabs = state.browserTabsByWorktree[activeWorktreeId] ?? []
      const source = tabs.find((tab) => tab.id === browserTabId)
      if (!source) {
        return
      }
      const runtimeEnvironmentId = getActiveWorktreeRuntimeEnvironmentId(activeWorktreeId)
      const browserAvailability = getClientCreationActionPolicy(state, activeWorktreeId)[
        'managed-browser'
      ]
      if (browserAvailability.state !== 'enabled') {
        toast.error(browserAvailability.reason)
        return
      }
      if (
        browserAvailability.provider === 'paired-runtime' &&
        runtimeEnvironmentId &&
        browserWorkspaceHasRemoteOwner(state, source.id, runtimeEnvironmentId)
      ) {
        void createWebRuntimeSessionBrowserTab({
          worktreeId: activeWorktreeId,
          environmentId: runtimeEnvironmentId,
          url: source.url,
          profileId: source.sessionProfileId
        }).catch(showClientCreationActionError)
        return
      }
      try {
        createBrowserTab(activeWorktreeId, source.url, {
          ...buildDuplicatedBrowserTabOptions(source),
          ...(runtimeEnvironmentId ? { browserRuntimeEnvironmentId: null } : {})
        })
      } catch (error) {
        showClientCreationActionError(error)
      }
    },
    [activeWorktreeId, createBrowserTab]
  )

  const handleNewFile = useCallback(async () => {
    if (!activeWorktreeId) {
      return
    }
    const targetGroupId =
      useAppStore.getState().activeGroupIdByWorktree[activeWorktreeId] ??
      useAppStore.getState().groupsByWorktree[activeWorktreeId]?.[0]?.id
    if (!targetGroupId) {
      return
    }
    await openNewMarkdownInActiveWorkspace(targetGroupId)
  }, [activeWorktreeId, openNewMarkdownInActiveWorkspace])

  return {
    handleNewTab,
    handleNewAgentTab,
    handleNewAgentChoiceTab,
    handleResolveAgentChoiceTab,
    handleNewSimulatorTab,
    handleNewBrowserTab,
    handleOpenEntry,
    handleDuplicateBrowserTab,
    handleNewFile
  }
}

export type TerminalCreateController = TerminalColdActivationController &
  ReturnType<typeof useTerminalCreateActions>
