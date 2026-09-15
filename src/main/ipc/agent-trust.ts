import { ipcMain } from 'electron'
import {
  type AgentTrustPreset,
  markCodexProjectTrusted,
  markCopilotFolderTrusted,
  markCursorWorkspaceTrusted
} from '../agent-trust-presets'
import { markRemoteAgentWorkspaceTrusted } from '../remote-agent-trust-presets'
import { markClaudeProjectTrusted, writeClaudeProjectTrust } from '../claude-trust-preset'
import { isFolderRepo } from '../../shared/repo-kind'
import { getWorktreeMirrorDistro } from '../project-runtime-git-options'
import { resolveWorktreeCreateRoute } from '../worktree-create-execution-host-route'
import type { Store } from '../persistence'
import {
  planPreTrustWorktreePaths,
  validatePreTrustWorktreesArgs
} from './agent-trust-pretrust-worktrees'

/**
 * Why: cursor-agent, GitHub Copilot CLI, and Codex gate first-launch in an
 * unfamiliar directory behind a "Do you trust this folder?" menu that consumes
 * keystrokes (numbered options / single-letter shortcuts). Nightshift's draft-URL
 * paste flow needs the input box, not the menu, so before Nightshift spawns the
 * agent it asks main to write the same trust artifacts the agents write
 * after the user accepts. Best-effort: any IO error is swallowed so a failed
 * trust write never blocks the workspace from opening.
 */
export function registerAgentTrustHandlers(store: Store): void {
  ipcMain.removeHandler('agentTrust:markTrusted')
  ipcMain.handle(
    'agentTrust:markTrusted',
    async (
      _event,
      args: { preset: AgentTrustPreset; workspacePath: string; connectionId?: string }
    ): Promise<void> => {
      if (!args || typeof args.workspacePath !== 'string' || !args.workspacePath) {
        return
      }
      try {
        const connectionId = typeof args.connectionId === 'string' ? args.connectionId.trim() : ''
        if (connectionId) {
          // Why: SSH-launched agents read trust artifacts from the remote
          // user's home, not from this desktop process.
          await markRemoteAgentWorkspaceTrusted({
            preset: args.preset,
            connectionId,
            workspacePath: args.workspacePath
          })
        } else if (args.preset === 'cursor') {
          markCursorWorkspaceTrusted(args.workspacePath)
        } else if (args.preset === 'copilot') {
          markCopilotFolderTrusted(args.workspacePath)
        } else if (args.preset === 'codex') {
          markCodexProjectTrusted(args.workspacePath)
        } else if (args.preset === 'claude') {
          await markClaudeProjectTrusted(args.workspacePath)
        }
      } catch {
        // Best-effort: see Why above. The user can still accept the trust
        // prompt manually if writing the artifact fails.
      }
    }
  )

  ipcMain.removeHandler('agentTrust:preTrustWorktrees')
  ipcMain.handle(
    'agentTrust:preTrustWorktrees',
    async (_event, rawArgs: unknown): Promise<{ ok: true } | { error: string }> => {
      const args = validatePreTrustWorktreesArgs(rawArgs)
      if ('error' in args) {
        return args
      }
      if (args.agent !== 'claude') {
        // Why: Codex/Cursor/Copilot keep their own per-spawn presets; this endpoint exists only to
        // pre-trust an entire wave of worktrees before any of them spawns `claude` (see
        // claude-trust-preset.ts for the race it closes).
        return { ok: true }
      }
      const repo = store.getRepo(args.repoId)
      if (!repo) {
        return { error: `Repo not found: ${args.repoId}` }
      }
      if (isFolderRepo(repo)) {
        return { error: 'Pre-trust only applies to git worktree repos.' }
      }
      const route = resolveWorktreeCreateRoute(repo)
      if (route.kind !== 'local') {
        return { error: 'Pre-trust only supports local repos.' }
      }
      try {
        const paths = await planPreTrustWorktreePaths(
          repo,
          store.getSettings(),
          args.worktreeNames,
          getWorktreeMirrorDistro(store, repo)
        )
        writeClaudeProjectTrust(paths)
        return { ok: true }
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) }
      }
    }
  )
}
