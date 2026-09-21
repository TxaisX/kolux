import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createElectronHomeIsolation } from './electron-home-isolation'

const execFileAsync = promisify(execFile)
const RUNTIME_METADATA_FILE = 'kolux-runtime.json'
let koluxDevUserDataPath: string | null = null
let koluxServeProcess: ChildProcess | null = null
let koluxServeStdout = ''
let koluxServeStderr = ''

export type CliResult = {
  stdout: string
  stderr: string
}

type RunKoluxCliOptions = {
  retryMissingRuntimeMetadata?: boolean
}

export async function runKoluxCli(
  args: string[],
  options: RunKoluxCliOptions = {}
): Promise<CliResult> {
  try {
    return await runKoluxCliOnce(args)
  } catch (error) {
    if (
      options.retryMissingRuntimeMetadata !== false &&
      isMissingRuntimeMetadataError(args, error)
    ) {
      // Why: Windows CI can let the dev runtime exit while launching the
      // fixture app; reopen once so the desktop action gets a live runtime.
      await ensureKoluxRuntimeLaunched()
      return await runKoluxCliOnce(args)
    }
    throw error
  }
}

async function runKoluxCliOnce(args: string[]): Promise<CliResult> {
  const devCli = join(process.cwd(), 'config/scripts/kolux-dev.mjs')
  const command = process.env.KOLUX_COMPUTER_CLI ?? process.execPath
  const cliArgs = process.env.KOLUX_COMPUTER_CLI ? args : [devCli, ...args]
  const env = process.env.KOLUX_COMPUTER_CLI
    ? { ...process.env }
    : await createComputerE2ERuntimeEnv()
  try {
    const result = await execFileAsync(command, cliArgs, {
      env,
      maxBuffer: 20 * 1024 * 1024
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      const output = error as { message: string; stdout: string; stderr: string }
      throw new Error(`${output.message}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`)
    }
    throw error
  }
}

export async function ensureKoluxRuntimeLaunched(): Promise<void> {
  if (!process.env.KOLUX_COMPUTER_CLI && process.platform === 'win32') {
    await ensureKoluxRuntimeServed()
    return
  }
  await runKoluxCli(['open', '--json'], { retryMissingRuntimeMetadata: false })
  await waitForKoluxRuntimeReady()
}

export async function stopKoluxRuntime(): Promise<void> {
  const processToStop = koluxServeProcess
  if (!processToStop?.pid) {
    return
  }
  koluxServeProcess = null
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(processToStop.pid), '/T', '/F'])
    } catch {
      // The foreground test runtime may already have exited.
    }
    return
  }
  processToStop.kill()
}

export function parseJsonOutput<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

async function getComputerE2eKoluxDevUserDataPath(): Promise<string> {
  if (!koluxDevUserDataPath) {
    // Why: the shared kolux-dev profile can keep an older runtime alive across
    // local test runs, making computer-use E2E exercise stale provider code.
    koluxDevUserDataPath = await mkdtemp(join(tmpdir(), 'kolux-computer-runtime-'))
  }
  return koluxDevUserDataPath
}

async function waitForKoluxRuntimeReady(): Promise<void> {
  const userDataPath = await getComputerE2eKoluxDevUserDataPath()
  const metadataPath = join(userDataPath, RUNTIME_METADATA_FILE)
  const deadline = Date.now() + 15000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    try {
      await access(metadataPath)
      const status = parseJsonOutput<{
        result: { runtime: { reachable: boolean } }
      }>((await runKoluxCli(['status', '--json'], { retryMissingRuntimeMetadata: false })).stdout)
      if (status.result.runtime.reachable) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }

  const detail = [
    lastError instanceof Error ? `Last error: ${lastError.message}` : null,
    koluxServeStdout.trim() ? `serve stdout: ${koluxServeStdout.trim()}` : null,
    koluxServeStderr.trim() ? `serve stderr: ${koluxServeStderr.trim()}` : null
  ]
    .filter(Boolean)
    .join(' ')
  throw new Error(`Kolux runtime metadata was not ready at ${metadataPath}.${detail}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureKoluxRuntimeServed(): Promise<void> {
  if (!koluxServeProcess || koluxServeProcess.exitCode !== null) {
    const devCli = join(process.cwd(), 'config/scripts/kolux-dev.mjs')
    const env = await createComputerE2ERuntimeEnv()
    koluxServeStdout = ''
    koluxServeStderr = ''
    koluxServeProcess = spawn(process.execPath, [devCli, 'serve', '--no-pairing', '--json'], {
      env,
      windowsHide: true
    })
    koluxServeProcess.stdout?.on('data', (chunk) => {
      koluxServeStdout += String(chunk)
    })
    koluxServeProcess.stderr?.on('data', (chunk) => {
      koluxServeStderr += String(chunk)
    })
    koluxServeProcess.once('exit', () => {
      koluxServeProcess = null
    })
    process.once('exit', () => {
      koluxServeProcess?.kill()
    })
  }
  await waitForKoluxRuntimeReady()
}

async function createComputerE2ERuntimeEnv(): Promise<NodeJS.ProcessEnv> {
  const userDataDir =
    process.env.KOLUX_DEV_USER_DATA_PATH ?? (await getComputerE2eKoluxDevUserDataPath())
  // Why: agent runtimes export ELECTRON_RUN_AS_NODE, which would make the
  // spawned Electron behave as plain Node; strip it like every other caller.
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...inheritedEnv } = process.env
  void _electronRunAsNode
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir
  })
  return {
    ...isolation.env,
    // Why: the Node CLI and the Electron child must resolve the same runtime
    // metadata while the E2E boundary owns their home and Codex paths.
    KOLUX_DEV_USER_DATA_PATH: userDataDir
  }
}

function isMissingRuntimeMetadataError(args: string[], error: unknown): boolean {
  if (args[0] !== 'computer') {
    return false
  }
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return false
  }
  const message = String((error as { message?: unknown }).message)
  return (
    message.includes('"code": "runtime_unavailable"') &&
    message.includes('Could not read Kolux runtime metadata')
  )
}
