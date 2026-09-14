import type {
  RuntimeWorktreeListResult,
  RuntimeWorktreePsResult,
  RuntimeWorktreeRecord,
  RuntimeWorktreeCreateResult,
  RuntimeWorktreeRemoveResult
} from '../../shared/runtime-types'
import type { CommandHandler } from '../dispatch'
import { formatWorktreeList, formatWorktreePs, formatWorktreeShow, printResult } from '../format'
import {
  annotateOmittedHostScope,
  type WithAnnotatedHostScope
} from '../omitted-host-scope-selectors'
import { RuntimeClientError } from '../runtime-client'
import {
  getOptionalNullableNumberFlag,
  getOptionalNumberFlag,
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import {
  getOptionalWorktreeSelector,
  getRequiredWorktreeSelector,
  resolveCurrentWorktreeSelector
} from '../selectors'
import { printLineageSummary } from './worktree-lineage-summary'
import { assertWorkspaceTargetFlagsCompatible, hasWorkspaceProjectTarget } from '../worktree-project-target'
import {
  assertCreateParentFlagsCompatible,
  resolveCreateParentSelector
} from './worktree-create-parent-selector'
import { getOptionalLinearIssueLinkFlag } from './worktree-linear-issue-link'
import { WORKTREE_CHANGES_HANDLERS } from './worktree-changes'
import {
  getCreateRepoSelector,
  getEnvParentWorkspace,
  getOptionalSetupDecision,
  getOptionalStartupAgent,
  getPresentStringFlag
} from './worktree-create-flags'

type HookWarningResult = {
  warning?: string
}

type PreservedBranchResult = {
  preservedBranch?: {
    branchName: string
  }
}

function printHookWarning(result: HookWarningResult, json: boolean): void {
  if (!json && result.warning) {
    console.error(`warning: ${result.warning}`)
  }
}

function printPreservedBranchWarning(result: PreservedBranchResult, json: boolean): void {
  if (!json && result.preservedBranch) {
    console.error(
      `warning: local branch "${result.preservedBranch.branchName}" was kept because Git could not safely delete it`
    )
  }
}

function assertParentWorktreeFlagsCompatible(flags: Map<string, string | boolean>): void {
  if (flags.has('parent-worktree') && flags.get('no-parent') === true) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Choose either --parent-worktree or --no-parent, not both.'
    )
  }
  const parentWorktree = flags.get('parent-worktree')
  if (
    flags.has('parent-worktree') &&
    (typeof parentWorktree !== 'string' || parentWorktree === '')
  ) {
    throw new RuntimeClientError('invalid_argument', 'Missing required --parent-worktree')
  }
}

export const WORKTREE_HANDLERS: Record<string, CommandHandler> = {
  ...WORKTREE_CHANGES_HANDLERS,
  'worktree ps': async ({ flags, client, json }) => {
    const result = await client.call<WithAnnotatedHostScope<RuntimeWorktreePsResult>>(
      'worktree.ps',
      { limit: getOptionalPositiveIntegerFlag(flags, 'limit') }
    )
    await annotateOmittedHostScope(client, result.result)
    printResult(result, json, formatWorktreePs)
  },
  'worktree list': async ({ flags, client, json }) => {
    const result = await client.call<WithAnnotatedHostScope<RuntimeWorktreeListResult>>(
      'worktree.list',
      {
        repo: getOptionalStringFlag(flags, 'repo'),
        limit: getOptionalPositiveIntegerFlag(flags, 'limit')
      }
    )
    await annotateOmittedHostScope(client, result.result)
    printResult(result, json, formatWorktreeList)
  },
  'worktree show': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
      worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    })
    printResult(result, json, formatWorktreeShow)
  },
  'worktree current': async ({ client, cwd, json }) => {
    const result = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
      worktree: await resolveCurrentWorktreeSelector(cwd, client)
    })
    printResult(result, json, formatWorktreeShow)
  },
  'worktree create': async ({ flags, client, cwd, json }) => {
    assertCreateParentFlagsCompatible(flags)
    assertWorkspaceTargetFlagsCompatible(flags)
    const callerTerminalHandle =
      typeof process.env.NIGHTSHIFT_TERMINAL_HANDLE === 'string' &&
      process.env.NIGHTSHIFT_TERMINAL_HANDLE.length > 0
        ? process.env.NIGHTSHIFT_TERMINAL_HANDLE
        : undefined
    const explicitParent = await resolveCreateParentSelector(flags, cwd, client)
    const explicitParentWorktree = explicitParent.parentWorktree
    const explicitParentWorkspace = explicitParent.parentWorkspace
    const startupAgent = getOptionalStartupAgent(flags)
    const setupDecision = getOptionalSetupDecision(flags)
    const noParent = flags.get('no-parent') === true
    const envParentWorkspace =
      !noParent && !explicitParentWorkspace && !explicitParentWorktree
        ? getEnvParentWorkspace()
        : undefined
    let cwdParentWorktree: string | undefined
    const needsCwdRepoInference = !flags.has('repo') && !hasWorkspaceProjectTarget(flags)
    if (
      (!explicitParentWorktree && !explicitParentWorkspace && !noParent) ||
      needsCwdRepoInference
    ) {
      try {
        // Why: agent shells can lose NIGHTSHIFT_TERMINAL_HANDLE while still running
        // inside a Nightshift worktree. Cwd keeps CLI-created children nestable and
        // lets create infer the repo for the common current-workspace case.
        cwdParentWorktree = await resolveCurrentWorktreeSelector(cwd, client)
      } catch {
        cwdParentWorktree = undefined
      }
    }
    const linearIssueLink = getOptionalLinearIssueLinkFlag(flags, 'linear-issue')
    const activate = flags.get('activate') === true || flags.get('run-hooks') === true
    const name = getRequiredStringFlag(flags, 'name')
    const result = await client.call<RuntimeWorktreeCreateResult>('worktree.create', {
      repo: await getCreateRepoSelector(flags, cwdParentWorktree, client),
      name,
      displayName: name,
      displayNameKind: 'user',
      baseBranch: getOptionalStringFlag(flags, 'base-branch'),
      linkedIssue: getOptionalNumberFlag(flags, 'issue'),
      ...linearIssueLink,
      comment: getOptionalStringFlag(flags, 'comment'),
      runHooks: flags.get('run-hooks') === true,
      activate,
      // Why: the CLI pairs as a runtime device but is not a viewer, so caller-scoped
      // delivery would make --activate a no-op against a remote runtime.
      ...(activate ? { navigation: 'all' as const } : {}),
      ...(setupDecision ? { setupDecision } : {}),
      parentWorktree: explicitParentWorktree,
      ...(explicitParentWorkspace ? { parentWorkspace: explicitParentWorkspace } : {}),
      ...(envParentWorkspace ? { envParentWorkspace } : {}),
      ...(cwdParentWorktree ? { cwdParentWorktree } : {}),
      noParent,
      callerTerminalHandle,
      // Why: marks the workspace as CLI-created so the sidebar can badge and
      // filter it. Sent on every `worktree create` — hand-typed or agent-run.
      cliProvenanceRequest: callerTerminalHandle ? { callerTerminalHandle } : {},
      ...(startupAgent
        ? {
            startupAgent,
            startupPrompt: getPresentStringFlag(flags, 'prompt', { allowEmpty: true }) ?? ''
          }
        : {})
    })
    printHookWarning(result.result, json)
    printLineageSummary(result.result, json)
    printResult(result, json, formatWorktreeShow)
  },
  'worktree set': async ({ flags, client, cwd, json }) => {
    assertParentWorktreeFlagsCompatible(flags)
    const linearIssueLink = getOptionalLinearIssueLinkFlag(flags, 'linear-issue', {
      allowNull: true
    })
    const result = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.set', {
      worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client),
      displayName: getOptionalStringFlag(flags, 'display-name'),
      linkedIssue: getOptionalNullableNumberFlag(flags, 'issue'),
      ...linearIssueLink,
      comment: getOptionalStringFlag(flags, 'comment'),
      workspaceStatus: getOptionalStringFlag(flags, 'workspace-status'),
      parentWorktree: await getOptionalWorktreeSelector(flags, 'parent-worktree', cwd, client),
      noParent: flags.get('no-parent') === true
    })
    printResult(result, json, formatWorktreeShow)
  },
  'worktree rm': async ({ flags, client, cwd, json }) => {
    const worktree = await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    const resolved = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
      worktree
    })
    const hostId = resolved.result.worktree.hostId
    if (!hostId) {
      throw new RuntimeClientError(
        'worktree_host_unresolved',
        'Nightshift cannot tell which host owns this workspace. Refresh projects and try again.'
      )
    }
    const result = await client.call<RuntimeWorktreeRemoveResult>('worktree.rm', {
      worktree,
      hostId,
      force: flags.get('force') === true,
      // Why (#11960): --force is explicit here, so it may also waive PTY-stop proof.
      allowUnverifiedPtyStop: flags.get('force') === true,
      runHooks: flags.get('run-hooks') === true
    })
    printHookWarning(result.result, json)
    printPreservedBranchWarning(result.result, json)
    printResult(result, json, (value) => `removed: ${value.removed}`)
  }
}
