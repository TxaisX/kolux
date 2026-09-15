import { useAppStore } from '@/store'
import { useTerminalPaneHeaderAgent } from '@/components/terminal-pane/use-terminal-pane-header-agent'
import type { TerminalPaneHeaderAgent } from '@/components/terminal-pane/use-terminal-pane-header-agent'
import { isTerminalLeafId, type TerminalLeafId } from '../../../../shared/stable-pane-id'

// Why: makePaneKey (inside useTerminalPaneHeaderAgent) throws on a non-UUID
// leaf id. A window whose store has no layout entry yet still needs a valid
// shape to pass through — this key never matches a real pane, so the hook's
// own launchAgent/idle fallback takes over exactly as it does for a plain shell.
const UNRESOLVED_LEAF_ID = '00000000-0000-4000-8000-000000000000' as TerminalLeafId

/** Same agent-identity resolution the tabbed pane header uses, reused as
 *  instructed rather than re-derived — see AGENTS.md's terminal-window brief. */
export function useTerminalWindowHeaderAgent(
  tabId: string,
  worktreeId: string
): TerminalPaneHeaderAgent {
  const layout = useAppStore((s) => s.terminalLayoutsByTabId[tabId])
  const leafId = layout?.activeLeafId ?? Object.keys(layout?.ptyIdsByLeafId ?? {})[0]
  return useTerminalPaneHeaderAgent(
    tabId,
    worktreeId,
    isTerminalLeafId(leafId ?? '') ? (leafId as TerminalLeafId) : UNRESOLVED_LEAF_ID
  )
}
