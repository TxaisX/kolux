/**
 * Installing koluxd on a host and, only if it proves itself, making it the active one.
 *
 * The install half is the relay's transaction, parameterized: the same per-version lock,
 * staged SFTP write, `.install-complete` sentinel and stale-lock recovery, under
 * `koluxd-<version>/` instead of `relay-<version>/`. That is what §02 marks reusable.
 *
 * The activation half has no relay equivalent, because the relay has no notion of a version
 * being *selected*. Bytes landing in a versioned directory neither picks a version nor rolls
 * one back; the activation record does, and it is written only after the candidate publishes
 * a health payload that survives `evaluateKoluxdActivation`. A rejected candidate leaves the
 * previous version running and its own bytes on disk — nothing is lost, and a retry costs no
 * upload.
 */
import type { SshConnection } from './ssh-connection'
import { execCommand } from './ssh-relay-deploy-helpers'
import { KOLUXD_INSTALL_MODEL } from './remote-install-model'
import { writeRelayFile } from './ssh-relay-install-transfers'
import { computeRemoteInstallDir, readLocalFullVersion } from './ssh-relay-versioned-install'
import {
  serializeKoluxdActivationRecord,
  withActivatedVersion,
  type KoluxdActivationRecord
} from './koluxd-activation-record'
import { installKoluxdBundle, captureSnapshot } from './koluxd-remote-deploy-install'
import { koluxdActivationPath, readKoluxdActivationRecord } from './koluxd-activation-record-store'
import { evaluateKoluxdActivation, type KoluxdActivationVerdict } from './koluxd-activation-gate'
import { planKoluxdUpdate, type KoluxdTerminalCensus } from './koluxd-update-plan'
import {
  KOLUXD_LOG_FILENAME,
  koluxdLaunchCommand,
  parseKoluxdReadinessOutput,
  readKoluxdReadinessCommand,
  type KoluxdLaunchSpec
} from './koluxd-remote-launch'
import {
  koluxdStopFreedTheHost,
  parseKoluxdStopOutcome,
  stopKoluxdCommand
} from './koluxd-remote-process-control'
import { joinRemotePath, type RemoteHostPlatform } from './ssh-remote-platform'
import { computeLocalKoluxdBuildHash } from './koluxd-local-build-hash'

export type KoluxdDeployOptions = {
  conn: SshConnection
  host: RemoteHostPlatform
  remoteHome: string
  /** Local `out/koluxd`, containing the artifacts and the `.version` marker. */
  localKoluxdDir: string
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  /**
   * Live-terminal counts, supplied by the caller from the runtime it is already connected
   * to. Not probed here: counting the daemon's sessions needs its protocol, and a deploy
   * that guessed zero from silence would be the "loss of contact means death" mistake.
   */
  census: KoluxdTerminalCensus
  force?: boolean
  readinessTimeoutMs?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type KoluxdDeployResult =
  | {
      outcome: 'installed-and-activated'
      fullVersion: string
      verdict: KoluxdActivationVerdict
    }
  | { outcome: 'already-active'; fullVersion: string }
  | { outcome: 'installed-not-activated'; fullVersion: string; code: string; reason: string }

const DEFAULT_READINESS_TIMEOUT_MS = 90_000
const READINESS_POLL_MS = 500
const STOP_WAIT_SECONDS = 20

function exec(
  options: KoluxdDeployOptions,
  command: string,
  signal = options.signal
): Promise<string> {
  return execCommand(options.conn, command, {
    wrapCommand: options.host.commandDialect !== 'powershell',
    signal
  })
}

async function launchAndAwaitReadiness(
  options: KoluxdDeployOptions,
  spec: KoluxdLaunchSpec
): Promise<ReturnType<typeof parseKoluxdReadinessOutput>> {
  await exec(options, koluxdLaunchCommand(options.host, spec))
  const deadline = Date.now() + (options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS)
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let last = parseKoluxdReadinessOutput('')
  while (Date.now() < deadline) {
    options.signal?.throwIfAborted()
    last = parseKoluxdReadinessOutput(
      await exec(options, readKoluxdReadinessCommand(options.host, spec.remoteInstallDir))
    )
    if (last.state !== 'pending') {
      return last
    }
    await sleep(READINESS_POLL_MS)
  }
  return last
}

/**
 * Put the previous version back after a rejected candidate.
 *
 * Why this exists at all: activating means swapping which process owns the data root and the
 * port, so the incumbent has to stop before the candidate can start. A gate that rejected
 * and returned would leave the host with nothing running — a careful deploy causing the
 * outage it was being careful about. The returned sentence goes into the caller's reason so
 * the operator learns the host's actual state, not just why the candidate failed.
 */
async function restoreIncumbent(
  options: KoluxdDeployOptions,
  record: KoluxdActivationRecord,
  candidateDir: string
): Promise<string> {
  const stopped = parseKoluxdStopOutcome(
    await exec(
      options,
      stopKoluxdCommand(options.host, candidateDir, { waitSeconds: STOP_WAIT_SECONDS })
    )
  )
  if (!koluxdStopFreedTheHost(stopped)) {
    return `The candidate itself did not stop (${stopped}); the host may still be serving the rejected build.`
  }
  if (!record.active) {
    return 'No previous version was active, so this host is now serving nothing.'
  }
  const incumbentDir = computeRemoteInstallDir(
    KOLUXD_INSTALL_MODEL,
    options.remoteHome,
    record.active
  )
  const parsed = await launchAndAwaitReadiness(options, {
    remoteInstallDir: incumbentDir,
    nodePath: options.nodePath,
    fullVersion: record.active,
    userDataDir: options.userDataDir,
    bindHost: options.bindHost,
    port: options.port
  })
  return parsed.state === 'ready'
    ? `koluxd ${record.active} was restarted and is serving again.`
    : `koluxd ${record.active} was relaunched but has not published readiness; this host may be down.`
}

/**
 * Install, then activate only on a green cross-process health verdict.
 *
 * Every early return past the install leaves the bytes on disk and the previous version
 * serving, which is why they all report `installed-not-activated` rather than throwing: a
 * refusal to switch is a successful outcome of a deploy that was asked to be careful.
 */
export async function deployKoluxd(options: KoluxdDeployOptions): Promise<KoluxdDeployResult> {
  const now = options.now ?? ((): Date => new Date())
  const fullVersion = readLocalFullVersion(options.localKoluxdDir)
  const remoteDir = computeRemoteInstallDir(KOLUXD_INSTALL_MODEL, options.remoteHome, fullVersion)
  const record = await readKoluxdActivationRecord(options)

  await installKoluxdBundle(options, fullVersion, remoteDir)

  const plan = planKoluxdUpdate({
    record,
    candidateVersion: fullVersion,
    census: options.census,
    ...(options.force !== undefined ? { force: options.force } : {})
  })
  if (plan.action === 'noop') {
    return { outcome: 'already-active', fullVersion }
  }
  if (plan.action === 'defer') {
    return {
      outcome: 'installed-not-activated',
      fullVersion,
      code: plan.code,
      reason: plan.reason
    }
  }

  const snapshot = record.active
    ? await captureSnapshot(options, fullVersion, record.active, now())
    : null

  if (record.active) {
    const outgoingDir = computeRemoteInstallDir(
      KOLUXD_INSTALL_MODEL,
      options.remoteHome,
      record.active
    )
    const stopped = parseKoluxdStopOutcome(
      await exec(
        options,
        stopKoluxdCommand(options.host, outgoingDir, {
          waitSeconds: STOP_WAIT_SECONDS
        })
      )
    )
    if (!koluxdStopFreedTheHost(stopped)) {
      return {
        outcome: 'installed-not-activated',
        fullVersion,
        code: 'koluxd_outgoing_stop_incomplete',
        reason:
          `koluxd ${record.active} did not exit within ${STOP_WAIT_SECONDS}s of SIGTERM ` +
          `(${stopped}). It is still holding the data root and the port, so the candidate ` +
          'cannot start. Not escalating to SIGKILL: that skips the shutdown that releases ' +
          'the instance lock, and the successor would then refuse to start.'
      }
    }
  }

  const parsed = await launchAndAwaitReadiness(options, {
    remoteInstallDir: remoteDir,
    nodePath: options.nodePath,
    fullVersion,
    userDataDir: options.userDataDir,
    bindHost: options.bindHost,
    port: options.port
  })
  const verdict = evaluateKoluxdActivation(parsed.state === 'ready' ? parsed.readiness : null, {
    buildHash: computeLocalKoluxdBuildHash(options.localKoluxdDir),
    fullVersion
  })
  if (verdict.decision === 'reject') {
    const restored = await restoreIncumbent(options, record, remoteDir)
    return {
      outcome: 'installed-not-activated',
      fullVersion,
      code: verdict.code,
      reason:
        `${verdict.reason} Candidate stderr is at ` +
        `${joinRemotePath(options.host, remoteDir, KOLUXD_LOG_FILENAME)}. ${restored}`
    }
  }

  await writeRelayFile(
    options.conn,
    options.host,
    koluxdActivationPath(options.host, options.remoteHome),
    serializeKoluxdActivationRecord(withActivatedVersion(record, fullVersion, snapshot, now())),
    { signal: options.signal }
  )
  return { outcome: 'installed-and-activated', fullVersion, verdict }
}
