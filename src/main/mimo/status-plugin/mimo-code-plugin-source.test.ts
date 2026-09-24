import { describe, expect, it } from 'vitest'
import { _internals, getMimoCodePluginSource } from './mimo-code-plugin-source'

describe('MiMo Code hook plugin source', () => {
  it('keeps hook-pathname routing and session-start policy independently controllable', () => {
    const withSessionStart = getMimoCodePluginSource('/hook/opencode', { emitSessionStart: true })
    const familySource = getMimoCodePluginSource('/hook/mimo-code', { emitSessionStart: false })

    expect(withSessionStart).toContain('http://127.0.0.1:${coords.port}/hook/opencode')
    expect(withSessionStart).toContain('post("SessionStart", { sessionID: info.id })')
    expect(familySource).toContain('http://127.0.0.1:${coords.port}/hook/mimo-code')
    expect(familySource).not.toContain('post("SessionStart", { sessionID: info.id })')
    expect(familySource).toContain('export const KoluxMimoCodeStatusPlugin')
  })

  it('filters child sessions via parentID lookup before forwarding events', () => {
    const source = _internals.getMimoCodePluginSource('/hook/mimo-code', {
      emitSessionStart: false
    })

    expect(source).toContain('async function isChildSession(client, sessionID)')
    expect(source).toContain('walkSessionParents(client, sessionID, controller.signal)')
    expect(source).toContain('currentSessionID = session.parentID;')
    expect(source).toContain('rememberSessionRoot(id, currentSessionID)')
    expect(source).toContain('{ path: { id: sessionID }, signal }')
    expect(source).toContain('[{ sessionID }, { signal }]')
    expect(source.indexOf('[{ sessionID }, { signal }]')).toBeLessThan(
      source.indexOf('{ path: { id: sessionID }, signal }')
    )
    expect(source).toContain('return client.session.list({}, { signal });')
    expect(source).toContain('return client.session.list({ signal });')
    expect(source).toContain('return rootSessionID === null ? null : rootSessionID !== sessionID;')
    expect(source).toContain(
      'if (sessionID && (await isChildSession(client, sessionID)) !== false) {'
    )
    expect(source).toContain(
      'if (sessionID && (await isChildSession(client, sessionID)) !== false) {\n      return;\n    }'
    )
  })

  it('still accepts an optional opaque plugin context instead of destructuring', () => {
    const source = _internals.getMimoCodePluginSource('/hook/mimo-code', {
      emitSessionStart: false
    })

    expect(source).toContain('export const KoluxMimoCodeStatusPlugin = async (_ctx) => {')
    expect(source).toContain('const client = _ctx?.client;')
  })

  it('resolves hook coords from the endpoint file before falling back to process.env', () => {
    // Why: a forked session freezes the prior Kolux's PORT/TOKEN in env; prefer the on-disk endpoint file or it posts to a dead port after restart.
    const source = _internals.getMimoCodePluginSource('/hook/mimo-code', {
      emitSessionStart: false
    })

    expect(source).toContain('function readEndpointFile()')
    expect(source).toContain('process.env.KOLUX_AGENT_HOOK_ENDPOINT')
    // Parser accepts both `KEY=VALUE` (Unix) and `set KEY=VALUE` (Windows):
    expect(source).toContain('/^(?:set\\s+)?([A-Z0-9_]+)=(.*)$/')
    expect(source).toContain('function resolveHookCoords()')
    // File takes precedence over env — the whole point of v2:
    expect(source).toContain(
      'port: fileEnv.KOLUX_AGENT_HOOK_PORT || process.env.KOLUX_AGENT_HOOK_PORT'
    )
    expect(source).toContain(
      'token: fileEnv.KOLUX_AGENT_HOOK_TOKEN || process.env.KOLUX_AGENT_HOOK_TOKEN'
    )
    // post() uses the resolved coords, not a cached-at-startup url:
    expect(source).toContain('const coords = resolveHookCoords();')
    expect(source).toContain('http://127.0.0.1:${coords.port}/hook/mimo-code')
    expect(source).toContain('"X-Kolux-Agent-Hook-Token": coords.token')
  })

  it('caches the parsed endpoint file on mtime+size+inode to skip re-reads per post', () => {
    // Why: cache the parse to avoid a read per streamed Part; inode in the key lets renameSync invalidate it even when mtime/size collide.
    const source = _internals.getMimoCodePluginSource('/hook/mimo-code', {
      emitSessionStart: false
    })

    expect(source).toContain('let cachedEndpointKey = "";')
    expect(source).toContain('let cachedEndpointValues = null;')
    expect(source).toContain('const stat = fs.statSync(path);')
    expect(source).toContain('const cacheKey = stat.mtimeMs + ":" + stat.size + ":" + stat.ino;')
    expect(source).toContain('if (cacheKey === cachedEndpointKey && cachedEndpointValues) {')
    expect(source).toContain('return cachedEndpointValues;')
    // Stat failure must invalidate the cache, not lock in stale values:
    expect(source).toContain('cachedEndpointKey = "";')
    expect(source).toContain('cachedEndpointValues = null;')
  })

  it('forwards question.asked as AskUserQuestion so the pane flips to waiting', () => {
    // Why: forward question.asked too (not just permission.asked), else the pane stays "working" while the agent idles on a human reply.
    const source = _internals.getMimoCodePluginSource('/hook/mimo-code', {
      emitSessionStart: false
    })

    expect(source).toContain('event.type === "question.asked"')
    expect(source).toContain(
      'event.type === "permission.asked" ? "PermissionRequest" : "AskUserQuestion"'
    )
    expect(source).toContain('await setAttention(')
  })

  it('forwards sessionID on status and message posts for resume metadata', () => {
    const source = _internals.getMimoCodePluginSource('/hook/mimo-code', {
      emitSessionStart: false
    })

    expect(source).toContain(
      '{ role, text: capMessagePartText(part.text), messageID: part.messageID, sessionID },'
    )
    expect(source).toContain('messageID: pending.messageID,')
    expect(source).toContain('sessionID: pending.sessionID,')
    expect(source).toContain(
      'await setStatus("busy", { sessionID: busyOwner.sessionID }, busyOwner.factoryID);'
    )
    expect(source).toContain(
      'await setStatus("idle", { sessionID: preferredSessionID }, fallbackFactoryID);'
    )
  })

  it('guards endpoint-file parse warnings with a process-lifetime latch', () => {
    // Why: ENOENT is normal pre-install (stay silent), but a bad file would spam stderr per post; latch warns once per process.
    const source = _internals.getMimoCodePluginSource('/hook/mimo-code', {
      emitSessionStart: false
    })

    expect(source).toContain('let warnedBadEndpoint = false;')
    expect(source).toContain('err.code !== "ENOENT"')
    expect(source).toContain('warnedBadEndpoint = true;')
  })
})
