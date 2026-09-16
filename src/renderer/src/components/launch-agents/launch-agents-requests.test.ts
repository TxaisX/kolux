import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { Repo } from '../../../../shared/repo-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  buildLaunchAgentsRequests,
  buildSharedCheckoutSeatRequests,
  isNewWorktreeIsolationAvailable,
  resizeLaunchSlots,
  retargetLaunchSlots,
  type LaunchAgentSlot
} from './launch-agents-requests'

const CLAUDE = 'claude' as TuiAgent
const CODEX = 'codex' as TuiAgent
const gitRepo = { id: 'repo-1', path: 'C:/src/app', displayName: 'app', kind: 'git' } as Repo
const folderRepo = {
  id: 'repo-2',
  path: 'C:/src/folder',
  displayName: 'folder',
  kind: 'folder'
} as Repo

function build(slots: LaunchAgentSlot[], existing: string[] = []) {
  return buildLaunchAgentsRequests({
    repo: gitRepo,
    settings: getDefaultSettings('C:/Users/test'),
    prompt: 'ship it',
    slots,
    setupDecision: 'skip',
    worktreesByRepo: { [gitRepo.id]: existing.map((name) => ({ path: `C:/wt/${name}` })) }
  })
}

const claudeSlots = (count: number, model: string | null = null): LaunchAgentSlot[] =>
  Array.from({ length: count }, () => ({ agent: CLAUDE, model }))

describe('buildLaunchAgentsRequests', () => {
  it('pins every request to the terminal-tui launch route, never a chat route', () => {
    for (const request of build(claudeSlots(5))) {
      expect(request.agentLaunchRoute).toBe('terminal-tui')
    }
  })

  it('accepts a wave far larger than the old per-agent cap — there is no ceiling', () => {
    const requests = build(claudeSlots(20))
    expect(requests).toHaveLength(20)
    expect(requests.every((request) => request.agentLaunchRoute === 'terminal-tui')).toBe(true)
  })

  it('gives every seat its own worktree name, never reusing one that already exists', () => {
    const first = build(claudeSlots(6)).map((request) => request.name)
    expect(new Set(first).size).toBe(6)
    const second = build(claudeSlots(6), first).map((request) => request.name)
    expect(second.filter((name) => first.includes(name))).toEqual([])
  })

  it('opens each seat on its own chosen model', () => {
    const requests = build([
      { agent: CLAUDE, model: 'opus' },
      { agent: CLAUDE, model: 'haiku' },
      { agent: CLAUDE, model: null }
    ])
    // Why: the launcher shell-quotes each argument, so match across the quoting.
    expect(requests[0]?.startupPlan?.launchCommand).toMatch(/--model\W+opus\b/)
    expect(requests[1]?.startupPlan?.launchCommand).toMatch(/--model\W+haiku\b/)
    expect(requests[2]?.startupPlan?.launchCommand).not.toContain('--model')
  })

  it('carries the shared prompt onto every seat', () => {
    for (const request of build(claudeSlots(3))) {
      expect(request.quickPrompt).toBe('ship it')
    }
  })
})

describe('buildSharedCheckoutSeatRequests', () => {
  it('pins every seat to the terminal-tui launch route', () => {
    const seats = buildSharedCheckoutSeatRequests({
      slots: [
        { agent: CLAUDE, model: 'opus' },
        { agent: CODEX, model: null }
      ],
      prompt: 'ship it'
    })
    expect(seats).toHaveLength(2)
    expect(seats.every((seat) => seat.agentLaunchRoute === 'terminal-tui')).toBe(true)
  })

  it('trims and shares the prompt across every seat, with no per-seat role prefix', () => {
    const seats = buildSharedCheckoutSeatRequests({
      slots: [{ agent: CLAUDE, model: null }],
      prompt: '  ship it  '
    })
    expect(seats[0]?.prompt).toBe('ship it')
  })
})

describe('resizeLaunchSlots', () => {
  it('grows by copying the last slot', () => {
    const grown = resizeLaunchSlots([{ agent: CLAUDE, model: 'opus' }], 3, CLAUDE)
    expect(grown).toEqual([
      { agent: CLAUDE, model: 'opus' },
      { agent: CLAUDE, model: 'opus' },
      { agent: CLAUDE, model: 'opus' }
    ])
  })

  it('shrinks by truncating', () => {
    const shrunk = resizeLaunchSlots(
      [
        { agent: CLAUDE, model: 'opus' },
        { agent: CLAUDE, model: 'haiku' }
      ],
      1,
      CLAUDE
    )
    expect(shrunk).toEqual([{ agent: CLAUDE, model: 'opus' }])
  })

  it('accepts a target well above any previous cap', () => {
    expect(resizeLaunchSlots([], 20, CLAUDE)).toHaveLength(20)
  })
})

describe('retargetLaunchSlots', () => {
  it('re-points every slot at the newly picked agent', () => {
    const retargeted = retargetLaunchSlots(
      [
        { agent: CLAUDE, model: 'opus' },
        { agent: CLAUDE, model: 'haiku' }
      ],
      CODEX
    )
    expect(retargeted.every((slot) => slot.agent === CODEX)).toBe(true)
  })
})

describe('isolation mode', () => {
  it('offers new-worktree isolation for a git repo', () => {
    expect(isNewWorktreeIsolationAvailable(gitRepo)).toBe(true)
  })

  it('disables new-worktree isolation for a non-git folder workspace', () => {
    expect(isNewWorktreeIsolationAvailable(folderRepo)).toBe(false)
  })
})
