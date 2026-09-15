import { describe, expect, it } from 'vitest'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { defaultLaunchModel, resizeLaunchSlots } from './LaunchAgentSlots'

const CLAUDE = 'claude' as TuiAgent
const CODEX = 'codex' as TuiAgent

describe('resizeLaunchSlots', () => {
  it('starts every new agent on the default model', () => {
    const slots = resizeLaunchSlots([], 2, CLAUDE)
    expect(slots).toEqual([
      { agent: CLAUDE, model: defaultLaunchModel(CLAUDE) },
      { agent: CLAUDE, model: defaultLaunchModel(CLAUDE) }
    ])
  })

  it('keeps each agent’s own picks when the count grows, copying the last one', () => {
    const picked = [
      { agent: CLAUDE, model: 'opus' },
      { agent: CODEX, model: 'gpt-5' }
    ]
    expect(resizeLaunchSlots(picked, 4, CLAUDE)).toEqual([
      ...picked,
      { agent: CODEX, model: 'gpt-5' },
      { agent: CODEX, model: 'gpt-5' }
    ])
  })

  it('drops agents from the end when the count shrinks', () => {
    const picked = [
      { agent: CLAUDE, model: 'opus' },
      { agent: CLAUDE, model: 'haiku' },
      { agent: CODEX, model: null }
    ]
    expect(resizeLaunchSlots(picked, 1, CLAUDE)).toEqual([{ agent: CLAUDE, model: 'opus' }])
  })

  it('creates nothing when no agent CLI is available', () => {
    expect(resizeLaunchSlots([], 3, null)).toEqual([])
  })
})
