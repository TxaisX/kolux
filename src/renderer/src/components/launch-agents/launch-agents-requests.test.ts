import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import type { Repo } from '../../../../shared/repo-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import {
  buildLaunchAgentsRequests,
  CONTEXT7_AUDIT_BRIEF,
  LAUNCH_AGENTS_MAX
} from './launch-agents-requests'

const CLAUDE = 'claude' as TuiAgent
const repo = { id: 'repo-1', path: 'C:/src/app', displayName: 'app', kind: 'git' } as Repo

function build(count: number, existing: string[] = [], model: string | null = null) {
  return buildLaunchAgentsRequests({
    repo,
    settings: getDefaultSettings('C:/Users/test'),
    prompt: 'ship it',
    agents: Array.from({ length: count }, () => CLAUDE),
    model,
    setupDecision: 'skip',
    worktreesByRepo: { [repo.id]: existing.map((name) => ({ path: `C:/wt/${name}` })) }
  })
}

describe('buildLaunchAgentsRequests', () => {
  it('gives every agent in a full wave its own worktree', () => {
    const names = build(LAUNCH_AGENTS_MAX).map((request) => request.name)
    expect(names).toHaveLength(LAUNCH_AGENTS_MAX)
    expect(new Set(names).size).toBe(LAUNCH_AGENTS_MAX)
  })

  it('never reuses a worktree name that already exists', () => {
    const first = build(LAUNCH_AGENTS_MAX).map((request) => request.name)
    const second = build(LAUNCH_AGENTS_MAX, first).map((request) => request.name)
    expect(second.filter((name) => first.includes(name))).toEqual([])
  })

  it('refuses to launch more than the cap', () => {
    expect(build(LAUNCH_AGENTS_MAX + 3)).toHaveLength(LAUNCH_AGENTS_MAX)
  })

  it('opens every session on the chosen model', () => {
    for (const request of build(3, [], 'opus')) {
      // Why: the launcher shell-quotes each argument, so match across the quoting.
      expect(request.startupPlan?.launchCommand).toMatch(/--model\W+opus\b/)
    }
  })

  it('leaves the model to the agent when none is chosen', () => {
    expect(build(1)[0]?.startupPlan?.launchCommand).not.toContain('--model')
  })

  it('tells every session to audit its work against context7', () => {
    for (const request of build(2)) {
      expect(request.quickPrompt.startsWith(CONTEXT7_AUDIT_BRIEF)).toBe(true)
      expect(request.quickPrompt.endsWith('ship it')).toBe(true)
    }
  })
})
