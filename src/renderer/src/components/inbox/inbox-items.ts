// Pure derivation of Inbox rows from store-shaped inputs. No store coupling here so
// this stays trivially unit-testable — see inbox-items.test.ts.
import { translate } from '@/i18n/i18n'
import { isExplicitAgentStatusFresh } from '@/lib/pane-agent-evidence'
import { resolveDecayedAgentRowState, agentNoUpdateLabel } from '@/lib/agent-row-decay-state'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import {
  parseInteractivePrompt,
  type InteractivePromptCard
} from '@/components/native-chat/native-chat-interactive-prompt'
import { agentEntryCompletionAt } from '../../../../shared/agent-completion-time'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  agentStatusEvidenceObservedAt,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { Repo } from '../../../../shared/repo-types'
import type { GitBranchLineTotal } from '../../../../shared/git-status-types'
import {
  LOCAL_EXECUTION_HOST_ID,
  getWorktreeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { getHostContextLabel } from '../../../../shared/worktree/host-context-labels'

export type InboxItemKind = 'question' | 'permission' | 'running' | 'unverifiable' | 'done'

export type InboxItem = {
  id: string
  paneKey: string
  tabId: string
  worktreeId: string
  kind: InboxItemKind
  title: string
  /** Pre-formatted "workspace › branch" — the list row renders this verbatim in mono. */
  workspaceLabel: string
  hostLabel: string
  agent: string
  lastMessage: string
  ageMs: number
  diff?: { added: number; removed: number }
}

export type InboxGroups = {
  needs: InboxItem[]
  waiting: InboxItem[]
  done: InboxItem[]
}

export type InboxDeriveInput = {
  now: number
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  tabsByWorktree: Record<string, TerminalTab[]>
  worktrees: readonly Worktree[]
  repos: readonly Repo[]
  hostLabelById?: ReadonlyMap<ExecutionHostId, string>
  branchLineTotalByWorktree?: Record<string, GitBranchLineTotal | null>
  ptyIdsByTabId?: Record<string, string[]>
}

const DONE_CAP = 20

function resolveWorkspaceLabel(worktree: Worktree): string {
  const identity = getWorktreeGitIdentityDisplay(worktree)
  const branchText =
    identity?.kind === 'branch'
      ? identity.branchName
      : (identity?.sourceControlLabel ?? worktree.branch)
  return branchText ? `${worktree.displayName} › ${branchText}` : worktree.displayName
}

function resolveNeedsTitle(entry: AgentStatusEntry, parsed: InteractivePromptCard): string {
  if (parsed?.kind === 'approval') {
    return parsed.approval.title
  }
  if (parsed?.kind === 'question') {
    return parsed.prompt.questions[0]?.question ?? entry.prompt
  }
  return entry.prompt || translate('components.inbox.items.needs.fallback', 'Needs your input')
}

function resolveRunningTitle(entry: AgentStatusEntry): string {
  if (entry.toolName) {
    return translate('components.inbox.items.running.tool', 'Running {{value0}}', {
      value0: entry.toolName
    })
  }
  return entry.prompt || translate('components.inbox.items.running.fallback', 'Working')
}

function resolveDoneTitle(entry: AgentStatusEntry): string {
  return (
    entry.lastCompletedAssistantMessage ||
    entry.lastAssistantMessage ||
    translate('components.inbox.items.done.fallback', 'Turn complete')
  )
}

function resolveLastMessage(entry: AgentStatusEntry): string {
  return entry.lastAssistantMessage ?? entry.lastCompletedAssistantMessage ?? entry.prompt ?? ''
}

type ItemBase = Omit<InboxItem, 'kind' | 'title' | 'ageMs'>

function buildItemBase(
  entry: AgentStatusEntry,
  tabId: string,
  worktree: Worktree,
  repoById: Map<string, Repo>,
  hostLabelById: ReadonlyMap<ExecutionHostId, string> | undefined,
  branchLineTotalByWorktree: Record<string, GitBranchLineTotal | null> | undefined
): ItemBase {
  const repo = repoById.get(worktree.repoId)
  const hostId = getWorktreeExecutionHostId(worktree, repo, LOCAL_EXECUTION_HOST_ID)
  const lineTotal = branchLineTotalByWorktree?.[worktree.id]
  return {
    id: entry.paneKey,
    paneKey: entry.paneKey,
    tabId,
    worktreeId: worktree.id,
    workspaceLabel: resolveWorkspaceLabel(worktree),
    hostLabel: getHostContextLabel(hostId, { hostLabelById }),
    agent: entry.agentType ?? 'unknown',
    lastMessage: resolveLastMessage(entry),
    diff: lineTotal ? { added: lineTotal.added, removed: lineTotal.removed } : undefined
  }
}

/** Group + sort store state into the three Inbox sections. Freshest first in every section. */
export function deriveInboxItems(input: InboxDeriveInput): InboxGroups {
  const worktreeById = new Map(input.worktrees.map((w) => [w.id, w]))
  const repoById = new Map(input.repos.map((r) => [r.id, r]))
  const tabById = new Map<string, TerminalTab>()
  for (const tabs of Object.values(input.tabsByWorktree)) {
    for (const tab of tabs) {
      tabById.set(tab.id, tab)
    }
  }

  const needs: InboxItem[] = []
  const waiting: InboxItem[] = []
  const done: InboxItem[] = []

  for (const entry of Object.values(input.agentStatusByPaneKey)) {
    const parsedKey = parsePaneKey(entry.paneKey)
    if (!parsedKey) {
      continue
    }
    const tab = tabById.get(parsedKey.tabId)
    const worktreeId = tab?.worktreeId ?? entry.worktreeId
    const worktree = worktreeId ? worktreeById.get(worktreeId) : undefined
    if (!worktree) {
      continue
    }
    const base = buildItemBase(
      entry,
      parsedKey.tabId,
      worktree,
      repoById,
      input.hostLabelById,
      input.branchLineTotalByWorktree
    )
    const fresh = isExplicitAgentStatusFresh(entry, input.now, AGENT_STATUS_STALE_AFTER_MS)

    if (fresh && (entry.state === 'blocked' || entry.state === 'waiting')) {
      const parsed = parseInteractivePrompt(entry.interactivePrompt, entry.toolName)
      const stateStartedAt = Number.isFinite(entry.stateStartedAt)
        ? entry.stateStartedAt
        : input.now
      needs.push({
        ...base,
        kind: parsed?.kind === 'approval' ? 'permission' : 'question',
        title: resolveNeedsTitle(entry, parsed),
        ageMs: Math.max(0, input.now - stateStartedAt)
      })
      continue
    }

    if (fresh && entry.state === 'working') {
      const stateStartedAt = Number.isFinite(entry.stateStartedAt)
        ? entry.stateStartedAt
        : input.now
      waiting.push({
        ...base,
        kind: 'running',
        title: resolveRunningTitle(entry),
        ageMs: Math.max(0, input.now - stateStartedAt)
      })
      continue
    }

    if (!fresh) {
      const hasLivePty = tabHasLivePty(input.ptyIdsByTabId ?? {}, parsedKey.tabId)
      if (resolveDecayedAgentRowState(entry, hasLivePty) === 'unverifiable') {
        waiting.push({
          ...base,
          kind: 'unverifiable',
          title: agentNoUpdateLabel(entry, input.now),
          ageMs: Math.max(0, input.now - agentStatusEvidenceObservedAt(entry))
        })
      }
      continue
    }

    if (entry.state === 'done') {
      const completedAt = agentEntryCompletionAt(entry)
      if (completedAt === null || input.now - completedAt > AGENT_STATUS_STALE_AFTER_MS) {
        continue
      }
      done.push({
        ...base,
        kind: 'done',
        title: resolveDoneTitle(entry),
        ageMs: Math.max(0, input.now - completedAt)
      })
    }
  }

  const byFreshest = (a: InboxItem, b: InboxItem): number => a.ageMs - b.ageMs
  needs.sort(byFreshest)
  waiting.sort(byFreshest)
  done.sort(byFreshest)

  return { needs, waiting, done: done.slice(0, DONE_CAP) }
}
