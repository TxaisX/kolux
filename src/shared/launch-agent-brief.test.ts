import { describe, expect, it } from 'vitest'
import {
  composeLaunchAgentPrompt,
  launchAgentHandoffPath,
  stripLaunchAgentBrief
} from './launch-agent-brief'

describe('launch agent brief', () => {
  it('puts the task first and the rules after it', () => {
    const prompt = composeLaunchAgentPrompt('  fix the login bug  ', 'anhinga')
    expect(prompt.startsWith('fix the login bug\n\n<nightshift-launch-brief>')).toBe(true)
    expect(prompt).toContain('context7')
  })

  it('gives each agent a handoff file named after its own worktree', () => {
    expect(composeLaunchAgentPrompt('x', 'bonefish')).toContain(launchAgentHandoffPath('bonefish'))
    expect(launchAgentHandoffPath('bonefish')).toBe('.nightshift/handoffs/bonefish.md')
  })

  it('carries a role brief inside the rules so it never names the branch', () => {
    const prompt = composeLaunchAgentPrompt('ship it', 'danio', 'You are the REVIEWER.')
    expect(stripLaunchAgentBrief(prompt)).toBe('ship it')
  })

  it('leaves nothing to name a branch from when there is no task', () => {
    expect(stripLaunchAgentBrief(composeLaunchAgentPrompt('   ', 'melusine'))).toBe('')
  })

  it('leaves ordinary prompts untouched', () => {
    expect(stripLaunchAgentBrief('rename the settings page')).toBe('rename the settings page')
  })
})
