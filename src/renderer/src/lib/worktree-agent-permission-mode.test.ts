import { describe, expect, it } from 'vitest'
import { YOLO_TUI_AGENT_ARGS, YOLO_TUI_AGENT_ENV } from '../../../shared/tui-agent-permissions'
import { resolveWorktreeAgentPermissionMode } from './worktree-agent-permission-mode'

// Why: a real hydrated GlobalSettings pre-fills agentDefaultArgs/Env with YOLO_TUI_AGENT_ARGS/ENV
// (default-global-settings.ts) — an empty/absent map means "no settings loaded yet", which
// the shared summary treats as manual, not an implicit yolo default.
const globalYoloDefaultArgs = { ...YOLO_TUI_AGENT_ARGS }
const globalYoloDefaultEnv = { ...YOLO_TUI_AGENT_ENV }

describe('resolveWorktreeAgentPermissionMode', () => {
  it('returns the explicit per-worktree override when set', () => {
    expect(
      resolveWorktreeAgentPermissionMode(
        { agentPermissionModeByWorktree: { 'wt-1': 'manual' }, settings: null },
        'wt-1'
      )
    ).toBe('manual')
  })

  it('falls back to the global default mode when no override exists', () => {
    expect(
      resolveWorktreeAgentPermissionMode(
        {
          agentPermissionModeByWorktree: {},
          settings: { agentDefaultArgs: globalYoloDefaultArgs, agentDefaultEnv: globalYoloDefaultEnv }
        },
        'wt-1'
      )
    ).toBe('yolo')
  })

  it('falls back to manual when settings are not yet loaded', () => {
    expect(
      resolveWorktreeAgentPermissionMode(
        { agentPermissionModeByWorktree: {}, settings: null },
        'wt-1'
      )
    ).toBe('manual')
  })

  it('treats a mixed global default as manual for the fallback', () => {
    expect(
      resolveWorktreeAgentPermissionMode(
        {
          agentPermissionModeByWorktree: {},
          settings: {
            agentDefaultArgs: { ...globalYoloDefaultArgs, claude: '--custom-flag' },
            agentDefaultEnv: globalYoloDefaultEnv
          }
        },
        'wt-1'
      )
    ).toBe('manual')
  })

  it('ignores the global default for a different worktree once an override exists', () => {
    expect(
      resolveWorktreeAgentPermissionMode(
        {
          agentPermissionModeByWorktree: { 'wt-1': 'manual' },
          settings: { agentDefaultArgs: globalYoloDefaultArgs, agentDefaultEnv: globalYoloDefaultEnv }
        },
        'wt-2'
      )
    ).toBe('yolo')
  })
})
