import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { Repo } from '../../../../shared/repo-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  launchAgentHandoffPath,
  stripLaunchAgentBrief
} from '../../../../shared/launch-agent-brief'
import {
  buildLaunchAgentsRequests,
  LAUNCH_AGENTS_MAX,
  type LaunchAgentSlot
} from './launch-agents-requests'

const CLAUDE = 'claude' as TuiAgent
const repo = { id: 'repo-1', path: 'C:/src/app', displayName: 'app', kind: 'git' } as Repo

function build(slots: LaunchAgentSlot[], existing: string[] = []) {
  return buildLaunchAgentsRequests({
    repo,
    settings: getDefaultSettings('C:/Users/test'),
    prompt: 'ship it',
    slots,
    setupDecision: 'skip',
    worktreesByRepo: { [repo.id]: existing.map((name) => ({ path: `C:/wt/${name}` })) }
  })
}

const claudeSlots = (count: number, model: string | null = null): LaunchAgentSlot[] =>
  Array.from({ length: count }, () => ({ agent: CLAUDE, model }))

describe('buildLaunchAgentsRequests', () => {
  it('gives every agent in a full wave its own worktree', () => {
    const names = build(claudeSlots(LAUNCH_AGENTS_MAX)).map((request) => request.name)
    expect(names).toHaveLength(LAUNCH_AGENTS_MAX)
    expect(new Set(names).size).toBe(LAUNCH_AGENTS_MAX)
  })

  it('never reuses a worktree name that already exists', () => {
    const first = build(claudeSlots(LAUNCH_AGENTS_MAX)).map((request) => request.name)
    const second = build(claudeSlots(LAUNCH_AGENTS_MAX), first).map((request) => request.name)
    expect(second.filter((name) => first.includes(name))).toEqual([])
  })

  it('refuses to launch more than the cap', () => {
    expect(build(claudeSlots(LAUNCH_AGENTS_MAX + 3))).toHaveLength(LAUNCH_AGENTS_MAX)
  })

  it('opens each session on its own chosen model', () => {
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

  it('gives every session the rules and its own handoff file, after the task', () => {
    for (const request of build(claudeSlots(2))) {
      expect(request.quickPrompt.startsWith('ship it')).toBe(true)
      expect(request.quickPrompt).toContain('context7')
      expect(request.quickPrompt).toContain(launchAgentHandoffPath(request.name))
      expect(stripLaunchAgentBrief(request.quickPrompt)).toBe('ship it')
    }
  })
})
