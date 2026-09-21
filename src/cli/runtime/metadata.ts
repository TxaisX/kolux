import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import {
  findTransport,
  getRuntimeMetadataPath,
  type RuntimeMetadata
} from '../../shared/runtime-bootstrap'
import { migrateLegacyNightshiftUserData } from '../../main/startup/legacy-nightshift-userdata-migration'
import { RuntimeClientError } from './types'

export function readMetadata(userDataPath: string): RuntimeMetadata {
  const metadataPath = getRuntimeMetadataPath(userDataPath)
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as RuntimeMetadata | null
    if (!metadata || !findTransport(metadata, 'unix', 'named-pipe') || !metadata.authToken) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        `Kolux runtime metadata is incomplete at ${metadataPath}`
      )
    }
    return metadata
  } catch (error) {
    if (error instanceof RuntimeClientError) {
      throw error
    }
    throw new RuntimeClientError(
      'runtime_unavailable',
      `Could not read Kolux runtime metadata at ${metadataPath}. Start the Kolux app first.`
    )
  }
}

export function tryReadMetadata(userDataPath: string): RuntimeMetadata | null {
  const metadataPath = getRuntimeMetadataPath(userDataPath)
  try {
    return JSON.parse(readFileSync(metadataPath, 'utf8')) as RuntimeMetadata | null
  } catch {
    return null
  }
}

export function getDefaultUserDataPath(
  platform: NodeJS.Platform = process.platform,
  homeDir = homedir()
): string {
  // Why: in dev mode (and for parallel Kolux instances), the Electron app writes
  // runtime metadata to a separate userData directory (e.g. `kolux-dev`) to avoid
  // clobbering the production app's metadata. The CLI needs to find the same
  // metadata file, so this env var lets the CLI target a specific instance.
  if (process.env.KOLUX_USER_DATA_PATH) {
    return process.env.KOLUX_USER_DATA_PATH
  }
  const userDataPath = resolvePlatformDefaultUserDataPath(platform, homeDir)
  // Why here: a hook command can run before the Kolux app has ever launched post-upgrade, so
  // this is a second entry point for the same one-time carry-forward main-process-preflight.ts
  // runs. Idempotent and cheap (one stat) once done. Skipped above for KOLUX_USER_DATA_PATH,
  // which is a dev/test override, not a real user's install.
  migrateLegacyNightshiftUserData(userDataPath)
  return userDataPath
}

function resolvePlatformDefaultUserDataPath(platform: NodeJS.Platform, homeDir: string): string {
  if (platform === 'darwin') {
    return join(homeDir, 'Library', 'Application Support', 'kolux')
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA
    if (!appData) {
      throw new RuntimeClientError(
        'runtime_unavailable',
        'APPDATA is not set, so the Kolux runtime metadata path cannot be resolved.'
      )
    }
    return join(appData, 'kolux')
  }
  // Why: the CLI must find the same metadata file Electron writes in packaged
  // runs, so this mirrors Electron's default userData base instead of inventing
  // a CLI-specific config path.
  return join(process.env.XDG_CONFIG_HOME || join(homeDir, '.config'), 'kolux')
}
