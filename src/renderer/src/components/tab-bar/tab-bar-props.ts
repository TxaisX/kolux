import type { BrowserTab as BrowserTabState } from '../../../../shared/browser-workspace-types'
import type { ClientHostedBrowserRow } from '../../../../shared/client-hosted-browser-rows'
import type { Tab, WorkspaceVisibleTabType } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { OpenFile } from '../../store/slices/editor'
import type { HoveredTabInsertion } from '../tab-group/useTabDragSplit'
import type { TabCreateEntryArgs } from './tab-create-entry-action'

export type TabBarProps = {
  tabs: (TerminalTab & { unifiedTabId?: string })[]
  activeTabId: string | null
  groupId?: string
  worktreeId: string
  expandedPaneByTabId: Record<string, boolean>
  onActivate: (tabId: string) => void
  onClose: (tabId: string) => void
  onCloseOthers: (tabId: string) => void
  onCloseToRight: (tabId: string) => void
  onCloseToLeft: (tabId: string) => void
  onNewTerminalTab: () => void
  /** On Windows, opens a new terminal with a specific shell instead of the default. */
  onNewTerminalWithShell?: (shell: string) => void
  onNewBrowserTab: () => void
  onNewSimulatorTab?: () => void
  /** Opens a pending tab whose body is the agent picker (BridgeMind-style "+" entry); nothing spawns until a pick. */
  onNewAgentChoiceTab?: () => void
  onOpenEntry?: (args: TabCreateEntryArgs) => Promise<void>
  terminalOnly?: boolean
  showAgentLaunchItems?: boolean
  onNewFileTab?: () => void
  onOpenFileTab?: () => void
  newTabMenuOrder?: 'default' | 'markdown-first'
  onSetCustomTitle: (tabId: string, title: string | null) => void
  onSetTabColor: (tabId: string, color: string | null) => void
  onTogglePaneExpand: (tabId: string) => void
  editorFiles?: (OpenFile & { tabId?: string })[]
  browserTabs?: (BrowserTabState & { tabId?: string })[]
  /** Pages rendering on a paired client. Appended after the real tabs; never part of tab order. */
  clientHostedBrowserRows?: readonly ClientHostedBrowserRow[]
  /** The group's own active tab at render time; a client-hosted selection dies when it moves. */
  groupActiveTabId?: string | null
  agentSessionTabs?: (Tab & { contentType: 'agent-session' })[]
  activeFileId?: string | null
  activeBrowserTabId?: string | null
  activeSimulatorTabId?: string | null
  activeTabType?: WorkspaceVisibleTabType
  onActivateFile?: (fileId: string) => void
  onCloseFile?: (fileId: string) => void
  onActivateBrowserTab?: (tabId: string) => void
  onActivateAgentSession?: (tabId: string) => void
  onCloseBrowserTab?: (tabId: string) => void
  onDuplicateBrowserTab?: (tabId: string) => void
  onCloseAllFiles?: () => void
  onMakePreviewFilePermanent?: (fileId: string, tabId?: string) => void
  onPinFile?: (fileId: string, tabId?: string) => void
  tabBarOrder?: string[]
  hoveredTabInsertion?: HoveredTabInsertion | null
  /** Floating workspace panels are rounded; skip tab top borders that clash with the curve. */
  tabStripChrome?: 'default' | 'floating-panel'
  /** Per-pane strips suppress the "+": since 0.8.0 every session gets its own pane, so the titlebar "+" is the only add-tab affordance there. Default false preserves today's bar. */
  hideCreateMenu?: boolean
}

/** What the tab strip's "+" trigger + menu needs — enough to mount it without a tab strip around it. */
export type TabBarCreateMenuProps = Pick<
  TabBarProps,
  | 'worktreeId'
  | 'terminalOnly'
  | 'showAgentLaunchItems'
  | 'onOpenEntry'
  | 'newTabMenuOrder'
  | 'onNewTerminalTab'
  | 'onNewTerminalWithShell'
  | 'onNewBrowserTab'
  | 'onNewAgentChoiceTab'
  | 'onNewSimulatorTab'
  | 'onNewFileTab'
  | 'onOpenFileTab'
>
