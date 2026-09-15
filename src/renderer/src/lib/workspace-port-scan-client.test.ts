// The renderer validates every scan before storing it; a value the main process can emit
// but the validator rejects silently turns the whole scan into "unavailable" (#preview-windows).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runWorkspacePortScanForTarget } from './workspace-port-scan-client'

const owner = {
  worktreeId: 'repo::/repo',
  repoId: 'repo',
  displayName: 'main',
  path: '/repo'
}

function stubScan(ports: unknown[]): void {
  vi.stubGlobal('window', {
    api: {
      workspacePorts: {
        scan: vi.fn(async () => ({ platform: 'win32', scannedAt: 1, ports }))
      }
    }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runWorkspacePortScanForTarget', () => {
  it('accepts a workspace port attributed by an advertised URL', async () => {
    stubScan([
      {
        id: '127.0.0.1:8771:1',
        bindHost: '127.0.0.1',
        connectHost: '127.0.0.1',
        port: 8771,
        pid: 1,
        processName: 'python.exe',
        protocol: 'http',
        kind: 'workspace',
        owner: { ...owner, confidence: 'advertised' },
        advertisedUrl: 'http://127.0.0.1:8771'
      }
    ])

    const result = await runWorkspacePortScanForTarget({ kind: 'local' })

    expect(result.ports).toHaveLength(1)
    expect(result.ports[0]).toMatchObject({ kind: 'workspace', owner: { confidence: 'advertised' } })
  })

  it('still rejects an unknown confidence value', async () => {
    stubScan([
      {
        id: '127.0.0.1:8771:1',
        bindHost: '127.0.0.1',
        connectHost: '127.0.0.1',
        port: 8771,
        protocol: 'http',
        kind: 'workspace',
        owner: { ...owner, confidence: 'guess' }
      }
    ])

    await expect(runWorkspacePortScanForTarget({ kind: 'local' })).rejects.toThrow(
      'Workspace port scan returned an invalid response.'
    )
  })
})
