import { resolve as resolvePath } from 'node:path'
import type {
  RuntimeWorktreeChangesResult,
  RuntimeWorktreeOverlapResult
} from '../../shared/runtime-types'
import type { RuntimeRpcSuccess } from '../../shared/runtime-rpc-envelope'
import { isPathInsideOrEqual } from '../../shared/cross-platform-path'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import type { CommandHandler, HandlerContext } from '../dispatch'
import { formatWorktreeChanges, formatWorktreeOverlap, printResult } from '../format'
import { getOptionalStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { normalizeWorktreeSelectorForCaller, resolveCurrentWorktreeSelector } from '../selectors'

type FolderWorkspaceRow = { id: string; folderPath: string }

type WorktreeChangesTarget =
  | { kind: 'worktree'; worktree: string }
  | { kind: 'folder'; folderWorkspaceId: string; folderPath: string }

async function listFolderWorkspaces(ctx: HandlerContext): Promise<FolderWorkspaceRow[]> {
  const result = await ctx.client.call<{ folderWorkspaces: FolderWorkspaceRow[] }>(
    'folderWorkspace.list',
    {}
  )
  return result.result.folderWorkspaces
}

async function resolveFolderTarget(
  ctx: HandlerContext,
  folderWorkspaceId: string
): Promise<WorktreeChangesTarget> {
  const folder = (await listFolderWorkspaces(ctx)).find((row) => row.id === folderWorkspaceId)
  if (!folder) {
    throw new RuntimeClientError(
      'selector_not_found',
      `No folder workspace found: folder:${folderWorkspaceId}`
    )
  }
  return { kind: 'folder', folderWorkspaceId, folderPath: folder.folderPath }
}

async function findEnclosingFolderWorkspace(
  ctx: HandlerContext
): Promise<FolderWorkspaceRow | undefined> {
  if (ctx.client.isRemote) {
    return undefined
  }
  const currentPath = resolvePath(ctx.cwd)
  return (await listFolderWorkspaces(ctx)).find((folder) =>
    isPathInsideOrEqual(resolvePath(folder.folderPath), currentPath)
  )
}

/**
 * Read-only worktree selector resolution for `worktree changes`/`worktree overlap`. A folder
 * workspace (a Kolux-managed plain folder, not a git worktree — see the Folder Workspace
 * Use Case in AGENTS.md) is not resolvable through `worktree.*`, so an explicit `folder:<id>`
 * selector, or the cwd matching a registered folder workspace when `--worktree` is omitted,
 * short-circuits to the folder branch instead of failing with `selector_not_found`.
 */
async function resolveWorktreeChangesTarget(ctx: HandlerContext): Promise<WorktreeChangesTarget> {
  const { flags, cwd, client } = ctx
  const raw = getOptionalStringFlag(flags, 'worktree')
  if (raw) {
    const scope = parseWorkspaceKey(raw)
    if (scope?.type === 'folder') {
      return await resolveFolderTarget(ctx, scope.folderWorkspaceId)
    }
    if (raw !== 'active' && raw !== 'current') {
      return {
        kind: 'worktree',
        worktree: await normalizeWorktreeSelectorForCaller(raw, cwd, client)
      }
    }
  }
  try {
    return { kind: 'worktree', worktree: await resolveCurrentWorktreeSelector(cwd, client) }
  } catch (error) {
    if (!(error instanceof RuntimeClientError) || error.code !== 'selector_not_found') {
      throw error
    }
    const folderMatch = await findEnclosingFolderWorkspace(ctx)
    if (!folderMatch) {
      throw error
    }
    return { kind: 'folder', folderWorkspaceId: folderMatch.id, folderPath: folderMatch.folderPath }
  }
}

function synthesizeLocalResult<TResult>(result: TResult): RuntimeRpcSuccess<TResult> {
  return { id: 'local', ok: true, result, _meta: { runtimeId: 'local' } }
}

function folderChangesResult(target: {
  folderWorkspaceId: string
  folderPath: string
}): RuntimeWorktreeChangesResult {
  return {
    worktree: { id: `folder:${target.folderWorkspaceId}`, branch: null, path: target.folderPath },
    base: null,
    files: [],
    unsupported: 'folder'
  }
}

function folderOverlapResult(target: { folderWorkspaceId: string }): RuntimeWorktreeOverlapResult {
  return {
    worktree: { id: `folder:${target.folderWorkspaceId}`, branch: null },
    siblings: [],
    unsupported: 'folder'
  }
}

export const WORKTREE_CHANGES_HANDLERS: Record<string, CommandHandler> = {
  'worktree changes': async (ctx) => {
    const target = await resolveWorktreeChangesTarget(ctx)
    if (target.kind === 'folder') {
      printResult(
        synthesizeLocalResult(folderChangesResult(target)),
        ctx.json,
        formatWorktreeChanges
      )
      return
    }
    const result = await ctx.client.call<RuntimeWorktreeChangesResult>('worktree.changes', {
      worktree: target.worktree
    })
    printResult(result, ctx.json, formatWorktreeChanges)
  },
  'worktree overlap': async (ctx) => {
    const target = await resolveWorktreeChangesTarget(ctx)
    if (target.kind === 'folder') {
      printResult(
        synthesizeLocalResult(folderOverlapResult(target)),
        ctx.json,
        formatWorktreeOverlap
      )
      return
    }
    const result = await ctx.client.call<RuntimeWorktreeOverlapResult>('worktree.overlap', {
      worktree: target.worktree
    })
    printResult(result, ctx.json, formatWorktreeOverlap)
  }
}
