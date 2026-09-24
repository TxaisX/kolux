import { afterEach, describe, expect, it } from 'vitest'
import { makePaneKey } from '../../shared/stable-pane-id'
import { AgentHookServer } from './server'

const PANE = makePaneKey('tab-mimo-code', '11111111-1111-4111-8111-111111111111')

describe('AgentHookServer MiMo Code lifecycle', () => {
  const servers: AgentHookServer[] = []

  afterEach(() => {
    for (const server of servers) {
      server.stop()
    }
    servers.length = 0
  })

  async function setup(): Promise<{
    server: AgentHookServer
    post: (payload: Record<string, unknown>, launchToken: string) => Promise<Response>
  }> {
    const server = new AgentHookServer()
    servers.push(server)
    await server.start({ env: 'production' })
    const env = server.buildPtyEnv()
    return {
      server,
      post: (payload, launchToken) =>
        fetch(`http://127.0.0.1:${env.KOLUX_AGENT_HOOK_PORT}/hook/mimo-code`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Kolux-Agent-Hook-Token': env.KOLUX_AGENT_HOOK_TOKEN
          },
          body: JSON.stringify({
            paneKey: PANE,
            launchToken,
            tabId: 'tab-mimo-code',
            worktreeId: 'wt-mimo-code',
            env: 'production',
            payload
          })
        })
    }
  }

  it('restarts a retired mimo-code pane on an explicit user prompt', async () => {
    const { server, post } = await setup()
    await post({ hook_event_name: 'SessionBusy', sessionID: 'old' }, 'old-token')
    server.retirePaneAuthority(PANE)

    // Why: mimo-code emits no SessionStart, so the explicit prompt is its only restart
    // boundary — excluding it would strand every retired mimo-code pane.
    await post(
      {
        hook_event_name: 'MessagePart',
        role: 'user',
        text: 'continue the task',
        messageID: 'message-resumed',
        sessionID: 'resumed'
      },
      'resume-token'
    )

    expect(server.getStatusSnapshot()).toEqual([
      expect.objectContaining({ state: 'working', prompt: 'continue the task' })
    ])
  })
})
