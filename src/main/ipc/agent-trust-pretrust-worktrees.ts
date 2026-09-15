import type { GlobalSettings } from '../../shared/global-settings-types'
import type { Repo } from '../../shared/repo-types'
import type { TuiAgent } from '../../shared/tui-agent'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { canonicalizeClaudeProjectPath } from '../claude-trust-preset'
import {
  computeWorkspaceRootAsync,
  computeWorktreePath,
  ensurePathWithinWorkspace,
  getWorktreePathSettings,
  sanitizeWorktreeName
} from './worktree-logic'

/** Mirrors the app-wide agent-launch wave cap (12). Duplicated as a small constant rather than
 *  importing renderer code from the main process. */
export const MAX_PRE_TRUST_WORKTREES = 12

export type PreTrustWorktreesArgs = { repoId: string; agent: TuiAgent; worktreeNames: string[] }

/**
 * Same placement `createLocalWorktree` (worktree-remote.ts) will use for each name, canonicalized
 * for the Claude trust key. Computed before `git worktree add` runs for any of them, so a wave's
 * worth of trust entries can land in one write before any sibling's `claude` process spawns --
 * see claude-trust-preset.ts for why that ordering matters. Touches the filesystem only to resolve
 * the (already-existing) workspace root and to realpath() existing ancestors.
 */
export async function planPreTrustWorktreePaths(
  repo: Repo,
  settings: GlobalSettings,
  worktreeNames: readonly string[],
  wslMirrorDistro?: string
): Promise<string[]> {
  const worktreePathSettings = getWorktreePathSettings(repo, settings, wslMirrorDistro)
  const workspaceRoot = await computeWorkspaceRootAsync(repo.path, worktreePathSettings)
  return worktreeNames.map((name) => {
    const sanitized = sanitizeWorktreeName(name)
    const planned = ensurePathWithinWorkspace(
      computeWorktreePath(sanitized, repo.path, worktreePathSettings, workspaceRoot),
      workspaceRoot
    )
    return canonicalizeClaudeProjectPath(planned)
  })
}

export function validatePreTrustWorktreesArgs(
  args: unknown
): PreTrustWorktreesArgs | { error: string } {
  if (!args || typeof args !== 'object') {
    return { error: 'Invalid arguments.' }
  }
  const { repoId, agent, worktreeNames } = args as Record<string, unknown>
  if (typeof repoId !== 'string' || !repoId) {
    return { error: 'repoId must be a non-empty string.' }
  }
  if (!isTuiAgent(agent)) {
    return { error: 'agent must be a known TUI agent.' }
  }
  if (!Array.isArray(worktreeNames) || worktreeNames.length === 0) {
    return { error: 'worktreeNames must be a non-empty array.' }
  }
  if (worktreeNames.length > MAX_PRE_TRUST_WORKTREES) {
    return { error: `worktreeNames cannot exceed ${MAX_PRE_TRUST_WORKTREES}.` }
  }
  if (!worktreeNames.every((name): name is string => typeof name === 'string' && name.length > 0)) {
    return { error: 'worktreeNames must be non-empty strings.' }
  }
  return { repoId, agent, worktreeNames }
}
