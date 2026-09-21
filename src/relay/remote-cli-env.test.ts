import { describe, expect, it } from 'vitest'
import { pickRemoteCliEnv } from './remote-cli-env'

describe('pickRemoteCliEnv', () => {
  it('forwards SSH Kolux terminal and worktree context for remote CLI calls', () => {
    expect(
      pickRemoteCliEnv({
        KOLUX_TERMINAL_HANDLE: 'term_ssh',
        KOLUX_WORKTREE_ID: 'repo::remote',
        KOLUX_PANE_KEY: 'pane-1',
        KOLUX_AGENT_LAUNCH_TOKEN: 'launch-secret',
        KOLUX_WORKSPACE_ID: 'workspace-1',
        KOLUX_USER_DATA_PATH: '/tmp/kolux',
        PATH: '/usr/bin',
        SECRET_TOKEN: 'nope'
      })
    ).toEqual({
      KOLUX_TERMINAL_HANDLE: 'term_ssh',
      KOLUX_WORKTREE_ID: 'repo::remote',
      KOLUX_PANE_KEY: 'pane-1',
      KOLUX_AGENT_LAUNCH_TOKEN: 'launch-secret',
      KOLUX_WORKSPACE_ID: 'workspace-1',
      KOLUX_USER_DATA_PATH: '/tmp/kolux',
      PATH: '/usr/bin'
    })
  })
})
