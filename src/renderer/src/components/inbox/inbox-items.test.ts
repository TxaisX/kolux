import { describe, expect, it } from 'vitest'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStatusEntry
} from '../../../../shared/agent-status-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { Repo } from '../../../../shared/repo-types'
import { deriveInboxItems, type InboxDeriveInput } from './inbox-items'

const NOW = new Date('2026-03-27T12:00:00.000Z').getTime()
const LEAF_1 = '11111111-1111-4111-8111-111111111111'
const LEAF_2 = '22222222-2222-4222-8222-222222222222'
const TAB_ID = 'tab-1'

const repo: Repo = {
  id: 'repo-1',
  path: '/tmp/nightshift',
  displayName: 'nightshift',
  badgeColor: '#000000',
  addedAt: 0
}

const worktree: Worktree = {
  id: 'wt-1',
  repoId: repo.id,
  path: '/tmp/nightshift-feature',
  branch: 'refs/heads/feature/foo',
  head: 'abc123',
  isBare: false,
  isMainWorktree: false,
  linkedIssue: null,
  linkedPR: null,
  linkedLinearIssue: null,
  isArchived: false,
  comment: '',
  isUnread: false,
  isPinned: false,
  displayName: 'nightshift-feature',
  sortOrder: 0,
  lastActivityAt: 0
}

function makeTab(overrides: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: TAB_ID,
    ptyId: null,
    worktreeId: worktree.id,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0,
    ...overrides
  }
}

function makeEntry(overrides: Partial<AgentStatusEntry> & { paneKey: string }): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW,
    stateHistory: [],
    ...overrides
  }
}

function baseInput(overrides: Partial<InboxDeriveInput> = {}): InboxDeriveInput {
  return {
    now: NOW,
    agentStatusByPaneKey: {},
    tabsByWorktree: { [worktree.id]: [makeTab()] },
    worktrees: [worktree],
    repos: [repo],
    ...overrides
  }
}

function paneKey(leafId = LEAF_1): string {
  return `${TAB_ID}:${leafId}`
}

describe('deriveInboxItems', () => {
  it('puts a fresh blocked entry with a plain prompt into needs as a question', () => {
    const entry = makeEntry({ paneKey: paneKey(), state: 'blocked', prompt: 'Which branch?' })
    const groups = deriveInboxItems(baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry } }))
    expect(groups.needs).toHaveLength(1)
    expect(groups.needs[0]).toMatchObject({
      kind: 'question',
      title: 'Which branch?',
      worktreeId: worktree.id
    })
  })

  it('classifies an approval-shaped interactivePrompt as permission', () => {
    const entry = makeEntry({
      paneKey: paneKey(),
      state: 'waiting',
      interactivePrompt: JSON.stringify({ approval: { tool: 'Bash', summary: 'rm -rf tmp' } })
    })
    const groups = deriveInboxItems(baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry } }))
    expect(groups.needs).toHaveLength(1)
    expect(groups.needs[0].kind).toBe('permission')
    expect(groups.needs[0].title).toBe('Allow Bash?')
  })

  it('classifies a question-shaped interactivePrompt as question, using its text', () => {
    const entry = makeEntry({
      paneKey: paneKey(),
      state: 'blocked',
      interactivePrompt: JSON.stringify({
        questions: [{ question: 'Pick a color', options: ['red', 'blue'] }]
      })
    })
    const groups = deriveInboxItems(baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry } }))
    expect(groups.needs[0]).toMatchObject({ kind: 'question', title: 'Pick a color' })
  })

  it('puts a fresh working entry into waiting as running', () => {
    const entry = makeEntry({ paneKey: paneKey(), state: 'working', toolName: 'Edit' })
    const groups = deriveInboxItems(baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry } }))
    expect(groups.waiting).toHaveLength(1)
    expect(groups.waiting[0].kind).toBe('running')
  })

  it('puts a stale non-done entry with a live pty into waiting as unverifiable', () => {
    const entry = makeEntry({
      paneKey: paneKey(),
      state: 'working',
      updatedAt: NOW - AGENT_STATUS_STALE_AFTER_MS - 1
    })
    const groups = deriveInboxItems(
      baseInput({
        agentStatusByPaneKey: { [entry.paneKey]: entry },
        ptyIdsByTabId: { [TAB_ID]: ['pty-1'] }
      })
    )
    expect(groups.waiting).toHaveLength(1)
    expect(groups.waiting[0].kind).toBe('unverifiable')
  })

  it('drops a stale non-done entry with no live pty (idle)', () => {
    const entry = makeEntry({
      paneKey: paneKey(),
      state: 'working',
      updatedAt: NOW - AGENT_STATUS_STALE_AFTER_MS - 1
    })
    const groups = deriveInboxItems(baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry } }))
    expect(groups.needs).toHaveLength(0)
    expect(groups.waiting).toHaveLength(0)
    expect(groups.done).toHaveLength(0)
  })

  it('puts a recent, non-interrupted done entry into done', () => {
    const entry = makeEntry({
      paneKey: paneKey(),
      state: 'done',
      stateStartedAt: NOW - 1_000,
      lastCompletedAssistantMessage: 'All set.'
    })
    const groups = deriveInboxItems(baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry } }))
    expect(groups.done).toHaveLength(1)
    expect(groups.done[0]).toMatchObject({ kind: 'done', title: 'All set.' })
  })

  it('drops an interrupted done entry', () => {
    const entry = makeEntry({
      paneKey: paneKey(),
      state: 'done',
      stateStartedAt: NOW - 1_000,
      interrupted: true
    })
    const groups = deriveInboxItems(baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry } }))
    expect(groups.done).toHaveLength(0)
  })

  it('drops a done entry older than the stale window', () => {
    const entry = makeEntry({
      paneKey: paneKey(),
      state: 'done',
      stateStartedAt: NOW - AGENT_STATUS_STALE_AFTER_MS - 1
    })
    const groups = deriveInboxItems(baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry } }))
    expect(groups.done).toHaveLength(0)
  })

  it('sorts needs freshest (most recently entered) first', () => {
    const older = makeEntry({
      paneKey: paneKey(LEAF_1),
      state: 'blocked',
      stateStartedAt: NOW - 10_000
    })
    const newer = makeEntry({
      paneKey: paneKey(LEAF_2),
      state: 'blocked',
      stateStartedAt: NOW - 1_000
    })
    const groups = deriveInboxItems(
      baseInput({
        agentStatusByPaneKey: { [older.paneKey]: older, [newer.paneKey]: newer },
        tabsByWorktree: { [worktree.id]: [makeTab()] }
      })
    )
    expect(groups.needs.map((i) => i.paneKey)).toEqual([newer.paneKey, older.paneKey])
  })

  it('caps done at 20, newest first', () => {
    const entries: Record<string, AgentStatusEntry> = {}
    const tabs: TerminalTab[] = []
    for (let i = 0; i < 25; i++) {
      const tabId = `tab-${i}`
      tabs.push(makeTab({ id: tabId }))
      const entry = makeEntry({
        paneKey: `${tabId}:${LEAF_1}`,
        state: 'done',
        stateStartedAt: NOW - i * 1_000
      })
      entries[entry.paneKey] = entry
    }
    const groups = deriveInboxItems(
      baseInput({ agentStatusByPaneKey: entries, tabsByWorktree: { [worktree.id]: tabs } })
    )
    expect(groups.done).toHaveLength(20)
    expect(groups.done[0].paneKey).toBe(`tab-0:${LEAF_1}`)
  })

  it('attaches a diff only when a branch line total exists for the worktree', () => {
    const entry = makeEntry({ paneKey: paneKey(), state: 'blocked' })
    const withDiff = deriveInboxItems(
      baseInput({
        agentStatusByPaneKey: { [entry.paneKey]: entry },
        branchLineTotalByWorktree: { [worktree.id]: { added: 12, removed: 3, mergeBase: 'abc' } }
      })
    )
    expect(withDiff.needs[0].diff).toEqual({ added: 12, removed: 3 })

    const withoutDiff = deriveInboxItems(
      baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry } })
    )
    expect(withoutDiff.needs[0].diff).toBeUndefined()
  })

  it('falls back to the entry worktreeId when no tab maps the pane', () => {
    const entry = makeEntry({ paneKey: paneKey(), state: 'blocked', worktreeId: worktree.id })
    const groups = deriveInboxItems(
      baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry }, tabsByWorktree: {} })
    )
    expect(groups.needs).toHaveLength(1)
    expect(groups.needs[0].worktreeId).toBe(worktree.id)
  })

  it('drops an entry whose worktree is unknown', () => {
    const entry = makeEntry({ paneKey: paneKey(), state: 'blocked' })
    const groups = deriveInboxItems(
      baseInput({ agentStatusByPaneKey: { [entry.paneKey]: entry }, worktrees: [] })
    )
    expect(groups.needs).toHaveLength(0)
  })
})
