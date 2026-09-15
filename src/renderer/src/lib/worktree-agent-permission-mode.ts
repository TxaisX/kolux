import type { GlobalSettings } from '../../../shared/global-settings-types'
import { resolveAgentPermissionModeSummary } from '../../../shared/tui-agent-permissions'

/**
 * Effective per-workspace YOLO (skip-permissions) mode for the composer's bypass chip:
 * an explicit worktree override wins, otherwise falls back to the global agent default
 * mode (treating a 'mixed' global default as 'manual', since not every agent is on YOLO).
 */
export function resolveWorktreeAgentPermissionMode(
  state: {
    agentPermissionModeByWorktree: Record<string, 'yolo' | 'manual'>
    settings: Pick<GlobalSettings, 'agentDefaultArgs' | 'agentDefaultEnv'> | null
  },
  worktreeId: string
): 'yolo' | 'manual' {
  const explicit = state.agentPermissionModeByWorktree[worktreeId]
  if (explicit) {
    return explicit
  }
  const summary = resolveAgentPermissionModeSummary({
    agentDefaultArgs: state.settings?.agentDefaultArgs,
    agentDefaultEnv: state.settings?.agentDefaultEnv
  })
  return summary === 'mixed' ? 'manual' : summary
}
