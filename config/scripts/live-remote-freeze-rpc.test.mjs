import { describe, expect, it } from 'vitest'
import {
  appendKoluxRpcOutput,
  resolveKoluxCliCommand,
  resolveKoluxCliInvocation
} from './live-remote-freeze-rpc.mjs'

describe('live remote freeze RPC', () => {
  it('resolves the Kolux CLI for managed, dev, Linux, and default runtimes', () => {
    expect(resolveKoluxCliCommand({ env: { KOLUX_CLI_COMMAND: 'custom-kolux' } })).toBe(
      'custom-kolux'
    )
    expect(resolveKoluxCliCommand({ env: { KOLUX_DEV_REPO_ROOT: '/repo' } })).toBe('kolux-dev')
    expect(resolveKoluxCliCommand({ env: {}, platform: 'linux' })).toBe('kolux-ide')
    expect(resolveKoluxCliCommand({ env: {}, platform: 'win32' })).toBe('kolux')
  })

  it('bypasses the Windows dev cmd shim with the built Node CLI', () => {
    const invocation = resolveKoluxCliInvocation({
      env: {
        APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
        KOLUX_CLI_COMMAND: 'C:\\repo\\out\\bin\\kolux-dev.cmd',
        KOLUX_DEV_REPO_ROOT: 'C:\\repo'
      },
      platform: 'win32',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe'
    })

    expect(invocation).toMatchObject({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      prefixArgs: ['C:\\repo\\out\\cli\\index.js'],
      env: {
        KOLUX_USER_DATA_PATH: 'C:\\Users\\dev\\AppData\\Roaming\\kolux-dev',
        KOLUX_DEV_CLI_INVOCATION: '1',
        KOLUX_APP_EXECUTABLE: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
        KOLUX_APP_EXECUTABLE_NEEDS_APP_ROOT: '1'
      }
    })
  })

  it('caps combined asynchronous output before retaining the overflow chunk', () => {
    const first = appendKoluxRpcOutput('', '1234', 0, 5)
    expect(first).toEqual({ output: '1234', bytes: 4, exceeded: false })

    const overflow = appendKoluxRpcOutput(first.output, '67', first.bytes, 5)
    expect(overflow).toEqual({ output: '1234', bytes: 6, exceeded: true })
  })
})
