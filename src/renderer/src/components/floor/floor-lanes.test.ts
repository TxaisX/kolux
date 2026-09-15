import { describe, expect, it } from 'vitest'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { buildFloorLanes } from './floor-lanes'
import type { FloorTabInput, FloorWorktreeInput } from './floor-types'

const NOW = 1_000_000
const MIN = 60_000

const ROOT_PANE = makePaneKey('tab-root', '11111111-1111-4111-8111-111111111111')
const CHILD_PANE = makePaneKey('tab-child', '22222222-2222-4222-8222-222222222222')
const OTHER_HOST_PANE = makePaneKey('tab-other', '33333333-3333-4333-8333-333333333333')

function makeEntry(overrides: Partial<AgentStatusEntry> & { paneKey: string }): AgentStatusEntry {
  return {
    state: 'working',
    prompt: '',
    updatedAt: NOW,
    stateStartedAt: NOW,
    stateHistory: [],
    agentType: 'claude',
    tabId: 'tab-root',
    worktreeId: 'wt-1',
    ...overrides
  }
}

const WORKTREE_LOCAL: FloorWorktreeInput = {
  id: 'wt-1',
  repoId: 'repo-1',
  repoName: 'nightshift',
  name: 'fix-guard',
  branch: 'fix-guard',
  hostId: 'local',
  hostLabel: 'Local Windows',
  hostLive: true
}

const WORKTREE_SSH: FloorWorktreeInput = {
  id: 'wt-2',
  repoId: 'repo-1',
  repoName: 'nightshift',
  name: 'remote-task',
  branch: 'remote-task',
  hostId: 'ssh:box',
  hostLabel: 'box',
  hostLive: false
}

const TAB_ROOT: FloorTabInput = { id: 'tab-root', worktreeId: 'wt-1', title: 'fix-guard' }
const TAB_CHILD: FloorTabInput = { id: 'tab-child', worktreeId: 'wt-1', title: 'worker' }
const TAB_OTHER: FloorTabInput = { id: 'tab-other', worktreeId: 'wt-2', title: 'remote-task' }

function build(
  statuses: Record<string, AgentStatusEntry>,
  overrides: Partial<Parameters<typeof buildFloorLanes>[0]> = {}
): ReturnType<typeof buildFloorLanes> {
  return buildFloorLanes({
    statuses,
    tabsById: { [TAB_ROOT.id]: TAB_ROOT, [TAB_CHILD.id]: TAB_CHILD, [TAB_OTHER.id]: TAB_OTHER },
    worktreesById: { [WORKTREE_LOCAL.id]: WORKTREE_LOCAL, [WORKTREE_SSH.id]: WORKTREE_SSH },
    range: '60m',
    now: NOW,
    ...overrides
  })
}

describe('buildFloorLanes', () => {
  it('builds one open segment for an entry with no history, running to now', () => {
    const result = build({
      [ROOT_PANE]: makeEntry({ paneKey: ROOT_PANE, state: 'working', stateStartedAt: NOW - 5 * MIN })
    })
    expect(result.hosts).toHaveLength(1)
    const [lane] = result.hosts[0].lanes
    expect(lane.segments).toEqual([
      expect.objectContaining({ start: NOW - 5 * MIN, end: NOW, kind: 'working' })
    ])
  })

  it('turns stateHistory into consecutive segments, mapping blocked/waiting to needs', () => {
    const entry = makeEntry({
      paneKey: ROOT_PANE,
      state: 'done',
      stateStartedAt: NOW - 5 * MIN,
      stateHistory: [
        { state: 'working', prompt: '', startedAt: NOW - 30 * MIN },
        { state: 'blocked', prompt: '', startedAt: NOW - 20 * MIN },
        { state: 'waiting', prompt: '', startedAt: NOW - 10 * MIN }
      ]
    })
    const result = build({ [ROOT_PANE]: entry })
    const [lane] = result.hosts[0].lanes
    expect(lane.segments.map((s) => s.kind)).toEqual(['working', 'needs', 'needs', 'done'])
    expect(lane.segments.map((s) => [s.start, s.end])).toEqual([
      [NOW - 30 * MIN, NOW - 20 * MIN],
      [NOW - 20 * MIN, NOW - 10 * MIN],
      [NOW - 10 * MIN, NOW - 5 * MIN],
      [NOW - 5 * MIN, NOW]
    ])
  })

  it('clamps segments to the visible range and drops ones entirely outside it', () => {
    const entry = makeEntry({
      paneKey: ROOT_PANE,
      state: 'working',
      // The current segment itself starts before the 60m window, so it must
      // be clamped flush to range.start rather than starting mid-track.
      stateStartedAt: NOW - 90 * MIN,
      stateHistory: [{ state: 'done', prompt: '', startedAt: NOW - 200 * MIN }]
    })
    const result = build({ [ROOT_PANE]: entry }, { range: '60m' })
    const [lane] = result.hosts[0].lanes
    // The 'done' segment (spans now-200m..now-90m) is entirely before
    // range.start (now-60m) and is dropped rather than clamped to zero width.
    expect(lane.segments).toHaveLength(1)
    expect(lane.segments[0]).toMatchObject({ start: NOW - 60 * MIN, end: NOW, kind: 'working' })
  })

  it('resolves unverifiable vs idle for a stale non-done state by live-PTY evidence', () => {
    const staleEntry = makeEntry({
      paneKey: ROOT_PANE,
      state: 'working',
      stateStartedAt: NOW - 40 * MIN,
      updatedAt: NOW - 40 * MIN
    })
    const withLivePty = build(
      { [ROOT_PANE]: staleEntry },
      { ptyIdsByTabId: { 'tab-root': ['pty-1'] } }
    )
    expect(withLivePty.hosts[0].lanes[0].state).toBe('unverifiable')

    const withoutLivePty = build({ [ROOT_PANE]: staleEntry }, { ptyIdsByTabId: {} })
    expect(withoutLivePty.hosts[0].lanes[0].state).toBe('idle')
  })

  it('nests a child under its parent within the same host, leaving orphans top-level', () => {
    const root = makeEntry({ paneKey: ROOT_PANE, tabId: 'tab-root' })
    const child = makeEntry({
      paneKey: CHILD_PANE,
      tabId: 'tab-child',
      orchestration: { taskId: 't1', dispatchId: 'd1', parentPaneKey: ROOT_PANE, taskTitle: 'worker 1' }
    })
    const orphan = makeEntry({
      paneKey: OTHER_HOST_PANE,
      tabId: 'tab-other',
      worktreeId: 'wt-2',
      orchestration: { taskId: 't2', dispatchId: 'd2', parentPaneKey: ROOT_PANE }
    })
    const result = build({ [ROOT_PANE]: root, [CHILD_PANE]: child, [OTHER_HOST_PANE]: orphan })

    const local = result.hosts.find((h) => h.hostId === 'local')
    expect(local?.lanes).toHaveLength(1)
    expect(local?.lanes[0].children).toHaveLength(1)
    expect(local?.lanes[0].children[0].paneKey).toBe(CHILD_PANE)
    expect(local?.lanes[0].children[0].role).toBe('worker 1')

    // Different host than its parent: stays top-level there instead of vanishing.
    const ssh = result.hosts.find((h) => h.hostId === 'ssh:box')
    expect(ssh?.lanes).toHaveLength(1)
    expect(ssh?.lanes[0].paneKey).toBe(OTHER_HOST_PANE)
  })

  it('drops a lane with no resolvable worktree', () => {
    const entry = makeEntry({ paneKey: ROOT_PANE, worktreeId: 'wt-missing', tabId: 'tab-root' })
    const result = build({ [ROOT_PANE]: entry })
    expect(result.hosts).toHaveLength(0)
  })

  it('orders hosts local-first, then alphabetically', () => {
    const local = makeEntry({ paneKey: ROOT_PANE, tabId: 'tab-root' })
    const ssh = makeEntry({ paneKey: OTHER_HOST_PANE, tabId: 'tab-other', worktreeId: 'wt-2' })
    const result = build({ [ROOT_PANE]: local, [OTHER_HOST_PANE]: ssh })
    expect(result.hosts.map((h) => h.hostId)).toEqual(['local', 'ssh:box'])
  })
})
