/**
 * Pre-activation steps for `deployKoluxd`: getting the candidate's bytes onto the host,
 * and snapshotting the data root before anything about to run is stopped. Split out of
 * `koluxd-remote-deploy.ts` to stay under the file's line budget; behaviour is unchanged,
 * this is a pure move.
 */
import { execCommand } from './ssh-relay-deploy-helpers'
import { KOLUXD_INSTALL_MODEL } from './remote-install-model'
import { acquireInstallLock } from './ssh-relay-install-lock'
import { uploadRelayDirectory, writeRelayFile } from './ssh-relay-install-transfers'
import {
  abandonInstall,
  finalizeInstall,
  isRemoteInstallComplete
} from './ssh-relay-versioned-install'
import { RELAY_REMOTE_DIR } from './relay-protocol'
import { KOLUXD_STATE_SNAPSHOT_DIR, type KoluxdStateSnapshot } from './koluxd-activation-record'
import {
  captureKoluxdStateSnapshotCommand,
  koluxdSnapshotDirName,
  parseKoluxdSnapshotCapture
} from './koluxd-state-snapshot'
import { joinRemotePath } from './ssh-remote-platform'
import type { KoluxdDeployOptions } from './koluxd-remote-deploy'

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

function baseDir(options: KoluxdDeployOptions): string {
  return joinRemotePath(options.host, options.remoteHome, RELAY_REMOTE_DIR)
}

/** Install the bytes under `koluxd-<version>/`, using the relay's install transaction. */
export async function installKoluxdBundle(
  options: KoluxdDeployOptions,
  fullVersion: string,
  remoteDir: string
): Promise<void> {
  if (
    await isRemoteInstallComplete(options.conn, KOLUXD_INSTALL_MODEL, remoteDir, options.host, {
      signal: options.signal
    })
  ) {
    return
  }
  await acquireInstallLock(options.conn, remoteDir, options.host, { signal: options.signal })
  try {
    // Re-probe under the lock: a sibling deploy may have finished while we waited.
    if (
      await isRemoteInstallComplete(options.conn, KOLUXD_INSTALL_MODEL, remoteDir, options.host, {
        signal: options.signal
      })
    ) {
      return
    }
    await uploadRelayDirectory(options.conn, options.localKoluxdDir, remoteDir, options.host, {
      signal: options.signal
    })
    await writeRelayFile(
      options.conn,
      options.host,
      joinRemotePath(options.host, remoteDir, KOLUXD_INSTALL_MODEL.versionFilename),
      fullVersion,
      { signal: options.signal }
    )
    await finalizeInstall(options.conn, remoteDir, options.host, { signal: options.signal })
  } catch (error) {
    // Leave a recoverable partial rather than a dir that probes complete.
    await abandonInstall(options.conn, remoteDir, options.host)
    throw error
  }
}

export async function captureSnapshot(
  options: KoluxdDeployOptions,
  fullVersion: string,
  outgoingVersion: string | null,
  takenAt: Date
): Promise<KoluxdStateSnapshot | null> {
  const dirName = koluxdSnapshotDirName(fullVersion, takenAt.getTime())
  const snapshotDir = joinRemotePath(
    options.host,
    baseDir(options),
    KOLUXD_STATE_SNAPSHOT_DIR,
    dirName
  )
  const capture = parseKoluxdSnapshotCapture(
    await exec(
      options,
      captureKoluxdStateSnapshotCommand(options.host, options.userDataDir, snapshotDir)
    )
  )
  if (capture === 'failed') {
    throw new Error(
      `Could not snapshot ${options.userDataDir} before activating ${fullVersion}. Kolux's ` +
        'persisted state carries no schema version, so without a snapshot a rollback has no ' +
        'way back. Refusing to activate.'
    )
  }
  if (capture === 'empty') {
    // Nothing on the host to lose: a first deployment. Rollback will correctly report that
    // it has no snapshot, rather than restoring an archive of nothing over a populated root.
    return null
  }
  return {
    dirName,
    takenBeforeVersion: fullVersion,
    readableByVersion: outgoingVersion,
    takenAt: takenAt.toISOString()
  }
}
