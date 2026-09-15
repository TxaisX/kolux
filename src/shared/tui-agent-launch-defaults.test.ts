import { describe, expect, it } from 'vitest'
import { applyAgentPermissionModeOverride } from './tui-agent-launch-defaults'

describe('applyAgentPermissionModeOverride', () => {
  it('replaces args/env with the agent YOLO shape in yolo mode', () => {
    expect(applyAgentPermissionModeOverride('claude', 'yolo', '', {})).toEqual({
      agentArgs: '--dangerously-skip-permissions',
      agentEnv: {}
    })
    expect(applyAgentPermissionModeOverride('goose', 'yolo', '', {})).toEqual({
      agentArgs: '',
      agentEnv: { GOOSE_MODE: 'auto' }
    })
  })

  it('strips only the YOLO flag/env in manual mode, keeping other args/env', () => {
    expect(
      applyAgentPermissionModeOverride(
        'claude',
        'manual',
        '--dangerously-skip-permissions --model opus',
        {}
      )
    ).toEqual({ agentArgs: '--model opus', agentEnv: {} })
    expect(
      applyAgentPermissionModeOverride('goose', 'manual', '', {
        GOOSE_MODE: 'auto',
        OTHER: 'kept'
      })
    ).toEqual({ agentArgs: '', agentEnv: { OTHER: 'kept' } })
  })

  it('is a no-op in manual mode when the YOLO flag is already absent', () => {
    expect(applyAgentPermissionModeOverride('claude', 'manual', '--model opus', {})).toEqual({
      agentArgs: '--model opus',
      agentEnv: {}
    })
  })
})
