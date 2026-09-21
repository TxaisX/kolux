/**
 * `koluxd` — the Kolux runtime served from plain Node, with no Electron.
 *
 * Installs the Node host adapters, constructs the same `KoluxRuntimeService` the
 * desktop uses, installs a PTY controller via `registerHeadlessPtyRuntime`, and
 * serves runtime RPC. See docs/design/node-only-runtime-backend.html.
 *
 * Desktop UI surfaces stay uninstalled: no notifications, no renderer window. The
 * renderer window is faked as a destroyed one because `registerPtyHandlers` takes a
 * non-null `BrowserWindow`. Browser automation is different — it is installed through
 * the runtime factory, but only when an Electron serve sidecar or an operator-supplied
 * Chromium proves available at startup.
 */
import process from 'node:process'
import { setAppEnvironment, type AppEnvironment } from '../../shared/app-environment'
import { setSecretStore, type SecretStore } from '../../shared/secret-store'
import type { ServeReadiness } from '../server/serve-readiness'
import { setRuntimeBrowserCommandsFactory } from '../runtime/runtime-browser-commands-factory'
import { resolveKoluxdBrowserProvider, type KoluxdBrowserProvider } from './koluxd-browser-provider'
import {
  resolveKoluxdInstallRoot,
  resolveKoluxdPath,
  resolveUserDataPath
} from './koluxd-app-paths'
import {
  describeKoluxdBindExposure,
  KoluxdBindAddressError,
  resolveKoluxdBindHost
} from './koluxd-bind-address'
import {
  acquireKoluxdInstanceLock,
  KoluxdInstanceLockError,
  type KoluxdInstanceLock
} from './koluxd-instance-lock'
import { migrateLegacyNightshiftUserData } from '../startup/pre-kolux-userdata-migration'

let runKoluxdQuitHandlers = (): void => {}

function createNodeAppEnvironment(): AppEnvironment {
  const quitHandlers: (() => void)[] = []
  // The main signal handler awaits runtime and browser teardown before process.exit.
  // Keep will-quit callbacks synchronous, but never let them pre-empt that async barrier.
  runKoluxdQuitHandlers = (): void => {
    for (const handler of quitHandlers.splice(0)) {
      try {
        handler()
      } catch (error) {
        console.error('[koluxd] shutdown handler failed:', error)
      }
    }
  }
  return {
    getPath: resolveKoluxdPath,
    getAppPath: () => resolveKoluxdInstallRoot(),
    getVersion: () => process.env.KOLUX_VERSION ?? '0.0.0-koluxd',
    // Why still true: consumers read this as "production build, not a dev checkout" —
    // it gates HTTPS-only skill downloads, the real CLI command name, and shell-PATH
    // hydration. Answering false to satisfy a path resolver would relax a security
    // posture. Layout questions must ask whether the app root is an asar archive
    // instead (see parcel-watcher-entry-path.ts).
    isPackaged: () => true,
    onWillQuit: (handler) => quitHandlers.push(handler),
    exit: (code = 0) => process.exit(code),
    // Why []: there are no Chromium processes on this host to measure.
    getAppMetrics: () => []
  }
}

/**
 * Why not silently plaintext: `isEncryptionAvailable() === false` already makes every
 * caller fall back to unsealed storage, which is a security posture, not a detail.
 * `describeProtectionGap()` gives the reason a client can surface.
 */
function createNodeSecretStore(): SecretStore {
  return {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('koluxd_secret_sealing_unavailable')
    },
    decryptString: () => {
      throw new Error('koluxd_secret_sealing_unavailable')
    },
    describeProtectionGap: () =>
      'This host has no OS keyring, so credentials are stored unencrypted. Pair from a desktop to manage secrets, or install and unlock a keyring.'
  }
}

export function installKoluxdHostAdapters(): void {
  setAppEnvironment(createNodeAppEnvironment())
  setSecretStore(createNodeSecretStore())
}

export type KoluxdOptions = {
  port?: number
  json?: boolean
  noPairing?: boolean
  pairingAddress?: string
  /** Literal IP to bind. Defaults to loopback; see koluxd-bind-address.ts. */
  bind?: string
}

export type KoluxdHandle = {
  readiness: ServeReadiness
  stop(): Promise<void>
}

/**
 * Boot the runtime and serve RPC. Resolves once the transport is listening and the
 * readiness payload has been published, mirroring the desktop `--serve` contract byte
 * for byte so the same harnesses can drive either host.
 */
export async function startKoluxd(options: KoluxdOptions = {}): Promise<KoluxdHandle> {
  installKoluxdHostAdapters()
  const userDataPath = resolveUserDataPath()
  // Why skip when KOLUX_USER_DATA is set: that's an explicit override (isolated test/smoke
  // runs, using a disposable path node:os's homedir() does not see), not the real default
  // root, so there is nothing this legacy carry-forward should touch.
  if (!process.env.KOLUX_USER_DATA) {
    migrateLegacyNightshiftUserData(userDataPath)
  }
  // Why before anything else touches the root: the profile index, the store and the daemon
  // runtime dir all live under it, and two koluxds sharing them corrupt state silently. This
  // is also the last point at which refusing costs nothing.
  const instanceLock = acquireKoluxdInstanceLock(userDataPath)
  const browserProvider = await resolveKoluxdBrowserProvider({ userDataPath })
  setRuntimeBrowserCommandsFactory(browserProvider?.factory ?? null, {
    headless: browserProvider !== null,
    ...(browserProvider ? { isAvailable: () => browserProvider.isAvailable() } : {})
  })
  try {
    return await startKoluxdRuntime(options, browserProvider, instanceLock)
  } catch (error) {
    await browserProvider?.stop()
    setRuntimeBrowserCommandsFactory(null)
    runKoluxdQuitHandlers()
    instanceLock.release()
    throw error
  }
}

async function startKoluxdRuntime(
  options: KoluxdOptions,
  browserProvider: KoluxdBrowserProvider | null,
  instanceLock: KoluxdInstanceLock
): Promise<KoluxdHandle> {
  const { KoluxRuntimeService } = await import('../runtime/kolux-runtime')
  const { KoluxRuntimeRpcServer } = await import('../runtime/runtime-rpc')
  const { registerHeadlessPtyRuntime, getLocalPtyProvider, getSshPtyProvider } =
    await import('../ipc/pty')
  const { getAppEnvironment } = await import('../../shared/app-environment')
  const { resolveAdvertisedPairingEndpoint } = await import('../runtime/pairing-endpoint')
  const { ServeReadinessPublisher } = await import('../server/serve-readiness')
  const { Store } = await import('../persistence/loading-store/store')
  const { ensureActiveKoluxProfile, initKoluxProfilePaths } =
    await import('../kolux-profiles/profile-index-store')
  const { initSshHostKeyStoreFile } = await import('../ssh/ssh-host-key-store')
  const { startKoluxdDaemon, stopKoluxdDaemon } = await import('./koluxd-daemon-supervision')
  const { daemonOwnsFreshPersistentPtys } = await import('../daemon/daemon-init')
  const { collectKoluxdHealth } = await import('./koluxd-health')

  const runtimeUserDataPath = getAppEnvironment().getPath('userData')
  initKoluxProfilePaths()
  const profile = ensureActiveKoluxProfile(runtimeUserDataPath)
  // Why a real Store: without one every persistence-backed RPC throws `runtime_unavailable`
  // and the read paths that use `this.store?.x ?? []` quietly answer "empty" instead —
  // a server that pairs and lists nothing looks healthy and is not.
  // Why: koluxd IS the runtime authority — loading as 'desktop' would classify its
  // own runtime-scheduled automations as ambiguous mirrors and orphan them.
  const store = new Store({ dataFile: profile.dataFile, storageAuthority: 'runtime' })
  // Why: every SSH connect consults this sidecar. Left unbound it reports nothing trusted,
  // which is safe but silently discards accept records on every launch.
  initSshHostKeyStoreFile(profile.dataFile)

  // Why before the runtime and the PTY handlers: `setLocalPtyProvider` installs the daemon
  // adapter as THE local provider, and the registry's contract is that it lands before
  // registerPtyHandlers so the IPC layer routes through the daemon from the first call.
  await startKoluxdDaemon()

  const runtime = new KoluxRuntimeService(store, undefined, {
    // Why lazy: a daemon swap replaces the provider after construction, so an eager
    // reference would freeze the pre-daemon one.
    getLocalProvider: () => getLocalPtyProvider(),
    // Why: destructive worktree removal refuses to run without a provider to stop
    // processes through — correctly, since it cannot otherwise verify the tree is idle.
    getSshProvider: (connectionId) => getSshPtyProvider(connectionId),
    // Why the daemon predicate and not a constant: koluxd now spawns the terminal daemon, so
    // its PTYs DO survive a koluxd restart — but only while a daemon that owns fresh
    // sessions is installed. A failed or degraded launch has to answer false, and this reads
    // that live rather than snapshotting it at construction.
    canRecoverPersistentLocalPtys: () => daemonOwnsFreshPersistentPtys(),
    // Why 'blocked': `'openable'` means a desktop window can be opened here, which is
    // what powers serve→desktop promotion. A Node host can never do that, and the
    // constructor's default would advertise it.
    getDesktopWindowStatus: () => 'blocked'
  })

  // Why the headless entry point rather than registerPtyHandlers directly: this is the
  // same call `--serve` makes, and it threads the store through. Without the store the
  // handlers install fine and every terminal.create then fails at persistence time.
  //
  // Codex-home and Claude-auth preparation are left unset: both are desktop account
  // flows. A launch that needs one fails with its own message rather than silently
  // spawning an unauthenticated agent.
  await registerHeadlessPtyRuntime(runtime, undefined, () => store.getSettings(), undefined, store)

  // Why: same post-registration reconciliation `--serve` performs. Skipping it leaves
  // restored orchestration rows claiming an authority this host never took over.
  // Why before the RPC server binds: a client host attaching first would find no pages to recover.
  runtime.rehydrateClientHostedBrowserPages()

  await runtime.refreshRestoredOrchestrationAuthority()
  await runtime.reconcileLegacyWorkerTerminals()

  const bindHost = resolveKoluxdBindHost(options.bind)
  const rpc = new KoluxRuntimeRpcServer({
    runtime,
    userDataPath: runtimeUserDataPath,
    enableWebSocket: true,
    // Why pinned and not `exposeNetworkByDefault`: an unattended host's exposure must be
    // exactly what the operator asked for, on every launch. The default path widens itself
    // once a device has connected, so a loopback deployment would silently go wide one
    // restart after its first client paired.
    pinnedBindHost: bindHost,
    ...(options.port !== undefined ? { wsPort: options.port, preferPinnedWsPort: true } : {})
  })
  await rpc.start()
  console.error(`[koluxd] ${describeKoluxdBindExposure(bindHost)}`)

  const boundEndpoint = rpc.getWebSocketEndpoint()
  const advertised = boundEndpoint
    ? resolveAdvertisedPairingEndpoint(boundEndpoint, options.pairingAddress)
    : null
  const offer = options.noPairing
    ? ({
        available: false,
        reason: 'disabled_by_operator',
        guidance: 'Restart without --no-pairing to create a client pairing offer.'
      } as const)
    : rpc.createPairingOffer({
        address: options.pairingAddress,
        name: `CLI ${new Date().toLocaleDateString()}`,
        scope: 'runtime'
      })

  const readiness: ServeReadiness = {
    runtimeId: runtime.getRuntimeId(),
    boundEndpoint,
    advertisedEndpoint: advertised?.ok ? advertised.endpoint : null,
    // Why 'settled': the WSL CLI reconciliation barrier is a desktop-launch concern.
    // koluxd never runs it, so there is no pending repair a client could race.
    managedWslCliReconciliation: 'settled',
    pairing: offer.available
      ? {
          available: true,
          url: offer.pairingUrl,
          endpoint: offer.endpoint,
          deviceId: offer.deviceId,
          webClientUrl: offer.webClientUrl,
          scope: 'runtime',
          qr: null
        }
      : offer,
    // Why in the readiness payload: this is the one message a supervisor and a deploy
    // transaction both read, and a green koluxd with a dead daemon is exactly the
    // looks-healthy-but-useless state they must not activate.
    health: await collectKoluxdHealth(getAppEnvironment().getVersion())
  }

  await new ServeReadinessPublisher().publish(readiness, {
    mode: options.json ? 'json' : 'human'
  })

  return {
    readiness,
    stop: async () => {
      try {
        await rpc.stop()
      } finally {
        // Why disconnect and not shut down: the daemon must outlive this process, or an
        // koluxd restart goes back to killing every running terminal. See
        // koluxd-daemon-supervision.ts.
        await stopKoluxdDaemon()
        await browserProvider?.stop()
        setRuntimeBrowserCommandsFactory(null)
        runKoluxdQuitHandlers()
        instanceLock.release()
      }
    }
  }
}

export function parseArgs(argv: string[]): KoluxdOptions {
  const options: KoluxdOptions = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--port') {
      const raw = argv[i + 1]
      const port = Number(raw)
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`--port expects an integer 0-65535, got ${raw ?? "''"}`)
      }
      options.port = port
      i += 1
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--no-pairing') {
      options.noPairing = true
    } else if (arg === '--bind') {
      const value = argv[i + 1]
      if (value === undefined) {
        throw new Error('--bind expects a value')
      }
      options.bind = value
      i += 1
    } else if (arg === '--pairing-address') {
      const value = argv[i + 1]
      if (!value) {
        throw new Error('--pairing-address expects a value')
      }
      options.pairingAddress = value
      i += 1
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

/**
 * Exit codes a supervisor can act on. Closed set — see docs/reference/koluxd-operations.md.
 *
 * `KOLUXD_EXIT_CONFIGURATION` is the load-bearing one: a data root owned by someone else, or
 * held by another koluxd, is not fixed by restarting. Restarting on it is the crash-loop the
 * supervision contract has to prevent, so systemd's `RestartPreventExitStatus` needs a code
 * that means "do not retry" and nothing else does.
 */
export const KOLUXD_EXIT_OK = 0
export const KOLUXD_EXIT_FAILED = 1
export const KOLUXD_EXIT_CONFIGURATION = 78

/** Bounded so a wedged transport cannot hold a supervisor's stop past its own deadline. */
export const KOLUXD_SHUTDOWN_DEADLINE_MS = 15_000

export function resolveKoluxdExitCode(error: unknown): number {
  return error instanceof KoluxdInstanceLockError || error instanceof KoluxdBindAddressError
    ? KOLUXD_EXIT_CONFIGURATION
    : KOLUXD_EXIT_FAILED
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const handle = await startKoluxd(parseArgs(argv))
  let stopping = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) {
      // Why escalate rather than ignore: a supervisor's second signal means the first
      // deadline elapsed. Continuing to wait silently is what makes a stop hang until
      // SIGKILL, which is the one teardown that skips the daemon handoff entirely.
      console.error(`koluxd: second ${signal} during shutdown — exiting immediately`)
      process.exit(KOLUXD_EXIT_FAILED)
    }
    stopping = true
    // Why a self-imposed deadline as well: the supervisor's SIGKILL leaves no exit code and
    // no log line. Exiting ourselves keeps the failure attributable.
    const deadline = setTimeout(() => {
      console.error(
        `koluxd: shutdown after ${signal} exceeded ${KOLUXD_SHUTDOWN_DEADLINE_MS}ms — exiting`
      )
      process.exit(KOLUXD_EXIT_FAILED)
    }, KOLUXD_SHUTDOWN_DEADLINE_MS)
    deadline.unref()
    handle
      .stop()
      .then(() => process.exit(KOLUXD_EXIT_OK))
      // Why not rethrow: we are already tearing down on a signal, and an exit code is
      // the only thing a supervisor can act on.
      .catch((error) => {
        console.error(`koluxd: shutdown after ${signal} failed:`, error)
        process.exit(KOLUXD_EXIT_FAILED)
      })
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}
