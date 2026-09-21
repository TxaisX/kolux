import { lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { AgentHookInstallState, AgentHookInstallStatus } from '../../shared/agent-hook-types'
import { resolveGrokHomeDir } from '../../shared/grok-session-paths'
import {
  readHooksJson,
  readHooksJsonWithRaw,
  writeHooksJson,
  writeManagedScript
} from '../agent-hooks/installer-utils'
import { refreshManagedScriptIfPresent } from '../agent-hooks/managed-hook-script-refresh'
import { isKoluxOwnedRemnant, removeManagedGrokHookEntries } from './grok-hook-config-cleanup'
import { buildInstalledGrokConfig, GROK_EVENTS, GROK_TOOL_EVENT_MATCHER } from './grok-hook-config'
import { installRemoteGrokHook } from './grok-hook-remote-install'
import {
  getGrokManagedCommand,
  getGrokManagedScript,
  getGrokManagedScriptFileName,
  getGrokManagedScriptPath
} from './grok-hook-script'
import {
  isGrokHookConfigSymlink,
  readGrokHookConfigSnapshot,
  removeGrokHookConfigIfUnchanged,
  writeGrokHookConfigIfUnchanged
} from './grok-hook-config-file'
import {
  hasRegisteredGrokHookOwner,
  registerGrokHookOwner,
  releaseGrokHookOwnerAndCheckForPeers,
  unregisterGrokHookOwnerSync
} from './grok-hook-owners'
import {
  clearGrokSymlinkCleanupMarker,
  matchesRecordedGrokSymlinkCleanup,
  recordGrokSymlinkCleanup
} from './grok-hook-symlink-cleanup-marker'

/** Test seam: the matcher string written for Pre/Post tool lifecycle hooks. */
export function getGrokToolEventMatcherForTests(): string {
  return GROK_TOOL_EVENT_MATCHER
}

function getConfigPath(): string {
  // Why: Grok loads trusted global hook files from $GROK_HOME/hooks/*.json
  // (or ~/.grok when unset). Honor GROK_HOME so install/status match the same
  // home Grok and transcript lookup use; keep Kolux entries in a dedicated file
  // so user-authored hook files stay untouched.
  return join(resolveGrokHomeDir(), 'hooks', 'kolux-status.json')
}

// Why: pre-rename Kolux wrote hooks/nightshift-status.json; Grok loads every hooks/*.json, so a
// stale copy would keep firing the managed hook a second time after the app renamed itself.
function getLegacyConfigPath(): string {
  return join(resolveGrokHomeDir(), 'hooks', 'nightshift-status.json')
}

function sweepLegacyGrokConfig(): void {
  try {
    const legacyPath = getLegacyConfigPath()
    const config = readHooksJson(legacyPath)
    if (!config) {
      return
    }
    const { config: cleaned, removedAny } = removeManagedGrokHookEntries(
      config,
      getGrokManagedScriptFileName()
    )
    if (!removedAny) {
      return
    }
    if (isKoluxOwnedRemnant(cleaned)) {
      rmSync(legacyPath, { force: true })
    } else {
      writeHooksJson(legacyPath, cleaned)
    }
  } catch (error) {
    console.warn('[grok-hook-service] failed to sweep legacy hook config', error)
  }
}

/** Test seam: the command registered for `scriptPath` on the current platform. */
export function getManagedCommandForTests(scriptPath: string): string {
  return getGrokManagedCommand(scriptPath)
}

function isSymbolicLinkSync(configPath: string): boolean {
  try {
    return lstatSync(configPath).isSymbolicLink()
  } catch {
    return false
  }
}

function readGrokHookConfigRawSync(configPath: string): string | null {
  try {
    return readFileSync(configPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function notInstalledStatus(
  configPath: string,
  detail: string | null = null
): AgentHookInstallStatus {
  return {
    agent: 'grok',
    state: detail ? 'error' : 'not_installed',
    configPath,
    managedHooksPresent: false,
    detail
  }
}

export class GrokHookService {
  async refreshManagedScripts(): Promise<void> {
    await refreshManagedScriptIfPresent(getGrokManagedScriptPath(), getGrokManagedScript())
  }

  getStatus(): AgentHookInstallStatus {
    const configPath = getConfigPath()
    const scriptPath = getGrokManagedScriptPath()
    const config = readHooksJson(configPath)
    if (!config) {
      return {
        agent: 'grok',
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: 'Could not parse Grok hook config'
      }
    }

    const command = getGrokManagedCommand(scriptPath)
    const missing: string[] = []
    let presentCount = 0
    for (const event of GROK_EVENTS) {
      const definitions = Array.isArray(config.hooks?.[event.eventName])
        ? config.hooks![event.eventName]!
        : []
      const hasCommand = definitions.some((definition) =>
        (definition.hooks ?? []).some((hook) => hook.command === command)
      )
      if (hasCommand) {
        presentCount += 1
      } else {
        missing.push(event.eventName)
      }
    }

    const managedHooksPresent = presentCount > 0
    let state: AgentHookInstallState
    let detail: string | null
    if (missing.length === 0) {
      state = 'installed'
      detail = null
    } else if (presentCount === 0) {
      state = 'not_installed'
      detail = null
    } else {
      state = 'partial'
      detail = `Managed hook missing for events: ${missing.join(', ')}`
    }
    return { agent: 'grok', state, configPath, managedHooksPresent, detail }
  }

  install(options?: { userInitiated?: boolean }): AgentHookInstallStatus {
    const configPath = getConfigPath()
    const scriptPath = getGrokManagedScriptPath()
    const snapshot = readHooksJsonWithRaw(configPath)
    const config = snapshot.config
    if (!config) {
      return {
        agent: 'grok',
        state: 'error',
        configPath,
        managedHooksPresent: false,
        detail: 'Could not parse Grok hook config'
      }
    }

    // Why: an existing empty file is an explicit user choice, not a missing config -- the reported
    // workaround for #15518 was emptying it by hand. Why userInitiated overrides: turning the
    // setting back on is an equally explicit choice, and the later one. Without this the toggle
    // silently does nothing forever and the only way back is deleting a file in a hidden directory.
    // A symlinked empty config is also respected unless its content and file identity match the
    // marker written by Kolux's own prior cleanup.
    const configIsSymlink = isSymbolicLinkSync(configPath)
    const reinstallsOwnSymlinkCleanup =
      configIsSymlink &&
      snapshot.raw !== null &&
      matchesRecordedGrokSymlinkCleanup(configPath, snapshot.raw)
    if (
      options?.userInitiated !== true &&
      snapshot.raw !== null &&
      Object.keys(config.hooks ?? {}).length === 0 &&
      !reinstallsOwnSymlinkCleanup
    ) {
      return this.getStatus()
    }

    buildInstalledGrokConfig(
      config,
      getGrokManagedCommand(scriptPath),
      getGrokManagedScriptFileName()
    )
    writeManagedScript(scriptPath, getGrokManagedScript())
    mkdirSync(dirname(configPath), { recursive: true })
    if (readGrokHookConfigRawSync(configPath) !== snapshot.raw) {
      return notInstalledStatus(configPath, 'Grok hook config changed during installation')
    }
    const ownsWindowsHook = process.platform === 'win32'
    try {
      if (ownsWindowsHook) {
        registerGrokHookOwner()
      }
      writeHooksJson(configPath, config)
      if (configIsSymlink) {
        clearGrokSymlinkCleanupMarker(configPath)
      }
      sweepLegacyGrokConfig()
      return this.getStatus()
    } catch (error) {
      if (ownsWindowsHook) {
        unregisterGrokHookOwnerSync()
      }
      throw error
    }
  }

  async installRemote(
    sftp: SFTPWrapper,
    remoteHome: string,
    remoteGrokHome?: string
  ): Promise<AgentHookInstallStatus> {
    return await installRemoteGrokHook(
      sftp,
      remoteHome,
      remoteGrokHome,
      getGrokManagedScript('posix')
    )
  }

  remove(): AgentHookInstallStatus {
    sweepLegacyGrokConfig()
    const configPath = getConfigPath()
    if (process.platform === 'win32') {
      unregisterGrokHookOwnerSync()
    }
    clearGrokSymlinkCleanupMarker(configPath)
    const snapshot = readHooksJsonWithRaw(configPath)
    const config = snapshot.config
    if (!config) {
      return notInstalledStatus(configPath, 'Could not parse Grok hook config')
    }
    if (snapshot.raw === null) {
      return notInstalledStatus(configPath)
    }
    const cleanup = removeManagedGrokHookEntries(config, getGrokManagedScriptFileName())
    if (!cleanup.removedAny) {
      return notInstalledStatus(configPath)
    }
    if (readGrokHookConfigRawSync(configPath) !== snapshot.raw) {
      return notInstalledStatus(configPath, 'Grok hook config changed during cleanup')
    }
    // Why the symlink check: unlinking would delete the user's link, not our file. A config they
    // symlinked into a dotfiles repo is theirs -- strip our entries and write through it instead.
    // writeHooksJson already resolves the link, so the file they version-control stays connected.
    if (isKoluxOwnedRemnant(cleanup.config) && !isSymbolicLinkSync(configPath)) {
      rmSync(configPath, { force: true })
    } else {
      writeHooksJson(configPath, cleanup.config)
    }
    return notInstalledStatus(configPath)
  }

  async removeAsync(): Promise<AgentHookInstallStatus> {
    const configPath = getConfigPath()
    const ownsWindowsHook = process.platform === 'win32'
    let peerOwnsWindowsHook = false
    const releaseOwner = async (): Promise<boolean> => {
      peerOwnsWindowsHook = await releaseGrokHookOwnerAndCheckForPeers()
      return !peerOwnsWindowsHook
    }
    const mutationOptions = ownsWindowsHook
      ? {
          beforeHold: releaseOwner,
          shouldCommit: async () => !(await hasRegisteredGrokHookOwner())
        }
      : undefined
    const snapshot = await readGrokHookConfigSnapshot(configPath)
    if (!snapshot.config) {
      if (ownsWindowsHook) {
        await releaseOwner()
      }
      return notInstalledStatus(configPath, 'Could not parse Grok hook config')
    }
    if (snapshot.raw === null) {
      if (ownsWindowsHook) {
        await releaseOwner()
      }
      return notInstalledStatus(configPath)
    }
    const cleanup = removeManagedGrokHookEntries(snapshot.config, getGrokManagedScriptFileName())
    if (!cleanup.removedAny) {
      if (ownsWindowsHook) {
        await releaseOwner()
      }
      return notInstalledStatus(configPath)
    }
    const configIsSymlink = await isGrokHookConfigSymlink(configPath)
    const unlinkable = isKoluxOwnedRemnant(cleanup.config) && !configIsSymlink
    const serialized = `${JSON.stringify(cleanup.config, null, 2)}\n`
    const updated = unlinkable
      ? await removeGrokHookConfigIfUnchanged(configPath, snapshot.raw, mutationOptions)
      : await writeGrokHookConfigIfUnchanged(configPath, snapshot.raw, serialized, mutationOptions)
    if (peerOwnsWindowsHook) {
      return this.getStatus()
    }
    if (updated && configIsSymlink) {
      await recordGrokSymlinkCleanup(configPath, serialized)
    }
    return updated
      ? notInstalledStatus(configPath)
      : notInstalledStatus(configPath, 'Grok hook config changed during cleanup')
  }
}

export const grokHookService = new GrokHookService()
