import { describe, expect, it } from 'vitest'

import { evaluateKoluxdActivation } from './koluxd-activation-gate'
import type { ServeReadiness } from '../server/serve-readiness'
import type { KoluxdHealth, TerminalDaemonHealth } from '../koluxd/koluxd-health'

const EXPECTED = { buildHash: 'abc123def4567890', fullVersion: '0.2.0+bb01' }

function daemon(overrides: Partial<TerminalDaemonHealth> = {}): TerminalDaemonHealth {
  return {
    state: 'live',
    ownsFreshSessions: true,
    pid: 4242,
    buildVersion: '0.2.0+bb01',
    entryPath: '/home/u/.kolux-remote/koluxd-0.2.0+bb01/daemon-entry.js',
    protocolVersion: 3,
    selfTest: { ok: true, coverage: 'pty-spawn', verdict: 'healthy', durationMs: 12 },
    ...overrides
  }
}

function health(overrides: Partial<KoluxdHealth> = {}): KoluxdHealth {
  return {
    buildHash: EXPECTED.buildHash,
    buildVersion: EXPECTED.fullVersion,
    nodeVersion: '20.11.0',
    nodeAbi: '115',
    platform: 'linux',
    arch: 'x64',
    pid: 4200,
    terminalDaemon: daemon(),
    ...overrides
  }
}

function readiness(overrides: Partial<ServeReadiness> = {}): ServeReadiness {
  return {
    runtimeId: 'runtime-1',
    boundEndpoint: 'ws://127.0.0.1:7777',
    advertisedEndpoint: null,
    managedWslCliReconciliation: 'settled',
    pairing: { available: false, reason: 'disabled_by_operator', guidance: 'n/a' },
    health: health(),
    ...overrides
  }
}

describe('evaluateKoluxdActivation', () => {
  it('activates a candidate that proved a real PTY round trip', () => {
    const verdict = evaluateKoluxdActivation(readiness(), EXPECTED)
    expect(verdict).toEqual({ decision: 'activate', coverage: 'pty-spawn', warnings: [] })
  })

  it('refuses when the candidate never published readiness', () => {
    const verdict = evaluateKoluxdActivation(null, EXPECTED)
    expect(verdict).toMatchObject({
      decision: 'reject',
      code: 'koluxd_activation_no_readiness'
    })
  })

  it('refuses a readiness payload with no health, rather than reading silence as healthy', () => {
    const { health: _dropped, ...withoutHealth } = readiness()
    const verdict = evaluateKoluxdActivation(withoutHealth as ServeReadiness, EXPECTED)
    expect(verdict).toMatchObject({ decision: 'reject', code: 'koluxd_activation_no_health' })
  })

  it('refuses when a different build answered — a stale process holding the port', () => {
    const verdict = evaluateKoluxdActivation(
      readiness({ health: health({ buildHash: '0000000000000000' }) }),
      EXPECTED
    )
    expect(verdict).toMatchObject({
      decision: 'reject',
      code: 'koluxd_activation_build_mismatch'
    })
  })

  it('refuses a listening koluxd whose terminal daemon is absent', () => {
    const verdict = evaluateKoluxdActivation(
      readiness({
        health: health({
          terminalDaemon: daemon({
            state: 'absent',
            ownsFreshSessions: false,
            selfTest: { ok: false, coverage: 'pty-spawn', verdict: 'no-daemon', durationMs: 1 }
          })
        })
      }),
      EXPECTED
    )
    expect(verdict).toMatchObject({
      decision: 'reject',
      code: 'koluxd_activation_daemon_absent'
    })
  })

  it('refuses a degraded daemon, whose fresh terminals would not survive a restart', () => {
    const verdict = evaluateKoluxdActivation(
      readiness({
        health: health({ terminalDaemon: daemon({ state: 'degraded', ownsFreshSessions: false }) })
      }),
      EXPECTED
    )
    expect(verdict).toMatchObject({
      decision: 'reject',
      code: 'koluxd_activation_daemon_degraded'
    })
  })

  it('refuses a live daemon that failed its PTY spawn probe', () => {
    const verdict = evaluateKoluxdActivation(
      readiness({
        health: health({
          terminalDaemon: daemon({
            selfTest: {
              ok: false,
              coverage: 'pty-spawn',
              verdict: 'pty-spawn-unhealthy',
              durationMs: 30
            }
          })
        })
      }),
      EXPECTED
    )
    expect(verdict).toMatchObject({
      decision: 'reject',
      code: 'koluxd_activation_pty_self_test_failed'
    })
  })

  it('refuses a green daemon that does not own fresh sessions', () => {
    const verdict = evaluateKoluxdActivation(
      readiness({ health: health({ terminalDaemon: daemon({ ownsFreshSessions: false }) }) }),
      EXPECTED
    )
    expect(verdict).toMatchObject({
      decision: 'reject',
      code: 'koluxd_activation_no_persistent_terminals'
    })
  })

  it('refuses a candidate that is not listening', () => {
    const verdict = evaluateKoluxdActivation(readiness({ boundEndpoint: null }), EXPECTED)
    expect(verdict).toMatchObject({
      decision: 'reject',
      code: 'koluxd_activation_not_listening'
    })
  })

  it('activates handshake-only coverage but never records it as a proven PTY', () => {
    const verdict = evaluateKoluxdActivation(
      readiness({
        health: health({
          platform: 'win32',
          terminalDaemon: daemon({
            selfTest: { ok: true, coverage: 'handshake', verdict: 'healthy', durationMs: 5 }
          })
        })
      }),
      EXPECTED
    )
    expect(verdict).toMatchObject({ decision: 'activate', coverage: 'handshake' })
    expect(verdict.decision === 'activate' && verdict.warnings[0]).toContain(
      'covered the daemon handshake only'
    )
  })

  it('checks identity before health, so a wrong-build green payload cannot pass', () => {
    const verdict = evaluateKoluxdActivation(
      readiness({
        health: health({ buildHash: 'ffffffffffffffff', terminalDaemon: daemon() })
      }),
      EXPECTED
    )
    expect(verdict).toMatchObject({ code: 'koluxd_activation_build_mismatch' })
  })
})
