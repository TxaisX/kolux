import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect } from './helpers/kolux-app'
import type { RuntimeClient } from '../../src/cli/runtime-client'
import type {
  RuntimeTerminalListResult,
  RuntimeTerminalRead,
  RuntimeTerminalSummary
} from '../../src/shared/runtime-types'
import { PROTOCOL_VERSION } from '../../src/main/daemon/types'
import { makePaneKey } from '../../src/shared/stable-pane-id'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'

export type SpawnEvent = { args: string[]; pid: number }
export type TerminalIdentity = Pick<
  RuntimeTerminalSummary,
  'handle' | 'incarnationId' | 'leafId' | 'ptyId' | 'tabId'
>

export const PROVIDER_SESSION_ID = '019fc155-00e1-7102-99a9-e7c72e532a8e'

export const fakeCliDir = mkdtempSync(path.join(os.tmpdir(), 'kolux-live-mount-cli-'))
export const spawnLedgerPath = path.join(fakeCliDir, 'codex-spawn.jsonl')
export const setupLedgerPath = path.join(fakeCliDir, 'setup-spawn.jsonl')
export const canaryLedgerPath = path.join(fakeCliDir, 'canary-spawn.jsonl')
export const signalLedgerPath = path.join(fakeCliDir, 'terminal-signals.jsonl')
const fakeCodexSource = `
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
if (args.includes('app-server')) {
  process.stderr.write("error: unrecognized subcommand 'app-server'\n")
  process.exit(2)
}
appendFileSync(process.env.KOLUX_E2E_CODEX_SPAWN_LEDGER, JSON.stringify({ args, pid: process.pid }) + '\n')
process.stdout.write('LIVE_AGENT_READY:' + process.pid + '\n')
let inputBuffer = ''
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk.toString()
  const lines = inputBuffer.split(/[\r\n]+/)
  inputBuffer = lines.pop() || ''
  for (const line of lines) if (line) process.stdout.write('AGENT_INPUT:' + process.pid + ':' + line + '\n')
})
for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) process.on(signal, () => appendFileSync(process.env.KOLUX_E2E_SIGNAL_LEDGER, JSON.stringify({ kind: 'agent', pid: process.pid, signal }) + '\n'))
process.stdin.resume()
setInterval(() => {}, 60_000)
`

if (process.platform === 'win32') {
  writeFileSync(path.join(fakeCliDir, 'fake-codex.js'), fakeCodexSource)
  writeFileSync(
    path.join(fakeCliDir, 'codex.cmd'),
    '@echo off\r\nnode "%~dp0\fake-codex.js" %*\r\n'
  )
} else {
  const executable = path.join(fakeCliDir, 'codex')
  writeFileSync(executable, `#!/usr/bin/env node\n${fakeCodexSource}`)
  chmodSync(executable, 0o755)
}

export const fakeCodexCommand = buildFakeAgentCommandOverride(
  path.join(fakeCliDir, process.platform === 'win32' ? 'codex.cmd' : 'codex')
)

export function readSpawnLedger(): SpawnEvent[] {
  if (!existsSync(spawnLedgerPath)) {
    return []
  }
  return readFileSync(spawnLedgerPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SpawnEvent)
}

export function readJsonLines<T>(filePath: string): T[] {
  if (!existsSync(filePath)) {
    return []
  }
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T)
}

export function createSourceRepo(): string {
  const repoPath = mkdtempSync(path.join(os.tmpdir(), 'kolux-live-mount-repo-'))
  writeFileSync(
    path.join(repoPath, 'setup-live.js'),
    `const { appendFileSync } = require('node:fs')\nappendFileSync(process.env.KOLUX_E2E_SETUP_LEDGER, JSON.stringify({ pid: process.pid }) + '\\n')\nconsole.log('SETUP_READY:' + process.pid)\nlet inputBuffer = ''\nprocess.stdin.on('data', chunk => {\n  inputBuffer += chunk.toString()\n  const lines = inputBuffer.split(/[\\r\\n]+/)\n  inputBuffer = lines.pop() || ''\n  for (const line of lines) if (line) console.log('SETUP_INPUT:' + process.pid + ':' + line)\n})\nfor (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) process.on(signal, () => appendFileSync(process.env.KOLUX_E2E_SIGNAL_LEDGER, JSON.stringify({ kind: 'setup', pid: process.pid, signal }) + '\\n'))\nprocess.stdin.resume()\nsetInterval(() => {}, 60000)\n`
  )
  writeFileSync(
    path.join(repoPath, 'canary-live.js'),
    `const { appendFileSync } = require('node:fs')\nappendFileSync(process.env.KOLUX_E2E_CANARY_LEDGER, JSON.stringify({ pid: process.pid }) + '\\n')\nconsole.log('CANARY_READY:' + process.pid)\nlet inputBuffer = ''\nprocess.stdin.on('data', chunk => {\n  inputBuffer += chunk.toString()\n  const lines = inputBuffer.split(/[\\r\\n]+/)\n  inputBuffer = lines.pop() || ''\n  for (const line of lines) if (line) console.log('CANARY_INPUT:' + process.pid + ':' + line)\n})\nfor (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) process.on(signal, () => appendFileSync(process.env.KOLUX_E2E_SIGNAL_LEDGER, JSON.stringify({ kind: 'canary', pid: process.pid, signal }) + '\\n'))\nprocess.stdin.resume()\nsetInterval(() => {}, 60000)\n`
  )
  writeFileSync(path.join(repoPath, 'kolux.yaml'), 'scripts:\n  setup: node setup-live.js\n')
  execFileSync('git', ['init'], { cwd: repoPath })
  execFileSync('git', ['checkout', '-b', 'main'], { cwd: repoPath })
  execFileSync('git', ['add', '.'], { cwd: repoPath })
  execFileSync(
    'git',
    ['-c', 'user.name=Kolux E2E', '-c', 'user.email=kolux-e2e@example.com', 'commit', '-m', 'seed'],
    { cwd: repoPath }
  )
  return repoPath
}

export async function readWorktreeTerminals(
  client: RuntimeClient,
  worktreeId: string
): Promise<RuntimeTerminalSummary[]> {
  const listed = await client.call<RuntimeTerminalListResult>('terminal.list', {
    worktree: `id:${worktreeId}`,
    limit: 20,
    requireFreshPtyLiveness: true
  })
  return listed.result.terminals
    .filter((terminal) => terminal.worktreeId === worktreeId)
    .sort((a, b) => a.handle.localeCompare(b.handle))
}

export async function terminalOutput(client: RuntimeClient, handle: string): Promise<string> {
  const read = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
    terminal: handle,
    limit: 300
  })
  return read.result.terminal.tail.join('\n')
}

export function terminalIdentity(terminal: RuntimeTerminalSummary): TerminalIdentity {
  const { handle, incarnationId, leafId, ptyId, tabId } = terminal
  return { handle, incarnationId, leafId, ptyId, tabId }
}

export function liveTerminalIdentity(terminal: RuntimeTerminalSummary) {
  return {
    ...terminalIdentity(terminal),
    connected: terminal.connected,
    writable: terminal.writable
  }
}

export function readDaemonPid(userDataDir: string): number {
  const raw = readFileSync(
    path.join(userDataDir, 'daemon', `daemon-v${PROTOCOL_VERSION}.pid`),
    'utf8'
  )
  const parsed = JSON.parse(raw) as { pid?: unknown }
  if (typeof parsed.pid !== 'number' || parsed.pid <= 0) {
    throw new Error(`Daemon pid file did not contain a positive pid: ${raw}`)
  }
  return parsed.pid
}

export async function seedAgentRecoveryMetadata(
  page: Page,
  worktreeId: string,
  agent: TerminalIdentity
): Promise<void> {
  const paneKey = makePaneKey(agent.tabId, agent.leafId)
  const launchToken = `live-mount-${randomUUID()}`
  await page.evaluate(
    ({ agent, launchToken, paneKey, providerSessionId, worktreeId }) => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('Renderer store unavailable')
      }
      const providerSession = { key: 'session_id' as const, id: providerSessionId }
      state.registerAgentLaunchConfig(
        paneKey,
        {
          agentCommand: 'codex',
          agentArgs: '--dangerously-bypass-approvals-and-sandbox',
          agentEnv: {}
        },
        {
          agentType: 'codex',
          launchToken,
          tabId: agent.tabId,
          leafId: agent.leafId,
          terminalHandle: agent.handle,
          providerSession
        }
      )
      state.setAgentStatus(
        paneKey,
        { state: 'working', prompt: 'keep running', agentType: 'codex' },
        'Codex',
        undefined,
        { tabId: agent.tabId, worktreeId, terminalHandle: agent.handle },
        { providerSession, launchToken }
      )
    },
    { agent, launchToken, paneKey, providerSessionId: PROVIDER_SESSION_ID, worktreeId }
  )
  await expect
    .poll(() =>
      page.evaluate(
        ({ paneKey, providerSessionId, worktreeId }) => {
          const state = window.__store?.getState()
          const live = state?.agentStatusByPaneKey[paneKey]
          const sleeping = state?.sleepingAgentSessionsByPaneKey[paneKey]
          return {
            liveProviderSessionId: live?.providerSession?.id ?? null,
            sleeping: sleeping
              ? {
                  paneKey: sleeping.paneKey,
                  tabId: sleeping.tabId,
                  worktreeId: sleeping.worktreeId,
                  origin: sleeping.origin,
                  providerSessionId: sleeping.providerSession.id,
                  agentCommand: sleeping.launchConfig?.agentCommand ?? null
                }
              : null,
            expected: { paneKey, providerSessionId, worktreeId }
          }
        },
        { paneKey, providerSessionId: PROVIDER_SESSION_ID, worktreeId }
      )
    )
    .toEqual({
      liveProviderSessionId: PROVIDER_SESSION_ID,
      sleeping: {
        paneKey,
        tabId: agent.tabId,
        worktreeId,
        origin: 'live',
        providerSessionId: PROVIDER_SESSION_ID,
        agentCommand: 'codex'
      },
      expected: { paneKey, providerSessionId: PROVIDER_SESSION_ID, worktreeId }
    })
}
