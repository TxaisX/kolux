import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WindowsHostInteractiveLoginSpawn } from '../../shared/windows-interactive-login-spawn'
import { withCliRuntimeOnPath } from '../../shared/node-cli-command-resolution'
import { parseWslUncPath } from '../../shared/wsl-paths'
import { resolveCodexCommand } from '../codex-cli/command'
import { runWslProcess } from '../wsl/wsl-runner'
import { readCodexAuthIdentity } from './codex-auth-identity'
import { ManagedCodexHomeTemporarilyUnavailableError } from './host-codex-managed-home-ownership'
import { CODEX_ACCOUNT_LOGIN_ARGS } from './codex-account-login-args'
import {
  buildWslCodexAvailabilityScript,
  buildWslCodexLoginArgs,
  WSL_CODEX_AVAILABILITY_TIMEOUT_MS
} from './wsl-codex-command'

const LOGIN_TIMEOUT_MS = 120_000
const MAX_LOGIN_OUTPUT_CHARS = 4_000
const WINDOWS_LOGIN_AUTH_POLL_INTERVAL_MS = 500
const WINDOWS_LOGIN_POST_AUTH_EXIT_GRACE_MS = 5_000

type LoginOutputStream = {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown
  off(event: 'data', listener: (chunk: Buffer) => void): unknown
}

export type CodexLoginChild = {
  stdout: LoginOutputStream | null
  stderr: LoginOutputStream | null
  pid?: number
  exitCode: number | null
  signalCode: string | null
  kill(): boolean
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
  off(event: 'error', listener: (error: Error) => void): unknown
  off(event: 'close', listener: (code: number | null) => void): unknown
}

export type CodexLoginSpawnRequest = {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  stdio: WindowsHostInteractiveLoginSpawn['stdio'] | ['ignore', 'pipe', 'pipe']
}

type CodexLoginSessionDependencies = {
  wslCommand: string
  spawn: (request: CodexLoginSpawnRequest) => CodexLoginChild
  killProcessTree: (
    child: CodexLoginChild,
    interactiveLogin?: WindowsHostInteractiveLoginSpawn | null
  ) => void
}

function readLoginAuthSnapshot(authJsonPath: string): string | null | undefined {
  try {
    return readFileSync(authJsonPath, 'utf-8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null
    }
    // Why: codex can atomically replace auth.json while the poll runs; a later
    // poll will observe the stable credential. An unreadable initial file must
    // disable the shortcut rather than look like a fresh login.
    return undefined
  }
}

function loginAuthChanged(
  initial: string | null | undefined,
  current: string | null | undefined
): boolean {
  // Why: metadata-only touches can happen before OAuth finishes. Requiring new
  // credential bytes prevents reauthentication from being killed prematurely.
  return (
    initial !== undefined &&
    current !== undefined &&
    current !== null &&
    current !== initial &&
    Boolean(readCodexAuthIdentity(current)?.email)
  )
}

export async function runCodexLoginSession(
  managedHomePath: string,
  dependencies: CodexLoginSessionDependencies
): Promise<void> {
  const wslInfo = parseWslUncPath(managedHomePath)
  if (wslInfo) {
    await assertWslCodexCliAvailable(wslInfo)
  }
  // Why: reauthentication starts with an existing auth.json. Only new auth
  // bytes prove this login completed; existence alone would kill the
  // Windows OAuth flow five seconds after it opened.
  const initialAuthSnapshot = wslInfo
    ? null
    : readLoginAuthSnapshot(join(managedHomePath, 'auth.json'))

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const spawnConfig = wslInfo
      ? {
          command: dependencies.wslCommand,
          args: buildWslCodexLoginArgs(wslInfo.distro, wslInfo.linuxPath),
          env: process.env,
          codexCommand: 'codex',
          interactiveLogin: null
        }
      : createHostLoginSpawn(managedHomePath)
    const child = dependencies.spawn({
      command: spawnConfig.command,
      args: spawnConfig.args,
      env: spawnConfig.env,
      stdio: spawnConfig.interactiveLogin
        ? spawnConfig.interactiveLogin.stdio
        : ['ignore', 'pipe', 'pipe']
    })

    let settled = false
    let output = ''
    const appendOutput = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`
      if (output.length > MAX_LOGIN_OUTPUT_CHARS) {
        output = output.slice(-MAX_LOGIN_OUTPUT_CHARS)
      }
    }

    let timeout: ReturnType<typeof setTimeout> | null = null
    let authWatchInterval: ReturnType<typeof setInterval> | null = null
    let postAuthExitTimeout: ReturnType<typeof setTimeout> | null = null
    let loginTreeKilledAfterAuth = false
    const authJsonPath = join(managedHomePath, 'auth.json')
    const cleanupListeners = (): void => {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      if (authWatchInterval) {
        clearInterval(authWatchInterval)
        authWatchInterval = null
      }
      if (postAuthExitTimeout) {
        clearTimeout(postAuthExitTimeout)
        postAuthExitTimeout = null
      }
      child.stdout?.off('data', appendOutput)
      child.stderr?.off('data', appendOutput)
      child.off('error', onError)
      child.off('close', onClose)
      spawnConfig.interactiveLogin?.cleanup?.()
    }

    const settle = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      cleanupListeners()
      callback()
    }

    const timeoutError = new Error('Codex sign-in took too long to finish. Please try again.')
    timeout = setTimeout(() => {
      dependencies.killProcessTree(child, spawnConfig.interactiveLogin)
      settle(() => rejectPromise(timeoutError))
    }, LOGIN_TIMEOUT_MS)

    // Why: on Windows the codex login CLI can linger after writing auth.json,
    // and its open handles on the managed home (log/codex-login.log) make the
    // post-login file operations fail with ENOTEMPTY. Once auth.json exists,
    // give the tree a short grace period to exit, then force it down.
    if (process.platform === 'win32' && !wslInfo) {
      authWatchInterval = setInterval(() => {
        if (!loginAuthChanged(initialAuthSnapshot, readLoginAuthSnapshot(authJsonPath))) {
          return
        }
        if (authWatchInterval) {
          clearInterval(authWatchInterval)
          authWatchInterval = null
        }
        postAuthExitTimeout = setTimeout(() => {
          loginTreeKilledAfterAuth = true
          dependencies.killProcessTree(child, spawnConfig.interactiveLogin)
        }, WINDOWS_LOGIN_POST_AUTH_EXIT_GRACE_MS)
      }, WINDOWS_LOGIN_AUTH_POLL_INTERVAL_MS)
    }

    const onError = (error: Error): void => {
      settle(() => {
        const isEnoent = (error as NodeJS.ErrnoException).code === 'ENOENT'
        // Why: ENOENT is ambiguous — missing codex binary or missing node in PATH; a resolved full path implies node is missing.
        const isBareCommand = spawnConfig.codexCommand === 'codex'
        const message = isEnoent
          ? isBareCommand
            ? 'Codex CLI not found.'
            : 'Codex CLI found but could not run — Node.js may not be in your PATH.'
          : error.message
        rejectPromise(new Error(message))
      })
    }

    const onClose = (code: number | null): void => {
      settle(() => {
        const authSnapshot = readLoginAuthSnapshot(authJsonPath)
        // A scanner lock cannot revoke credentials already observed before teardown.
        if (loginTreeKilledAfterAuth && authSnapshot === undefined) {
          resolvePromise()
          return
        }
        if (authSnapshot === undefined) {
          rejectPromise(new ManagedCodexHomeTemporarilyUnavailableError())
          return
        }
        if (code === 0 || loginTreeKilledAfterAuth) {
          if (authSnapshot && readCodexAuthIdentity(authSnapshot)?.email) {
            resolvePromise()
            return
          }
          rejectPromise(
            new Error(
              'Codex sign-in did not save account credentials. Finish authorization in your browser, then try adding the account again.'
            )
          )
          return
        }
        // CLI output may contain OAuth URLs, device codes, or tokens.
        rejectPromise(
          new Error(
            output.toLowerCase().includes('address already in use')
              ? 'Another Codex sign-in is already using the browser callback. Finish that sign-in, then try again.'
              : `Codex login exited with code ${code ?? 'unknown'}. Finish authorization in your browser and try again.`
          )
        )
      })
    }

    child.stdout?.on('data', appendOutput)
    child.stderr?.on('data', appendOutput)
    child.on('error', onError)
    child.on('close', onClose)
  })
}

function createHostLoginSpawn(managedHomePath: string): {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  codexCommand: string
  interactiveLogin: WindowsHostInteractiveLoginSpawn | null
} {
  const codexCommand = resolveCodexCommand()
  return {
    command: codexCommand,
    args: [...CODEX_ACCOUNT_LOGIN_ARGS],
    env: withCliRuntimeOnPath(codexCommand, { ...process.env, CODEX_HOME: managedHomePath }),
    codexCommand,
    interactiveLogin: null
  }
}

async function assertWslCodexCliAvailable(wslInfo: {
  distro: string
  linuxPath: string
}): Promise<void> {
  // This is a PATH lookup, so it needs the login PATH: an nvm-installed codex
  // lives nowhere else. Marking it 'none' reports a working install as absent.
  const result = await runWslProcess({
    distro: wslInfo.distro,
    loginPath: 'preferred',
    script: buildWslCodexAvailabilityScript(),
    // POSIX command lookup; declared because the payload is opaque here.
    shell: 'sh',
    timeoutMs: WSL_CODEX_AVAILABILITY_TIMEOUT_MS
  })
  if (result.code !== 0 && !result.environmentResolved) {
    // A miss without the login PATH is "we could not check", not "not
    // installed" -- claiming absence here is #9725.
    throw new Error('Could not check the Codex CLI in WSL. Try again.')
  }
  if (result.code !== 0 || result.timedOut) {
    throw new Error(
      `Codex CLI is not available in WSL ${wslInfo.distro}. Install Codex in that distro or switch Account location to Windows.`,
      { cause: new Error(result.stderr.trim() || `codex lookup exited with ${result.code}`) }
    )
  }
}
