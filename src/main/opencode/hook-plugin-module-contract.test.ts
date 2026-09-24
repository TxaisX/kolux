import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { getPathMock } = vi.hoisted(() => ({
  getPathMock: vi.fn<(name: string) => string>()
}))

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock
  }
}))

import { _internals } from './hook-service'

/**
 * OpenCode resolves a plugin file through a named factory export or through the module
 * default export, and the two generations call different members of that default:
 * 1.18.18 only ever calls `server()` (rejecting `{ id, setup }` with
 * `failed to load plugin … must default export an object with server()`), while 2.x only
 * ever calls `setup()` (rejecting `{ id, server }` with
 * `Missing key at ["default"]["setup"] Missing key at ["default"]["effect"]` — the error
 * that surfaced as "Plugin failed: …kolux-opencode-status.js"). These tests execute the
 * generated module against both loaders, not a substring match.
 */
describe('OpenCode status plugin module contract', () => {
  type PluginHooks = {
    event: (input: { event: unknown }) => Promise<void>
    dispose?: () => Promise<void>
  }
  type PluginCleanup = () => Promise<void>
  type V2Event = { type: string; data?: Record<string, unknown> }
  type PluginModule = {
    default?: {
      id?: unknown
      server?: (ctx: unknown) => Promise<PluginHooks>
      setup?: (ctx: unknown) => Promise<PluginCleanup>
    }
    KoluxOpenCodeStatusPlugin?: (ctx: unknown) => Promise<PluginHooks>
  }

  // Why: the plugin resolves hook coords from the endpoint file first and only then from
  // env. Pin every input here so the run does not depend on the developer's Kolux session
  // (an inherited KOLUX_AGENT_HOOK_ENDPOINT would otherwise redirect the post to a live app).
  const ENV_KEYS = [
    'KOLUX_PANE_KEY',
    'KOLUX_AGENT_HOOK_ENDPOINT',
    'KOLUX_AGENT_HOOK_PORT',
    'KOLUX_AGENT_HOOK_TOKEN'
  ] as const

  let tempDir: string
  let savedFetch: typeof globalThis.fetch
  let savedEnv: Record<string, string | undefined>

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'kolux-opencode-plugin-contract-'))
    savedFetch = globalThis.fetch
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
    }
    delete process.env.KOLUX_AGENT_HOOK_ENDPOINT
    process.env.KOLUX_AGENT_HOOK_PORT = '59999'
    process.env.KOLUX_AGENT_HOOK_TOKEN = 'test-token'
  })

  afterEach(() => {
    globalThis.fetch = savedFetch
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  async function loadPluginModule(): Promise<PluginModule> {
    // Why: a unique basename per load defeats the ESM module cache between cases.
    const pluginPath = join(
      tempDir,
      `kolux-opencode-status-${Math.random().toString(36).slice(2)}.mjs`
    )
    writeFileSync(pluginPath, _internals.getOpenCodePluginSource())
    return (await import(pathToFileURL(pluginPath).href)) as PluginModule
  }

  it('exposes a default export carrying a string id and both generation entry points', async () => {
    const module = await loadPluginModule()

    expect(module.default).toBeTypeOf('object')
    expect(typeof module.default?.id).toBe('string')
    expect(module.default?.id).toBe('kolux-opencode-status')
    expect(module.default?.server).toBeTypeOf('function')
    expect(module.default?.setup).toBeTypeOf('function')
  })

  it('keeps setup(), the member OpenCode 2.x validates the default export against', async () => {
    const module = await loadPluginModule()

    // Why: 2.x schema-rejects the module without this key, which is the whole
    // "Plugin failed: …kolux-opencode-status.js" symptom — pin its presence.
    expect(module.default).not.toBeUndefined()
    expect(Object.hasOwn(module.default ?? {}, 'setup')).toBe(true)
    expect(Object.hasOwn(module.default ?? {}, 'server')).toBe(true)
  })

  it('keeps the named factory export so the factory-based loader still resolves', async () => {
    const module = await loadPluginModule()

    expect(module.KoluxOpenCodeStatusPlugin).toBeTypeOf('function')
  })

  it('returns an event handler from the default export server(), like the named factory', async () => {
    const module = await loadPluginModule()

    const fromDefault = await module.default?.server?.({})
    const fromNamed = await module.KoluxOpenCodeStatusPlugin?.({})

    expect(fromDefault?.event).toBeTypeOf('function')
    expect(fromNamed?.event).toBeTypeOf('function')
  })

  async function setupThroughV2(v2Events: V2Event[]): Promise<{
    cleanup: PluginCleanup
    hookPosts: { url: string; body: any }[]
    posts: { url: string; body: any }[]
  }> {
    const posts: { url: string; body: any }[] = []
    globalThis.fetch = vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      posts.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) })
      return { ok: true } as Response
    }) as unknown as typeof globalThis.fetch

    const module = await loadPluginModule()
    // Why: V2 `session.get` returns the session itself (1.x wrapped it in `{ data }`),
    // and a root session must pass the child-session filter or every event is dropped.
    const cleanup = await module.default?.setup?.({
      session: { get: async () => ({ id: 'ses_root', parentID: undefined }) },
      event: {
        subscribe: () =>
          (async function* () {
            for (const event of v2Events) yield event
          })()
      }
    })
    // Why: lifecycle delivery is queued; let the plugin's FIFO drain before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50))
    return {
      cleanup: cleanup ?? (async () => {}),
      posts,
      hookPosts: posts.filter((post) => post.url.includes('/hook/opencode'))
    }
  }

  it('drives V2 events through setup() and posts lifecycle, preview and idle', async () => {
    process.env.KOLUX_PANE_KEY = 'tab-1:leaf-1'

    const { cleanup, hookPosts } = await setupThroughV2([
      { type: 'session.created', data: { sessionID: 'ses_root' } },
      { type: 'session.status', data: { sessionID: 'ses_root', status: { type: 'busy' } } },
      {
        type: 'session.inbox.enqueued',
        data: {
          sessionID: 'ses_root',
          inboxID: 'inbox-1',
          item: { type: 'user', payload: { text: 'hello world' } }
        }
      },
      { type: 'session.status', data: { sessionID: 'ses_root', status: { type: 'idle' } } }
    ])
    await cleanup()

    const payloads = hookPosts.map((post) => post.body.payload)
    const names = payloads.map((payload) => payload.hook_event_name)
    // Why: the preview posts outside the lifecycle FIFO, so only the queued edges are
    // asserted as an exact sequence.
    expect(names.slice(0, 2)).toEqual(['SessionStart', 'SessionBusy'])
    expect(names.at(-1)).toBe('SessionIdle')
    expect(payloads).toContainEqual(
      expect.objectContaining({
        hook_event_name: 'MessagePart',
        role: 'user',
        text: 'hello world',
        messageID: 'inbox-1',
        sessionID: 'ses_root'
      })
    )
    expect(hookPosts[0]?.body).toMatchObject({
      paneKey: 'tab-1:leaf-1',
      payload: { hook_event_name: 'SessionStart' }
    })
  })

  it('accumulates V2 text deltas into one assistant preview and drops synthetic items', async () => {
    process.env.KOLUX_PANE_KEY = 'tab-1:leaf-1'

    const { cleanup, hookPosts } = await setupThroughV2([
      { type: 'session.status', data: { sessionID: 'ses_root', status: { type: 'busy' } } },
      {
        type: 'session.inbox.enqueued',
        data: {
          sessionID: 'ses_root',
          inboxID: 'inbox-2',
          item: { type: 'synthetic', payload: { text: 'background task machinery' } }
        }
      },
      {
        type: 'session.text.delta',
        data: { sessionID: 'ses_root', assistantMessageID: 'msg-1', ordinal: 0, delta: 'Hel' }
      },
      {
        type: 'session.text.ended',
        data: {
          sessionID: 'ses_root',
          assistantMessageID: 'msg-1',
          ordinal: 0,
          text: 'Hello final'
        }
      },
      { type: 'session.status', data: { sessionID: 'ses_root', status: { type: 'idle' } } }
    ])
    await cleanup()

    const payloads = hookPosts.map((post) => post.body.payload)
    const previews = payloads.filter((payload) => payload.hook_event_name === 'MessagePart')
    expect(previews.length).toBeGreaterThan(0)
    // Why: idle flushes the coalesced snapshot before the done-state transition, so the
    // completed text must be the preview that lands last.
    expect(previews.at(-1)).toMatchObject({
      role: 'assistant',
      text: 'Hello final',
      messageID: 'msg-1'
    })
    expect(payloads.at(-1)?.hook_event_name).toBe('SessionIdle')
    // Why: synthetic inbox items are OpenCode machinery, not what the agent said.
    expect(JSON.stringify(previews)).not.toContain('background task machinery')
  })

  it('maps a V2 form to AskUserQuestion attention and back to busy on reply', async () => {
    process.env.KOLUX_PANE_KEY = 'tab-1:leaf-1'

    const { cleanup, hookPosts } = await setupThroughV2([
      { type: 'session.status', data: { sessionID: 'ses_root', status: { type: 'busy' } } },
      {
        type: 'form.created',
        data: {
          form: {
            id: 'form-1',
            sessionID: 'ses_root',
            title: 'Region',
            fields: [
              {
                key: 'region',
                title: 'Region',
                type: 'string',
                options: [{ value: 'us', label: 'US' }]
              }
            ]
          }
        }
      },
      {
        type: 'form.replied',
        data: { id: 'form-1', sessionID: 'ses_root', answer: { region: 'us' } }
      }
    ])
    await cleanup()

    const payloads = hookPosts.map((post) => post.body.payload)
    // Why: all three run through the lifecycle FIFO, so their order is load-bearing —
    // attention must land between the busy edges or the pane never shows the blocker.
    expect(payloads.map((payload) => payload.hook_event_name)).toEqual([
      'SessionBusy',
      'AskUserQuestion',
      'SessionBusy'
    ])
    // Why: the card renders the AskUserQuestion input shape, so the form must be
    // projected into `questions` — a raw form leaves the card with nothing to read.
    expect(payloads[1]).toMatchObject({ id: 'form-1', sessionID: 'ses_root' })
    expect(payloads[1].questions).toEqual([
      {
        question: 'Region',
        header: 'Region',
        multiSelect: false,
        options: [{ label: 'US', description: '' }]
      }
    ])
  })

  it('reports a session lifecycle event through the hook endpoint when driven via the default export', async () => {
    process.env.KOLUX_PANE_KEY = 'tab-1:leaf-1'
    const posts: { url: string; body: unknown }[] = []
    globalThis.fetch = vi.fn(async (input: unknown, init?: { body?: unknown }) => {
      posts.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) })
      return { ok: true } as Response
    }) as unknown as typeof globalThis.fetch

    const module = await loadPluginModule()
    const hooks = await module.default?.server?.({
      client: {
        session: {
          // Why: a root session (no parentID) must pass the child-session filter,
          // otherwise every event is dropped before it can post.
          get: async () => ({ data: { id: 'ses_root', parentID: undefined } })
        }
      }
    })

    await hooks?.event({
      event: {
        type: 'session.status',
        properties: { sessionID: 'ses_root', status: { type: 'busy' } }
      }
    })
    // Why: lifecycle delivery is queued; let the plugin's FIFO drain before asserting.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const hookPosts = posts.filter((post) => post.url.includes('/hook/opencode'))
    expect(hookPosts.length).toBeGreaterThan(0)
    expect(hookPosts[0]?.body).toMatchObject({
      paneKey: 'tab-1:leaf-1',
      payload: { hook_event_name: 'SessionBusy' }
    })
  })
})
